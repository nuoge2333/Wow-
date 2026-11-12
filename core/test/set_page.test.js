/**
 * 设置页「真·推倒重写」静态断言（执行令阶段 4b）
 *
 * 锁死两件事：
 *   1) 所有旧契约锚点仍在（schema 动态表单 / JVM 预览由后端算 / schema 库）；
 *   2) 重写后的结构约束（CSS 外置、首屏干净、高级折叠、单一转义函数、
 *      零 JVM 拼接、两份主题副本逐字节一致）。
 *
 * 运行：cd core && node test/set_page.test.js
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const THEME = path.join(ROOT, 'themes', 'default');

const html = fs.readFileSync(path.join(WEB, 'set.html'), 'utf8');
const themeHtml = fs.readFileSync(path.join(THEME, 'set.html'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'css', 'set.css'), 'utf8');
const themeCss = fs.readFileSync(path.join(THEME, 'css', 'set.css'), 'utf8');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}

console.log('\n[1] 契约锚点：JVM 预览仍由后端计算，前端零拼接');

check('保留 jvm-preview-panel / 预览命令框 / 提示框', () => {
    for (const id of ['jvm-preview-panel', 'jvm-preview-cmd', 'jvm-preview-note']) {
        assert.ok(html.includes(`id="${id}"`), `缺 ${id}`);
    }
});

check('scheduleJvmPreview 防抖 500ms → refreshJvmPreview', () => {
    assert.ok(/function scheduleJvmPreview\(\)[\s\S]{0,200}setTimeout\(refreshJvmPreview, 500\)/.test(html), '防抖失效');
    assert.ok(html.includes('function refreshJvmPreview()'), '缺 refreshJvmPreview');
});

check('refreshJvmPreview 调 /api/config/preview-jvm 并原样展示后端 command', () => {
    assert.ok(html.includes("apiPost('/api/config/preview-jvm'"), '未请求后端预览接口');
    assert.ok(html.includes('cmdEl.textContent = r.command'), '未用 textContent 原样展示');
    assert.ok(/override_args: Array\.isArray\(override\)/.test(html), 'override_args 未按 JSON 数组规范传参');
});

check('前端零 JVM 拼接，且去掉 || \'g1\' 硬编码', () => {
    assert.ok(!/['"]java['"]\s*\+|['"]-jar['"]/.test(html), '出现 java / -jar 命令拼接');
    assert.ok(!/\|\|\s*'g1'/.test(html), '仍残留 g1 默认档位硬编码');
    assert.ok(/currentValue\('server\.jvm\.template'\)\s*\|\|\s*''/.test(html), '空 template 未交给后端回退');
});

console.log('\n[2] 契约锚点：schema 动态表单 / 双模式 / 模组配置库');

check('按 /api/config/schema 动态渲染（renderConfigForm / controlHtml / fieldRowHtml）', () => {
    assert.ok(html.includes("apiGet('/api/config/schema')"), '未拉取 schema');
    for (const fn of ['renderConfigForm', 'controlHtml', 'fieldRowHtml', 'bindFormEvents']) {
        assert.ok(html.includes(`function ${fn}(`), `缺 ${fn}`);
    }
    assert.ok(/field\.type === 'boolean'/.test(html) && /field\.type === 'select'/.test(html), '控件类型分支缺失');
});

check('表单 / 原始 JSON 双模式与保存链路保留', () => {
    for (const id of ['config-form-wrap', 'config-raw-wrap', 'mode-form-btn', 'mode-raw-btn', 'config-editor']) {
        assert.ok(html.includes(`id="${id}"`), `缺 ${id}`);
    }
    assert.ok(html.includes("apiPost('/api/config/batch'"), '缺批量保存');
    assert.ok(html.includes("apiPost('/api/config', config)"), '缺原始 JSON 保存');
});

check('模组配置库 / 导入模态锚点保留', () => {
    assert.ok(html.includes('/api/schema/list'), '缺 schema 列表');
    assert.ok(html.includes('/api/schema/import'), '缺 schema 导入');
    assert.ok(html.includes('id="schema-import-modal"'), '缺导入模态');
});

check('登录闸门仍在（web.require_login=false 完全免登录）', () => {
    assert.ok(html.includes('wowAuthGuard()'), '未接 wowAuthGuard');
    assert.ok(html.includes('/js/auth_guard.js'), '缺 auth_guard.js');
});

check('apiExec 不把变量拼进命令字符串', () => {
    assert.ok(!/apiExec\(`[^`]*\$\{/.test(html), '仍有拼接变量的 apiExec');
    assert.ok(/apiExec\('plugin remove', \[name\]\)/.test(html), '插件删除命令参数化丢失');
});

console.log('\n[3] 重写结构：CSS 外置 / 首屏干净 / 高级折叠');

check('490 行内联 <style> 已抽走，改用 <link> 引入 set.css', () => {
    assert.ok(!/<style>/.test(html), '仍存在内联 <style> 块');
    assert.ok(html.includes('<link rel="stylesheet" href="/css/set.css">'), '未引入 set.css');
    assert.ok(css.length > 1000, 'set.css 内容异常');
});

check('set.css 不含任何全局 body / html 规则（不裁内容页滚动）', () => {
    assert.ok(!/(^|[^.\w])(body|html)\s*\{/m.test(css), 'set.css 写了全局 body/html 规则');
    // 与 web_scroll.test.js 同口径：局部选择器上的 overflow:hidden 是允许的，
    // 只禁止「body { ... overflow: hidden }」这种会裁掉整页滚动的全局规则。
    assert.ok(!/(^|[^.\w])body\s*\{[^}]*overflow(-y)?:\s*hidden/.test(css), 'set.css 的 body 规则裁掉了滚动');
});

check('首屏只留配置表单 + JVM 预览，扩展功能折进 details.advanced', () => {
    assert.ok(/<details class="advanced">/.test(html), '缺高级折叠区');
    const advPos = html.indexOf('<details class="advanced">');
    const cfgPos = html.indexOf('id="config-form"');
    const jvmPos = html.indexOf('id="jvm-preview-panel"');
    const pluginPos = html.indexOf('id="plugin-list"');
    const schemaPos = html.indexOf('id="schema-list"');
    const themePos = html.indexOf('id="theme-list"');
    assert.ok(cfgPos > 0 && jvmPos > cfgPos, '首屏顺序不符');
    assert.ok(advPos > jvmPos, '高级区应在首屏之后');
    assert.ok(pluginPos > advPos && schemaPos > advPos && themePos > advPos, '扩展 DOM 未收进折叠区');
});

check('扩展功能 DOM 节点全部保留（折叠不等于删除）', () => {
    for (const id of [
        'plugin-install-btn', 'plugin-refresh-btn', 'plugin-filter', 'plugin-list',
        'plugin-install-modal', 'plugin-install-source', 'plugin-install-confirm', 'plugin-install-cancel',
        'schema-count', 'schema-import-btn', 'schema-refresh-btn', 'schema-list',
        'schema-import-modal', 'schema-import-json', 'schema-import-url', 'schema-import-confirm', 'schema-import-cancel',
        'theme-install-btn', 'theme-refresh-btn', 'theme-filter', 'theme-list',
        'theme-install-modal', 'theme-install-source', 'theme-install-confirm', 'theme-install-cancel'
    ]) {
        assert.ok(html.includes(`id="${id}"`), `折叠后丢了 ${id}`);
    }
});

check('两套 HTML 转义函数合并为一个 escapeHtml（无 escHtml 残留）', () => {
    const defs = html.match(/function escapeHtml\(/g) || [];
    assert.strictEqual(defs.length, 1, `escapeHtml 定义 ${defs.length} 次`);
    assert.ok(!/function escHtml\(/.test(html), '仍残留 escHtml 定义');
    assert.ok(!/escHtml\(/.test(html), '仍有 escHtml 调用');
    assert.ok(html.includes("function $ =") || html.includes("const $ ="), '缺 DOM 助手');
});

console.log('\n[4] 主题副本逐字节一致');

check('web/set.html 与 themes/default/set.html 完全一致', () => {
    assert.strictEqual(html, themeHtml, 'set.html 两份不一致');
});

check('web/css/set.css 与 themes/default/css/set.css 完全一致', () => {
    assert.strictEqual(css, themeCss, 'set.css 两份不一致');
});

console.log(`\n${'='.repeat(46)}`);
console.log(`✅ 通过 ${passed} 项，失败 ${failed} 项`);
console.log('='.repeat(46));
process.exit(failed ? 1 : 0);
