#!/usr/bin/env node
/**
 * V3.5.25：客户端专用模组自动隔离测试
 * ----------------------------------------------------------------
 * 待测规则一句话：**服务端装不上的东西，不该留在 mods/ 里等着崩服。**
 *
 * 三件最容易写错、也是本测试重点盯的事：
 *
 *   1. 只移动不删除。
 *      误判的代价必须可逆。任何一条路径都不能把用户的 jar 删了。
 *
 *   2. 宁可漏杀不可错杀。
 *      读不出元数据的 jar（插件、资源包、损坏文件）必须原样留着，
 *      而不是「看不懂就当成客户端模组」。
 *
 *   3. 判定依据要分层。
 *      元数据里 environment=client / 只有 client entrypoints → 铁证，优先；
 *      其次才是 modid 命中名单。两者都没有 → 放过。
 *
 * 全程不联网、不碰真实方案目录：临时目录里现造 zip 当 jar。
 *
 * 运行：node test/client_mod_filter.test.js
 */

const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

const filter = require('../src/client_mod_filter');

let pass = 0, fail = 0;
const failures = [];

function t(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, error: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

async function tAsync(name, fn) {
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

// ==================== 造 jar 的工具 ====================

let tmpRoot = null;

/** 建一个临时目录，测试结束统一清理 */
function makeTmp(tag) {
    if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-cmf-'));
    const dir = path.join(tmpRoot, tag);
    fs.ensureDirSync(dir);
    return dir;
}

/**
 * 造一个 jar（本质是 zip），往里面塞指定文件。
 * @param {string} jarPath
 * @param {object} files { '路径': '内容' }
 */
function makeJar(jarPath, files) {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(files)) {
        zip.addFile(name, Buffer.from(content, 'utf8'));
    }
    fs.ensureDirSync(path.dirname(jarPath));
    zip.writeZip(jarPath);
    return jarPath;
}

/** 造 Fabric 模组 jar */
function makeFabricJar(jarPath, json) {
    return makeJar(jarPath, { 'fabric.mod.json': JSON.stringify(json, null, 2) });
}

/** 造 Forge 模组 jar（mods.toml） */
function makeForgeJar(jarPath, toml) {
    return makeJar(jarPath, { 'META-INF/mods.toml': toml });
}

/** 造一个没有任何元数据的 jar（插件 / 资源包那种） */
function makePlainJar(jarPath) {
    return makeJar(jarPath, { 'plugin.yml': 'name: SomePlugin\nmain: a.b.C\n' });
}

// ==================== 用例 ====================

console.log('\n客户端专用模组自动隔离（client_mod_filter）\n');

console.log('— 内置名单 —');

t('内置名单非空且键全小写', () => {
    const keys = Object.keys(filter.BUILTIN_CLIENT_MODS);
    assert.ok(keys.length >= 50, `名单应有一定规模，实际 ${keys.length}`);
    for (const k of keys) {
        assert.strictEqual(k, k.toLowerCase(), `键 ${k} 不是小写`);
    }
});

t('钠 / 铷 / Iris 这类必收录', () => {
    for (const id of ['sodium', 'rubidium', 'embeddium', 'iris', 'oculus']) {
        assert.ok(filter.isBuiltinClientMod(id), `${id} 应在内置名单里`);
    }
});

t('大小写无关命中', () => {
    assert.ok(filter.isBuiltinClientMod('Sodium'));
    assert.ok(filter.isBuiltinClientMod('  SODIUM  '));
});

t('服务端模组不在名单里（fabric-api / lithium / luckperms）', () => {
    for (const id of ['fabric-api', 'fabric', 'lithium', 'luckperms', 'essential', 'carpet']) {
        if (id === 'essential') continue; // essential 是客户端社交模组，收录是有意的
        assert.strictEqual(filter.isBuiltinClientMod(id), null, `${id} 不该被当成客户端模组`);
    }
});

t('空 / null / undefined 安全返回 null', () => {
    assert.strictEqual(filter.isBuiltinClientMod(''), null);
    assert.strictEqual(filter.isBuiltinClientMod(null), null);
    assert.strictEqual(filter.isBuiltinClientMod(undefined), null);
});

console.log('\n— 名单合成（内置 + 用户覆盖）—');

t('默认 = 内置全量', () => {
    const { map } = filter.buildClientModSet();
    assert.strictEqual(map.size, Object.keys(filter.BUILTIN_CLIENT_MODS).length);
});

t('extra 追加自定义 modid', () => {
    const { map } = filter.buildClientModSet({ extra: ['my-client-mod'] });
    assert.ok(map.has('my-client-mod'));
    assert.strictEqual(map.get('my-client-mod'), '用户自定义的客户端专用模组');
});

t('extra 支持 `modid: 说明` 写法', () => {
    const { map } = filter.buildClientModSet({ extra: ['my-mod: 我自己的客户端模组'] });
    assert.strictEqual(map.get('my-mod'), '我自己的客户端模组');
});

t('extra 里 `-xxx` 从内置名单剔除', () => {
    const { map, removed } = filter.buildClientModSet({ extra: ['-jade'] });
    assert.ok(!map.has('jade'), 'jade 应被剔除');
    assert.deepStrictEqual(removed, ['jade']);
});

t('`!xxx` 与 `-xxx` 等价', () => {
    const { map } = filter.buildClientModSet({ extra: ['!jade'] });
    assert.ok(!map.has('jade'));
});

t('剔除不存在的键不报错', () => {
    const { map, removed } = filter.buildClientModSet({ extra: ['-nonexistent'] });
    assert.ok(!map.has('nonexistent'));
    assert.deepStrictEqual(removed, []);
});

t('disableBuiltin 时只剩 extra', () => {
    const { map } = filter.buildClientModSet({ disableBuiltin: true, extra: ['only-this'] });
    assert.strictEqual(map.size, 1);
    assert.ok(map.has('only-this'));
});

t('extra 大小写归一', () => {
    const { map } = filter.buildClientModSet({ extra: ['SODIUM-EXTRA'] });
    assert.ok(map.has('sodium-extra'));
});

t('extra 为空 / 非数组时安全', () => {
    assert.doesNotThrow(() => filter.buildClientModSet({ extra: null }));
    assert.doesNotThrow(() => filter.buildClientModSet({ extra: 'not-an-array' }));
});

console.log('\n— mods.toml 解析 —');

t('解析多个 [[mods]] 段', () => {
    const toml = `
modLoader="javafml"
loaderVersion="[47,)"

[[mods]]
modId="firstmod"
displayName="First Mod"

[[mods]]
modId="secondmod"
displayName="Second Mod"
`;
    const r = filter.parseModsToml(toml);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].modId, 'firstmod');
    assert.strictEqual(r[0].displayName, 'First Mod');
    assert.strictEqual(r[1].modId, 'secondmod');
});

