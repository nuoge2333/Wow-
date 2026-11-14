#!/usr/bin/env node
/**
 * 玩家日志追踪（player_tracker）测试 —— V3.8.0 P1
 * ----------------------------------------------------------------
 * 钉死：
 *   - 铁律③：绝不 readFileSync 整日志（静态扫描源码 + 运行期监控 fs.readFileSync
 *     不得被 latest.log 调用）；用 createReadStream({start}) 从末尾回溯；
 *   - 大日志（> 5MB）只读尾部窗口，窗口外的旧玩家不会被提取；
 *   - 正则 `([a-zA-Z0-9_]{3,16}) joined the game` 提取、去重；
 *   - 合并进 scheme.yaml 的 known_players：去重 + 已有条目保留原 first_join；
 *   - 日志不存在时安全返回 0。
 *
 * 运行：cd core && node test/player_tracker.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');
const yaml = require('js-yaml');

const tracker = require('../src/player_tracker');
const { PlayerManager } = require('../src/player_manager');

const WORK = path.join(os.tmpdir(), `player_tracker_${process.pid}`);
fs.emptyDirSync(WORK);
const SCHEME_DIR = path.join(WORK, 'scheme', 'alpha');
const LOG_DIR = path.join(SCHEME_DIR, 'logs');
fs.ensureDirSync(LOG_DIR);
const LOG_PATH = path.join(LOG_DIR, 'latest.log');
const META_PATH = path.join(SCHEME_DIR, 'scheme.yaml');

function writeMeta(meta) {
    fs.writeFileSync(META_PATH, yaml.dump(meta, { indent: 2 }), 'utf8');
}
function readMeta() {
    return yaml.load(fs.readFileSync(META_PATH, 'utf8')) || {};
}

const smStub = {
    _schemeExists: (n) => n === 'alpha',
    _getSchemePath: (n) => path.join(WORK, 'scheme', n),
    getActiveScheme: () => 'alpha',
    getMeta: () => readMeta(),
    saveMeta: (n, meta) => writeMeta(meta)
};
const serverStub = { isRunning: () => false, sendCommand: () => true };
function makePm() {
    return new PlayerManager({ schemeManager: smStub, server: serverStub });
}

let passed = 0, failed = 0;
// 所有用例共用临时目录与同一个 latest.log，必须**串行**执行，避免读写竞态。
const cases = [];
function run(title, fn) {
    cases.push({ title, fn });
}

console.log('\n=== 玩家日志追踪 player_tracker ===\n');

// ── 静态守卫：源码不得出现 readFileSync 调用（注释里提到该词不算） ──
run('静态守卫：源码无 readFileSync 调用，使用 createReadStream', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'player_tracker.js'), 'utf8');
    assert.ok(!/readFileSync\s*\(/.test(src), 'player_tracker.js 不得调用 readFileSync');
    assert.ok(/createReadStream\s*\(/.test(src), '必须使用 createReadStream 流式读取');
});

// ── 运行期：普通日志提取 + 正则 + 去重 ──
run('普通日志：正则提取、去重、落盘 known_players', async () => {
    writeMeta({ name: 'alpha', version: '1.20.1' });
    fs.writeFileSync(LOG_PATH, [
        '[12:00:00] [Server thread/INFO]: Steve joined the game',
        '[12:00:01] [Server thread/INFO]: Alex joined the game',
        '[12:00:02] [Server thread/INFO]: Steve joined the game',
        '[12:00:03] [Server thread/INFO]: Notch lost connection',
        '[12:00:04] [Server thread/INFO]: joined the game',          // 无 ID，不匹配
        '[12:00:05] [Server thread/INFO]: ab joined the game'         // 2 位，不合法
    ].join('\n') + '\n', 'utf8');

    const r = await tracker.scanScheme('alpha', { playerManager: makePm() });
    assert.deepStrictEqual(r.ids.sort(), ['Alex', 'Steve']);
    assert.strictEqual(r.added, 2);
    assert.strictEqual(r.total, 2);
    const known = readMeta().known_players;
    assert.strictEqual(known.length, 2);
    assert.ok(known.every(p => /^\d{4}-/.test(p.first_join)));
});

run('已有条目保留原 first_join，只追加新玩家', async () => {
    writeMeta({
        name: 'alpha',
        known_players: [{ id: 'Steve', first_join: '2020-01-01T00:00:00.000Z' }]
    });
    fs.writeFileSync(LOG_PATH, [
        'xx Steve joined the game',
        'xx Herobrine joined the game'
    ].join('\n') + '\n', 'utf8');
    const r = await tracker.scanScheme('alpha', { playerManager: makePm() });
    assert.strictEqual(r.added, 1);
    assert.strictEqual(r.total, 2);
    const steve = readMeta().known_players.find(p => p.id === 'Steve');
    assert.strictEqual(steve.first_join, '2020-01-01T00:00:00.000Z');
});

// ── 铁律③：运行期不得 readFileSync 读日志 ──
run('运行期：fs.readFileSync 从未被用于 latest.log', async () => {
    writeMeta({ name: 'alpha' });
    fs.writeFileSync(LOG_PATH, 'xx Reader joined the game\n', 'utf8');
    const orig = fs.readFileSync;
    const touched = [];
    fs.readFileSync = function (...args) {
        touched.push(String(args[0]));
        if (String(args[0]) === LOG_PATH) {
            throw new Error('禁止 readFileSync 读取 latest.log');
        }
        return orig.apply(this, args);
    };
    try {
        const r = await tracker.scanScheme('alpha', { playerManager: makePm() });
        assert.deepStrictEqual(r.ids, ['Reader']);
        assert.ok(!touched.includes(LOG_PATH), 'readFileSync 不得触碰 latest.log');
    } finally {
        fs.readFileSync = orig;
    }
});

// ── 铁律③：大日志只读尾部 5MB ──
run('大日志（> 5MB）：只读尾部窗口，窗口外旧玩家不提取', async () => {
    writeMeta({ name: 'alpha' });
    const filler = 'x'.repeat(64 * 1024); // 每行 64KB
    const chunks = ['[old] WindowOuter joined the game\n'];
    // 写到明显超过 5MB（90 行 × 64KB ≈ 5.9MB）
    for (let i = 0; i < 90; i++) chunks.push(filler + '\n');
    chunks.push('[new] TailPlayer joined the game\n');
    fs.writeFileSync(LOG_PATH, chunks.join(''), 'utf8');

    const size = fs.statSync(LOG_PATH).size;
    assert.ok(size > tracker.MAX_TAIL_BYTES, '测试日志应超过回溯窗口');

    const r = await tracker.scanScheme('alpha', { playerManager: makePm() });
    assert.ok(r.bytesRead <= tracker.MAX_TAIL_BYTES, `读取字节 ${r.bytesRead} 应 ≤ 窗口上限`);
    assert.ok(r.bytesRead > 0 && r.bytesRead < size, '应只读尾部而非整文件');
    assert.ok(r.ids.includes('TailPlayer'), '尾部玩家应被提取');
    assert.ok(!r.ids.includes('WindowOuter'), '窗口外旧玩家不应被提取');
    assert.ok(readMeta().known_players.some(p => p.id === 'TailPlayer'));
});

// ── 中间起读会截断首行，不应产出半截 ID ──
run('自定义小窗口：起始处半截行被丢弃，不影响后续行', async () => {
    writeMeta({ name: 'alpha' });
    const lines = [];
    for (let i = 0; i < 20; i++) lines.push(`[${i}] Player${i} joined the game`);
    fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf8');
    const r = await tracker.scanScheme('alpha', { playerManager: makePm(), maxTailBytes: 200 });
    // 窗口很小，头部若干行必然被丢弃；但末尾几行应完整命中
    assert.ok(r.ids.includes('Player19'), '末尾行应命中');
    assert.ok(r.ids.every(id => /^Player\d+$/.test(id)), '不得出现半截 ID');
});

// ── 日志不存在 ──
run('latest.log 不存在：安全返回 added=0 / bytesRead=0', async () => {
    writeMeta({ name: 'alpha', known_players: [{ id: 'Keep', first_join: 'x' }] });
    fs.removeSync(LOG_PATH);
    const r = await tracker.scanScheme('alpha', { playerManager: makePm() });
    assert.strictEqual(r.added, 0);
    assert.strictEqual(r.bytesRead, 0);
    assert.deepStrictEqual(r.ids, []);
    assert.strictEqual(r.total, 1);
});

// ── recordPlayers 直接落盘 ──
run('recordPlayers：去重合并（大小写不敏感）', () => {
    writeMeta({ name: 'alpha' });
    tracker.recordPlayers('alpha', ['Zed', 'zed', 'Amy'], { playerManager: makePm() });
    const known = readMeta().known_players;
    assert.strictEqual(known.length, 2);
    assert.deepStrictEqual(known.map(p => p.id), ['Zed', 'Amy']);
});

(async () => {
    for (const c of cases) {
        try {
            await c.fn();
            console.log(`  ✅ ${c.title}`);
            passed++;
        } catch (e) {
            console.log(`  ❌ ${c.title}\n     ${e.message}`);
            failed++;
        }
    }
    fs.removeSync(WORK);
    console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
})();
