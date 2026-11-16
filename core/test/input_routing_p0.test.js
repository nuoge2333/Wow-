#!/usr/bin/env node
/**
 * P0 回归：终端输入路由与日志污染清理
 * ----------------------------------------------------------------
 * 钉死三件事：
 *   1. :mc 视图输入路由 —— seed / op Steve / say hi 等原样转发给 MC，
 *      只有视图切换 / 退出 / 辅助指令才被拦截；提示符为 [MC 控制台]>。
 *   2. L 模式（M→L）隔离 MC 日志 —— fromMenu 不自动 startFollow。
 *   3. M 模式（TUI）屏蔽 Web 事件 —— echoSink / 心跳在 TUI 占屏时不 console.log。
 *
 * 运行：node test/input_routing_p0.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const {
    routeMcViewInput, MC_PROMPT, WOW_PROMPT
} = require('../src/mc_console');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n— P0-1 :mc 视图输入路由（纯函数）—');

check('MC 指令原样转发：seed', () => {
    assert.deepStrictEqual(routeMcViewInput('seed'), { action: 'mc', command: 'seed' });
});
check('MC 指令原样转发：op Steve（大小写与空格不动）', () => {
    assert.deepStrictEqual(routeMcViewInput('op Steve'), { action: 'mc', command: 'op Steve' });
});
check('MC 指令原样转发：say hi（多词内部空格保留）', () => {
    assert.deepStrictEqual(routeMcViewInput('say  hi'), { action: 'mc', command: 'say  hi' });
});
check('类名 MC 指令不当成 wow 命令：list / help 变体', () => {
    assert.strictEqual(routeMcViewInput('list').action, 'mc');
    assert.strictEqual(routeMcViewInput('tps').action, 'mc');
});
check('以 wow 命名空间开头的词在 :mc 也原样转发', () => {
    // 关键回归：server status / mod list 在 :mc 视图也必须转发给 MC，
    // 绝不能被 classify/commander 解析成 wow 指令
    assert.deepStrictEqual(routeMcViewInput('server status'), { action: 'mc', command: 'server status' });
    assert.deepStrictEqual(routeMcViewInput('mod list'), { action: 'mc', command: 'mod list' });
});
check('视图切换指令被识别为 switch', () => {
    assert.deepStrictEqual(routeMcViewInput(':wow'), { action: 'switch', view: 'wow' });
    assert.deepStrictEqual(routeMcViewInput('m'), { action: 'switch', view: 'menu' });
    assert.deepStrictEqual(routeMcViewInput(':m'), { action: 'switch', view: 'menu' });
    assert.deepStrictEqual(routeMcViewInput(':mc'), { action: 'switch', view: 'mc' });
    assert.deepStrictEqual(routeMcViewInput(':web'), { action: 'switch', view: 'web' });
});
check('退出词被识别为 exit（不转发给 MC）', () => {
    ['exit', ':q', 'quit', ':bye', ' EXIT '].forEach(w => {
        assert.strictEqual(routeMcViewInput(w).action, 'exit', `应识别退出: ${w}`);
    });
});
check('辅助指令被识别为 meta', () => {
    assert.strictEqual(routeMcViewInput(':help').action, 'meta');
    assert.strictEqual(routeMcViewInput(':log').action, 'meta');
    assert.strictEqual(routeMcViewInput(':wowlog').action, 'meta');
});
check('空行是 noop', () => {
    assert.deepStrictEqual(routeMcViewInput('   '), { action: 'noop' });
});
check('提示符常量：[MC 控制台]> / wow>', () => {
    assert.strictEqual(MC_PROMPT, '[MC 控制台]> ');
    assert.strictEqual(WOW_PROMPT, 'wow> ');
});

console.log('\n— P0-1/P0-2 cli.js 静态守卫 —');
const cliSrc = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');

check('REPL 按 currentView===mc 分流，跳过 commander', () => {
    assert.ok(/currentView\(\) === 'mc'/.test(cliSrc), '缺少 mc 视图分流判断');
    const m = cliSrc.match(/currentView\(\) === 'mc'[\s\S]{0,400}?routeMcViewInput/);
    assert.ok(m, 'mc 分流未调用 routeMcViewInput');
    // 分流分支必须在 known 校验 / parseAsync 之前 return
    const blockStart = cliSrc.indexOf("currentView() === 'mc'");
    const parseAt = cliSrc.indexOf("program.parseAsync(['node', 'cli.js', ...args])", blockStart);
    const returnCount = (cliSrc.slice(blockStart, parseAt).match(/rl\.prompt\(\);\s*return;|closed = true;\s*rl\.close\(\);\s*return;/g) || []).length;
    assert.ok(returnCount >= 3, `mc 分支应在 commander 前拦截并 return（实得 ${returnCount}）`);
});
check('mc 视图下 MC 指令走 enqueueConsoleCommand 原样下发', () => {
    const m = cliSrc.match(/action === 'mc'[\s\S]{0,500}?enqueueConsoleCommand\(route\.command\)/);
    assert.ok(m, 'mc 分支未把原样指令写入跨进程队列');
});
check('提示符随视图订阅同步（onChange + setPrompt）', () => {
    assert.ok(/vsMod\.onChange/.test(cliSrc), '未订阅视图变化');
    assert.ok(/next === vsMod\.VIEW\.MC \? MC_PROMPT : WOW_PROMPT/.test(cliSrc), '提示符未按视图切换');
    assert.ok(/rl\.setPrompt\(initPrompt\)|prompt: initPrompt/.test(cliSrc), '初始提示符未按视图设定');
});
check('M→L 传 fromMenu，L 模式日志隔离', () => {
    assert.ok(/startRepl\(\{ fromMenu: true \}\)/.test(cliSrc), '菜单入口未传 fromMenu');
    assert.ok(/const autoFollowAllowed = options\.fromMenu !== true/.test(cliSrc), '未定义自动跟随开关');
    const m = cliSrc.match(/const startFollow = \(notice\) => \{[\s\S]{0,200}?if \(!autoFollowAllowed\) return;/);
    assert.ok(m, 'startFollow 未对 fromMenu 提前返回');
});

console.log('\n— P0-1 server.js 静态守卫 —');
const srvSrc = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
check('开服控制台提示符取 [MC 控制台]>', () => {
    assert.ok(/require\('\.\/mc_console'\)\.MC_PROMPT/.test(srvSrc), '未复用 MC_PROMPT');
    assert.ok(/prompt: mcConsolePrompt\(\)/.test(srvSrc), '控制台未设置 mc 提示符');
});
check('开服控制台 mc 模式原样转发、跳过 wow 解析', () => {
    assert.ok(/this\._mode === 'mc'[\s\S]{0,200}?routeMcViewInput/.test(srvSrc), 'mc 模式未用统一路由');
    assert.ok(/process\.stdin\.write\(route\.command \+ '\\n'\)/.test(srvSrc), 'mc 模式未原样写 stdin');
});

console.log('\n— P0-3 web_service.js 静态守卫 —');
const webSrc = fs.readFileSync(path.join(SRC, 'web_service.js'), 'utf8');
check('Web 事件有 TUI 占屏守卫', () => {
    assert.ok(/function tuiOwnsTerminal\(\)/.test(webSrc), '未定义 TUI 占屏判断');
    const m = webSrc.match(/let echoSink = \(line\) => \{[\s\S]{0,160}?if \(tuiOwnsTerminal\(\)\) return;/);
    assert.ok(m, '默认 echoSink 未挡 TUI 占屏');
});
check('WebSocket 连接/断开心跳只写日志，占屏不打终端', () => {
    const conn = webSrc.match(/WebSocket 客户端已连接[\s\S]{0,320}?tuiOwnsTerminal\(\)/);
    assert.ok(conn && /logger\.info/.test(conn[0]), '连接心跳未写日志/未加守卫');
    const disc = webSrc.match(/WebSocket 客户端已断开[\s\S]{0,320}?tuiOwnsTerminal\(\)/);
    assert.ok(disc && /logger\.info/.test(disc[0]), '断开心跳未写日志/未加守卫');
});

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