t('段外的 modId 不被误当成模组', () => {
    const toml = `
modLoader="javafml"
modId="should-not-count"

[[mods]]
modId="realmod"
`;
    const r = filter.parseModsToml(toml);
    assert.deepStrictEqual(r.map(x => x.modId), ['realmod']);
});

t('单引号也能解析', () => {
    const r = filter.parseModsToml(`[[mods]]\nmodId='sqmod'\n`);
    assert.strictEqual(r[0].modId, 'sqmod');
});

t('空 / null 返回空数组不抛', () => {
    assert.deepStrictEqual(filter.parseModsToml(''), []);
    assert.deepStrictEqual(filter.parseModsToml(null), []);
});

console.log('\n— jar 元数据读取 —');

t('Fabric：读出 id 与 name', () => {
    const dir = makeTmp('meta-fabric');
    const jar = makeFabricJar(path.join(dir, 'a.jar'), { id: 'sodium', name: 'Sodium', version: '0.5.8' });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.ok, true);
    assert.strictEqual(m.loader, 'fabric');
    assert.strictEqual(m.mods[0].modId, 'sodium');
    assert.strictEqual(m.mods[0].displayName, 'Sodium');
});

t('Fabric：environment=client 判定为纯客户端', () => {
    const dir = makeTmp('meta-fabric-env');
    const jar = makeFabricJar(path.join(dir, 'b.jar'), { id: 'somehud', environment: 'client' });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.clientOnly, true);
});

