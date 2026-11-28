/**
 * 客户端一键克隆为方案（V4，极简版）
 * ----------------------------------------------------------------
 * 规则一句话：**用户说是什么，就是什么。**
 *
 * V3 那一版试图从 versions/*.json、mods 的 jar 元数据里"猜"出版本和加载器。
 * 猜得中很省事，猜不中就造出一个核心错配的方案——用户看到的是一堆无法归因的
 * 报错。V4 把这段全删了：版本和类型由用户指定，本模块只做四件事：
 *
 *   1. 建方案骨架（走 scheme create 同一套 scheme.yaml 逻辑）
 *   2. 把 mods / config / kubejs 等白名单目录原样复制过来
 *   3. 按内置名单把仅供客户端使用的模组移进 mods-disabled/
 *   4. 按用户指定的类型与版本，走 installer 装配服务端核心
 *
 * 三条硬约束：
 *   - **不嗅探**：不读 versions/、不解析 jar 元数据、不判断实例结构；
 *   - **不自动删除**：客户端模组是"移走"，不是删除；
 *   - **关键步骤失败即回滚**：删掉刚建的 scheme/<name>/，不留半残方案。
 *
 * 只依赖 Node 标准库 + 项目已有的 fs-extra / yaml。
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

const utils = require('./utils');
const config = require('./config');
const { logger } = require('./log');

// ==================== 常量 ====================

/** 白名单：只复制这几棵子树，其余（assets/libraries/versions/日志…）一律不看 */
const KEEP_DIRS = new Set([
    'mods', 'config', 'defaultconfigs',
    'kubejs', 'scripts', 'datapacks'
]);

/**
 * 复制失败时「必须中止」的关键路径判定。
 * 口径按需求原文：level.dat、mods/*.jar、config/ 下任意文件。
 */
