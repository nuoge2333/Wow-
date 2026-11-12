/**
 * log_sink.js —— wow 日志落盘总闸门（执行令 log.disabled）
 * ============================================================
 *
 * 语义（用户已纠正）：`log.disabled=true` 时，wow 自身**不再把日志写入硬盘**，
 * 终端与内存里照常可见；Minecraft 服务端自己写的 `logs/latest.log` 不属于
 * wow 日志，保留。每次正常关服还会把方案 `logs/` 清到只剩 `latest.log`。
 *
 * 全仓所有 wow 侧「写日志文件」的入口都必须经过这里判定，避免各模块各自
 * 读配置导致漏网（执行令硬红线：wow 本体绝对不能产生任何日志文件）：
 *
 *   - log.js             Wow-YYYY-MM-DD.log      （单例 lazyMemory → shouldPersist）
 *   - server.js          wow-stdout.log          （MemoryWriteStream）
 *   - server.js          wow-console.log         （_wowLogTarget / _appendWowLog）
 *   - server.js          子命令 tee              （runWowSubcommand）
 *   - log_handler.js     analysis_report.txt
 *   - tunnel.js          cloudflared.log         ← 本模块纳管
 *   - terracotta.js      .lan-api.log            ← 本模块纳管
 *
 * 只做「该不该落盘」的判定与内存缓冲；**绝不创建 readline、绝不注册信号**，
 * 以免与 stdin_session / shutdown 的职责重叠。
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const config = require('./config');

/** 内存环形缓冲：log.disabled=true 时替代文件写入，供控制台 / :wowlog 读取 */
const buffers = new Map();
const MEMORY_MAX = 2000;

/**
 * 是否允许 wow 日志落盘（默认 true；log.disabled=true 时 false）。
 * 配置不可用时保守沿用原行为（允许落盘），避免异常路径下静默丢日志。
 */
function shouldPersist() {
    try {
        return config.getConfig('log.disabled', false) !== true;
    } catch (e) {
        return true;
    }
}

/** 写一条（可含多行）文本进内存环形缓冲 */
function pushMemory(key, text) {
    if (!key) return;
    if (!buffers.has(key)) buffers.set(key, []);
    const arr = buffers.get(key);
    for (const line of String(text == null ? '' : text).split(/\r?\n/)) {
        if (line.trim()) arr.push(line);
    }
    if (arr.length > MEMORY_MAX) arr.splice(0, arr.length - MEMORY_MAX);
}

/** 取内存缓冲最近 n 行（最旧在前） */
function recent(key, n = 10) {
    const arr = buffers.get(key) || [];
    const k = Math.max(0, Math.floor(n) || 0);
    return arr.slice(-k);
}

/** 清空内存缓冲（传 key 只清一个桶，不传则全清） */
function clearMemory(key) {
    if (key) buffers.delete(key);
    else buffers.clear();
}

/**
 * 追加一行到 wow 日志文件；log.disabled=true 时改入内存缓冲，绝不产生文件。
 * @param {string} file      目标文件绝对路径
 * @param {string} text      要追加的文本
 * @param {string} memoryKey 内存桶名（disabled 时用于回读）
 * @returns {boolean} 是否真的写入了硬盘
 */
function appendLine(file, text, memoryKey) {
    const line = text.endsWith('\n') ? text : text + '\n';
    if (!shouldPersist()) {
        if (memoryKey) pushMemory(memoryKey, line);
        return false;
    }
    try {
        fs.ensureDirSync(path.dirname(file));
        fs.appendFileSync(file, line, 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 打开一个 wow 日志写流；log.disabled=true 时返回内存垫片（write/end 兼容），
 * 不产生任何硬盘文件。调用方仍可照常 `.write()` / `.end()`。
 * @param {string} file
 * @param {string} [memoryKey]
 */
function openStream(file, memoryKey) {
    if (!shouldPersist()) {
        return {
            write(data) {
                if (memoryKey) pushMemory(memoryKey, data.toString('utf8'));
                return true;
            },
            end() { /* 没有文件需要关闭 */ }
        };
    }
    try {
        fs.ensureDirSync(path.dirname(file));
        return fs.createWriteStream(file, { flags: 'w' });
    } catch (e) {
        // 目录不可写时退化为内存垫片，不让启动主路径崩掉
        return {
            write(data) {
                if (memoryKey) pushMemory(memoryKey, data.toString('utf8'));
                return true;
            },
            end() {}
        };
    }
}

/**
 * 把方案 logs/ 清到只剩 latest.log（log.disabled=true 的正常关服收尾）。
 * 目录不存在 / 单个条目失败都不抛；返回删除的条目数。
 * 注意：只在「正常关服」调用，崩溃退出要保留现场。
 * @param {string} logDir
 * @param {string} [keepName]
 */
function keepLatestOnly(logDir, keepName = 'latest.log') {
    let removed = 0;
    try {
        if (!fs.existsSync(logDir)) return 0;
        for (const name of fs.readdirSync(logDir)) {
            if (name === keepName) continue;
            try {
                fs.removeSync(path.join(logDir, name));
                removed++;
            } catch (e) { /* 单个失败不影响整体 */ }
        }
    } catch (e) { /* 清理是收尾动作，失败不抛给调用方 */ }
    return removed;
}

module.exports = {
    shouldPersist,
    pushMemory,
    recent,
    clearMemory,
    appendLine,
    openStream,
    keepLatestOnly
};
