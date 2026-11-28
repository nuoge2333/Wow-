#!/usr/bin/env node
/**
 * 多实例监听泄漏绞杀 —— 回归守卫（P0）
 * ----------------------------------------------------------------
 * 盯用户报告的四个症状的根因防线：
 *   1. 指令发两遍 / MC 收到两次报错  → 视图退出必须摘 line/SIGINT 监听；
 *   2. 终端日志双写                  → 定时器统一登记、退出一键全清；
 *   3. 「暂无新日志」心跳连刷 4 次    → 每个 scope 同时最多一个心跳定时器；
 *   4. 提示符跳回旧视图              → 视图切换强制复位提示符 + 退订 onChange。
 *
 * 静态源码断言 + timer_registry 运行时单元测试。
 * 运行：node test/listener_leak.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const cli = read('cli.js');
const srv = read('server.js');
const mc = read('mc_console.js');
const stdinSession = read('stdin_session.js');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n=== 多实例监听泄漏绞杀守卫（P0）===\n');

console.log('— timer_registry：定时器 Set 登记与一键全清 —');
const reg = require('../src/timer_registry');

check('track/clearScope：同 scope 多个定时器一次清空', () => {
    reg._reset();
    let a = setInterval(() => {}, 100000);
    let b = setInterval(() => {}, 100000);
    reg.track('s', a); reg.track('s', b);
    assert.strictEqual(reg.size('s'), 2, '登记数应为 2');
    const n = reg.clearScope('s');
    assert.strictEqual(n, 2, '应清掉 2 个');
    assert.strictEqual(reg.size('s'), 0, '清空后应为 0');
    clearInterval(a); clearInterval(b); // 兜底，避免测试进程被吊住
});

check('clearScope 幂等：重复清空返回 0 不抛错', () => {
    reg._reset();
    assert.strictEqual(reg.clearScope('none'), 0);
    const id = setInterval(() => {}, 100000);
    reg.track('s', id);
    assert.strictEqual(reg.clearScope('s'), 1);
    assert.strictEqual(reg.clearScope('s'), 0);
    clearInterval(id);
});

check('clearAll：跨 scope 一次全清', () => {
    reg._reset();
    const ids = [setInterval(() => {}, 100000), setInterval(() => {}, 100000)];
    reg.track('a', ids[0]); reg.track('b', ids[1]);
    assert.strictEqual(reg.scopeNames().length, 2);
    reg.clearAll();
    assert.strictEqual(reg.scopeNames().length, 0);
    ids.forEach(clearInterval);
});

check('track 忽略无效 id', () => {
    reg._reset();
    reg.track('s', null);
    reg.track('s', undefined);
    assert.strictEqual(reg.size('s'), 0);
});

console.log('\n— stdin_session：全局唯一 activeReadline + 强制摘监听 —');

check('导出全局唯一 activeReadline 指针', () => {
    if (!/function activeReadline\(\)/.test(stdinSession)) throw new Error('缺 activeReadline()');
    if (!/activeReadline,/.test(stdinSession)) throw new Error('activeReadline 未导出');
});

check('teardown 强制 removeAllListeners(line/SIGINT/close)', () => {
    const m = stdinSession.match(/function teardown\(\)[\s\S]{0,1400}?emitProbe\('TEARDOWN'\)/);
    if (!m) throw new Error('未找到 teardown 清理块');
    for (const ev of ['line', 'SIGINT', 'close']) {
        if (!new RegExp(`removeAllListeners\\('${ev}'\\)`).test(m[0])) {
            throw new Error(`teardown 未摘 ${ev} 监听`);
        }
    }
});

check('stats 暴露 activeLineListeners 诊断字段', () => {
    if (!/activeLineListeners/.test(stdinSession)) throw new Error('缺 activeLineListeners 诊断');
});

console.log('\n— cli.js：REPL 退出的定时器全清（核心泄漏点）—');

check('close 回调在最前面无条件 clearAllReplTimers', () => {
    const m = cli.match(/rl\.on\('close',\s*async\s*\(\)\s*=>\s*\{[\s\S]{0,500}?clearAllReplTimers\(\)/);
    if (!m) throw new Error('close 回调未在开头无条件清定时器');
});

check('clearAllReplTimers 覆盖 follow/detect/boot 三档 scope', () => {
    // 三档 scope 汇总进 allReplScopes，clearAllReplTimers 遍历它一键全清。
    const arr = cli.match(/const allReplScopes = \[([^\]]+)\]/);
    if (!arr) throw new Error('未找到 allReplScopes 汇总');
    for (const s of ['SCOPE_FOLLOW', 'SCOPE_DETECT', 'SCOPE_BOOT']) {
        if (!arr[1].includes(s)) throw new Error(`allReplScopes 漏了 ${s}`);
    }
    const m = cli.match(/const clearAllReplTimers[\s\S]{0,500}?following = false;/);
    if (!m) throw new Error('未找到 clearAllReplTimers');
    if (!/allReplScopes\.forEach/.test(m[0]) && !/allReplScopes/.test(m[0])) {
        throw new Error('clearAllReplTimers 未遍历 allReplScopes');
    }
});

check('2s 兜底 setTimeout 已保存 id 且受 closed 守卫', () => {
    const m = cli.match(/bootTimer = setTimeout\([\s\S]{0,400}?\}, 2000\)/);
    if (!m) throw new Error('兜底 setTimeout 未保存为 bootTimer');
    if (!/if \(closed\) return;/.test(m[0])) throw new Error('兜底定时器缺 closed 守卫');
    if (!/timerReg\.track\(SCOPE_BOOT, bootTimer\)/.test(cli)) throw new Error('bootTimer 未登记');
});

check('3s detectTimer 与 500ms followTimer 均已登记', () => {
    if (!/timerReg\.track\(SCOPE_DETECT, detectTimer\)/.test(cli)) throw new Error('detectTimer 未登记');
    if (!/timerReg\.track\(SCOPE_FOLLOW, followTimer\)/.test(cli)) throw new Error('followTimer 未登记');
});

check(':mc 视图指令走单一 enqueueConsoleCommand，未直接 stdin.write', () => {
    const m = cli.match(/if \(currentView\(\) === 'mc'\)[\s\S]{0,2200}?\/\/ ===== \/P0 输入路由/);
    if (!m) throw new Error('未找到 :mc 输入路由块');
    const calls = (m[0].match(/enqueueConsoleCommand\(/g) || []).length;
    if (calls !== 1) throw new Error(`:mc 块内 enqueueConsoleCommand 调用 ${calls} 次（应为 1）`);
    if (/process\.stdin\.write/.test(m[0])) throw new Error(':mc 块内出现直接的 stdin.write（会双写）');
});

console.log('\n— server.js：开服控制台往返切换的监听清理 —');

check('_releaseConsoleRl 拆 rl 前摘 line/SIGINT', () => {
    const m = srv.match(/async _releaseConsoleRl\(\)[\s\S]{0,700}?_consoleLease = null;/);
    if (!m) throw new Error('未找到 _releaseConsoleRl');
    if (!/removeAllListeners\('line'\)/.test(m[0])) throw new Error('未摘 line 监听');
    if (!/removeAllListeners\('SIGINT'\)/.test(m[0])) throw new Error('未摘 SIGINT 监听');
});

check('_enterReplFromConsole 的 finish 摘 line/SIGINT', () => {
    const m = srv.match(/const finish = async \(\) => \{[\s\S]{0,700}?resolve\(\);/);
    if (!m) throw new Error('未找到 :wow finish');
    if (!/removeAllListeners\('line'\)/.test(m[0])) throw new Error('finish 未摘 line 监听');
});

check('_mcSilenceTimer 登记 scope 且重建前先清', () => {
    if (!/timerRegistry\.track\(SILENCE_TIMER_SCOPE, this\._mcSilenceTimer\)/.test(srv)) {
        throw new Error('_mcSilenceTimer 未登记');
    }
    if (!/timerRegistry\.clearScope\(SILENCE_TIMER_SCOPE\)/.test(srv)) {
        throw new Error('_mcSilenceTimer 重建前未清旧');
    }
});

console.log('\n— mc_console.js：顶层 :mc 视图的定时器与监听清理 —');

check('attach 进入前先 clearScope，timer 登记 scope', () => {
    if (!/timerRegistry\.clearScope\(FOLLOW_TIMER_SCOPE\)/.test(mc)) throw new Error('进入前未清旧定时器');
    if (!/timerRegistry\.track\(FOLLOW_TIMER_SCOPE, this\.timer\)/.test(mc)) throw new Error('timer 未登记');
});

check('finish 退出时清 scope + 摘 line/SIGINT', () => {
    const m = mc.match(/const finish = async \(reason[\s\S]{0,1200}?resolve\(\);/);
    if (!m) throw new Error('未找到 mc finish');
    if (!/timerRegistry\.clearScope\(FOLLOW_TIMER_SCOPE\)/.test(m[0])) throw new Error('finish 未清 timer scope');
    if (!/removeAllListeners\('line'\)/.test(m[0])) throw new Error('finish 未摘 line 监听');
});

check(':mc 视图输入单一 enqueueConsoleCommand', () => {
    const m = mc.match(/action === 'mc'[\s\S]{0,500}?rl\.prompt\(\);/);
    if (!m) throw new Error('未找到 :mc 转发块');
    const calls = (m[0].match(/enqueueConsoleCommand\(/g) || []).length;
    if (calls !== 1) throw new Error(`enqueueConsoleCommand 调用 ${calls} 次（应为 1）`);
});

console.log(`\n==================================================`);
console.log(failed ? `❌ 失败 ${failed} 项 / 通过 ${passed} 项` : `✅ 全部通过：${passed} 项`);
process.exit(failed ? 1 : 0);
