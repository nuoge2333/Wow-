/**
 * 陶瓦「我要当房客 / Join Room」测试（执行令阶段 4a）
 *
 * 约束：不连真陶瓦二进制、不启真守护进程，只做源码静态断言 + 纯 helper
 * 运行时验证，保证零外部依赖、必然退出。
 *
 * 覆盖：
 *   1) terracotta.js：apiGuesting / waitGuestOk / joinRoom 的实现契约；
 *   2) 房主 / 房客互斥守卫、二进制不支持时运行时降级；
 *   3) interactive.js：R 页第 9 项、case '144'、case '14' 子菜单第 4 项；
 *   4) 注释更正与导出。
 *
 * 运行：cd core && node test/terracotta_guest.test.js
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const ROOT = path.join(__dirname, '..', '..');
const terraSrc = fs.readFileSync(path.join(SRC, 'terracotta.js'), 'utf8');
const itvSrc = fs.readFileSync(path.join(SRC, 'interactive.js'), 'utf8');
const Terra = require(path.join(SRC, 'terracotta'));

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}

console.log('\n[1] terracotta.js —— 房客 API 与状态机');

check('导出 joinRoom / apiGuesting / waitGuestOk 等新入口', () => {
    for (const k of ['joinRoom', 'apiGuesting', 'waitGuestOk', 'isGuestingUnsupported', 'metaVersion']) {
        assert.strictEqual(typeof Terra[k], 'function', `未导出 ${k}`);
    }
});

check('apiGuesting 打 GET /state/guesting，且带 room / player 两个必填参数', () => {
    const i = terraSrc.indexOf('async function apiGuesting');
    assert.ok(i > 0, '找不到 apiGuesting');
    const body = terraSrc.slice(i, i + 500);
    assert.ok(/\/state\/guesting/.test(body), '未打 /state/guesting');
    assert.ok(/room:/.test(body) && /player:/.test(body), '缺 room / player 参数');
});

check('waitGuestOk 等 guest-ok，且不含房主侧专属依赖', () => {
    const i = terraSrc.indexOf('async function waitGuestOk');
    assert.ok(i > 0, '找不到 waitGuestOk');
    const body = terraSrc.slice(i, terraSrc.indexOf('// ==================== 对外业务接口', i));
    assert.ok(/guest-ok/.test(body), '未判定 guest-ok');
    assert.ok(/guest-connecting/.test(body) || /guest-starting/.test(body) || /guest-\*/.test(body) || /guest-/.test(body), '未涉及 guest-* 状态');
    assert.ok(!/LanBeacon|beacon\./.test(body), '房客侧不该用 LanBeacon');
    assert.ok(!/getServerPort\(/.test(body), '房客侧不该读本机 MC 端口');
    assert.ok(!/isPortListening\(/.test(body), '房客侧不该做端口自检');
    assert.ok(/exception/.test(body), '未处理 exception 状态');
});

console.log('\n[2] joinRoom —— 编排与降级');

check('joinRoom 按 startDaemon → /meta → apiIde → apiGuesting → waitGuestOk → writeState(guest) 编排', () => {
    const i = terraSrc.indexOf('async function joinRoom');
    assert.ok(i > 0, '找不到 joinRoom');
    const body = terraSrc.slice(i, terraSrc.indexOf('V3.5.16：开房成功后', i));
    const idx = k => body.indexOf(k);
    assert.ok(idx('startDaemon()') > 0, '未启动守护');
    assert.ok(idx('apiMeta(port)') > idx('startDaemon()'), '未读 /meta 版本');
    assert.ok(idx('apiIde(port)') > idx('apiMeta(port)'), '未复位 waiting');
    assert.ok(idx('apiGuesting(port, roomCode, player)') > idx('apiIde(port)'), '未发起加入');
    assert.ok(idx('waitGuestOk(') > idx('apiGuesting('), '未等待 guest-ok');
    assert.ok(idx("writeState({ mode: 'guest'") > idx('waitGuestOk('), '未写 guest 模式');
});

check('joinRoom 校验房间号与玩家名必填，空值直接返回 null 不抛错', () => {
    const i = terraSrc.indexOf('async function joinRoom');
    const body = terraSrc.slice(i, i + 900);
    assert.ok(/if \(!roomCode\)/.test(body), '未校验房间号');
    assert.ok(/if \(!player\)/.test(body), '未校验玩家名');
});

