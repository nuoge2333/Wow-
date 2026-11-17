/**
 * 资源入池安装器（Fetch to Pool）
 *
 * 职责边界（与 install 命令的核心定位一致）：
 *   - 只做「下载资源到公共池」：核心 / 模组 / 插件落盘到 core/pool/<分类>/；
 *   - 计算 SHA-256，登记到 pool/index.yaml，初始引用数为 0；
 *   - 绝不写 scheme/ —— 创建方案是 `scheme create` 的职责（进货 vs 开店）。
 *
 * 与 scheme_manager._addToPool 的区别：那个方法服务于「创建方案时把已有资源
 * 纳入方案」，会把 ref_count +1；本模块是纯进货，资源进池后尚无任何方案引用，
 * 因此 ref_count 固定为 0（已存在且被引用的资源保留原计数，绝不重置）。
 */

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const utils = require('./utils');

/** pool 根目录（core/pool） */
function poolRoot() {
    return utils.getPoolPath();
}

/** index.yaml 绝对路径 */
function indexPath() {
    return path.join(poolRoot(), 'index.yaml');
}

/** 读取池索引，损坏/缺失时返回空结构 */
function loadIndex() {
    const p = indexPath();
    if (fs.existsSync(p)) {
        try {
            const yaml = require('js-yaml');
            const data = yaml.load(fs.readFileSync(p, 'utf8'));
            if (data && typeof data === 'object') {
                return {
                    resources: data.resources && typeof data.resources === 'object' ? data.resources : {},
                    ref_count: data.ref_count && typeof data.ref_count === 'object' ? data.ref_count : {}
                };
            }
        } catch (e) { /* 索引损坏，按空索引重建 */ }
    }
    return { resources: {}, ref_count: {} };
}

/** 写回池索引（与 scheme_manager 同款 yaml 格式，保证互相兼容） */
function saveIndex(idx) {
    const yaml = require('js-yaml');
    fs.ensureDirSync(poolRoot());
    fs.writeFileSync(indexPath(), yaml.dump(idx, { indent: 2, lineWidth: -1 }), 'utf8');
}

/** 流式计算文件 SHA-256，避免大核心整文件读入内存 */
function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const rs = fs.createReadStream(filePath);
        rs.on('data', (chunk) => h.update(chunk));
        rs.on('error', reject);
        rs.on('end', () => resolve(h.digest('hex')));
    });
}

/**
 * 把一个已落盘到 pool 的文件登记进 index.yaml。
 * - 计算 SHA-256 作为 key；
 * - resources[hash] = 相对 pool 根的路径（统一用 '/'）；
 * - ref_count[hash] 初始为 0；已存在的引用计数原样保留（绝不重置）。
 * @param {string} absPath 文件绝对路径（须已在 pool 目录内）
 * @param {{rel?:string}} [opts] rel 可显式指定相对路径，缺省按 absPath 反推
 * @returns {Promise<{hash:string, rel:string, existed:boolean}>}
 */
async function registerFile(absPath, opts = {}) {
    const root = poolRoot();
    const rel = opts.rel
        ? String(opts.rel).replace(/\\/g, '/').replace(/^\/+/, '')
        : path.relative(root, absPath).split(path.sep).join('/');
    // 安全：拒绝登记 pool 之外的文件
    const target = path.resolve(root, rel.split('/').join(path.sep));
    if (!target.startsWith(path.resolve(root) + path.sep)) {
        throw new Error(`拒绝登记 pool 目录之外的文件: ${rel}`);
    }
    const hash = await sha256File(absPath);
    const idx = loadIndex();
    const existed = Object.prototype.hasOwnProperty.call(idx.resources, hash);
    idx.resources[hash] = rel;
    if (typeof idx.ref_count[hash] !== 'number') idx.ref_count[hash] = 0;
    saveIndex(idx);
    return { hash, rel, existed };
}

/**
 * 下载任意 URL 到 pool 指定分类目录并登记入池。
 * filename 一律经 basename 净化（D1 路径穿越防御）。
 * @returns {Promise<{ok:boolean, file?:string, hash?:string, rel?:string, error?:string}>}
 */
