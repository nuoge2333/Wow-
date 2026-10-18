/**
 * Web 登录邮箱白名单 端到端测试（V3.5.8）
 *
 * 真实起 Express 服务、真打 HTTP 接口，验证：
 *   - 名单外邮箱：request-code 返回 403，且**不生成验证码**（拿验证码去 login 也进不去）
 *   - 名单内邮箱：request-code 通过（dev_mode 下回显验证码），可用该码 login 成功
 *   - 白名单为空：不限制（向后兼容）
 *   - login 阶段二次校验：即便手工塞了验证码，名单外仍拒绝换 token
 *
 * 注意：config.getConfig 被打桩，绝不写 core/wow.yaml（该文件是产品配置）。
 *
 * 运行：cd core && node test/mail_whitelist_e2e.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const assert = require('assert');

// 固定 JWT 密钥，避免 startWeb 生成并落盘 web.auth_token
process.env.WOW_WEB_AUTH_TOKEN = 'test_secret_for_mail_whitelist_e2e';
process.env.NODE_ENV = 'test';

const config = require('../src/config');

// ── 打桩配置（内存态，不落盘） ───────────────────
const cfgStore = {
    'web.port': 18099,
    'web.host': '127.0.0.1',
    'web.theme': 'default',
    'web.dev_mode': true,          // 便于拿到 devCode 做正向验证
    'web.session_timeout': 3600,
    'web.auth_password': null,
    'web.auth_token': 'test_secret_for_mail_whitelist_e2e',
    'web.cors_origins': [],
    'mail.smtp': {},               // 未配 SMTP → 走 dev_mode 分支
    'mail.whitelist': [],
    'server.type': 'vanilla'
};
const origGetConfig = config.getConfig;
const origSetConfig = config.setConfig;
config.getConfig = (k, d = null) => (k in cfgStore ? cfgStore[k] : d);
config.setConfig = (k, v) => { cfgStore[k] = v; };

const PORT = 18099;
const HOST = '127.0.0.1';

let passed = 0, failed = 0;
async function check(title, fn) {
    try { await fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

function post(pathname, body) {
    return new Promise((resolve, reject) => {
        const data = Buffer.from(JSON.stringify(body || {}));
        const req = http.request({
            host: HOST, port: PORT, path: pathname, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        }, (res) => {
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', c => buf += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (e) { /* 非 JSON */ }
                resolve({ status: res.statusCode, body: json, raw: buf });
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    console.log('\nWeb 登录邮箱白名单 端到端测试 (V3.5.8)\n');

    const webservice = require('../src/web_service');
    webservice.startWeb({ port: PORT, host: HOST });

    // 等服务真正起来（轮询，不用 sleep 猜）
    let ready = false;
    for (let i = 0; i < 100; i++) {
        const ok = await new Promise((resolve) => {
            const r = http.get({ host: HOST, port: PORT, path: '/api/auth/request-code', timeout: 300 }, () => resolve(true));
            r.on('error', () => resolve(false));
            r.on('timeout', () => { r.destroy(); resolve(false); });
        });
        if (ok) { ready = true; break; }
        await new Promise(r => setTimeout(r, 50));
    }
    if (!ready) {
        console.log('  ❌ Web 服务未能启动，测试中止');
        config.getConfig = origGetConfig;
        config.setConfig = origSetConfig;
        process.exit(1);
    }

    // ─────────────────────────────────────────
    console.log('— 白名单为空：不限制（向后兼容）—');
    cfgStore['mail.whitelist'] = [];

    let insideCode = null;
    await check('1 任意邮箱都能请求验证码（dev_mode 回显）', async () => {
        const r = await post('/api/auth/request-code', { email: 'anyone@anywhere.com' });
        assert.strictEqual(r.status, 200, `期望 200，实际 ${r.status}: ${r.raw}`);
        assert.strictEqual(r.body.success, true);
        assert.ok(r.body.devCode, '应回显 devCode');
        insideCode = r.body.devCode;
    });

    await check('2 可以用该验证码登录成功', async () => {
        const r = await post('/api/auth/login', { email: 'anyone@anywhere.com', code: insideCode });
        assert.strictEqual(r.status, 200, `期望 200，实际 ${r.status}: ${r.raw}`);
        assert.ok(r.body.token, '应返回 token');
    });

    // ─────────────────────────────────────────
    console.log('— 白名单生效：只有名单内可登录 —');
    cfgStore['mail.whitelist'] = ['Admin@Example.com'];

    await check('3 名单内邮箱（大小写不同）可请求验证码', async () => {
        const r = await post('/api/auth/request-code', { email: 'admin@example.com' });
        assert.strictEqual(r.status, 200, `期望 200，实际 ${r.status}: ${r.raw}`);
        assert.ok(r.body.devCode, '应回显 devCode');
    });

    await check('4 名单内邮箱可登录成功', async () => {
        const r0 = await post('/api/auth/request-code', { email: 'admin@example.com' });
        const r = await post('/api/auth/login', { email: 'admin@example.com', code: r0.body.devCode });
        assert.strictEqual(r.status, 200, `期望 200，实际 ${r.status}: ${r.raw}`);
        assert.ok(r.body.token);
    });

    await check('5 名单外邮箱请求验证码 → 403', async () => {
        const r = await post('/api/auth/request-code', { email: 'hacker@evil.com' });
        assert.strictEqual(r.status, 403, `期望 403，实际 ${r.status}: ${r.raw}`);
        assert.strictEqual(r.body.success, false);
        assert.ok(/无权登录/.test(r.body.error), `文案不符: ${r.body.error}`);
    });

    await check('6 被拒时**不生成验证码**（响应里没有 devCode）', async () => {
        const r = await post('/api/auth/request-code', { email: 'hacker@evil.com' });
        assert.strictEqual(r.body.devCode, undefined, `不应回显验证码: ${r.raw}`);
    });

    await check('7 名单外邮箱拿不到码就无法登录', async () => {
        // 先试着请求（预期 403），再用空码登录
        await post('/api/auth/request-code', { email: 'hacker@evil.com' });
        const r = await post('/api/auth/login', { email: 'hacker@evil.com', code: '123456' });
        assert.notStrictEqual(r.status, 200, `不应登录成功: ${r.raw}`);
    });

    await check('8 名单内邮箱此前拿到的验证码，可正常登录', async () => {
        const r0 = await post('/api/auth/request-code', { email: 'ADMIN@EXAMPLE.COM' });
        assert.strictEqual(r0.status, 200);
        const r = await post('/api/auth/login', { email: 'ADMIN@EXAMPLE.COM', code: r0.body.devCode });
        assert.strictEqual(r.status, 200, `期望 200，实际 ${r.status}: ${r.raw}`);
        assert.ok(r.body.token);
    });

    // ─────────────────────────────────────────
    console.log('— "*" 通配放开 —');
    cfgStore['mail.whitelist'] = ['*'];

    await check('9 通配时任意邮箱可请求验证码', async () => {
        const r = await post('/api/auth/request-code', { email: 'whoever@some.domain' });
        assert.strictEqual(r.status, 200, `期望 200，实际 ${r.status}: ${r.raw}`);
    });

    // ─────────────────────────────────────────
    console.log('— login 阶段二次校验（防时序漏洞）—');
    // 场景：白名单是后配的，但此前已发出过验证码 —— login 必须再拦一次
    cfgStore['mail.whitelist'] = ['admin@example.com'];
    // 先放开白名单拿一个码
    cfgStore['mail.whitelist'] = [];
    const issued = await post('/api/auth/request-code', { email: 'late@blocked.com' });
    const lateCode = issued.body && issued.body.devCode;
    // 再收紧白名单
    cfgStore['mail.whitelist'] = ['admin@example.com'];

    await check('10 白名单收紧后，旧验证码也无法登录（login 二次校验）', async () => {
        assert.ok(lateCode, '前置条件：应先拿到验证码');
        const r = await post('/api/auth/login', { email: 'late@blocked.com', code: lateCode });
        assert.strictEqual(r.status, 403, `期望 403，实际 ${r.status}: ${r.raw}`);
        assert.ok(/无权登录/.test(r.body.error), `文案不符: ${r.body.error}`);
    });

    // ─────────────────────────────────────────
    console.log('— 边界：非法邮箱 / 空邮箱 —');
    cfgStore['mail.whitelist'] = ['admin@example.com'];

    await check('11 非法邮箱格式 → 400（早于白名单校验）', async () => {
        const r = await post('/api/auth/request-code', { email: 'not-an-email' });
        assert.strictEqual(r.status, 400, `期望 400，实际 ${r.status}`);
    });

    await check('12 缺失 email → 400', async () => {
        const r = await post('/api/auth/request-code', {});
        assert.strictEqual(r.status, 400, `期望 400，实际 ${r.status}`);
    });

    // ─────────────────────────────────────────
    webservice.stopWeb();
    config.getConfig = origGetConfig;
    config.setConfig = origSetConfig;

    console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
    console.error('测试异常:', e);
    config.getConfig = origGetConfig;
    config.setConfig = origSetConfig;
    process.exit(1);
});
