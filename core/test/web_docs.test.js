#!/usr/bin/env node
/**
 * Web 面板内置文档查看 —— 后端只读白名单单元测试
 * ----------------------------------------------------------------
 * 锁定三条 P0 红线：路径写死 / 非法 name 拒绝 / 防目录泄露，
 * 以及读取失败时的友好错误（不外泄路径与堆栈）。
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
    try { fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; failures.push({ name, e }); console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const SRC = path.join(__dirname, '../src');
const ROOT = path.join(__dirname, '../..');
const WebDocs = require(path.join(SRC, 'web_docs'));

console.log('\n📖 内置文档白名单（后端）\n');

// ── 白名单内容 ──
check('白名单每条 rel 都指向真实存在的文件', () => {
    for (const d of WebDocs.DOC_DEFS) {
        assert.ok(fs.existsSync(path.join(ROOT, d.rel)), `${d.name} → ${d.rel} 不存在`);
    }
});

check('白名单绝不包含 CHANGELOG / RELEASE_POLICY / DECISIONS / TUI / 内部报告 / 开发规范', () => {
    const blob = WebDocs.DOC_DEFS
        .map(d => `${d.name} ${d.rel}`).join('\n').toUpperCase();
    for (const p of WebDocs.FORBIDDEN_PATTERNS) {
        assert.ok(!blob.includes(String(p).toUpperCase()),
            `白名单混入了禁止文档：${p}`);
    }
});

check('明确点名的禁止文档名全部被 isAllowed 拒绝', () => {
    for (const n of ['CHANGELOG', 'RELEASE_POLICY', 'DECISIONS', 'TUI',
        'LAN_TERRACOTTA-TEST-REPORT', 'MOD_SCHEMAS', 'CF_PROXY', 'WOW']) {
        assert.strictEqual(WebDocs.isAllowed(n), false, `${n} 不应被允许`);
    }
});

check('list() 只给 name/title/group，不泄露任何文件路径', () => {
    const l = WebDocs.list();
    assert.ok(Array.isArray(l.docs) && l.docs.length >= 10);
    assert.ok(Array.isArray(l.groups) && l.groups.length >= 3);
    const json = JSON.stringify(l);
    assert.ok(!/\.md\b/i.test(json), 'list 泄露了 .md 文件名');
    assert.ok(!/docs\//.test(json), 'list 泄露了 docs/ 路径');
    assert.ok(!/\.\./.test(json), 'list 泄露了相对路径');
    for (const d of l.docs) {
        assert.deepStrictEqual(Object.keys(d).sort(), ['group', 'name', 'title']);
    }
});

// ── name 校验（防路径穿越） ──
check('合法文档名通过，大小写不敏感', () => {
    assert.strictEqual(WebDocs.isAllowed('COMMANDS'), true);
    assert.strictEqual(WebDocs.isAllowed('commands'), true);
    assert.strictEqual(WebDocs.isAllowed('TROUBLE_WINDOWS'), true);
    assert.ok(WebDocs.getDef('commands'));
});

check('路径穿越 / 扩展名 / 分隔符 / 空字符一律拒绝', () => {
    const bad = [
        '../../package.json', '../core/wow.yaml', '/etc/passwd', '..\\..\\wow.yaml',
        'COMMANDS.md', 'COMMANDS%00', 'COMMANDS ', ' COMMANDS',
        'docs/CONFIG', 'a/b', 'a.b', '', null, undefined, 0, 123,
        ['COMMANDS'], { name: 'COMMANDS' }, true
    ];
    for (const n of bad) {
        assert.strictEqual(WebDocs.isAllowed(n), false, `不应放行：${JSON.stringify(n)}`);
    }
});

check('read() 对非法 name 返回 forbidden（对应 HTTP 403）', () => {
    assert.strictEqual(WebDocs.read('../../package.json').reason, 'forbidden');
    assert.strictEqual(WebDocs.read('RELEASE_POLICY').reason, 'forbidden');
    assert.strictEqual(WebDocs.read('CHANGELOG').reason, 'forbidden');
    assert.strictEqual(WebDocs.read(undefined).reason, 'forbidden');
});

check('read() 正常返回 Markdown 原文且不含路径字段', () => {
    const r = WebDocs.read('COMMANDS');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.name, 'COMMANDS');
    assert.ok(r.content.includes('完整命令参考'));
    assert.ok(!('rel' in r) && !('abs' in r), '不应返回文件路径');
});

// ── 读取失败：友好错误 ──
check('文件被删时返回友好文案（missing）', () => {
    const orig = fs.existsSync;
    fs.existsSync = p => String(p).endsWith('COMMANDS.md') ? false : orig(p);
    try {
        const r = WebDocs.read('COMMANDS');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'missing');
        assert.strictEqual(r.error, WebDocs.FRIENDLY_READ_ERROR);
    } finally { fs.existsSync = orig; }
});

check('权限 / IO 异常不外泄堆栈与绝对路径（io）', () => {
    const orig = fs.readFileSync;
    fs.readFileSync = () => { throw new Error('EACCES: permission denied /workspace/Wow/docs/COMMANDS.md'); };
    try {
        const r = WebDocs.read('COMMANDS');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'io');
        assert.strictEqual(r.error, WebDocs.FRIENDLY_READ_ERROR);
        assert.ok(!/EACCES|\/workspace|COMMANDS\.md/.test(JSON.stringify(r)), '外泄了内部信息');
    } finally { fs.readFileSync = orig; }
});

check('异常大文件被拒绝，不拖垮面板（too_large）', () => {
    const origStat = fs.statSync;
    fs.statSync = () => ({ isFile: () => true, size: 10 * 1024 * 1024 });
    try {
        const r = WebDocs.read('CONFIG');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.error, WebDocs.FRIENDLY_READ_ERROR);
    } finally { fs.statSync = origStat; }
});

// ── 图片资源：受控接口 ──
check('asset 拒绝路径穿越 / 非图片 / 非法 name', () => {
    assert.strictEqual(WebDocs.resolveAsset('COMMANDS', '../../core/wow.yaml').ok, false);
    assert.strictEqual(WebDocs.resolveAsset('COMMANDS', '../CONFIG.md').ok, false);
    assert.strictEqual(WebDocs.resolveAsset('COMMANDS', 'evil.js').ok, false);
    assert.strictEqual(WebDocs.resolveAsset('COMMANDS', 'a/b.png').ok, false);
    assert.strictEqual(WebDocs.resolveAsset('CHANGELOG', 'x.png').ok, false);
    assert.strictEqual(WebDocs.resolveAsset('../../package.json', 'x.png').ok, false);
});

check('asset 不接受仓库根（非 docs 目录树）下的资源', () => {
    assert.strictEqual(WebDocs.resolveAsset('README', 'LICENSE.png').reason, 'out_of_scope');
});

check('asset 对合法但不存在的图片返回 missing 而非任意读', () => {
    const r = WebDocs.resolveAsset('COMMANDS', 'notexist123.png');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'missing');
});

console.log(`\n📊 结果: ${pass} 通过, ${fail} 失败\n`);
if (fail) {
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.e.message}`));
    process.exit(1);
}
