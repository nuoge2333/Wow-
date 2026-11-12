/**
 * web.require_login 认证模式测试（执行令配置项一）
 *
 * 启动真实 Web 服务，通过打桩 config.getConfig 即时切换配置，验证：
 *   - false：完全免登录（静态页 + /api/* 都放行）
 *   - true ：恢复强制登录（无 token → 401）
 *   - 公网自动强制登录：绑定/配置为 0.0.0.0 时忽略 false
 *   - /api/auth/mode 永远公开，前端据此决定是否跳登录页
 *
 * 运行：cd core && node test/auth_mode.test.js
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const assert = require('assert');

process.env.WOW_WEB_AUTH_TOKEN = 'auth-mode-test-secret';

const PORT = 18098;
const BASE = `http://127.0.0.1:${PORT}`;
const SRC = path.join(__dirname, '..', 'src');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}

async function req(url, opts = {}) {
    const r = await fetch(BASE + url, opts);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { status: r.status, data, text };
}

const webService = require(path.join(SRC, 'web_service.js'));
const config = require(path.join(SRC, 'config.js'));
const webSrc = fs.readFileSync(path.join(SRC, 'web_service.js'), 'utf8');

(async () => {
    console.log('\n═══ web.require_login 认证模式测试 ═══\n');

    console.log('— 静态结构 —');
    check('DEFAULT_CONFIG.web.require_login 默认 false', () => {
        assert.strictEqual(config.DEFAULT_CONFIG.web.require_login, false);
    });
    check('config_schema 暴露 web.require_login', () => {
        const s = fs.readFileSync(path.join(SRC, 'config_schema.js'), 'utf8');
        assert.ok(/web\.require_login/.test(s));
    });
    check('app.use 用包装层而不是改 authMiddleware 函数体', () => {
        assert.ok(/app\.use\(\(req, res, next\) => \{\s*if \(!requireLogin\(\)\) return next\(\);/.test(webSrc));
        const mw = webSrc.slice(webSrc.indexOf('function authMiddleware'), webSrc.indexOf('function authMiddleware') + 900);
        assert.ok(!/isLoginVerifyEnabled/.test(mw), 'authMiddleware 里不应有免登录分支');
        assert.ok(/authHeader\.startsWith\('Bearer '\)/.test(mw), 'Bearer 校验被破坏');
    });
    check('/api/auth/mode 路由存在且列入 publicPaths', () => {
        assert.ok(/app\.get\('\/api\/auth\/mode'/.test(webSrc));
        const m = webSrc.match(/const publicPaths = \[([^\]]+)\]/);
        assert.ok(m && m[1].includes('/api/auth/mode'));
    });
    check('前端 4 页都接入 wowAuthGuard', () => {
        const ROOT = path.join(__dirname, '..', '..');
        for (const p of ['index.html', 'file.html', 'dashboard.html', 'set.html']) {
            assert.ok(/wowAuthGuard\(\)/.test(fs.readFileSync(path.join(ROOT, 'web', p), 'utf8')), `${p} 未接入`);
        }
        assert.ok(fs.existsSync(path.join(ROOT, 'web/js/auth_guard.js')));
        assert.ok(fs.existsSync(path.join(ROOT, 'themes/default/js/auth_guard.js')));
    });

    // ── 真实 HTTP ──
    let mode = false;      // 打桩值
    let host = '127.0.0.1';
    const origGetConfig = config.getConfig;
    config.getConfig = function (key, def) {
        if (key === 'web.require_login') return mode;
        if (key === 'web.host') return host;
        return origGetConfig.call(this, key, def);
    };

    await webService.startWeb({ port: PORT, host: '127.0.0.1' });
    await new Promise(r => setTimeout(r, 700));

    console.log('\n— 免登录模式（require_login=false）—');
    mode = false; host = '127.0.0.1';
    let r = await req('/api/auth/mode');
    check('/api/auth/mode 返回 require_login:false', () => {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.require_login, false);
    });
    r = await req('/api/status');
    check('无 token 访问 /api/status 不再 401', () => {
        assert.notStrictEqual(r.status, 401, `实际 ${r.status}`);
    });
    r = await req('/set.html');
    check('无 token 打开静态页 /set.html 返回 200', () => {
        assert.strictEqual(r.status, 200);
    });

    console.log('\n— 强制登录模式（require_login=true）—');
    mode = true;
    r = await req('/api/auth/mode');
    check('/api/auth/mode 返回 require_login:true', () => {
        assert.strictEqual(r.data.require_login, true);
    });
    r = await req('/api/status');
    check('无 token 访问 /api/status → 401', () => {
        assert.strictEqual(r.status, 401);
    });
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ user: 'auth-mode' }, 'auth-mode-test-secret', { expiresIn: '1h' });
    r = await req('/api/status', { headers: { Authorization: 'Bearer ' + token } });
    check('带合法 token → 200', () => {
        assert.notStrictEqual(r.status, 401, `实际 ${r.status}`);
    });

    console.log('\n— 公网自动强制登录（忽略 false）—');
    mode = false; host = '0.0.0.0';
    r = await req('/api/auth/mode');
    check('配置 host=0.0.0.0 时 mode 强制为 true', () => {
        assert.strictEqual(r.data.require_login, true);
    });
    r = await req('/api/status');
    check('公网暴露时无 token → 401', () => {
        assert.strictEqual(r.status, 401);
    });

    config.getConfig = origGetConfig;
    try { webService.stopWeb(); } catch (e) { /* ignore */ }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed ? 1 : 0);
})().catch(e => {
    console.error('测试异常:', e);
    process.exit(1);
});
