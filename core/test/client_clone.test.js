#!/usr/bin/env node
/**
 * wow clone（客户端克隆）测试 —— V4 极简版
 * ----------------------------------------------------------------
 * V4 的契约比 V3 短得多，测试也只盯这四件事：
 *
 *   1. 不猜。版本 / 类型缺失时直接报错，绝不从目录结构里"推测"；
 *   2. 只搬白名单目录。assets / versions / logs 一概不进方案；
 *   3. 客户端模组按**文件名**剔除，移进 mods-disabled/，不删除；
 *   4. 关键步骤失败要回滚，不留半残方案。
 *
 * 不联网、不写真实 scheme 目录：schemeManager 注入临时目录。
 * 运行：node test/client_clone.test.js
 */

const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

const clone = require('../src/client_clone');

let pass = 0, fail = 0;
const failures = [];

async function t(name, fn) {
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

let tmpRoot = null;
function makeTmp(tag) {
    if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-clone-v4-'));
    const dir = path.join(tmpRoot, tag);
    fs.ensureDirSync(dir);
    return dir;
}

/** 造一个"扁平"客户端目录：mods/config/kubejs 直接躺在根下 */
function makeClient(root, opts = {}) {
    const dir = path.join(root, opts.name || 'client');
    fs.ensureDirSync(dir);
    for (const name of ['mods', 'config', 'kubejs']) {
        fs.ensureDirSync(path.join(dir, name));
    }
    for (const f of (opts.mods || [])) {
        fs.writeFileSync(path.join(dir, 'mods', f), 'x');
    }
    fs.writeFileSync(path.join(dir, 'config', 'a.toml'), 'v=1');
    fs.writeFileSync(path.join(dir, 'kubejs', 'b.js'), '//x');
    // 这些都不该被复制
    fs.ensureDirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'big.bin'), 'x');
    fs.ensureDirSync(path.join(dir, 'versions', '1.20.1'));
    fs.writeFileSync(path.join(dir, 'versions', '1.20.1', 'x.json'), '{}');
    fs.ensureDirSync(path.join(dir, 'logs'));
    fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), 'log');
    fs.writeFileSync(path.join(dir, 'options.txt'), 'fov:70');
    return dir;
}

/** 注入临时 scheme 目录的 SchemeManager */
function makeSM(root) {
    const SchemeManagerOrig = require('../src/scheme_manager');
    const sm = new SchemeManagerOrig();
    sm.schemesDir = path.join(root, 'scheme');
    sm.poolDir = path.join(root, 'pool');
    sm.poolIndexPath = path.join(root, 'pool', 'index.yaml');
    sm.poolIndex = { resources: {}, ref_count: {} };
    fs.ensureDirSync(sm.schemesDir);
    return sm;
}

