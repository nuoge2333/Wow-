/**
 * 端到端验证：Forge 深层核心「入池 → 瘦身 → 补齐」后仍在原位（V3.5.8）
 *
 * 这条链路是「切换方案后核心路径找错」的真正复现路径：
 *   create  → 核心在 libraries/ 深层，按 basename 入池 ⇒ 丢失层级
 *   prune   → 删掉方案内核心（按 basename 找，深层文件删不掉）
 *   switch  → 从池里按 basename 补回方案**根目录** ⇒ 启动时找不到 → 回退选中原版
 *
 * 运行：cd core && node test/forge_scheme_roundtrip.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const SchemeManager = require('../src/scheme_manager');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

const WORK = path.join(os.tmpdir(), `forge_roundtrip_${process.pid}`);
fs.emptyDirSync(WORK);

const sm = new SchemeManager();
// 完全隔离到临时目录，绝不碰真实的 scheme/ 与 wow.yaml
sm.schemesDir = path.join(WORK, 'scheme');
sm.poolDir = path.join(WORK, 'pool');
sm.poolIndexPath = path.join(sm.poolDir, 'index.yaml');
fs.ensureDirSync(sm.schemesDir);
fs.ensureDirSync(sm.poolDir);
sm.poolIndex = { resources: {}, ref_count: {} };
sm._savePoolIndex = () => {};   // 不落盘，避免并行测试互相干扰

const SCHEME = 'forge1201';
const schemePath = path.join(sm.schemesDir, SCHEME);
const CORE_REL = 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-server.jar';

console.log('\nForge 深层核心 入池/瘦身/补齐 往返测试 (V3.5.8)\n');

// 造方案目录 + 深层核心
fs.ensureDirSync(path.join(schemePath, 'mods'));
fs.ensureDirSync(path.join(schemePath, 'plugins'));
fs.ensureDirSync(path.join(schemePath, 'world'));
const coreAbs = path.join(schemePath, CORE_REL.split('/').join(path.sep));
fs.ensureDirSync(path.dirname(coreAbs));
fs.writeFileSync(coreAbs, 'FAKE_FORGE_SERVER_JAR');
fs.writeFileSync(path.join(path.dirname(coreAbs), 'unix_args.txt'), '-p libraries/...');

// ─────────────────────────────────────────────
console.log('— 入池 —');
let hash;
{
    hash = 'deadbeefcafe0001';
    // 直接调用真实 _addToPool，relPath 传相对路径
    sm._addToPool(coreAbs, 'cores', 'forge/1.20.1', hash, CORE_REL);
    sm.poolIndex.ref_count[hash] = 1;
}

check('1 池内按原始层级存放（不拍平）', () => {
    const relInPool = sm.poolIndex.resources[hash];
    assert.ok(relInPool.includes('libraries'), `池内路径丢了层级: ${relInPool}`);
    const abs = path.join(sm.poolDir, relInPool);
    assert.ok(fs.existsSync(abs), `池内文件不存在: ${abs}`);
    assert.strictEqual(fs.readFileSync(abs, 'utf8'), 'FAKE_FORGE_SERVER_JAR');
});

// 模拟 create 写入的元数据
const meta = {
    name: SCHEME,
    version: '1.20.1',
    loader: '47.2.0',
    type: 'forge',
    state: 'full',
    resources: {
        core: { file: CORE_REL, hash, in_pool: false, pool_path: null },
        mods: [],
        plugins: []
    },
    world: { exists: true, size: 0 }
};
sm._saveSchemeMeta = (n, m) => {
    fs.writeFileSync(path.join(sm.schemesDir, n, 'scheme.yaml'), require('js-yaml').dump(m), 'utf8');
};
sm._isResourceInPool = (h) => Boolean(sm.poolIndex.resources[h]);
sm._loadSchemeMeta = (n) => meta;

// ─────────────────────────────────────────────
console.log('— 瘦身（prune）—');
sm._pruneScheme(SCHEME);

check('2 瘦身后方案内的深层核心被删除', () => {
    assert.ok(!fs.existsSync(coreAbs), `深层核心仍在: ${coreAbs}`);
});

check('3 瘦身后元数据标记为 in_pool', () => {
    assert.strictEqual(meta.resources.core.in_pool, true);
});

check('4 瘦身不会误删方案根目录（无同名文件干扰）', () => {
    assert.ok(fs.existsSync(path.join(schemePath, 'mods')));
});

// ─────────────────────────────────────────────
console.log('— 补齐（materialize）—');
meta.state = 'minimal';
sm._materializeScheme(SCHEME);

check('5 补齐后核心回到 libraries 原位置（而不是方案根目录）', () => {
    assert.ok(fs.existsSync(coreAbs), `核心未还原到原位: ${coreAbs}`);
    assert.strictEqual(fs.readFileSync(coreAbs, 'utf8'), 'FAKE_FORGE_SERVER_JAR');
});

check('6 方案根目录没有多出一个拍平的 jar', () => {
    const atRoot = path.join(schemePath, 'forge-1.20.1-47.2.0-server.jar');
    assert.ok(!fs.existsSync(atRoot), `根目录出现了错误的拍平核心: ${atRoot}`);
});

check('7 _resolveCoreTarget 指向的正是还原后的文件', () => {
    const t = sm._resolveCoreTarget(schemePath, meta.resources.core);
    assert.strictEqual(t, coreAbs);
    assert.ok(fs.existsSync(t));
});

check('8 补齐后状态为 FULL 且 in_pool=false', () => {
    assert.strictEqual(meta.state, 'full');
    assert.strictEqual(meta.resources.core.in_pool, false);
});

// ─────────────────────────────────────────────
console.log('— 老方案兼容（file 为纯文件名）—');
{
    const legacy = path.join(sm.schemesDir, 'legacy1165');
    fs.ensureDirSync(legacy);
    const legacyFile = path.join(legacy, 'forge-1.16.5-36.2.39.jar');
    fs.writeFileSync(legacyFile, 'OLD');
    const legacyMeta = {
        state: 'full',
        resources: {
            core: { file: 'forge-1.16.5-36.2.39.jar', hash: 'legacyhash', in_pool: false, pool_path: null },
            mods: [], plugins: []
        }
    };
    const t = sm._resolveCoreTarget(legacy, legacyMeta.resources.core);
    check('9 老格式纯文件名仍解析到方案根目录', () => {
        assert.strictEqual(t, legacyFile);
        assert.ok(fs.existsSync(t));
    });
}

// ─────────────────────────────────────────────
fs.removeSync(WORK);
console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
