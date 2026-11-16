/**
 * 傻瓜式引导回归（init 自愈 + Web 面板自动拉起）
 *
 * 覆盖：
 *   1. wow init 命令描述改为「自愈体检中心」文案
 *   2. QUICKSTART.md 删除独立 wow init 步骤，改为自动初始化说明
 *   3. 首次 wow init 灵魂拷问（Y → web.run_startup=true，标记文件只问一次）
 *   4. 无参数启动自动拉起 Web + 横幅注入 TUI
 *   5. TUI Q页新增「开启/查看 Web 面板」第 10 项 + action + 常驻横幅
 *   6. webBannerLines 生成醒目框线与动态地址
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const SRC = path.join(ROOT, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n— 傻瓜式引导：init 自愈 + Web 自动拉起 —\n');

const cli = read('cli.js');
const itvSrc = read('interactive.js');
const tuiSrc = read('tui.js');

check('init 描述为自愈体检中心文案', () => {
    const m = cli.match(/\.command\('init'\)[\s\S]{0,120}?\.description\('([^']*)'\)/);
    if (!m) throw new Error('未找到 init 命令描述');
    if (!/误删了目录或配置文件/.test(m[1]) || !/检测 Java/.test(m[1])) {
        throw new Error(`描述文案不符: ${m[1]}`);
    }
});

check('QUICKSTART 删除独立 wow init 步骤、改为自动初始化', () => {
    const q = fs.readFileSync(path.join(REPO, 'docs', 'QUICKSTART.md'), 'utf8');
    if (!/直接运行 wow\.sh（或 wow\.bat），系统将自动完成初始化/.test(q)) {
        throw new Error('缺少自动初始化说明');
    }
    // 「## 3. 初始化环境」段内不应再有 `wow init` 命令块
    const sec = q.match(/## 3\. 初始化环境([\s\S]*?)\n---/);
    if (sec && /```[\s\S]*wow init/.test(sec[1])) throw new Error('初始化段仍保留 wow init 命令块');
});

check('init 定义首次灵魂拷问函数与标记文件', () => {
    if (!/async function askWebStartupOnFirstInit\(/.test(cli)) throw new Error('缺少灵魂拷问函数');
    if (!/INIT_WEB_ASKED_FLAG/.test(cli)) throw new Error('缺少只问一次的标记');
    if (!/setConfig\('web\.run_startup', yes\)/.test(cli)) throw new Error('未把选择写入 run_startup');
    if (!/是否是每次启动|是否在每次启动 wow 时自动开启 Web 图形化面板/.test(cli)) throw new Error('缺少拷问题目');
});

check('init action 调用灵魂拷问', () => {
    const m = cli.match(/\.command\('init'\)[\s\S]*?\n    \}\);/);
    if (!m) throw new Error('未找到 init action 块');
    if (!/await askWebStartupOnFirstInit\(\)/.test(m[0])) throw new Error('init action 未调用灵魂拷问');
});

check('无参数启动分支先自动拉起 Web', () => {
    const m = cli.match(/if \(process\.argv\.length <= 2\) \{[\s\S]{0,300}?\n    \} else \{/);
    if (!m) throw new Error('未找到无参数分支');
    if (!/autoStartWebIfEnabled\(\)/.test(m[0])) throw new Error('无参数分支未调用 autoStartWebIfEnabled');
});

check('autoStartWebIfEnabled 检查 run_startup 并注入横幅', () => {
    if (!/async function autoStartWebIfEnabled\(/.test(cli)) throw new Error('缺少自动拉起函数');
    if (!/getConfig\('web\.run_startup', false\)/.test(cli)) throw new Error('未读 run_startup 开关');
    if (!/setWebBanner\(lines\)/.test(cli)) throw new Error('未注入横幅');
});

check('TUI Q页有第 10 项「开启/查看 Web 面板」', () => {
    const itv = require('../src/interactive');
    const q = itv.PAGES.find(p => p.key === 'Q');
    const item = q.items.find(i => i.id === '10');
    if (!item) throw new Error('Q 页无第 10 项');
    if (!/Web 面板/.test(item.label)) throw new Error(`标签不符: ${item.label}`);
    if (q.items.length !== 10) throw new Error(`Q 页项数应为 10，实际 ${q.items.length}`);
});

check('Q10 action 已注册', () => {
    const itv = require('../src/interactive');
    if (typeof itv.ACTION_BY_KEY.get('Q:10') !== 'function') throw new Error('Q:10 无实现');
});

check('TUI 导出 setWebBanner / webBannerLines', () => {
    const itv = require('../src/interactive');
    if (typeof itv.setWebBanner !== 'function') throw new Error('缺 setWebBanner');
    if (typeof itv.webBannerLines !== 'function') throw new Error('缺 webBannerLines');
});

check('drawPage 清屏后绘制常驻横幅', () => {
    if (!/banner/.test(tuiSrc)) throw new Error('drawPage 未消费 banner');
    const m = tuiSrc.match(/function drawPage\(ctx\)[\s\S]*?status\.render/);
    if (!m || !/if \(Array\.isArray\(banner\)/.test(m[0])) throw new Error('drawPage 未绘制横幅');
    if (m && m[0].indexOf('banner') > m[0].indexOf('clear()')) { /* 顺序：clear 后 banner */ }
});

check('webBannerLines 生成醒目框线与动态地址', () => {
    const itv = require('../src/interactive');
    const lines = itv.webBannerLines('127.0.0.1', 9090);
    if (!Array.isArray(lines) || lines.length < 4) throw new Error('横幅行数不足');
    if (!/═{10,}/.test(lines[0])) throw new Error('缺醒目框线上边框');
    if (!/Web 图形化面板已启动/.test(lines.join('\n'))) throw new Error('缺标题');
    if (!/http:\/\/127\.0\.0\.1:9090/.test(lines.join('\n'))) throw new Error('地址/端口未动态填入');
    const exposed = itv.webBannerLines('0.0.0.0', 8080).join('\n');
    if (!/http:\/\/127\.0\.0\.1:8080/.test(exposed)) throw new Error('0.0.0.0 应显示 127.0.0.1');
});

check('setWebBanner 可注入与清除', () => {
    const itv = require('../src/interactive');
    itv.setWebBanner(['a', 'b']);
    itv.setWebBanner(null); // 清除，避免影响其它测试
    if (typeof itv.setWebBanner !== 'function') throw new Error('不可用');
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
if (failed) process.exitCode = 1;
