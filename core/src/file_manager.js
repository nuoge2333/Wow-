/**
 * 文件管理模块（Web 面板「文件管理」页后端）
 *
 * 安全约束（V3.5.6）：
 *   - 所有路径操作严格限制在「服务器运行目录」（即 utils.getServerDir() 返回的方案目录）之内；
 *   - 拒绝绝对路径、盘符、以及任何形式的路径穿越（../、..\\、URL 编码变体）；
 *   - 解析后再次校验真实路径（realpath）仍位于根目录内，阻断符号链接逃逸；
 *   - 上传文件名同样做净化，保留相对目录结构但剥离一切越权路径。
 *
 * 实现约束（V3.5.7）：
 *   - **全部使用 Node.js fs API，绝不调用系统命令**（mkdir/mv/cp/rm/zip/unzip/tar）。
 *     原因：旧实现走 /api/exec 调 shell，Windows 上 mkdir/mv/rm/cp 全部不存在，
 *     且文件名中的 `;`、反引号等可造成命令注入。纯 fs 实现天然跨平台且无注入面。
 *   - 解压走 adm-zip，并逐条校验条目路径，阻断 zip slip（../../ 逃逸）。
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const utils = require('./utils');

/**
 * 跨平台非法文件名字符（Windows 最严格，统一按它约束）
 * 说明：不含路径分隔符，调用方已先行拆分过路径。
 */
const ILLEGAL_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/;

/**
 * 校验单个「名字段」（不含路径分隔符），跨平台安全。
 * @param {string} name
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
function validateNameSegment(name) {
    const n = String(name == null ? '' : name);
    if (n === '') return { ok: false, reason: '名称不能为空' };
    if (n === '.' || n === '..') return { ok: false, reason: '名称不能为 . 或 ..' };
    if (n.includes('/') || n.includes('\\')) return { ok: false, reason: '名称不能包含路径分隔符' };
    if (ILLEGAL_NAME_CHARS.test(n)) {
        return { ok: false, reason: '名称包含非法字符（< > : " | ? * 或控制字符）' };
    }
    // Windows 保留设备名
    const base = n.replace(/\.[^.]*$/, '').toUpperCase();
    const RESERVED = ['CON', 'PRN', 'AUX', 'NUL'];
    if (RESERVED.includes(base) || /^COM[1-9]$/.test(base) || /^LPT[1-9]$/.test(base)) {
        return { ok: false, reason: `「${n}」是 Windows 保留名称` };
    }
    // Windows 不允许以点或空格结尾
    if (n.endsWith('.') || n.endsWith(' ')) {
        return { ok: false, reason: '名称不能以点或空格结尾' };
    }
    if (n.length > 255) return { ok: false, reason: '名称过长（上限 255 字符）' };
    return { ok: true };
}

/**
 * 统一把 safeResolve 的失败结果转成带 code 的 Error
 */
function pathError(reason) {
    const err = new Error(reason);
    err.code = 'EPATH';
    return err;
}

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

    // 明确拒绝绝对路径（V3.5.7：由「静默剥离前导斜杠」改为「直接拒绝」）
    // 旧行为虽不会真的逃逸（/etc/passwd 会被解析为 <root>/etc/passwd），
    // 但语义歧义大：用户以为在访问系统路径。前端本就只应传相对路径，故直接拒绝更清晰。
    if (/^\/+/.test(p)) {
        return { ok: false, reason: '不允许绝对路径（请使用相对方案目录的路径）' };
    }

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

// ==================== 写操作（V3.5.7，纯 Node，跨平台） ====================

/**
 * 新建文件夹
 * @param {string} parentRel 父目录（相对根，空串为根）
 * @param {string} name 新文件夹名（单段，不含分隔符）
 */
async function makeDir(parentRel, name) {
    const nameCheck = validateNameSegment(name);
    if (!nameCheck.ok) throw pathError(nameCheck.reason);

    const parent = safeResolve(parentRel || '');
    if (!parent.ok) throw pathError(parent.reason);
    if (!fs.existsSync(parent.abs)) throw Object.assign(new Error('父目录不存在'), { code: 'ENOENT' });

    const targetAbs = path.join(parent.abs, name);
    const targetRel = parent.rel ? `${parent.rel}/${name}` : name;

    // 目标路径必须仍在校验过的父目录内（name 已确认无分隔符，这里是兜底）
    const parentWithSep = parent.abs.endsWith(path.sep) ? parent.abs : parent.abs + path.sep;
    if (!targetAbs.startsWith(parentWithSep)) throw pathError('目标路径超出父目录范围');

    if (fs.existsSync(targetAbs)) {
        throw Object.assign(new Error(`「${name}」已存在`), { code: 'EEXIST' });
    }
    fs.ensureDirSync(targetAbs);
    return { name, path: targetRel };
}

