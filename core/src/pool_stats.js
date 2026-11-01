/**
 * 资源共享池（pool/）统计
 *
 * V3.5.20：原先这段逻辑内联在 web_service.js 的 /api/pool/stats 里，
 * CLI 想加 `pool stats` 只能整段复制。抽成独立模块后，两条入口读同一份口径，
 * 不会出现「Web 面板显示 12 个资源、命令行显示 13 个」这种对不上的情况。
 *
 * 统计口径：
 *   - total    : pool/ 下的 .jar / .zip 文件总数
 *   - refs     : 文件名在任一方案目录内出现过的数量（同名即视为被引用）
 *   - unique   : total - refs（只躺在 pool 里、没被任何方案用到的资源）
 *   - byType   : 按 pool 下的一级子目录归类的数量（cores / mods / plugins ...）
 *   - totalSize: pool 目录实际占用（含 index.yaml 等元数据文件），按文件名去重
 *                —— 同一份 jar 在多个版本目录里重复存放，只计一次体积
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');

// 方案目录里这些子目录放的是运行时产物，不是「资源引用」，统计时跳过
const SKIP_DIRS = new Set(['logs', 'world', 'libraries', 'crash-reports']);

/**
 * 收集方案目录内出现过的所有文件名
 * @param {string} schemeDir 根 scheme/ 目录
 * @returns {Set<string>}
 */
function collectSchemeFileNames(schemeDir) {
    const names = new Set();

    const walk = (dir, depth) => {
        if (depth > 6 || !fs.existsSync(dir)) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (SKIP_DIRS.has(ent.name)) continue;
                walk(full, depth + 1);
            } else {
                names.add(ent.name);
            }
        }
    };

    walk(schemeDir, 0);
    return names;
}

/**
 * 遍历 pool 目录，按一级子目录归类统计资源
 * @param {string} poolDir
 * @param {Set<string>} schemeFiles
 */
function walkPool(poolDir, schemeFiles) {
    const byType = {};
    let total = 0;
    let refs = 0;

    const walk = (dir, typeKey, depth) => {
        if (depth > 4 || !fs.existsSync(dir)) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(full, typeKey, depth + 1);
                continue;
            }
            if (!ent.name.endsWith('.jar') && !ent.name.endsWith('.zip')) continue;
            total++;
            byType[typeKey] = (byType[typeKey] || 0) + 1;
            if (schemeFiles.has(ent.name)) refs++;
        }
    };

    if (fs.existsSync(poolDir)) {
        let subs = [];
        try { subs = fs.readdirSync(poolDir); } catch { subs = []; }
        for (const sub of subs) {
            const full = path.join(poolDir, sub);
            let isDir = false;
            try { isDir = fs.statSync(full).isDirectory(); } catch { isDir = false; }
            if (isDir) walk(full, sub, 0);
        }
    }

    return { total, refs, byType };
}

/**
 * pool 目录占用体积（按文件名去重）
 * @param {string} poolDir
 * @returns {number} 字节
 */
function measureSize(poolDir) {
    let totalSize = 0;
    const seen = new Set();

    const walk = (dir, depth) => {
        if (depth > 4 || !fs.existsSync(dir)) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(full, depth + 1);
                continue;
            }
            if (seen.has(ent.name)) continue;
            seen.add(ent.name);
            try { totalSize += fs.statSync(full).size; } catch { /* 忽略单个文件 */ }
        }
    };

    walk(poolDir, 0);
    return totalSize;
}

/**
 * 取得 pool 统计结果
 * @returns {{total:number, refs:number, unique:number, byType:Object, totalSize:number, poolDir:string}}
 */
function getStats() {
    const poolDir = utils.getPoolPath('');
    const schemeDir = utils.resolvePath('../scheme');
    const schemeFiles = collectSchemeFileNames(schemeDir);
    const { total, refs, byType } = walkPool(poolDir, schemeFiles);

    return {
        total,
        refs,
        unique: total - refs,
        byType,
        totalSize: measureSize(poolDir),
        poolDir
    };
}

/**
 * 人类可读的体积
 */
function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

module.exports = { getStats, formatSize, collectSchemeFileNames };
// 仅供测试：把内部步骤暴露出去，便于在临时目录上验证统计口径，
// 避免测试必须往真实 core/pool 里塞文件。
module.exports._internals = { walkPool, measureSize };