t('Fabric：只有 client entrypoints 也判定为纯客户端', () => {
    const dir = makeTmp('meta-fabric-ep');
    const jar = makeFabricJar(path.join(dir, 'c.jar'), {
        id: 'hudmod',
        entrypoints: { client: ['com.example.Hud'] }
    });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.clientOnly, true);
});

t('Fabric：main entrypoint 存在则不算纯客户端', () => {
    const dir = makeTmp('meta-fabric-main');
    const jar = makeFabricJar(path.join(dir, 'd.jar'), {
        id: 'commonmod',
        entrypoints: { main: ['com.example.Main'], client: ['com.example.Client'] }
    });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.clientOnly, false);
});

t('Fabric：server entrypoint 存在则不算纯客户端', () => {
    const dir = makeTmp('meta-fabric-srv');
    const jar = makeFabricJar(path.join(dir, 'e.jar'), {
        id: 'srvmod',
        entrypoints: { client: ['a.B'], server: ['a.S'] }
    });
    assert.strictEqual(filter.readModMeta(jar).clientOnly, false);
});

t('Quilt：quilt.mod.json 的嵌套结构', () => {
    const dir = makeTmp('meta-quilt');
    const jar = makeJar(path.join(dir, 'f.jar'), {
        'quilt.mod.json': JSON.stringify({ quilt_loader: { id: 'qmod', name: 'Q Mod' } })
    });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.loader, 'quilt');
    assert.strictEqual(m.mods[0].modId, 'qmod');
});

t('Forge：META-INF/mods.toml', () => {
    const dir = makeTmp('meta-forge');
    const jar = makeForgeJar(path.join(dir, 'g.jar'), '[[mods]]\nmodId="rubidium"\ndisplayName="Rubidium"\n');
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.ok, true);
    assert.strictEqual(m.loader, 'forge');
    assert.strictEqual(m.mods[0].modId, 'rubidium');
});

t('NeoForge：META-INF/neoforge.mods.toml', () => {
    const dir = makeTmp('meta-neo');
    const jar = makeJar(path.join(dir, 'h.jar'), {
        'META-INF/neoforge.mods.toml': '[[mods]]\nmodId="neomod"\n'
    });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.loader, 'neoforge');
    assert.strictEqual(m.mods[0].modId, 'neomod');
});

t('老 Forge：mcmod.info 数组', () => {
    const dir = makeTmp('meta-mcmod');
    const jar = makeJar(path.join(dir, 'i.jar'), {
        'mcmod.info': JSON.stringify([{ modid: 'oldmod', name: 'Old' }])
    });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.ok, true);
    assert.strictEqual(m.mods[0].modId, 'oldmod');
});

t('条目路径大小写不敏感', () => {
    const dir = makeTmp('meta-case');
    const jar = makeJar(path.join(dir, 'j.jar'), {
        'FABRIC.MOD.JSON': JSON.stringify({ id: 'casemod' })
    });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.ok, true);
    assert.strictEqual(m.mods[0].modId, 'casemod');
});

t('没有元数据的 jar → ok=false，不抛', () => {
    const dir = makeTmp('meta-plain');
    const jar = makePlainJar(path.join(dir, 'k.jar'));
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.ok, false);
    assert.ok(m.reason.includes('没有找到可识别'));
});

t('损坏的 jar（不是 zip）→ ok=false，不抛', () => {
    const dir = makeTmp('meta-broken');
    const jar = path.join(dir, 'l.jar');
    fs.writeFileSync(jar, 'this is definitely not a zip file');
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.ok, false);
    assert.ok(m.reason.includes('无法作为 zip 打开'));
});

t('坏掉的 fabric.mod.json → ok=false，不抛', () => {
    const dir = makeTmp('meta-badjson');
    const jar = makeJar(path.join(dir, 'm.jar'), { 'fabric.mod.json': '{not valid json' });
    const m = filter.readModMeta(jar);
    assert.strictEqual(m.ok, false);
});

t('文件不存在 → ok=false，不抛', () => {
    const m = filter.readModMeta('/nonexistent/path/x.jar');
    assert.strictEqual(m.ok, false);
});

console.log('\n— 判定（judgeJar）—');

