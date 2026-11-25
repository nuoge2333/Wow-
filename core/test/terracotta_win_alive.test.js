#!/usr/bin/env node
/**
 * Windows 陶瓦开房后 web 面板房间号不显示 —— 回归测试
 * ----------------------------------------------------------------
 * 现象：Windows + web 面板点「开房」，hostRoom() 明明拿到了房间号，但前端
 *       refresh() 紧接着把房间号刷成「—」，用户看不到房间号。
 *
 * 根因：terracotta.js 的 isAlive(pid) 无条件用 process.kill(pid, 0)。陶瓦守护是
 *       detached + unref 的跨会话进程，Windows 下这种 PID 探测会稳定失败，
 *       getStatus() 于是返回 running:false / roomCode:null，前端刷新即清空房间号。
 *       Linux/macOS 的 kill(pid,0) 可靠，所以只在 Windows 复现。
 *
 * 修法：isAlive() 在 Windows 走 tasklist /FI "PID eq N"（与 server.js
 *       _isProcessAlive() 的 B1 修复同一套判定）。
 *
 * 本测试（静态源码断言 + 纯函数行为，不依赖真实陶瓦二进制）：
 *   1. 导入 execSync；
 *   2. isAlive 按 utils.getOS()==='windows' 分支；
 *   3. Windows 分支用 tasklist + execSync + windowsHide；
 *   4. 非 Windows 分支仍用 process.kill(pid, 0)；
 *   5. getStatus() 的房间号仍受 running/isAlive 门控（消费者契约不变）。
 *
 * 运行：node test/terracotta_win_alive.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src', 'terracotta.js');
const src = fs.readFileSync(SRC, 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n— Windows 陶瓦开房房间号显示回归 —');

check('terracotta.js 导入 execSync', () => {
    assert.ok(/const \{ spawn, execSync \} = require\('child_process'\)/.test(src),
        '未导入 execSync');
});

check('isAlive 在 Windows 走 tasklist 判定', () => {
    const m = src.match(/function isAlive\(pid\) \{[\s\S]*?\n\}/);
    assert.ok(m, '未找到 isAlive 实现');
    const body = m[0];
    assert.ok(/utils\.getOS\(\) === 'windows'/.test(body), '未按平台分支');
    assert.ok(/execSync\(`tasklist \/FI "PID eq \$\{pid\}"`/.test(body), 'Windows 分支未用 tasklist/execSync');
    assert.ok(/windowsHide: true/.test(body), 'tasklist 未设 windowsHide（会闪控制台窗口）');
    assert.ok(/new RegExp\(`\\+b\$\{pid\}\\+b`\)\.test\(out\)/.test(body), '未用单词边界匹配 PID，可能误判');
});

check('非 Windows 分支仍用 process.kill(pid, 0)', () => {
    const m = src.match(/function isAlive\(pid\) \{[\s\S]*?\n\}/);
    assert.ok(m && /process\.kill\(pid, 0\)/.test(m[0]), '非 Windows 分支丢失 kill 探测');
});

check('getStatus 房间号仍门控于 running/isAlive（消费者契约不变）', () => {
    const m = src.match(/async function getStatus\(\) \{[\s\S]*?\n\}/);
    assert.ok(m, '未找到 getStatus');
    assert.ok(/!isAlive\(st\.pid\)/.test(m[0]), 'getStatus 未再用 isAlive 判定运行');
    assert.ok(/roomCode: st\.roomCode \|\| extractRoomCode\(state\)/.test(m[0]), '房间号回退逻辑被改动');
});

check('hostRoom 成功后把房间号写入状态文件（web 首屏可直接读到）', () => {
    assert.ok(/writeState\(\{ roomCode, running: true, mode: 'host' \}\)/.test(src),
        '开房成功后未持久化房间号');
});

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
