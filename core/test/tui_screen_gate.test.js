#!/usr/bin/env node
/**
 * V3.7.3：M 模式「画面独占」闸门
 * ----------------------------------------------------------------
 * 需求一句话：**服务器已启动时进 M 模式，菜单里不许冒出服务器日志。**
 *
 * 原先只有 `_mode === 'mc'` 一道判断（MC 视图才回显）。它的问题是
 * 和「画面」脱节：只要有任何入口把 TUI 叫起来（`server start` 控制台敲
 * `:wow`、L 模式回跳、或者以后新加的入口），而 `_mode` 又恰好是 `mc`
 * （或 L 模式那边的跟踪定时器还活着），日志就会从菜单底下往外顶。
 *
 * 现在补两道：
 *   1. `tui.markScreenActive()` / `isScreenActive()`：TUI 从第一帧到退出
 *      期间置位，server.js 回显与 cli.js 跟踪打印都先问它；
 *   2. 进菜单时把「Ctrl+C = 停服」的 SIGINT 摘掉，退出再装回
 *      （否则停在「按回车键返回」上按 Ctrl+C 会把服务器关掉）。
 *
 * 运行：node test/tui_screen_gate.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const SRC = path.join(__dirname, '../src');
const tui = require(path.join(SRC, 'tui'));
const serverSrc = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
const cliSrc = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');
const itvSrc = fs.readFileSync(path.join(SRC, 'interactive.js'), 'utf8');

console.log('\n── 闸门本体 ──');

check('tui 导出 markScreenActive / isScreenActive', () => {
    assert.strictEqual(typeof tui.markScreenActive, 'function', '未导出 markScreenActive');
    assert.strictEqual(typeof tui.isScreenActive, 'function', '未导出 isScreenActive');
});

check('默认不占用屏幕（不影响普通命令 / 兼容模式）', () => {
    assert.strictEqual(tui.isScreenActive(), false, '默认值应为 false');
});

check('置位 / 复位都生效（且只认布尔）', () => {
    tui.markScreenActive(true);
    assert.strictEqual(tui.isScreenActive(), true);
    tui.markScreenActive(false);
    assert.strictEqual(tui.isScreenActive(), false);
    tui.markScreenActive(1);
    assert.strictEqual(tui.isScreenActive(), true, 'truthy 应视为占用');
    tui.markScreenActive(0);
    assert.strictEqual(tui.isScreenActive(), false);
});

console.log('\n── TUI 生命周期 ──');

check('runTuiMode 在第一帧之前置位', () => {
    const m = itvSrc.match(/async function runTuiMode[\s\S]*?\n    render\(\);/);
    assert.ok(m, '未找到 runTuiMode 首帧');
    assert.ok(/tui\.markScreenActive\(true\)/.test(m[0]), '画第一帧前没有置位');
    const iMark = m[0].indexOf('tui.markScreenActive(true)');
    const iRender = m[0].lastIndexOf('\n    render();');
    assert.ok(iMark !== -1 && iMark < iRender, '置位必须在 render() 之前');
});

check('runTuiMode 退出时复位（L / SERVER / EXIT 各分支之前）', () => {
    const iClose = itvSrc.indexOf('kb.close();');
    const iReset = itvSrc.indexOf('tui.markScreenActive(false)');
    const iLeaveL = itvSrc.indexOf("if (leaving === 'L')");
    assert.ok(iReset !== -1, '没有复位语句');
    assert.ok(iClose !== -1 && iReset > iClose, '复位应在 kb.close() 之后');
    assert.ok(iLeaveL !== -1 && iReset < iLeaveL, '复位必须在各 leaving 分支之前（否则 L 回来仍是占用态）');
});

console.log('\n── 日志生产方 ──');

check('server.js 的 MC 回显同时看视图与画面占用', () => {
    // 直接按「判断 + 写终端」这一行的形状断言，避免被嵌套花括号的正则坑
    assert.ok(/_mode === 'mc' && !tuiOwnsScreen\(\)\) process\.stdout\.write\(data\)/.test(serverSrc),
        'stdout 回显缺少画面占用判断');
    assert.ok(/_mode === 'mc' && !tuiOwnsScreen\(\)\) process\.stderr\.write\(data\)/.test(serverSrc),
        'stderr 回显缺少画面占用判断');
    // 两条数据通路都还在（回显被挡不能连落盘一起挡）
    const writes = (serverSrc.match(/logStream\.write\(data\);/g) || []).length;
    assert.ok(writes >= 2, `logStream.write 只有 ${writes} 处，日志落盘被误删`);
});

check('tuiOwnsScreen 容错：tui 加载失败时按未占用处理', () => {
    const m = serverSrc.match(/function tuiOwnsScreen\(\)[\s\S]{0,200}?\n\}/);
    assert.ok(m, '未抽出 tuiOwnsScreen');
    assert.ok(/catch \(e\) \{ return false; \}/.test(m[0]), '异常时应返回 false，不能把日志永久噤声');
});

check('cli.js 跟踪打印受闸门约束（数据仍在日志文件里）', () => {
    const i = cliSrc.indexOf('const printLine = (line) => {');
    assert.ok(i !== -1, '未找到 printLine');
    const body = cliSrc.slice(i, i + 600);
    assert.ok(/load\('\.\/tui'\)\.isScreenActive\(\)\) return/.test(body),
        'printLine 未检查画面占用');
    // 挡住的是「打印」，不是「读日志」——clearLine 仍要在
    assert.ok(/clearLine/.test(body), 'printLine 的原有清行逻辑被破坏');
});

console.log('\n── 菜单期间的 Ctrl+C ──');

check('进菜单前摘掉服务器 SIGINT 处理器', () => {
    const m = serverSrc.match(/async _enterMenuFromConsole\(\)[\s\S]*?await new Promise\(r => setImmediate\(r\)\);/);
    assert.ok(m, '未找到 _enterMenuFromConsole 头部');
    assert.ok(/removeListener\('SIGINT', this\._sigintHandler\)/.test(m[0]), '未摘掉 SIGINT');
});

check('退出菜单后把 SIGINT 装回（服务端仍在跑才装）', () => {
    const m = serverSrc.match(/async _enterMenuFromConsole\(\)[\s\S]*?\n    \}/);
    assert.ok(m, '未找到 _enterMenuFromConsole 全貌');
    assert.ok(/process\.once\('SIGINT', this\._sigintHandler\)/.test(m[0]), '未装回 SIGINT');
    assert.ok(/this\.process && !this\.process\.killed/.test(m[0]), '未判断服务端是否还在跑');
});

console.log('');
if (fail) {
    console.log(`❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
    failures.forEach(f => console.log(`   - ${f.name}: ${f.err.message}`));
    process.exit(1);
}
console.log(`✅ 全部通过：${pass} 项`);
process.exit(0);
