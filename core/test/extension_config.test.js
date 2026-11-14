#!/usr/bin/env node
/**
 * 插件配置持久化（plugin-config）回归
 * ----------------------------------------------------------------
 * 钉死四条底线：
 *   1. 默认值来自 extension.json 的 config 字段，磁盘值覆盖默认值；
 *   2. 写入是「临时文件 + rename」原子操作，且不留 tmp 残骸；
 *   3. 插件名/配置键都不能穿越目录，也不能污染原型；
 *   4. config.json 被手改坏时，备份坏文件并退回默认值，而不是抛异常。
 *
 * 运行：cd core && node test/extension_config.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const ExtensionConfig = require('../src/extension_config');

const WORK = path.join(os.tmpdir(), `extension_config_${process.pid}`);
fs.emptyDirSync(WORK);
const ROOT = path.join(WORK, 'plugin-config');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}
async function checkAsync(title, fn) {
    try { await fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\n=== 插件配置持久化 ===\n');

// 顶层 await 会让 Node 把 .js 当成 ESM，故包一层 IIFE
(async () => {

check('1 未落盘时 all() 就是默认值', () => {
    const pc = new ExtensionConfig({
        pluginName: 'demo', root: ROOT,
        defaults: { enabled: true, limit: 5, nested: { a: 1 } }
    });
    assert.deepStrictEqual(pc.all(), { enabled: true, limit: 5, nested: { a: 1 } });
    assert.strictEqual(pc.exists(), false);
});

check('2 配置文件路径严格落在 plugin-config/<插件>/config.json', () => {
    const pc = new ExtensionConfig({ pluginName: 'demo', root: ROOT, defaults: {} });
    assert.strictEqual(pc.file, path.join(ROOT, 'demo', 'config.json'));
});

check('3 插件名不能穿越目录', () => {
    for (const bad of ['../evil', 'a/b', 'a\\b', '..', '', ' C:x']) {
        assert.throws(() => new ExtensionConfig({ pluginName: bad, root: ROOT, defaults: {} }),
            /不合法/, `未拦截: ${JSON.stringify(bad)}`);
    }
});

await checkAsync('4 set / get 支持点号路径，并真正落盘', async () => {
    const pc = new ExtensionConfig({ pluginName: 'demo', root: ROOT, defaults: { a: { b: 1 } } });
    await pc.set('a.c', 2);
    assert.strictEqual(pc.get('a.c'), 2);
    assert.strictEqual(pc.get('a.b'), 1, '默认值被覆盖丢失');

    const raw = JSON.parse(fs.readFileSync(pc.file, 'utf8'));
    assert.strictEqual(raw.a.c, 2);

    // 重新构造（模拟进程重启）仍读得到
    const pc2 = new ExtensionConfig({ pluginName: 'demo', root: ROOT, defaults: { a: { b: 1 } } });
    assert.strictEqual(pc2.get('a.c'), 2);
});

await checkAsync('5 写入后不残留 .tmp 文件', async () => {
    const pc = new ExtensionConfig({ pluginName: 'tmpcheck', root: ROOT, defaults: { x: 0 } });
    await pc.set('x', 1);
    const files = fs.readdirSync(path.join(ROOT, 'tmpcheck'));
    assert.deepStrictEqual(files.filter(f => f.includes('.tmp-')), []);
});

await checkAsync('6 原子写：rename 之前旧内容始终可读', async () => {
    const pc = new ExtensionConfig({ pluginName: 'atomic', root: ROOT, defaults: { v: 'old' } });
    await pc.set('v', 'old');
    const before = fs.readFileSync(pc.file, 'utf8');
    const p = pc.set('v', 'new');
    // rename 是原子的，写之前读到的必然是完整 JSON（不是半截）
    JSON.parse(before);
    await p;
    assert.strictEqual(JSON.parse(fs.readFileSync(pc.file, 'utf8')).v, 'new');
});

await checkAsync('7 并发 set 串行落地，最终值是最后一次', async () => {
    const pc = new ExtensionConfig({ pluginName: 'race', root: ROOT, defaults: { n: 0 } });
    await Promise.all([
        pc.set('n', 1),
        pc.set('n', 2),
        pc.set('n', 3)
    ]);
    assert.strictEqual(JSON.parse(fs.readFileSync(pc.file, 'utf8')).n, 3);
});

check('8 配置键拒绝 __proto__ / constructor / 空段', () => {
    const pc = new ExtensionConfig({ pluginName: 'proto', root: ROOT, defaults: {} });
    for (const bad of ['__proto__.x', 'a.__proto__.b', 'constructor', 'a..b']) {
        assert.throws(() => pc.set(bad, 1), /配置键/, `未拦截: ${bad}`);
        assert.throws(() => pc.get(bad), /配置键/, `未拦截: ${bad}`);
    }
});

await checkAsync('9 落盘内容里不会出现 __proto__（原型污染不入库）', async () => {
    const pc = new ExtensionConfig({ pluginName: 'proto2', root: ROOT, defaults: {} });
    await pc.merge(JSON.parse('{"a":1,"__proto__":{"polluted":true}}'));
    const raw = fs.readFileSync(pc.file, 'utf8');
    assert.ok(!raw.includes('__proto__'), '原型污染被写进了配置文件');
    assert.strictEqual(({}).polluted, undefined);
});

check('10 损坏的 config.json：备份 + 退回默认值', () => {
    const dir = path.join(ROOT, 'broken');
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.json'), '{ this is not json', 'utf8');

    const pc = new ExtensionConfig({ pluginName: 'broken', root: ROOT, defaults: { safe: true } });
    assert.deepStrictEqual(pc.all(), { safe: true });

    const backups = fs.readdirSync(dir).filter(f => f.includes('.corrupt-'));
    assert.strictEqual(backups.length, 1, `应备份坏文件，实际 ${backups.length}`);
    assert.strictEqual(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '{ this is not json');
});

check('11 顶层是数组/标量也视为损坏', () => {
    const dir = path.join(ROOT, 'arrayjson');
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.json'), '[1,2,3]', 'utf8');
    const pc = new ExtensionConfig({ pluginName: 'arrayjson', root: ROOT, defaults: { ok: 1 } });
    assert.deepStrictEqual(pc.all(), { ok: 1 });
});

await checkAsync('12 reset 恢复默认值', async () => {
    const pc = new ExtensionConfig({ pluginName: 'resetme', root: ROOT, defaults: { d: 1 } });
    await pc.set('d', 99);
    assert.strictEqual(pc.get('d'), 99);
    await pc.reset();
    assert.strictEqual(pc.get('d'), 1);
});

check('13 默认值里的非法键（__proto__）被剥离', () => {
    const defaults = JSON.parse('{"keep":1,"__proto__":{"x":1}}');
    const pc = new ExtensionConfig({ pluginName: 'defaults', root: ROOT, defaults });
    assert.deepStrictEqual(pc.all(), { keep: 1 });
});

check('14 两个插件的配置互不干扰', () => {
    const a = new ExtensionConfig({ pluginName: 'alpha', root: ROOT, defaults: { who: 'alpha' } });
    const b = new ExtensionConfig({ pluginName: 'beta', root: ROOT, defaults: { who: 'beta' } });
    assert.notStrictEqual(a.file, b.file);
    assert.strictEqual(a.get('who'), 'alpha');
    assert.strictEqual(b.get('who'), 'beta');
});

console.log(`\n插件配置持久化: ${passed} 通过, ${failed} 失败\n`);
fs.removeSync(WORK);
process.exitCode = failed ? 1 : 0;
})();
