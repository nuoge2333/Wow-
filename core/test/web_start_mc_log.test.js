#!/usr/bin/env node
/**
 * Web 面板启动服务器 → CLI 进入 :mc 控制台必须有日志（回归）
 * ----------------------------------------------------------------
 * Bug：web 面板 server start 后，CLI 的 detectTimer 检测到心跳 false→true，
 *      执行 setView('MC') 把视图切到 :mc（提示符变成 [MC 控制台]>），却调用
 *      了受 autoFollowAllowed 守卫的 startFollow。当 REPL 是「从 M 菜单按 L」
 *      进入时（fromMenu=true → autoFollowAllowed=false），startFollow 立即 return，
 *      没有任何日志跟随定时器在跑 —— 用户「进了 MC 控制台却看不到日志」。
 *
 * 本测试锁定三件事（纯静态源码断言，不依赖真实服务器 / TTY）：
 *   1. startFollow 接受 force 参数，默认仍遵守 autoFollowAllowed（保留 M→L 隔离）。
 *   2. detectTimer 「切到 :mc」分支调用 startFollow 时传 force=true——进视图必有日志。
 *   3. MENU 视图分支不切页、不强制跟随（保持菜单模式不被日志刷屏）。
 *   4. setTimeout 初始兜底不强制（进入时服务器已在跑仍走隔离判定）。
 *
 * 运行：node test/web_start_mc_log.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n— Web 启动 → CLI :mc 日志跟随回归 —');

check('startFollow 接受 force 且默认仍遵守 autoFollowAllowed', () => {
    const m = cliSrc.match(/const startFollow = \(notice, force = false\) => \{[\s\S]{0,260}?if \(!autoFollowAllowed && !force\) return;/);
    assert.ok(m, 'startFollow 签名/守卫不符合 force 语义');
});

check('detectTimer 的「切到 :mc」分支强制跟随（force=true）', () => {
    // 定位 setView('MC', 'web:started:from-wow') 之后紧邻的 startFollow 调用
    const m = cliSrc.match(/setView\('MC',\s*'web:started:from-wow'\)[\s\S]{0,320}?startFollow\([^\n]*?,\s*true\s*\)/);
    assert.ok(m, '切到 :mc 后未以 force=true 调用 startFollow（进了视图却可能没日志）');
});

check('detectTimer 在 MENU 视图不切页、不强制跟随', () => {
    const m = cliSrc.match(/if \(vs && currentView\(\) === vs\.VIEW\.MENU\) \{[\s\S]{0,200}?\}\s*else \{/);
    assert.ok(m, '未找到 MENU 视图分支');
    assert.ok(/printLine\('🟢 服务器已由 Web 面板启动/.test(m[0]), 'MENU 分支应只打印一行提示');
    assert.ok(!/setView\('MC'/.test(m[0]), 'MENU 分支不应切到 :mc');
});

check('进入 REPL 的初始兜底不强制跟随（保留 M→L 日志隔离）', () => {
    const m = cliSrc.match(/setTimeout\(\(\) => \{[\s\S]{0,520}?startFollow\('📋 服务器正在运行[^}]*?\);/);
    assert.ok(m, '未找到初始兜底的 startFollow');
    assert.ok(!/,\s*true\s*\)/.test(m[0]), '初始兜底不应 force（否则刚进长命令就被日志刷屏）');
});

check('stopFollow 退出跟踪仍切回 :wow 并恢复提示符', () => {
    assert.ok(/setView\('WOW', 'follow:server-exit'\)/.test(cliSrc), '退出跟踪未切回 :wow');
    assert.ok(/⏹ 服务器已停止，已退出 :mc 日志跟踪，回到 :wow 视图/.test(cliSrc), '缺退出文案');
});

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
