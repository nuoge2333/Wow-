/**
 * 跨设备方案同步 —— 共享规则（V3.5.25）
 * ----------------------------------------------------------------
 * 规则一句话：**清单先行、缺口补充、哈希校验。**
 *
 * 两端都是 wow：控制端（发起同步）与执行端（接收组装）跑的是同一份代码，
 * 本模块放两端共用的常量与纯函数，保证判定标准只有一份。
 *
 * 传输决策（写死在代码里，不是文档里的口头约定）：
 *   - **复用 Web 面板的 JWT 认证**，不引入第二套凭据体系；
 *   - **不打包成 tar**：Node 标准库没有 tar，引第三方包（如 tar-stream）只为
 *     省几十个小文件的 HTTP 往返不值得。小文件走「JSON 束」——一个请求里
 *     base64 携带全部内容，语义与 tar 相同、无需新依赖；
 *   - **大文件分块**（默认 8MB/块），支持断点续传：执行端把块追加到 staging，
 *     控制端记录已传块，断网后从断点继续。
 *
 * 安全边界（对应需求「给尚书的执行边界」）：
 *   - 路径白名单：只能写 scheme/<方案名>/ 下的指定子目录，全部经 file_manager.safeResolve；
 *   - 扩展名白名单：清单之外的一律拒绝；
 *   - 单文件 ≤ 200MB，单次同步总量 ≤ 2GB；
 *   - 方案名冲突 → 拒绝，不覆盖、不合并。
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

// ==================== 常量 ====================

/** 允许写入的子目录（相对方案目录）。世界与配置文件由专门字段处理。 */
const ALLOWED_DIRS = ['mods', 'plugins', 'config', 'kubejs', 'scripts', 'datapacks', 'world'];

/** 扩展名白名单 */
const ALLOWED_EXTS = new Set([
    '.jar', '.json', '.toml', '.yaml', '.yml', '.properties',
    '.cfg', '.txt', '.dat', '.mca', '.mcr', '.tar'
]);

/** 大文件阈值：超过它走分块上传，否则走 JSON 束 */
const CHUNK_THRESHOLD = 4 * 1024 * 1024; // 4MB

/** 分块大小 */
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB

/** 单文件上限 */
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB

/** 单次同步总量上限 */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

/** JSON 束里单文件 base64 上限（config 类文件实际都在几 MB 内） */
const MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024;

/**
 * 清单协议版本。
 *   1 — 单哈希（sha256），基线版本
 *   2 — mods/plugins 增加 sha512/sha1（供执行端查 Modrinth）；执行端收到 v1 清单时
 *       跳过 Modrinth 查询，直接按「需上传」处理（向后兼容）
 */
const PROTOCOL_VERSION = 2;

/** staging 目录名（core/temp/ 下） */
const STAGING_DIR = path.join('temp', 'sync_staging');

/** core/ 根目录（temp、scheme 等相对它解析） */
function tempRoot() {
    return path.join(__dirname, '..');
}

// ==================== 哈希与清单 ====================

/** 流式计算 SHA-256（大文件不能 readFileSync 全读进内存） */
function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const s = fs.createReadStream(filePath);
        s.on('data', d => h.update(d));
        s.on('error', reject);
        s.on('end', () => resolve(h.digest('hex')));
    });
}

/** 小内容直接哈希 */
function sha256Buf(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 一次读盘算三路哈希（SHA-256 / SHA-512 / SHA-1）。
 *
 * 只给 mods / plugins 的 .jar 用：SHA-256 是唯一写入依据（pool 比对、
 * 落盘校验、一致性判定）；SHA-512 / SHA-1 只用于「问 Modrinth 有没有这个文件」，
 * 不参与任何写入决策。
 *
 * 流式三路并行，不重复读盘。
 */
function hashTripleFile(filePath) {
    return new Promise((resolve, reject) => {
        const h256 = crypto.createHash('sha256');
        const h512 = crypto.createHash('sha512');
        const h1 = crypto.createHash('sha1');
        let bytes = 0;
        const s = fs.createReadStream(filePath);
        s.on('data', d => { h256.update(d); h512.update(d); h1.update(d); bytes += d.length; });
        s.on('error', reject);
        s.on('end', () => resolve({
            sha256: h256.digest('hex'),
            sha512: h512.digest('hex'),
            sha1: h1.digest('hex'),
            size: bytes
        }));
    });
}

/** 是否允许该相对路径（扩展名 + 目录白名单） */
function isPathAllowed(relPath) {
    const rel = String(relPath || '').replace(/\\/g, '/');
    if (!rel || rel.startsWith('/')) return false;
    // root 配置文件走专门通道（与 sync_server.ROOT_FILES_ALLOWED 一致）
    if (rel === 'server.properties' || rel === 'eula.txt') return true;
    // 任何一段是 .. 都拒绝（纵深防御；safeResolve 是主闸门）
    const segs = rel.split('/');
    if (segs.some(s => s === '..')) return false;
    const top = segs[0];
    if (!ALLOWED_DIRS.includes(top)) return false;
    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) return false;
    return true;
}

/**
 * 扫描一个目录，产出 {relPath: size} 列表（跳过软链接，防循环）。
 */
function listFilesRecursively(dir, baseDir = dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (e) { return out; }
    for (const name of entries) {
        const full = path.join(dir, name);
        let st;
        try { st = fs.lstatSync(full); } catch (e) { continue; }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
            listFilesRecursively(full, baseDir, out);
        } else if (st.isFile()) {
            out.push({ rel: path.relative(baseDir, full).split(path.sep).join('/'), size: st.size });
        }
    }
    return out;
}

