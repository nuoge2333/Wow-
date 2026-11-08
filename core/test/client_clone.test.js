#!/usr/bin/env node
/**
 * V3.5.25：客户端一键克隆为方案 测试
 * ----------------------------------------------------------------
 * 待测规则一句话：**产物是方案，不是目录。**
 *
 * 本测试盯的是四件「看上去能跑、其实会出事」的事：
 *
 *   1. 骨架先建、失败要回滚。
 *      第 2~3 步任一关键步骤失败，必须把 scheme/<name>/ 删干净。留半残方案
 *      比直接失败更糟——用户以为克隆成功了，switch 过去才发现没核心。
 *
 *   2. 白名单的正确性。
 *      assets/libraries/versions 必须不进来（否则几个 GB）；saves 必须不由第 2 步搬
 *      （它要走第 4 步、由用户选）。关键文件（level.dat / mods/*.jar / config/）
 *      复制失败要中止，非关键失败要警告继续。
 *
 *   3. 模组清洗的判定优先级。
 *      force_keep_mods > 元数据 > 名单。用户强制保留的东西绝不能被禁。
 *
 *   4. 不删任何文件。
 *      客户端 jar 改名留档、world/ 冲突时挪成 .bak、只移动不删除。
 *
 * 不联网、不动真实 scheme 目录：全部在 os.tmpdir() 里造。
 * 核心装配用打桩 installer（真流程要下 Forge 安装器跑十几分钟，不适合单测）。
 *
 * 运行：node test/client_clone.test.js
 */