t('modid 命中名单 → quarantine', () => {
    const dir = makeTmp('judge-hit');
    const jar = makeFabricJar(path.join(dir, 'a.jar'), { id: 'sodium' });
    const { map } = filter.buildClientModSet();
    const v = filter.judgeJar(jar, map);
    assert.strictEqual(v.action, 'quarantine');
    assert.strictEqual(v.by, 'modid');
    assert.strictEqual(v.modId, 'sodium');
});

t('元数据声明纯客户端 → quarantine（by=meta）', () => {
    const dir = makeTmp('judge-meta');
    const jar = makeFabricJar(path.join(dir, 'b.jar'), {
        id: 'unknownclientmod',
        entrypoints: { client: ['a.B'] }
    });
    const { map } = filter.buildClientModSet();
    const v = filter.judgeJar(jar, map);
    assert.strictEqual(v.action, 'quarantine');
    assert.strictEqual(v.by, 'meta');
});

t('元数据铁证优先于名单剔除', () => {
    // 用户把 jade 从名单剔除了，但另有一个真正的纯客户端模组
    const dir = makeTmp('judge-priority');
    const jar = makeFabricJar(path.join(dir, 'c.jar'), {
        id: 'someshader',
        environment: 'client'
    });
    const { map } = filter.buildClientModSet({ extra: ['-someshader'] });
    const v = filter.judgeJar(jar, map);
    assert.strictEqual(v.action, 'quarantine');
    assert.strictEqual(v.by, 'meta', '元数据判定不应被名单剔除影响');
});

t('普通服务端模组 → skip', () => {
    const dir = makeTmp('judge-plain');
    const jar = makeFabricJar(path.join(dir, 'd.jar'), {
        id: 'lithium',
        entrypoints: { main: ['a.B'] }
    });
    const { map } = filter.buildClientModSet();
    const v = filter.judgeJar(jar, map);
    assert.strictEqual(v.action, 'skip');
    assert.strictEqual(v.modId, 'lithium');
});

t('无元数据 jar → skip（宁可漏杀）', () => {
    const dir = makeTmp('judge-nometa');
    const jar = makePlainJar(path.join(dir, 'e.jar'));
    const { map } = filter.buildClientModSet();
    const v = filter.judgeJar(jar, map);
    assert.strictEqual(v.action, 'skip');
});

t('Forge 模组只有 modId 命中才动（不凭 clientSideOnly 猜）', () => {
    const dir = makeTmp('judge-forge');
    const jar = makeForgeJar(path.join(dir, 'f.jar'), '[[mods]]\nmodId="rubidium"\ndisplayName="Rubidium"\n');
    const { map } = filter.buildClientModSet();
    assert.strictEqual(filter.judgeJar(jar, map).action, 'quarantine');
});

console.log('\n— 加载器判定 —');

t('原版 / 纯插件端不处理 mods/', () => {
    for (const l of ['vanilla', 'paper', 'purpur', 'spigot', 'bukkit', 'leaves', 'PAPER']) {
        assert.strictEqual(filter.loaderSupportsMods(l), false, `${l} 不该处理`);
    }
});

t('模组加载器需要处理', () => {
    for (const l of ['forge', 'fabric', 'neoforge', 'quilt', 'mohist', 'catserver']) {
        assert.strictEqual(filter.loaderSupportsMods(l), true, `${l} 应处理`);
    }
});

t('未知 loader 不拦截（放行）', () => {
    assert.strictEqual(filter.loaderSupportsMods(''), true);
    assert.strictEqual(filter.loaderSupportsMods(null), true);
    assert.strictEqual(filter.loaderSupportsMods('someweirdserver'), true);
});

console.log('\n— 扫描与移动（scanAndQuarantine）—');

t('mods 目录不存在 → 静默返回空结果', () => {
    const dir = makeTmp('scan-nodir');
    const r = filter.scanAndQuarantine({
        modsDir: path.join(dir, 'mods'),
        clientSet: filter.buildClientModSet().map
    });
    assert.deepStrictEqual({ scanned: r.scanned, moved: r.movedCount }, { scanned: 0, moved: 0 });
    assert.deepStrictEqual(r.errors, []);
});