async function installUrl(url, opts = {}) {
    const category = String(opts.category || 'mods').replace(/[^a-z0-9_-]/gi, '');
    const subPath = String(opts.subPath || '').replace(/[/\\]/g, '');
    const rawName = String(opts.filename || path.basename(new URL(url).pathname) || 'download.jar');
    let filename = path.basename(rawName.replace(/\\/g, '/'));
    if (!filename || filename === '.' || filename === '..' || /^[a-zA-Z]:/.test(filename) || /[/\\]/.test(filename)) {
        return { ok: false, error: `非法文件名: ${rawName}` };
    }
    const destDir = subPath ? path.join(poolRoot(), category, subPath) : path.join(poolRoot(), category);
    const dest = path.join(destDir, filename);
    try {
        const contentInstaller = require('./content_installer');
        await contentInstaller.streamDownload(url, dest, opts.onProgress);
        const reg = await registerFile(dest);
        return { ok: true, file: dest, hash: reg.hash, rel: reg.rel };
    } catch (e) {
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (_) {}
        return { ok: false, error: e.message };
    }
}

/**
 * 下载核心到 pool/cores/<type>/<version>/ 并把该版本目录下的 jar 全部登记入池。
 * 复用 installer.install 的直链解析与安装器流程，targetDir 直接指向池内目录。
 * @returns {Promise<{ok:boolean, type, version, coreDir, files?, error?}>}
 */
async function installCore(opts = {}) {
    const type = String(opts.type || '').trim().toLowerCase();
    const version = String(opts.version || '').trim();
    if (!type || !version) return { ok: false, error: '缺少核心类型或版本' };
    const build = opts.build || null;
    const coreDir = utils.getCoreStoragePath(type, version);
    try {
        fs.ensureDirSync(coreDir);
        const Installer = require('./installer');
        const installer = new Installer();
        await installer.install(type, version, build, coreDir);

        // 递归收集该版本目录下所有 jar，登记进池（供 scheme create 复用）
        const jars = [];
        const walk = (d) => {
            let entries = [];
            try { entries = fs.readdirSync(d); } catch (e) { return; }
            for (const name of entries) {
                const p = path.join(d, name);
                let st;
                try { st = fs.statSync(p); } catch (e) { continue; }
                if (st.isDirectory()) { walk(p); continue; }
                if (/\.jar$/i.test(name)) jars.push(p);
            }
        };
        walk(coreDir);
        const files = [];
        for (const jar of jars) {
            const reg = await registerFile(jar);
            files.push({ file: jar, hash: reg.hash, rel: reg.rel });
        }
        return { ok: true, type, version, coreDir, files };
    } catch (e) {
        return { ok: false, type, version, coreDir, error: e.message };
    }
}

/**
 * 从 URL 或搜索词下载模组 / 插件到池。
 * - 输入是 http(s):// → 直接 installUrl（URL 模式无依赖元数据，只下本体）；
 * - 否则当作项目 id/slug：
 *     · autoResolve !== false（默认开启）→ 走 dep_resolver 递归解析「本体 + 必需依赖」，
 *       逐个人池——与 CLI 完全同一套递归逻辑，修复 Web 装 jadeaddons 漏拉 jade 的问题；
 *     · autoResolve === false（--no-auto）→ 仅下本体（用户已在前端看过依赖并自行决定）。
 * 无论哪条路径都算 SHA-256 并登记 index.yaml，绝不写 scheme/。
 * @returns {Promise<{ok, category, file?, hash?, rel?, installed?:Array, deps?:Array, warnings?:Array, error?}>}
 */