/**
 * 重命名（同目录内改名）
 */
async function renameEntry(relPath, newName) {
    const nameCheck = validateNameSegment(newName);
    if (!nameCheck.ok) throw pathError(nameCheck.reason);

    const src = safeResolve(relPath);
    if (!src.ok) throw pathError(src.reason);
    if (!src.rel) throw pathError('不能重命名根目录');
    if (!fs.existsSync(src.abs)) throw Object.assign(new Error('目标不存在'), { code: 'ENOENT' });

    const parentAbs = path.dirname(src.abs);
    const destAbs = path.join(parentAbs, newName);
    const parentRel = path.dirname(src.rel);
    const destRel = parentRel === '.' ? newName : `${parentRel.replace(/\\/g, '/')}/${newName}`;

    const parentWithSep = parentAbs.endsWith(path.sep) ? parentAbs : parentAbs + path.sep;
    if (!destAbs.startsWith(parentWithSep)) throw pathError('目标路径超出父目录范围');
    if (fs.existsSync(destAbs)) {
        throw Object.assign(new Error(`「${newName}」已存在`), { code: 'EEXIST' });
    }

    fs.moveSync(src.abs, destAbs);
    return { from: src.rel, to: destRel };
}

/**
 * 移动 / 复制（源与目标都做路径校验）
 * @param {string} fromRel
 * @param {string} toDirRel 目标目录（移动到此目录下，保持原文件名）
 * @param {boolean} isCopy true=复制，false=移动
 */
async function transferEntry(fromRel, toDirRel, isCopy) {
    const src = safeResolve(fromRel);
    if (!src.ok) throw pathError(src.reason);
    if (!src.rel) throw pathError('不能操作根目录');
    if (!fs.existsSync(src.abs)) throw Object.assign(new Error('源不存在'), { code: 'ENOENT' });

    const destDir = safeResolve(toDirRel || '');
    if (!destDir.ok) throw pathError(destDir.reason);
    if (!fs.existsSync(destDir.abs)) throw Object.assign(new Error('目标目录不存在'), { code: 'ENOENT' });
    if (!fs.statSync(destDir.abs).isDirectory()) {
        throw Object.assign(new Error('目标不是目录'), { code: 'ENOTDIR' });
    }

    // 禁止把目录移入自身或其子目录（会导致无限递归 / 数据丢失）
    const srcWithSep = src.abs.endsWith(path.sep) ? src.abs : src.abs + path.sep;
    if (destDir.abs === src.abs || destDir.abs.startsWith(srcWithSep)) {
        throw pathError('不能将目录移动到其自身或其子目录中');
    }

    const baseName = path.basename(src.abs);
    const destAbs = path.join(destDir.abs, baseName);
    if (fs.existsSync(destAbs)) {
        throw Object.assign(new Error(`目标目录中已存在「${baseName}」`), { code: 'EEXIST' });
    }

    if (isCopy) {
        fs.copySync(src.abs, destAbs);
    } else {
        fs.moveSync(src.abs, destAbs);
    }

    const destRel = destDir.rel ? `${destDir.rel}/${baseName}` : baseName;
    return { from: src.rel, to: destRel, copied: !!isCopy };
}

/**
 * 删除文件 / 目录（递归）
 * 注意：这是不可逆操作，调用方（路由 / 前端）必须已做二次确认。
 */
async function removeEntry(relPath) {
    const r = safeResolve(relPath);
    if (!r.ok) throw pathError(r.reason);
    if (!r.rel) throw pathError('不能删除根目录');
    if (!fs.existsSync(r.abs)) throw Object.assign(new Error('目标不存在'), { code: 'ENOENT' });

    const stat = fs.statSync(r.abs);
    fs.removeSync(r.abs);
    return { path: r.rel, type: stat.isDirectory() ? 'dir' : 'file' };
}

/**
 * 压缩为 zip（adm-zip，纯 JS，跨平台）
 * @param {string[]} relPaths 待压缩的条目（相对根）
 * @param {string} destRel 输出 zip 的相对路径
 */
async function compress(relPaths, destRel) {
    const dest = safeResolve(destRel);
    if (!dest.ok) throw pathError(dest.reason);
    if (!dest.rel) throw pathError('压缩包路径不能为空');

    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    let added = 0;

    for (const rp of relPaths) {
        const r = safeResolve(rp);
        if (!r.ok) throw pathError(r.reason);
        if (!r.rel) throw pathError('不能压缩根目录');
        if (!fs.existsSync(r.abs)) throw Object.assign(new Error(`「${rp}」不存在`), { code: 'ENOENT' });

        const stat = fs.statSync(r.abs);
        if (stat.isDirectory()) {
            zip.addLocalFolder(r.abs, path.basename(r.abs));
        } else {
            zip.addLocalFile(r.abs);
        }
        added++;
    }

    if (added === 0) throw pathError('没有可压缩的条目');

    fs.ensureDirSync(path.dirname(dest.abs));
    zip.writeZip(dest.abs);
    const size = fs.statSync(dest.abs).size;
    return { path: dest.rel, size, entries: added };
}