check('joinRoom 有房主状态冲突守卫（mode===\'host\' 时先复位）', () => {
    const i = terraSrc.indexOf('async function joinRoom');
    const body = terraSrc.slice(i, terraSrc.indexOf('V3.5.16：开房成功后', i));
    assert.ok(/mode === 'host'/.test(body), '缺房主冲突守卫');
    assert.ok(/apiIde\(port\)/.test(body), '冲突时未复位状态机');
});

check('二进制不支持 guesting 时降级：提示升级 lan.version + 启动器 + 回显房间号 + stopDaemon', () => {
    const i = terraSrc.indexOf('async function joinRoom');
    const body = terraSrc.slice(i, terraSrc.indexOf('V3.5.16：开房成功后', i));
    assert.ok(/isGuestingUnsupported\(e, stateAfterCall\)/.test(body), '未做运行时不支持探测');
    assert.ok(/lan\.version/.test(body), '未提示升级 lan.version');
    assert.ok(/PCL \/ HMCL \/ BakaXL \/ FCL/.test(body), '未给出启动器替代方案');
    assert.ok(/房间号: \$\{roomCode\}/.test(body), '未回显房间号');
    assert.ok(/await stopDaemon\(\)/.test(body), '降级时未收尾守护进程');
    assert.ok(/return null/.test(body), '降级未以 null 收尾（会崩）');
});

check('hostRoom 反向加 mode===\'guest\' 守卫，并写入 mode:\'host\'', () => {
    const i = terraSrc.indexOf('async function hostRoom');
    const body = terraSrc.slice(i, terraSrc.indexOf('V3.5.16：开房成功后', i));
    assert.ok(/mode === 'guest'/.test(body), 'hostRoom 缺房客冲突守卫');
    assert.ok(/writeState\(\{ roomCode, running: true, mode: 'host' \}\)/.test(body), '未写 host 模式');
});

check('getStatus 暴露 mode / player 字段', () => {
    const i = terraSrc.indexOf('async function getStatus');
    const body = terraSrc.slice(i, i + 900);
    assert.ok(/mode:/.test(body), 'getStatus 未返回 mode');
    assert.ok(/player:/.test(body), 'getStatus 未返回 player');
});

console.log('\n[3] 纯 helper 运行时判定（不连二进制）');

check('isGuestingUnsupported：404 / 405 / not found 判为不支持', () => {
    assert.strictEqual(Terra.isGuestingUnsupported({ response: { status: 404 } }), true);
    assert.strictEqual(Terra.isGuestingUnsupported({ response: { status: 405 } }), true);
    assert.strictEqual(Terra.isGuestingUnsupported({ message: 'Request failed with status code 404' }), true);
    assert.strictEqual(Terra.isGuestingUnsupported({ message: 'connect ECONNREFUSED' }), false);
});

check('isGuestingUnsupported：状态停在 waiting 判为不支持，guest-* 判为正常', () => {
    assert.strictEqual(Terra.isGuestingUnsupported(null, { state: 'waiting' }), true);
    assert.strictEqual(Terra.isGuestingUnsupported(null, { state: 'guest-connecting' }), false);
    assert.strictEqual(Terra.isGuestingUnsupported(null, { state: 'guest-ok' }), false);
    assert.strictEqual(Terra.isGuestingUnsupported(null, null), false);
});

check('metaVersion：从 /meta 各形态提取版本串', () => {
    assert.strictEqual(Terra.metaVersion({ version: '0.4.2' }), '0.4.2');
    assert.strictEqual(Terra.metaVersion({ tag: 'v0.5.0' }), 'v0.5.0');
    assert.strictEqual(Terra.metaVersion('1.2.3'), '1.2.3');
    assert.strictEqual(Terra.metaVersion(null), '未知');
    assert.strictEqual(Terra.metaVersion({}), '未知');
});

check('joinRoom 空房间号 / 空玩家名返回 null（同步前置校验，不启动守护）', async () => {
    // 用 Promise 包装，因为 joinRoom 是 async；空值分支在第一个 await 之前
    const r1 = await Terra.joinRoom({ roomCode: '', player: 'Steve' });
    assert.strictEqual(r1, null);
    const r2 = await Terra.joinRoom({ roomCode: 'ABCD-1234', player: '' });
    assert.strictEqual(r2, null);
});

console.log('\n[4] interactive.js —— R 页联机四项与 ACTION_BY_KEY 接线');