t('空 mods 目录 → 零扫描零移动', () => {
    const dir = makeTmp('scan-empty');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    const r = filter.scanAndQuarantine({ modsDir, clientSet: filter.buildClientModSet().map });
    assert.strictEqual(r.scanned, 0);
    assert.strictEqual(r.movedCount, 0);
});

t('混合目录：只挪客户端模组，其它原样留着', () => {
    const dir = makeTmp('scan-mixed');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    makeFabricJar(path.join(modsDir, 'sodium-0.5.8.jar'), { id: 'sodium' });
    makeFabricJar(path.join(modsDir, 'iris-1.6.jar'), { id: 'iris' });
    makeFabricJar(path.join(modsDir, 'lithium-0.11.jar'), { id: 'lithium', entrypoints: { main: ['a.B'] } });
    makeFabricJar(path.join(modsDir, 'fabric-api.jar'), { id: 'fabric-api', entrypoints: { main: ['a.B'] } });
    makePlainJar(path.join(modsDir, 'some-plugin.jar'));

    const r = filter.scanAndQuarantine({ modsDir, clientSet: filter.buildClientModSet().map });

    assert.strictEqual(r.scanned, 5);
    assert.strictEqual(r.movedCount, 2, `应只挪 2 个，实际 ${r.movedCount}`);
    assert.deepStrictEqual(r.quarantined.map(q => q.file).sort(), ['iris-1.6.jar', 'sodium-0.5.8.jar']);

    // mods/ 里剩下的必须是服务端该有的
    const left = fs.readdirSync(modsDir).sort();
    assert.deepStrictEqual(left, ['fabric-api.jar', 'lithium-0.11.jar', 'some-plugin.jar']);

    // 隔离目录里两个都在
    const qDir = path.join(dir, filter.QUARANTINE_DIRNAME);
    assert.deepStrictEqual(fs.readdirSync(qDir).sort(), ['iris-1.6.jar', 'sodium-0.5.8.jar']);
});

t('只移动不删除：字节完全一致', () => {
    const dir = makeTmp('scan-bytes');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    const jar = makeFabricJar(path.join(modsDir, 'sodium.jar'), { id: 'sodium', name: 'Sodium' });
    const before = fs.readFileSync(jar);

    filter.scanAndQuarantine({ modsDir, clientSet: filter.buildClientModSet().map });

    const moved = path.join(dir, filter.QUARANTINE_DIRNAME, 'sodium.jar');
    assert.ok(fs.existsSync(moved), '隔离目录里应有该文件');
    assert.ok(!fs.existsSync(jar), 'mods/ 里应已移走');
    assert.ok(Buffer.compare(before, fs.readFileSync(moved)) === 0, '内容必须逐字节相同');
});

t('非 jar 文件不动（zip / disabled / txt）', () => {
    const dir = makeTmp('scan-nonext');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    makeFabricJar(path.join(modsDir, 'sodium.zip'), { id: 'sodium' });
    makeFabricJar(path.join(modsDir, 'sodium.jar.disabled'), { id: 'sodium' });
    fs.writeFileSync(path.join(modsDir, 'readme.txt'), 'hello');

    const r = filter.scanAndQuarantine({ modsDir, clientSet: filter.buildClientModSet().map });
    assert.strictEqual(r.scanned, 0);
    assert.strictEqual(r.movedCount, 0);
    assert.strictEqual(fs.readdirSync(modsDir).length, 3);
});

t('目标已存在时不覆盖，改名为带时间戳', () => {
    const dir = makeTmp('scan-collide');
    const modsDir = path.join(dir, 'mods');
    const qDir = path.join(dir, filter.QUARANTINE_DIRNAME);
    fs.ensureDirSync(modsDir);
    fs.ensureDirSync(qDir);
    // 隔离目录里先放一个同名文件（模拟用户之前手动挪过）
    fs.writeFileSync(path.join(qDir, 'sodium.jar'), 'OLD CONTENT');
    makeFabricJar(path.join(modsDir, 'sodium.jar'), { id: 'sodium' });

    const r = filter.scanAndQuarantine({ modsDir, quarantineDir: qDir, clientSet: filter.buildClientModSet().map });

    assert.strictEqual(r.movedCount, 1);
    assert.strictEqual(fs.readFileSync(path.join(qDir, 'sodium.jar'), 'utf8'), 'OLD CONTENT', '旧文件不能被覆盖');
    const files = fs.readdirSync(qDir);
    assert.strictEqual(files.length, 2);
    const newFile = files.find(f => f !== 'sodium.jar');
    assert.ok(/^sodium\.\d+\.jar$/.test(newFile), `新文件名应带时间戳，实际 ${newFile}`);
});