const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
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
        failures.push({ name, error: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

// ==================== 环境搭建 ====================

let tmpRoot = null;

function getTmpRoot() {
    if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-clone-'));
    return tmpRoot;
}

function makeTmp(tag) {
    const dir = path.join(getTmpRoot(), tag);
    fs.ensureDirSync(dir);
    return dir;
}

/** 造一个 jar（zip） */
function makeJar(p, files) {
    const zip = new AdmZip();
    for (const [k, v] of Object.entries(files)) zip.addFile(k, Buffer.from(v, 'utf8'));
    fs.ensureDirSync(path.dirname(p));
    zip.writeZip(p);
    return p;
}

/** 造一个 Fabric 模组 */
function fabricMod(p, json) {
    return makeJar(p, { 'fabric.mod.json': JSON.stringify(json) });
}

/** 造一个 Forge 模组 */
function forgeMod(p, modId) {
    return makeJar(p, { 'META-INF/mods.toml': `[[mods]]\nmodId="${modId}"\n` });
}

/**
 * 造一个完整的客户端实例（版本隔离形态）。
 * @param {string} root  .minecraft 根
 * @param {object} opts  { name, mc, loader, loaderVersion, mods:[{file, meta}], saves:[], withClientJar }
 */
function makeInstance(root, opts = {}) {
    const name = opts.name || '1.20.1-forge-47.2.0';
    const inst = path.join(root, 'versions', name);
    fs.ensureDirSync(inst);

    const json = {
        id: name,
        inheritsFrom: opts.mc || '1.20.1',
        mainClass: opts.mainClass || 'cpw.mods.bootstraplauncher.BootstrapLauncher',
        libraries: [],
        arguments: { game: ['--fml.forgeVersion', opts.loaderVersion || '47.2.0'] }
    };
    if (opts.inheritsFrom === false) delete json.inheritsFrom;
    if (opts.loader === 'fabric') {
        json.mainClass = 'net.fabricmc.loader.impl.launch.knot.KnotClient';
        json.libraries = [{ name: 'net.fabricmc:fabric-loader:0.15.11' }];
        delete json.arguments;
    }
    if (opts.libraries) json.libraries = opts.libraries;
    fs.writeFileSync(path.join(inst, `${name}.json`), JSON.stringify(json, null, 2), 'utf8');

    // mods
    const modsDir = path.join(inst, 'mods');
    fs.ensureDirSync(modsDir);
    for (const m of (opts.mods || [])) {
        if (m.kind === 'fabric') fabricMod(path.join(modsDir, m.file), m.meta);
        else if (m.kind === 'mcmod') makeJar(path.join(modsDir, m.file), { 'mcmod.info': JSON.stringify(m.meta) });
        else if (m.kind === 'plain') makeJar(path.join(modsDir, m.file), { 'plugin.yml': 'name: x' });
        else forgeMod(path.join(modsDir, m.file), m.modId || m.file.replace(/\.jar$/, ''));
    }

    // config
    fs.ensureDirSync(path.join(inst, 'config'));
    fs.writeFileSync(path.join(inst, 'config', 'test.toml'), '# config', 'utf8');

    // saves
    for (const s of (opts.saves || [])) {
        const d = path.join(inst, 'saves', s);
        fs.ensureDirSync(path.join(d, 'region'));
        fs.writeFileSync(path.join(d, 'level.dat'), `LEVEL:${s}`, 'utf8');
        fs.writeFileSync(path.join(d, 'session.lock'), 'LOCK', 'utf8');
        fs.writeFileSync(path.join(d, 'region', 'r.0.0.mca'), 'MCA', 'utf8');
    }

    // 应被剔除的东西
    for (const d of ['resourcepacks', 'shaderpacks', 'logs', 'crash-reports', 'screenshots']) {
        fs.ensureDirSync(path.join(inst, d));
        fs.writeFileSync(path.join(inst, d, 'x.txt'), 'x', 'utf8');
    }
    fs.writeFileSync(path.join(inst, 'options.txt'), 'fov:90', 'utf8');
    fs.writeFileSync(path.join(inst, 'servers.dat'), 'SRV', 'utf8');
    fs.writeFileSync(path.join(inst, 'usercache.json'), '[]', 'utf8');

    // kubejs
    fs.ensureDirSync(path.join(inst, 'kubejs', 'server_scripts'));
    fs.writeFileSync(path.join(inst, 'kubejs', 'server_scripts', 'a.js'), '// k', 'utf8');

    // 客户端核心
    if (opts.withClientJar !== false) {
        fs.writeFileSync(path.join(inst, `${name}.jar`), 'FAKE CLIENT JAR', 'utf8');
    }

    return { inst, json, name };
}

/** 打桩 installer：不联网，直接写一个假核心 */
function stubInstaller(opts = {}) {
    return {
        calls: [],
        async install(type, version, build, targetDir) {
            this.calls.push({ type, version, build, targetDir });
            if (opts.throwErr) throw new Error(opts.throwErr);
            const file = opts.coreName || `${type}-${version}-server.jar`;
            const p = path.join(targetDir, file);
            fs.ensureDirSync(targetDir);
            fs.writeFileSync(p, `STUB CORE ${type} ${version}`, 'utf8');
            return p;
        }
    };
}

// ==================== 用例 ====================

async function main() {
    console.log('\n客户端一键克隆为方案（client_clone）\n');

    // ---------- 路径展开 ----------
    console.log('— 路径展开（第 0 步）—');

    await t('~ 展开为 home', () => {
        assert.strictEqual(clone.expandPath('~'), os.homedir());
        assert.strictEqual(clone.expandPath('~/a/b'), path.join(os.homedir(), 'a/b'));
    });

    await t('终端转义 `\\ ` 还原为空格', () => {
        assert.strictEqual(clone.expandPath('/home/u/My\\ Games/mc'), '/home/u/My Games/mc');
    });

    await t('包裹引号被去掉', () => {
        assert.strictEqual(clone.expandPath('"/tmp/x"'), '/tmp/x');
        assert.strictEqual(clone.expandPath("'/tmp/x'"), '/tmp/x');
    });

    await t('file:// 前缀被剥离并解码', () => {
        assert.strictEqual(clone.expandPath('file:///tmp/a%20b'), '/tmp/a b');
    });

    await t('空 / null 返回空串', () => {
        assert.strictEqual(clone.expandPath(''), '');
        assert.strictEqual(clone.expandPath(null), '');
    });

    // ---------- 方案名校验 ----------
    console.log('\n— 方案名校验（第 1 步）—');

    await t('拒绝路径分隔符与 Windows 保留字符', () => {
        for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
            assert.strictEqual(clone.validateSchemeName(bad).ok, false, `${bad} 应被拒`);
        }
    });

    await t('拒绝空 / 点开头 / 点结尾', () => {
        assert.strictEqual(clone.validateSchemeName('').ok, false);
        assert.strictEqual(clone.validateSchemeName('.hidden').ok, false);
        assert.strictEqual(clone.validateSchemeName('name.').ok, false);
    });

    await t('拒绝 Windows 保留名', () => {
        for (const bad of ['CON', 'con', 'PRN', 'aux', 'NUL', 'com1', 'lpt9']) {
            assert.strictEqual(clone.validateSchemeName(bad).ok, false, `${bad} 应被拒`);
        }
    });

    await t('接受正常名字', () => {
        for (const good of ['my_server', 'my-server', '服务器1', 'a']) {
            assert.strictEqual(clone.validateSchemeName(good).ok, true, `${good} 应通过`);
        }
    });

    // ---------- 实例识别 ----------
    console.log('\n— 实例识别（第 0 步）—');

    await t('Forge：从 inheritsFrom + libraries 读出 MC 与加载器版本', () => {
        const root = makeTmp('det-forge');
        const { inst } = makeInstance(root);
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.ok, true);
        assert.strictEqual(d.mcVersion, '1.20.1');
        assert.strictEqual(d.loader, 'forge');
        assert.strictEqual(d.loaderVersion, '47.2.0');
        assert.strictEqual(d.guessed, false);
    });

    await t('Forge：libraries 里带 MC 前缀的版本号被切成加载器版本', () => {
        const root = makeTmp('det-forge-lib');
        const { inst } = makeInstance(root, {
            mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
            libraries: [{ name: 'net.minecraftforge:forge:1.20.1-47.2.0' }],
            loaderVersion: ''
        });
        // 去掉 arguments 里的 loaderVersion，靠 libraries 推断
        const jsonPath = path.join(inst, '1.20.1-forge-47.2.0.json');
        const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        delete j.arguments;
        fs.writeFileSync(jsonPath, JSON.stringify(j), 'utf8');
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.loaderVersion, '47.2.0');
    });

    await t('Fabric：mainClass 识别 + fabric-loader 版本', () => {
        const root = makeTmp('det-fabric');
        const { inst } = makeInstance(root, { name: '1.20.1-fabric', loader: 'fabric' });
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.loader, 'fabric');
        assert.strictEqual(d.loaderVersion, '0.15.11');
        assert.strictEqual(d.mcVersion, '1.20.1');
    });

    await t('NeoForge：mainClass 含 neoforged', () => {
        const root = makeTmp('det-neo');
        const { inst } = makeInstance(root, {
            name: '1.20.4-neoforge',
            mc: '1.20.4',
            mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
            libraries: [{ name: 'net.neoforged:neoforge:20.4.237' }],
            loaderVersion: ''
        });
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.loader, 'neoforge');
    });

    await t('Quilt：mainClass 含 quiltmc', () => {
        const root = makeTmp('det-quilt');
        const { inst } = makeInstance(root, {
            name: '1.20.1-quilt',
            mainClass: 'org.quiltmc.loader.impl.launch.knot.KnotClient'
        });
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.loader, 'quilt');
    });

    await t('缺版本 json 时回退读 mods 元数据并标记 guessed', () => {
        const root = makeTmp('det-guess');
        const inst = path.join(root, 'versions', 'broken');
        fs.ensureDirSync(path.join(inst, 'mods'));
        fabricMod(path.join(inst, 'mods', 'a.jar'), { id: 'x', depends: { minecraft: '1.20.1' } });
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.ok, true);
        assert.strictEqual(d.guessed, true, '应标记为推测');
        assert.strictEqual(d.loader, 'fabric');
    });

    await t('json 损坏时也回退，不抛异常', () => {
        const root = makeTmp('det-broken');
        const inst = path.join(root, 'versions', 'badjson');
        fs.ensureDirSync(path.join(inst, 'mods'));
        fs.writeFileSync(path.join(inst, 'badjson.json'), '{not json', 'utf8');
        forgeMod(path.join(inst, 'mods', 'a.jar'), 'somemod');
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.ok, true);
        assert.strictEqual(d.guessed, true);
    });

    await t('完全认不出来时 ok=false 并给原因', () => {
        const root = makeTmp('det-fail');
        const inst = path.join(root, 'versions', 'empty');
        fs.ensureDirSync(inst);
        const d = clone.detectInstanceMeta(inst);
        assert.strictEqual(d.ok, false);
        assert.ok(d.reason);
    });

    // ---------- 路径判定 ----------
    console.log('\n— 路径判定（第 0 步）—');

    await t('直接给 versions/<实例> → 认定实例目录', async () => {
        const root = makeTmp('res-inst');
        const { inst } = makeInstance(root);
        const r = await clone.resolveInstance(inst, clone.makeSilentIO());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.instanceDir, inst);
        assert.strictEqual(r.isolated, true);
    });

    await t('给 .minecraft 根目录且只有一个实例 → 自动选中', async () => {
        const root = makeTmp('res-root');
        makeInstance(root);
        const r = await clone.resolveInstance(root, clone.makeSilentIO());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.rootDir, root);
    });

    await t('多个实例 → 通过 choose 选择', async () => {
        const root = makeTmp('res-multi');
        makeInstance(root, { name: 'inst-a' });
        makeInstance(root, { name: 'inst-b' });
        const io = clone.makeSilentIO();
        const r = await clone.resolveInstance(root, io);
        assert.strictEqual(r.ok, true);
        assert.ok(io.asked.some(a => Array.isArray(a.options) && a.options.length === 2));
    });

    await t('只有 mods 没有 versions → 视为未开版本隔离并警告', async () => {
        const root = makeTmp('res-noversions');
        fs.ensureDirSync(path.join(root, 'mods'));
        const io = clone.makeSilentIO();
        const r = await clone.resolveInstance(root, io);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.isolated, false);
    });

    await t('子目录能给向上找到实例（最多 2 级）', async () => {
        const root = makeTmp('res-up');
        const { inst } = makeInstance(root);
        const sub = path.join(inst, 'mods');
        const r = await clone.resolveInstance(sub, clone.makeSilentIO());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.instanceDir, inst);
    });

    await t('完全不相关目录 → 报错不像实例', async () => {
        const root = makeTmp('res-no');
        const sub = path.join(root, 'documents', 'photos');
        fs.ensureDirSync(sub);
        const r = await clone.resolveInstance(sub, clone.makeSilentIO());
        assert.strictEqual(r.ok, false);
        assert.ok(r.reason.includes('不像'));
    });

    await t('不存在的路径 → 报错', async () => {
        const r = await clone.resolveInstance('/nonexistent/xxx', clone.makeSilentIO());
        assert.strictEqual(r.ok, false);
    });

    // ---------- 白名单复制 ----------
    console.log('\n— 白名单复制（第 2 步）—');

    await t('剔除 assets/libraries/versions/资源包/日志', () => {
        const root = makeTmp('copy-excl');
        const src = path.join(root, 'src');
        const dst = path.join(root, 'dst');
        for (const d of ['assets', 'libraries', 'versions', 'resourcepacks', 'shaderpacks', 'logs', 'crash-reports']) {
            fs.ensureDirSync(path.join(src, d));
            fs.writeFileSync(path.join(src, d, 'f.txt'), 'x');
        }
        fs.writeFileSync(path.join(src, 'options.txt'), 'x');
        fs.writeFileSync(path.join(src, 'servers.dat'), 'x');
        fs.ensureDirSync(path.join(src, 'mods'));
        fs.writeFileSync(path.join(src, 'mods', 'a.jar'), 'x');

        const r = clone.copyWhitelisted({ srcDir: src, destDir: dst, io: clone.makeSilentIO() });

        assert.strictEqual(r.copied, 1, '只应复制 mods/a.jar');
        assert.ok(!fs.existsSync(path.join(dst, 'assets')));
        assert.ok(!fs.existsSync(path.join(dst, 'options.txt')));
        assert.ok(fs.existsSync(path.join(dst, 'mods', 'a.jar')));
    });

    await t('saves 不由第 2 步复制（留给第 4 步）', () => {
        const root = makeTmp('copy-saves');
        const src = path.join(root, 'src');
        const dst = path.join(root, 'dst');
        fs.ensureDirSync(path.join(src, 'saves', 'w1'));
        fs.writeFileSync(path.join(src, 'saves', 'w1', 'level.dat'), 'x');
        clone.copyWhitelisted({ srcDir: src, destDir: dst, io: clone.makeSilentIO() });
        assert.ok(!fs.existsSync(path.join(dst, 'saves')), 'saves 不该被第 2 步搬走');
    });

    await t('保留 config / kubejs / 未列出的目录', () => {
        const root = makeTmp('copy-keep');
        const src = path.join(root, 'src');
        const dst = path.join(root, 'dst');
        fs.ensureDirSync(path.join(src, 'config'));
        fs.writeFileSync(path.join(src, 'config', 'a.toml'), 'x');
        fs.ensureDirSync(path.join(src, 'kubejs', 'server_scripts'));
        fs.writeFileSync(path.join(src, 'kubejs', 'server_scripts', 'a.js'), 'x');
        fs.ensureDirSync(path.join(src, 'weirddir'));
        fs.writeFileSync(path.join(src, 'weirddir', 'b.txt'), 'x');

        clone.copyWhitelisted({ srcDir: src, destDir: dst, io: clone.makeSilentIO() });
        assert.ok(fs.existsSync(path.join(dst, 'config', 'a.toml')));
        assert.ok(fs.existsSync(path.join(dst, 'kubejs', 'server_scripts', 'a.js')));
        assert.ok(fs.existsSync(path.join(dst, 'weirddir', 'b.txt')), '未列出的目录应保守保留');
    });

    await t('源目录不存在 → 返回空结果不抛', () => {
        const r = clone.copyWhitelisted({ srcDir: '/nonexistent', destDir: '/tmp/x', io: clone.makeSilentIO() });
        assert.strictEqual(r.copied, 0);
    });

    await t('关键路径判定：level.dat / mods/*.jar / config/ 下文件', () => {
        assert.strictEqual(clone.isCriticalPath('world/level.dat'), true);
        assert.strictEqual(clone.isCriticalPath(path.join('mods', 'a.jar')), true);
        assert.strictEqual(clone.isCriticalPath(path.join('config', 'a.toml')), true);
        assert.strictEqual(clone.isCriticalPath(path.join('config', 'sub', 'a.json')), true);
        assert.strictEqual(clone.isCriticalPath(path.join('kubejs', 'a.js')), false);
        assert.strictEqual(clone.isCriticalPath(path.join('mods', 'a.txt')), false);
    });

    // ---------- 核心装配 ----------
    console.log('\n— 核心装配（第 3 步）—');

    await t('客户端核心改名留档，不删除', () => {
        const root = makeTmp('core-rename');
        const schemePath = path.join(root, 'scheme');
        fs.ensureDirSync(schemePath);
        fs.writeFileSync(path.join(schemePath, 'inst.jar'), 'CLIENT', 'utf8');

        const r = clone.renameClientJars(schemePath, 'inst');
        assert.strictEqual(r.length, 1);
        assert.ok(!fs.existsSync(path.join(schemePath, 'inst.jar')), '原名应已移走');
        assert.ok(fs.existsSync(path.join(schemePath, 'inst.jar.client-jar.bak')), '应改名留档');
        assert.strictEqual(fs.readFileSync(path.join(schemePath, 'inst.jar.client-jar.bak'), 'utf8'), 'CLIENT');
    });

    await t('installCore 走 installer.install 而不是其它路径', async () => {
        const root = makeTmp('core-call');
        const schemePath = path.join(root, 'scheme');
        fs.ensureDirSync(schemePath);
        const inst = stubInstaller();
        const r = await clone.installCore({
            schemePath, type: 'forge', mcVersion: '1.20.1', loaderVersion: '47.2.0',
            instanceName: 'x', installer: inst
        });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(inst.calls.length, 1);
        assert.deepStrictEqual(inst.calls[0].type, 'forge');
        assert.strictEqual(inst.calls[0].version, '1.20.1');
        assert.strictEqual(inst.calls[0].build, '47.2.0', '加载器版本应作为 build 传入');
    });

    await t('installer 抛错 → ok=false 带原因', async () => {
        const root = makeTmp('core-err');
        const r = await clone.installCore({
            schemePath: root, type: 'forge', mcVersion: '1.20.1',
            instanceName: 'x', installer: stubInstaller({ throwErr: '下载失败' })
        });
        assert.strictEqual(r.ok, false);
        assert.ok(r.reason.includes('下载失败'));
    });

    await t('installer 没产出文件 → ok=false', async () => {
        const root = makeTmp('core-nofile');
        const fake = { async install() { return '/nonexistent/core.jar'; } };
        const r = await clone.installCore({
            schemePath: root, type: 'vanilla', mcVersion: '1.20.1', instanceName: 'x', installer: fake
        });
        assert.strictEqual(r.ok, false);
        assert.ok(r.reason.includes('未产出'));
    });

    // ---------- 存档 ----------
    console.log('\n— 存档迁移（第 4 步）—');

    await t('列出含 level.dat 的存档', () => {
        const root = makeTmp('save-list');
        const saves = path.join(root, 'saves');
        fs.ensureDirSync(path.join(saves, 'w1'));
        fs.writeFileSync(path.join(saves, 'w1', 'level.dat'), 'x');
        fs.ensureDirSync(path.join(saves, 'notaworld'));
        fs.writeFileSync(path.join(saves, 'notaworld', 'readme.txt'), 'x');

        const list = clone.listSaves(saves);
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].name, 'w1');
    });

    await t('迁移存档并删除 session.lock，保留 datapacks', () => {
        const root = makeTmp('save-mig');
        const saves = path.join(root, 'saves');
        const world = path.join(root, 'scheme', 'world');
        fs.ensureDirSync(path.join(saves, 'w1', 'region'));
        fs.writeFileSync(path.join(saves, 'w1', 'level.dat'), 'LVL');
        fs.writeFileSync(path.join(saves, 'w1', 'session.lock'), 'LK');
        fs.writeFileSync(path.join(saves, 'w1', 'region', 'r.mca'), 'MCA');
        fs.ensureDirSync(path.join(saves, 'w1', 'datapacks'));
        fs.writeFileSync(path.join(saves, 'w1', 'datapacks', 'dp.zip'), 'DP');

        const r = clone.migrateWorld({ savesDir: saves, worldDir: world, saveName: 'w1' });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.migrated, true);
        assert.strictEqual(r.sessionLockRemoved, true);
        assert.ok(fs.existsSync(path.join(world, 'level.dat')));
        assert.ok(!fs.existsSync(path.join(world, 'session.lock')), 'session.lock 必须删掉');
        assert.ok(fs.existsSync(path.join(world, 'datapacks', 'dp.zip')), 'datapacks 必须保留');
    });

    await t('saveName 为空 → 不迁移', () => {
        const root = makeTmp('save-none');
        const world = path.join(root, 'world');
        const r = clone.migrateWorld({ savesDir: path.join(root, 'saves'), worldDir: world, saveName: '' });
        assert.strictEqual(r.migrated, false);
        assert.ok(!fs.existsSync(world));
    });

    await t('world/ 已有内容 → 挪成 .bak 而不是覆盖', () => {
        const root = makeTmp('save-conflict');
        const saves = path.join(root, 'saves');
        const world = path.join(root, 'world');
        fs.ensureDirSync(path.join(saves, 'w1'));
        fs.writeFileSync(path.join(saves, 'w1', 'level.dat'), 'NEW');
        fs.ensureDirSync(world);
        fs.writeFileSync(path.join(world, 'level.dat'), 'OLD');

        const r = clone.migrateWorld({ savesDir: saves, worldDir: world, saveName: 'w1' });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'NEW');
        const baks = fs.readdirSync(root).filter(f => f.startsWith('world.pre-clone-'));
        assert.strictEqual(baks.length, 1, '旧 world 应被留档');
    });

    await t('存档不存在 → ok=false', () => {
        const root = makeTmp('save-missing');
        const r = clone.migrateWorld({ savesDir: root, worldDir: path.join(root, 'w'), saveName: 'nope' });
        assert.strictEqual(r.ok, false);
    });

    // ---------- 模组清洗 ----------
    console.log('\n— 模组清洗（第 5 步）—');

    await t('Fabric environment=client → 禁用', () => {
        const root = makeTmp('clean-fabric');
        const mods = path.join(root, 'mods');
        fabricMod(path.join(mods, 'sodium.jar'), { id: 'sodium', environment: 'client' });
        const r = clone.cleanMods({ modsDir: mods, disabledDir: path.join(root, 'mods-disabled') });
        assert.strictEqual(r.disabled.length, 1);
        assert.strictEqual(r.disabled[0].modId, 'sodium');
        assert.ok(r.disabled[0].reason.includes('元数据'));
    });

    await t('Forge 内置名单命中 → 禁用', () => {
        const root = makeTmp('clean-forge');
        const mods = path.join(root, 'mods');
        forgeMod(path.join(mods, 'rubidium.jar'), 'rubidium');
        const r = clone.cleanMods({ modsDir: mods, disabledDir: path.join(root, 'mods-disabled') });
        assert.strictEqual(r.disabled.length, 1);
        assert.ok(r.disabled[0].reason.includes('内置黑名单'));
    });

    await t('旧 Forge mcmod.info clientSideOnly → 禁用', () => {
        const root = makeTmp('clean-mcmod');
        const mods = path.join(root, 'mods');
        makeJar(path.join(mods, 'oldmod.jar'), {
            'mcmod.info': JSON.stringify([{ modid: 'oldmod', clientSideOnly: true }])
        });
        const r = clone.cleanMods({ modsDir: mods, disabledDir: path.join(root, 'mods-disabled') });
        assert.strictEqual(r.disabled.length, 1);
        assert.ok(r.disabled[0].reason.includes('元数据'));
    });

    await t('force_keep_mods 优先级最高，压过元数据铁证', () => {
        const root = makeTmp('clean-keep');
        const mods = path.join(root, 'mods');
        fabricMod(path.join(mods, 'sodium.jar'), { id: 'sodium', environment: 'client' });
        const r = clone.cleanMods({
            modsDir: mods,
            disabledDir: path.join(root, 'mods-disabled'),
            forceKeepMods: ['sodium']
        });
        assert.strictEqual(r.disabled.length, 0, '强制保留的不能被禁');
        assert.ok(r.kept.some(k => k.modId === 'sodium' && k.reason.includes('force_keep')));
        assert.ok(fs.existsSync(path.join(mods, 'sodium.jar')));
    });

    await t('extra_client_mods 追加名单生效', () => {
        const root = makeTmp('clean-extra');
        const mods = path.join(root, 'mods');
        forgeMod(path.join(mods, 'myclientmod.jar'), 'myclientmod');
        const r = clone.cleanMods({
            modsDir: mods,
            disabledDir: path.join(root, 'mods-disabled'),
            extraClientMods: ['myclientmod']
        });
        assert.strictEqual(r.disabled.length, 1);
        assert.ok(r.disabled[0].reason.includes('用户扩展'));
    });

    await t('普通服务端模组不动', () => {
        const root = makeTmp('clean-plain');
        const mods = path.join(root, 'mods');
        forgeMod(path.join(mods, 'jei.jar'), 'jei');
        forgeMod(path.join(mods, 'create.jar'), 'create');
        const r = clone.cleanMods({ modsDir: mods, disabledDir: path.join(root, 'mods-disabled') });
        assert.strictEqual(r.disabled.length, 0);
        assert.strictEqual(r.kept.length, 2);
    });

    await t('无元数据的 jar 不猜，直接放过', () => {
        const root = makeTmp('clean-nometa');
        const mods = path.join(root, 'mods');
        makeJar(path.join(mods, 'x.jar'), { 'plugin.yml': 'name: x' });
        const r = clone.cleanMods({ modsDir: mods, disabledDir: path.join(root, 'mods-disabled') });
        assert.strictEqual(r.disabled.length, 0);
        assert.strictEqual(r.kept.length, 1);
    });

    await t('禁用是移动不是删除：字节一致', () => {
        const root = makeTmp('clean-bytes');
        const mods = path.join(root, 'mods');
        const jar = fabricMod(path.join(mods, 'iris.jar'), { id: 'iris' });
        const before = fs.readFileSync(jar);
        clone.cleanMods({ modsDir: mods, disabledDir: path.join(root, 'mods-disabled') });
        assert.ok(!fs.existsSync(jar));
        const moved = path.join(root, 'mods-disabled', 'iris.jar');
        assert.ok(fs.existsSync(moved));
        assert.ok(Buffer.compare(before, fs.readFileSync(moved)) === 0);
    });

    await t('重名不覆盖', () => {
        const root = makeTmp('clean-collide');
        const mods = path.join(root, 'mods');
        const dis = path.join(root, 'mods-disabled');
        fs.ensureDirSync(dis);
        fs.writeFileSync(path.join(dis, 'iris.jar'), 'OLD');
        fabricMod(path.join(mods, 'iris.jar'), { id: 'iris' });
        clone.cleanMods({ modsDir: mods, disabledDir: dis });
        assert.strictEqual(fs.readFileSync(path.join(dis, 'iris.jar'), 'utf8'), 'OLD');
        assert.strictEqual(fs.readdirSync(dis).length, 2);
    });

    await t('mods 目录不存在 → 空结果', () => {
        const r = clone.cleanMods({ modsDir: '/nonexistent/mods' });
        assert.strictEqual(r.scanned, 0);
        assert.strictEqual(r.disabled.length, 0);
    });

    // ---------- 平台兜底 ----------
    console.log('\n— 平台兜底（第 6 步）—');

    await t('生成 server.properties / eula.txt', () => {
        const root = makeTmp('plat-gen');
        const sm = { _generateDefaultProperties: () => 'server-port=25565\n' };
        const r = clone.fillPlatformDefaults({ schemePath: root, mcVersion: '1.20.1', type: 'forge', schemeManager: sm });
        assert.strictEqual(r.properties, true);
        assert.strictEqual(r.eula, true);
        const props = fs.readFileSync(path.join(root, 'server.properties'), 'utf8');
        assert.ok(props.includes('level-name=world'));
        assert.ok(fs.readFileSync(path.join(root, 'eula.txt'), 'utf8').includes('eula=true'));
    });

    await t('已存在的文件不覆盖', () => {
        const root = makeTmp('plat-exist');
        fs.writeFileSync(path.join(root, 'server.properties'), 'CUSTOM=1\n');
        fs.writeFileSync(path.join(root, 'eula.txt'), 'eula=false\n');
        const sm = { _generateDefaultProperties: () => 'DEFAULT\n' };
        const r = clone.fillPlatformDefaults({ schemePath: root, mcVersion: '1.20.1', type: 'forge', schemeManager: sm });
        assert.strictEqual(r.properties, false);
        assert.strictEqual(r.eula, false);
        assert.strictEqual(fs.readFileSync(path.join(root, 'server.properties'), 'utf8'), 'CUSTOM=1\n');
        assert.strictEqual(fs.readFileSync(path.join(root, 'eula.txt'), 'utf8'), 'eula=false\n');
    });

    await t('插件端才建 plugins/', () => {
        const rootA = makeTmp('plat-paper');
        clone.fillPlatformDefaults({
            schemePath: rootA, mcVersion: '1.20.1', type: 'paper',
            schemeManager: { _generateDefaultProperties: () => 'x\n' }
        });
        assert.ok(fs.existsSync(path.join(rootA, 'plugins')));

        const rootB = makeTmp('plat-forge');
        clone.fillPlatformDefaults({
            schemePath: rootB, mcVersion: '1.20.1', type: 'forge',
            schemeManager: { _generateDefaultProperties: () => 'x\n' }
        });
        assert.ok(!fs.existsSync(path.join(rootB, 'plugins')));
    });

    // ---------- 报告 ----------
    console.log('\n— 报告（第 8 步）—');

    await t('报告列出被禁用模组的名字与原因（不只报数量）', () => {
        const text = clone.buildReport({
            name: 'srv',
            instanceDir: '/x/.minecraft',
            mcVersion: '1.20.1',
            type: 'forge',
            loader: 'forge',
            loaderVersion: '47.2.0',
            core: { file: 'forge-server.jar' },
            modStats: {
                scanned: 5, copied: 2,
                disabled: [
                    { file: 'sodium.jar', modId: 'sodium', reason: '元数据标记 client' },
                    { file: 'iris.jar', modId: 'iris', reason: '内置黑名单' },
                    { file: 'optifine.jar', modId: 'optifine', reason: '内置黑名单' }
                ],
                forceKept: []
            },
            world: { migrated: true, saveName: '生存世界', sessionLockRemoved: true },
            configCopied: true,
            copyStats: { skipped: [], failed: [] },
            poolErrors: [],
            state: 'full'
        });
        assert.ok(text.includes('- sodium（元数据标记 client）'), '应列出 modid 与原因');
        assert.ok(text.includes('- iris（内置黑名单）'));
        assert.ok(text.includes('- optifine（内置黑名单）'));
        assert.ok(text.includes('生存世界'));
        assert.ok(text.includes('scheme switch srv'));
    });

    await t('报告含单机玩家数据提示', () => {
        const text = clone.buildReport({
            name: 's', instanceDir: '/x', mcVersion: '1.20.1', type: 'forge',
            modStats: { scanned: 0, disabled: [], forceKept: [] },
            copyStats: { skipped: [], failed: [] },
            poolErrors: [], state: 'full'
        });
        assert.ok(text.includes('单机玩家数据不会自动转换'));
    });

    await t('没有禁用模组时不出现禁用小节', () => {
        const text = clone.buildReport({
            name: 's', instanceDir: '/x', mcVersion: '1.20.1', type: 'forge',
            modStats: { scanned: 3, disabled: [], forceKept: [] },
            copyStats: { skipped: [], failed: [] },
            poolErrors: [], state: 'full'
        });
        assert.ok(!text.includes('已禁用'));
    });

    // ---------- 整体流程 ----------
    console.log('\n— 整体流程（createSkeleton + cloneClient 打桩）—');

    await t('createSkeleton 生成 partial 状态与 source 字段', () => {
        const root = makeTmp('skel-gen');
        const sm = {
            schemesDir: path.join(root, 'scheme'),
            _schemeExists: () => false,
            _getSchemePath: (n) => path.join(root, 'scheme', n),
            _getRequiredJava: () => '17',
            _saveSchemeMeta: (n, m) => {
                fs.ensureDirSync(path.join(root, 'scheme', n));
                fs.writeFileSync(path.join(root, 'scheme', n, 'scheme.yaml'), yaml.dump(m), 'utf8');
            }
        };
        const r = clone.createSkeleton({
            name: 's1', mcVersion: '1.20.1', loader: 'forge', type: 'forge',
            sourcePath: '/src/inst', schemeManager: sm
        });
        assert.strictEqual(r.ok, true);
        const meta = yaml.load(fs.readFileSync(path.join(root, 'scheme', 's1', 'scheme.yaml'), 'utf8'));
        assert.strictEqual(meta.state, 'partial');
        assert.strictEqual(meta.source, 'clone-client');
        assert.strictEqual(meta.source_path, '/src/inst');
        assert.strictEqual(meta.version, '1.20.1');
        assert.strictEqual(meta.loader, 'forge');
        assert.ok(meta.created_at);
    });

    await t('createSkeleton 建齐 mods/config/logs 子目录', () => {
        const root = makeTmp('skel-dirs');
        const sm = {
            _schemeExists: () => false,
            _getSchemePath: (n) => path.join(root, n),
            _getRequiredJava: () => '17',
            _saveSchemeMeta: (n, m) => fs.writeFileSync(path.join(root, n, 'scheme.yaml'), yaml.dump(m), 'utf8')
        };
        clone.createSkeleton({ name: 's2', mcVersion: '1.20.1', loader: 'fabric', type: 'fabric', schemeManager: sm });
        for (const d of ['mods', 'config', 'logs']) {
            assert.ok(fs.existsSync(path.join(root, 's2', d)), `缺少 ${d}/`);
        }
    });

    await t('重名方案被拒绝', () => {
        const root = makeTmp('skel-dup');
        const sm = {
            _schemeExists: () => true,
            _getSchemePath: (n) => path.join(root, n),
            _getRequiredJava: () => '17',
            _saveSchemeMeta: () => {}
        };
        const r = clone.createSkeleton({ name: 'dup', mcVersion: '1.20.1', loader: 'forge', type: 'forge', schemeManager: sm });
        assert.strictEqual(r.ok, false);
        assert.ok(r.reason.includes('已存在'));
    });

    await t('cloneClient 识别失败时不创建任何目录', async () => {
        const root = makeTmp('e2e-nofail');
        const inst = path.join(root, 'versions', 'x');
        fs.ensureDirSync(inst); // 空实例，识别不出来
        const before = fs.readdirSync(root);
        const r = await clone.cloneClient({
            clientPath: inst, name: 'shouldnotexist', io: clone.makeSilentIO(), skipCore: true
        });
        assert.strictEqual(r.ok, false);
        assert.deepStrictEqual(fs.readdirSync(root).sort(), before.sort(), '不该创建任何东西');
    });

    await t('cloneClient 核心失败 → 回滚删除方案目录', async () => {
        const root = makeTmp('e2e-rollback');
        const { inst } = makeInstance(root);
        const schemeRoot = path.join(root, 'scheme');

        // 打桩 SchemeManager：把 schemesDir 指到临时区
        const SchemeManagerOrig = require('../src/scheme_manager');
        const sm = new SchemeManagerOrig();
        sm.schemesDir = schemeRoot;
        sm.poolDir = path.join(root, 'pool');
        sm.poolIndexPath = path.join(root, 'pool', 'index.yaml');
        sm.poolIndex = { resources: {}, ref_count: {} };
        if (!fs.existsSync(schemeRoot)) fs.ensureDirSync(schemeRoot);

        // 让 installer 必定失败
        const InstallerOrig = require('../src/installer');
        const origInstall = InstallerOrig.prototype.install;
        InstallerOrig.prototype.install = async () => { throw new Error('模拟核心装配失败'); };
        try {
            const r = await clone.cloneClient({
                clientPath: inst,
                name: 'rollbacktest',
                saveName: '',
                io: clone.makeSilentIO(),
                schemeManager: sm
            });
            assert.strictEqual(r.ok, false);
            assert.ok(r.reason.includes('核心装配失败'));
            assert.ok(!fs.existsSync(path.join(schemeRoot, 'rollbacktest')), '方案目录必须被删除');
        } finally {
            InstallerOrig.prototype.install = origInstall;
        }
    });

    await t('cloneClient 全流程成功（打桩核心）', async () => {
        const root = makeTmp('e2e-ok');
        const { inst } = makeInstance(root, {
            mods: [
                { file: 'jei.jar', modId: 'jei' },
                { file: 'create.jar', modId: 'create' },
                { file: 'rubidium.jar', modId: 'rubidium' },
                { file: 'oculus.jar', modId: 'oculus' },
                { file: 'oldclient.jar', kind: 'mcmod', meta: [{ modid: 'oldclient', clientSideOnly: true }] }
            ],
            saves: ['生存世界', '创造世界']
        });
        const schemeRoot = path.join(root, 'scheme');

        const SchemeManagerOrig = require('../src/scheme_manager');
        const sm = new SchemeManagerOrig();
        sm.schemesDir = schemeRoot;
        sm.poolDir = path.join(root, 'pool');
        sm.poolIndexPath = path.join(root, 'pool', 'index.yaml');
        sm.poolIndex = { resources: {}, ref_count: {} };
        fs.ensureDirSync(schemeRoot);

        const InstallerOrig = require('../src/installer');
        const origInstall = InstallerOrig.prototype.install;
        InstallerOrig.prototype.install = async (type, ver, build, dir) => {
            const p = path.join(dir, `forge-${ver}-${build}-server.jar`);
            fs.writeFileSync(p, 'STUB', 'utf8');
            return p;
        };
        const smMod = require.cache[require.resolve('../src/scheme_manager')];
        const OrigExportsRef2 = smMod.exports;

        try {
            const r = await clone.cloneClient({
                clientPath: inst,
                name: 'e2etest',
                saveName: '生存世界',
                forceKeepMods: ['jei'],
                io: clone.makeSilentIO(),
                schemeManager: sm
            });

            assert.strictEqual(r.ok, true, r.reason || '');

            const sp = path.join(schemeRoot, 'e2etest');
            // 骨架 + scheme.yaml
            assert.ok(fs.existsSync(path.join(sp, 'scheme.yaml')));
            const meta = yaml.load(fs.readFileSync(path.join(sp, 'scheme.yaml'), 'utf8'));
            assert.strictEqual(meta.state, 'full');
            assert.strictEqual(meta.source, 'clone-client');
            assert.strictEqual(meta.version, '1.20.1');
            assert.strictEqual(meta.loader, 'forge');

            // 白名单：不该有 resourcepacks / options.txt
            assert.ok(!fs.existsSync(path.join(sp, 'resourcepacks')));
            assert.ok(!fs.existsSync(path.join(sp, 'options.txt')));
            // 该有的
            assert.ok(fs.existsSync(path.join(sp, 'config', 'test.toml')));
            assert.ok(fs.existsSync(path.join(sp, 'kubejs', 'server_scripts', 'a.js')));

            // 核心
            assert.ok(fs.existsSync(path.join(sp, 'forge-1.20.1-47.2.0-server.jar')));
            // V3.6.2：客户端版本 jar 不再复制（服务端用不到，且常因权限 EACCES 刷警告）
            assert.ok(!fs.existsSync(path.join(sp, '1.20.1-forge-47.2.0.jar')),
                '客户端版本 jar 不应被复制进方案');
            assert.ok(!fs.existsSync(path.join(sp, '1.20.1-forge-47.2.0.jar.client-jar.bak')),
                '不再产生 .client-jar.bak（客户端 jar 根本不复制）');

            // 存档
            assert.ok(fs.existsSync(path.join(sp, 'world', 'level.dat')));
            assert.ok(!fs.existsSync(path.join(sp, 'world', 'session.lock')));

            // 模组清洗：rubidium / oculus / oldclient 被禁，jei（force_keep）与 create 留下
            assert.ok(fs.existsSync(path.join(sp, 'mods', 'jei.jar')), 'force_keep 的应留下');
            assert.ok(fs.existsSync(path.join(sp, 'mods', 'create.jar')));
            assert.ok(!fs.existsSync(path.join(sp, 'mods', 'rubidium.jar')), 'rubidium 应被禁');
            assert.ok(fs.existsSync(path.join(sp, 'mods-disabled', 'rubidium.jar')));
            assert.ok(fs.existsSync(path.join(sp, 'mods-disabled', 'oculus.jar')));
            assert.ok(fs.existsSync(path.join(sp, 'mods-disabled', 'oldclient.jar')));

            // 平台文件
            assert.ok(fs.existsSync(path.join(sp, 'server.properties')));
            assert.ok(fs.existsSync(path.join(sp, 'eula.txt')));

            // 入池
            assert.ok(meta.resources.core.in_pool, '核心应入池');
            assert.ok(meta.resources.mods.length >= 2, '留下的模组应入池');

            // clone_report
            assert.ok(meta.clone_report);
            assert.strictEqual(meta.clone_report.world, '生存世界');
            assert.strictEqual(meta.clone_report.mods_disabled, 3);
            assert.ok(meta.clone_report.disabled_list.some(d => d.modId === 'rubidium'));

            // 报告
            assert.ok(r.report.includes('rubidium'));
            assert.ok(r.report.includes('内置黑名单'));
            assert.ok(r.report.includes('force_keep') || r.report.includes('保留'));

            // 方案能被 load 回来
            assert.strictEqual(sm._schemeExists('e2etest'), true);
        } finally {
            InstallerOrig.prototype.install = origInstall;
            smMod.exports = OrigExportsRef2;
        }
    });

    // ---------- V3.6.2：版本隔离布局（mods/config/saves 在游戏根目录） ----------
    await t('版本隔离：mods / config / saves 从游戏根目录复制，且不碰版本 jar', async () => {
        const root = makeTmp('e2e-isolated');
        const instName = '1.20.1-Forge';
        const inst = path.join(root, 'versions', instName);
        fs.ensureDirSync(inst);
        // 版本目录里只有 json + 客户端 jar
        fs.writeFileSync(path.join(inst, `${instName}.json`), JSON.stringify({
            id: instName,
            inheritsFrom: '1.20.1',
            mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
            arguments: { game: ['--fml.forgeVersion', '47.4.28'] }
        }), 'utf8');
        fs.writeFileSync(path.join(inst, `${instName}.jar`), 'CLIENT JAR', 'utf8');
        // 真正的游戏数据在根目录
        fs.ensureDirSync(path.join(root, 'mods'));
        forgeMod(path.join(root, 'mods', 'jei.jar'), 'jei');
        forgeMod(path.join(root, 'mods', 'create.jar'), 'create');
        fs.ensureDirSync(path.join(root, 'config'));
        fs.writeFileSync(path.join(root, 'config', 'somemod.toml'), '# cfg', 'utf8');
        const saveDir = path.join(root, 'saves', '生存世界');
        fs.ensureDirSync(saveDir);
        fs.writeFileSync(path.join(saveDir, 'level.dat'), 'LEVEL', 'utf8');
        // 启动器垃圾
        fs.writeFileSync(path.join(root, 'launcher_profiles.json'), '{}', 'utf8');

        const schemeRoot = path.join(root, 'scheme');
        const SchemeManagerOrig = require('../src/scheme_manager');
        const sm = new SchemeManagerOrig();
        sm.schemesDir = schemeRoot;
        sm.poolDir = path.join(root, 'pool');
        sm.poolIndexPath = path.join(root, 'pool', 'index.yaml');
        sm.poolIndex = { resources: {}, ref_count: {} };
        fs.ensureDirSync(schemeRoot);

        const InstallerOrig = require('../src/installer');
        const origInstall = InstallerOrig.prototype.install;
        InstallerOrig.prototype.install = async (type, ver, build, dir) => {
            const p = path.join(dir, `forge-${ver}-server.jar`);
            fs.writeFileSync(p, 'STUB', 'utf8');
            return p;
        };
        try {
            // 用户传的是游戏根目录（含 versions/）
            const r = await clone.cloneClient({
                clientPath: root,
                name: 'isolated',
                saveName: '生存世界',
                io: clone.makeSilentIO(),
                schemeManager: sm
            });
            assert.strictEqual(r.ok, true, r.reason || '');
            const sp = path.join(schemeRoot, 'isolated');

            // 模组必须真的进方案（旧实现这里是 0 个）
            assert.ok(fs.existsSync(path.join(sp, 'mods', 'jei.jar')), '根目录 mods 应被复制');
            assert.ok(fs.existsSync(path.join(sp, 'mods', 'create.jar')));
            assert.ok(fs.existsSync(path.join(sp, 'config', 'somemod.toml')), '根目录 config 应被复制');
            assert.ok(fs.existsSync(path.join(sp, 'world', 'level.dat')), '根目录 saves 应被复制');
            // 客户端 jar 不复制
            assert.ok(!fs.existsSync(path.join(sp, `${instName}.jar`)));
            // 启动器垃圾不复制
            assert.ok(!fs.existsSync(path.join(sp, 'launcher_profiles.json')));
            // 入池登记应看到模组
            const m = yaml.load(fs.readFileSync(path.join(sp, 'scheme.yaml'), 'utf8'));
            assert.ok(m.resources.mods.length >= 2, '入池模组数应 >= 2');
        } finally {
            InstallerOrig.prototype.install = origInstall;
        }
    });

    // ---------- 收尾 ----------
    try { if (tmpRoot) fs.removeSync(tmpRoot); } catch (e) {}

    console.log('\n====================');
    if (fail === 0) {
        console.log(`✅ client_clone 全部通过：${pass} 项`);
    } else {
        console.log(`❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
        for (const f of failures) {
            console.log(`\n   ${f.name}`);
            console.log('   ' + String(f.error.stack).split('\n').slice(0, 5).join('\n   '));
        }
    }
    console.log('====================\n');
    process.exit(fail === 0 ? 0 : 1);
}

// 模块级引用，供 finally 恢复
let OrigExportsRef = null;

main().catch(e => {
    console.error('测试运行异常:', e);
    process.exit(1);
});
