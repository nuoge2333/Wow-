#!/usr/bin/env node
/**
 * 单方案多存档 + 图标生态 单元测试：
 * - 旧版 world 目录自动迁移（防丢档、幂等）
 * - 新建存档（正则校验、种子/类型写入、失败回滚）
 * - 存档切换（level-name 改写、运行拦截由 API 层负责）
 * - 图标生成（双写 server-icon.png + <level>/icon.png、PNG 校验）
 * - 素材库复制（fs.copyFileSync、不写 index.yaml、白名单防误删）
 * 全程用临时目录隔离，不碰真实 scheme / pool。
 */
const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const config = require(path.join(SRC, 'config'));
const WM = require(path.join(SRC, 'world_manager'));
const ServerProps = require(path.join(SRC, 'server_props'));

// 隔离 pool.dir（图标素材库走 utils.getPoolPath → config pool.dir）
const origPoolDir = config.getConfig('pool.dir', 'pool');
const TMP_ROOT = path.join(__dirname, '..', `.tmp_wm_${process.pid}`);
// pool.dir 相对 core/ 解析 → 真实落盘在 core/test/.tmp_wm_<pid>/pool，需单独清理
const TMP_POOL_ABS = path.join(__dirname, `.tmp_wm_${process.pid}`);
const tmpPoolRel = path.join('test', `.tmp_wm_${process.pid}`, 'pool');
const SCHEME = path.join(TMP_ROOT, 'schemeA');

