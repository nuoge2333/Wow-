/**
 * view_state.js —— 五大视图的单一事实源
 *
 * ## 为什么需要
 *
 * 重构前「当前在哪个视图」这件事散落在三处：`server.js._mode`（mc/wow/lan
 * 三视图）、`cli.js` 的 `startRepl()`（长命令 REPL）、`interactive.js` 的菜单。
 * 三者互不知晓，于是「Web 面板触发启服时该不该自动切到实时日志」这类
 * 问题只能靠猜。统一到这里之后，判断只有一处：`viewState.current()`。
 *
 * ## 五大视图
 *
 * | 标识 | 含义 | 终端里是否渲染 |
 * |------|------|----------------|
 * | `shell` | 外部终端（未进入 wow 进程） | 否，仅作流转起点 |
 * | `menu`  | `:m` 数字菜单 / CLI 引导 | 是（TUI） |
 * | `wow`   | `:wow` 长命令 REPL | 是 |
 * | `mc`    | `:mc` Minecraft 实时日志 / 开服控制台 | 是 |
 * | `web`   | `:web` Web 页面 | 否，逻辑标识（浏览器面板） |
 *
 * `:web` 不是终端视图：执行令的流转矩阵里 `wow web start` 是「启动 Web
 * 服务后进入 `:wow`」，浏览器里的页面由 Web 服务进程自行标记。终端内输入
 * `:web` 只打印面板地址、不改变当前视图，避免凭空造出第二个 stdin 消费者。
 *
 * ## 硬约束
 *
 * 本模块**只存状态，绝不创建 readline**。全项目唯一的 readline 入口是
 * `stdin_session.js`；新增视图流转时不得绕过它。
 */

'use strict';

/** 视图标识（冻结，避免拼写漂移） */
const VIEW = Object.freeze({
    SHELL: 'shell',
    MENU: 'menu',
    WOW: 'wow',
    MC: 'mc',
    WEB: 'web'
});

/** 给人看的标签 */
const VIEW_LABEL = Object.freeze({
    shell: 'shell 外部终端',
    menu: ':m 菜单',
    wow: ':wow 长命令',
    mc: ':mc 实时日志',
    web: ':web Web 页面'
});

/**
 * 切换指令别名 → 视图。
 *
 * 注意：旧的 `:lan`（陶瓦联机控制台）已从视图中删除，这里**不留**任何
 * lan 别名。陶瓦联机功能本身仍在 `:m` 的 R 页与 `terracotta.js` 里。
 */
const SWITCH_ALIASES = Object.freeze({
    ':m': 'menu', ':menu': 'menu', ':菜单': 'menu',
    ':wow': 'wow', ':2': 'wow', ':长命令': 'wow',
    ':mc': 'mc', ':minecraft': 'mc', ':1': 'mc', ':服务端': 'mc',
    ':web': 'web'
});

let currentView = VIEW.SHELL;
let previousView = null;
const listeners = [];

/** 当前视图标识 */
function current() {
    return currentView;
}

/** 上一个视图标识（用于「回上一级」） */
function previous() {
    return previousView;
}

/** 当前/指定视图的文字标签 */
function label(v = currentView) {
    return VIEW_LABEL[v] || String(v);
}

/** 是否处于某视图 */
function is(v) {
    return currentView === v;
}

/**
 * 切换视图。同一视图重复 set 是 no-op（不触发订阅）。
 *
 * @param {string} v VIEW 之一
 * @param {string} [reason] 诊断用，说明是谁触发的
 * @returns {string} 切换后的视图
 */
function set(v, reason = '') {
    if (!Object.prototype.hasOwnProperty.call(VIEW_LABEL, v)) {
        throw new Error(`[view_state] 未知视图: ${v}`);
    }
    if (v === currentView) return currentView;
    previousView = currentView;
    currentView = v;
    for (const fn of listeners.slice()) {
        try { fn(v, previousView, reason); } catch (e) { /* 订阅者不得影响状态机 */ }
    }
    return v;
}

/**
 * 订阅视图变化。
 * @param {(next:string, prev:string, reason:string)=>void} fn
 * @returns {()=>void} 取消订阅
 */
function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.push(fn);
    return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
    };
}

/**
 * 把一行输入解析成目标视图（命中不了返回 null）。
 * 大小写不敏感，方便终端里手敲。
 */
function resolve(input) {
    const key = String(input == null ? '' : input).trim().toLowerCase();
    return SWITCH_ALIASES[key] || null;
}

/** 供测试重置（不影响实际进程行为） */
function _reset() {
    currentView = VIEW.SHELL;
    previousView = null;
    listeners.length = 0;
}

module.exports = {
    VIEW,
    VIEW_LABEL,
    SWITCH_ALIASES,
    current,
    previous,
    label,
    is,
    set,
    onChange,
    resolve,
    _reset
};
