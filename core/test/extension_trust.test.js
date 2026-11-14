#!/usr/bin/env node
/**
 * V3.5.21：插件信任表（extension_trust.js）
 * ----------------------------------------------------------------
 * 锁定的行为：
 *   1. 指纹对「文件内容」敏感——改一个字节就变；
 *   2. 指纹对「遍历顺序」不敏感——同一份内容多次计算必须一致
 *      （否则每次启动都提示「插件已变更」，用户会被烦到直接关掉插件系统）；
 *   3. node_modules / .git 不参与指纹（依赖装没装不该改变插件身份）；
 *   4. 信任表三态：new（没记录）/ trusted（指纹一致）/ changed（指纹变了）；
 *   5. 信任表损坏时不抛，按空表处理（宁可多问一次，不要崩）。
 */

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const trust = require('../src/extension_trust');

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-trust-'));
process.on('exit', () => { try { fs.removeSync(tmpRoot); } catch (e) { /* 忽略 */ } });

/** 造一个插件目录：files = { '相对路径': '内容' } */
function makePlugin(name, files) {
    const dir = path.join(tmpRoot, name);
    fs.ensureDirSync(dir);
    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(dir, rel);
        fs.ensureDirSync(path.dirname(full));
        fs.writeFileSync(full, content, 'utf8');
    }
    return dir;
}

console.log('\n指纹计算\n');

check('同一目录两次计算结果相同', () => {
    const dir = makePlugin('p1', { 'extension.json': '{"name":"p1"}', 'index.js': 'module.exports={}' });
    assert.strictEqual(trust.fingerprint(dir), trust.fingerprint(dir));
});

check('结果带 sha256: 前缀', () => {
    const dir = makePlugin('p2', { 'a.txt': 'x' });
    assert.match(trust.fingerprint(dir), /^sha256:[0-9a-f]{64}$/);
});

check('改一个字节指纹就变', () => {
    const dir = makePlugin('p3', { 'a.txt': 'hello' });
    const before = trust.fingerprint(dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hellp', 'utf8'); // o → p
    assert.notStrictEqual(trust.fingerprint(dir), before);
});

check('新增文件指纹改变', () => {
    const dir = makePlugin('p4', { 'a.txt': 'hello' });
    const before = trust.fingerprint(dir);
    fs.writeFileSync(path.join(dir, 'b.txt'), '', 'utf8');
    assert.notStrictEqual(trust.fingerprint(dir), before);
});

check('重命名文件指纹改变（文件名参与计算）', () => {
    const dir = makePlugin('p5', { 'a.txt': 'hello' });
    const before = trust.fingerprint(dir);
    fs.renameSync(path.join(dir, 'a.txt'), path.join(dir, 'c.txt'));
    assert.notStrictEqual(trust.fingerprint(dir), before);
});

check('同名同内容、创建顺序不同 → 指纹相同', () => {
    const a = makePlugin('orderA', { 'index.js': 'X', 'extension.json': 'Y' });
    const b = makePlugin('orderB', { 'extension.json': 'Y', 'index.js': 'X' });
    assert.strictEqual(trust.fingerprint(a), trust.fingerprint(b));
});

check('node_modules 不参与指纹', () => {
    const dir = makePlugin('p6', { 'index.js': 'X' });
    const before = trust.fingerprint(dir);
    fs.ensureDirSync(path.join(dir, 'node_modules', 'left-pad'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'left-pad', 'index.js'), 'huge deps', 'utf8');
    assert.strictEqual(trust.fingerprint(dir), before);
});

check('.git 不参与指纹', () => {
    const dir = makePlugin('p7', { 'index.js': 'X' });
    const before = trust.fingerprint(dir);
    fs.ensureDirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf8');
    assert.strictEqual(trust.fingerprint(dir), before);
});

check('空目录也能给出稳定指纹', () => {
    const dir = path.join(tmpRoot, 'empty');
    fs.ensureDirSync(dir);
    assert.match(trust.fingerprint(dir), /^sha256:[0-9a-f]{64}$/);
});

console.log('\n信任表三态\n');

const trustFile = path.join(tmpRoot, 'trust.json');

check('没有记录 → new', () => {
    const dir = makePlugin('t1', { 'index.js': 'A' });
    assert.strictEqual(trust.checkTrust('t1', trust.fingerprint(dir), trustFile), 'new');
});

check('grant 之后 → trusted', () => {
    const dir = makePlugin('t2', { 'index.js': 'A' });
    const fp = trust.fingerprint(dir);
    trust.grantTrust('t2', fp, trustFile);
    assert.strictEqual(trust.checkTrust('t2', fp, trustFile), 'trusted');
});

check('内容改动后 → changed', () => {
    const dir = makePlugin('t3', { 'index.js': 'A' });
    trust.grantTrust('t3', trust.fingerprint(dir), trustFile);
    fs.writeFileSync(path.join(dir, 'index.js'), 'B', 'utf8');
    assert.strictEqual(trust.checkTrust('t3', trust.fingerprint(dir), trustFile), 'changed');
});

check('撤销信任后 → new', () => {
    const dir = makePlugin('t4', { 'index.js': 'A' });
    const fp = trust.fingerprint(dir);
    trust.grantTrust('t4', fp, trustFile);
    assert.strictEqual(trust.revokeTrust('t4', trustFile), true);
    assert.strictEqual(trust.checkTrust('t4', fp, trustFile), 'new');
});

check('撤销不存在的记录返回 false', () => {
    assert.strictEqual(trust.revokeTrust('nonexistent', trustFile), false);
});

console.log('\n信任表读写健壮性\n');

check('文件不存在时 loadTrust 返回空表', () => {
    const t = trust.loadTrust(path.join(tmpRoot, 'no-such.json'));
    assert.deepStrictEqual(t.plugins, {});
    assert.strictEqual(t.version, 1);
});

check('文件损坏时 loadTrust 不抛、返回空表', () => {
    const bad = path.join(tmpRoot, 'bad.json');
    fs.writeFileSync(bad, '{ 这不是 JSON', 'utf8');
    const t = trust.loadTrust(bad);
    assert.deepStrictEqual(t.plugins, {});
});

check('落盘结构含 version / plugins / fingerprint / trusted_at', () => {
    const f = path.join(tmpRoot, 'shape.json');
    trust.grantTrust('shape', 'sha256:abc', f, '2025-01-02T03:04:05.000Z');
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(raw.version, 1);
    assert.strictEqual(raw.plugins.shape.fingerprint, 'sha256:abc');
    assert.strictEqual(raw.plugins.shape.trusted_at, '2025-01-02T03:04:05.000Z');
});

check('写入留原子临时文件不留残余', () => {
    const f = path.join(tmpRoot, 'atomic.json');
    trust.grantTrust('atomic', 'sha256:x', f);
    assert.strictEqual(fs.existsSync(f + '.tmp'), false, '.tmp 文件未清理');
});

check('多次 grant 不会丢掉已有条目', () => {
    const f = path.join(tmpRoot, 'multi.json');
    trust.grantTrust('a', 'sha256:1', f);
    trust.grantTrust('b', 'sha256:2', f);
    const t = trust.loadTrust(f);
    assert.strictEqual(Object.keys(t.plugins).length, 2);
    assert.strictEqual(t.plugins.a.fingerprint, 'sha256:1');
    assert.strictEqual(t.plugins.b.fingerprint, 'sha256:2');
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
