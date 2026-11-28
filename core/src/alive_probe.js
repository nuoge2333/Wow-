#!/usr/bin/env node
/**
 * 跨进程服务器存活探测（Windows 跨进程日志跟踪假死修复 · P0）
 * ----------------------------------------------------------------
 * 背景：
 *   Web 面板启动 MC 后，终端 :mc 视图每 3s 调一次 ServerManager.isRunning()
 *   判活。该方法在 Windows 上走 `tasklist`（execSync, timeout 2000ms）。
 *   MC 刚输出 `Done` 时系统负载最高，tasklist 一旦超时/报错，旧逻辑
 *   `catch → false` 立刻 stopFollow，把仍在运行的服务器误判为「已停止」
 *   并把用户踢回 :wow。
 *
 * 铁律（本模块存在的唯一理由）：
 *   1. 绝不以「日志静默 / 文件无新增」判定服务器已停止——静默只显示状态提示。
 *   2. 单次 PID 探测失败绝不等于服务器已停止——必须连续 N 次「确证死亡」
 *      才允许判停（默认 3 次，约 9s）。
 *   3. PID 文件判活之外，再取 Web 面板 /api/status 作为第二证据：Web 面板
 *      是服务器启动方，它的状态最权威；PID 说死但面板说在跑 → 以面板为准。
 *   4. 任何探测异常 / 超时 / 不确定（如 PID 文件尚不存在）→ 一律保守视为
 *      存活。宁可晚退一步，绝不误踢仍在运行的服务器。
 *
 * 设计：同步 setInterval 只调 tick()（触发异步探测、立即返回快照），
 *       调用方只读 snapshot.certainDead 决定是否退出，避免阻塞事件循环。
 */
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');

/** Web 端口文件，与 web_service.js 中的 WEB_PORT_FILE 保持同一位置 */
const WEB_PORT_FILE = path.join(__dirname, '../.web.port');

/** 连续多少次「确证死亡」才允许判定已停止（每约 3s 探一次 → 约 9s 容错窗口） */
const DEFAULT_DEATH_THRESHOLD = 3;

/**
 * 读取 PID（统一走 ServerManager._readPid，保持与开服/停服同一口径）。
 * @returns {number|null}
 */
function readPid(serverManager) {
    try {
        if (serverManager && typeof serverManager._readPid === 'function') {
            return serverManager._readPid() || null;
        }
    } catch (e) { /* 读不到就是读不到 */ }
    return null;
}

/**
 * 默认 PID 存活检测：复用 ServerManager._isProcessAlive（Windows 走 tasklist）。
 * 返回 false 只是「本次没检测到」，是否判停交给上层 tracker 连续确认。
 * @returns {boolean|null} true=在跑 false=本次未检测到 null=无 PID 可查
 */
