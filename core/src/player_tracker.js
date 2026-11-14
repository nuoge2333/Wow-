#!/usr/bin/env node
/**
 * 玩家行为追踪（V3.8.0，P1）
 *
 * 从方案目录的 logs/latest.log 提取「谁进过服务器」：
 *   - 正则 `([a-zA-Z0-9_]{3,16}) joined the game` 抓玩家 ID；
 *   - 落盘到 scheme/<方案>/scheme.yaml 的 known_players（去重 + 首次加入时间）。
 *
 * 铁律③（大文件读取）：
 *   **禁止 readFileSync 读整个日志**。latest.log 可以长到几百 MB，
 *   整文件读进内存会把面板 / CLI 撑爆。这里：
 *     1. 先 fs.statSync 拿文件大小；
 *     2. 只从「末尾最多 5MB」的位置开 `createReadStream({ start })`；
 *     3. 边读边按行匹配，内存中只保留一个未完成行 + 去重后的 ID 集合。
 *   从中间起读会截断首行，故 start>0 时丢弃第一段（标准尾部回溯做法）。
 *
 * 本版以「手动刷新 / 下载或启动后触发」为主，不做常驻 fs.watch，避免常驻开销。
 */

const path = require('path');
const fs = require('fs-extra');
const { PlayerManager } = require('./player_manager');

/** 尾部回溯窗口上限（字节） */
const MAX_TAIL_BYTES = 5 * 1024 * 1024;

/** MC 日志里玩家加入的那一行 */
const JOIN_RE = /([a-zA-Z0-9_]{3,16}) joined the game/;

/**
 * 从日志尾部流式提取玩家 ID（去重，保持出现顺序）。
 * @param {string} logPath
 * @param {number} start 起始字节偏移
 * @returns {Promise<string[]>}
 */
function collectJoinedIds(logPath, start) {
    return new Promise((resolve, reject) => {
        const ids = new Set();
        let carry = '';
        let dropFirstLine = start > 0; // 从中间起读，首行可能是半截

        const stream = fs.createReadStream(logPath, { start, encoding: 'utf8' });

        const takeLine = (line) => {
            const m = JOIN_RE.exec(line);
            if (m) ids.add(m[1]);
        };

        stream.on('data', (chunk) => {
            const text = carry + chunk;
            const lines = text.split(/\r?\n/);
            carry = lines.pop() || '';           // 最后一段可能不完整，留到下一块
            for (let i = 0; i < lines.length; i++) {
                if (dropFirstLine) { dropFirstLine = false; continue; }
                takeLine(lines[i]);
            }
        });
        stream.on('end', () => {
            // 文件末尾没有换行符时，最后一段也是完整一行
            if (carry && !dropFirstLine) takeLine(carry);
            resolve([...ids]);
        });
        stream.on('error', reject);
    });
}

/**
 * 扫描一个方案的 latest.log，把新玩家合并进 known_players。
 * @param {string} [schemeName] 方案名（缺省用当前激活方案）
 * @param {Object} [opts]
 * @param {Object} [opts.playerManager] 注入 PlayerManager（测试用）
 * @param {Object} [opts.schemeManager] 注入 SchemeManager（测试用）
 * @param {number} [opts.maxTailBytes] 覆盖回溯窗口（测试用）
 * @returns {Promise<{added:number, total:number, bytesRead:number, ids:string[]}>}
 */
async function scanScheme(schemeName, opts = {}) {
    const pm = opts.playerManager || new PlayerManager({
        schemeManager: opts.schemeManager,
        server: opts.server
    });
    const name = pm.resolveScheme(schemeName);
    const logPath = path.join(pm.getSchemeDir(name), 'logs', 'latest.log');

    if (!fs.existsSync(logPath)) {
        return { added: 0, total: countKnown(pm, name), bytesRead: 0, ids: [] };
    }

    const size = fs.statSync(logPath).size;
    const maxTail = opts.maxTailBytes || MAX_TAIL_BYTES;
    const start = Math.max(0, size - maxTail);
    const ids = await collectJoinedIds(logPath, start);
    const merged = pm.mergePlayers(name, ids);
    return {
        added: merged.added,
        total: merged.total,
        bytesRead: size - start,
        ids
    };
}

function countKnown(pm, name) {
    return pm.listPlayers(name).length;
}

/**
 * 直接把一组 ID 落盘到 known_players（供 Web / 其它调用方使用）。
 * @param {string} schemeName
 * @param {string[]} ids
 * @param {Object} [opts] 可注入 playerManager / schemeManager
 */
function recordPlayers(schemeName, ids, opts = {}) {
    const pm = opts.playerManager || new PlayerManager({
        schemeManager: opts.schemeManager,
        server: opts.server
    });
    return pm.mergePlayers(schemeName, ids);
}

module.exports = {
    scanScheme,
    recordPlayers,
    collectJoinedIds,
    JOIN_RE,
    MAX_TAIL_BYTES
};
