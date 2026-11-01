#!/usr/bin/env node
/**
 * V3.5.20：补齐 CLI 与命令策略之间的断层
 * ----------------------------------------------------------------
 * 背景：scheme pull / scheme prune / scheme status / pool stats 这几个动作
 * 在 SchemeManager、command_policy.js 的 SCHEME_OPS、server.js 的控制台白名单里
 * 都被当作「既有命令」，但 cli.js 从未注册过对应子命令。Web 端放行后 spawn 出来
 * 只会得到 commander 的 unknown command —— 即「Web 放行了一条不存在的命令」。
 *
 * 本测试锁定两件事：
 *   1. 四个子命令确实注册进了 CLI（读 --help 输出，而不是 grep 源码）；
 *   2. pool 统计的口径正确（用临时目录，不碰真实 core/pool）。
 */

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CORE = path.resolve(__dirname, '..');
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

function helpOf(args) {
    const r = spawnSync(process.execPath, [path.join('src', 'cli.js'), ...args, '--help'], {
        cwd: CORE,
        encoding: 'utf8',
        timeout: 20000
    });
    return (r.stdout || '') + (r.stderr || '');
}

console.log('\nCLI 命令注册\n');

const schemeHelp = helpOf(['scheme']);
check('scheme --help 列出 pull', () => assert.match(schemeHelp, /pull <name>/));
check('scheme --help 列出 prune', () => assert.match(schemeHelp, /prune <name>/));
check('scheme --help 列出 status', () => assert.match(schemeHelp, /status \[name\]/));
check('scheme --help 仍保留 create/list/switch/delete/info', () => {
    for (const c of ['create [options] <name>', 'list', 'switch <name>', 'delete <name>', 'info [name]']) {
        assert.ok(schemeHelp.includes(c), `缺少 ${c}`);
    }
});

const poolHelp = helpOf(['pool']);
check('pool --help 存在 stats', () => assert.match(poolHelp, /stats/));

console.log('\npool 统计口径\n');

const poolStats = require('../src/pool_stats');
const { walkPool, measureSize } = poolStats._internals;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-pool-'));
try {
    // pool: mods/1.20.1/a.jar（100B）、mods/1.20.1/a.jar 的重复副本、cores/b.jar（50B）、index.yaml
    fs.ensureDirSync(path.join(tmp, 'pool', 'mods', '1.20.1'));
    fs.ensureDirSync(path.join(tmp, 'pool', 'mods', '1.20.1', 'nested'));
    fs.ensureDirSync(path.join(tmp, 'pool', 'cores'));
    fs.writeFileSync(path.join(tmp, 'pool', 'mods', '1.20.1', 'a.jar'), Buffer.alloc(100));
    fs.writeFileSync(path.join(tmp, 'pool', 'cores', 'b.jar'), Buffer.alloc(50));
    fs.writeFileSync(path.join(tmp, 'pool', 'index.yaml'), Buffer.alloc(10));
    // 方案目录：只有 s1 引用了 a.jar
    fs.ensureDirSync(path.join(tmp, 'scheme', 's1', 'mods'));
    fs.writeFileSync(path.join(tmp, 'scheme', 's1', 'mods', 'a.jar'), Buffer.alloc(100));
    // 运行时目录不参与「引用」判定
    fs.ensureDirSync(path.join(tmp, 'scheme', 's1', 'logs'));
    fs.writeFileSync(path.join(tmp, 'scheme', 's1', 'logs', 'latest.log'), 'x');

    const schemeFiles = poolStats.collectSchemeFileNames(path.join(tmp, 'scheme'));
    check('方案目录收集跳过 logs', () => {
        assert.ok(schemeFiles.has('a.jar'));
        assert.ok(!schemeFiles.has('latest.log'), 'logs 下的文件不该被算作资源引用');
    });

    const r = walkPool(path.join(tmp, 'pool'), schemeFiles);
    check('资源总数 = 2（只算 jar/zip）', () => assert.strictEqual(r.total, 2));
    check('被引用数 = 1', () => assert.strictEqual(r.refs, 1));
    check('按类型归类', () => {
        assert.deepStrictEqual(r.byType, { mods: 1, cores: 1 });
    });
    check('体积按文件名去重且含元数据文件', () => {
        // 100 + 50 + index.yaml(10) = 160
        assert.strictEqual(measureSize(path.join(tmp, 'pool')), 160);
    });

    check('formatSize 分级正确', () => {
        assert.strictEqual(poolStats.formatSize(512), '512 B');
        assert.strictEqual(poolStats.formatSize(2048), '2.0 KB');
        assert.strictEqual(poolStats.formatSize(5 * 1024 * 1024), '5.0 MB');
    });
} finally {
    fs.removeSync(tmp);
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
