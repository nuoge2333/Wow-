#!/usr/bin/env node
/**
 * V3.6.2：创建方案优先复用 pool
 * ----------------------------------------------------------------
 * 规则一句话：**池里有的核心就别再下载。**
 *
 * 覆盖点：
 *   1. findPoolCore：按 type/version 定位、挑最像服务端的 jar、忽略缺失文件
 *   2. materializePoolCore：复制进方案 + 引用计数 + 安装器型拒绝
 *   3. SchemeManager.create()：命中池时不调用 installer.install（打桩抛错验证）
 *   4. 未命中池时仍走 installer（打桩返回核心）
 *
 * 注意：create() 会写 config（server.scheme / server.version），
 * 本测试先备份 wow.yaml，结束时原样恢复。
 *
 * 运行：node test/pool_reuse.test.js
 */

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];

async function check(name, fn) {
    try {
        await fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const SRC = path.join(__dirname, '../src');
const SchemeManager = require(path.join(SRC, 'scheme_manager'));
const Installer = require(path.join(SRC, 'installer'));

const CFG_FILE = path.join(__dirname, '../wow.yaml');
const cfgBackup = fs.existsSync(CFG_FILE) ? fs.readFileSync(CFG_FILE) : null;
const restoreCfg = () => {
    // 无论测试成败都还原：否则会留下 server.scheme = 测试方案名
    if (cfgBackup) fs.writeFileSync(CFG_FILE, cfgBackup);
};

/** 造一个临时 SchemeManager（scheme / pool 都在临时目录里） */
function makeSM(tmp) {
    const sm = new SchemeManager();
    sm.schemesDir = path.join(tmp, 'scheme');
    sm.poolDir = path.join(tmp, 'pool');
    sm.poolIndexPath = path.join(sm.poolDir, 'index.yaml');
    sm.poolIndex = { resources: {}, ref_count: {} };
    fs.ensureDirSync(sm.schemesDir);
    fs.ensureDirSync(sm.poolDir);
    return sm;
}

/** 往 pool 里塞一个假核心 */
function putPoolCore(sm, type, version, name, size, hash) {
    const dir = path.join(sm.poolDir, 'cores', type, version);
    fs.ensureDirSync(dir);
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.alloc(size, 7));
    sm.poolIndex.resources[hash] = ['cores', type, version, name].join('/');
    sm.poolIndex.ref_count[hash] = 1;
    sm._savePoolIndex();
    return file;
}

(async () => {
    console.log('\n📋 findPoolCore / materializePoolCore\n');

    await check('命中：返回相对方案根的路径与体积', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-hit-'));
        const sm = makeSM(tmp);
        putPoolCore(sm, 'vanilla', '1.20.1', 'server.jar', 2048, 'h1');
        const hit = sm.findPoolCore('vanilla', '1.20.1');
        assert.ok(hit, '应命中');
        assert.strictEqual(hit.rel, 'server.jar');
        assert.strictEqual(hit.hash, 'h1');
        assert.strictEqual(hit.size, 2048);
        fs.removeSync(tmp);
    });

    await check('多个候选时优先文件名含 server 的 jar', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-pick-'));
        const sm = makeSM(tmp);
        putPoolCore(sm, 'vanilla', '1.20.1', 'aaa.jar', 99999, 'small');
        putPoolCore(sm, 'vanilla', '1.20.1', 'minecraft_server.1.20.1.jar', 1024, 'server');
        const hit = sm.findPoolCore('vanilla', '1.20.1');
        assert.strictEqual(hit.hash, 'server', '应优先 server.jar，而不是体积更大的 aaa.jar');
        fs.removeSync(tmp);
    });

    await check('未命中：版本或类型不匹配时返回 null', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-miss-'));
        const sm = makeSM(tmp);
        putPoolCore(sm, 'vanilla', '1.20.1', 'server.jar', 1024, 'h1');
        assert.strictEqual(sm.findPoolCore('vanilla', '1.19.2'), null);
        assert.strictEqual(sm.findPoolCore('paper', '1.20.1'), null);
        fs.removeSync(tmp);
    });

    await check('索引有记录但文件缺失 => 跳过（不返回幽灵核心）', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-ghost-'));
        const sm = makeSM(tmp);
        sm.poolIndex.resources['ghost'] = 'cores/vanilla/1.20.1/server.jar';
        assert.strictEqual(sm.findPoolCore('vanilla', '1.20.1'), null);
        fs.removeSync(tmp);
    });

    await check('materializePoolCore：复制进方案并增加引用计数', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-mat-'));
        const sm = makeSM(tmp);
        putPoolCore(sm, 'vanilla', '1.20.1', 'server.jar', 4096, 'h1');
        const schemePath = path.join(sm.schemesDir, 'x');
        fs.ensureDirSync(schemePath);
        const before = sm.poolIndex.ref_count['h1'];
        const out = sm.materializePoolCore('vanilla', '1.20.1', schemePath);
        assert.ok(out);
        assert.strictEqual(out.coreRel, 'server.jar');
        assert.strictEqual(fs.statSync(out.corePath).size, 4096);
        assert.strictEqual(sm.poolIndex.ref_count['h1'], before + 1);
        fs.removeSync(tmp);
    });

    await check('materializePoolCore：安装器型（forge）拒绝复用单文件核心', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-forge-'));
        const sm = makeSM(tmp);
        putPoolCore(sm, 'forge', '1.20.1', 'forge-server.jar', 1024, 'hf');
        const schemePath = path.join(sm.schemesDir, 'x');
        fs.ensureDirSync(schemePath);
        assert.strictEqual(sm.materializePoolCore('forge', '1.20.1', schemePath), null);
        fs.removeSync(tmp);
    });

    console.log('\n📋 create() 集成\n');

    await check('命中 pool：create 不调用 installer.install', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-create-'));
        const sm = makeSM(tmp);
        putPoolCore(sm, 'vanilla', '1.20.1', 'server.jar', 8192, 'h1');

        const orig = Installer.prototype.install;
        let called = 0;
        Installer.prototype.install = async () => { called++; throw new Error('不应调用下载'); };
        try {
            await sm.create('reuseok', { version: '1.20.1', loader: 'vanilla', type: 'vanilla' });
            assert.strictEqual(called, 0, 'installer.install 不应被调用');
            const sp = path.join(sm.schemesDir, 'reuseok');
            const meta = sm._loadSchemeMeta('reuseok');
            assert.ok(fs.existsSync(path.join(sp, meta.resources.core.file)), '核心应已复制进方案');
            assert.strictEqual(meta.resources.core.in_pool, true, '池里有备份，in_pool 应为 true');
        } finally {
            Installer.prototype.install = orig;
            fs.removeSync(tmp);
        }
    });

    await check('未命中 pool：仍走 installer（打桩返回核心）', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-miss-create-'));
        const sm = makeSM(tmp);

        const orig = Installer.prototype.install;
        let called = 0;
        Installer.prototype.install = async (type, ver, build, dir) => {
            called++;
            const p = path.join(dir, `vanilla-${ver}.jar`);
            fs.writeFileSync(p, 'STUB');
            return p;
        };
        try {
            await sm.create('fresh', { version: '1.20.1', loader: 'vanilla', type: 'vanilla' });
            assert.strictEqual(called, 1, '应调用一次 installer.install');
        } finally {
            Installer.prototype.install = orig;
            fs.removeSync(tmp);
        }
    });

    restoreCfg();
    console.log(`\n📊 结果: ${pass} 通过, ${fail} 失败\n`);
    if (fail) {
        failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.err.message}`));
        process.exit(1);
    }
})().catch(e => {
    restoreCfg();
    console.error('测试运行异常:', e);
    process.exit(1);
});
