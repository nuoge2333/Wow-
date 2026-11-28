#!/usr/bin/env node
/**
 * sync push 补齐核心 + config set 去引号 回归
 * ----------------------------------------------------------------
 * Bug 1：sync push 直接对「方案目录实体文件」生成清单。方案若处于瘦身状态
 *       （核心/模组 in_pool=true，实体文件已移入 pool），buildManifest 扫到
 *       0 核心 0 模组 → 执行端 core_plan=skip → 收到没有核心的空壳方案。
 *       修法：push 前先 _materializeScheme 补齐，再 buildManifest。
 *
 * Bug 2：`wow config set key "value"` 在 Windows cmd / 包装脚本下，argv 会
 *       把字面引号带进来，原样写进 wow.yaml 就是 `key: '"value"'`，
 *       getConfig 读回的 token / 路径带着一对引号而失效。
 *       修法：setConfig / setConfigs 落盘前剥离两端成对引号。
 *
 * 运行：node test/sync_push_fix.test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'src', 'config'));
const cliSrc = fs.readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8');
const syncClientSrc = fs.readFileSync(path.join(ROOT, 'src', 'sync_client.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n— sync push 补齐瘦身方案 —');

t('push 在 buildManifest 之前先补齐瘦身方案（_materializeScheme）', () => {
    const mat = syncClientSrc.indexOf('await sm._materializeScheme(schemeName)');
    const man = syncClientSrc.indexOf('sync.buildManifest(');
    assert.ok(mat > 0, '未找到推送前补齐调用');
    assert.ok(man > mat, '补齐必须发生在生成清单之前');
});

t('补齐判定覆盖 core / mods / plugins 的 in_pool 与 MINIMAL 状态', () => {
    assert.ok(/meta\.state !== 'full'/.test(syncClientSrc), '未判定非 full 状态');
    assert.ok(/inPool\(meta\.resources && meta\.resources\.core\)/.test(syncClientSrc), '未判定核心 in_pool');
    assert.ok(/\(meta\.resources[\s\S]{0,80}?mods \|\| \[\]\)\.some\(inPool\)/.test(syncClientSrc), '未判定模组 in_pool');
    assert.ok(/\(meta\.resources[\s\S]{0,80}?plugins \|\| \[\]\)\.some\(inPool\)/.test(syncClientSrc), '未判定插件 in_pool');
});

t('补齐后重读 meta（in_pool / 文件布局已更新）', () => {
    const block = syncClientSrc.slice(
        syncClientSrc.indexOf('await sm._materializeScheme(schemeName)'),
        syncClientSrc.indexOf('// ---- 1. 清单 ----')
    );
    assert.ok(/meta = sm\._loadSchemeMeta\(schemeName\)/.test(block), '补齐后未重新加载 meta');
});

t('补齐失败时中止推送并给出明确原因', () => {
    const block = syncClientSrc.slice(
        syncClientSrc.indexOf('try {', syncClientSrc.indexOf('await sm._materializeScheme') - 40),
        syncClientSrc.indexOf('// ---- 1. 清单 ----')
    );
    assert.ok(/catch \(e\)/.test(block) && /推送前补齐方案失败/.test(block), '补齐异常未中止推送');
});

console.log('\n— config set 去引号 —');

t('stripWrappingQuotes 剥离双引号 / 单引号包裹', () => {
    assert.strictEqual(config.stripWrappingQuotes('"abc123"'), 'abc123');
    assert.strictEqual(config.stripWrappingQuotes("'abc123'"), 'abc123');
});

t('值内含同种引号时不误剥离', () => {
    assert.strictEqual(config.stripWrappingQuotes('a "b" c'), 'a "b" c');
});

t('非字符串 / 空串 / 不成对引号原样返回', () => {
    assert.strictEqual(config.stripWrappingQuotes(''), '');
    assert.strictEqual(config.stripWrappingQuotes('"abc'), '"abc');
    assert.strictEqual(config.stripWrappingQuotes('abc"'), 'abc"');
    assert.strictEqual(config.stripWrappingQuotes(null), null);
    assert.strictEqual(config.stripWrappingQuotes(42), 42);
    assert.strictEqual(config.stripWrappingQuotes(true), true);
    const arr = ['x']; assert.strictEqual(config.stripWrappingQuotes(arr), arr);
});

/**
 * config.js 的 CONFIG_FILE 在模块加载时就固定了，运行时改 env 无效。
 * 因此落盘测试用「独立子进程 + 隔离 WOW_CONFIG_FILE」执行。
 */
function runCliWithConfig(tmp, args) {
    return spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.js'), ...args], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000,
        env: { ...process.env, WOW_CONFIG_FILE: tmp, NO_COLOR: '1' }
    });
}

t('config set 落盘：带引号的值写入后不带引号，getConfig 读回干净值', () => {
    const tmp = path.join(os.tmpdir(), `wow-cfg-quote-${process.pid}`);
    try {
        const r = runCliWithConfig(tmp, ['config', 'set', 'test.quoted', '"abc123"']);
        assert.strictEqual(r.status, 0, `CLI 失败: ${r.stdout}${r.stderr}`);
        const raw = fs.readFileSync(tmp, 'utf8');
        assert.ok(/quoted:\s*abc123/.test(raw), `yaml 里仍带引号: ${raw}`);
        assert.ok(!/quoted:\s*['"]abc123/.test(raw), 'yaml 里值被引号包裹');
        const g = runCliWithConfig(tmp, ['config', 'get', 'test.quoted']);
        assert.ok(/=\s*abc123/.test(g.stdout), `get 读回的值带引号: ${g.stdout}`);
    } finally {
        try { fs.rmSync(tmp, { force: true }); } catch (e) { /* 忽略 */ }
    }
});

t('config set 单引号包裹同样剥离', () => {
    const tmp = path.join(os.tmpdir(), `wow-cfg-sq-${process.pid}`);
    try {
        const r = runCliWithConfig(tmp, ['config', 'set', 'test.sq', "'token'"]);
        assert.strictEqual(r.status, 0, `CLI 失败: ${r.stdout}${r.stderr}`);
        const raw = fs.readFileSync(tmp, 'utf8');
        assert.ok(/sq:\s*token/.test(raw), `yaml 里仍带引号: ${raw}`);
    } finally {
        try { fs.rmSync(tmp, { force: true }); } catch (e) { /* 忽略 */ }
    }
});

t('setConfigs 批量落盘同样剥离引号', () => {
    const tmp = path.join(os.tmpdir(), `wow-cfg-quotes-${process.pid}`);
    try {
        const r = runCliWithConfig(tmp, ['config', 'set', 'batch.a', '"token"']);
        assert.strictEqual(r.status, 0, `CLI 失败: ${r.stdout}${r.stderr}`);
        const raw = fs.readFileSync(tmp, 'utf8');
        assert.ok(/a:\s*token/.test(raw), `批量写入未去引号: ${raw}`);
    } finally {
        try { fs.rmSync(tmp, { force: true }); } catch (e) { /* 忽略 */ }
    }
});

t('config set 回显使用清理后的值（与落盘一致）', () => {
    const m = cliSrc.match(/function runConfigWow[\s\S]{0,1200}?console\.log\(`✅ \$\{key\} = \$\{shown\}`\)/);
    assert.ok(m, '回显未使用清理后的 shown 值');
    assert.ok(/stripWrappingQuotes/.test(m[0]), 'shown 未经过去引号处理');
});

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
