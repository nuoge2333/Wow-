'use strict';

/**
 * 插件信任表（V3.5.21-26.3c）
 * ----------------------------------------------------------------
 * 插件是**任意代码**，与 wow 主程序同进程同权限。既然做不到真沙箱
 * （require 同权限、node:vm 也能 `this.constructor.constructor('return process')()` 逃逸），
 * 那就退一步做「知情同意 + 变更可感知」：
 *
 *   - 第一次加载某个插件时，记下它的内容指纹，并要求用户确认一次；
 *   - 之后每次启动比对指纹，**一个字节变了就当作新插件**，重新要求确认；
 *   - 非交互环境（CI、Web 面板 spawn 的子进程、cron）没有终端可问，
 *     默认**拒绝**加载未信任插件，而不是默默放行。
 *
 * 信任表落在 `core/.plugins.trust.json`（与 .web.pid 一类运行时文件同级，
 * 已加入 .gitignore）。结构：
 *   {
 *     "version": 1,
 *     "plugins": {
 *       "hello": { "fingerprint": "sha256:ab12…", "trusted_at": "2025-01-01T00:00:00.000Z" }
 *     }
 *   }
 *
 * 指纹算法与 SchemeManager 的内容指纹同源：
 *   目录递归取文件 → 路径统一为 `/` 分隔并按小写排序（保证可复现）
 *   → `相对路径\0sha256(内容)` 逐个拼接 → 整体再 sha256。
 * 不纳入 node_modules 与 .git，避免依赖装/没装导致指纹漂移。
 */

const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

/** 计算指纹时跳过的子目录（与插件内容无关，且体积可能很大） */
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.DS_Store']);

/** 信任表文件名（相对 core/） */
const TRUST_FILE = path.join(__dirname, '..', '.plugins.trust.json');

/** 参与指纹计算的文件大小上限：超过 2MB 的文件只算「大小 + 头尾各 4KB」 */
const BIG_FILE = 2 * 1024 * 1024;

/**
 * 递归列出目录下所有文件（相对路径，正斜杠分隔，按小写排序）。
 * @param {string} dir
 * @param {string} [base]
 * @returns {string[]}
 */
function listFiles(dir, base) {
    const root = base || dir;
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return out;
    }
    for (const ent of entries) {
        if (SKIP_DIRS.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            out.push(...listFiles(full, root));
        } else if (ent.isFile()) {
            out.push(path.relative(root, full).split(path.sep).join('/'));
        }
    }
    out.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    return out;
}

/** 计算单文件的内容摘要；大文件取「大小 + 首尾 4KB」避免整份读进内存 */
function hashFile(full) {
    const size = fs.statSync(full).size;
    if (size <= BIG_FILE) {
        return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
    const fd = fs.openSync(full, 'r');
    try {
        const head = Buffer.alloc(4096);
        const tail = Buffer.alloc(4096);
        fs.readSync(fd, head, 0, 4096, 0);
        fs.readSync(fd, tail, 0, 4096, Math.max(0, size - 4096));
        return crypto.createHash('sha256')
            .update(`size:${size}`).update(head).update(tail)
            .digest('hex');
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * 计算插件目录的内容指纹。
 * @param {string} pluginDir 插件目录绝对路径
 * @returns {string} `sha256:...`，目录不可读时返回 `sha256:` 前缀的空指纹
 */
function fingerprint(pluginDir) {
    const files = listFiles(pluginDir);
    const h = crypto.createHash('sha256');
    for (const rel of files) {
        let contentHash;
        try {
            contentHash = hashFile(path.join(pluginDir, rel));
        } catch (e) {
            contentHash = 'ERR';
        }
        h.update(`${rel}\0${contentHash}`);
    }
    return 'sha256:' + h.digest('hex');
}

// ==================== 信任表读写 ====================

/**
 * 读取信任表。文件不存在或损坏时返回空表（不抛）。
 * @param {string} [trustFile]
 * @returns {{version:number, plugins:Object<string,{fingerprint:string, trusted_at:string}>}}
 */
function loadTrust(trustFile) {
    const file = trustFile || TRUST_FILE;
    const empty = { version: 1, plugins: {} };
    if (!fs.existsSync(file)) return empty;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data || typeof data !== 'object') return empty;
        return {
            version: 1,
            plugins: (data.plugins && typeof data.plugins === 'object') ? data.plugins : {}
        };
    } catch (e) {
        return empty;
    }
}

/**
 * 写回信任表（原子替换，避免写一半断电留下半截 JSON）。
 * @param {object} data
 * @param {string} [trustFile]
 */
function saveTrust(data, trustFile) {
    const file = trustFile || TRUST_FILE;
    const payload = JSON.stringify({ version: 1, plugins: (data && data.plugins) || {} }, null, 2);
    const tmp = file + '.tmp';
    fs.ensureDirSync(path.dirname(file));
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, file);
}

/**
 * 判断插件是否已被信任（指纹一致）。
 * @param {string} name 插件名
 * @param {string} fp 当前指纹
 * @param {string} [trustFile]
 * @returns {'trusted' | 'changed' | 'new'}
 *   trusted = 指纹一致；changed = 有记录但指纹变了；new = 从未信任过
 */
function checkTrust(name, fp, trustFile) {
    const table = loadTrust(trustFile);
    const rec = table.plugins[name];
    if (!rec || !rec.fingerprint) return 'new';
    return rec.fingerprint === fp ? 'trusted' : 'changed';
}

/**
 * 记下一个插件的信任。
 * @param {string} name
 * @param {string} fp
 * @param {string} [trustFile]
 * @param {string} [when] ISO 时间串（测试用，默认当前时间）
 */
function grantTrust(name, fp, trustFile, when) {
    const table = loadTrust(trustFile);
    table.plugins[name] = {
        fingerprint: fp,
        trusted_at: when || new Date().toISOString()
    };
    saveTrust(table, trustFile);
}

/**
 * 撤销一个插件的信任记录（卸载插件时调用）。
 * @param {string} name
 * @param {string} [trustFile]
 * @returns {boolean} 是否真的删掉了一条记录
 */
function revokeTrust(name, trustFile) {
    const table = loadTrust(trustFile);
    if (!(name in table.plugins)) return false;
    delete table.plugins[name];
    saveTrust(table, trustFile);
    return true;
}

module.exports = {
    fingerprint,
    loadTrust,
    saveTrust,
    checkTrust,
    grantTrust,
    revokeTrust,
    TRUST_FILE,
    _internals: { listFiles, hashFile, SKIP_DIRS }
};