check('R 页四项联机动作各自成项（V3.7.4 扁平化后无聚合入口）', () => {
    const i = itvSrc.indexOf("key: 'R'");
    const body = itvSrc.slice(i, itvSrc.indexOf("key: 'T'", i));
    for (const label of ['开房（陶瓦，生成房间号）', '查看房间号 / 联机状态',
                         '关房（停止陶瓦）', '我要当房客 Join Room (陶瓦)']) {
        assert.ok(new RegExp(`label: '${label.replace(/[/()\[\]]/g, m => '\\' + m)}'`).test(body),
            `R 页缺少「${label}」`);
    }
    // 扁平化后 R 页第 1 项直接是开房，不再有「联机 / 我要当房主」聚合项
    assert.ok(/id: '1', label: '开房（陶瓦，生成房间号）'/.test(body), 'R 页第 1 项不是开房');
    assert.ok(!/label: '联机 \/ 我要当房主 \(陶瓦\)'/.test(body), '聚合入口仍存在');
});

check('R4「我要当房客」经 ACTION_BY_KEY 接到 terracottaJoin', () => {
    assert.ok(/action\('R', 4, \(env\) => terracottaJoin\(env\)\)/.test(itvSrc),
        'R4 未接到 terracottaJoin');
    const i = itvSrc.indexOf('async function terracottaJoin(');
    assert.ok(i > 0, '缺 terracottaJoin 实现');
    const body = itvSrc.slice(i, i + 1600);
    assert.ok(/请输入房间号/.test(body), '未收集房间号');
    assert.ok(/请输入你的玩家名/.test(body), '未收集玩家名');
    assert.ok(/Terracotta\.joinRoom\(\{ roomCode, player: playerName \}\)/.test(body), '未调 joinRoom');
    assert.ok(!/createInterface|createRL\(/.test(body), '房客动作自建了 readline');
    assert.ok(/ioAsk\(env\.io, env\.rl,/.test(body), '未走统一 ioAsk 通道');
});

check('R1/R2/R3 分别接到 hostRoom / getStatus / stopHost', () => {
    assert.ok(/action\('R', 1, \(env\) => terracottaHost\(env\)\)/.test(itvSrc));
    assert.ok(/action\('R', 2, \(\) => terracottaStatus\(\)\)/.test(itvSrc));
    assert.ok(/action\('R', 3, \(\) => terracottaStop\(\)\)/.test(itvSrc));
    assert.ok(/Terracotta\.hostRoom\(/.test(itvSrc), '缺 hostRoom 调用');
    assert.ok(/Terracotta\.getStatus\(/.test(itvSrc), '缺 getStatus 调用');
    assert.ok(/Terracotta\.stopHost\(/.test(itvSrc), '缺 stopHost 调用');
});

check('陶瓦子菜单已彻底移除（源码不再打印 1~4 选择页）', () => {
    const codeLines = itvSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert.ok(!codeLines.some(l => /请选择 \(0-/.test(l)), '仍有「请选择 (0-N)」');
});

console.log('\n[5] 注释与文档更正');

check('config.js / terracotta.js 头部不再声称「仅实现房主端 / guesting 未实现」', () => {
    const cfg = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
    assert.ok(!/3\.3\.0 仅实现/.test(cfg), 'config.js 旧范围注释未更正');
    assert.ok(/joinRoom/.test(cfg), 'config.js 未说明房客支持');
    assert.ok(!/3\.3\.0 房主端未实现/.test(terraSrc), 'terracotta.js 头部旧注释未更正');
    assert.ok(/wow 3\.7\.0 起支持 joinRoom/.test(terraSrc), 'terracotta.js 未标注 3.7.0 房客支持');
});

check('docs/LAN_TERRACOTTA.md 更新为双端支持 + 降级说明', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'LAN_TERRACOTTA.md'), 'utf8');
    assert.ok(/房客端/.test(doc), '文档未提房客端');
    assert.ok(/Join Room/.test(doc), '文档未提 Join Room');
    assert.ok(/state\/guesting/.test(doc), '文档未提 /state/guesting');
    assert.ok(!/仅实现 \*\*房主端/.test(doc), '文档仍写着仅房主端');
});

console.log(`\n${'='.repeat(46)}`);
console.log(`✅ 通过 ${passed} 项，失败 ${failed} 项`);
console.log('='.repeat(46));
process.exit(failed ? 1 : 0);