async function installContent(opts = {}) {
    const input = String(opts.input || '').trim();
    const category = opts.category === 'plugins' ? 'plugins' : 'mods';
    if (!input) return { ok: false, category, error: '缺少 URL 或项目名称' };
    try {
        // URL：无依赖元数据，按原逻辑单文件入池
        if (/^https?:\/\//i.test(input)) {
            const r = await installUrl(input, { category, onProgress: opts.onProgress });
            if (!r.ok) return { ok: false, category, error: r.error };
            return { ok: true, category, file: r.file, hash: r.hash, rel: r.rel, installed: [r.rel] };
        }

        const source = (opts.source || 'modrinth').toLowerCase();
        const autoResolve = opts.autoResolve !== false;
        const installed = [];
        const warnings = [];

        if (autoResolve) {
            // P0 修复：复用与 CLI/依赖解析器完全相同的递归逻辑（含 required 依赖、防环、深度上限）。
            const depResolver = require('./dep_resolver');
            const r = await depResolver.resolve({
                source, projectId: input, loader: opts.loader, mcVersion: opts.mcVersion
            });
            const items = r.items || [];
            warnings.push(...(r.warnings || []));
            if (!items.length) {
                return { ok: false, category, error: `未找到 ${input} 的可下载文件（可尝试 --loader / --version 指定版本）`, warnings };
            }
            let first = null;
            for (const it of items) {
                const res = await installUrl(it.fileUrl, {
                    category, filename: it.filename, onProgress: opts.onProgress
                });
                if (res.ok) {
                    installed.push({ projectId: it.projectId, rel: res.rel, depth: it.depth || 0 });
                    if (!first) first = res;
                } else {
                    warnings.push(`下载失败 ${it.projectId}（depth=${it.depth || 0}）：${res.error}`);
                }
            }
            if (!first) {
                return { ok: false, category, error: installed.length ? '全部依赖下载失败' : '下载失败', warnings };
            }
            return {
                ok: true, category,
                file: first.file, hash: first.hash, rel: first.rel,
                installed, warnings,
                deps: installed.filter(i => i.depth > 0).map(i => i.projectId)
            };
        }

        // --no-auto：单文件模式，仅本体
        const contentInstaller = require('./content_installer');
        const found = await contentInstaller.resolveSingleFile({
            source, project: input, loader: opts.loader, mcVersion: opts.mcVersion
        });
        if (!found || !found.fileUrl) {
            return { ok: false, category, error: `未找到 ${input} 的可下载文件（可尝试 --loader / --version 指定版本）` };
        }
        const r = await installUrl(found.fileUrl, {
            category, filename: found.filename, onProgress: opts.onProgress
        });
        if (!r.ok) return { ok: false, category, error: r.error };
        return { ok: true, category, file: r.file, hash: r.hash, rel: r.rel, installed: [r.rel], deps: [] };
    } catch (e) {
        return { ok: false, category, error: e.message };
    }
}

/**
 * 生成「入池成功 → 下一步开服」的防呆提示行（P0）。
 * @param {'core'|'mod'|'plugin'} kind
 * @param {{type?:string, version?:string, rel?:string, name?:string}} info
 * @returns {string[]}
 */
function nextStepHint(kind, info = {}) {
    if (kind === 'core') {
        const type = info.type || '<核心类型>';
        const version = info.version || '<MC版本>';
        return [
            `✅ 核心 [${type}-${version}] 已成功下载并存入资源池 (pool/cores/${type}/${version}/)。`,
            '💡 当前未创建任何服务器实例。如需开服，请执行：',
            `   wow scheme create <你的服务器名字> -t ${type} -v ${version}`,
            '   (wow 将自动从池中读取该核心，无需二次下载)'
        ];
    }
    const label = kind === 'plugin' ? '插件' : '模组';
    const cat = kind === 'plugin' ? 'plugins' : 'mods';
    const name = info.name || info.rel || label;
    return [
        `✅ ${label} [${name}] 已成功下载并存入资源池 (pool/${cat}/)。`,
        '💡 资源已入池但尚未挂载到任何方案。下一步：',
        '   1) 创建方案（若还没有）：wow scheme create <你的服务器名字>',
        '   2) 从池中同步资源到方案：wow mod sync（或在 Web 面板方案管理中挂载）'
    ];
}

module.exports = {
    poolRoot, indexPath, loadIndex, saveIndex, sha256File,
    registerFile, installUrl, installCore, installContent, nextStepHint
};