(async () => {
    console.log('\n[1] validateSchemeName\n');

    await t('接受普通名字', () => {
        assert.strictEqual(clone.validateSchemeName('myserver').ok, true);
    });
    await t('拒绝 .. 与路径分隔符', () => {
        assert.strictEqual(clone.validateSchemeName('..').ok, false);
        assert.strictEqual(clone.validateSchemeName('a/b').ok, false);
        assert.strictEqual(clone.validateSchemeName('a\\b').ok, false);
    });

    console.log('\n[2] copyWhitelisted —— 只搬白名单\n');

    await t('只复制 mods/config/kubejs，assets/versions/logs/options.txt 不进方案', () => {
        const root = makeTmp('copy');
        const src = makeClient(root);
        const dest = path.join(root, 'out');
        const r = clone.copyWhitelisted({ srcDir: src, destDir: dest });

        assert.ok(fs.existsSync(path.join(dest, 'mods')));
        assert.ok(fs.existsSync(path.join(dest, 'config', 'a.toml')));
        assert.ok(fs.existsSync(path.join(dest, 'kubejs', 'b.js')));
        assert.ok(!fs.existsSync(path.join(dest, 'assets')), 'assets 不该复制');
        assert.ok(!fs.existsSync(path.join(dest, 'versions')), 'versions 不该复制');
        assert.ok(!fs.existsSync(path.join(dest, 'logs')), 'logs 不该复制');
        assert.ok(!fs.existsSync(path.join(dest, 'options.txt')), 'options.txt 不该复制');
        assert.ok(r.copied >= 2, `copied=${r.copied}`);
        assert.ok(r.failed.length === 0, JSON.stringify(r.failed));
    });

    await t('目录不存在时返回空结果而不是抛错', () => {
        const root = makeTmp('copy-missing');
        const r = clone.copyWhitelisted({ srcDir: path.join(root, 'nope'), destDir: path.join(root, 'out') });
        assert.strictEqual(r.copied, 0);
        assert.strictEqual(r.critical.length, 0);
    });

    console.log('\n[3] cleanMods —— 按文件名剔除\n');

    await t('内置名单命中：sodium / iris 被移进 mods-disabled，create 保留', () => {
        const root = makeTmp('clean');
        const mods = path.join(root, 'mods');
        fs.ensureDirSync(mods);
        for (const f of ['sodium-fabric-0.5.8.jar', 'iris-1.7.0.jar', 'create-1.0.0.jar']) {
            fs.writeFileSync(path.join(mods, f), 'x');
        }
        const r = clone.cleanMods({ modsDir: mods });
        assert.strictEqual(r.scanned, 3);
        assert.strictEqual(r.disabled.length, 2);
        assert.ok(fs.existsSync(path.join(root, 'mods-disabled', 'sodium-fabric-0.5.8.jar')));
        assert.ok(fs.existsSync(path.join(root, 'mods-disabled', 'iris-1.7.0.jar')));
        assert.ok(fs.existsSync(path.join(mods, 'create-1.0.0.jar')), 'create 必须留下');
    });

    await t('force_keep_mods 优先级最高', () => {
        const root = makeTmp('clean-keep');
        const mods = path.join(root, 'mods');
        fs.ensureDirSync(mods);
        fs.writeFileSync(path.join(mods, 'sodium-fabric-0.5.8.jar'), 'x');
        const r = clone.cleanMods({ modsDir: mods, forceKeepMods: ['sodium'] });
        assert.strictEqual(r.disabled.length, 0);
        assert.ok(fs.existsSync(path.join(mods, 'sodium-fabric-0.5.8.jar')));
        assert.ok(r.kept.some(k => /force_keep/.test(k.reason)));
    });

    await t('用户扩展名单同样生效', () => {
        const root = makeTmp('clean-extra');
        const mods = path.join(root, 'mods');
        fs.ensureDirSync(mods);
        fs.writeFileSync(path.join(mods, 'myclientmod-1.0.jar'), 'x');
        const r = clone.cleanMods({ modsDir: mods, extraClientMods: ['myclientmod'] });
        assert.strictEqual(r.disabled.length, 1);
        assert.ok(fs.existsSync(path.join(root, 'mods-disabled', 'myclientmod-1.0.jar')));
    });

    console.log('\n[4] createSkeleton\n');

    await t('建骨架写出 scheme.yaml（state: partial）', () => {
        const root = makeTmp('skel');
        const sm = makeSM(root);
        const r = clone.createSkeleton({ name: 'demo', mcVersion: '1.20.1', type: 'paper', schemeManager: sm });
        assert.strictEqual(r.ok, true, r.reason);
        const meta = yaml.load(fs.readFileSync(path.join(sm.schemesDir, 'demo', 'scheme.yaml'), 'utf8'));
        assert.strictEqual(meta.state, 'partial');
        assert.strictEqual(meta.version, '1.20.1');
        assert.strictEqual(meta.source, 'clone-client');
    });

    await t('重名拒绝', () => {
        const root = makeTmp('skel-dup');
        const sm = makeSM(root);
        clone.createSkeleton({ name: 'dup', mcVersion: '1.20.1', type: 'paper', schemeManager: sm });
        const r = clone.createSkeleton({ name: 'dup', mcVersion: '1.20.1', type: 'paper', schemeManager: sm });
        assert.strictEqual(r.ok, false);
        assert.ok(/已存在/.test(r.reason));
    });

    console.log('\n[5] cloneClient —— 参数缺失即失败（不猜）\n');

    await t('缺版本：直接失败，不建任何目录', async () => {
        const root = makeTmp('need-version');
        const src = makeClient(root);
        const sm = makeSM(root);
        const r = await clone.cloneClient({ clientPath: src, type: 'vanilla', name: 'x', io: clone.makeSilentIO(), schemeManager: sm });
        assert.strictEqual(r.ok, false);
        assert.ok(/缺少 Minecraft 版本/.test(r.reason), r.reason);
        assert.ok(!fs.existsSync(path.join(sm.schemesDir, 'x')));
    });

    await t('缺类型：直接失败', async () => {
        const root = makeTmp('need-type');
        const src = makeClient(root);
        const sm = makeSM(root);
        const r = await clone.cloneClient({ clientPath: src, mcVersion: '1.20.1', name: 'x', io: clone.makeSilentIO(), schemeManager: sm });
        assert.strictEqual(r.ok, false);
        assert.ok(/缺少服务端类型/.test(r.reason), r.reason);
    });

    await t('目录不存在：直接失败', async () => {
        const root = makeTmp('bad-path');
        const sm = makeSM(root);
        const r = await clone.cloneClient({ clientPath: path.join(root, 'nope'), mcVersion: '1.20.1', type: 'vanilla', name: 'x', io: clone.makeSilentIO(), schemeManager: sm });
        assert.strictEqual(r.ok, false);
        assert.ok(/不存在或不是目录/.test(r.reason), r.reason);
    });

    await t('--dry-run 不创建任何东西', async () => {
        const root = makeTmp('dry');
        const src = makeClient(root);
        const sm = makeSM(root);
        const r = await clone.cloneClient({ clientPath: src, mcVersion: '1.20.1', type: 'paper', name: 'dry', dryRun: true, io: clone.makeSilentIO(), schemeManager: sm });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.dryRun, true);
        assert.strictEqual(r.plan.mcVersion, '1.20.1');
        assert.ok(!fs.existsSync(path.join(sm.schemesDir, 'dry')));
    });

    console.log('\n[6] cloneClient —— 全流程\n');

    await t('打桩核心：内容就位、模组剔除、状态 full', async () => {
        const root = makeTmp('e2e');
        const src = makeClient(root, { mods: ['sodium-fabric-0.5.8.jar', 'create-1.0.0.jar'] });
        const sm = makeSM(root);

        const InstallerOrig = require('../src/installer');
        const origInstall = InstallerOrig.prototype.install;
        InstallerOrig.prototype.install = async (type, ver, build, dir) => {
            const p = path.join(dir, `${type}-${ver}-server.jar`);
            fs.writeFileSync(p, 'STUB');
            return p;
        };
        try {
            const r = await clone.cloneClient({
                clientPath: src, mcVersion: '1.20.1', type: 'paper', name: 'e2e',
                io: clone.makeSilentIO(), schemeManager: sm
            });
            assert.strictEqual(r.ok, true, r.reason || '');

            const sp = path.join(sm.schemesDir, 'e2e');
            assert.ok(fs.existsSync(path.join(sp, 'mods', 'create-1.0.0.jar')));
            assert.ok(!fs.existsSync(path.join(sp, 'mods', 'sodium-fabric-0.5.8.jar')));
            assert.ok(fs.existsSync(path.join(sp, 'mods-disabled', 'sodium-fabric-0.5.8.jar')));
            assert.ok(fs.existsSync(path.join(sp, 'config', 'a.toml')));
            assert.ok(fs.existsSync(path.join(sp, 'kubejs', 'b.js')));
            assert.ok(!fs.existsSync(path.join(sp, 'assets')));
            assert.ok(fs.existsSync(path.join(sp, 'eula.txt')), '应生成 eula');

            const meta = yaml.load(fs.readFileSync(path.join(sp, 'scheme.yaml'), 'utf8'));
            assert.strictEqual(meta.state, 'full');
            assert.strictEqual(meta.loader, 'paper');
            assert.strictEqual(meta.version, '1.20.1');
            assert.strictEqual(meta.clone_report.mods_disabled, 1);
        } finally {
            InstallerOrig.prototype.install = origInstall;
        }
    });

    await t('核心装配失败 → 回滚删除方案目录', async () => {
        const root = makeTmp('e2e-rollback');
        const src = makeClient(root);
        const sm = makeSM(root);

        const InstallerOrig = require('../src/installer');
        const origInstall = InstallerOrig.prototype.install;
        InstallerOrig.prototype.install = async () => { throw new Error('模拟核心装配失败'); };
        try {
            const r = await clone.cloneClient({
                clientPath: src, mcVersion: '1.20.1', type: 'paper', name: 'rb',
                io: clone.makeSilentIO(), schemeManager: sm
            });
            assert.strictEqual(r.ok, false);
            assert.ok(/核心装配失败/.test(r.reason), r.reason);
            assert.ok(r.rolledBack);
            assert.ok(!fs.existsSync(path.join(sm.schemesDir, 'rb')), '方案目录必须被删除');
        } finally {
            InstallerOrig.prototype.install = origInstall;
        }
    });

    if (tmpRoot) {
        try { fs.removeSync(tmpRoot); } catch (e) { /* 忽略 */ }
    }

    console.log(`\n====================\n  通过 ${pass} / 失败 ${fail}\n====================`);
    if (fail > 0) {
        for (const f of failures) console.log(`\n[${f.name}]\n${f.err.stack}`);
    }
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('测试异常:', e && e.stack || e);
    process.exit(1);
});
