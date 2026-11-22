#!/usr/bin/env node
/**
 * 公测加固回归：WebSocket 握手鉴权 + Origin 校验
 * ----------------------------------------------------------------
 * 背景：Express 的登录中间件只覆盖 HTTP 请求，/socket.io/ 的升级请求由
 * engine.io 直接接管。加固前，未登录的客户端连上来就能 emit('command')
 * 执行面板指令（HTTP 那道锁形同虚设）。
 *
 * 覆盖点：
 *   1. isSocketOriginAllowed：无 Origin 放行、同源放行、跨站拒绝、
 *      端口不一致拒绝、web.cors_origins 白名单放行、非 http(s) 拒绝
 *   2. require_login=true：无 token / 假 token / 错密钥 token 一律拒绝，
 *      CONNECT 包里的 auth.token 与 ?token= 两条通道都能放行
 *   3. require_login=false：免登录模式行为不变，无 token 也能连
 *
 * 说明：Node 22 起才有全局 WebSocket；低版本 Node 只跑第 1 组，不判失败。
 * 运行：cd core && node test/ws_auth.test.js
 */

process.env.WOW_WEB_AUTH_TOKEN = 'ws-auth-e2e-secret';

const path = require('path');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '../src');
const PORT = 18103;
const SECRET = process.env.WOW_WEB_AUTH_TOKEN;
const WS_BASE = `ws://127.0.0.1:${PORT}/socket.io/?EIO=4&transport=websocket`;

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
    if (ok) { console.log(`  ✅ ${name}`); pass++; }
    else { console.log(`  ❌ ${name}${extra ? '  → ' + extra : ''}`); fail++; }
}

/**
 * 连一次 socket.io，返回 'connected' | 'rejected' | 'error' | 'timeout'。
 * 走 engine.io v4 原始协议：收到 0{...} 后自己发 40（CONNECT），
 * 带 token 时按真实客户端做法把 auth 放进 CONNECT 载荷：
 *   `40{"token":"..."}` —— 服务端会把它填进 handshake.auth。
 * 再看服务端回 40（成功）还是 44（被 io.use 拒绝）。
 */
function wsProbe(url, token, timeout = 6000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (result, data) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { ws.close(); } catch (e) { /* 忽略 */ }
            resolve({ result, data: data || '' });
        };
        const ws = new WebSocket(url);
        const timer = setTimeout(() => finish('timeout'), timeout);

        ws.onmessage = (e) => {
            const d = String(e.data);
            if (d.startsWith('0')) {
                try { ws.send(token ? '40' + JSON.stringify({ token }) : '40'); } catch (err) { /* 忽略 */ }
            } else if (d.startsWith('40')) finish('connected', d);
            else if (d.startsWith('44')) finish('rejected', d);
        };
        ws.onerror = () => finish('error');
        ws.onclose = () => { if (!done) finish('closed'); };
    });
}

(async () => {
    const config = require(path.join(SRC, 'config'));
    const webService = require(path.join(SRC, 'web_service'));

    console.log('\n[1] isSocketOriginAllowed —— Origin 判定\n');

    const allow = webService.isSocketOriginAllowed;
    check('不带 Origin（CLI / 脚本 / 测试）放行', allow(undefined, '127.0.0.1:8080', []) === true);
    check('同源放行', allow('http://127.0.0.1:8080', '127.0.0.1:8080', []) === true);
    check('反代场景：Origin 与 Host 一致即放行', allow('https://panel.example.com', 'panel.example.com', []) === true);
    check('跨站 Origin 拒绝', allow('http://evil.example', '127.0.0.1:8080', []) === false);
    check('端口不一致拒绝', allow('http://127.0.0.1:9999', '127.0.0.1:8080', []) === false);
    check('web.cors_origins 白名单放行', allow('http://localhost:5173', '127.0.0.1:8080', ['http://localhost:5173']) === true);
    check('非 http(s) 协议拒绝', allow('file:///tmp/x.html', '127.0.0.1:8080', []) === false);
    check('畸形 Origin 拒绝', allow('not a url', '127.0.0.1:8080', []) === false);

    if (typeof WebSocket === 'undefined') {
        console.log('\nℹ️  当前 Node 无全局 WebSocket（<22），跳过握手 e2e，只跑判定逻辑');
        console.log(`\n====================\n通过 ${pass} 项，失败 ${fail} 项\n====================`);
        process.exit(fail ? 1 : 0);
    }

    const mem = new Map([
        ['web.require_login', true],
        ['web.cors_origins', []]
    ]);
    const orig = { get: config.getConfig, set: config.setConfig, sets: config.setConfigs };
    config.getConfig = (k, d) => (mem.has(k) ? mem.get(k) : d);
    config.setConfig = (k, v) => { mem.set(k, v); };
    config.setConfigs = (o) => {
        Object.keys(o || {}).forEach((k) => mem.set(k, o[k]));
        return Object.keys(o || {}).length;
    };

    await webService.startWeb({ port: PORT, host: '127.0.0.1' });
    await new Promise((r) => setTimeout(r, 800));

    const good = jwt.sign({ email: 'admin@local' }, SECRET, { expiresIn: '5m' });

    console.log('\n[2] require_login=true —— 必须带有效 token\n');

    let r = await wsProbe(WS_BASE);
    check('无 token 被拒（安全修复生效）', r.result === 'rejected' && /unauthorized/.test(r.data), `${r.result} ${r.data.slice(0, 60)}`);

    r = await wsProbe(WS_BASE, 'wrong-token');
    check('假 token 被拒', r.result === 'rejected' && /unauthorized/.test(r.data), `${r.result} ${r.data.slice(0, 60)}`);

    r = await wsProbe(WS_BASE, jwt.sign({ email: 'x' }, 'other-secret', { expiresIn: '5m' }));
    check('别的密钥签的 token 被拒', r.result === 'rejected', `${r.result} ${r.data.slice(0, 60)}`);

    r = await wsProbe(WS_BASE, good);
    check('有效 token（CONNECT auth，前端实际用法）放行', r.result === 'connected', `${r.result} ${r.data.slice(0, 60)}`);

    r = await wsProbe(WS_BASE + '&token=' + encodeURIComponent(good));
    check('有效 token（?token= 兼容通道）放行', r.result === 'connected', `${r.result} ${r.data.slice(0, 60)}`);

    console.log('\n[3] require_login=false —— 免登录模式行为不变\n');

    mem.set('web.require_login', false);
    r = await wsProbe(WS_BASE);
    check('免登录时无 token 也能连', r.result === 'connected', `${r.result} ${r.data.slice(0, 60)}`);

    try { webService.stopWeb(); } catch (e) { /* 忽略 */ }
    config.getConfig = orig.get;
    config.setConfig = orig.set;
    config.setConfigs = orig.sets;

    console.log(`\n====================\n通过 ${pass} 项，失败 ${fail} 项\n====================`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('测试异常:', (e && e.stack) || e);
    process.exit(1);
});