/**
 * 解压 zip 到目标目录（含 zip slip 防御）
 * @param {string} zipRel zip 文件相对路径
 * @param {string} destDirRel 解压目标目录（相对根，空串为根）
 */
async function extract(zipRel, destDirRel) {
    const src = safeResolve(zipRel);
    if (!src.ok) throw pathError(src.reason);
    if (!src.rel) throw pathError('请指定要解压的文件');
    if (!fs.existsSync(src.abs)) throw Object.assign(new Error('压缩包不存在'), { code: 'ENOENT' });
    if (!fs.statSync(src.abs).isFile()) throw Object.assign(new Error('目标不是文件'), { code: 'EISDIR' });
    if (!/\.zip$/i.test(src.abs)) throw pathError('目前仅支持解压 .zip 文件');

    const destDir = safeResolve(destDirRel || '');
    if (!destDir.ok) throw pathError(destDir.reason);
    fs.ensureDirSync(destDir.abs);

    const AdmZip = require('adm-zip');
    let zip;
    try {
        zip = new AdmZip(src.abs);
    } catch (e) {
        throw Object.assign(new Error(`压缩包无法读取: ${e.message}`), { code: 'EBADZIP' });
    }

    const destWithSep = destDir.abs.endsWith(path.sep) ? destDir.abs : destDir.abs + path.sep;
    const entries = zip.getEntries();
    const written = [];
    const skipped = [];

    for (const entry of entries) {
        // zip slip 防御：条目名必须规范化后仍落在目标目录内
        const entryName = String(entry.entryName || '').replace(/\\/g, '/');
        if (entryName.startsWith('/') || /^[a-zA-Z]:/.test(entryName)) {
            skipped.push(entry.entryName);
            continue;
        }
        const parts = [];
        let bad = false;
        for (const seg of entryName.split('/')) {
            if (seg === '' || seg === '.') continue;
            if (seg === '..') { bad = true; break; }
            parts.push(seg);
        }
        if (bad || parts.length === 0) {
            skipped.push(entry.entryName);
            continue;
        }

        const targetAbs = path.resolve(destDir.abs, parts.join('/'));
        if (targetAbs !== destDir.abs && !targetAbs.startsWith(destWithSep)) {
            skipped.push(entry.entryName);
            continue;
        }

        if (entry.isDirectory) {
            fs.ensureDirSync(targetAbs);
        } else {
            fs.ensureDirSync(path.dirname(targetAbs));
            fs.writeFileSync(targetAbs, entry.getData());
            written.push(parts.join('/'));
        }
    }

    return { path: destDir.rel, extracted: written.length, skipped };
}

/**
 * 读取文本文件内容（供前端预览，限制大小与类型）
 */
async function readText(relPath, maxBytes = 512 * 1024) {
    const r = safeResolve(relPath);
    if (!r.ok) throw pathError(r.reason);
    if (!fs.existsSync(r.abs)) throw Object.assign(new Error('文件不存在'), { code: 'ENOENT' });
    const stat = fs.statSync(r.abs);
    if (!stat.isFile()) throw Object.assign(new Error('目标不是文件'), { code: 'EISDIR' });
    if (stat.size > maxBytes) {
        throw Object.assign(new Error(`文件过大（${(stat.size / 1024).toFixed(0)}KB），超过预览上限 ${maxBytes / 1024}KB`), { code: 'ETOOBIG' });
    }
    return { path: r.rel, size: stat.size, content: fs.readFileSync(r.abs, 'utf8') };
}

/**
 * 写入文本文件内容（保存编辑）
 */
async function writeText(relPath, content, maxBytes = 2 * 1024 * 1024) {
    const r = safeResolve(relPath);
    if (!r.ok) throw pathError(r.reason);
    if (!r.rel) throw pathError('请指定文件名');

    const buf = Buffer.from(String(content == null ? '' : content), 'utf8');
    if (buf.length > maxBytes) {
        throw Object.assign(new Error(`内容过大（上限 ${maxBytes / 1024 / 1024}MB）`), { code: 'ETOOBIG' });
    }
    fs.ensureDirSync(path.dirname(r.abs));
    fs.writeFileSync(r.abs, buf);
    return { path: r.rel, size: buf.length };
}

module.exports = {
    getRoot,
    safeResolve,
    listFiles,
    resolveDownload,
    sanitizeUploadRel,
    saveUploads,
    // V3.5.7 新增
    validateNameSegment,
    makeDir,
    renameEntry,
    transferEntry,
    removeEntry,
    compress,
    extract,
    readText,
    writeText
};
