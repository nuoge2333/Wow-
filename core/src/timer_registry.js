/**
 * 视图定时器统一注册表 —— 绞杀多实例监听泄漏（P0）
 *
 * ## 为什么需要它
 *
 * :mc / :wow / 开服控制台切换时，每进入一次视图就 setInterval 起一个
 * 「日志跟随 / 心跳 / 静默提示」定时器。如果退出视图时漏 clearInterval，
 * 旧定时器仍在跑：
 *   - 多个「暂无新日志」定时器并发 → 提示连刷 N 次；
 *   - 多个日志 tail 定时器读同一文件 → 终端日志双写；
 *   - 旧视图的定时器回调仍往队列投递 → 一条指令被处理多遍。
 *
 * 靠每个调用方自己记得 clearInterval 不可靠（漏一处就复现）。本模块把
 * 「登记 + 全清」下沉到一个地方：凡是与视图生命周期绑定的定时器，一律
 * 通过 track() 登记到自己的 scope；退出/切换视图时 clearScope() 一键全清，
 * 不依赖调用方逐个记得 id。
 *
 * ## 契约
 *
 *   const reg = require('./timer_registry');
 *   reg.track('repl', setInterval(fn, 500));       // 登记
 *   reg.track('repl', setTimeout(fn, 2000), 'timeout');
 *   reg.clearScope('repl');                        // 切出视图：一键全清
 *   reg.clearAll();                                // 进程退出：全部清
 *
 * track() 会原样返回 timer id，调用方拿它额外 clearInterval 也无害
 * （clearScope 幂等：清过的句柄会移出集合）。
 */

/** scope 名 → Set(timerId) */
const scopes = new Map();

/** 把 timer id 登记到 scope，返回原 id（便于调用方链式使用） */
function track(scope, id) {
    if (id === null || id === undefined) return id;
    let set = scopes.get(scope);
    if (!set) { set = new Set(); scopes.set(scope, set); }
    set.add(id);
    return id;
}

/** 清空某个 scope 下全部定时器（interval 与 timeout 统一用 clearInterval，Node 两者通用） */
function clearScope(scope) {
    const set = scopes.get(scope);
    if (!set) return 0;
    let n = 0;
    for (const id of set) {
        try { clearInterval(id); } catch (e) { /* 忽略 */ }
        try { clearTimeout(id); } catch (e) { /* 忽略 */ }
        n++;
    }
    set.clear();
    scopes.delete(scope);
    return n;
}

/** 清空全部 scope（进程退出兜底） */
function clearAll() {
    let n = 0;
    for (const scope of Array.from(scopes.keys())) n += clearScope(scope);
    return n;
}

/** 某 scope 当前登记的定时器数量（诊断/测试用） */
function size(scope) {
    const set = scopes.get(scope);
    return set ? set.size : 0;
}

/** 当前所有 scope 名（诊断/测试用） */
function scopeNames() {
    return Array.from(scopes.keys());
}

/** 测试重置：清空全部登记（不清实际定时器，仅清登记表） */
function _reset() {
    scopes.clear();
}

module.exports = { track, clearScope, clearAll, size, scopeNames, _reset };
