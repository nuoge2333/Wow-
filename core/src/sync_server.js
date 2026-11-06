/**
 * 跨设备方案同步 —— 执行端（V3.5.25）
 * ----------------------------------------------------------------
 * 执行端是跑了 `wow web start` 的那台机器。它暴露三个端点：
 *
 *   POST /api/sync/check    接清单 → 预检（冲突 / 缺口）→ 返回 missing 列表
 *   POST /api/sync/upload   传文件（大文件分块、小文件 JSON 束）→ 哈希校验
 *   POST /api/sync/finalize 组装方案 → 入池 → state: full → 返回报告
 *
 * 三条硬约束（与需求原文一一对应）：
 *   1. **产物是方案**：骨架复用 client_clone.createSkeleton（也就是 scheme create
 *      的目录与 scheme.yaml 逻辑），模组入池复用 SchemeManager._addToPool。
 *   2. **核心装配走 installer 模块**，与 scheme create 共用，不点名镜像源。
 *   3. **不覆盖执行端已有的 server.properties / eula.txt**，除非清单显式带
 *      （--with-config），且覆盖前先备份为 .bak。
 *
 * 关键取舍（偏离需求原文的地方，理由写在对应位置）：
 *   - **核心装配放在 finalize 而不是 check**。需求第二阶段说「执行端收到清单后
 *     装配核心」，但 Forge 安装器要下载几十 MB 并跑 Java，HTTP 请求挂 10 分钟
 *     会被 Cloudflare Tunnel 的 ~100s 超时掐断。放 finalize 同样满足
 *     「走 installer 模块」，且报告能说明核心装配结果。
 *   - **小文件不用 tar 用 JSON 束**。Node 标准库没有 tar，为一个打包格式引依赖
 *     不值；JSON 束（base64 内容 + 路径 + 哈希）语义相同、零依赖。
 *   - **Modrinth 补齐按文件哈希而非 modID 匹配**。需求说「按 modID + 版本匹配」，
 *     但 Modrinth 上同一 modID 有大量不同构建（loader/版本变体），按版本号文本
 *     匹配不可靠；下载后比对 SHA-256 才能保证「与控制端完全同一个文件」。
 *     匹配不上就标记「需上传」，绝不使用不同的文件 —— 与需求的目标一致。
 */

const fs = require('fs-extra');
const path = require('path');
const express = require('express');

const config = require('./config');
const utils = require('./utils');
const { logger } = require('./log');
const sync = require('./sync_common');

// ==================== 辅助 ====================

/** 执行端的 scheme 根目录（与 SchemeManager.schemesDir 同路径） */
function schemesDir() {
    return utils.resolvePath('../scheme');
}