t('dryRun 只报告不动手', () => {
    const dir = makeTmp('scan-dry');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    makeFabricJar(path.join(modsDir, 'sodium.jar'), { id: 'sodium' });

    const r = filter.scanAndQuarantine({ modsDir, clientSet: filter.buildClientModSet().map, dryRun: true });

    assert.strictEqual(r.movedCount, 1, 'dryRun 也应报出将要移动的数量');
    assert.ok(fs.existsSync(path.join(modsDir, 'sodium.jar')), 'dryRun 下文件必须原地不动');
    assert.ok(!fs.existsSync(path.join(dir, filter.QUARANTINE_DIRNAME)), 'dryRun 下不该建隔离目录');
});

t('损坏 jar 计入 errors 但其余照常处理', () => {
    const dir = makeTmp('scan-broken');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    fs.writeFileSync(path.join(modsDir, 'broken.jar'), 'not a zip');
    makeFabricJar(path.join(modsDir, 'sodium.jar'), { id: 'sodium' });

    const r = filter.scanAndQuarantine({ modsDir, clientSet: filter.buildClientModSet().map });

    assert.strictEqual(r.movedCount, 1, '好的那个应该照常隔离');
    assert.ok(fs.existsSync(path.join(modsDir, 'broken.jar')), '坏的那个必须原地留着');
    // 注意：损坏 jar 走的是 judgeJar → ok=false → skip 路径，不算 error
    assert.ok(r.skipped.some(s => s.file === 'broken.jar'));
});

t('skip 列表带上 modid 便于排查', () => {
    const dir = makeTmp('scan-skipinfo');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    makeFabricJar(path.join(modsDir, 'lithium.jar'), { id: 'lithium', entrypoints: { main: ['a.B'] } });

    const r = filter.scanAndQuarantine({ modsDir, clientSet: filter.buildClientModSet().map });
    const item = r.skipped.find(s => s.file === 'lithium.jar');
    assert.ok(item);
    assert.strictEqual(item.modId, 'lithium');
});

t('log 回调收到隔离事件', () => {
    const dir = makeTmp('scan-log');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    makeFabricJar(path.join(modsDir, 'sodium.jar'), { id: 'sodium' });

    const logs = [];
    filter.scanAndQuarantine({
        modsDir,
        clientSet: filter.buildClientModSet().map,
        log: (level, msg) => logs.push({ level, msg })
    });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].level, 'info');
    assert.ok(logs[0].msg.includes('sodium.jar'));
});

t('用户剔除名单后该模组留在原地', () => {
    const dir = makeTmp('scan-exclude');
    const modsDir = path.join(dir, 'mods');
    fs.ensureDirSync(modsDir);
    makeFabricJar(path.join(modsDir, 'jade.jar'), { id: 'jade' });

    const { map } = filter.buildClientModSet({ extra: ['-jade'] });
    const r = filter.scanAndQuarantine({ modsDir, clientSet: map });
    assert.strictEqual(r.movedCount, 0);
    assert.ok(fs.existsSync(path.join(modsDir, 'jade.jar')));
});

console.log('\n— 恢复（listQuarantined / restoreQuarantined）—');

t('listQuarantined 只列 jar，目录不存在返回空', () => {
    const dir = makeTmp('restore-list');
    assert.deepStrictEqual(filter.listQuarantined(path.join(dir, 'nope')), []);

    const q = path.join(dir, 'q');
    fs.ensureDirSync(q);
    makeFabricJar(path.join(q, 'a.jar'), { id: 'a' });
    makeFabricJar(path.join(q, 'b.jar'), { id: 'b' });
    fs.writeFileSync(path.join(q, 'readme.txt'), 'x');
    const list = filter.listQuarantined(q);
    assert.strictEqual(list.length, 2);
    assert.deepStrictEqual(list.map(x => x.file).sort(), ['a.jar', 'b.jar']);
});

