/**
 * V3.6.3 / 609 指令：M 模式七页 TUI 与开服控制台 :wow 入口
 *
 * 本文件是**源码级 + 模块级混合断言**：
 *
 *   - 模块级：直接 require tui.js / interactive.js，验证页面表、编号跨页归属、
 *     状态栏采集、框线宽度计算等纯函数行为；
 *   - 源码级：TUI 的按键流依赖真实 TTY，无法在 CI 里跑。这里用源码断言锁住
 *     几条「改坏了就再也对不上」的硬约束（单 readline、suspend 顺序、
 *     返回 :wow、底部导航七项）。
 *
 * 运行：cd core && node test/tui_mode.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const tui = require(path.join(SRC, 'tui.js'));
const itv = require(path.join(SRC, 'interactive.js'));

const itvSrc = fs.readFileSync(path.join(SRC, 'interactive.js'), 'utf8');
const tuiSrc = fs.readFileSync(path.join(SRC, 'tui.js'), 'utf8');
const srvSrc = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\nM 模式七页 TUI（V3.6.3 / 609）\n');

// ─────────────────────────────────────────────
console.log('— 页面表结构 —');

check('六页齐全且键为 Q/W/E/R/T/Y', () => {
    assert.deepStrictEqual(itv.PAGES.map(p => p.key), ['Q', 'W', 'E', 'R', 'T', 'Y']);
});

check('每页都有 label / title / items', () => {
    for (const p of itv.PAGES) {
        assert.ok(p.label && p.label.length, `${p.key} 缺 label`);
        assert.ok(p.title && p.title.length, `${p.key} 缺 title`);
        assert.ok(Array.isArray(p.items) && p.items.length > 0, `${p.key} 无功能项`);
    }
});

check('Q 页 6 项 / W 页 9 项 / E 页 7 项 / R 页 8 项 / T 页 7 项 / Y 页 7 项', () => {
    const counts = Object.fromEntries(itv.PAGES.map(p => [p.key, p.items.length]));
    assert.deepStrictEqual(counts, { Q: 6, W: 9, E: 7, R: 8, T: 7, Y: 7 });
});

check('每页内编号不重复', () => {
    for (const p of itv.PAGES) {
        const ids = p.items.map(it => it.id);
        assert.strictEqual(new Set(ids).size, ids.length, `${p.key} 页编号重复: ${ids.join(',')}`);
    }
});

check('每页至少有一项能落到原主菜单的 1~14（保证功能没丢）', () => {
    const origin = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14']);
    const all = itv.PAGES.flatMap(p => p.items.map(it => it.id));
    for (const n of origin) {
        assert.ok(all.includes(n), `原主菜单 ${n} 号没有出现在任何页`);
    }
});

check('Q 页第 1 项就是启动服务器', () => {
    assert.strictEqual(itv.PAGES[0].items[0].id, '1');
});

check('页键不在任何一页的功能编号里（避免歧义）', () => {
    const pageKeys = new Set(itv.PAGES.map(p => p.key));
    for (const p of itv.PAGES) {
        for (const it of p.items) {
            assert.ok(!pageKeys.has(it.id), `${p.key} 页的编号 ${it.id} 与页键冲突`);
        }
    }
});

check('findPageOfItem 能定位编号所在页', () => {
    assert.strictEqual(itv.findPageOfItem('1'), 'Q');
    assert.strictEqual(itv.findPageOfItem('14'), 'Q');   // Q 页先出现
    assert.strictEqual(itv.findPageOfItem('21'), 'W');
    assert.strictEqual(itv.findPageOfItem('141'), 'R');
    assert.strictEqual(itv.findPageOfItem('999'), null);
});

// ─────────────────────────────────────────────
console.log('\n— 底部导航（tui.NAV_ITEMS）—');

check('导航七项，顺序 Q W E R T Y L', () => {
    assert.deepStrictEqual(tui.NAV_ITEMS.map(x => x[0]), ['Q', 'W', 'E', 'R', 'T', 'Y', 'L']);
});

check('导航标签与页面 label 一致', () => {
    for (const [k, label] of tui.NAV_ITEMS) {
        if (k === 'L') continue;   // L 是长命令模式，不在 PAGES 里
        assert.strictEqual(itv.PAGE_MAP.get(k).label, label, `${k} 页标签不一致`);
    }
});

check('PAGE_KEYS 不含 L（L 是模式切换不是页面）', () => {
    assert.ok(!tui.PAGE_KEYS.has('L'));
});

// ─────────────────────────────────────────────
console.log('\n— 宽度计算（中文对齐）—');

check('CJK 字符算 2 列', () => {
    assert.strictEqual(tui.dispWidth('中文'), 4);
    assert.strictEqual(tui.dispWidth('abc'), 3);
    assert.strictEqual(tui.dispWidth('中a'), 3);
});

check('padRight 按显示宽度补齐', () => {
    assert.strictEqual(tui.dispWidth(tui.padRight('方案', 10)), 10);
    assert.strictEqual(tui.dispWidth(tui.padRight('abcdefghijkl', 6)), 12);  // 超长不截断
});

check('WIDTH 与底部导航齐边（框线不能比导航短）', () => {
    const nav = '  ' + tui.NAV_ITEMS.map(([k, l]) => `[${k}]${l}`).join(' ') + '  ' + '[0]退出';
    assert.strictEqual(tui.WIDTH, tui.dispWidth(nav),
        `WIDTH=${tui.WIDTH} 与导航宽度 ${tui.dispWidth(nav)} 不一致`);
    assert.ok(tui.WIDTH <= 78, 'WIDTH 过大，80 列终端会换行');
});

// ─────────────────────────────────────────────
console.log('\n— 编号输入（数字 + 回车）—');

check('数字键只入缓冲，不直接执行（不再是单键触发）', () => {
    const onKey = itvSrc.match(/const onKey = async \(k\) => \{[\s\S]*?\n    \};/);
    assert.ok(onKey, '未找到 onKey');
    const m = onKey[0].match(/\n        if \(\/\^\[0-9\]\$\/\.test\(k\)\) \{[\s\S]*?\n        \}/);
    assert.ok(m, '未找到数字输入分支');
    assert.ok(/numBuf \+= k;/.test(m[0]), '数字未进缓冲');
    assert.ok(!/flushNumber|runItem|setTimeout/.test(m[0]), '数字分支里仍在直接执行');
});

check('回车是唯一执行入口（tui 发 RETURN，interactive 提交编号）', () => {
    assert.ok(/handlers\.onKey\('RETURN'\)/.test(tuiSrc), 'tui 未把回车映射成 RETURN');
    const onKey = itvSrc.match(/const onKey = async \(k\) => \{[\s\S]*?\n    \};/)[0];
    const m = onKey.match(/if \(k === 'RETURN'\) \{[\s\S]*?\n        \}/);
    assert.ok(m, '未找到 RETURN 分支');
    assert.ok(/await flushNumber\(id\)/.test(m[0]), '回车未提交编号');
});

check('空缓冲回车只刷新状态（保留旧行为）', () => {
    const m = itvSrc.match(/if \(k === 'RETURN'\) \{[\s\S]*?\n        \}/)[0];
    assert.ok(/if \(!id\) \{[\s\S]{0,120}?status\.invalidate\(\)/.test(m), '空回车未刷新状态');
});

check('0 要回车才退出，且不再走单键触发', () => {
    const m = itvSrc.match(/if \(k === 'RETURN'\) \{[\s\S]*?\n        \}/)[0];
    assert.ok(/if \(id === '0'\) \{[\s\S]{0,60}?askExit\(\)/.test(m), '0 未在回车分支处理');
    const onKey = itvSrc.match(/const onKey = async \(k\) => \{[\s\S]*?\n    \};/)[0];
    assert.ok(!/\n        if \(k === '0'\) \{/.test(onKey), '仍有单键触发 0 的分支');
    assert.ok(/const askExit = \(\) => \{/.test(itvSrc), '缺 askExit');
});

check('Backspace 删一位（输错了不用重来）', () => {
    assert.ok(/if \(k === 'BACKSPACE'\) \{[\s\S]{0,120}?numBuf\.slice\(0, -1\)/.test(itvSrc),
        'Backspace 未删位');
    // tui 侧不能再把 backspace 当无关键吞掉
    const swallow = tuiSrc.match(/\/\^\(up\|down[\s\S]*?\$\/i/);
    assert.ok(swallow && !/backspace/.test(swallow[0]), 'backspace 仍被吞掉');
});

check('编号长度上限（乱按不会堆出一长串）', () => {
    assert.ok(/numBuf\.length < 4/.test(itvSrc), '缺长度上限');
});

check('跨页编号会自动跳到所属页执行（老习惯敲 22 不该被判无此功能）', () => {
    const m = itvSrc.match(/const runItem = async \(id\) => \{[\s\S]*?\n    \};/);
    assert.ok(m, '未找到 runItem');
    assert.ok(/const owner = findPageOfItem\(id\)/.test(m[0]), '未按编号反查所属页');
    assert.ok(/if \(owner && owner !== state\.page\)[\s\S]{0,120}?state\.page = owner/.test(m[0]),
        '未切换 state.page');
    // 本页优先：跳页只在本页查不到时才发生
    const iLocal = m[0].indexOf('def.items.find');
    const iJump = m[0].indexOf('findPageOfItem(id)');
    assert.ok(iLocal !== -1 && iJump !== -1 && iLocal < iJump, '跳页判定应先查本页');
});

check('编号回显在提示行（输入时不至于看不见自己敲了什么）', () => {
    assert.ok(/input: numBuf \|\| null/.test(itvSrc), 'render 未传 input');
    assert.ok(/ctx\.input/.test(tuiSrc) || /const \{ page, def, status, notice, input, plain \}/.test(tuiSrc),
        'drawPage 未接收 input');
    assert.ok(/编号: /.test(tuiSrc), '提示行未显示「编号:」');
});

// ─────────────────────────────────────────────
console.log('\n— 单 readline 与键盘让位 —');

check('tui 只创建一个 readline 工厂（mkRl）', () => {
    const n = (tuiSrc.match(/readline\.createInterface\(/g) || []).length;
    // mkRl 里 1 处 + askLine 里 1 处（后者是二級菜单的临时行读取器）
    assert.strictEqual(n, 2, `createInterface 出现 ${n} 次，预期 2 次（mkRl + askLine）`);
});

check('suspend 先关 rl 再卸监听（否则会多回显一字符）', () => {
    const m = tuiSrc.match(/suspend\(\) \{[\s\S]*?\n        \},/);
    assert.ok(m, '未找到 suspend');
    const body = m[0];
    const iClose = body.indexOf('old.close()');
    const iRemove = body.indexOf("removeListener('keypress'");
    assert.ok(iClose !== -1 && iRemove !== -1, 'suspend 缺少 close 或 removeListener');
    assert.ok(iClose < iRemove, 'suspend 必须先 close 再卸监听');
});

check('suspend 排空 stdin 残留字节（防止余键被二级菜单吃掉）', () => {
    const m = tuiSrc.match(/suspend\(\) \{[\s\S]*?\n        \},/);
    assert.ok(m && /readableLength/.test(m[0]), 'suspend 未排空 stdin');
});

check('resume 也排空，避免一回到 TUI 就触发下一个功能', () => {
    const m = tuiSrc.match(/resume\(\) \{[\s\S]*?\n        \},/);
    assert.ok(m && /readableLength/.test(m[0]), 'resume 未排空 stdin');
});

check('askLine 用 terminal:false（否则双回显 11/33）', () => {
    const m = tuiSrc.match(/function askLine[\s\S]*?\n\}/);
    assert.ok(m, '未找到 askLine');
    assert.ok(/terminal: false/.test(m[0]), 'askLine 未关掉 readline 自身回显');
});

check('askLine 不再挂 close→finish（会误判为空输入）', () => {
    const m = tuiSrc.match(/function askLine[\s\S]*?\n\}/);
    assert.ok(m && !/rl\.on\('close', \(\) => fin\(''\)\)/.test(m[0]),
        'askLine 仍靠 close 事件收尾');
});

check('interactive 不自己 createInterface（复用 tui 的）', () => {
    // createRL 是给「外部裸调 dispatchMenu」留的兜底，允许存在 1 处
    const n = (itvSrc.match(/readline\.createInterface\(/g) || []).length;
    assert.strictEqual(n, 1, `interactive 里有 ${n} 处 createInterface，预期仅 createRL 中 1 处`);
});

check('makeIo 的 enter 是异步的（等 suspend 的 setImmediate）', () => {
    assert.ok(/async enter\(\) \{ await kb\.suspend\(\); \}/.test(itvSrc),
        'io.enter 必须 await suspend');
    assert.ok(/if \(io\) await io\.enter\(\);/.test(itvSrc),
        '调用处必须 await enter');
});

// ─────────────────────────────────────────────
console.log('\n— 返回逻辑与 L 模式 —');

check('任何功能执行完提示「按回车键返回」', () => {
    assert.ok(/按回车键返回/.test(itvSrc), '缺少返回提示');
    assert.ok(/tui\.askLine\('\\n按回车键返回\.\.\.'\)/.test(itvSrc), '返回提示未走 askLine');
});

check('按回车返回后重绘当前页（render(state.notice)）', () => {
    const m = itvSrc.match(/const flushNumber = async \(id\) => \{[\s\S]*?\n    \};/);
    assert.ok(m, '未找到 flushNumber');
    assert.ok(/render\(state\.notice\)/.test(m[0]), 'flushNumber 未重绘');
});

check('L 模式去处由 onEnterLongCommand 决定（不硬编码 startRepl）', () => {
    assert.ok(/options\.onEnterLongCommand \|\| options\.startRepl/.test(itvSrc),
        'L 分支未优先用 onEnterLongCommand');
});

check('L 分支保留 startRepl 兜底（独立入口仍能进 REPL）', () => {
    const n = (itvSrc.match(/onEnterLongCommand \|\| options\.startRepl/g) || []).length;
    assert.strictEqual(n, 2, `L 分支应有两处（TUI + 兼容模式），实际 ${n}`);
});

check('启动服务器前必须交出键盘（服务端要接管 stdin）', () => {
    const m = itvSrc.match(/async function maybeJumpToServer[\s\S]*?\n\}\n/);
    assert.ok(m, '未找到 maybeJumpToServer');
    const body = m[0];
    // suspend 而不是 close：close 不可逆，启动失败时键盘再也回不来（死界面）
    assert.ok(/await kb\.suspend\(\)/.test(body), '启动前未 suspend 键盘');
    assert.ok(body.indexOf('kb.suspend()') < body.indexOf('serverManager.start('),
        'kb.suspend 应在 serverManager.start 之前');
    // 失败分支必须能把键盘收回来
    const failBranch = body.slice(body.indexOf('catch (e)'));
    assert.ok(/kb\.resume\(\)/.test(failBranch), '启动失败未 resume 键盘');
});

check('服务器已在运行时不退 TUI（stop 不接管 stdin）', () => {
    const m = itvSrc.match(/async function maybeJumpToServer[\s\S]*?\n\}\n/);
    assert.ok(/if \(running\) \{/.test(m[0]), '未区分运行中');
    // 运行中分支里不应出现 kb.close / kb.suspend（stop 不接管 stdin）
    const runBranch = m[0].slice(m[0].indexOf('if (running) {'), m[0].indexOf('// 未运行'));
    assert.ok(!/kb\.(close|suspend)\(\)/.test(runBranch), '运行中分支不应交出键盘');
});

// ─────────────────────────────────────────────
console.log('\n— 开服控制台 :wow（约束③）—');

check('server.js 有 _enterMenuFromConsole', () => {
    assert.ok(/_enterMenuFromConsole\s*\(/.test(srvSrc), '未找到 _enterMenuFromConsole');
});

check(':wow / :2 走进菜单而不是切视图', () => {
    assert.ok(/MODE_ALIASES\[lower\] === 'wow'[\s\S]{0,160}?_enterMenuFromConsole\(\)/.test(srvSrc),
        'MODE_ALIASES 的 wow 未进菜单');
});

check(':wowlog 保留日志视图（原来的 :wow 功能）', () => {
    assert.ok(/:wowlog/.test(srvSrc), '缺 :wowlog 入口');
    assert.ok(/_printConsoleTail\('wow'\)/.test(srvSrc), ':wowlog 未指向 wow 日志');
});

check('从菜单返回必定落回 :wow', () => {
    const m = srvSrc.match(/_enterMenuFromConsole\(\) \{[\s\S]*?\n    \}/);
    assert.ok(m, '未找到函数体');
    assert.ok(/_backToConsole\('wow'\)/.test(m[0]), '返回时未落回 :wow');
});

check('菜单里选 L 也回到 :wow（不是另起 REPL 抢 stdin）', () => {
    const m = srvSrc.match(/_enterMenuFromConsole\(\) \{[\s\S]*?\n    \}/);
    assert.ok(m && /onEnterLongCommand:[\s\S]{0,120}?this\._backToConsole\('wow'\)/.test(m[0]),
        'onEnterLongCommand 未指向 _backToConsole(wow)');
});

check('进菜单期间视图钉在 wow（MC 输出不刷屏）', () => {
    const m = srvSrc.match(/_enterMenuFromConsole\(\) \{[\s\S]*?\n    \}/);
    assert.ok(m && /this\._mode = 'wow'/.test(m[0]), '未设置 _mode=wow');
});

check('_backToConsole 会重建 rl（旧的在进菜单时已关）', () => {
    const m = srvSrc.match(/_backToConsole\(mode = 'wow'\) \{[\s\S]*?\n    \}/);
    assert.ok(m, '未找到 _backToConsole');
    assert.ok(/_createConsoleRl\(\)/.test(m[0]), '未重建 rl');
    assert.ok(/this\._rl\.closed/.test(m[0]), '未判断 rl 是否已关闭');
});

check('控制台路由抽成 _bindConsoleLine（两处复用同一份判定）', () => {
    assert.ok(/_bindConsoleLine\(rl\)/.test(srvSrc), 'start 未调用 _bindConsoleLine');
    assert.ok(/this\._bindConsoleLine\(rl\)/.test(srvSrc), '_backToConsole 未调用 _bindConsoleLine');
    // 绑定函数里必须有 :wow 的判定
    const m = srvSrc.match(/_bindConsoleLine\(rl\) \{[\s\S]*?\n    \}/);
    assert.ok(m && /MODE_ALIASES\[lower\] === 'wow'/.test(m[0]), '_bindConsoleLine 未处理 :wow');
});

check('菜单管理器集合就地构建（不 require cli，避免循环依赖）', () => {
    assert.ok(/_menuOptions\(\) \{/.test(srvSrc), '未找到 _menuOptions');
    const codeLines = srvSrc.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l));
    assert.ok(!codeLines.some(l => /require\(['"]\.\/cli['"]\)/.test(l)),
        'server.js 不应 require cli');
});

check('cli.js 给 buildMenuOptions 注入 onEnterLongCommand 默认值', () => {
    const cliSrc = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');
    assert.ok(/onEnterLongCommand: \(\) => startRepl\(\)/.test(cliSrc),
        'cli 未注入默认 onEnterLongCommand');
});

// ─────────────────────────────────────────────
console.log('\n— 兼容模式（无 TTY）—');

check('canUseTui 在非 TTY 时返回 false', () => {
    // 测试进程本身可能也不是 TTY，这里断言函数存在且可控
    assert.strictEqual(typeof tui.canUseTui, 'function');
    if (!process.stdin.isTTY) {
        assert.strictEqual(tui.canUseTui(), false);
    }
});

check('WOW_NO_TUI 环境变量可强制关闭', () => {
    const m = tuiSrc.match(/function canUseTui\(\) \{[\s\S]*?\n\}/);
    assert.ok(m && /WOW_NO_TUI/.test(m[0]), '未支持 WOW_NO_TUI');
});

check('兼容模式支持页键切页与控制字符', () => {
    assert.ok(/async function runCompatMode/.test(itvSrc), '未找到 runCompatMode');
    const m = itvSrc.match(/async function runCompatMode[\s\S]*?\n\}\n/);
    assert.ok(m, '未找到函数体');
    assert.ok(/PAGE_MAP\.has\(k\)/.test(m[0]), '兼容模式不认页键');
    assert.ok(/k === 'L'/.test(m[0]), '兼容模式不认 L');
});

// ─────────────────────────────────────────────
console.log('\n— dispatchMenu 的 rl 归属 —');

check('TUI 模式下不自建 rl（borrowed 分支）', () => {
    assert.ok(/const borrowed = Boolean\(io\) && !rl;/.test(itvSrc), '缺 borrowed 判定');
    assert.ok(/const ownRl = !rl && !borrowed;/.test(itvSrc), 'ownRl 判定不对');
});

check('子管理器借用的 rl 走 shareRl（TUI 下为 undefined 让其自建临时 rl）', () => {
    assert.ok(/const shareRl = borrowed \? undefined : rl;/.test(itvSrc), '缺 shareRl');
    // quickSet / pack install / theme install|switch 都应传 shareRl
    assert.ok(/props\.quickSet\(undefined, shareRl\)/.test(itvSrc), 'quickSet 未用 shareRl');
    assert.ok(/packGenerator\.install\((filePath|url), shareRl\)/.test(itvSrc), 'pack install 未用 shareRl');
    assert.ok(/themeManager\.(install|switch)\((filePath|name), shareRl\)/.test(itvSrc), 'theme 未用 shareRl');
});

// ─────────────────────────────────────────────
console.log('\n— 状态栏 —');

check('StatusBar 采集 7 个字段且不抛错', () => {
    const sb = new tui.StatusBar({
        config: { getConfig: () => null },
        utils: {
            scanAllJava: () => [{ major: 17 }, { major: 20 }],
            detectJava: () => '/usr/bin/java'
        }
    });
    const d = sb.collect(true);
    for (const k of ['version', 'running', 'pid', 'scheme', 'javaInstalled', 'javaCurrent', 'javaManual']) {
        assert.ok(k in d, `缺字段 ${k}`);
    }
    assert.deepStrictEqual(d.javaInstalled, [17, 20]);
    assert.strictEqual(d.javaCurrent, '/usr/bin/java');
});

check('StatusBar 对抛错的管理器降级而不崩', () => {
    const sb = new tui.StatusBar({
        serverManager: { isRunning() { throw new Error('boom'); } },
        schemeManager: { get currentScheme() { throw new Error('boom'); } },
        config: { getConfig() { throw new Error('boom'); } },
        utils: { scanAllJava() { throw new Error('boom'); } }
    });
    const d = sb.collect(true);
    assert.strictEqual(d.running, false);
    assert.deepStrictEqual(d.javaInstalled, []);
});

check('StatusBar 有 300ms 缓存（避免连按 fork java）', () => {
    let calls = 0;
    const sb = new tui.StatusBar({
        utils: { scanAllJava: () => { calls++; return []; } }
    });
    sb.collect(true);
    sb.collect();
    sb.collect();
    assert.strictEqual(calls, 1, '未命中缓存');
    sb.invalidate();
    sb.collect();
    assert.strictEqual(calls, 2, 'invalidate 后未重采');
});

// ─────────────────────────────────────────────
console.log('\n— 自查修复回归（609 补丁）—');

/** 截获 drawPage 的 stdout，返回行数组（测试进程无颜色，正好是纯文本） */
function captureDraw(ctx) {
    const orig = process.stdout.write.bind(process.stdout);
    const lines = [];
    let buf = '';
    process.stdout.write = (chunk) => {
        buf += String(chunk);
        return true;
    };
    try {
        tui.drawPage(ctx);
    } finally {
        process.stdout.write = orig;
    }
    // clear() 会写 \x1Bc，按行切完过滤掉
    for (const l of buf.split('\n')) {
        if (!l.trim() || l.includes('\x1Bc')) continue;
        lines.push(l);
    }
    return lines;
}

