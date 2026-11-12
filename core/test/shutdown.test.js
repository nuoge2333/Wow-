/**
 * SIGINT / 强关终端防呆测试（执行令阶段 5）
 *
 * 红线：任意视图强关终端时，后台 Minecraft 进程必须优雅退出或断开，
 *       不能变僵尸；`:mc` 单次 Ctrl+C 只是 detach，**绝不杀服**。
 *
 * 覆盖：
 *   1) shutdown.js 只管 SIGTERM/SIGHUP/exit，不注册 SIGINT；
 *   2) 两处 spawn 都登记 registerMcChild（补齐非交互分支缺口）；
 *   3) 所有 `process.exit(0)` 之前都 await requestStop（不抢跑）；
 *   4) SIGINT 回调里绝不出现 this.stop()；
 *   5) 运行时：gracefulStop 幂等 + 分级兜底真能杀掉子进程、不留僵尸。
 *
 * 运行：cd core && node test/shutdown.test.js
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const srv = read('server.js');
const shut = read('shutdown.js');
const cli = read('cli.js');
const itv = read('interactive.js');
const web = read('web_service.js');
const logh = read('log_handler.js');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}
async function acheck(title, fn) {
    try { await fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}

console.log('\n[1] shutdown.js —— 职责边界');

check('注册 SIGTERM / SIGHUP / exit 三类兜底', () => {
    assert.ok(/process\.once\('SIGTERM'/.test(shut), '缺 SIGTERM');
    assert.ok(/process\.once\('SIGHUP'/.test(shut), '缺 SIGHUP');
    assert.ok(/process\.once\('exit', syncKillFallback\)/.test(shut), '缺 exit 同步兜底');
});

check('shutdown.js 不注册 SIGINT（:mc 的 Ctrl+C 是 detach，不停服）', () => {
    // 去掉注释行后再看代码里有没有 SIGINT 监听
    const code = shut.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    assert.ok(!/process\.(on|once)\(\s*'SIGINT'/.test(code), 'shutdown 抢注了 SIGINT');
});

check('gracefulStop 幂等（stopping + stopPromise 共享）', () => {
    assert.ok(/if \(stopping\) return stopPromise;/.test(shut), '缺幂等短路');
    assert.ok(/function gracefulStop\(/.test(shut), '缺 gracefulStop');
    assert.ok(/stopPromise = \(async \(\) =>/.test(shut), '缺内部异步执行体');
    assert.ok(/_killEscalation/.test(shut), '缺 SIGTERM→SIGKILL 分级兜底');
    assert.ok(/function syncKillFallback/.test(shut), '缺同步兜底');
});

check('hasOwnedChild 会排除已退出 / 僵尸进程', () => {
    assert.ok(/proc\.exitCode !== null \|\| proc\.signalCode !== null/.test(shut), '未排除僵尸');
});

console.log('\n[2] server.js —— 两处 spawn 都登记');

check('两处 spawn 之后都调 _registerShutdown()', () => {
    const spawns = (srv.match(/this\.process = spawn\(/g) || []).length;
    const regs = (srv.match(/this\._registerShutdown\(\)/g) || []).length;
    assert.ok(spawns >= 2, `spawn 只有 ${spawns} 处`);
    assert.strictEqual(regs, spawns, `登记数 ${regs} 与 spawn 数 ${spawns} 不符`);
});

check('_registerShutdown 注入 stop 与 cleanup 并交给 shutdown.registerMcChild', () => {
    const i = srv.indexOf('_registerShutdown()');
    const body = srv.slice(i, i + 600);
    assert.ok(/registerMcChild\(this\.process/.test(body), '未登记子进程');
    assert.ok(/stop: \(\) => this\.stop\(\)/.test(body), '未注入优雅停服回调');
    assert.ok(/cleanup:/.test(body), '未注入收尾回调');
});

check('两处 spawn 都保持 detached:false（父进程存活 = 视图切换不成孤儿）', () => {
    const detached = (srv.match(/detached:\s*false/g) || []).length;
    assert.ok(detached >= 2, `detached:false 只有 ${detached} 处`);
});

console.log('\n[3] :mc 的 Ctrl+C 只 detach、绝不停服');

check('_createConsoleRl 的 SIGINT 回调不调 this.stop()', () => {
    const i = srv.indexOf("_createConsoleRl()");
    const body = srv.slice(i, i + 1800);
    const sig = body.indexOf("rl.on('SIGINT'");
    assert.ok(sig > 0, '找不到 rl SIGINT 回调');
    const cb = body.slice(sig, sig + 320);
    assert.ok(!/this\.stop\(/.test(cb), 'rl SIGINT 回调里仍有 this.stop()');
    assert.ok(/_detachConsole\(/.test(cb), '未走安全退场');
});

check('start() 的 _sigintHandler 只 detach，且保留 removeListener/once 两行注册', () => {
    const i = srv.indexOf('this._sigintHandler = () =>');
    assert.ok(i > 0, '找不到 _sigintHandler');
    const cb = srv.slice(i, i + 320);
    assert.ok(!/this\.stop\(/.test(cb), '_sigintHandler 里仍有 this.stop()');
    assert.ok(/_detachConsole\(/.test(cb), '未走安全退场');
    assert.ok(/process\.once\('SIGINT', this\._sigintHandler\)/.test(srv), '缺 once 注册');
    assert.ok(/process\.removeListener\('SIGINT', this\._sigintHandler\)/.test(srv), '缺摘装');
});

check('_detachConsole 只归还租约 / 切视图，全程不调 stop()', () => {
    const i = srv.indexOf('async _detachConsole(target)');
    assert.ok(i > 0, '找不到 _detachConsole');
    const body = srv.slice(i, srv.indexOf('\n    }', i) + 6);
    assert.ok(!/this\.stop\(/.test(body), '安全退场里调了 stop()');
    assert.ok(/_releaseConsoleRl\(/.test(body), '未归还 console 租约');
});

check('stop() 有 _stopping 幂等，正常关服时清 logs/ 只留 latest.log', () => {
    assert.ok(/if \(this\._stopping\) return;/.test(srv), 'stop() 缺幂等');
    assert.ok(/this\._cleanLogsOnStop\(\)/.test(srv), '关服未清理日志');
});

console.log('\n[4] 所有 process.exit(0) 前都先 await 优雅停服（不抢跑）');

function exitsHaveStop(src, label) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // 跳过注释里的 process.exit(0)（说明文字里经常引用它）
        const trimmed = lines[i].trim();
        if (/^(\*|\/\/|\/\*)/.test(trimmed)) continue;
        if (!/process\.exit\(0\)/.test(lines[i])) continue;
        // 往上找 12 行内必须有 requestStop / _requestStopBeforeExit
        const near = lines.slice(Math.max(0, i - 12), i).join('\n');
        assert.ok(/requestStop|_requestStopBeforeExit/.test(near),
            `${label}:${i + 1} 的 process.exit(0) 前没有优雅停服`);
    }
}

check('cli.js 两处 REPL 退出都先 _requestStopBeforeExit()', () => exitsHaveStop(cli, 'cli.js'));
check('interactive.js TUI 退出先 requestStop()', () => exitsHaveStop(itv, 'interactive.js'));
check('log_handler.js logs tail 的 SIGINT 先 requestStop()', () => exitsHaveStop(logh, 'log_handler.js'));
check('web_service.js 启停信号回调先 requestStop()', () => exitsHaveStop(web, 'web_service.js'));

check('cli.js 的 _requestStopBeforeExit 只在 hasOwnedChild() 时停服', () => {
    const i = cli.indexOf('async function _requestStopBeforeExit');
    const body = cli.slice(i, i + 350);
    assert.ok(/hasOwnedChild\(\)/.test(body), '未判断本进程是否持有 MC');
});

check('REPL 被 console 强制接管时只静默让出，不 process.exit(0)', () => {
    const i = cli.indexOf('rl.on(\'close\'');
    const body = cli.slice(i, i + 600);
    assert.ok(/lease\.released/.test(body), '未判断租约是否已被接管');
    const branch = body.slice(body.indexOf('if (lease.released)'), body.indexOf('if (lease.released)') + 220);
    assert.ok(!/process\.exit\(0\)/.test(branch), '被接管时仍会 exit，会杀掉 MC');
});

console.log('\n[5] 运行时：gracefulStop 真能停掉子进程且幂等');

function waitAlive(proc, ms = 300) {
    return new Promise(r => setTimeout(() => r(proc.exitCode === null && proc.signalCode === null), ms));
}

async function withFakeChild(fn) {
    const shutdown = require(path.join(SRC, 'shutdown'));
    // 一个「忽略 stop 指令」的假 MC：必须靠 SIGTERM/SIGKILL 分级兜底才能停
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {
        stdio: ['ignore', 'ignore', 'ignore']
    });
    await new Promise(r => setTimeout(r, 150));
    let stopCalls = 0;
    try {
        shutdown.registerMcChild(child, {
            stop: () => { stopCalls++; return Promise.resolve(); },  // 模拟 stop 指令无效
            cleanup: () => {}
        });
        await fn(shutdown, child, () => stopCalls);
    } finally {
        shutdown.clear();
        if (child.exitCode === null && child.signalCode === null) {
            try { child.kill('SIGKILL'); } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 100));
    }
}

async function main() {
    await acheck('登记后 hasOwnedChild() 为真', () => withFakeChild(async (sd) => {
        assert.strictEqual(sd.hasOwnedChild(), true);
    }));

    await acheck('gracefulStop 能停掉「不响应 stop」的子进程，无残留', () => withFakeChild(async (sd, child) => {
        const r = await sd.gracefulStop('test:graceful');
        assert.strictEqual(r, true, 'gracefulStop 未确认子进程退出');
        const alive = await waitAlive(child);
        assert.strictEqual(alive, false, '子进程仍存活（会变僵尸）');
        assert.strictEqual(sd.hasOwnedChild(), false, '登记未清');
    }));

    await acheck('并发 gracefulStop 只停一次（幂等，stop 回调仅调用 1 次）', () => withFakeChild(async (sd, child, calls) => {
        await Promise.all([
            sd.gracefulStop('test:a'),
            sd.gracefulStop('test:b'),
            sd.gracefulStop('test:c')
        ]);
        assert.strictEqual(calls(), 1, `stop 回调被调用 ${calls()} 次`);
        const alive = await waitAlive(child);
        assert.strictEqual(alive, false, '子进程仍存活');
    }));

    await acheck('无持有子进程时 requestStop 是 no-op', async () => {
        const shutdown = require(path.join(SRC, 'shutdown'));
        shutdown.clear();
        assert.strictEqual(shutdown.hasOwnedChild(), false);
        const r = await shutdown.requestStop('test:noop');
        assert.strictEqual(r, false);
    });

    console.log(`\n${'='.repeat(46)}`);
    console.log(`✅ 通过 ${passed} 项，失败 ${failed} 项`);
    console.log('='.repeat(46));
    return failed;
}

// 同步断言先跑，再跑异步用例
main().then(code => process.exit(code ? 1 : 0), e => {
    console.error(e);
    process.exit(1);
});