function isCriticalPath(relPath) {
    const rel = relPath.split(path.sep).join('/');
    if (rel === 'world/level.dat') return true;
    if (rel.startsWith('mods/') && /\.jar$/i.test(rel)) return true;
    // config/ 下的任意文件（含 config/ 直属文件）
    if (/^config\//.test(rel)) return true;
    return false;
}

// ==================== 交互句柄 ====================

/**
 * 交互上下文。默认「非交互」：所有提问都返回预设的默认答案，
 * 这样测试与「全部用默认值」的批处理都能跑，不需要真的挂在 TTY 上。
 */
function makeSilentIO(answers = {}) {
    const asked = [];
    return {
        asked,
        interactive: false,
        async ask(question, defaultValue = '') {
            asked.push({ question, defaultValue });
            return defaultValue;
        },
        async choose(question, options, defaultIndex = 0) {
            asked.push({ question, options, defaultIndex });
            return options[defaultIndex];
        },
        log(msg) { console.log(msg); },
        warn(msg) { console.warn(msg); }
    };
}

/** 真实终端交互（仅在 TTY 且用户没给 --yes 时使用） */
function makeTerminalIO() {
    // 走 stdin_session 而不是自建 readline：本函数在「非 REPL 的独立运行」
    // 场景下才会被选中，但仍可能有别的消费者（例如扩展确认框）在场。
    // 由单例统一裁决谁先用，比各自 createInterface 安全。
    const stdinSession = require('./stdin_session');
    let lease = null;
    /** 懒申请：真正要提问时才占住 stdin，不提问就不占用 */
    const ensure = async () => {
        if (!lease) lease = await stdinSession.claim('client_clone.terminal');
        return lease;
    };
    return {
        interactive: true,
        get _rl() { return lease ? lease.rl : null; },
        async ask(question, defaultValue = '') {
            const l = await ensure();
            const ans = await l.question(question);
            const v = String(ans || '').trim();
            return v === '' ? defaultValue : v;
        },
        /** options 为 [{label, value}]，返回选中的 value */
        async choose(question, options, defaultIndex = 0) {
            console.log(question);
            options.forEach((o, i) => {
                const mark = i === defaultIndex ? '（默认）' : '';
                console.log(`   ${i + 1}) ${o.label}${mark}`);
            });
            const l = await ensure();
            const ans = await l.question(`请输入编号 (默认: ${defaultIndex + 1}): `);
            const n = parseInt(String(ans).trim(), 10);
            if (isNaN(n) || n < 1 || n > options.length) return options[defaultIndex].value;
            return options[n - 1].value;
        },
        log(msg) { console.log(msg); },
        warn(msg) { console.warn(msg); },
        async close() {
            if (lease) { const l = lease; lease = null; await l.release(); }
        }
    };
}

// ==================== 第 0 步：定位实例 ====================

/**
 * 展开用户输入的路径：~、~/、去转义、去引号、去尾部斜杠。
 * 终端拖拽文件常见的两种脏数据：
 *   macOS 会把空格转成 `\ `，Linux 文件管理器有时会带上 `file://`
 */
function expandPath(raw) {
    let p = String(raw == null ? '' : raw).trim();
    if (!p) return '';
    // 去掉包裹的引号
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
        p = p.slice(1, -1);
    }
    // file:// 前缀
    if (/^file:\/\//i.test(p)) {
        try { p = decodeURIComponent(p.replace(/^file:\/\//i, '')); } catch (e) { p = p.replace(/^file:\/\//i, ''); }
    }
    // 终端转义：`\ ` → 空格，`\(` → `(` 等
    p = p.replace(/\\(.)/g, '$1');
    // ~ 展开
    if (p === '~') p = os.homedir();
    else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
    // Windows 盘符路径在 Linux 上没法解析，原样返回让上层报错
    return path.normalize(p);
}

// ==================== 方案名校验 ====================

/**
 * 校验方案名。规则与 scheme create 一致：
 * 不含路径分隔符、不含 Windows 保留字符、非空、不以点结尾。
 */
function validateSchemeName(name) {
    const n = String(name == null ? '' : name).trim();
    if (!n) return { ok: false, reason: '方案名不能为空' };
    if (n.length > 64) return { ok: false, reason: '方案名过长（最多 64 字符）' };
    if (/[\\/:*?"<>|]/.test(n)) return { ok: false, reason: '方案名不能包含 \\ / : * ? " < > |' };
    if (/[\x00-\x1f]/.test(n)) return { ok: false, reason: '方案名不能包含控制字符' };
    if (n.startsWith('.')) return { ok: false, reason: '方案名不能以点开头' };
    if (/[. ]$/.test(n)) return { ok: false, reason: '方案名不能以点或空格结尾' };
    // Windows 保留名
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) {
        return { ok: false, reason: `「${n}」是 Windows 保留名` };
    }
    return { ok: true, value: n };
}

// ==================== 第 1 步：建方案骨架 ====================

/**
 * 建一个空壳方案：目录 + scheme.yaml（state: partial）+ 基础子目录。
 *
 * 刻意不调用 scheme.create()：那个方法会立刻去下载核心，而本流程的核心装配
 * 在第 3 步单独做（且需要先复制模组、处理存档）。但目录结构、scheme.yaml 字段、
 * 默认文件生成全部复用 SchemeManager 的方法，保证产物与 create() 一致。
 *
 * @param {object} opts
 *   name, mcVersion, loader, type, sourcePath, schemeManager
 * @returns {{ok:boolean, reason?:string, schemePath?:string, meta?:object}}
 */
function createSkeleton(opts = {}) {
    const { name, mcVersion, loader, type, sourcePath } = opts;
    const sm = opts.schemeManager;

    const check = validateSchemeName(name);
    if (!check.ok) return { ok: false, reason: check.reason };

    if (sm._schemeExists(name)) {
        return { ok: false, reason: `方案 ${name} 已存在，请换一个名字（wow scheme list 可查看）` };
    }
    if (fs.existsSync(sm._getSchemePath(name))) {
        return { ok: false, reason: `目录 scheme/${name} 已存在但没有 scheme.yaml，请先手动处理` };
    }

    const schemePath = sm._getSchemePath(name);
    const created = [];
    try {
        fs.ensureDirSync(schemePath);
        created.push(schemePath);
        for (const sub of ['mods', 'config', 'logs', 'world', 'plugins']) {
            fs.ensureDirSync(path.join(schemePath, sub));
        }

        const now = new Date().toISOString();
        const meta = {
            name,
            version: mcVersion,
            loader: loader || type || 'vanilla',
            type: type || loader || 'vanilla',
            build: null,
            state: 'partial',
            source: opts.source || 'clone-client',
            source_path: sourcePath || null,
            created_at: now,
            updated_at: now,
            compatibility: {
                java: sm._getRequiredJava(mcVersion),
                loaders: [loader || type || 'vanilla']
            },
            resources: {
                core: { file: null, hash: null, in_pool: false, pool_path: null },
                mods: [],
                plugins: []
            },
            unique_resources: [],
            world: { exists: false, size: 0 },
            clone_report: null
        };
        sm._saveSchemeMeta(name, meta);
        return { ok: true, schemePath, meta };
    } catch (e) {
        // 建骨架本身失败也要清干净
        try { if (fs.existsSync(schemePath)) fs.removeSync(schemePath); } catch (e2) {}
        return { ok: false, reason: `创建方案目录失败: ${e.message}` };
    }
}

// ==================== 第 2 步：白名单复制 ====================

/**
 * 第 2 步：白名单复制。
 *
 * 只搬 KEEP_DIRS 里那几棵子树，其余一律不看。
 * 不再判断「这是版本隔离目录还是游戏根目录」——那正是上一版最脆的地方：
 * 一旦猜错，用户会看到「已复制 1 个文件」而模组一个没进来。
 *
 * @param {object} opts srcDir, destDir, io
 * @returns {{copied:number, skipped:Array, failed:Array, critical:Array, permissionFailed:Array, bytes:number}}
 */
function copyWhitelisted(opts = {}) {
    const { srcDir, destDir } = opts;
    const io = opts.io || makeSilentIO();
    const result = { copied: 0, skipped: [], failed: [], critical: [], permissionFailed: [], bytes: 0 };

    if (!fs.existsSync(srcDir)) return result;

    for (const name of KEEP_DIRS) {
        const src = path.join(srcDir, name);
        const dest = path.join(destDir, name);
        if (!fs.existsSync(src)) {
            result.skipped.push({ path: name, reason: '客户端没有该目录' });
            continue;
        }
        try {
            result.copied += copyTreeInto(src, dest, result, name);
        } catch (e) {
            const entry = { path: name, reason: e.message };
            result.failed.push(entry);
            result.critical.push(entry);
            io.warn(`   ⚠️ 复制失败: ${name} —— ${e.message}`);
        }
    }
    return result;
}

/** 递归复制一棵子树：单个文件失败只记账，不中断整棵树 */
function copyTreeInto(src, dest, result, baseRel) {
    fs.ensureDirSync(dest);
    let n = 0;
    for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name);
        const d = path.join(dest, name);
        const rel = path.join(baseRel, name);
        let st;
        try { st = fs.lstatSync(s); } catch (e) { result.failed.push({ path: rel, reason: e.message }); continue; }
        if (st.isSymbolicLink()) { result.skipped.push({ path: rel, reason: '符号链接跳过' }); continue; }
        if (st.isDirectory()) { n += copyTreeInto(s, d, result, rel); continue; }
        if (!st.isFile()) continue;
        try {
            fs.copySync(s, d, { overwrite: true });
            n++;
            result.bytes += st.size;
        } catch (e) {
            const entry = { path: rel, reason: e.message };
            if (/EACCES|permission denied/i.test(e.message)) result.permissionFailed.push(entry);
            else if (isCriticalPath(rel)) result.critical.push(entry);
            result.failed.push(entry);
        }
    }
    return n;
}
// ==================== 第 3 步：核心装配 ====================

/**
 * 第 3 步：走 installer 模块装配服务端核心（与 scheme create 同一套逻辑）。
 *
 * @param {object} opts
 *   schemePath, type, mcVersion, loaderVersion, installer
 * @returns {Promise<{ok:boolean, reason?:string, corePath?:string, coreRel?:string, renamed?:Array}>}
 */
async function installCore(opts = {}) {
    const { schemePath, type, mcVersion, loaderVersion } = opts;
    const installer = opts.installer;
    if (!installer) return { ok: false, reason: '内部错误：未提供 installer' };

    // V3.6.2：创建方案统一「优先找 pool」——池里已有同 type/version 的单文件核心
    // 就直接复用，不再下载。安装器型（forge 等）由该方法内部拒绝，仍走安装器。
    if (opts.schemeManager && typeof opts.schemeManager.materializePoolCore === 'function') {
        const pooled = opts.schemeManager.materializePoolCore(type, mcVersion, schemePath);
        if (pooled) {
            console.log(`♻️  复用 pool 中的核心: ${pooled.coreRel}，跳过下载`);
            return { ok: true, corePath: pooled.corePath, coreRel: pooled.coreRel, reused: true };
        }
    }

    let corePath;
    try {
        // 与 SchemeManager.create() 完全同一条路径：
        //   - vanilla / paper / ... → 直连下载
        //   - forge / neoforge / fabric / quilt → _installModLoader 跑官方安装器
        corePath = await installer.install(type, mcVersion, loaderVersion || null, schemePath);
    } catch (e) {
        return { ok: false, reason: e.message };
    }

    if (!corePath || !fs.existsSync(corePath)) {
        return { ok: false, reason: '核心装配流程未产出可用的核心文件' };
    }

    const coreRel = path.relative(schemePath, corePath).split(path.sep).join('/');
    return { ok: true, corePath, coreRel };
}

// ==================== 第 4 步：存档迁移 ====================

/** 列出客户端存档（只认含 level.dat 的目录） */
function listSaves(savesDir) {
    const out = [];
    if (!fs.existsSync(savesDir)) return out;
    let entries = [];
    try { entries = fs.readdirSync(savesDir); } catch (e) { return out; }
    for (const name of entries.sort()) {
        const dir = path.join(savesDir, name);
        try {
            if (!fs.statSync(dir).isDirectory()) continue;
        } catch (e) { continue; }
        const levelDat = path.join(dir, 'level.dat');
        if (!fs.existsSync(levelDat)) continue;
        let size = 0;
        try { size = fs.statSync(levelDat).size; } catch (e) {}
        out.push({ name, dir, hasLevelDat: true, levelDatSize: size });
    }
    return out;
}

/**
 * 第 4 步：把一个存档搬进 world/。
 *
 * @param {object} opts
 *   savesDir, worldDir, saveName('' = 不迁移)
 * @returns {{ok:boolean, reason?:string, migrated:boolean, saveName?:string, copied:number, sessionLockRemoved:boolean}}
 */
function migrateWorld(opts = {}) {
    const { savesDir, worldDir, saveName } = opts;
    const out = { ok: true, migrated: false, copied: 0, sessionLockRemoved: false };

    if (!saveName) return out;

    const src = path.join(savesDir, saveName);
    if (!fs.existsSync(src)) return { ok: false, reason: `存档不存在: ${src}`, migrated: false, copied: 0, sessionLockRemoved: false };

    // world/ 是骨架里建好的空目录；如果已经有内容（比如客户端根目录里自带 world/），
    // 先把它挪到 world.pre-clone.bak 留档，而不是删除或覆盖。
    if (fs.existsSync(worldDir)) {
        let hasContent = false;
        try { hasContent = fs.readdirSync(worldDir).length > 0; } catch (e) {}
        if (hasContent) {
            const bak = path.join(path.dirname(worldDir), `world.pre-clone-${Date.now()}.bak`);
            try { fs.moveSync(worldDir, bak, { overwrite: false }); } catch (e) {
                return { ok: false, reason: `已有 world/ 无法挪开: ${e.message}`, migrated: false, copied: 0, sessionLockRemoved: false };
            }
        }
    }
    fs.ensureDirSync(worldDir);

    let copied = 0;
    try {
        copied = copyTree(src, worldDir);
    } catch (e) {
        return { ok: false, reason: `存档复制失败: ${e.message}`, migrated: false, copied, sessionLockRemoved: false };
    }

    // session.lock 是单机客户端运行时锁，服务端启动会自己重建，
    // 带着它进去会让服务端直接报「世界已被锁定」。
    const lock = path.join(worldDir, 'session.lock');
    let removed = false;
    if (fs.existsSync(lock)) {
        try { fs.removeSync(lock); removed = true; } catch (e) {}
    }

    return { ok: true, migrated: true, saveName, copied, sessionLockRemoved: removed };
}

/** 递归复制整棵树，返回复制的文件数 */
function copyTree(src, dest) {
    let n = 0;
    fs.ensureDirSync(dest);
    for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name);
        const d = path.join(dest, name);
        const st = fs.statSync(s);
        if (st.isDirectory()) {
            n += copyTree(s, d);
        } else if (st.isFile()) {
            fs.copySync(s, d, { overwrite: false, errorOnExist: false });
            n++;
        }
    }
    return n;
}

