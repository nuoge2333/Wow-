/**
 * V3.6.2 Web 面板滚动修复测试（静态断言）
 *
 * 背景：main.css 原来给 html, body 统一写 overflow: hidden，而这份样式被
 * 所有 iframe 内嵌页面共用。结果是 dashboard / set / tool 这类内容超过
 * 一屏的页面被直接裁掉，滚轮完全无效（Edge / Chrome 均复现）。
 *
 * 修复约定（本测试锁定的不变量）：
 *   1. main.css 里 html 不滚动、body 默认可纵向滚动（overflow-y: auto）；
 *   2. main.css 保留 body.shell / body.no-scroll 关闭滚动的出口；
 *   3. 外壳 index.html 的 body 必须挂 shell 类（自身不出滚动条）；
 *   4. left / right 侧栏自己维护 overflow: hidden，不受影响；
 *   5. 内容页（dashboard/set/tool/file/scheme/lan）自己的样式里
 *      不得再给 body 写 overflow: hidden——否则会再次裁掉内容。
 *
 * 运行：cd core && node test/web_scroll.test.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', '..', 'web');
let passed = 0, failed = 0;
function check(title, cond, extra = '') {
    if (cond) { console.log(`  ✅ ${title}`); passed++; }
    else { console.log(`  ❌ ${title}${extra ? '  → ' + extra : ''}`); failed++; }
}
function read(f) { return fs.readFileSync(path.join(WEB, f), 'utf8'); }

console.log('\n=== Web 面板滚动修复 ===\n');

const css = read('css/main.css');

// 1) html 不滚动、body 默认可滚
check('main.css: html 仍为 overflow hidden（防双滚动条）',
    /html\s*\{[^}]*overflow:\s*hidden/.test(css));
check('main.css: body 默认 overflow-y auto（内容页可滚）',
    /body\s*\{[^}]*overflow-y:\s*auto/.test(css));
check('main.css: body 横向不滚动（overflow-x hidden）',
    /body\s*\{[^}]*overflow-x:\s*hidden/.test(css));

// 2) 保留关闭滚动的出口
check('main.css: body.shell / body.no-scroll 可关闭滚动',
    /body\.(shell|no-scroll)[^}]*overflow:\s*hidden/.test(css));

// 3) 外壳挂 shell 类
const index = read('index.html');
check('index.html: body 挂 shell 类（外壳自身不滚动）',
    /<body class="shell">/.test(index));

// 4) 侧栏自带 hidden，行为不变
for (const f of ['left.html', 'right.html']) {
    check(`${f}: 自身保持 body overflow hidden（侧栏不滚）`,
        /body\s*\{[^}]*overflow:\s*hidden/.test(read(f)));
}

// 5) 内容页不得再裁 body
for (const f of ['dashboard.html', 'set.html', 'tool.html', 'file.html', 'scheme.html', 'lan.html']) {
    const m = read(f).match(/<style>[\s\S]*?<\/style>/) || [''];
    const bad = /(^|[^.\w])body\s*\{[^}]*overflow(-y)?:\s*hidden/.test(m[0]);
    check(`${f}: 页内样式未给 body 写 overflow hidden`, !bad,
        '若内容超高会再次被裁且滚轮无效');
}

// 6) body 滚动条样式存在（主题一致性）
check('main.css: body::-webkit-scrollbar 有主题化样式',
    /body::-webkit-scrollbar\s*\{/.test(css));

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed ? 1 : 0);