check('三位编号不把标签列顶歪（编号列宽按本页最宽取）', () => {
    const status = { render() {} };
    const lines = captureDraw({
        page: 'R',
        def: {
            key: 'R', label: '网络', title: 't',
            items: [{ id: '14', label: 'AAA' }, { id: '141', label: 'BBB' }, { id: '7', label: 'CCC' }]
        },
        status
    });
    const cols = ['AAA', 'BBB', 'CCC'].map(t => {
        const line = lines.find(l => l.includes(t));
        assert.ok(line, `没画出来: ${t}`);
        return line.indexOf(t);
    });
    assert.strictEqual(new Set(cols).size, 1, `标签起始列不一致: ${cols.join(' / ')}`);
});

check('状态栏渲染 6 行，lastRenderHeight 与之一致（redrawTop 不欠行）', () => {
    const sb = new tui.StatusBar({});
    const orig = process.stdout.write.bind(process.stdout);
    let buf = '';
    process.stdout.write = (c) => { buf += String(c); return true; };
    try {
        sb.render('Q', '服务器');
    } finally {
        process.stdout.write = orig;
    }
    const n = buf.split('\n').filter(l => l.length).length;
    assert.strictEqual(n, 6, `状态栏实际 ${n} 行`);
    assert.strictEqual(tui.getLastRenderHeight(), n, 'lastRenderHeight 与实际行数不符');
});