// ==================== 第 5 步：模组清洗 ====================

/**
 * 第 5 步：按名单剔除仅供客户端使用的模组。
 *
 * 只看文件名，不读 jar 内容。上一版会解析 mods.toml / fabric.mod.json，
 * 准是准，但要为每种加载器各写一套解析——这正是"能省几十行代码和无数个
 * 潜在 Bug"的那部分。文件名匹配对 sodium / iris / xaero 这类名字稳定的
 * 客户端模组足够用。
 *
 * 优先级：force_keep_mods > 用户扩展名单 > 内置黑名单。
 */
function cleanMods(opts = {}) {
    const modsDir = opts.modsDir;
    const disabledDir = opts.disabledDir || path.join(path.dirname(modsDir), 'mods-disabled');
    const extra = new Set((opts.extraClientMods || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));
    const keep = new Set((opts.forceKeepMods || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));

    const out = { scanned: 0, disabled: [], kept: [], errors: [] };
    if (!fs.existsSync(modsDir)) return out;

    const cmf = require('./client_mod_filter');
    const builtin = Object.keys(cmf.BUILTIN_CLIENT_MODS || {}).map(s => String(s).toLowerCase());

    let jars = [];
    try {
        jars = fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)).sort();
    } catch (e) {
        out.errors.push({ file: '', reason: e.message });
        return out;
    }
    out.scanned = jars.length;

    const tokenHit = (fileName, id) => {
        if (!id) return false;
        const base = fileName.toLowerCase().replace(/\.jar$/, '');
        return base.split(/[^a-z0-9]+/).includes(id) || base.includes(id);
    };

    for (const file of jars) {
        const base = file.replace(/\.jar$/i, '');
        const modId = base.split(/[^A-Za-z0-9]+/)[0] || base;

        let reason = '';
        if (Array.from(keep).some(id => tokenHit(file, id))) {
            out.kept.push({ file, modId, reason: 'force_keep_mods 强制保留' });
            continue;
        }
        if (Array.from(extra).some(id => tokenHit(file, id))) {
            reason = '用户扩展名单';
        } else {
            const hit = builtin.find(id => tokenHit(file, id));
            if (hit) reason = `内置黑名单（${hit}）`;
        }

        if (!reason) {
            out.kept.push({ file, modId, reason: '' });
            continue;
        }

        try {
            fs.ensureDirSync(disabledDir);
            let target = path.join(disabledDir, file);
            if (fs.existsSync(target)) target = path.join(disabledDir, `${base}.${Date.now()}.jar`);
            fs.moveSync(path.join(modsDir, file), target, { overwrite: false });
            out.disabled.push({ file, modId, reason, target });
        } catch (e) {
            out.errors.push({ file, reason: `移动失败: ${e.message}` });
        }
    }
    return out;
}
// ==================== 第 6 步：平台兜底 ====================

