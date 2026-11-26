#!/usr/bin/env node
/**
 * 单方案多存档管理 + 服务器图标生态（V3.x）
 *
 * 架构约束：
 *  - 方案(Scheme) = 运行环境；内部可有任意多个存档(World)，统一收拢到 <scheme>/saves/。
 *  - server.properties 的所有写操作必须走 ServerProps.writeProps（等价于 Web 的 config server
 *    接口 /api/props），保留注释与格式；本模块绝不 fs.writeFileSync 整个 server.properties。
 *  - 图标文件几 KB，绝不进 Pool 哈希系统；素材库只做 fs.copyFileSync 物理复制，不写 pool/index.yaml。
 *
 * 本模块的函数大多接受显式 schemePath，便于测试隔离；web_service 负责把「当前方案」解析后传入。
 */
const fs = require('fs-extra');
const path = require('path');
const ServerProps = require('./server_props');
const utils = require('./utils');

const SAVES_DIR = 'saves';
const LEGACY_WORLDS = ['world', 'world_nether', 'world_the_end'];
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const LEVEL_TYPES = ['normal', 'flat', 'large_biomes', 'amplified'];

/** 存档名合法性（必填，^[a-zA-Z0-9_-]+$） */
function isValidWorldName(name) {
    return typeof name === 'string' && NAME_RE.test(name.trim()) &&
        name.trim() !== '' && name.trim().length <= 64;
}

/** saves 目录绝对路径 */
function savesDir(schemePath) {
    return path.join(schemePath, SAVES_DIR);
}

/** 读取当前 level-name（可能是 'world' 或 'saves/xxx'）；不存在时为 null */
function getCurrentLevelName(schemePath) {
    try {
        const props = ServerProps.readProps(schemePath);
        return (props.values && props.values['level-name']) || null;
    } catch (e) {
        return null;
    }
}