check('Ctrl+C 双路径去重（keypress 与 rl SIGINT 各报一次，不能连点两次就退出）', () => {
    assert.ok(/let lastInterruptAt = 0;/.test(tuiSrc), '缺去重时间戳');
    assert.ok(/const fireInterrupt = \(\) => \{[\s\S]{0,220}?if \(now - lastInterruptAt < 80\) return;/.test(tuiSrc),
        '缺 80ms 去重窗口');
    // 两条路径都必须走 fireInterrupt，不能各自直调 handlers.onInterrupt
    const keypress = tuiSrc.match(/const onKeypress =[\s\S]*?\n    \};/);
    assert.ok(keypress && /k\.ctrl && \(k\.name === 'c' \|\| k\.name === 'd'\)[\s\S]{0,80}?fireInterrupt\(\)/.test(keypress[0]),
        'keypress 的 ctrl-c 未走去重');
    const sig = tuiSrc.match(/rl\.on\('SIGINT',[\s\S]{0,80}?\}\);/);
    assert.ok(sig && /fireInterrupt\(\)/.test(sig[0]), 'rl 的 SIGINT 未走去重');
    // createKeyboard 体内除 fireInterrupt 外不应再有裸的 onInterrupt 调用点
    // （askLine 里的那份是二级菜单提问的 Ctrl+C，另一条路径，不算）
    const kbFn = tuiSrc.match(/function createKeyboard[\s\S]*?\n\}/)[0];
    const naked = (kbFn.match(/handlers\.onInterrupt\(\)/g) || []).length;
    assert.strictEqual(naked, 1, `createKeyboard 内应只有 fireInterrupt 一处，实际 ${naked}`);
});