/**
 * 生成 server.properties / eula.txt / 空目录。
 * 一律「已存在就不动」—— 克隆进来的 config 可能已经包含用户调好的设置。
 */
function fillPlatformDefaults(opts = {}) {
    const { schemePath, mcVersion, type } = opts;
    const sm = opts.schemeManager;
    const out = { properties: false, eula: false, dirs: [] };

    const propsPath = path.join(schemePath, 'server.properties');
    if (!fs.existsSync(propsPath)) {
        // 复用 SchemeManager 的默认模板，再补上克隆场景需要的两个键
        let text = sm._generateDefaultProperties(mcVersion);
        if (!/^level-name=/m.test(text)) text += '\nlevel-name=world\n';
        if (!/^level-type=/m.test(text)) text += 'level-type=minecraft\\:normal\n';
        fs.writeFileSync(propsPath, text, 'utf8');
        out.properties = true;
    }

    const eulaPath = path.join(schemePath, 'eula.txt');
    if (!fs.existsSync(eulaPath)) {
        fs.writeFileSync(
            eulaPath,
            '# By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n' +
            '# Auto-generated by wow~ (clone-client)\n' +
            'eula=true\n',
            'utf8'
        );
        out.eula = true;
    }

    // 按加载器需要的空目录
    const dirs = ['logs'];
    if (['paper', 'purpur', 'spigot', 'bukkit', 'leaves', 'mohist', 'catserver'].includes(String(type).toLowerCase())) {
        dirs.push('plugins');
    }
    for (const d of dirs) {
        const p = path.join(schemePath, d);
        if (!fs.existsSync(p)) {
            fs.ensureDirSync(p);
            out.dirs.push(d);
        }
    }
    return out;
}