t('恢复单个文件', () => {
    const dir = makeTmp('restore-one');
    const q = path.join(dir, 'q');
    const mods = path.join(dir, 'mods');
    fs.ensureDirSync(q);
    makeFabricJar(path.join(q, 'a.jar'), { id: 'a' });
    makeFabricJar(path.join(q, 'b.jar'), { id: 'b' });

    const r = filter.restoreQuarantined({ quarantineDir: q, modsDir: mods, file: 'a.jar' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.restored.length, 1);
    assert.ok(fs.existsSync(path.join(mods, 'a.jar')));
    assert.ok(!fs.existsSync(path.join(q, 'a.jar')));
    assert.ok(fs.existsSync(path.join(q, 'b.jar')), '另一个不该动');
});

t('恢复全部（file 省略 = *）', () => {
    const dir = makeTmp('restore-all');
    const q = path.join(dir, 'q');
    const mods = path.join(dir, 'mods');
    fs.ensureDirSync(q);
    makeFabricJar(path.join(q, 'a.jar'), { id: 'a' });
    makeFabricJar(path.join(q, 'b.jar'), { id: 'b' });

    const r = filter.restoreQuarantined({ quarantineDir: q, modsDir: mods });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.restored.length, 2);
    assert.deepStrictEqual(fs.readdirSync(mods).sort(), ['a.jar', 'b.jar']);
    assert.strictEqual(filter.listQuarantined(q).length, 0);
});

t('恢复时 mods/ 已有同名文件 → 改名保住两份，不覆盖', () => {
    const dir = makeTmp('restore-conflict');
    const q = path.join(dir, 'q');
    const mods = path.join(dir, 'mods');
    fs.ensureDirSync(q);
    fs.ensureDirSync(mods);
    makeFabricJar(path.join(q, 'iris.jar'), { id: 'iris', v: 'old' });
    makeFabricJar(path.join(mods, 'iris.jar'), { id: 'iris', v: 'new' });

    const r = filter.restoreQuarantined({ quarantineDir: q, modsDir: mods, file: 'iris.jar' });
    assert.strictEqual(r.restored.length, 1);
    assert.strictEqual(r.restored[0].conflict, true);
    assert.ok(/^iris\.restored-\d+\.jar$/.test(r.restored[0].restoredAs));

    const files = fs.readdirSync(mods);
    assert.strictEqual(files.length, 2, '两份都要在');
    // 原文件内容不能被改
    const orig = fs.readFileSync(path.join(mods, 'iris.jar'));
    assert.ok(orig.length > 0);
});

t('隔离目录不存在 → ok=false 带原因', () => {
    const dir = makeTmp('restore-nodir');
    const r = filter.restoreQuarantined({ quarantineDir: path.join(dir, 'nope'), modsDir: path.join(dir, 'mods') });
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.includes('不存在'));
});

t('隔离目录为空 → ok=false 提示是空的', () => {
    const dir = makeTmp('restore-empty');
    const q = path.join(dir, 'q');
    fs.ensureDirSync(q);
    const r = filter.restoreQuarantined({ quarantineDir: q, modsDir: path.join(dir, 'mods') });
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.includes('空的'));
});