function defaultPidProbe(serverManager, pid) {
    if (!pid) return null;
    try {
        if (serverManager && typeof serverManager._isProcessAlive === 'function') {
            return serverManager._isProcessAlive(pid) ? true : false;
        }
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

/** 构造访问 /api/status 的请求头：本机 CLI 可信，就地签短效 JWT（无需登录流程）。 */
function buildHeaders() {
    const headers = { Accept: 'application/json' };
    try {
        const jwt = require('jsonwebtoken');
        const secret = process.env.WOW_WEB_AUTH_TOKEN || config.getConfig('web.auth_token');
        if (secret) {
            headers.Authorization = 'Bearer ' + jwt.sign({ cli: 'alive-probe' }, secret, { expiresIn: '2m' });
        }
    } catch (e) {
        // 本机默认免登录（web.require_login=false），拿不到 token 也照常访问
    }
    return headers;
}

/** 默认 HTTP GET：成功且 running 为布尔时返回该值，其余一律 null（无证据）。 */
async function defaultHttpGet(url, headers, timeout) {
    try {
        const axios = require('axios');
        const resp = await axios.get(url, {
            headers,
            timeout,
            // 401/500 也当作「拿不到证据」，不抛异常干扰上层
            validateStatus: () => true
        });
        if (resp && resp.status === 200 && resp.data && typeof resp.data.running === 'boolean') {
            return resp.data.running;
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 通过 Web 面板 /api/status 判活（第二证据）。
 * 任何不可达 / 401 / 超时都返回 null（无证据），绝不当作「已停止」的证据。
 * @returns {Promise<boolean|null>}
 */
async function httpStatusProbe(opts = {}) {
    const timeout = opts.httpTimeout || 700;
    const httpGet = opts.httpGet || defaultHttpGet;
    let port = 0;
    try {
        if (fs.existsSync(WEB_PORT_FILE)) {
            port = parseInt(fs.readFileSync(WEB_PORT_FILE, 'utf8').trim(), 10) || 0;
        }
    } catch (e) { /* 端口文件读不到就退回配置 */ }
    if (!port) {
        try { port = parseInt(config.getConfig('web.port', 8080), 10) || 0; } catch (e) { /* 忽略 */ }
    }
    if (!port) return null;
    return httpGet(`http://127.0.0.1:${port}/api/status`, buildHeaders(), timeout);
}

/**
 * 单次探测：综合 PID + HTTP 两路证据。
 * @returns {Promise<{alive:boolean|null, certain:boolean, source:string, pid:number|null}>}
 *   alive === null 表示「无法确证」，调用方必须保守视为存活。
 */
async function probeOnce(serverManager, opts = {}) {
    const pidProbe = opts.pidProbe || defaultPidProbe;
    const pid = readPid(serverManager);

    let byPid = null;
    try { byPid = pidProbe(serverManager, pid); } catch (e) { byPid = null; }

    // PID 明确存活 → 立即确认，连 HTTP 都不用问
    if (byPid === true) {
        return { alive: true, certain: true, source: 'pid', pid };
    }

    // PID 说死 / 无 PID → 用 Web 面板状态复核（启动方口径最权威）
    let byHttp = null;
    try { byHttp = await httpStatusProbe(opts); } catch (e) { byHttp = null; }
    if (byHttp === true) {
        return { alive: true, certain: true, source: 'http', pid };
    }

    // 只有 PID 明确报死，才算「一次确证死亡」；仍需 tracker 连续确认
    if (byPid === false) {
        return { alive: false, certain: true, source: 'pid', pid };
    }

    // PID 文件不存在 / 探测异常 → 无法确证，保守视为存活
    return { alive: null, certain: false, source: 'unknown', pid };
}

/**
 * 创建「连续确认」判活跟踪器，供同步 setInterval 调用。
 *
 * tick() 触发一次异步探测（内部防重入），立即返回当前快照；
 * 调用方只读 snapshot.certainDead 决定是否退出跟踪 —— 只有连续
 * deathThreshold 次「确证死亡」才为 true。
 *
 * 关键：探测中 / 探测异常 / 不确定一律 alive=true（保守），
 * 绝不会因为一次 tasklist 超时就把用户踢回 :wow。
 */
function createLivenessTracker(serverManager, opts = {}) {
    const deathThreshold = opts.deathThreshold || DEFAULT_DEATH_THRESHOLD;
    let probing = false;
    let deathCount = 0;
    let lastAlive = true;
    let lastCertainDead = false;
    let lastSource = 'init';
    let lastPid = null;
    let version = 0;

    async function doProbe() {
        if (probing) return;
        probing = true;
        try {
            const r = await probeOnce(serverManager, opts);
            lastSource = r.source;
            lastPid = r.pid;
            version++;
            if (r.alive === true || r.alive === null) {
                // 存活或不确定 → 清零，绝不累计死亡
                deathCount = 0;
                lastAlive = true;
            } else {
                deathCount++;
                lastAlive = deathCount < deathThreshold;
            }
            lastCertainDead = deathCount >= deathThreshold;
        } catch (e) {
            // 探测器自身异常 → 保守视为存活
            deathCount = 0;
            lastAlive = true;
            lastCertainDead = false;
            lastSource = 'error';
        } finally {
            probing = false;
        }
    }

    return {
        /** 触发一次探测（异步，不等待），立即返回当前快照 */
        tick() { void doProbe(); return this.snapshot(); },
        /** 等待一次探测完成（供测试 / 需要立即结果的调用方） */
        refresh() { return doProbe(); },
        snapshot() {
            return {
                alive: lastAlive,
                certainDead: lastCertainDead,
                deathCount,
                source: lastSource,
                pid: lastPid,
                version
            };
        },
        reset() {
            deathCount = 0;
            lastAlive = true;
            lastCertainDead = false;
            lastSource = 'init';
        }
    };
}

module.exports = {
    probeOnce,
    createLivenessTracker,
    readPid,
    defaultPidProbe,
    httpStatusProbe,
    DEFAULT_DEATH_THRESHOLD,
    WEB_PORT_FILE
};
