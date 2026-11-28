#!/usr/bin/env node
/**
 * Windows 跨进程日志跟踪「假死」修复回归
 * ----------------------------------------------------------------
 * Bug：Web 面板启服、CLI 自动进入 :mc 跟随日志后，一旦 Windows tasklist
 *      单次超时/异常（MC 刚输出 Done 时负载最高，极易发生），旧逻辑
 *      `catch → false → stopFollow` 立刻把仍在运行的服务器误判为已停止，
 *      踢回 :wow。且日志静默时无任何状态提示。
 *
 * 本测试锁定四件事：
 *   1. alive_probe：单次 PID 探测失败不判停，连续 3 次「确证死亡」才判停；
 *   2. PID 说死但 Web /api/status 说在跑 → 以面板为准（不判停）；
 *   3. 无 PID / 探测异常 → 保守视为存活，永不判停；
 *   4. 静态源码：cli / mc_console 日志静默只提示不退出、退出提示仅在确证死亡分支，
 *      interactive 的 Windows 跟踪改用 setInterval + fs.stat 而非 fs.watch。
 *
 * 运行：node test/cross_process_alive.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const aliveProbe = require('../src/alive_probe');
const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli.js'), 'utf8');
const mcSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'mc_console.js'), 'utf8');
const intSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'interactive.js'), 'utf8');

let passed = 0, failed = 0;
async function check(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

/** 构造一个「PID 固定存在」的假 ServerManager；pidProbe/httpGet 由用例注入。 */
function fakeManager(pid = 4242) {
    return { _readPid: () => pid, _isProcessAlive: () => true };
}

(async () => {
    console.log('\n— Windows 跨进程判活（假死修复）回归 —');

    await check('单次 PID 误判不退出；连续 3 次确证死亡才判停', async () => {
        const tracker = aliveProbe.createLivenessTracker(fakeManager(), {
            pidProbe: () => false, httpGet: async () => null, deathThreshold: 3
        });
        await tracker.refresh();
        assert.equal(tracker.snapshot().certainDead, false, '第 1 次误判就判停了');
        assert.equal(tracker.snapshot().deathCount, 1);
        await tracker.refresh();
        assert.equal(tracker.snapshot().certainDead, false, '第 2 次误判就判停了');
        await tracker.refresh();
        assert.equal(tracker.snapshot().certainDead, true, '第 3 次确证死亡未判停');
    });

    await check('PID 探测一次失败后恢复存活 → 死亡计数清零', async () => {
        let n = 0;
        const tracker = aliveProbe.createLivenessTracker(fakeManager(), {
            pidProbe: () => (++n === 1 ? false : true),
            httpGet: async () => null,
            deathThreshold: 3
        });
        for (let i = 0; i < 5; i++) await tracker.refresh();
        const s = tracker.snapshot();
        assert.equal(s.certainDead, false, '恢复存活后仍被判停');
        assert.equal(s.deathCount, 0, '死亡计数未清零');
    });

    await check('PID 说死但 Web /api/status 说在跑 → 以面板为准，不判停', async () => {
        const tracker = aliveProbe.createLivenessTracker(fakeManager(), {
            pidProbe: () => false, httpGet: async () => true, deathThreshold: 3
        });
        for (let i = 0; i < 5; i++) await tracker.refresh();
        const s = tracker.snapshot();
        assert.equal(s.certainDead, false, '面板说在跑却仍被判停');
        assert.equal(s.source, 'http', '未采用 HTTP 证据');
    });

    await check('无 PID 文件且 HTTP 无证据 → 保守视为存活，永不判停', async () => {
        const tracker = aliveProbe.createLivenessTracker(fakeManager(null), {
            pidProbe: () => null, httpGet: async () => null, deathThreshold: 3
        });
        for (let i = 0; i < 6; i++) await tracker.refresh();
        const s = tracker.snapshot();
        assert.equal(s.alive, true, '无法确证时未保守视为存活');
        assert.equal(s.certainDead, false, '无法确证时误判停');
    });

    await check('PID 探测抛异常（如 tasklist 超时）→ 保守视为存活', async () => {
        const tracker = aliveProbe.createLivenessTracker(fakeManager(), {
            pidProbe: () => { throw new Error('tasklist timeout'); },
            httpGet: async () => null,
            deathThreshold: 3
        });
        for (let i = 0; i < 5; i++) await tracker.refresh();
        assert.equal(tracker.snapshot().certainDead, false, '探测异常导致误判停');
    });

    await check('probeOnce：PID 存活时直判活，无需 HTTP', async () => {
        const r = await aliveProbe.probeOnce(fakeManager(), {
            pidProbe: () => true, httpGet: async () => { throw new Error('不该被调用'); }
        });
        assert.equal(r.alive, true);
        assert.equal(r.certain, true);
        assert.equal(r.source, 'pid');
    });

    // ---- 静态源码断言 ----

    await check('cli.js：判停条件是连续确证，而非单次探测失败', () => {
        assert.ok(/liveness\.tick\(\)\.certainDead/.test(cliSrc), '未按连续确证结果判停');
        assert.ok(!/if \(!alive\) \{\s*stopFollow/.test(cliSrc), '仍存在单次探测失败即判停的旧逻辑');
        assert.ok(/createLivenessTracker\(sm, \{ deathThreshold: 3 \}\)/.test(cliSrc), '未接入连续确认跟踪器');
    });

    await check('cli.js：日志静默只提示「运行中」，绝不退出跟踪', () => {
        const m = cliSrc.match(/if \(st\.size <= followOffset\) \{[\s\S]{0,420}?\n            \}/);
        assert.ok(m, '未找到日志静默分支');
        assert.ok(/暂无新日志，服务器运行中/.test(m[0]), '静默时缺少「运行中」提示');
        assert.ok(!/stopFollow/.test(m[0]), '静默分支不得退出 :mc 跟踪');
    });

    await check('cli.js：退出提示只打印在确证死亡分支', () => {
        const m = cliSrc.match(/if \(liveness\.tick\(\)\.certainDead\) \{[\s\S]{0,220}?⏹ 服务器已停止/);
        assert.ok(m, '退出提示不在「连续确证死亡」分支内');
    });

    await check('mc_console.js：顶层 :mc 同样连续确认 + 静默提示', () => {
        assert.ok(/this\._liveness\.tick\(\)\.certainDead/.test(mcSrc), '未按连续确证判停');
        assert.ok(/暂无新日志，服务器运行中/.test(mcSrc), '缺少静默提示');
        assert.ok(/createLivenessTracker\(this\.server, \{ deathThreshold: 3 \}\)/.test(mcSrc), '未接入跟踪器');
    });

    await check('interactive.js：Windows 日志跟踪改用轮询，不再用 fs.watch', () => {
        const start = intSrc.indexOf("if (process.platform === 'win32')");
        const end = intSrc.indexOf('} else {', start);
        assert.ok(start > 0 && end > start, '未找到 Windows 分支');
        const win = intSrc.slice(start, end);
        assert.ok(/setInterval/.test(win), '未使用 setInterval 轮询');
        assert.ok(/fs\.statSync\(file\)\.size/.test(win), '未用 fs.stat 检查文件大小');
        assert.ok(!/fs\.watch\(/.test(win), '仍在使用 fs.watch（Windows 会漏事件）');
        assert.ok(/clearInterval\(pollTimer\)/.test(intSrc), '收尾未清理轮询定时器');
    });

    console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
    process.exit(failed === 0 ? 0 : 1);
})();