// ==================== 第 7 步：入池登记 ====================

/**
 * 把方案目录里的模组与核心登记进 pool，并同步写 scheme.yaml。
 *
 * 语义与 scheme.create() / _materializeScheme() 保持一致：
 *   - 文件复制进 pool，ref_count +1；
 *   - scheme.yaml 里 in_pool = true，表示「池里有备份，瘦身时可以从池里补回」。
 *
 * @returns {Promise<{mods:Array, core:object|null, errors:Array}>}
 */
async function registerToPool(opts = {}) {
    const { schemePath, name, meta, corePath, coreRel, type, mcVersion, loader } = opts;
    const sm = opts.schemeManager;
    const out = { mods: [], core: null, errors: [] };

    // ---- 核心 ----
    if (corePath && fs.existsSync(corePath)) {
        try {
            const hash = sm._computeHash(corePath);
            const rel = coreRel || path.basename(corePath);
            const inPool = sm._isResourceInPool(hash);
            if (!inPool) {
                await sm._addToPool(corePath, 'cores', `${type}/${mcVersion}`, hash, rel);
            } else {
                sm._incrementRefCount(hash);
            }
            meta.resources.core = {
                file: rel,
                hash,
                in_pool: true,
                pool_path: sm._getPoolPathByHash(hash)
            };
            out.core = { file: rel, hash, poolDir: `pool/cores/${type}/${mcVersion}` };
        } catch (e) {
            out.errors.push({ file: path.basename(corePath), reason: `核心入池失败: ${e.message}` });
        }
    }

    // ---- 模组 ----
    const modsDir = path.join(schemePath, 'mods');
    let jars = [];
    try {
        jars = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)).sort() : [];
    } catch (e) {
        out.errors.push({ file: 'mods/', reason: e.message });
    }

    const normLoader = String(loader || type || 'vanilla').toLowerCase();
    for (const file of jars) {
        const full = path.join(modsDir, file);
        try {
            const hash = sm._computeHash(full);
            if (!sm._isResourceInPool(hash)) {
                await sm._addToPool(full, 'mods', `${normLoader}/${mcVersion}`, hash, file);
            } else {
                sm._incrementRefCount(hash);
            }
            const rec = {
                file,
                hash,
                in_pool: true,
                pool_path: sm._getPoolPathByHash(hash),
                mod_name: file.replace(/\.jar$/i, ''),
                version: 'unknown'
            };
            meta.resources.mods.push(rec);
            out.mods.push(rec);
        } catch (e) {
            out.errors.push({ file, reason: `入池失败: ${e.message}` });
        }
    }

    return out;
}

// ==================== 第 8 步：报告 ====================

/**
 * 生成迁移报告（中文，可直接打印）。
 * 需求明确要求：必须列出被禁用的模组名和原因，不能只报数量。
 */