let passed = 0, failed = 0;
async function check(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// 最小合法 1x1 PNG（base64）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

function writePropsRaw(schemePath, content) {
    fs.ensureDirSync(schemePath);
    fs.writeFileSync(path.join(schemePath, 'server.properties'), content, 'utf8');
}
function levelName(schemePath) {
    return ServerProps.readProps(schemePath).values['level-name'];
}

async function main() {
    fs.emptyDirSync(TMP_ROOT);
    config.setConfig('pool.dir', tmpPoolRel);

    console.log('\n旧存档迁移\n');
    await check('world + level-name=world → 迁移到 saves/ 并改 level-name', async () => {
        writePropsRaw(SCHEME, '# 注释必须保留\nlevel-name=world\nserver-port=25565\n');
        fs.ensureDirSync(path.join(SCHEME, 'world'));
        fs.writeFileSync(path.join(SCHEME, 'world', 'level.dat'), 'OLD');
        fs.ensureDirSync(path.join(SCHEME, 'world_nether'));
        fs.ensureDirSync(path.join(SCHEME, 'world_the_end'));
        const r = WM.migrateLegacyWorld(SCHEME);
        assert.strictEqual(r.migrated, true);
        assert.ok(r.moved.includes('world'));
        assert.ok(fs.existsSync(path.join(SCHEME, 'saves', 'world', 'level.dat')), 'world 未搬进 saves');
        assert.strictEqual(levelName(SCHEME), 'saves/world');
        const raw = fs.readFileSync(path.join(SCHEME, 'server.properties'), 'utf8');
        assert.ok(raw.includes('# 注释必须保留'), '注释丢失');
        assert.ok(raw.includes('server-port=25565'), '其他键丢失');
    });

    await check('迁移幂等：重复调用不再搬动', async () => {
        const r = WM.migrateLegacyWorld(SCHEME);
        assert.strictEqual(r.migrated, false);
        assert.strictEqual(r.moved.length, 0);
    });

    await check('目标已存在时不覆盖（防丢档）', async () => {
        const s2 = path.join(TMP_ROOT, 'schemeB');
        writePropsRaw(s2, 'level-name=world\n');
        fs.ensureDirSync(path.join(s2, 'world'));
        fs.writeFileSync(path.join(s2, 'world', 'level.dat'), 'ROOT');
        fs.ensureDirSync(path.join(s2, 'saves', 'world'));
        fs.writeFileSync(path.join(s2, 'saves', 'world', 'level.dat'), 'SAVES');
        WM.migrateLegacyWorld(s2);
        assert.strictEqual(fs.readFileSync(path.join(s2, 'saves', 'world', 'level.dat'), 'utf8'), 'SAVES', '覆盖了已有存档');
    });

    console.log('\n新建 / 切换存档\n');
    await check('新建存档：正则校验拒绝非法名', async () => {
        const bad = ['', '../evil', 'has space', '中文', 'a/b', 'a.b'];
        for (const n of bad) {
            assert.strictEqual(WM.isValidWorldName(n), false, `${n} 应被拒绝`);
        }
        assert.strictEqual(WM.isValidWorldName('my_survival-1'), true);
    });

    await check('新建存档：写入 level-name/seed/type，保留注释', async () => {
        writePropsRaw(SCHEME, '# world config\nlevel-name=saves/world\n');
        const r = WM.createWorld(SCHEME, { name: 'my_survival', seed: '12345', levelType: 'flat' });
        assert.strictEqual(r.ok, true, r.reason);
        assert.strictEqual(levelName(SCHEME), 'saves/my_survival');
        const v = ServerProps.readProps(SCHEME).values;
        assert.strictEqual(v['level-seed'], '12345');
        assert.strictEqual(v['level-type'], 'flat');
        assert.ok(fs.existsSync(path.join(SCHEME, 'saves', 'my_survival')));
        const raw = fs.readFileSync(path.join(SCHEME, 'server.properties'), 'utf8');
        assert.ok(raw.includes('# world config'), '注释丢失');
    });

    await check('新建存档：留空种子显式清空旧值', async () => {
        const r = WM.createWorld(SCHEME, { name: 'random_world', levelType: 'normal' });
        assert.strictEqual(r.ok, true, r.reason);
        assert.strictEqual(ServerProps.readProps(SCHEME).values['level-seed'], '');
    });

    await check('新建存档：重名拒绝', async () => {
        const r = WM.createWorld(SCHEME, { name: 'my_survival', levelType: 'normal' });
        assert.strictEqual(r.ok, false);
        assert.ok(/已存在/.test(r.reason));
    });

    await check('新建存档：非法 level-type 拒绝', async () => {
        const r = WM.createWorld(SCHEME, { name: 'bad_type', levelType: 'weird' });
        assert.strictEqual(r.ok, false);
        assert.ok(/世界类型/.test(r.reason));
    });

    await check('切换存档：目标需含 level.dat，成功后改 level-name', async () => {
        fs.ensureDirSync(path.join(SCHEME, 'saves', 'target'));
        fs.writeFileSync(path.join(SCHEME, 'saves', 'target', 'level.dat'), 'X');
        const r = WM.switchWorld(SCHEME, 'target');
        assert.strictEqual(r.ok, true, r.reason);
        assert.strictEqual(levelName(SCHEME), 'saves/target');
    });

    await check('切换存档：无 level.dat 拒绝', async () => {
        fs.ensureDirSync(path.join(SCHEME, 'saves', 'empty'));
        const r = WM.switchWorld(SCHEME, 'empty');
        assert.strictEqual(r.ok, false);
    });

    await check('listWorlds 只列含 level.dat 的存档并标 active', async () => {
        const list = WM.listWorlds(SCHEME, 'saves/target');
        const target = list.find(w => w.name === 'target');
        assert.ok(target, '缺 target');
        assert.strictEqual(target.active, true);
        assert.ok(!list.find(w => w.name === 'empty'), '空目录不应入列');
    });

    console.log('\n图标 + 素材库\n');
    await check('saveIcon 双写 + PNG 校验', async () => {
        // 让 level-name 指向 saves/target
        WM.switchWorld(SCHEME, 'target');
        const r = WM.saveIcon(SCHEME, PNG, {});
        assert.strictEqual(r.ok, true, r.reason);
        assert.ok(fs.existsSync(path.join(SCHEME, 'server-icon.png')));
        assert.ok(fs.existsSync(path.join(SCHEME, 'saves', 'target', 'icon.png')));
        assert.strictEqual(fs.statSync(path.join(SCHEME, 'server-icon.png')).size, PNG.length);
    });

    await check('saveIcon 拒绝非 PNG', async () => {
        const r = WM.saveIcon(SCHEME, Buffer.from('not a png'), {});
        assert.strictEqual(r.ok, false);
        assert.ok(/PNG/.test(r.reason));
    });

    await check('saveIcon toPool 物理复制，不写 index.yaml', async () => {
        const indexPath = path.join(path.resolve(__dirname, '..', tmpPoolRel), 'index.yaml');
        const before = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;
        const r = WM.saveIcon(SCHEME, PNG, { toPool: true, poolName: 'workbench' });
        assert.strictEqual(r.ok, true, r.reason);
        assert.ok(r.poolPath && fs.existsSync(r.poolPath), '素材未落盘');
        const after = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;
        assert.strictEqual(after, before, 'index.yaml 被改动（图标不应进哈希系统）');
    });

    await check('listPoolIcons 列出 .png', async () => {
        const icons = WM.listPoolIcons();
        assert.ok(icons.some(i => i.name === 'workbench.png'), '素材库缺 workbench.png');
    });

    await check('applyPoolIcon 覆盖双路径', async () => {
        // 先清空目标图标
        fs.removeSync(path.join(SCHEME, 'server-icon.png'));
        fs.removeSync(path.join(SCHEME, 'saves', 'target', 'icon.png'));
        const r = WM.applyPoolIcon(SCHEME, 'workbench.png');
        assert.strictEqual(r.ok, true, r.reason);
        assert.ok(fs.existsSync(path.join(SCHEME, 'server-icon.png')));
        assert.ok(fs.existsSync(path.join(SCHEME, 'saves', 'target', 'icon.png')));
    });

    await check('applyPoolIcon 拒绝路径穿越名', async () => {
        const r = WM.applyPoolIcon(SCHEME, '../../evil.png');
        assert.strictEqual(r.ok, false);
    });

    await check('iconTargets 防 level-name 逃出方案目录', async () => {
        writePropsRaw(SCHEME, 'level-name=../../evil\n');
        assert.throws(() => WM.iconTargets(SCHEME), /逃出|之外/);
    });

    await check('_cleanPool 白名单：pool/icons 不被清理误删', async () => {
        // 构造一个 SchemeManager 实例，往 pool/icons 放图标 + 往 index.yaml 塞一条误登记
        const SchemeManager = require(path.join(SRC, 'scheme_manager'));
        const sm = new SchemeManager();
        const poolAbs = path.resolve(__dirname, '..', tmpPoolRel);
        fs.ensureDirSync(path.join(poolAbs, 'icons'));
        const iconFile = path.join(poolAbs, 'icons', 'keepme.png');
        fs.writeFileSync(iconFile, PNG);
        // 误登记一条 icons 路径 + 一条普通未引用资源
        sm.poolIndex.resources = Object.assign({}, sm.poolIndex.resources, {
            'fakehash_icons': 'icons/keepme.png',
            'fakehash_jar': 'mods/orphan.jar'
        });
        sm.poolIndex.ref_count = Object.assign({}, sm.poolIndex.ref_count, {
            fakehash_icons: 0, fakehash_jar: 0
        });
        fs.ensureDirSync(path.join(poolAbs, 'mods'));
        const orphan = path.join(poolAbs, 'mods', 'orphan.jar');
        fs.writeFileSync(orphan, 'x');
        await sm._cleanPool();
        assert.ok(fs.existsSync(iconFile), 'icons/keepme.png 被误删');
        assert.ok(!fs.existsSync(orphan), '未引用 jar 应被清理');
        assert.ok(sm.poolIndex.resources['fakehash_icons'], 'icons 登记不应被删');
    });

    // 还原配置 + 清理（两处临时目录都要删）
    config.setConfig('pool.dir', origPoolDir);
    fs.removeSync(TMP_ROOT);
    fs.removeSync(TMP_POOL_ABS);
    console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
    config.setConfig('pool.dir', origPoolDir);
    try { fs.removeSync(TMP_ROOT); } catch (x) {}
    try { fs.removeSync(TMP_POOL_ABS); } catch (x) {}
    console.error(e);
    process.exit(1);
});
