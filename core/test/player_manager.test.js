#!/usr/bin/env node
/**
 * 玩家名单管理（player_manager）测试 —— V3.8.0 P1
 * ----------------------------------------------------------------
 * 钉死：
 *   - 铁律①：运行态改白/黑名单走 stdin（whitelist add / ban），绝不直接改 JSON；
 *     停止态才写 whitelist.json / banned-players.json；
 *     stdin 发送失败时绝不降级改 JSON（返回 failed + 明确提示）；
 *   - 玩家 id 校验：非法 id（含换行/空格/超长）拒绝，防 stdin 指令注入；
 *   - known_players 合并去重，已有条目保留原 first_join；
 *   - banned-players.json 标准结构（uuid/name/created/source/expires/reason）。
 *
 * 全程用注入的 SchemeManager / ServerManager stub + 临时目录，不碰真实环境。
 * 运行：cd core && node test/player_manager.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');
const yaml = require('js-yaml');

const { PlayerManager } = require('../src/player_manager');

const WORK = path.join(os.tmpdir(), `player_manager_${process.pid}`);
fs.emptyDirSync(WORK);
const SCHEME_DIR = path.join(WORK, 'scheme', 'alpha');
fs.ensureDirSync(SCHEME_DIR);
fs.writeFileSync(path.join(SCHEME_DIR, 'scheme.yaml'), yaml.dump({ name: 'alpha', version: '1.20.1' }), 'utf8');

const smStub = {
    _schemeExists: (n) => n === 'alpha',
    _getSchemePath: (n) => path.join(WORK, 'scheme', n),
    getActiveScheme: () => 'alpha',
    getMeta: (n) => yaml.load(fs.readFileSync(path.join(WORK, 'scheme', n, 'scheme.yaml'), 'utf8')) || {},
    saveMeta: (n, meta) => fs.writeFileSync(
        path.join(WORK, 'scheme', n, 'scheme.yaml'), yaml.dump(meta, { indent: 2 }), 'utf8')
};

function serverStub(running, sendOk = true) {
    const sent = [];
    return {
        sent,
        isRunning: () => running,
        sendCommand: (cmd) => { sent.push(cmd); return sendOk; }
    };
}

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

console.log('\n=== 玩家名单管理 player_manager ===\n');

// ── known_players 合并 ──
check('合并去重：重复 id 不新增，首入时间保留', () => {
    fs.writeFileSync(path.join(SCHEME_DIR, 'scheme.yaml'), yaml.dump({
        name: 'alpha',
        known_players: [{ id: 'Steve', first_join: '2020-01-01T00:00:00.000Z' }]
    }), 'utf8');
    const pm = new PlayerManager({ schemeManager: smStub, server: serverStub(false) });
    const r = pm.mergePlayers('alpha', ['Steve', 'Alex', 'alex', 'Notch']);
    assert.strictEqual(r.added, 2);          // Alex + Notch（alex 大小写重复被去重）
    assert.strictEqual(r.total, 3);
    const meta = yaml.load(fs.readFileSync(path.join(SCHEME_DIR, 'scheme.yaml'), 'utf8'));
    assert.strictEqual(meta.known_players[0].first_join, '2020-01-01T00:00:00.000Z', '已有条目首入时间不得被覆盖');
    const alex = meta.known_players.find(p => p.id === 'Alex');
    assert.ok(alex && /^\d{4}-/.test(alex.first_join), '新条目应记 ISO 时间');
});

check('listPlayers 附带白/黑名单状态', () => {
    fs.writeFileSync(path.join(SCHEME_DIR, 'whitelist.json'), JSON.stringify([{ uuid: 'u', name: 'Steve' }]), 'utf8');
    fs.writeFileSync(path.join(SCHEME_DIR, 'banned-players.json'), JSON.stringify([{ name: 'Notch' }]), 'utf8');
    const pm = new PlayerManager({ schemeManager: smStub, server: serverStub(false) });
    const list = pm.listPlayers('alpha');
    const byId = Object.fromEntries(list.map(p => [p.id, p]));
    assert.strictEqual(byId.Steve.whitelisted, true);
    assert.strictEqual(byId.Notch.banned, true);
    assert.strictEqual(byId.Alex.whitelisted, false);
    assert.strictEqual(byId.Alex.banned, false);
});

// ── 铁律①：运行态 ──
check('运行态 whitelist → 走 stdin，且不改 JSON', () => {
    fs.removeSync(path.join(SCHEME_DIR, 'whitelist.json'));
    const server = serverStub(true);
    const pm = new PlayerManager({ schemeManager: smStub, server });
    const r = pm.whitelist('alpha', 'Herobrine');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.via, 'stdin');
    assert.deepStrictEqual(server.sent, ['whitelist add Herobrine']);
    assert.ok(!fs.existsSync(path.join(SCHEME_DIR, 'whitelist.json')), '运行态绝不能直接改 JSON');
});

check('运行态 ban → 走 stdin，且不改 JSON', () => {
    fs.removeSync(path.join(SCHEME_DIR, 'banned-players.json'));
    const server = serverStub(true);
    const pm = new PlayerManager({ schemeManager: smStub, server });
    const r = pm.ban('alpha', 'Griefer');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.via, 'stdin');
    assert.deepStrictEqual(server.sent, ['ban Griefer']);
    assert.ok(!fs.existsSync(path.join(SCHEME_DIR, 'banned-players.json')), '运行态绝不能直接改 JSON');
});

check('运行态 stdin 发送失败 → 不降级改 JSON，返回 failed', () => {
    const pm = new PlayerManager({ schemeManager: smStub, server: serverStub(true, false) });
    const r = pm.whitelist('alpha', 'FailGuy');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.via, 'failed');
    assert.ok(/停服/.test(r.message));
    assert.ok(!fs.existsSync(path.join(SCHEME_DIR, 'whitelist.json')));
});

// ── 铁律①：停服态 ──
check('停服态 whitelist → 写 whitelist.json（标准结构含离线 uuid）', () => {
    const pm = new PlayerManager({ schemeManager: smStub, server: serverStub(false) });
    const r = pm.whitelist('alpha', 'Steve2');
    assert.strictEqual(r.via, 'file');
    const data = JSON.parse(fs.readFileSync(path.join(SCHEME_DIR, 'whitelist.json'), 'utf8'));
    const e = data.find(x => x.name === 'Steve2');
    assert.ok(e, '应写入 Steve2');
    assert.ok(/^[0-9a-f-]{36}$/.test(e.uuid), '离线 uuid 格式');
});

check('停服态 ban → 写 banned-players.json（标准字段）', () => {
    const pm = new PlayerManager({ schemeManager: smStub, server: serverStub(false) });
    const r = pm.ban('alpha', 'BadGuy');
    assert.strictEqual(r.via, 'file');
    const data = JSON.parse(fs.readFileSync(path.join(SCHEME_DIR, 'banned-players.json'), 'utf8'));
    const e = data.find(x => x.name === 'BadGuy');
    assert.ok(e, '应写入 BadGuy');
    for (const k of ['uuid', 'created', 'source', 'expires', 'reason']) {
        assert.ok(e[k] !== undefined, `缺少字段 ${k}`);
    }
    assert.strictEqual(e.source, 'wow');
    assert.strictEqual(e.expires, 'forever');
});

check('停服态重复 ban 不产生重复条目', () => {
    const pm = new PlayerManager({ schemeManager: smStub, server: serverStub(false) });
    pm.ban('alpha', 'BadGuy');
    const data = JSON.parse(fs.readFileSync(path.join(SCHEME_DIR, 'banned-players.json'), 'utf8'));
    assert.strictEqual(data.filter(x => x.name === 'BadGuy').length, 1);
});

// ── 安全：id 校验 ──
check('非法 id 含空格/换行/超长 → 拒绝（防 stdin 注入）', () => {
    const pm = new PlayerManager({ schemeManager: smStub, server: serverStub(true) });
    for (const bad of ['a b', 'bad\nop', 'ab', 'x'.repeat(17), 'Steve;ban all', '']) {
        assert.throws(() => pm.whitelist('alpha', bad), /不合法/, `应拒绝: ${JSON.stringify(bad)}`);
    }
    assert.throws(() => pm.ban('alpha', 'a b'), /不合法/);
});

check('未指定方案且无激活方案 → 明确报错', () => {
    const smNoActive = Object.assign({}, smStub, { getActiveScheme: () => null });
    const pm = new PlayerManager({ schemeManager: smNoActive, server: serverStub(false) });
    assert.throws(() => pm.listPlayers(null), /没有激活的方案/);
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
fs.removeSync(WORK);
process.exit(failed === 0 ? 0 : 1);