function buildReport(r) {
    const L = [];
    const sep = '─'.repeat(52);
    L.push('');
    L.push('✅ 客户端克隆为方案完成');
    L.push(sep);
    L.push(`   方案名：${r.name}（scheme/${r.name}）`);
    L.push(`   源实例：${r.instanceDir}`);
    if (r.mcVersion || r.loader) {
        const lv = r.loaderVersion ? ` ${r.loaderVersion}` : '';
        L.push(`   加载器：${(r.loader || r.type || 'vanilla')}${lv}（MC ${r.mcVersion || '未知'}）`);
    }
    if (r.guessed) {
        L.push('   ⚠️ 版本信息基于模组元数据推测，可能与实际不符');
    }
    if (r.core) {
        L.push(`   核心：${r.core.file}（已入池，pool/cores/${r.type}/${r.mcVersion}/）`);
    }
    if (r.modStats) {
        const d = r.modStats.disabled.length;
        L.push(`   模组：${r.modStats.copied || r.modStats.scanned} 个已复制并入池` + (d > 0 ? `，${d} 个已禁用（见 mods-disabled/）` : ''));
    }
    if (r.world && r.world.migrated) {
        L.push(`   存档：已迁移「${r.world.saveName}」→ world/` + (r.world.sessionLockRemoved ? '（session.lock 已删除）' : ''));
    } else if (r.world && r.world.skipped) {
        L.push('   存档：未迁移（按你的选择跳过）');
    }
    L.push(`   配置：config/ ${r.configCopied ? '已复制' : '（未找到）'}`);
    L.push(`   方案状态：${r.state || 'full'}`);

    // ---- 被禁用的模组，逐个列出 ----
    if (r.modStats && r.modStats.disabled.length > 0) {
        L.push('');
        L.push(`🧹 已禁用 ${r.modStats.disabled.length} 个仅供客户端使用的模组：`);
        for (const m of r.modStats.disabled) {
            const id = m.modId || m.file.replace(/\.jar$/i, '');
            L.push(`   - ${id}（${m.reason}）`);
        }
        L.push('   已移至 mods-disabled/，如需恢复请手动移回 mods/。');
    }

    // ---- 被强制保留的（让用户知道名单确实生效了） ----
    if (r.modStats && r.modStats.forceKept && r.modStats.forceKept.length > 0) {
        L.push('');
        L.push(`📌 按 force_keep_mods 保留 ${r.modStats.forceKept.length} 个：`);
        for (const m of r.modStats.forceKept) {
            L.push(`   - ${m.modId || m.file}`);
        }
    }

    // ---- 跳过的文件汇总 ----
    if (r.copyStats && r.copyStats.skipped.length > 0) {
        L.push('');
        L.push(`⏭️  按白名单跳过 ${r.copyStats.skipped.length} 项（客户端资源 / 缓存 / 存档等）`);
        const shown = r.copyStats.skipped.slice(0, 8);
        for (const s of shown) L.push(`   - ${s.path}`);
        if (r.copyStats.skipped.length > 8) L.push(`   …… 其余 ${r.copyStats.skipped.length - 8} 项见 docs/scheme/CLONE_CLIENT.md`);
    }
    if (r.copyStats && r.copyStats.failed.length > 0) {
        L.push('');
        L.push(`⚠️  复制失败 ${r.copyStats.failed.length} 个文件（已跳过，不影响启动）：`);
        for (const f of r.copyStats.failed.slice(0, 10)) {
            L.push(`   - ${f.path}：${f.reason}`);
        }
        if (r.copyStats.failed.length > 10) L.push(`   …… 其余 ${r.copyStats.failed.length - 10} 个`);
    }
    // V3.8.2：因系统权限（EACCES）跳过的文件单独标记，明确告知用户「这不是 wow 的 Bug」。
    if (r.copyStats && (r.copyStats.permissionFailed || []).length > 0) {
        const permSkipped = r.copyStats.permissionFailed || [];
        L.push('');
        L.push(`🔒 因系统权限跳过 ${permSkipped.length} 个文件（非 wow 问题）：`);
        for (const f of r.copyStats.permissionFailed.slice(0, 10)) {
            L.push(`   - ${f.path}`);
        }
        if (permSkipped.length > 10) L.push(`   …… 其余 ${permSkipped.length - 10} 个`);
        L.push('   👉 源文件可能属于其他用户：请用 sudo 重新运行，或 chmod -R 755 <源目录>');
    }
    if (r.poolErrors && r.poolErrors.length > 0) {
        L.push('');
        L.push(`⚠️  入池失败 ${r.poolErrors.length} 个（文件仍在方案目录，不影响启动）：`);
        for (const e of r.poolErrors.slice(0, 10)) L.push(`   - ${e.file}：${e.reason}`);
    }

    // ---- 注意事项 ----
    L.push('');
    L.push('   ⚠️ 注意：');
    L.push('      - 单机玩家数据不会自动转换，首次进服状态可能与单机不同');
    L.push('      - 部分 config/ 可能是客户端专用，如遇异常请检查');
    if (r.modStats && r.modStats.disabled.length > 0) {
        L.push(`      - ${r.modStats.disabled.length} 个模组被禁用，如确认服务端需要请手动移回`);
    }
    L.push('');
    L.push(`   下一步：wow scheme switch ${r.name} && wow server start --memory 4G`);
    L.push(sep);
    return L.join('\n');
}

// ==================== 编排 ====================

/**
 * 完整克隆流程。
 *
 * @param {object} opts
 *   clientPath      用户给的路径
 *   name            方案名（可选，空则交互询问）
 *   typeOverride    手动指定核心类型（识别失败时用）
 *   versionOverride 手动指定 MC 版本
 *   io              交互句柄
 *   dryRun          true = 只做第 0 步与检查，不创建任何东西
 *   extraClientMods / forceKeepMods
 *   saveName        '' = 不迁移存档；undefined = 交互询问
 *   skipCore        true = 不装配核心（仅测试用）
 * @returns {Promise<object>} { ok, reason?, report?, result? }
 */
