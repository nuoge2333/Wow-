#!/usr/bin/env node
/**
 * 指令二 端到端测试：备用钥匙（密码登录）全链路
 * ----------------------------------------------------------------
 * 起真实服务（127.0.0.1:18102），走完整流程：
 *   邮箱为空拒绝 → 获取验证码 → 设置密码 → 密码登录 → 连错限流 →
 *   验证码登录仍然可用（双通道）。
 *
 * 隔离性：config 读写全部打桩到内存 Map，不碰 core/wow.yaml。
 * 运行：cd core && node test/password_auth_e2e.test.js
 */

process.env.WOW_WEB_AUTH_TOKEN = 'password-auth-e2e-secret';

const path = require('path');
const http = require('http');

const SRC = path.join(__dirname, '../src');
const PORT = 18102;
const ADMIN = 'admin@example.com';
const PASSWORD = 'Passw0rd123';

let pass = 0, fail = 0;

function check(title, cond, extra = '') {
    if (cond) { console.log(`  ✅ ${title}`); pass++; }
    else { console.log(`  ❌ ${title}${extra ? '  → ' + extra : ''}`); fail++; }
}

function request(method, pathname, body) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? '' : JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1',
            port: PORT,
            path: pathname,
            method,
            headers: Object.assign(
                { 'Content-Type': 'application/json' },
                data ? { 'Content-Length': Buffer.byteLength(data) } : {}
            )
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

    const mem = new Map([
        ['web.require_login', false],
        ['web.dev_mode', true],          // 未配 SMTP 时回显验证码，测试才能拿到
        ['mail.whitelist', []]
    ]);

    const origGetConfig = config.getConfig;
    const origSetConfig = config.setConfig;
    const origSetConfigs = config.setConfigs;

    config.getConfig = (key, def) => (mem.has(key) ? mem.get(key) : def);
    config.setConfig = (key, value) => { mem.set(key, value); };
    config.setConfigs = (obj) => {
        Object.keys(obj || {}).forEach((k) => mem.set(k, obj[k]));
        return Object.keys(obj || {}).length;
    };

    await webService.startWeb({ port: PORT, host: '127.0.0.1' });
    await new Promise((r) => setTimeout(r, 800));

    console.log('\n指令二：备用钥匙密码登录 E2E\n');

    // ── 1. 初始状态 ──
    let r = await request('GET', '/api/auth/config');
    check('auth/config 匿名可调', r.status === 200, `got ${r.status}`);
    check('初始未设密码', r.data && r.data.password_enabled === false, JSON.stringify(r.data));
    check('管理员邮箱未配置', r.data && r.data.email_configured === false, JSON.stringify(r.data));

    // ── 2. 邮箱为空时不允许设密码 ──
    r = await request('POST', '/api/auth/set-password',
        { email: ADMIN, code: '123456', password: PASSWORD });
    check('mail.admin_email 为空时拒绝设密码（400）', r.status === 400, `got ${r.status} ${r.text.slice(0, 80)}`);

    // ── 3. 配置管理员邮箱后，公开接口只回掩码 ──
    mem.set('mail.admin_email', ADMIN);
    r = await request('GET', '/api/auth/config');
    check('email_configured 变为 true', r.data && r.data.email_configured === true, JSON.stringify(r.data));
    check('email 已掩码，不回明文', r.data && r.data.email === 'a***@example.com', JSON.stringify(r.data));
    check('响应里不含管理员邮箱明文', !r.text.includes(ADMIN), r.text);

    // ── 4. 邮箱不匹配：400，且不消耗限流计数 ──
    for (let i = 0; i < 6; i++) {
        r = await request('POST', '/api/auth/set-password',
            { email: 'other@example.com', code: '123456', password: PASSWORD });
        if (r.status !== 400) break;
    }
    check('邮箱不匹配始终 400（400 不计数，不会被锁）', r.status === 400, `got ${r.status}`);

    // ── 5. 错误验证码 → 401 ──
    r = await request('POST', '/api/auth/set-password',
        { email: ADMIN, code: '000000', password: PASSWORD });
    check('验证码错误 401', r.status === 401, `got ${r.status} ${r.text.slice(0, 80)}`);

    // ── 6. 正确验证码 → 设密码成功并直接发 token ──
    r = await request('POST', '/api/auth/request-code', { email: ADMIN });
    check('获取验证码成功', r.status === 200 && !!r.data.devCode, `got ${r.status} ${r.text.slice(0, 80)}`);
    const code = r.data && r.data.devCode;

    r = await request('POST', '/api/auth/set-password', { email: ADMIN, code, password: PASSWORD });
    check('验证码正确 → 设置密码成功', r.status === 200 && r.data.success === true, `got ${r.status} ${r.text.slice(0, 120)}`);
    check('设置成功同时返回 JWT', !!(r.data && r.data.token), JSON.stringify(r.data));

    r = await request('GET', '/api/auth/config');
    check('auth/config 显示 password_enabled=true', r.data && r.data.password_enabled === true, JSON.stringify(r.data));

    // ── 7. 密码登录成功 ──
    r = await request('POST', '/api/auth/login-password', { password: PASSWORD });
    check('正确密码登录成功并发 token', r.status === 200 && !!r.data.token, `got ${r.status} ${r.text.slice(0, 80)}`);

    // ── 8. 密码错误 → 401，连续 5 次后锁 15 分钟 ──
    r = await request('POST', '/api/auth/login-password', { password: 'WrongPass000' });
    check('第 1 次密码错误 401', r.status === 401, `got ${r.status}`);

    for (let i = 0; i < 4; i++) {
        r = await request('POST', '/api/auth/login-password', { password: 'WrongPass000' });
    }
    check('第 5 次密码错误仍 401', r.status === 401, `got ${r.status}`);

    r = await request('POST', '/api/auth/login-password', { password: 'WrongPass000' });
    check('第 6 次触发限流 429', r.status === 429, `got ${r.status}`);
    check('429 带 retry_after_seconds', !!(r.data && r.data.retry_after_seconds > 0), JSON.stringify(r.data));

    r = await request('POST', '/api/auth/login-password', { password: PASSWORD });
    check('锁定期内正确密码也 429', r.status === 429, `got ${r.status}`);

    // ── 9. 双通道：验证码登录不受密码通道锁定影响 ──
    r = await request('POST', '/api/auth/request-code', { email: ADMIN });
    const code2 = r.data && r.data.devCode;
    check('可再次获取验证码（未被密码通道锁死）', !!code2, r.text.slice(0, 80));

    r = await request('POST', '/api/auth/login', { email: ADMIN, code: code2 });
    check('设密码后验证码登录仍然可用', r.status === 200 && !!r.data.token, `got ${r.status} ${r.text.slice(0, 80)}`);

    // ── 10. 收尾 ──
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