check('切页 / 进 L / 退出确认 / EOF 都会丢掉半截编号', () => {
    assert.ok(/const cancelNumber = \(\) => \{ numBuf = ''; \};/.test(itvSrc), '缺 cancelNumber');
    const onKey = itvSrc.match(/const onKey = async \(k\) => \{[\s\S]*?\n    \};/);
    assert.ok(onKey, '未找到 onKey');
    const body = onKey[0];
    const branches = [
        /if \(PAGE_MAP\.has\(k\)\) \{\s*\n\s*cancelNumber\(\)/,
        /if \(k === 'L'\) \{\s*\n\s*cancelNumber\(\)/
    ];
    for (const re of branches) assert.ok(re.test(body), `分支未调用 cancelNumber: ${re}`);
    // 退出确认走 askExit，它必须清缓冲
    assert.ok(/const askExit = \(\) => \{\s*\n\s*cancelNumber\(\)/.test(itvSrc), 'askExit 未清编号');
    assert.ok(/const finishExit = \(\) => \{[\s\S]{0,120}?cancelNumber\(\)/.test(itvSrc), 'finishExit 未清编号');
    assert.ok(/onEof: \(\) => \{[\s\S]{0,80}?cancelNumber\(\)/.test(itvSrc), 'EOF 未清编号');
});

check('退出菜单不结束进程（returnOnExit）：从 :wow 进来不会杀掉服务端', () => {
    assert.ok(/if \(options\.returnOnExit\) \{[\s\S]{0,120}?leaving = 'EXIT'/.test(itvSrc),
        'returnOnExit 未走 EXIT 分支');
    assert.ok(/if \(leaving === 'EXIT'\) \{/.test(itvSrc), '主循环未处理 EXIT');
    assert.ok(/returnOnExit: true/.test(srvSrc), 'server 进菜单时未声明 returnOnExit');
});

check('askLine 在 stdin 结束时会 resolve（Ctrl+D 不再卡死）', () => {
    assert.ok(/stdin\.once\('end', onEnd\)/.test(tuiSrc), '缺 EOF 兜底');
    assert.ok(/function onEnd\(\) \{ fin\(''\); \}/.test(tuiSrc), 'onEnd 未 resolve');
});

check('maybeJumpToServer 在兼容模式下用调用方的 rl 提问（不再 ask(null)）', () => {
    const m = itvSrc.match(/async function maybeJumpToServer[\s\S]*?\n\}\n/);
    assert.ok(m, '未找到函数体');
    const body = m[0];
    assert.ok(!/ioAsk\(io, null/.test(body), '仍有 ioAsk(io, null)：兼容模式提问会被静默跳过');
    assert.ok(/ioAsk\(io, rl, '内存分配/.test(body), '内存提问未传 rl');
    assert.ok(/ioAsk\(io, rl, '是否停止服务器/.test(body), '停止确认未传 rl');
    // 兼容模式的收尾不能开第二个 readline（askLine 会与 compat 的 rl 抢 stdin）
    assert.ok(/else if \(rl\) \{\s*\n\s*await ask\(rl,/.test(body), '兼容模式仍用 askLine 收尾');
});

check('启动失败要把原因带进 notice（重绘会清屏，console.error 会被擦掉）', () => {
    assert.ok(/return noteAndResume\(`❌ 启动失败: \$\{e\.message\}`\)/.test(itvSrc),
        'start 抛错时未返回 message');
    assert.ok(/return noteAndResume\('❌ 启动失败（原因见上一屏）'\)/.test(itvSrc),
        'start 提前返回时未返回 message');
    assert.ok(/if \(r\.message\) state\.notice = r\.message;/.test(itvSrc), 'runItem 未把 message 放进 notice');
});

check('启动失败后键盘能收回（suspend 可逆，close 不可逆）', () => {
    const m = itvSrc.match(/async function maybeJumpToServer[\s\S]*?\n\}\n/);
    const body = m[0];
    assert.ok(!/kb\.close\(\)/.test(body), '仍在用不可逆的 kb.close()');
});

check('清理日志 / 网络信息在 TUI 下也走统一提问通道', () => {
    assert.ok(/async function cleanLogs\(io, rl\)/.test(itvSrc), 'cleanLogs 未接 io');
    assert.ok(/ioAsk\(io, rl, '保留最近几天的日志/.test(itvSrc), '保留天数未走 ioAsk');
    assert.ok(/async function lanNetInfo\(io, rl\)/.test(itvSrc), 'lanNetInfo 未接 io');
    // 这两个函数不应再自己问「按回车返回」（runItem 会统一收尾）
    const body = itvSrc.match(/async function lanNetInfo[\s\S]*?\n\}\n/)[0];
    assert.ok(!/按回车键返回/.test(body), 'lanNetInfo 重复收尾');
});

check('实时日志跟踪等 tail 退出才返回，且不 process.exit（不杀服务端）', () => {
    const body = itvSrc.match(/async function tailLogs\(options\)[\s\S]*?\n\}\n/);
    assert.ok(body, '未找到 tailLogs');
    assert.ok(!/process\.exit/.test(body[0]), 'tailLogs 不应 process.exit');
    assert.ok(/child\.on\('exit'/.test(body[0]), '未等子进程退出');
    assert.ok(/process\.on\('SIGINT', onSigint\)/.test(body[0]), '未自管 Ctrl+C');
    assert.ok(/removeListener\('SIGINT', onSigint\)/.test(body[0]), '收尾未卸 SIGINT');
    // 不再调用会 process.exit 的 logHandler.tail()
    assert.ok(!/logHandler\.tail\(\)/.test(body[0]), '仍在调 logHandler.tail()');
});

check('兼容模式遇到 EOF 不会死循环重绘（管道输入用完必须退出）', () => {
    const m = itvSrc.match(/const raw = \(await ask\(rl,[\s\S]{0,700}?if \(!raw\) continue;/);
    assert.ok(m, '未找到兼容模式读入逻辑');
    assert.ok(/if \(rl\.closed\) \{/.test(m[0]), 'EOF 判定缺失或晚于 continue');
});

check('server.start 返回「是否真的拉起了进程」：失败一律 false', () => {
    const i = srvSrc.indexOf("async start(memory = null, extraJvmArgs = '')");
    assert.ok(i > 0, '未找到 start');
    // 截到下一个方法（_diagnoseCrash 的注释）为止
    const j = srvSrc.indexOf('V3.5.18：异常退出时的本地初级诊断', i);
    const body = srvSrc.slice(i, j > i ? j : i + 12000);
    assert.ok(/return true;/.test(body), '成功路径未返回 true');
    const falses = (body.match(/return false;/g) || []).length;
    // 5 处：已在运行 / 方案目录缺失 ×2 / 核心缺失 / 内存红线
    assert.ok(falses >= 5, `失败路径 return false 只有 ${falses} 处`);
});

check('start 提前返回时不能把 TUI 按「跑完退出」处理', () => {
    assert.ok(/if \(started === false\) \{/.test(itvSrc), '未判定 start 返回值');
    const m = itvSrc.match(/const noteAndResume = async \(message\) => \{[\s\S]*?\n    \};/);
    assert.ok(m, '缺 noteAndResume');
    assert.ok(/kb\.resume\(\)/.test(m[0]), '失败路径未收回键盘');
    assert.ok(!/kb\.close\(\)/.test(m[0]), '失败路径不该 close（不可逆）');
    // 失败原因要停在同一屏给用户看，不能直接重绘
    assert.ok(/按回车键返回/.test(m[0]), '失败后未停一屏');
});

check('从控制台进菜单不重复打印控制台横幅（restored 标记）', () => {
    const m = srvSrc.match(/_enterMenuFromConsole\(\) \{[\s\S]*?\n    \}/);
    assert.ok(m, '未找到函数体');
    assert.ok(/let restored = false;/.test(m[0]), '缺 restored 标记');
    assert.ok(/if \(!restored\) await this\._backToConsole\('wow'\)/.test(m[0]), '未用 restored 去重');
});

// ─────────────────────────────────────────────
console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
