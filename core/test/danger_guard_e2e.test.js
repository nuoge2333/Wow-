#!/usr/bin/env node
/**
 * 指令一 端到端测试：危险开关写入闸门
 * ----------------------------------------------------------------
 * 起一个真实 Express 服务（绑 127.0.0.1，端口 18101），用 http.request 直接
 * 伪造 Host / 转发头，验证「本机放行、其余一律 403」，且不误伤普通配置写入。
 *
 * 隔离性：config.getConfig / setConfig / setConfigs 全部打桩到内存 Map，
 * 不读也不写 core/wow.yaml，可反复运行。
 *
 * 运行：cd core && node test/danger_guard_e2e.test.js
 */

process.env.WOW_WEB_AUTH_TOKEN = 'danger-guard-e2e-secret';

const assert = require('assert');
const http = require('http');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const PORT = 18101;
const DENY_MSG = '出于安全考虑，危险开关只能在 127.0.0.1 下修改';

let pass = 0, fail = 0;

function check(title, cond, extra = '') {
    if (cond) { console.log(`  ✅ ${title}`); pass++; }
    else { console.log(`  ❌ ${title}${extra ? '  → ' + extra : ''}`); fail++; }
}

function post(pathname, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1',
            port: PORT,
            path: pathname,
            method: 'POST',
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }, extraHeaders)
        }, (res) => {
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (e) { /* 非 JSON */ }
                resolve({ status: res.statusCode, data: json, text: buf });
            });
        });
        req.on('error', reject);
        req.end(data);
    });
}

(async () => {
    const config = require(path.join(SRC, 'config'));
    const webService = require(path.join(SRC, 'web_service'));

    const mem = new Map();
    const origGetConfig = config.getConfig;
    const origSetConfig = config.setConfig;
    const origSetConfigs = config.setConfigs;

    config.getConfig = (key, def) => (mem.has(key) ? mem.get(key) : def);
    config.setConfig = (key, value) => { mem.set(key, value); };
    config.setConfigs = (obj) => {
        Object.keys(obj || {}).forEach((k) => mem.set(k, obj[k]));
        return Object.keys(obj || {}).length;
    };

    const setHost = (h) => mem.set('web.host', h);

    // 暴露模式下 requireLogin() 恒为 true，普通配置写入需要带 JWT
    const jwt = require('jsonwebtoken');
    const TOKEN = jwt.sign({ email: 'e2e@local' }, process.env.WOW_WEB_AUTH_TOKEN, { expiresIn: '1h' });

    await webService.startWeb({ port: PORT, host: '127.0.0.1' });
    await new Promise((r) => setTimeout(r, 800));

    console.log('\n指令一：危险开关写入闸门 E2E\n');

    // ── 1. 本机基线：三种载荷都应放行 ──
    setHost('127.0.0.1');

    let r = await post('/api/config', { key: 'web.allow_plugins', value: false });
    check('本机 · 单键载荷放行', r.status === 200, `got ${r.status} ${r.text.slice(0, 80)}`);

    r = await post('/api/config/batch', { patch: { 'web.allow_scheme_ops': false } });
    check('本机 · batch 载荷放行', r.status === 200, `got ${r.status}`);

    r = await post('/api/config', { web: { allow_remote_install: false } });
    check('本机 · 整份嵌套载荷放行', r.status === 200, `got ${r.status}`);

    r = await post('/api/config', { web: { port: 8080 } });
    check('本机 · 普通配置写入不受影响', r.status === 200, `got ${r.status}`);

    // ── 2. 绑定地址对外：一律 403 ──
    setHost('0.0.0.0');

    r = await post('/api/config', { key: 'web.allow_plugins', value: true });
    check('暴露 · 单键 403', r.status === 403, `got ${r.status}`);
    check('暴露 · 403 文案逐字一致', !!(r.data && r.data.error === DENY_MSG), JSON.stringify(r.data));

    r = await post('/api/config/batch', { patch: { 'web.allow_scheme_ops': true } });
    check('暴露 · batch 403', r.status === 403, `got ${r.status}`);

    r = await post('/api/config', { web: { allow_remote_install: true } });
    check('暴露 · 整份嵌套 403', r.status === 403, `got ${r.status}`);

    r = await post('/api/config', { web: { port: 8081 } }, { Authorization: 'Bearer ' + TOKEN });
    check('暴露 · 普通配置写入不误伤（已登录 200）', r.status === 200, `got ${r.status}`);

    // ── 3. 伪造 Host / 转发头：单向收紧 ──
    setHost('127.0.0.1');

    r = await post('/api/config', { key: 'web.allow_plugins', value: true }, { Host: 'example.com' });
    check('伪造 Host 403', r.status === 403, `got ${r.status}`);

    r = await post('/api/config', { key: 'web.allow_plugins', value: true }, { 'X-Forwarded-For': '8.8.8.8' });
    check('X-Forwarded-For 403', r.status === 403, `got ${r.status}`);

    r = await post('/api/config', { key: 'web.allow_plugins', value: true }, { 'CF-Connecting-IP': '8.8.8.8' });
    check('CF-Connecting-IP 403', r.status === 403, `got ${r.status}`);

    r = await post('/api/config', { key: 'web.allow_plugins', value: true }, { Forwarded: 'for=8.8.8.8' });
    check('Forwarded 403', r.status === 403, `got ${r.status}`);

    // ── 4. trust_proxy 显性声明：一律收紧 ──
    mem.set('web.trust_proxy', true);
    r = await post('/api/config', { key: 'web.allow_plugins', value: true });
    check('trust_proxy=true 时本机也 403', r.status === 403, `got ${r.status}`);
    check('trust_proxy=true 时 requireLogin() 强制为 true', webService.requireLogin() === true);
    mem.set('web.trust_proxy', false);

    r = await post('/api/config', { key: 'web.allow_plugins', value: false });
    check('恢复 trust_proxy=false 后本机放行', r.status === 200, `got ${r.status}`);

    // ── 5. 收尾 ──
    config.getConfig = origGetConfig;
    config.setConfig = origSetConfig;
    config.setConfigs = origSetConfigs;
    try { webService.stopWeb(); } catch (e) { /* ignore */ }

    console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('测试异常:', e);
    process.exit(1);
});
