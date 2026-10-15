/**
 * 文件管理模块（Web 面板「文件管理」页后端）
 *
 * 安全约束（V3.5.6）：
 *   - 所有路径操作严格限制在「服务器运行目录」（即 utils.getServerDir() 返回的方案目录）之内；
 *   - 拒绝绝对路径、盘符、以及任何形式的路径穿越（../、..\\、URL 编码变体）；
 *   - 解析后再次校验真实路径（realpath）仍位于根目录内，阻断符号链接逃逸；
 *   - 上传文件名同样做净化，保留相对目录结构但剥离一切越权路径。
 *
 * 仅提供：列目录、下载单文件、上传（多文件）。
 * 删除/重命名/建目录等危险操作不在此处开放，仍走 CLI（command_policy 已有拒绝清单）。
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');

/**
 * 取服务器运行目录（方案目录）作为文件管理根
 */
function getRoot() {
    return path.resolve(utils.getServerDir());
}

/**
 * 解码并规范化用户传入的相对路径，确保落在 root 之内。
 * @param {string} rawPath 用户传入的 path 参数
 * @returns {{ok:true, abs:string, rel:string} | {ok:false, reason:string}}
 */
function safeResolve(rawPath) {
    const root = getRoot();
    let p = String(rawPath == null ? '' : rawPath);

    // 统一分隔符（Windows 反斜杠也视为分隔符）
    const original = p.replace(/\\/g, '/').trim();

    // 明确拒绝 UNC 前缀（//server/share 形式），需在剥离前导斜杠之前判断
    if (original.startsWith('//')) {
        return { ok: false, reason: '不允许 UNC 网络路径' };
    }

    p = original;

    // 去掉前导斜杠，避免被当作绝对路径
    p = p.replace(/^\/+/, '');

    // 明确拒绝盘符（C: / D: 等）
    if (/^[a-zA-Z]:/.test(p)) {
        return { ok: false, reason: '不允许绝对路径或盘符路径' };
    }

    // 逐段过滤：丢弃空段与 '.'，遇到 '..' 立即拒绝（不做静默归并，避免歧义）
    const segments = [];
    for (const seg of p.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') {
            return { ok: false, reason: '不允许路径穿越（..）' };
        }
        segments.push(seg);
    }

    const rel = segments.join('/');
    const abs = path.resolve(root, rel);

    // 二次防御：解析结果必须仍位于 root 之内
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(rootWithSep)) {
        return { ok: false, reason: '目标路径超出服务器目录范围' };
    }

    // 三段防御：若目标已存在，用 realpath 校验（阻断符号链接指向外部）
    try {
        if (fs.existsSync(abs)) {
            const realRoot = fs.realpathSync(root);
            const realAbs = fs.realpathSync(abs);
            const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
            if (realAbs !== realRoot && !realAbs.startsWith(realRootWithSep)) {
                return { ok: false, reason: '目标路径经符号链接指向了服务器目录之外' };
            }
        }
    } catch (e) {
        // realpath 失败（如权限问题）时，保守拒绝
        return { ok: false, reason: `无法校验目标路径: ${e.message}` };
    }

    return { ok: true, abs, rel };
}

/**
 * 列出目录内容
 * @param {string} relPath 相对服务器目录的路径
 * @returns {Promise<{path:string, files:Array}>}
 */
async function listFiles(relPath) {
    const r = safeResolve(relPath);
    if (!r.ok) {
        const err = new Error(r.reason);
        err.code = 'EPATH';
        throw err;
    }

    if (!fs.existsSync(r.abs)) {
        const err = new Error('目录不存在');
        err.code = 'ENOENT';
        throw err;
    }
    const stat = fs.statSync(r.abs);
    if (!stat.isDirectory()) {
        const err = new Error('目标不是目录');
        err.code = 'ENOTDIR';
        throw err;
    }

    const entries = fs.readdirSync(r.abs, { withFileTypes: true });
    const files = entries.map((ent) => {
        const full = path.join(r.abs, ent.name);
        let size = 0;
        let mtime = null;
        try {
            const st = fs.statSync(full);
            size = st.size;
            mtime = st.mtime.toISOString();
        } catch (e) {
            // 个别条目 stat 失败（断链等）时降级为 0，不影响整体列表
        }
        return {
            name: ent.name,
            type: ent.isDirectory() ? 'dir' : 'file',
            size,
            mtime,
            path: r.rel ? `${r.rel}/${ent.name}` : ent.name
        };
    });

    // 目录在前、文件在后，同类按名称排序
    files.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
    });

    return { path: r.rel, files };
}

/**
 * 解析下载请求：返回绝对路径与文件名，供路由发送文件流
 */
function resolveDownload(relPath) {
    const r = safeResolve(relPath);
    if (!r.ok) {
        const err = new Error(r.reason);
        err.code = 'EPATH';
        throw err;
    }
    if (!fs.existsSync(r.abs)) {
        const err = new Error('文件不存在');
        err.code = 'ENOENT';
        throw err;
    }
    const stat = fs.statSync(r.abs);
    if (!stat.isFile()) {
        const err = new Error('只能下载文件，不能下载目录');
        err.code = 'EISDIR';
        throw err;
    }
    return { abs: r.abs, name: path.basename(r.abs), size: stat.size };
}

/**
 * 净化上传时的文件名/相对路径，保留子目录结构但剥离越权部分。
 * @returns {string|null} 可用的相对路径，非法时返回 null
 */
function sanitizeUploadRel(originalName) {
    let p = String(originalName == null ? '' : originalName).replace(/\\/g, '/');
    p = p.replace(/^\/+/, '');
    if (/^[a-zA-Z]:/.test(p)) return null;

    const segments = [];
    for (const seg of p.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') return null;
        // 过滤 NUL 等控制字符
        if (/[\u0000-\u001f]/.test(seg)) return null;
        // 过滤 Windows 保留字符（跨平台生成的文件名更安全）
        if (/[<>:"|?*]/.test(seg)) return null;
        segments.push(seg);
    }
    if (segments.length === 0) return null;
    return segments.join('/');
}

/**
 * 将一批上传缓冲写入目标目录
 * @param {string} baseRel 用户指定上传到服务器目录下的哪个子目录
 * @param {Array<{rel:string, buffer:Buffer}>} items
 * @returns {Promise<{uploaded:number, files:string[], skipped:string[]}>}
 */
async function saveUploads(baseRel, items) {
    const base = safeResolve(baseRel || '');
    if (!base.ok) {
        const err = new Error(base.reason);
        err.code = 'EPATH';
        throw err;
    }
    fs.ensureDirSync(base.abs);

    let uploaded = 0;
    const saved = [];
    const skipped = [];

    for (const item of items) {
        const rel = sanitizeUploadRel(item.rel);
        if (!rel) {
            skipped.push(item.rel);
            continue;
        }
        const destAbs = path.resolve(base.abs, rel);
        const baseWithSep = base.abs.endsWith(path.sep) ? base.abs : base.abs + path.sep;
        // 再次确认落在上传目标目录内
        if (destAbs !== base.abs && !destAbs.startsWith(baseWithSep)) {
            skipped.push(item.rel);
            continue;
        }
        fs.ensureDirSync(path.dirname(destAbs));
        fs.writeFileSync(destAbs, item.buffer);
        uploaded++;
        saved.push(path.relative(base.abs, destAbs).replace(/\\/g, '/'));
    }

    return { uploaded, files: saved, skipped };
}

module.exports = {
    getRoot,
    safeResolve,
    listFiles,
    resolveDownload,
    sanitizeUploadRel,
    saveUploads
};