/** 把 level-name 解析为相对 schemePath 的存档目录（去掉前导 ./，兼容反斜杠） */
function levelNameToRel(levelName) {
    const raw = String(levelName || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return raw || 'world';
}

/**
 * 扫描 saves/ 下所有含 level.dat 的子目录。
 * @returns {Array<{name, dir, levelDatSize, active}>}
 */
function listWorlds(schemePath, activeLevelName) {
    const dir = savesDir(schemePath);
    const out = [];
    if (!fs.existsSync(dir)) return out;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (e) { return out; }
    const activeRel = levelNameToRel(activeLevelName == null ? getCurrentLevelName(schemePath) : activeLevelName);
    for (const name of entries.sort()) {
        const worldDir = path.join(dir, name);
        try {
            if (!fs.statSync(worldDir).isDirectory()) continue;
        } catch (e) { continue; }
        const levelDat = path.join(worldDir, 'level.dat');
        if (!fs.existsSync(levelDat)) continue;
        let size = 0;
        try { size = fs.statSync(levelDat).size; } catch (e) {}
        out.push({
            name,
            dir: worldDir,
            rel: `${SAVES_DIR}/${name}`,
            levelDatSize: size,
            active: activeRel === `${SAVES_DIR}/${name}` || activeRel === name
        });
    }
    return out;
}

/**
 * 旧数据安全迁移：若方案根存在 world/ 且 level-name 指向 world（或缺失），
 * 把 world / world_nether / world_the_end 物理移动到 saves/ 下，并改 level-name=saves/world。
 *
 * 幂等：若 world 已不在根目录、或 saves/world 已存在，则跳过对应步骤，不丢档。
 * @returns {{migrated:boolean, moved:string[], reason?:string}}
 */
function migrateLegacyWorld(schemePath) {
    const result = { migrated: false, moved: [] };
    if (!fs.existsSync(schemePath)) return result;

    const levelName = getCurrentLevelName(schemePath);
    // 触发条件：level-name 为 world（含缺省 null → 视为传统 world），且根目录确有 world/
    const pointsToLegacy = !levelName || levelName === 'world' || levelName === './world';
    const rootWorld = path.join(schemePath, 'world');
    if (!pointsToLegacy || !fs.existsSync(rootWorld)) return result;

    const saves = savesDir(schemePath);
    fs.ensureDirSync(saves);

    for (const w of LEGACY_WORLDS) {
        const src = path.join(schemePath, w);
        const dst = path.join(saves, w);
        if (!fs.existsSync(src)) continue;
        if (fs.existsSync(dst)) continue; // 目标已存在，绝不覆盖，防丢档
        fs.moveSync(src, dst, { overwrite: false });
        result.moved.push(w);
    }

    // 只有确实搬动了 world 才改 level-name（纯空目录也搬，保证指向正确）
    const w = ServerProps.writeProps(schemePath, { 'level-name': `${SAVES_DIR}/world` });
    if (!w.ok) {
        return { migrated: false, moved: result.moved, reason: w.reason };
    }
    result.migrated = true;
    return result;
}

/**
 * 新建存档：必须服务器停止后调用（运行拦截由调用方/API 层负责）。
 * @param {string} schemePath
 * @param {{name:string, seed?:string, levelType?:string}} opts
 * @returns {{ok:boolean, reason?:string, name?:string, rel?:string, dir?:string}}
 */
function createWorld(schemePath, opts = {}) {
    const name = String(opts.name || '').trim();
    if (!isValidWorldName(name)) {
        return { ok: false, reason: '存档名只能包含英文字母、数字、下划线和连字符（^[a-zA-Z0-9_-]+$）' };
    }
    const levelType = String(opts.levelType || 'normal').trim();
    if (!LEVEL_TYPES.includes(levelType)) {
        return { ok: false, reason: `世界类型必须是以下之一：${LEVEL_TYPES.join(', ')}` };
    }

    const rel = `${SAVES_DIR}/${name}`;
    const worldDir = path.join(schemePath, SAVES_DIR, name);
    if (fs.existsSync(worldDir)) {
        return { ok: false, reason: `存档「${name}」已存在` };
    }

    fs.ensureDirSync(worldDir);
    const updates = {
        'level-name': rel,
        'level-type': levelType
    };
    const seed = String(opts.seed || '').trim();
    if (seed) updates['level-seed'] = seed;
    else updates['level-seed'] = ''; // 留空即随机，显式清空旧种子

    const w = ServerProps.writeProps(schemePath, updates);
    if (!w.ok) {
        // 配置写入失败：回滚刚建的目录，避免留下无主空档
        try { fs.removeSync(worldDir); } catch (e) {}
        return { ok: false, reason: w.reason };
    }
    return { ok: true, name, rel, dir: worldDir };
}

/**
 * 切换存档：改 level-name=saves/<name>。目标必须存在 level.dat。
 * @returns {{ok:boolean, reason?:string, rel?:string}}
 */
function switchWorld(schemePath, name) {
    const clean = String(name || '').trim();
    if (!isValidWorldName(clean)) {
        return { ok: false, reason: '存档名不合法' };
    }
    const worldDir = path.join(schemePath, SAVES_DIR, clean);
    if (!fs.existsSync(path.join(worldDir, 'level.dat'))) {
        return { ok: false, reason: `存档「${clean}」不存在或不是有效存档（缺少 level.dat）` };
    }
    const rel = `${SAVES_DIR}/${clean}`;
    const w = ServerProps.writeProps(schemePath, { 'level-name': rel });
    if (!w.ok) return { ok: false, reason: w.reason };
    return { ok: true, rel };
}

/** 删除存档（不在本轮需求，但留出安全实现，禁止删当前激活档由调用方判定） */
function removeWorld(schemePath, name) {
    const clean = String(name || '').trim();
    if (!isValidWorldName(clean)) return { ok: false, reason: '存档名不合法' };
    if (levelNameToRel(getCurrentLevelName(schemePath)) === `${SAVES_DIR}/${clean}`) {
        return { ok: false, reason: '不能删除当前正在使用的存档' };
    }
    const worldDir = path.join(schemePath, SAVES_DIR, clean);
    if (!fs.existsSync(worldDir)) return { ok: false, reason: '存档不存在' };
    fs.removeSync(worldDir);
    return { ok: true };
}

// ==================== 服务器图标 ====================

/** 素材库目录（core/pool/icons），独立于哈希池 */
function iconsPoolDir() {
    return utils.getPoolPath('icons');
}

/**
 * 计算当前方案的双写路径：
 *  - serverIcon: <scheme>/server-icon.png（多人游戏列表）
 *  - worldIcon:  <scheme>/<level-name>/icon.png（单人/局域网列表）
 */
function iconTargets(schemePath) {
    const levelRel = levelNameToRel(getCurrentLevelName(schemePath));
    const levelDir = path.resolve(schemePath, levelRel);
    // 防越界：level-name 不得逃出方案目录
    const base = path.resolve(schemePath) + path.sep;
    if (levelDir !== path.resolve(schemePath) && !levelDir.startsWith(base)) {
        throw new Error(`level-name 指向方案目录之外：${levelRel}`);
    }
    return {
        serverIcon: path.join(schemePath, 'server-icon.png'),
        worldIcon: path.join(levelDir, 'icon.png'),
        levelRel
    };
}

/**
 * 保存图标（PNG Buffer）：双写 server-icon.png + <level-name>/icon.png。
 * @param {string} schemePath
 * @param {Buffer} pngBuf
 * @param {{toPool?:boolean, poolName?:string}} opts
 * @returns {{ok:boolean, reason?:string, serverIcon?:string, worldIcon?:string, poolPath?:string}}
 */
function saveIcon(schemePath, pngBuf, opts = {}) {
    try {
        if (!Buffer.isBuffer(pngBuf) || pngBuf.length === 0) {
            return { ok: false, reason: '图标数据为空' };
        }
        // 校验 PNG 签名，拒收非图片内容
        const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (pngBuf.length < 8 || !pngBuf.subarray(0, 8).equals(sig)) {
            return { ok: false, reason: '图标必须是 PNG 格式' };
        }
        const targets = iconTargets(schemePath);
        fs.ensureDirSync(path.dirname(targets.serverIcon));
        fs.ensureDirSync(path.dirname(targets.worldIcon));
        fs.writeFileSync(targets.serverIcon, pngBuf);
        fs.writeFileSync(targets.worldIcon, pngBuf);

        let poolPath = null;
        if (opts.toPool) {
            const pool = iconsPoolDir();
            fs.ensureDirSync(pool);
            const rawName = String(opts.poolName || '').trim();
            const fileName = (isValidWorldName(rawName.replace(/\.png$/i, ''))
                ? rawName.replace(/\.png$/i, '') : `icon-${Date.now()}`) + '.png';
            poolPath = path.join(pool, fileName);
            // 物理复制，绝不写 pool/index.yaml，绝不进哈希系统
            fs.copyFileSync(targets.serverIcon, poolPath);
        }
        return { ok: true, serverIcon: targets.serverIcon, worldIcon: targets.worldIcon, poolPath };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

/** 列出素材库图标（core/pool/icons/*.png） */
function listPoolIcons() {
    const pool = iconsPoolDir();
    const out = [];
    if (!fs.existsSync(pool)) return out;
    let entries = [];
    try { entries = fs.readdirSync(pool); } catch (e) { return out; }
    for (const name of entries.sort()) {
        if (!/\.png$/i.test(name)) continue;
        const file = path.join(pool, name);
        try {
            if (!fs.statSync(file).isFile()) continue;
        } catch (e) { continue; }
        out.push({ name, file, size: fs.statSync(file).size });
    }
    return out;
}

/** 应用素材库图标：从 pool/icons 物理复制到当前方案的 server-icon.png + <level>/icon.png */
function applyPoolIcon(schemePath, poolName) {
    try {
        const clean = String(poolName || '').trim();
        if (!clean || clean.includes('/') || clean.includes('\\') || clean === '..' || clean === '.') {
            return { ok: false, reason: '素材名不合法' };
        }
        if (!/\.png$/i.test(clean)) return { ok: false, reason: '素材必须是 PNG' };
        const src = path.join(iconsPoolDir(), clean);
        if (!fs.existsSync(src)) return { ok: false, reason: '素材不存在' };
        const targets = iconTargets(schemePath);
        fs.ensureDirSync(path.dirname(targets.serverIcon));
        fs.ensureDirSync(path.dirname(targets.worldIcon));
        fs.copyFileSync(src, targets.serverIcon);
        fs.copyFileSync(src, targets.worldIcon);
        return { ok: true, serverIcon: targets.serverIcon, worldIcon: targets.worldIcon };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

module.exports = {
    SAVES_DIR,
    LEGACY_WORLDS,
    NAME_RE,
    LEVEL_TYPES,
    isValidWorldName,
    savesDir,
    getCurrentLevelName,
    levelNameToRel,
    listWorlds,
    migrateLegacyWorld,
    createWorld,
    switchWorld,
    removeWorld,
    iconsPoolDir,
    iconTargets,
    saveIcon,
    listPoolIcons,
    applyPoolIcon
};