/**
 * 控制端：扫描方案目录，生成同步清单。
 *
 * @param {object} opts
 *   schemePath   方案目录绝对路径
 *   meta         scheme.yaml 解析结果（name/version/loader/type/resources）
 *   withWorld    是否包含存档（默认 false）
 *   withConfig   是否包含 server.properties / eula.txt（默认 false）
 * @returns {Promise<object>} 清单
 */
async function buildManifest(opts = {}) {
    const { schemePath, meta, withWorld = false, withConfig = false } = opts;
    if (!fs.existsSync(schemePath)) {
        throw new Error(`方案目录不存在: ${schemePath}`);
    }

    const manifest = {
        protocol: PROTOCOL_VERSION,
        name: meta.name,
        mc_version: meta.version || null,
        loader: meta.loader || meta.type || 'vanilla',
        loader_version: meta.build || null,
        type: meta.type || meta.loader || 'vanilla',
        with_world: !!withWorld,
        with_config: !!withConfig,
        created_at: new Date().toISOString(),
        total_bytes: 0,
        core: null,
        mods: [],
        plugins: [],
        files: [],
        root_files: {}
    };

    // ---- 核心 ----
    // resources.core.file 是相对方案目录的路径（Forge 在 libraries/ 深层）
    const coreRel = meta.resources && meta.resources.core && meta.resources.core.file;
    if (coreRel) {
        const coreAbs = path.join(schemePath, coreRel);
        if (fs.existsSync(coreAbs)) {
            manifest.core = {
                file: coreRel,
                sha256: await sha256File(coreAbs),
                size: fs.statSync(coreAbs).size
            };
        }
    }

    // ---- 模组 / 插件：三路哈希（sha512/sha1 供执行端查 Modrinth） ----
    for (const [key, dir] of [['mods', 'mods'], ['plugins', 'plugins']]) {
        const d = path.join(schemePath, dir);
        for (const f of listFilesRecursively(d)) {
            // listFilesRecursively 返回的是相对 dir 的路径，落回绝对路径要拼上 dir
            const relToScheme = `${dir}/${f.rel}`;
            if (!relToScheme.toLowerCase().endsWith('.jar')) continue;
            const h = await hashTripleFile(path.join(schemePath, relToScheme));
            manifest[key].push({
                path: relToScheme,
                sha256: h.sha256,   // 唯一写入依据
                sha512: h.sha512,   // 仅供 Modrinth 查询
                sha1: h.sha1,       // 仅供 Modrinth 查询（降级算法）
                size: f.size
            });
        }
    }

    // ---- config / kubejs / scripts / datapacks / world ----
    const contentDirs = ['config', 'kubejs', 'scripts', 'datapacks'];
    if (withWorld) contentDirs.push('world');

    for (const dir of contentDirs) {
        for (const f of listFilesRecursively(path.join(schemePath, dir))) {
            // listFilesRecursively 返回相对 dir 的路径，落回方案内相对路径要拼前缀
            const relToScheme = `${dir}/${f.rel}`;
            if (!isPathAllowed(relToScheme)) continue;
            // session.lock 不需要传，执行端会重建
            if (relToScheme === 'world/session.lock') continue;
            if (f.size > MAX_FILE_BYTES) continue; // 超限文件不进清单
            manifest.files.push({
                path: relToScheme,
                sha256: await sha256File(path.join(schemePath, relToScheme)),
                size: f.size
            });
        }
    }

    // ---- server.properties / eula.txt（显式勾选）----
    if (withConfig) {
        for (const name of ['server.properties', 'eula.txt']) {
            const p = path.join(schemePath, name);
            if (fs.existsSync(p)) {
                manifest.root_files[name] = {
                    sha256: await sha256File(p),
                    size: fs.statSync(p).size
                };
            }
        }
    }

    manifest.total_bytes =
        (manifest.core ? manifest.core.size : 0) +
        manifest.mods.reduce((s, m) => s + m.size, 0) +
        manifest.plugins.reduce((s, m) => s + m.size, 0) +
        manifest.files.reduce((s, m) => s + m.size, 0) +
        Object.values(manifest.root_files).reduce((s, m) => s + m.size, 0);

    return manifest;
}

/** 清单里所有条目的扁平列表（供差量上传用） */
function manifestEntries(manifest) {
    const out = [];
    if (manifest.core) out.push({ kind: 'core', ...manifest.core });
    for (const m of manifest.mods || []) out.push({ kind: 'mods', ...m });
    for (const p of manifest.plugins || []) out.push({ kind: 'plugins', ...p });
    for (const f of manifest.files || []) out.push({ kind: 'files', ...f });
    for (const [name, meta] of Object.entries(manifest.root_files || {})) {
        out.push({ kind: 'root', path: name, ...meta });
    }
    return out;
}

// ==================== staging（执行端） ====================

/** staging 根目录：core/temp/sync_staging/<方案名>/<sha256>.part */
function stagingPathFor(name, sha256) {
    return path.join(STAGING_DIR, String(name).replace(/[\\/:*?"<>|]/g, '_'), `${sha256}.part`);
}

/** 查询某文件已收到的字节数（断点续传用） */
function receivedBytes(absPartPath) {
    try {
        return fs.existsSync(absPartPath) ? fs.statSync(absPartPath).size : 0;
    } catch (e) {
        return 0;
    }
}

module.exports = {
    ALLOWED_DIRS,
    ALLOWED_EXTS,
    PROTOCOL_VERSION,
    tempRoot,
    hashTripleFile,
    CHUNK_THRESHOLD,
    CHUNK_SIZE,
    MAX_FILE_BYTES,
    MAX_TOTAL_BYTES,
    MAX_BUNDLE_FILE_BYTES,
    STAGING_DIR,
    sha256File,
    sha256Buf,
    isPathAllowed,
    listFilesRecursively,
    buildManifest,
    manifestEntries,
    stagingPathFor,
    receivedBytes
};