t('指定的文件不在隔离区 → ok=false', () => {
    const dir = makeTmp('restore-missing');
    const q = path.join(dir, 'q');
    fs.ensureDirSync(q);
    makeFabricJar(path.join(q, 'a.jar'), { id: 'a' });
    const r = filter.restoreQuarantined({ quarantineDir: q, modsDir: path.join(dir, 'mods'), file: 'zzz.jar' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.includes('没有'));
});

t('恢复后 mods/ 自动创建', () => {
    const dir = makeTmp('restore-mkdir');
    const q = path.join(dir, 'q');
    const mods = path.join(dir, 'mods');
    fs.ensureDirSync(q);
    makeFabricJar(path.join(q, 'a.jar'), { id: 'a' });
    assert.ok(!fs.existsSync(mods));
    filter.restoreQuarantined({ quarantineDir: q, modsDir: mods });
    assert.ok(fs.existsSync(mods));
});

console.log('\n— 摘要格式 —');

t('有隔离时输出条目与恢复提示', () => {
    const lines = filter.formatSummary({
        movedCount: 2,
        quarantined: [
            { file: 'sodium.jar', modId: 'sodium', desc: '钠' },
            { file: 'iris.jar', modId: 'iris', desc: '光影' }
        ]
    });
    const text = lines.join('\n');
    assert.ok(text.includes('已隔离 2 个'));
    assert.ok(text.includes('[sodium] sodium.jar'));
    assert.ok(text.includes('挪回 mods/'));
});

t('dryRun 摘要措辞为「将会隔离」且不含恢复提示', () => {
    const lines = filter.formatSummary({
        movedCount: 1,
        quarantined: [{ file: 'a.jar', modId: 'a', desc: '' }]
    }, true);
    const text = lines.join('\n');
    assert.ok(text.includes('将会隔离 1 个'));
    assert.ok(!text.includes('挪回 mods/'));
});

t('无移动时摘要为空', () => {
    assert.deepStrictEqual(filter.formatSummary({ movedCount: 0, quarantined: [] }), []);
    assert.deepStrictEqual(filter.formatSummary(null), []);
});

console.log('\n— server.js 接入 —');

t('server.js 有 _quarantineClientMods 且在 start 中调用', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.ok(src.includes('_quarantineClientMods()'), 'start() 中应调用隔离方法');
    assert.ok(src.includes('client_mod_filter'), '应引入 client_mod_filter');
    // 调用点必须在 _getServerJar 之前
    const callIdx = src.indexOf('this._quarantineClientMods()');
    const jarIdx = src.indexOf('this._getServerJar();', callIdx - 1);
    assert.ok(callIdx > 0 && jarIdx > callIdx, '隔离应在核心检查之前完成');
});

t('隔离逻辑整体包在 try 里，异常不阻断启动', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    const start = src.indexOf('_quarantineClientMods() {');
    const body = src.slice(start, start + 3000);
    assert.ok(body.includes('catch (e)'), '必须有 catch');
    assert.ok(body.includes('不影响启动'), 'catch 里应明确说明不影响启动');
});

console.log('\n— 配置项 —');

t('config 默认值里有 mod.client_only 三项', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8');
    assert.ok(src.includes('client_only:'));
    assert.ok(src.includes('disable_builtin: false'));
    assert.ok(/client_only:\s*\{[\s\S]*?enabled:\s*true/.test(src), '默认应开启');
});

t('config_schema 登记了三个字段', () => {
    const schema = require('../src/config_schema');
    for (const k of ['mod.client_only.enabled', 'mod.client_only.extra', 'mod.client_only.disable_builtin']) {
        assert.ok(schema.getField(k), `schema 缺少 ${k}`);
    }
});

t('schema 校验：enabled 只收布尔', () => {
    const schema = require('../src/config_schema');
    const r = schema.validatePatch({ 'mod.client_only.enabled': 'true' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.values['mod.client_only.enabled'], true);
    const bad = schema.validatePatch({ 'mod.client_only.enabled': 'maybe' });
    assert.strictEqual(bad.ok, false);
});

t('schema 校验：extra 多行转数组并保留 - 前缀', () => {
    const schema = require('../src/config_schema');
    const r = schema.validatePatch({ 'mod.client_only.extra': 'my-mod\n-jade\n\n' });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.values['mod.client_only.extra'], ['my-mod', '-jade']);
});

// ==================== 收尾 ====================

try {
    if (tmpRoot) fs.removeSync(tmpRoot);
} catch (e) {}

console.log('\n====================');
if (fail === 0) {
    console.log(`✅ client_mod_filter 全部通过：${pass} 项`);
} else {
    console.log(`❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`);
    for (const f of failures) {
        console.log(`\n   ${f.name}`);
        console.log(`   ${f.error.stack.split('\n').slice(0, 4).join('\n   ')}`);
    }
}
console.log('====================\n');

process.exit(fail === 0 ? 0 : 1);
