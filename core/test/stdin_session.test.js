/**
 * stdin_session —— 单消费者保证
 *
 * 这个测试只验「唯一性」这一件事：无论调用方怎么写，同一时刻只允许
 * 一个 readline 挂在 process.stdin 上。竞态类 bug 靠读代码看不出来，
 * 必须让它在测试里显形。
 *
 * 运行：node test/stdin_session.test.js
 */

const assert = require('assert');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const stdinSession = require(path.join(SRC, 'stdin_session'));

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, error: e.message });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

async function checkAsync(name, fn) {
    try {
        await fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, error: e.message });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

/** 统计 stdin 上真实的 data 监听器数量（readline 的消费者标志） */
function dataListeners() {
    return process.stdin.listenerCount('data');
}

(async () => {
    console.log('\n📋 租约基本语义\n');

    stdinSession._reset();

    await checkAsync('claim 后 stats 显示 active 且 owner 正确', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('test-basic');
        const s = stdinSession.stats();
        assert.strictEqual(s.active, true, 'active 应为 true');
        assert.strictEqual(s.owner, 'test-basic', 'owner 应为 test-basic');
        assert.ok(lease.rl, '应拿到 rl');
        await lease.release();
    });

    await checkAsync('release 后回到无人持有', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('t');
        await lease.release();
        const s = stdinSession.stats();
        assert.strictEqual(s.active, false);
        assert.strictEqual(s.owner, null);
        assert.strictEqual(s.created, 0, 'release 后 created 应归零');
    });

    await checkAsync('重复 release 不报错、不重复计数', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('t');
        await lease.release();
        await lease.release();
        assert.strictEqual(stdinSession.stats().created, 0);
    });

    console.log('\n📋 唯一性保证（核心）\n');

    await checkAsync('同时 claim 两次 → 第二个排队，不会双开', async () => {
        stdinSession._reset();
        const a = await stdinSession.claim('first');
        let secondReady = false;
        const p = stdinSession.claim('second').then(l => { secondReady = true; return l; });

        // 给足时间，若实现有 bug 这里就会双开
        await new Promise(r => setTimeout(r, 60));
        assert.strictEqual(secondReady, false, '第二个 claim 应当仍在排队');
        assert.strictEqual(stdinSession.stats().waiters, 1, '队列里应有 1 个等待者');
        assert.strictEqual(stdinSession.stats().peak, 1, '峰值并发必须为 1');

        await a.release();
        const b = await p;
        assert.strictEqual(secondReady, true, '第一个释放后第二个应被放行');
        assert.strictEqual(stdinSession.stats().owner, 'second');
        await b.release();
    });

    await checkAsync('排队期间 stdin 的 data 监听器不超过 1 个', async () => {
        stdinSession._reset();
        const before = dataListeners();
        const a = await stdinSession.claim('a');
        const p = stdinSession.claim('b');
        await new Promise(r => setTimeout(r, 50));
        const during = dataListeners();
        assert.ok(during <= before + 1,
            `排队期间 data 监听器不应增加（before=${before} during=${during}）`);
        await a.release();
        const b = await p;
        const afterBoth = dataListeners();
        assert.ok(afterBoth <= before + 1,
            `交接完成后仍只应有 1 个（before=${before} after=${afterBoth}）`);
        await b.release();
    });

    await checkAsync('ask() 自动归还，不留残留租约', async () => {
        stdinSession._reset();
        // 直接问会等输入，这里只验生命周期：用 abort 方式（给一个已结束的流不现实）
        // 改为验证 claim/release 配对：调用 ask 但立刻 release 底层
        const p = stdinSession.ask('? ');
        await new Promise(r => setTimeout(r, 30));
        assert.strictEqual(stdinSession.stats().owner, 'ask', 'ask 应持有 stdin');
        // 模拟用户回车
        process.stdin.emit('data', Buffer.from('\n'));
        const ans = await p;
        assert.strictEqual(ans, '');
        assert.strictEqual(stdinSession.stats().active, false, 'ask 结束后应自动归还');
    });

    await checkAsync('多个 ask 并发也只会排队，不会双开', async () => {
        stdinSession._reset();
        const p1 = stdinSession.ask('1? ');
        await new Promise(r => setTimeout(r, 20));
        const p2 = stdinSession.ask('2? ');
        await new Promise(r => setTimeout(r, 40));
        assert.strictEqual(stdinSession.stats().peak, 1, '并发 ask 峰值必须为 1');
        process.stdin.emit('data', Buffer.from('\n'));
        await p1;
        await new Promise(r => setTimeout(r, 20));
        assert.strictEqual(stdinSession.stats().owner, 'ask', '第二个 ask 应接上');
        process.stdin.emit('data', Buffer.from('\n'));
        await p2;
    });

    console.log('\n📋 迁移桥接\n');

    check('currentRl() 无持有时返回 null', () => {
        stdinSession._reset();
        assert.strictEqual(stdinSession.currentRl(), null);
    });

    await checkAsync('currentRl() 有持有时返回同一个 rl', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('bridge');
        assert.strictEqual(stdinSession.currentRl(), lease.rl, '应返回同一个实例');
        await lease.release();
        assert.strictEqual(stdinSession.currentRl(), null, '释放后应为 null');
    });

    console.log('\n📋 claimSync 保护启动期\n');

    await checkAsync('claimSync 在已占用时抛错而非静默排队', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('holder');
        assert.throws(
            () => stdinSession.claimSync('late'),
            /已被「holder」占用/,
            '应抛出明确的占用错误'
        );
        await lease.release();
    });

    console.log('\n📋 静态检查：调用方确实只有一个 readline 入口\n');

    check('stdin_session.js 是全项目唯一调用 createInterface 的模块', () => {
        const fs = require('fs');
        const dir = path.join(SRC);
        const offenders = [];
        const walk = (d) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                if (!e.name.endsWith('.js')) continue;
                if (e.name === 'stdin_session.js') continue;
                const src = fs.readFileSync(p, 'utf8');
                // 去掉注释行再判断，避免把说明文字算进去
                const code = src.split('\n')
                    .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l))
                    .join('\n');
                if (/\.createInterface\s*\(/.test(code)) {
                    offenders.push(path.relative(SRC, p));
                }
            }
        };
        walk(dir);
        assert.deepStrictEqual(offenders, [],
            `以下文件仍在自行创建 readline，应改为走 stdin_session：\n  ${offenders.join('\n  ')}`);
    });

    console.log('\n📋 运行时硬保证：绕不过去的第二个 readline\n');

    check('readline.createInterface 已被单例守卫包装', () => {
        const rl = require('readline');
        assert.notStrictEqual(
            rl.createInterface.name, 'createInterface',
            '应已被 stdin_session 的 guardedCreateInterface 替换'
        );
    });

    await checkAsync('已有实例时，绕过单例直接 createInterface(stdin) 被拒绝', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('guard-holder');
        const rl = require('readline');
        assert.throws(
            () => rl.createInterface({ input: process.stdin, output: process.stdout, terminal: false }),
            /拒绝创建第二个 readline/,
            '绕过单例的调用必须抛错，而不是静默双开'
        );
        assert.strictEqual(stdinSession.stats().live, 1, '拒绝后活跃实例仍应只有 1 个');
        assert.ok(stdinSession.violations().length >= 1, '应记下绕过位置');
        await lease.release();
    });

    check('守卫不误伤非 stdin 的 readline（逐行读流）', () => {
        const { Readable } = require('stream');
        const rl = require('readline');
        stdinSession._reset();
        const r = rl.createInterface({ input: Readable.from(['hello\n']), terminal: false });
        assert.strictEqual(typeof r.close, 'function', '非 stdin 的 readline 应正常创建');
        r.close();
        assert.strictEqual(stdinSession.stats().live, 0, '非 stdin 的实例不占用单例');
        assert.strictEqual(stdinSession.stats().violations, 0, '不应记为违规');
    });

    await checkAsync('makeRl 不变式：liveRl 未清时再建会抛错', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('invariant');
        assert.throws(
            () => stdinSession.makeRl({ __owner: 'illegal' }),
            /不变式被破坏/,
            '直接调 makeRl 也不能造出第二个'
        );
        assert.strictEqual(stdinSession.stats().live, 1);
        await lease.release();
    });

    await checkAsync('acquireSync 接管后 live 恒为 1，旧租约迟到 release 不减穿计数', async () => {
        stdinSession._reset();
        const a = await stdinSession.claim('old-owner');
        const origWarn = console.warn;
        console.warn = () => {};
        let b;
        try {
            b = stdinSession.acquireSync('new-owner');
        } finally {
            console.warn = origWarn;
        }
        const s = stdinSession.stats();
        assert.strictEqual(s.live, 1, `接管后活跃实例应为 1，实际 ${s.live}`);
        assert.strictEqual(s.created, 1, '计数不应被重复减');
        assert.strictEqual(s.owner, 'new-owner');
        await a.release();   // 旧持有者「迟到」的归还必须完全 no-op
        assert.strictEqual(stdinSession.stats().created, 1, '旧租约不能把新租约计数减掉');
        assert.strictEqual(stdinSession.stats().live, 1);
        await b.release();
        assert.strictEqual(stdinSession.stats().live, 0);
    });

    await checkAsync('混合压力：claim / ask / acquireSync 交替 30 轮，live 与 peak 恒 ≤ 1', async () => {
        stdinSession._reset();
        const origWarn = console.warn;
        console.warn = () => {};
        try {
            for (let i = 0; i < 10; i++) {
                const l = await stdinSession.claim('stress-' + i);
                assert.ok(stdinSession.stats().live <= 1, 'claim 后 live 应 ≤ 1');
                await l.release();

                const p = stdinSession.ask('? ');
                await new Promise(r => setTimeout(r, 2));
                process.stdin.emit('data', Buffer.from('\n'));
                await p;
                assert.ok(stdinSession.stats().live <= 1, 'ask 结束后 live 应 ≤ 1');

                const l2 = stdinSession.acquireSync('stress-sync-' + i);
                assert.ok(stdinSession.stats().live <= 1, 'acquireSync 后 live 应 ≤ 1');
                await l2.release();
            }
        } finally {
            console.warn = origWarn;
        }
        const s = stdinSession.stats();
        assert.strictEqual(s.live, 0, '压力结束后不应有残留实例');
        assert.strictEqual(s.peak, 1, `活跃峰值必须为 1，实际 ${s.peak}`);
        assert.strictEqual(s.created, 0, '计数应归零');
        assert.ok(s.stdinDataListeners <= 1, `stdin data 监听器应 ≤ 1，实际 ${s.stdinDataListeners}`);
    });

    await checkAsync('enableKeypress 幂等：重复调用不叠加派发器', async () => {
        stdinSession._reset();
        const lease = await stdinSession.claim('keypress');
        assert.strictEqual(typeof lease.enableKeypress, 'function', 'lease 应提供 enableKeypress');
        const before = process.stdin.listenerCount('keypress');
        lease.enableKeypress();
        lease.enableKeypress();
        lease.enableKeypress();
        const after = process.stdin.listenerCount('keypress');
        assert.ok(after <= before + 1,
            `emitKeypressEvents 应幂等（before=${before} after=${after}）`);
        await lease.release();
    });

    await checkAsync('反复重建不累积：30 轮 terminal 切换后 data 监听器仍 ≤ 2', async () => {
        stdinSession._reset();
        const origWarn = console.warn;
        console.warn = () => {};
        let maxData = 0;
        try {
            for (let i = 0; i < 15; i++) {
                const a = await stdinSession.claim('tty-' + i, { terminal: true });
                a.enableKeypress();
                maxData = Math.max(maxData, stdinSession.stats().stdinDataListeners);
                await a.release();

                const b = await stdinSession.claim('line-' + i, { terminal: false });
                maxData = Math.max(maxData, stdinSession.stats().stdinDataListeners);
                await b.release();
                assert.ok(maxData <= 2, `第 ${i} 轮 data 监听器累积到 ${maxData}`);
            }
        } finally {
            console.warn = origWarn;
        }
        const s = stdinSession.stats();
        assert.ok(maxData <= 2, `data 监听器峰值应 ≤ 2，实际 ${maxData}`);
        assert.strictEqual(s.live, 0, '结束后不应有存活实例');
        assert.strictEqual(s.peak, 1, `readline 实例峰值必须为 1，实际 ${s.peak}`);
        assert.strictEqual(s.violations, 0, '全程不应有绕过单例的调用');
    });

    check('emitKeypressEvents 只由 stdin_session 调用', () => {
        const fs = require('fs');
        const offenders = [];
        const walk = (d) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                if (!e.name.endsWith('.js')) continue;
                if (e.name === 'stdin_session.js') continue;
                const code = fs.readFileSync(p, 'utf8').split('\n')
                    .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
                if (/\.emitKeypressEvents\s*\(/.test(code)) {
                    offenders.push(path.relative(SRC, p));
                }
            }
        };
        walk(SRC);
        assert.deepStrictEqual(offenders, [],
            `以下文件仍自行挂 keypress 派发器，应改用 lease.enableKeypress()：\n  ${offenders.join('\n  ')}`);
    });

    check('src 里残留的 require(readline) 只用于静态方法，不创建实例', () => {
        const fs = require('fs');
        const offenders = [];
        const walk = (d) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                if (!e.name.endsWith('.js')) continue;
                if (e.name === 'stdin_session.js') continue;
                const src = fs.readFileSync(p, 'utf8');
                if (!/require\(['"]readline['"]\)/.test(src)) continue;
                const code = src.split('\n')
                    .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
                if (/createInterface|new\s+readline\.Interface/.test(code)) {
                    offenders.push(path.relative(SRC, p));
                }
            }
        };
        walk(SRC);
        assert.deepStrictEqual(offenders, [],
            `以下文件 require 了 readline 却又创建实例：\n  ${offenders.join('\n  ')}`);
    });

    console.log('');
    console.log('[6] 设计内交接（expectedOwners）不误报、真漏 release 仍告警');

    await checkAsync('expectedOwners：REPL -> 开服控制台的交接不打「强制接管」告警', async () => {
        stdinSession._reset();
        const origWarn = console.warn;
        const warns = [];
        console.warn = (...a) => { warns.push(a.join(' ')); };
        try {
            stdinSession.claimSync('repl', { terminal: false });
            const b = stdinSession.acquireSync('server.console', {
                terminal: false,
                expectedOwners: ['repl']
            });
            assert.strictEqual(stdinSession.stats().live, 1, '交接后仍只允许一个 readline');
            await b.release();
        } finally {
            console.warn = origWarn;
            stdinSession._reset();
        }
        assert.ok(!warns.some(w => w.includes('强制接管')),
            '已声明预期前任，却仍刷「调用方可能漏了 release」误报');
    });

    await checkAsync('未声明 expectedOwners 的接管仍然告警（诊断能力不丢）', async () => {
        stdinSession._reset();
        const origWarn = console.warn;
        const warns = [];
        console.warn = (...a) => { warns.push(a.join(' ')); };
        try {
            stdinSession.claimSync('some-owner', { terminal: false });
            const b = stdinSession.acquireSync('tui.keyboard', { terminal: false });
            await b.release();
        } finally {
            console.warn = origWarn;
            stdinSession._reset();
        }
        assert.ok(warns.some(w => w.includes('强制接管')),
            '真·疑似漏 release 的接管必须保留告警');
    });

    check('server.js 的 _createConsoleRl 声明 expectedOwners: [\'repl\']', () => {
        const fs = require('fs');
        const srv = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
        const i = srv.indexOf('_createConsoleRl()');
        const body = srv.slice(i, i + 700);
        assert.ok(/expectedOwners:\s*\['repl'\]/.test(body),
            '开服控制台未声明 REPL 为预期前任');
    });

    console.log('');
    console.log('='.repeat(50));
    if (fail === 0) {
        console.log(`✅ 全部通过：${pass} 项`);
        process.exit(0);
    } else {
        console.log(`❌ 通过 ${pass} 项，失败 ${fail} 项`);
        failures.forEach(f => console.log(`   - ${f.name}: ${f.error}`));
        process.exit(1);
    }
})();
