#!/usr/bin/env node
/**
 * Windows Web 端开房「房间号闪一下又变未开房」——回归测试
 * ----------------------------------------------------------------
 * 现象：Web 面板开陶瓦成功，CLI 也拿到了房间号，但前端房间号闪现一下
 *       又被刷成「未开房」；Edge 开发者工具无 JS 报错。
 *
 * 链路：lan.html 的 btnHost 成功回调先用 /lan/host 的响应显示房间号，
 *       随即调用 refresh() → /api/lan/status → getStatus()。若 getStatus()
 *       返回 running:false，refresh() 就把房间号擦成「—」，这正是「闪一下」。
 *
 * 两处根因（本测试锁定）：
 *   1. readState() 曾在进程内缓存 _state 且永不重读。陶瓦状态由 web 面板、
 *      CLI、auto_room 子进程等多进程写入，某进程会一直看到自己第一次读到的
 *      旧值；必须每次从 .lan.json 重读。
 *   2. getStatus() 曾在探测本地 HTTP API 之前先用 isAlive(st.pid) 门控。
 *      Windows 下陶瓦启动器孵化守护后自身退出、child.pid 失效，PID 判活误报
 *      已停；房间号本身来自该 API，理应以 API 响应为权威判活，PID 仅兜底。
 *
 * 本测试为纯静态源码断言，不依赖真实陶瓦二进制 / 网络。
 * 运行：node test/terracotta_status_flash.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'terracotta.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
function fnBody(name) {
    const i = src.indexOf(name);
    assert.ok(i >= 0, `未找到 ${name}`);
    const rest = src.slice(i);
    const j = rest.indexOf('\n}');
    return j > 0 ? rest.slice(0, j) : rest.slice(0, 3000);
}

console.log('\n— Web 开房房间号闪现回归 —');

check('readState 每次从磁盘重读，不做进程内永不失效的缓存', () => {
    const body = fnBody('function readState()');
    assert.ok(/fs\.readJsonSync\(STATE_FILE\)/.test(body), '未从 STATE_FILE 重读');
    assert.ok(!/if \(_state\) return _state/.test(body),
        '仍存在「命中缓存即提前返回」的陈旧读法（跨进程看不到新房间号）');
});

check('getStatus 以本地 HTTP API 响应为权威判活（apiState/apiMeta）', () => {
    const body = fnBody('async function getStatus()');
    assert.ok(/Promise\.allSettled\(\[\s*apiState\(st\.port\),\s*apiMeta\(st\.port\)\s*\]\)/.test(body),
        '未并发探测 apiState/apiMeta（API 通 = 房间在跑）');
    assert.ok(/apiAlive\s*=\s*stateRes\.status === 'fulfilled'\s*\|\|\s*metaRes\.status === 'fulfilled'/.test(body),
        '未据 API 响应计算 apiAlive');
});

check('getStatus 仅在 API 不通时才退回 PID 判活（不再前置门控）', () => {
    const body = fnBody('async function getStatus()');
    assert.ok(/if \(!apiAlive && !isAlive\(st\.pid\)\)/.test(body),
        '判活门控不是「API 不通 且 PID 已死」——仍可能因 PID 误报把在跑的房间判停');
    // 旧逻辑：进入函数就 !isAlive 提前返回，必须先移除
    assert.ok(!/if \(!st \|\| !st\.running \|\| !st\.port \|\| !isAlive\(st\.pid\)\)/.test(body),
        '仍保留「先于 API 探测的 isAlive 前置门控」');
});

check('getStatus 仍返回房间号并保留 mode/player 契约', () => {
    const body = fnBody('async function getStatus()');
    assert.ok(/roomCode: st\.roomCode \|\| extractRoomCode\(state\)/.test(body), '房间号回退逻辑被改动');
    assert.ok(/mode:/.test(body) && /player:/.test(body), 'mode/player 契约丢失');
});

check('API 两次探测并发，最坏只等一次超时（不拖慢前端刷新）', () => {
    const body = fnBody('async function getStatus()');
    // 不应出现两次各自 await 的串行 apiState / apiMeta
    const seq = /await\s+apiState\(st\.port\)[\s\S]{0,120}await\s+apiMeta\(st\.port\)/.test(body);
    assert.ok(!seq, 'apiState/apiMeta 串行 await，前端刷新会被两次超时拖慢');
});

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
