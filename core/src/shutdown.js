/**
 * shutdown.js —— 进程退出时 Minecraft 子进程的中央协调器
 *
 * ## 补的是什么缺口
 *
 * 重构前：
 *   - `server.js` 只在**交互 TTY 分支**挂了 `process.once('SIGINT')` → `stop()`；
 *     非交互分支（Web `/api/exec` 拉起的子进程）**没有任何信号处理器**；
 *   - 没有 `SIGTERM` / `SIGHUP`（POSIX 关窗）/ `exit` 兜底；
 *   - `web_service.js` 和 `log_handler.js` 的信号回调直接 `process.exit(0)`，
 *     会抢在异步 `stop()`（最长 30s 发 `stop` 指令）之前结束父进程；
 *   - `spawn` 用 `detached:false`，父进程一死 MC 子进程容易变孤儿/僵尸。
 *
 * 本模块把「当前归本进程管的 MC 子进程」登记下来，统一负责：
 *   1. 幂等的优雅停服（优先交给 ServerManager.stop() 发 `stop` 指令）；
 *   2. 失败时 SIGTERM → 有界等待 → SIGKILL 分级兜底；
 *   3. `exit` 钩子里同步补一刀，杜绝残留；
 *   4. 给所有 `process.exit(0)` 之前提供一个 `await requestStop()`。
 *
 * ## 与「:mc 里 Ctrl+C 不杀服」的关系
 *
 * 本模块**不注册 SIGINT**。单次 Ctrl+C 在 `:mc` 里是「断开 detach」——
 * 由 `server.js._detachConsole()` 归还 readline 租约、父进程继续存活、
 * MC 子进程照常运行，不调用本模块。只有真·终端关闭（SIGTERM/SIGHUP/
 * 关 pty）才走优雅停服。两者共同满足「优雅退出或断开」。
 */

'use strict';

/** @type {{proc:object, stop:Function|null, kill:Function|null, cleanup:Function|null}|null} */
let owner = null;
let stopping = false;
let stopPromise = null;
let signalsInstalled = false;

/**
 * 子进程是否还活着。
 * `process.kill(pid, 0)` 对僵尸也返回成功，所以还要看 exitCode/signalCode。
 */
function _alive(proc) {
    if (!proc || !proc.pid) return false;
    if (proc.exitCode !== null || proc.signalCode !== null) return false;
    try {
        process.kill(proc.pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

/** 本进程是否正持有活着的 MC 子进程 */
function hasOwnedChild() {
    return Boolean(owner && _alive(owner.proc));
}

/** 取回登记信息（诊断用） */
function getOwner() {
    return owner;
}

/** 等子进程退出，最多 timeoutMs 毫秒 */
function _waitExit(proc, timeoutMs) {
    return new Promise(resolve => {
        if (!_alive(proc)) return resolve(true);
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { proc.removeListener('exit', onExit); } catch (e) { /* 忽略 */ }
            clearTimeout(timer);
            resolve(ok);
        };
        const onExit = () => finish(true);
        const timer = setTimeout(() => finish(!_alive(proc)), timeoutMs);
        try { proc.once('exit', onExit); } catch (e) { finish(!_alive(proc)); }
    });
}

/** SIGTERM → 等 → SIGKILL 的分级兜底 */
async function _killEscalation(proc) {
    if (!_alive(proc)) return;
    try { proc.kill('SIGTERM'); }
    catch (e) { try { process.kill(proc.pid, 'SIGTERM'); } catch (e2) { /* 忽略 */ } }
    if (await _waitExit(proc, 5000)) return;
    if (!_alive(proc)) return;
    try { proc.kill('SIGKILL'); }
    catch (e) { try { process.kill(proc.pid, 'SIGKILL'); } catch (e2) { /* 忽略 */ } }
    await _waitExit(proc, 2000);
}

/**
 * 优雅停服（幂等）。并发调用共享同一个 Promise。
 *
 * 优先用登记时注入的 `stop()`（ServerManager.stop()，会先向 MC 写
 * `stop` 指令并等待），失败或没注入时走 SIGTERM → SIGKILL 兜底。
 *
 * @param {string} [reason] 诊断用
 * @returns {Promise<boolean>} 子进程是否已退出
 */
function gracefulStop(reason = '') {
    if (!hasOwnedChild()) return Promise.resolve(false);
    if (stopping) return stopPromise;
    stopping = true;
    const cur = owner;
    stopPromise = (async () => {
        try {
            if (typeof cur.stop === 'function') {
                try { await cur.stop(); } catch (e) { /* 继续走兜底 */ }
            }
            if (!_alive(cur.proc)) return true;
            await _killEscalation(cur.proc);
            return !_alive(cur.proc);
        } finally {
            if (typeof cur.cleanup === 'function') {
                try { await cur.cleanup(); } catch (e) { /* 忽略 */ }
            }
        }
    })();
    return stopPromise;
}

/**
 * 供各处 `process.exit(0)` 之前调用。
 * 没有自己持有的子进程时是 no-op（Web 面板启动的服务端不因 REPL `exit` 被误杀）。
 */
function requestStop(reason = 'request') {
    return gracefulStop(reason);
}

/**
 * `process.on('exit')` 里的同步兜底：异步流程来不及跑完时，
 * 至少保证 MC 进程不会留在系统里。
 */
function syncKillFallback() {
    try {
        if (owner && _alive(owner.proc)) {
            process.kill(owner.proc.pid, 'SIGKILL');
        }
    } catch (e) { /* 忽略 */ }
}

function _installSignals() {
    if (signalsInstalled) return;
    signalsInstalled = true;

    const onSignal = (sig) => {
        // 不主动 process.exit：让 stop() 的异步流程有机会跑完，
        // 事件循环排空后进程自然退出；exit 钩子里还有同步兜底。
        gracefulStop(`signal:${sig}`).catch(() => {});
        try {
            const viewState = require('./view_state');
            viewState.set(viewState.VIEW.SHELL, `shutdown:${sig}`);
        } catch (e) { /* 忽略 */ }
    };

    process.once('SIGTERM', () => onSignal('SIGTERM'));
    if (process.platform !== 'win32') {
        process.once('SIGHUP', () => onSignal('SIGHUP'));
    }
    process.once('exit', syncKillFallback);
}

/**
 * 登记本进程持有的 MC 子进程。两处 spawn 之后都要调。
 *
 * @param {object} proc child_process 返回的 ChildProcess
 * @param {object} [opts]
 * @param {Function} [opts.stop] 优雅停服回调（一般是 ServerManager.stop 的绑定）
 * @param {Function} [opts.cleanup] 收尾回调（清 PID / 清理日志）
 */
function registerMcChild(proc, opts = {}) {
    owner = {
        proc,
        stop: typeof opts.stop === 'function' ? opts.stop : null,
        cleanup: typeof opts.cleanup === 'function' ? opts.cleanup : null
    };
    if (proc && typeof proc.once === 'function') {
        proc.once('exit', () => {
            if (owner && owner.proc === proc) owner = null;
        });
    }
    _installSignals();
}

/** 子进程已正常退出时清掉登记，避免 exit 钩子误 kill 复用过的 PID */
function clear() {
    owner = null;
    stopping = false;
    stopPromise = null;
}

/** 供测试重置（含摘掉信号监听，避免测试进程残留） */
function _reset() {
    clear();
}

module.exports = {
    registerMcChild,
    hasOwnedChild,
    getOwner,
    gracefulStop,
    requestStop,
    syncKillFallback,
    clear,
    _reset
};
