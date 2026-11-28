#!/usr/bin/env node
/**
 * 封版指令专项回归（三模块）：
 *  模块一：模组端依赖库处理
 *    - 安装后清理 installer jar；Forge/NeoForge 删冗余 vanilla jar；Fabric/Quilt 保留 vanilla jar
 *    - 模组端瘦身不拆 libraries、直接标记 full
 *    - 整体压缩 libraries：整包 tar.gz、切换时整包解压还原（非增量）
 *  模块二：bukkit.yml/spigot.yml 按核心类型白名单生成
 *    - Bukkit 系生成；纯净端（vanilla/forge/neoforge/fabric/quilt）不生成；老方案静默保留
 *  模块三：系统启动全局旧存档迁移
 *    - migrateAllLegacyWorlds 遍历方案、幂等、防丢档
 * 全程临时目录隔离，不碰真实 scheme/pool/wow.yaml。
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const config = require(path.join(SRC, 'config'));
const SchemeManager = require(path.join(SRC, 'scheme_manager'));
const Installer = require(path.join(SRC, 'installer'));
const tarGz = require(path.join(SRC, 'tar_gz'));
const WM = require(path.join(SRC, 'world_manager'));
const ServerProps = require(path.join(SRC, 'server_props'));

let passed = 0, failed = 0;
async function check(title, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${title}`); }
    catch (e) { failed++; console.log(`  ❌ ${title}\n     ${e.message}`); }
}

const WORK = path.join(os.tmpdir(), `release_lockdown_${process.pid}`);
fs.emptyDirSync(WORK);

function makeSM() {
    const sm = new SchemeManager();
    sm.schemesDir = path.join(WORK, 'scheme');
    sm.poolDir = path.join(WORK, 'pool');
    sm.poolIndexPath = path.join(sm.poolDir, 'index.yaml');
    fs.ensureDirSync(sm.schemesDir);
    fs.ensureDirSync(sm.poolDir);
    sm.poolIndex = { resources: {}, ref_count: {} };
    sm._savePoolIndex = () => {};
    return sm;
}
function writeMeta(sm, name, type, extra = {}) {
    const dir = path.join(sm.schemesDir, name);
    fs.ensureDirSync(dir);
    const meta = Object.assign({
        name, version: '1.20.1', type, loader: type, state: 'full',
        resources: { core: { file: 'server.jar', hash: 'hash-' + name, in_pool: true }, mods: [], plugins: [] }
    }, extra);
    fs.writeFileSync(path.join(dir, 'scheme.yaml'), require('js-yaml').dump(meta));
    return { dir, meta };
}

async function main() {
    // ============ 模块二：配置文件白名单 ============
    console.log('\n【模块二】bukkit.yml / spigot.yml 白名单生成\n');
    const sm2 = makeSM();
    const BUKKIT = ['paper', 'purpur', 'leaves', 'spigot', 'bukkit', 'mohist', 'catserver'];
    const PURE = ['vanilla', 'forge', 'neoforge', 'fabric', 'quilt'];
    for (const t of BUKKIT) {
        await check(`${t}: 生成 bukkit.yml + spigot.yml`, () => {
            const d = path.join(WORK, 'cfg_' + t);
            fs.emptyDirSync(d);
            sm2._generateDefaultFiles(d, '1.20.1', t);
            assert.ok(fs.existsSync(path.join(d, 'bukkit.yml')), '缺 bukkit.yml');
            assert.ok(fs.existsSync(path.join(d, 'spigot.yml')), '缺 spigot.yml');
        });
    }
    for (const t of PURE) {
        await check(`${t}: 不生成 bukkit.yml / spigot.yml`, () => {
            const d = path.join(WORK, 'cfg_' + t);
            fs.emptyDirSync(d);
            sm2._generateDefaultFiles(d, '1.20.1', t);
            assert.ok(!fs.existsSync(path.join(d, 'bukkit.yml')), '纯净端不应有 bukkit.yml');
            assert.ok(!fs.existsSync(path.join(d, 'spigot.yml')), '纯净端不应有 spigot.yml');
            assert.ok(fs.existsSync(path.join(d, 'server.properties')), 'server.properties 仍应生成');
            assert.ok(fs.existsSync(path.join(d, 'eula.txt')), 'eula.txt 仍应生成');
        });
    }
    await check('老方案已存在的 bukkit.yml 静默保留（不被覆盖/删除）', () => {
        const d = path.join(WORK, 'cfg_vanilla_old');
        fs.emptyDirSync(d);
        fs.writeFileSync(path.join(d, 'bukkit.yml'), 'CUSTOM: 1\n');
        sm2._generateDefaultFiles(d, '1.20.1', 'vanilla');
        assert.strictEqual(fs.readFileSync(path.join(d, 'bukkit.yml'), 'utf8'), 'CUSTOM: 1\n');
    });

    // ============ 模块一.1：安装后清理 ============
    console.log('\n【模块一.1】安装后废弃文件清理\n');
    const inst = new Installer();
    await check('删除所有 *-installer.jar', () => {
        const d = path.join(WORK, 'clean_all');
        fs.emptyDirSync(d);
        fs.writeFileSync(path.join(d, 'forge-1.20.1-47-installer.jar'), 'x');
        fs.writeFileSync(path.join(d, 'fabric-installer-1.0.jar'), 'x');
        fs.writeFileSync(path.join(d, 'server.jar'), 'CORE');
        inst.cleanupInstallerArtifacts(d, 'forge', {});
        assert.ok(!fs.existsSync(path.join(d, 'forge-1.20.1-47-installer.jar')));
        assert.ok(!fs.existsSync(path.join(d, 'fabric-installer-1.0.jar')));
        assert.ok(fs.existsSync(path.join(d, 'server.jar')), '核心不能误删');
    });
    await check('Forge: 核心已就位时删除根目录 minecraft_server.*.jar', () => {
        const d = path.join(WORK, 'clean_forge');
        fs.emptyDirSync(d);
        const core = path.join(d, 'libraries', 'forge-server.jar');
        fs.ensureDirSync(path.dirname(core));
        fs.writeFileSync(core, 'CORE');
        fs.writeFileSync(path.join(d, 'minecraft_server.1.20.1.jar'), 'VANILLA');
        inst.cleanupInstallerArtifacts(d, 'forge', { serverJarAbs: core });
        assert.ok(!fs.existsSync(path.join(d, 'minecraft_server.1.20.1.jar')));
        assert.ok(fs.existsSync(core), 'Forge 核心保留');
    });
    await check('Forge: 核心未就位时保留 vanilla jar（兜底）', () => {
        const d = path.join(WORK, 'clean_forge_nocore');
        fs.emptyDirSync(d);
        fs.writeFileSync(path.join(d, 'minecraft_server.1.20.1.jar'), 'VANILLA');
        inst.cleanupInstallerArtifacts(d, 'forge', { serverJarAbs: path.join(d, 'missing.jar') });
        assert.ok(fs.existsSync(path.join(d, 'minecraft_server.1.20.1.jar')), '核心未就位不能删兜底');
    });
    await check('Fabric: 保留根目录 vanilla jar（运行必需）', () => {
        const d = path.join(WORK, 'clean_fabric');
        fs.emptyDirSync(d);
        fs.writeFileSync(path.join(d, 'minecraft_server.1.20.1.jar'), 'VANILLA');
        inst.cleanupInstallerArtifacts(d, 'fabric', {});
        assert.ok(fs.existsSync(path.join(d, 'minecraft_server.1.20.1.jar')), 'Fabric 必须保留 vanilla jar');
    });

    // ============ 模块一.2：模组端瘦身守卫 ============
    console.log('\n【模块一.2】模组端取消深度瘦身\n');
    const sm3 = makeSM();
    for (const t of ['forge', 'neoforge', 'fabric', 'quilt']) {
        await check(`${t}: prune 不删 libraries、状态标记 full`, async () => {
            const { dir } = writeMeta(sm3, 'p_' + t, t);
            const libs = path.join(dir, 'libraries', 'net', 'forge');
            fs.ensureDirSync(libs);
            fs.writeFileSync(path.join(libs, 'forge.jar'), 'CORE');
            await sm3._pruneScheme('p_' + t);
            assert.ok(fs.existsSync(path.join(libs, 'forge.jar')), 'libraries 不能被删');
            const meta = sm3._loadSchemeMeta('p_' + t);
            assert.strictEqual(meta.state, 'full');
        });
    }
    await check('模组端 _determineInitialState 直接返回 FULL', () => {
        assert.strictEqual(sm3._determineInitialState([], [], 'forge'), 'full');
        assert.strictEqual(sm3._determineInitialState([], [], 'neoforge'), 'full');
        assert.ok(['full', 'minimal'].includes(sm3._determineInitialState([], [], 'vanilla')));
    });

    // ============ 模块一.3：整体压缩 ============
    console.log('\n【模块一.3】整体压缩 libraries（默认关闭）\n');
    const sm4 = makeSM();
    const origCompress = config.getConfig('compress_mod_libraries', false);
    await check('tar_gz 打包解包往返一致', () => {
        const src = path.join(WORK, 'tar_src');
        fs.emptyDirSync(path.join(src, 'a', 'b'));
        fs.writeFileSync(path.join(src, 'a', 'b', 'x.jar'), 'X'.repeat(1000));
        const out = path.join(WORK, 'tar_out');
        const r = tarGz.unpackTo(tarGz.packDir(src), out);
        assert.strictEqual(r.files, 1);
        assert.strictEqual(fs.readFileSync(path.join(out, 'a', 'b', 'x.jar'), 'utf8'), 'X'.repeat(1000));
    });
    await check('tar_gz 拒绝路径穿越', () => {
        const h = Buffer.alloc(512, 0);
        h.write('/etc/evil', 0, 100, 'ascii');
        h.write('0', 156, 1, 'ascii');
        assert.throws(() => tarGz.unpackTo(require('zlib').gzipSync(Buffer.concat([h, Buffer.alloc(1024)])), path.join(WORK, 'tar_bad')));
    });
    await check('默认关闭时 prune 只标记 full 不产生压缩包', async () => {
        config.setConfig('compress_mod_libraries', false);
        const { dir } = writeMeta(sm4, 'bundle_off', 'forge');
        fs.ensureDirSync(path.join(dir, 'libraries'));
        fs.writeFileSync(path.join(dir, 'libraries', 'forge.jar'), 'CORE');
        await sm4._pruneScheme('bundle_off');
        assert.ok(fs.existsSync(path.join(dir, 'libraries', 'forge.jar')));
        assert.ok(!sm4._loadSchemeMeta('bundle_off').libBundle, '不应产生 libBundle');
    });
    await check('开启后 prune 整体压缩：libraries 消失、libBundle 记录存在', async () => {
        config.setConfig('compress_mod_libraries', true);
        const { dir } = writeMeta(sm4, 'bundle_on', 'forge');
        const libs = path.join(dir, 'libraries', 'deep');
        fs.ensureDirSync(libs);
        fs.writeFileSync(path.join(libs, 'forge.jar'), 'CORE');
        await sm4._pruneScheme('bundle_on');
        assert.ok(!fs.existsSync(path.join(dir, 'libraries')), 'libraries 应被移走');
        const meta = sm4._loadSchemeMeta('bundle_on');
        assert.ok(meta.libBundle && meta.libBundle.file, '应有 libBundle 记录');
        assert.ok(fs.existsSync(path.join(sm4.poolDir, meta.libBundle.file)), '压缩包应在 pool/modlibs');
    });
    await check('materialize 整包解压还原：libraries 完整回来、libBundle 清除、full', async () => {
        const { dir } = writeMeta(sm4, 'bundle_restore', 'forge');
        const libs = path.join(dir, 'libraries', 'deep');
        fs.ensureDirSync(libs);
        fs.writeFileSync(path.join(libs, 'forge.jar'), 'CORE');
        await sm4._pruneScheme('bundle_restore');
        assert.ok(!fs.existsSync(path.join(dir, 'libraries')));
        await sm4._materializeScheme('bundle_restore');
        assert.ok(fs.existsSync(path.join(dir, 'libraries', 'deep', 'forge.jar')), '整包解压应还原深层文件');
        const meta = sm4._loadSchemeMeta('bundle_restore');
        assert.ok(!meta.libBundle, '还原后清除 libBundle');
        assert.strictEqual(meta.state, 'full');
    });
    config.setConfig('compress_mod_libraries', origCompress);

    // ============ 模块三：全局旧存档迁移 ============
    console.log('\n【模块三】系统启动全局旧存档迁移\n');
    await check('遍历方案：符合条件的迁移，其余跳过', () => {
        const root = path.join(WORK, 'schemes_migrate');
        fs.emptyDirSync(root);
        // 方案A：符合迁移条件
        const a = path.join(root, 'A');
        fs.ensureDirSync(path.join(a, 'world'));
        fs.writeFileSync(path.join(a, 'world', 'level.dat'), 'OLD');
        fs.writeFileSync(path.join(a, 'server.properties'), 'level-name=world\n');
        // 方案B：已是 saves/world，不动
        const b = path.join(root, 'B');
        fs.ensureDirSync(path.join(b, 'saves', 'world'));
        fs.writeFileSync(path.join(b, 'saves', 'world', 'level.dat'), 'NEW');
        fs.writeFileSync(path.join(b, 'server.properties'), 'level-name=saves/world\n');
        // 隐藏目录应跳过
        fs.ensureDirSync(path.join(root, '.trash'));
        const r = WM.migrateAllLegacyWorlds(root);
        assert.strictEqual(r.scanned, 2, '只扫描 A、B 两个方案');
        assert.strictEqual(r.migrated.length, 1);
        assert.strictEqual(r.migrated[0].scheme, 'A');
        assert.ok(fs.existsSync(path.join(a, 'saves', 'world', 'level.dat')), 'A 已迁移');
        assert.strictEqual(ServerProps.readProps(a).values['level-name'], 'saves/world');
    });
    await check('幂等：重复迁移不重复搬动', () => {
        const root = path.join(WORK, 'schemes_migrate');
        const r2 = WM.migrateAllLegacyWorlds(root);
        assert.strictEqual(r2.migrated.length, 0, '第二次不应再迁移');
    });

    console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
    fs.removeSync(WORK);
    process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