function schemeDirOf(name) {
    const clean = String(name || '').trim();
    if (!clean || /[\\/:*?"<>|]/.test(clean) || clean.startsWith('.')) return null;
    return path.join(schemesDir(), clean);
}

/** 阶段性日志（走事件日志，不打扰 Web 面板 stdout） */
function slog(msg) {
    try { logger.info(`[sync] ${msg}`); } catch (e) {}
}

// ==================== 预检 ====================

/**
 * 处理清单，返回缺口。
 * @returns {Promise<object>} { ok, reason?, missing, already_present, conflicts, core_plan, total_missing_bytes }
 */
async function processManifest(manifest, opts = {}) {
    const out = { missing: [], already_present: [], conflicts: [], core_plan: null, total_missing_bytes: 0 };

    // 支持 v1（单哈希，无 Modrinth 查询）与 v2（mods/plugins 带 sha512/sha1）
    if (!manifest || ![1, 2].includes(manifest.protocol)) {
        return { ok: false, reason: `清单协议版本不支持: ${manifest && manifest.protocol}` };
    }

    const schemeName = String(manifest.name || '').trim();
    if (!schemeName || /[\\/:*?"<>|]/.test(schemeName)) {
        return { ok: false, reason: `方案名不合法: ${schemeName}` };
    }

    // ---- 方案名冲突：拒绝，不覆盖、不合并 ----
    const dir = schemeDirOf(schemeName);
    if (!dir) return { ok: false, reason: `方案名不合法: ${schemeName}` };
    if (fs.existsSync(path.join(dir, 'scheme.yaml'))) {
        // 同步来源的方案允许重推（增量同步 / 断点续传 / 补缺口）；
        // 其它来源（手工创建、clone-client 等）一律拒绝，不覆盖、不合并
        let syncedBefore = false;
        try {
            syncedBefore = /^sync_source:/m.test(fs.readFileSync(path.join(dir, 'scheme.yaml'), 'utf8'));
        } catch (_) { /* 读不到按非同步来源处理 */ }
        if (!syncedBefore) {
            out.conflicts.push({
                type: 'scheme_name',
                message: `方案名已存在：scheme/${schemeName}（非同步来源，不覆盖）。请在控制端用 --name 指定新方案名。`
            });
            return { ok: true, ...out };
        }
    } else if (fs.existsSync(dir)) {
        out.conflicts.push({
            type: 'scheme_name',
            message: `目录 scheme/${schemeName} 已存在但不是有效方案，请先在执行端清理。`
        });
        return { ok: true, ...out };
    }

    // ---- 总量上限 ----
    if ((manifest.total_bytes || 0) > sync.MAX_TOTAL_BYTES) {
        return {
            ok: false,
            reason: `同步总量 ${(manifest.total_bytes / 1024 / 1024 / 1024).toFixed(2)} GB 超过上限 2 GB`
        };
    }

    // ---- 核心：记录计划，finalize 阶段装配（理由见文件头） ----
    out.core_plan = manifest.core
        ? { action: 'install', type: manifest.type || manifest.loader, mc_version: manifest.mc_version, loader_version: manifest.loader_version }
        : { action: 'skip', reason: '清单不含核心' };

    // ---- 预检通过即建骨架（幂等）：后续上传通道的路径校验需要它作锚点 ----
    const ClientClone = require('./client_clone');
    const SchemeManager = require('./scheme_manager');
    const sm = new SchemeManager();
    if (!sm._schemeExists(schemeName)) {
        const skel = ClientClone.createSkeleton({
            name: schemeName,
            mcVersion: manifest.mc_version,
            loader: manifest.loader,
            type: manifest.type || manifest.loader,
            source: 'sync',
            sourcePath: opts.sourceLabel || 'sync',
            schemeManager: sm
        });
        if (!skel.ok) return { ok: false, reason: `建骨架失败: ${skel.reason}` };
        slog(`方案 ${schemeName} 骨架已创建（预检阶段）`);
    }
    out.skeleton_created = true;

    // ---- 逐文件判定 ----
    // mods/plugins 的缺口先攒起来：pool 全未命中时统一去问 Modrinth（批量才有效率）
    const modCandidates = [];

    const judge = async (entry) => {
        const abs = path.join(dir, entry.path);
        if (fs.existsSync(abs)) {
            // 执行端已有同名文件：算哈希，一致 → 已就位；不一致 → 视为缺失（覆盖）？
            // 不。需求口径是「方案是新建的」，执行端不该有这些文件 —— 有同名说明
            // 之前同步中断过。哈希一致就当作续传成果，不一致就重新传。
            const local = await sync.sha256File(abs);
            if (local === entry.sha256) {
                out.already_present.push({ path: entry.path, reason: '哈希一致' });
                return;
            }
        }
        if (entry.kind === 'mods' || entry.kind === 'plugins') {
            modCandidates.push(entry);
            return;
        }
        out.missing.push({ path: entry.path, sha256: entry.sha256, size: entry.size });
        out.total_missing_bytes += entry.size || 0;
    };

    for (const e of sync.manifestEntries(manifest)) {
        if (e.kind === 'core') continue;       // 核心走 installer
        // root 文件（server.properties / eula.txt）也要走上传通道，finalize 统一落盘
        if (e.kind === 'root') {
            if (!['server.properties', 'eula.txt'].includes(e.path)) continue;
        }
        await judge(e);
    }

    // ---- pool 未命中的模组：尝试 Modrinth 补齐 ----
    // 注意：命中并下载成功的直接写入方案目录（已通过 SHA-256 校验），
    // 不进 missing；其余一律降级为「需上传」，任何失败都不中断同步。
    // resolved_by_pool = 模组总数 - 缺口数（already_present 里哈希一致的已在 judge 里记过）
    const modPoolHits = out.already_present.filter(a => /^(mods|plugins)\//.test(a.path)).length;
    out.mod_stats = { total_mods: modCandidates.length + modPoolHits, resolved_by_pool: modPoolHits, resolved_by_modrinth: 0, need_upload: 0 };
    if (modCandidates.length > 0) {
        // resolved_by_pool：同名文件哈希一致已经进 already_present 的模组数，这里从总量倒推
        const mr = await require('./sync_modrinth').fillFromModrinth({
            entries: modCandidates,
            protocol: manifest.protocol,
            schemePath: dir,
            log: slog
        });
        if (mr.skipped) slog(`[Modrinth] ${mr.skipped}`);
        for (const p of mr.resolved) {
            out.already_present.push({ path: p, reason: 'Modrinth 补齐（SHA-256 校验通过）' });
        }
        out.mod_stats.resolved_by_modrinth = mr.resolved.length;
        for (const m of mr.needUpload) {
            const entry = modCandidates.find(c => c.path === m.path);
            out.missing.push({
                path: m.path,
                sha256: entry && entry.sha256,
                size: entry ? entry.size : 0,
                reason: m.reason
            });
            out.total_missing_bytes += (entry && entry.size) || 0;
        }
        out.mod_stats.need_upload = mr.needUpload.length;
    }

    return { ok: true, ...out };
}

// ==================== 上传接收 ====================

/** 根目录配置文件（--with-config 显式勾选后才允许上传） */
const ROOT_FILES_ALLOWED = new Set(['server.properties', 'eula.txt']);

/**
 * 校验单个上传条目的路径与大小。
 * @returns {{ok:true, abs:string, rel:string} | {ok:false, reason:string, status:number}}
 */
function validateUploadTarget(schemeName, relPath, declaredSize, totalSoFar) {
    if (!schemeName || /[\\/:*?"<>|]/.test(String(schemeName))) {
        return { ok: false, reason: '方案名不合法', status: 400 };
    }
    const dir = schemeDirOf(schemeName);
    if (!dir) return { ok: false, reason: '方案名不合法', status: 400 };

    // 方案骨架必须已经建好（check 阶段不应被跳过）—— 否则路径校验没了锚点
    if (!fs.existsSync(path.join(dir, 'scheme.yaml'))) {
        return { ok: false, reason: `方案 ${schemeName} 尚未初始化（请先走 check 阶段）`, status: 409 };
    }

    // 根目录配置文件走专门通道（落在方案根，finalize 统一做备份/覆盖）
    const relNorm = String(relPath || '').replace(/\\/g, '/');
    if (ROOT_FILES_ALLOWED.has(relNorm)) {
        return { ok: true, abs: path.join(dir, relNorm), rel: relNorm, dir };
    }

    if (!sync.isPathAllowed(relPath)) {
        return { ok: false, reason: `路径不在白名单内: ${relPath}`, status: 403 };
    }
    if ((declaredSize || 0) > sync.MAX_FILE_BYTES) {
        return { ok: false, reason: `单文件超过上限 200MB`, status: 413 };
    }
    if (totalSoFar > sync.MAX_TOTAL_BYTES) {
        return { ok: false, reason: '同步总量超过上限 2GB', status: 413 };
    }

    // 用 safeResolve 加严：方案目录为根，只允许白名单子目录
    const FileManager = require('./file_manager');
    const r = FileManager.safeResolve(relPath, dir);
    if (!r.ok) return { ok: false, reason: r.reason, status: 403 };

    return { ok: true, abs: r.abs, rel: r.rel, dir };
}

/** staging 区的写入路径 */
function stagingFor(schemeName, sha256) {
    const base = utils.resolvePath(sync.STAGING_DIR);
    const dir = path.join(base, String(schemeName).replace(/[\\/:*?"<>|]/g, '_'));
    fs.ensureDirSync(dir);
    return path.join(dir, `${sha256}.part`);
}

// ==================== 组装 ====================

/**
 * finalize：把 staging 的内容落进方案、装核心、入池、写 scheme.yaml。
 * @returns {Promise<object>} 报告
 */
async function finalizeScheme(manifest, opts = {}) {
    const schemeName = String(manifest.name || '').trim();
    const dir = schemeDirOf(schemeName);
    if (!dir) return { ok: false, reason: '方案名不合法' };

    const FileManager = require('./file_manager');

    // ---- 1. 从 staging 落盘所有文件并校验哈希 ----
    const staged = [];
    const stagingBase = utils.resolvePath(sync.STAGING_DIR);
    const stagingDir = path.join(stagingBase, String(schemeName).replace(/[\\/:*?"<>|]/g, '_'));
    if (fs.existsSync(stagingDir)) {
        for (const f of fs.readdirSync(stagingDir)) {
            if (f.endsWith('.part')) staged.push({ part: path.join(stagingDir, f), sha256: f.slice(0, -5) });
        }
    }

    const received = new Map(); // sha256 -> partPath
    for (const s of staged) received.set(s.sha256, s.part);

    const written = [];
    const failed = [];
    const expected = sync.manifestEntries(manifest).filter(e => e.kind !== 'root' && e.kind !== 'core');

    for (const e of expected) {
        // 已就位的（check 阶段判定哈希一致）不重复处理
        if (fs.existsSync(path.join(dir, e.path))) {
            const local = await sync.sha256File(path.join(dir, e.path));
            if (local === e.sha256) { written.push({ path: e.path, source: 'already_present' }); continue; }
        }
        const part = received.get(e.sha256);
        if (!part) {
            failed.push({ path: e.path, reason: '执行端未收到该文件' });
            continue;
        }
        // 收到的内容重新算哈希（不信任上传时声明）
        const actual = await sync.sha256File(part);
        if (actual !== e.sha256) {
            failed.push({ path: e.path, reason: '哈希不匹配，传输损坏' });
            continue;
        }
        // 大小与类型再核一遍（防御：staging 被塞了清单外的文件）
        if (!sync.isPathAllowed(e.path)) {
            failed.push({ path: e.path, reason: '路径不在白名单内' });
            continue;
        }
        const st = fs.statSync(part);
        if (st.size !== e.size) {
            failed.push({ path: e.path, reason: `大小不匹配（清单 ${e.size}，实际 ${st.size}）` });
            continue;
        }
        try {
            fs.ensureDirSync(path.dirname(path.join(dir, e.path)));
            fs.moveSync(part, path.join(dir, e.path), { overwrite: true });
            written.push({ path: e.path, source: 'uploaded' });
        } catch (err) {
            failed.push({ path: e.path, reason: `落盘失败: ${err.message}` });
        }
    }

    // ---- 2. 方案骨架（幂等）：无论有没有核心都要有，后续写文件才有锚点 ----
    const ClientClone = require('./client_clone');
    const SchemeManager = require('./scheme_manager');
    const sm = new SchemeManager();
    if (!sm._schemeExists(schemeName)) {
        const skel = ClientClone.createSkeleton({
            name: schemeName,
            mcVersion: manifest.mc_version,
            loader: manifest.loader,
            type: manifest.type || manifest.loader,
            source: 'sync',
            sourcePath: opts.sourceLabel || 'sync',
            schemeManager: sm
        });
        if (!skel.ok) return { ok: false, reason: `建骨架失败: ${skel.reason}` };
        slog(`方案 ${schemeName} 骨架已创建`);
    }

    // ---- 3. 核心装配（走 installer，与 scheme create 共用） ----
    let coreResult = { action: 'skip' };
    if (manifest.core) {
        slog(`方案 ${schemeName} 开始装配核心：${manifest.type} ${manifest.mc_version}`);
        try {
            const Installer = require('./installer');
            const inst = new Installer();
            const corePath = await inst.install(
                manifest.type || manifest.loader,
                manifest.mc_version,
                manifest.loader_version || null,
                dir
            );
            if (!corePath || !fs.existsSync(corePath)) throw new Error('装配流程未产出核心文件');
            const coreRel = path.relative(dir, corePath).split(path.sep).join('/');
            const coreHash = await sync.sha256File(corePath);

            // 清单里带了控制端核心哈希：执行端装配出来的与控制端的不必一致
            // （不同平台构建），只要存在即可 —— 记录实际值供排障。
            coreResult = { action: 'installed', file: coreRel, sha256: coreHash, matches_control: manifest.core.sha256 === coreHash };
            slog(`核心装配完成: ${coreRel}`);
        } catch (e) {
            coreResult = { action: 'failed', reason: e.message };
            failed.push({ path: manifest.core.file, reason: `核心装配失败: ${e.message}` });
        }
    }

    // ---- 3. server.properties / eula.txt（默认不覆盖，--with-config 才覆盖且先备份） ----
    const configResult = [];
    const propsPath = path.join(dir, 'server.properties');
    const eulaPath = path.join(dir, 'eula.txt');

    if (manifest.with_config && manifest.root_files) {
        for (const name of ['server.properties', 'eula.txt']) {
            const entry = manifest.root_files[name];
            if (!entry) continue;
            const part = received.get(entry.sha256);
            if (!part) {
                // 本次没有上传该文件：若执行端已有同名文件则视为已就位，不算失败
                const target0 = path.join(dir, name);
                if (fs.existsSync(target0)) {
                    configResult.push({ file: name, action: 'already_present' });
                    continue;
                }
                failed.push({ path: name, reason: '执行端未收到该文件' });
                continue;
            }
            const actual = await sync.sha256File(part);
            if (actual !== entry.sha256) { failed.push({ path: name, reason: '哈希不匹配' }); continue; }
            const target = path.join(dir, name);
            try {
                if (fs.existsSync(target)) {
                    fs.copyFileSync(target, `${target}.bak`);   // 覆盖前备份
                    configResult.push({ file: name, action: 'overwritten_with_backup' });
                } else {
                    configResult.push({ file: name, action: 'created' });
                }
                fs.moveSync(part, target, { overwrite: true });
            } catch (err) {
                failed.push({ path: name, reason: `写入失败: ${err.message}` });
            }
        }
    }

    // 默认情况：执行端生成默认模板，但不覆盖已有的
    const plat = ClientClone.fillPlatformDefaults({
        schemePath: dir,
        mcVersion: manifest.mc_version,
        type: manifest.type || manifest.loader,
        schemeManager: sm
    });

    // ---- 4. 更新 scheme.yaml 与入池 ----
    const meta = sm._loadSchemeMeta(schemeName);

    // 核心
    if (coreResult.action === 'installed') {
        try {
            const coreAbs = path.join(dir, coreResult.file);
            const hash = await sync.sha256File(coreAbs);
            if (!sm._isResourceInPool(hash)) {
                await sm._addToPool(coreAbs, 'cores', `${manifest.type}/${manifest.mc_version}`, hash, coreResult.file);
            } else {
                sm._incrementRefCount(hash);
            }
            meta.resources.core = {
                file: coreResult.file, hash, in_pool: true,
                pool_path: sm._getPoolPathByHash(hash)
            };
        } catch (e) {
            failed.push({ path: coreResult.file, reason: `核心入池失败: ${e.message}` });
        }
    }

    // 模组 / 插件 / 其它文件入池
    const normLoader = String(manifest.loader || manifest.type || 'vanilla').toLowerCase();
    for (const e of expected) {
        const abs = path.join(dir, e.path);
        if (!fs.existsSync(abs)) continue;
        const top = e.path.split('/')[0];
        if (top !== 'mods' && top !== 'plugins') continue;
        try {
            const hash = await sync.sha256File(abs);
            if (!sm._isResourceInPool(hash)) {
                await sm._addToPool(abs, top, `${top === 'mods' ? normLoader : 'plugins'}/${manifest.mc_version}`, hash, path.basename(e.path));
            } else {
                sm._incrementRefCount(hash);
            }
        } catch (err) {
            failed.push({ path: e.path, reason: `入池失败: ${err.message}` });
        }
    }

    // 记录模组清单（与 create() 相同的结构）
    meta.resources.mods = [];
    for (const f of sync.listFilesRecursively(path.join(dir, 'mods'))) {
        if (!f.rel.toLowerCase().endsWith('.jar')) continue;
        try {
            const hash = await sync.sha256File(path.join(dir, f.rel));
            meta.resources.mods.push({
                file: path.basename(f.rel), hash, in_pool: sm._isResourceInPool(hash),
                pool_path: sm._getPoolPathByHash(hash),
                mod_name: path.basename(f.rel, '.jar'), version: 'unknown'
            });
        } catch (e) { /* 读不了就跳过 */ }
    }

    meta.state = 'full';
    meta.sync_source = opts.sourceLabel || 'sync';
    meta.synced_at = new Date().toISOString();
    meta.sync_report = {
        files_written: written.length,
        files_failed: failed.length,
        failed_list: failed,
        core: coreResult,
        config_files: configResult,
        platform: plat,
        with_world: !!manifest.with_world,
        with_config: !!manifest.with_config
    };
    sm._saveSchemeMeta(schemeName, meta);

    // ---- 5. 清理 staging（已 move 的自动消失，残留的失败文件留着供排障） ----
    try {
        const remaining = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir).length : 0;
        if (remaining === 0) fs.removeSync(stagingDir);
    } catch (e) {}

    return {
        ok: failed.filter(f => !String(f.reason).includes('核心装配')).length === 0 || written.length > 0,
        schemeName: schemeName,
        written,
        failed,
        core: coreResult,
        config: configResult,
        platform: plat,
        state: 'full'
    };
}

// ==================== 路由注册 ====================

/**
 * 把 sync 端点挂到 Express app 上（由 web_service.js 在 authMiddleware 之后调用，
 * 因此三个端点自动继承 JWT 认证）。
 */
function registerSyncRoutes(app) {
    // 阶段内进度（内存态，重启即丢 —— 控制端会走哈希比对重新判断，无碍）
    const syncSessions = new Map(); // schemeName -> { bytes_received, files_done, started_at }

    /** 阶段一：清单预检 */
    app.post('/api/sync/check', express.json({ limit: '12mb' }), async (req, res) => {
        try {
            const r = await processManifest(req.body, { sourceLabel: req.body && req.body.sync_source });
            if (!r.ok) return res.status(400).json({ success: false, error: r.reason });
            if (r.conflicts.length > 0) {
                return res.status(409).json({ success: false, conflicts: r.conflicts });
            }
            if (!syncSessions.has(r.schemeKey)) {
                syncSessions.set(String(req.body.name || ''), {
                    bytes_received: 0,
                    started_at: new Date().toISOString()
                });
            }
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(500).json({ success: false, error: `预检异常: ${e.message}` });
        }
    });

    /** 断点续传：查某文件已收到多少字节 */
    app.get('/api/sync/upload/status', async (req, res) => {
        try {
            const { name, sha256 } = req.query;
            if (!name || !sha256) return res.status(400).json({ success: false, error: '缺少 name 或 sha256' });
            const dir = schemeDirOf(name);
            if (!dir) return res.status(400).json({ success: false, error: '方案名不合法' });
            const part = stagingFor(name, String(sha256));
            res.json({ success: true, received: sync.receivedBytes(part) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** 阶段三：文件上传。支持两种模式：
     *   A. 分块（大文件）：fields: scheme, path, sha256, offset, total_size, chunk(二进制)
     *   B. JSON 束（小文件）：body JSON: { scheme, files: [{path, sha256, size, content_base64}] }
     */
    app.post('/api/sync/upload', async (req, res) => {
        const contentType = req.headers['content-type'] || '';

        // ---- B. JSON 束 ----
        if (contentType.includes('application/json')) {
            try {
                const body = req.body || {};
                const scheme = String(body.scheme || '');
                const files = Array.isArray(body.files) ? body.files : [];
                if (!files.length) return res.status(400).json({ success: false, error: 'files 为空' });

                // 会话总量
                const sess = syncSessions.get(scheme) || { bytes_received: 0 };
                const accepted = [], rejected = [];
                for (const f of files) {
                    const v = validateUploadTarget(scheme, f.path, f.size, sess.bytes_received + (f.size || 0));
                    if (!v.ok) { rejected.push({ path: f.path, reason: v.reason }); continue; }
                    const buf = Buffer.from(String(f.content_base64 || ''), 'base64');
                    const actual = sync.sha256Buf(buf);
                    if (actual !== f.sha256) {
                        rejected.push({ path: f.path, reason: '哈希不匹配，传输损坏，请重传' });
                        continue;
                    }
                    if (buf.length !== f.size) {
                        rejected.push({ path: f.path, reason: '大小不匹配' });
                        continue;
                    }
                    // 统一进 staging：finalize 是唯一往方案目录写文件的地方，
                    // 这样 server.properties 的「覆盖前备份」语义才不会被绕过。
                    const part = stagingFor(scheme, f.sha256);
                    fs.writeFileSync(part, buf);
                    sess.bytes_received += buf.length;
                    accepted.push(f.path);
                }
                syncSessions.set(scheme, sess);
                return res.json({ success: true, accepted, rejected });
            } catch (e) {
                return res.status(500).json({ success: false, error: `束处理异常: ${e.message}` });
            }
        }

        // ---- A. 分块上传（multipart）----
        const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!m) return res.status(400).json({ success: false, error: '应为 multipart/form-data 或 application/json' });
        const boundary = m[1] || m[2];

        const MAX_BODY = sync.CHUNK_SIZE + 2 * 1024 * 1024; // 分块本体 + multipart 开销
        const chunks = [];
        let total = 0, aborted = false;

        req.on('data', (c) => {
            total += c.length;
            if (total > MAX_BODY) {
                aborted = true;
                res.status(413).json({ success: false, error: '分块过大' });
                req.destroy();
                return;
            }
            chunks.push(c);
        });

        req.on('end', async () => {
            if (aborted) return;
            try {
                const parseMultipart = require('./web_service').parseMultipart;
                const parsed = parseMultipart(Buffer.concat(chunks), boundary);
                const get = (k, d = '') => parsed.fields[k] !== undefined ? parsed.fields[k] : d;
                const scheme = String(get('scheme'));
                const relPath = String(get('path'));
                const sha256 = String(get('sha256'));
                const offset = parseInt(get('offset', '0'), 10) || 0;
                const declaredTotal = parseInt(get('total_size', '0'), 10) || 0;
                const fileField = (parsed.files || []).find(f => f.fieldName === 'chunk');

                const v = validateUploadTarget(scheme, relPath, declaredTotal, (syncSessions.get(scheme) || { bytes_received: 0 }).bytes_received + declaredTotal);
                if (!v.ok) return res.status(v.status).json({ success: false, error: v.reason });

                if (!fileField) return res.status(400).json({ success: false, error: '缺少 chunk 字段' });
                const chunkBuf = fileField.buffer !== undefined ? fileField.buffer : fileField.data;

                const part = stagingFor(scheme, sha256);
                const expectedOffset = sync.receivedBytes(part);
                if (offset !== expectedOffset) {
                    // 断点不连续：告诉控制端该从哪续传
                    return res.status(409).json({
                        success: false,
                        error: '分块偏移不连续',
                        expected_offset: expectedOffset
                    });
                }

                fs.ensureDirSync(path.dirname(part));
                fs.appendFileSync(part, chunkBuf);

                const sess = syncSessions.get(scheme) || { bytes_received: 0, started_at: new Date().toISOString() };
                sess.bytes_received += chunkBuf.length;
                syncSessions.set(scheme, sess);

                const received = sync.receivedBytes(part);
                const done = declaredTotal > 0 && received >= declaredTotal;
                if (done) {
                    // 整文件收齐：立刻校验哈希
                    const actual = await sync.sha256File(part);
                    if (actual !== sha256) {
                        fs.removeSync(part);
                        return res.status(422).json({
                            success: false, error: '传输损坏，请重传',
                            expected_offset: 0, complete: false
                        });
                    }
                }

                res.json({ success: true, received, complete: done });
            } catch (e) {
                res.status(500).json({ success: false, error: `分块处理异常: ${e.message}` });
            }
        });

        req.on('error', (e) => {
            if (!aborted) res.status(500).json({ success: false, error: `上传中断: ${e.message}` });
        });
    });

    /** 阶段四：组装 */
    app.post('/api/sync/finalize', express.json({ limit: '12mb' }), async (req, res) => {
        try {
            const manifest = req.body;
            if (!manifest || ![1, 2].includes(manifest.protocol)) {
                return res.status(400).json({ success: false, error: '清单协议版本不支持' });
            }
            const r = await finalizeScheme(manifest, {
                sourceLabel: req.body.sync_source || 'sync'
            });
            if (!r.ok) return res.status(500).json({ success: false, error: r.reason, report: r });
            res.json({ success: true, report: r });
        } catch (e) {
            res.status(500).json({ success: false, error: `组装异常: ${e.message}` });
        }
    });

    return app;
}

module.exports = {
    registerSyncRoutes,
    processManifest,
    finalizeScheme,
    validateUploadTarget,
    stagingFor
};
