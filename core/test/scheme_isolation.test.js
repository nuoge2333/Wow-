#!/usr/bin/env node
/**
 * 方案目录隔离回归（指令：核心路径修复）
 * ----------------------------------------------------------------
 * 现象（历史反复出现）：
 *   新建方案后，方案内容被写到 `scheme/` 根目录，于是 server start 找不到核心。
 *
 * 两个真实入口：
 *   1. 方案名为空串 —— `path.join('/x/scheme', '')` 恰好就是 `/x/scheme` 本身；
 *   2. 方案名为 `..` —— 直接逃到项目根。
 *   再叠加「没有激活方案时 getServerDir 回退到 server.dir=../scheme」，
 *   eula.txt / logs / server.properties 就会永久散落在所有方案旁边。
 *
 * 本用例钉死：
 *   - 每个方案的绝对路径互不相同，且都是 schemesDir 的直接子目录；
 *   - 两个方案各自的核心能被 `ServerManager._getServerJar` 独立找到，互不干扰；
 *   - 非法方案名（空/./../含分隔符/盘符/首尾空白）必须抛错；
 *   - getServerDir 在任何配置下都不得返回 scheme 根目录。
 *
 * 运行：cd core && node test/scheme_isolation.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const WORK = path.join(os.tmpdir(), `scheme_isolation_${process.pid}`);
fs.emptyDirSync(WORK);

// 配置隔离必须在 require config / utils 之前完成：
// utils.getServerDir() 会懒加载 config，config 在首次 require 时读这个环境变量。
process.env.WOW_CONFIG_FILE = path.join(WORK, 'wow.yaml');
fs.writeFileSync(process.env.WOW_CONFIG_FILE, 'server:\n  scheme: null\n  dir: ../server\n', 'utf8');

const utils = require('../src/utils');
const config = require('../src/config');
const SchemeManager = require('../src/scheme_manager');
const ServerManager = require('../src/server');

let passed = 0, failed = 0;
function check(title, fn) {
    try {
        fn();
        console.log(`  ✅ ${title}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${title}\n     ${e.message}`);
        failed++;
    }
}

console.log('\n=== 方案目录隔离 ===\n');

// ─────────────────────────────────────────────
// 把 SchemeManager 整体指到临时目录，绝不碰真实 scheme/
// ─────────────────────────────────────────────
const sm = new SchemeManager();
sm.schemesDir = path.join(WORK, 'scheme');
sm.poolDir = path.join(WORK, 'pool');
sm.poolIndexPath = path.join(sm.poolDir, 'index.yaml');
fs.ensureDirSync(sm.schemesDir);
fs.ensureDirSync(sm.poolDir);
sm.poolIndex = { resources: {}, ref_count: {} };
sm._savePoolIndex = () => {};
sm.autoScheme = false;

const BASE = path.resolve(sm.schemesDir);

check('1 方案路径是 schemesDir 的直接子目录', () => {
    const p = sm._getSchemePath('alpha');
    assert.strictEqual(path.dirname(p), BASE, `父目录不是 schemesDir: ${p}`);
    assert.strictEqual(path.basename(p), 'alpha');
});

check('2 两个方案的绝对路径不同且互不包含', () => {
    const p1 = sm._getSchemePath('alpha');
    const p2 = sm._getSchemePath('beta');
    assert.notStrictEqual(p1, p2);
    assert.ok(!p1.startsWith(p2 + path.sep) && !p2.startsWith(p1 + path.sep));
});

check('3 空方案名必须抛错（否则会精确落到 scheme 根）', () => {
    assert.throws(() => sm._getSchemePath(''), /不合法/);
    // 反证：这正是老实现的事故现场
    assert.strictEqual(path.join(BASE, ''), BASE);
});

check('4 .. / . 必须抛错（否则会逃到项目根）', () => {
    assert.throws(() => sm._getSchemePath('..'), /不合法/);
    assert.throws(() => sm._getSchemePath('.'), /不合法/);
    assert.throws(() => sm._getSchemePath('../evil'), /不合法/);
});

check('5 路径分隔符 / 盘符 / 首尾空白必须抛错', () => {
    for (const bad of ['a/b', 'a\\b', 'C:evil', ' alpha', 'alpha ', '   ']) {
        assert.throws(() => sm._getSchemePath(bad), /不合法/, `未拦截: ${JSON.stringify(bad)}`);
    }
});

check('6 _schemeExists 对非法名返回 false 而不是抛错', () => {
    assert.strictEqual(sm._schemeExists(''), false);
    assert.strictEqual(sm._schemeExists('..'), false);
});

// ─────────────────────────────────────────────
// 造两个「可运行」的方案：各自一份核心，内容不同
// ─────────────────────────────────────────────
function makeScheme(name, jarName, content) {
    const dir = sm._getSchemePath(name);
    fs.ensureDirSync(path.join(dir, 'logs'));
    fs.ensureDirSync(path.join(dir, 'mods'));
    fs.writeFileSync(path.join(dir, jarName), content);
    fs.writeFileSync(path.join(dir, 'scheme.yaml'), [
        `name: ${name}`,
        'version: 1.20.1',
        'loader: vanilla',
        'type: vanilla',
        'state: full',
        'resources:',
        '  core:',
        `    file: ${jarName}`,
        '    hash: deadbeef',
        '    in_pool: false',
        '    pool_path: null',
        '  mods: []',
        '  plugins: []',
        ''
    ].join('\n'), 'utf8');
    return dir;
}

const dirA = makeScheme('alpha', 'alpha-core.jar', 'CORE_ALPHA');
const dirB = makeScheme('beta', 'beta-core.jar', 'CORE_BETA');

check('7 两个方案目录下的核心文件各就各位', () => {
    assert.ok(fs.existsSync(path.join(dirA, 'alpha-core.jar')));
    assert.ok(fs.existsSync(path.join(dirB, 'beta-core.jar')));
    assert.ok(!fs.existsSync(path.join(dirA, 'beta-core.jar')), 'alpha 目录里混进了 beta 的核心');
    assert.ok(!fs.existsSync(path.join(dirB, 'alpha-core.jar')), 'beta 目录里混进了 alpha 的核心');
    assert.ok(!fs.existsSync(path.join(BASE, 'alpha-core.jar')), '核心被写到了 scheme 根目录');
});

// ─────────────────────────────────────────────
// 模拟 server start 的核心查找：各自解析到自己的目录
// ─────────────────────────────────────────────
function fakeServer(dir) {
    const srv = Object.create(ServerManager.prototype);
    srv.serverDir = dir;
    srv.config = {
        getConfig(key, dflt = null) {
            if (key === 'server.jar') return null;              // 未显式配置核心
            if (key === 'server.launchArgsFile') return null;
            if (key === 'server.type') return 'vanilla';
            return dflt;
        }
    };
    return srv;
}

check('8 启动时各自找到自己的核心，不会串到另一个方案', () => {
    assert.strictEqual(fakeServer(dirA)._getServerJar(), 'alpha-core.jar');
    assert.strictEqual(fakeServer(dirB)._getServerJar(), 'beta-core.jar');
});

check('9 _resolveCoreTarget 按相对路径还原到隔离目录内', () => {
    const meta = { file: 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/x.jar' };
    const abs = sm._resolveCoreTarget(dirA, meta);
    assert.ok(abs.startsWith(dirA + path.sep), `核心被解析到方案外: ${abs}`);
});

// ─────────────────────────────────────────────
// getServerDir 永不得返回 scheme 根
// ─────────────────────────────────────────────
const schemesRoot = utils.getSchemesRoot();

check('10 未激活方案时 getServerDir 不返回 scheme 根目录', () => {
    config.setConfig('server.scheme', null);
    config.setConfig('server.dir', '../scheme'); // 故意用老配置
    const dir = utils.getServerDir();
    assert.notStrictEqual(path.resolve(dir), schemesRoot,
        `回退到了 scheme 根目录: ${dir}`);
});

check('11 激活方案名为空串/.. 时同样不落到 scheme 根', () => {
    for (const bad of ['', '..', '../x']) {
        config.setConfig('server.scheme', bad);
        const dir = utils.getServerDir();
        assert.notStrictEqual(path.resolve(dir), schemesRoot,
            `server.scheme=${JSON.stringify(bad)} 时落到了 scheme 根: ${dir}`);
    }
});

check('12 激活真实存在的方案时返回该方案的隔离目录', () => {
    // 用临时方案模拟「已存在的 scheme 子目录」：getServerDir 只认 schemesRoot 下的，
    // 所以这里借用真实 schemesRoot 下一个临时名字，跑完即删。
    const probe = 'iso-probe-' + process.pid;
    const probeDir = path.join(schemesRoot, probe);
    let created = false;
    try {
        fs.ensureDirSync(probeDir);
        created = true;
        config.setConfig('server.scheme', probe);
        config.setConfig('server.dir', '../server');
        const dir = utils.getServerDir();
        assert.strictEqual(path.resolve(dir), path.resolve(probeDir));
    } finally {
        if (created) fs.removeSync(probeDir);
    }
});

check('13 非法方案名不会让 getServerDir 崩溃', () => {
    for (const bad of ['a/b', 'C:x', ' ', 123]) {
        config.setConfig('server.scheme', bad);
        assert.doesNotThrow(() => utils.getServerDir());
    }
});

check('14 isSafeSchemeName 与 getServerDir 的判定一致', () => {
    assert.strictEqual(utils.isSafeSchemeName('alpha'), true);
    assert.strictEqual(utils.isSafeSchemeName('中文方案'), true);
    assert.strictEqual(utils.isSafeSchemeName(''), false);
    assert.strictEqual(utils.isSafeSchemeName('a b'), true); // 内部空格允许
    assert.strictEqual(utils.isSafeSchemeName(' a'), false);
});

// ─────────────────────────────────────────────
console.log(`\n方案目录隔离: ${passed} 通过, ${failed} 失败\n`);
fs.removeSync(WORK);
process.exitCode = failed ? 1 : 0;