async function cloneClient(opts = {}) {
    const io = opts.io || makeSilentIO();
    // schemeManager 可注入：测试用临时目录，生产走默认单例。
    // 有了它，测试不必去改 require.cache 那种脏手法。
    const SchemeManager = require('./scheme_manager');
    const injectedSM = opts.schemeManager || null;

    // ---- 第 0 步：参数（不嗅探）----
    // 放弃「猜客户端是哪个加载器 / 哪个版本」：猜错的代价（建错核心、白下几百兆）
    // 远高于让用户敲两行字。用户说了算。
    const srcDir = expandPath(opts.clientPath);
    let _stat = null;
    try { _stat = fs.statSync(srcDir); } catch (e) { /* 下面统一报错 */ }
    if (!srcDir || !_stat || !_stat.isDirectory()) {
        return { ok: false, reason: `客户端目录不存在或不是目录：${opts.clientPath}` };
    }
    const mcVersion = String(opts.mcVersion || opts.versionOverride || '').trim();
    const type = String(opts.type || opts.typeOverride || '').trim().toLowerCase();
    if (!mcVersion) return { ok: false, reason: '缺少 Minecraft 版本（--version，或交互输入）' };
    if (!type) return { ok: false, reason: '缺少服务端类型（--type，或交互选择）' };

    // 兼容旧变量名：复制源就是用户给的那个目录，不再区分实例目录 / 游戏根目录。
    const instanceDir = srcDir;
    const gameDir = srcDir;
    const loaderVersion = opts.loaderVersion || null;
    const det = { loader: type, loaderVersion, guessed: false };

    io.log(`\n📂 客户端目录：${srcDir}`);
    io.log(`   MC ${mcVersion} / ${type}（由用户指定）`);

    // ---- 方案名 ----
    let schemeName = opts.name;
    if (!schemeName) {
        const base = path.basename(srcDir).replace(/[\\/:*?"<>|]/g, '_');
        schemeName = await io.ask(`   方案名 (默认: ${base}): `, base);
    }
    const nameCheck = validateSchemeName(schemeName);
    if (!nameCheck.ok) return { ok: false, reason: `方案名不合法：${nameCheck.reason}` };
    schemeName = nameCheck.value;

    if (opts.dryRun) {
        return {
            ok: true,
            dryRun: true,
            plan: { instanceDir: srcDir, mcVersion, type, loaderVersion, schemeName, guessed: false }
        };
    }

    // ---- 第 1 步：建骨架 ----
    io.log('\n📦 第 1 步：创建方案骨架');
    const sm = injectedSM || new SchemeManager();
    const skel = createSkeleton({
        name: schemeName,
        mcVersion,
        loader: det.loader || type,
        type,
        sourcePath: instanceDir,
        schemeManager: sm
    });
    if (!skel.ok) return { ok: false, reason: skel.reason };
    const schemePath = skel.schemePath;
    const meta = skel.meta;
    io.log(`   已创建：scheme/${schemeName}（state: partial）`);

    /** 回滚：删掉刚建的方案目录。所有关键失败都走这里。 */
    const rollback = (why) => {
        try {
            if (fs.existsSync(schemePath)) fs.removeSync(schemePath);
            io.warn(`   ↩️ 已回滚：删除 scheme/${schemeName}`);
        } catch (e) {
            io.warn(`   ⚠️ 回滚失败，请手动删除 scheme/${schemeName}：${e.message}`);
        }
        return { ok: false, reason: why, rolledBack: true };
    };

    try {
        // ---- 第 2 步：白名单复制 ----
        io.log('\n📋 第 2 步：复制客户端内容（白名单）');
        // 客户端版本 jar（<实例名>.jar）是客户端启动用的，服务端不需要；
        // 而且它常常属于另一个用户 / 只读（EACCES），无谓复制只会制造失败噪声。
        const copyStats = copyWhitelisted({
            srcDir: gameDir,
            destDir: schemePath,
            io
        });
        io.log(`   复制源：${gameDir}`);
        io.log(`   已复制 ${copyStats.copied} 个文件（${(copyStats.bytes / 1024 / 1024).toFixed(1)} MB），跳过 ${copyStats.skipped.length} 项`);
        if (copyStats.copied === 0) {
            io.warn('   ⚠️ 没有复制到任何文件——请确认该目录确实是客户端实例（含 mods / config）。');
        }
        if (copyStats.critical.length > 0) {
            return rollback(
                `关键文件复制失败，已中止：` +
                copyStats.critical.map(c => `${c.path}（${c.reason}）`).join('；')
            );
        }

        // ---- 第 3 步：核心装配 ----
        if (!opts.skipCore) {
            io.log('\n⚙️  第 3 步：装配服务端核心');
            const Installer = require('./installer');
            const inst = new Installer();
            const core = await installCore({
                schemePath,
                type,
                mcVersion,
                loaderVersion,
                installer: inst,
                schemeManager: sm
            });
            if (!core.ok) return rollback(`核心装配失败：${core.reason}`);
            io.log(`   核心：${core.coreRel}`);

            // Java 检查（只提示，不自动下载 —— 下载动作交给 server start）
            try {
                const JreManager = require('./jre_manager');
                const jre = new JreManager();
                const need = jre.getRequiredJavaVersion(mcVersion);
                const scanned = utils.scanAllJava();
                const matched = utils.findJavaByMajor(need, scanned);
                if (!matched) {
                    const any = scanned.find(j => j.major != null);
                    io.warn(`   ⚠️ 需要 Java ${need}，当前为 ${any ? 'Java ' + any.major : '未检测到 Java'}`);
                    io.warn(`      可执行 wow jre install ${need} 自动下载，或首次 server start 时自动补齐`);
                } else {
                    io.log(`   Java ${need} 已就绪`);
                }
            } catch (e) { /* Java 检查失败不影响克隆 */ }

            meta._corePath = core.corePath;
            meta._coreRel = core.coreRel;
        }

        // ---- 第 4 步：存档迁移 ----
        io.log('\n🌍 第 4 步：迁移存档');
        // 同样要用游戏数据目录：版本隔离时 saves/ 在 .minecraft 根，不在 versions/<实例>/
        const savesDir = path.join(gameDir, 'saves');
        const saves = listSaves(savesDir);
        // 简化后默认不迁移存档：用户没提就不做，避免"克隆完发现 world 被换掉"。
        // 需要时用 --save <名字> 显式指定。
        let saveName = opts.saveName === undefined ? '' : opts.saveName;
        if (saveName === undefined) {
            if (saves.length === 0) {
                io.log('   客户端没有存档，跳过');
                saveName = '';
            } else if (saves.length === 1) {
                const ans = await io.choose(
                    `   找到 1 个存档「${saves[0].name}」，是否迁移？`,
                    [{ label: '迁移到 world/', value: saves[0].name }, { label: '不迁移存档', value: '' }],
                    0
                );
                saveName = ans;
            } else {
                const choices = saves.map(s => ({ label: s.name, value: s.name }));
                choices.push({ label: '不迁移存档', value: '' });
                saveName = await io.choose('   请选择要迁移的存档：', choices, 0);
            }
        }
        const world = migrateWorld({ savesDir, worldDir: path.join(schemePath, 'world'), saveName });
        if (!world.ok) return rollback(`存档迁移失败：${world.reason}`);
        if (world.migrated) {
            io.log(`   已迁移「${world.saveName}」→ world/（${world.copied} 个文件${world.sessionLockRemoved ? '，session.lock 已删除' : ''}）`);
            meta.world = { exists: true, size: 0 };
        } else {
            io.log('   未迁移存档');
            world.skipped = true;
        }

        // ---- 第 5 步：模组清洗 ----
        io.log('\n🧹 第 5 步：清洗客户端模组');
        const clean = cleanMods({
            modsDir: path.join(schemePath, 'mods'),
            disabledDir: path.join(schemePath, 'mods-disabled'),
            extraClientMods: opts.extraClientMods || [],
            forceKeepMods: opts.forceKeepMods || []
        });
        io.log(`   扫描 ${clean.scanned} 个，禁用 ${clean.disabled.length} 个`);
        for (const m of clean.disabled) {
            io.log(`      - ${m.modId || m.file}（${m.reason}）`);
        }
        for (const e of clean.errors) {
            io.warn(`   ⚠️ ${e.file}：${e.reason}`);
        }

        // ---- 第 6 步：平台兜底 ----
        io.log('\n🔧 第 6 步：生成平台文件');
        const plat = fillPlatformDefaults({ schemePath, mcVersion, type, schemeManager: sm });
        const platBits = [];
        if (plat.properties) platBits.push('server.properties');
        if (plat.eula) platBits.push('eula.txt');
        if (plat.dirs.length) platBits.push(...plat.dirs.map(d => d + '/'));
        io.log(platBits.length ? `   已生成：${platBits.join(', ')}` : '   已存在，无需生成');
        if (plat.eula) {
            io.log('   已写入 eula=true。如不同意 Minecraft EULA，请修改为 false 并删除服务器。');
        }

        // ---- 第 7 步：入池登记 ----
        io.log('\n🗄️  第 7 步：入池登记');
        const pool = await registerToPool({
            schemePath,
            name: schemeName,
            meta,
            corePath: meta._corePath,
            coreRel: meta._coreRel,
            type,
            mcVersion,
            loader: det.loader || type,
            schemeManager: sm
        });
        delete meta._corePath;
        delete meta._coreRel;
        io.log(`   模组入池 ${pool.mods.length} 个${pool.core ? '，核心已入池' : ''}`);

        // ---- 状态更新 ----
        // 需求写的是「state 从 partial 改为 full」。这里沿用项目已有的状态语义：
        // 入池后 in_pool=true 表示「池里有备份」，而 state 描述的是「方案目录里资源是否齐全」。
        // 克隆结束时目录内容齐全（核心、模组、配置都在位），所以是 full；
        // 池中存在备份用 in_pool 字段表达，两者不冲突。
        meta.state = 'full';
        meta.updated_at = new Date().toISOString();
        const disabledCount = clean.disabled.length;
        meta.clone_report = {
            source_path: instanceDir,
            cloned_at: meta.updated_at,
            mc_version: mcVersion,
            loader: det.loader || type,
            loader_version: loaderVersion || null,
            guessed: det.guessed,
            mods_total: pool.mods.length,
            mods_disabled: disabledCount,
            disabled_list: clean.disabled.map(m => ({ file: m.file, modId: m.modId, reason: m.reason })),
            world: world.migrated ? world.saveName : null,
            copy_failed: copyStats.failed.length
        };
        sm._saveSchemeMeta(schemeName, meta);

        // ---- 第 8 步：报告 ----
        const report = buildReport({
            name: schemeName,
            instanceDir,
            mcVersion,
            type,
            loader: det.loader || type,
            loaderVersion,
            guessed: det.guessed,
            core: pool.core,
            modStats: {
                scanned: clean.scanned,
                copied: clean.scanned - disabledCount,
                disabled: clean.disabled,
                forceKept: clean.kept.filter(k => k.reason)
            },
            world,
            configCopied: fs.existsSync(path.join(schemePath, 'config')),
            copyStats,
            poolErrors: pool.errors,
            state: 'full'
        });

        try {
            logger.info(`客户端克隆为方案 ${schemeName}：${pool.mods.length} 模组，禁用 ${disabledCount} 个，源 ${instanceDir}`);
        } catch (e) {}

        return { ok: true, report, result: { schemeName, schemePath, meta, clean, pool, copyStats, world } };
    } catch (e) {
        return rollback(`克隆过程异常：${e.message}`);
    }
}

module.exports = {
    // 常量
    KEEP_DIRS,
    // 工具
    expandPath,
    isCriticalPath,
    validateSchemeName,
    makeSilentIO,
    makeTerminalIO,
    // 各步骤（可单独测试）
    createSkeleton,
    copyWhitelisted,
    copyTreeInto,
    installCore,
    listSaves,
    migrateWorld,
    cleanMods,
    fillPlatformDefaults,
    registerToPool,
    buildReport,
    // 编排
    cloneClient
};
