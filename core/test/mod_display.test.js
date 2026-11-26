#!/usr/bin/env node
/**
 * Web 模组展示完善回归测试：
 * - 搜索卡片渲染 icon_url 图标 + 内置占位图兜底（防裂图）
 * - 列表展示 summary（line-clamp:2 截断）
 * - 「主页」按钮新标签页外链
 * - 详情弹层用 marked + DOMPurify 安全渲染 Markdown body，库缺失降级纯文本
 * 纯静态源码断言，不联网、不启动浏览器。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOWN = fs.readFileSync(path.join(ROOT, 'web', 'down.html'), 'utf8');
const DOWN_THEME = fs.readFileSync(path.join(ROOT, 'themes', 'default', 'down.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\nWeb 模组展示\n');

check('web/ 与 themes/default/ 的 down.html 逐字节一致', () => {
    assert.strictEqual(DOWN, DOWN_THEME, '两份 down.html 不一致');
});

check('内置占位图为内联 SVG data URI（不请求外部、不破图）', () => {
    assert.ok(/MOD_PLACEHOLDER\s*=\s*'data:image\/svg\+xml/.test(DOWN), '缺内置 SVG 占位图');
    assert.ok(/shape-rendering="crispEdges"/.test(DOWN), '占位图非像素风');
});

check('safeIconUrl 只放行 http(s)/data:image，其余回退占位图', () => {
    assert.ok(/function safeIconUrl\(/.test(DOWN), '缺 safeIconUrl');
    assert.ok(/\^https\?:\\\/\\\/|https\?:\\\/\\\//.test(DOWN) || /\^https\?:\/\//.test(DOWN), '未校验 http(s)');
    assert.ok(/data:image\//.test(DOWN), '未放行 data:image');
});

check('图标 img 带 onerror 兜底，杜绝裂图', () => {
    assert.ok(/onerror="this\.onerror=null;this\.src='\$\{MOD_PLACEHOLDER\}'"/.test(DOWN), '图标缺 onerror 兜底');
});

check('卡片用 iconImgHtml 渲染图标', () => {
    assert.ok(/\$\{iconImgHtml\(item\.icon_url, item\.name\)\}/.test(DOWN), '卡片未渲染 icon_url 图标');
});

check('列表用 mod-summary 节点展示 summary，CSS line-clamp:2', () => {
    assert.ok(/class="mod-summary"/.test(DOWN), '缺 mod-summary 节点');
    assert.ok(/\$\{escapeHtml\(item\.summary\)\}/.test(DOWN), '未展示 summary');
    assert.ok(/-webkit-line-clamp:\s*2/.test(DOWN), 'summary 未做 line-clamp:2');
});

check('「主页」按钮新标签页外链', () => {
    assert.ok(/btn-homepage/.test(DOWN), '缺主页按钮');
    assert.ok(/window\.open\(url,\s*'_blank',\s*'noopener,noreferrer'\)/.test(DOWN), '主页按钮未新标签页打开');
});

check('详情引入本地 marked + purify vendor（不走 CDN）', () => {
    assert.ok(/\/js\/vendor\/marked\.min\.js/.test(DOWN), '未引入 marked');
    assert.ok(/\/js\/vendor\/purify\.min\.js/.test(DOWN), '未引入 DOMPurify');
    assert.ok(!/cdn\./i.test(DOWN.match(/marked\.min\.js/)?.[0] || ''), '不应走 CDN');
});

check('详情 body 经 DOMPurify.sanitize 清洗后才写 innerHTML', () => {
    assert.ok(/DOMPurify\.sanitize\(raw/.test(DOWN), 'body 未经 DOMPurify 清洗');
    assert.ok(/FORBID_TAGS/.test(DOWN), '未禁用危险标签');
});

check('渲染库缺失/异常时降级纯文本，绝不 innerHTML 原文', () => {
    assert.ok(/className = 'docs-plain'/.test(DOWN), '缺纯文本降级');
    assert.ok(/pre\.textContent\s*=\s*text/.test(DOWN), '降级未用 textContent');
});

check('详情外链强制 target=_blank + rel=noopener', () => {
    assert.ok(/setAttribute\('target',\s*'_blank'\)/.test(DOWN), '详情链接未设 target');
    assert.ok(/setAttribute\('rel',\s*'noopener noreferrer'\)/.test(DOWN), '详情链接未设 noopener');
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
