#!/usr/bin/env node
/**
 * 指令一 / 指令二 静态契约测试（不占端口、不启服务）
 * ----------------------------------------------------------------
 * 这里只做「源码里必须长这样」的断言，速度快、失败信息直接指向文件。
 * 行为验证在 danger_guard_e2e.test.js 与 password_auth_e2e.test.js。
 *
 * 运行：cd core && node test/web_security_static.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const read = (p) => fs.readFileSync(p, 'utf8');
const srcOf = (f) => read(path.join(SRC, f));
const webOf = (f) => read(path.join(ROOT, 'web', f));

const DANGER_KEYS = ['web.allow_plugins', 'web.allow_remote_install', 'web.allow_scheme_ops'];
const DENY_MSG = '出于安全考虑，危险开关只能在 127.0.0.1 下修改';
const LOCK_TEXT = '⚠️ 危险开关已被锁定。如需开启，请在服务器本机（127.0.0.1）访问 Web 面板修改，或使用 CLI 命令 wow config wow ...';

const security = require(path.join(SRC, 'web_security'));

console.log('\n[1] 危险开关集合');
check('恰好三个 web.allow_*，且已排序', () => {
    assert.deepStrictEqual(security.DANGER_KEYS.slice().sort(), DANGER_KEYS, '集合不符：' + security.DANGER_KEYS.join(','));
});
check('显式常量与 schema 派生结果一致（防止新增开关漏防）', () => {
    assert.deepStrictEqual(
        security.EXPECTED_DANGER_KEYS.slice().sort(),
        security.DERIVED_DANGER_KEYS.slice().sort(),
        'schema 里的 danger 标记与显式常量不一致'
    );
});

console.log('\n[2] 后端接线');
check('403 文案逐字一致', () => {
    assert.strictEqual(security.DENY_MSG, DENY_MSG);
});
check('guardDangerKeys 独立注册，且位于认证包装层之前', () => {
    const s = srcOf('web_service.js');
    const g = s.indexOf('security.guardDangerKeys(');
    const w = s.indexOf('if (!requireLogin()) return next();');
    assert.ok(g > 0, '未注册 guardDangerKeys');
    assert.ok(w > 0, '未找到认证包装层');
    assert.ok(g < w, '守卫必须在包装层之前注册，否则未登录会被 401 抢先');
});
check('认证包装层与 authMiddleware 函数体保持原样', () => {
    const s = srcOf('web_service.js');
    assert.ok(/app\.use\(\(req, res, next\) => \{\s*if \(!requireLogin\(\)\) return next\(\);/.test(s), '包装层被改');
    assert.ok(/authHeader\.startsWith\('Bearer '\)/.test(s), 'Bearer 校验被破坏');
});
check('publicPaths 含三个登录前接口', () => {
    const s = srcOf('web_service.js');
    const m = s.match(/const publicPaths = \[([^\]]+)\]/);
    assert.ok(m, '未找到 publicPaths');
    for (const p of ['/api/auth/config', '/api/auth/login-password', '/api/auth/set-password']) {
        assert.ok(m[1].includes(`'${p}'`), `${p} 必须在 publicPaths 内`);
    }
});
check('限流默认 5 次 / 15 分钟', () => {
    assert.strictEqual(security.DEFAULT_MAX_FAILS, 5);
    assert.strictEqual(security.DEFAULT_LOCK_MS, 15 * 60 * 1000);
});
check('验证码使用 CSPRNG，不再用 Math.random', () => {
    const s = srcOf('web_service.js');
    assert.ok(/crypto\.randomInt\(100000, 1000000\)/.test(s), '未找到 crypto.randomInt 生成验证码');
    const fn = s.slice(s.indexOf('function generateAndSendCode'), s.indexOf('function generateAndSendCode') + 1800);
    assert.ok(!/Math\.random\(/.test(fn), 'generateAndSendCode 仍在使用 Math.random');
});
check('set-password 真正校验验证码（不是只看 email）', () => {
    const s = srcOf('web_service.js');
    const fn = s.slice(s.indexOf("app.post('/api/auth/set-password'"));
    assert.ok(/verificationCodes\.get\(admin\)/.test(fn.slice(0, 4000)), 'set-password 未校验验证码');
});
check('config.js 有 web.trust_proxy 默认值', () => {
    assert.ok(/trust_proxy:\s*false/.test(srcOf('config.js')), '缺少 web.trust_proxy');
});
check('config_schema.js 有 web.trust_proxy 字段', () => {
    assert.ok(/key:\s*'web\.trust_proxy'/.test(srcOf('config_schema.js')), '缺少 web.trust_proxy 字段');
});

console.log('\n[3] 前端：危险开关物理隐藏');
check('set.html 有本机判定与隐藏键集合', () => {
    const h = webOf('set.html');
    assert.ok(/const isLocalPanel = LOOPBACK_HOSTS\.has\(location\.hostname\)/.test(h), '缺少 isLocalPanel');
    assert.ok(/const HIDDEN_KEYS = new Set\(\['web\.auth_password'\]\)/.test(h), '缺少 HIDDEN_KEYS');
    assert.ok(/for \(const key of HIDDEN_KEYS\)/.test(h), '缺少 stripHiddenDeep 的遍历逻辑');
});
check('set.html 渲染时过滤隐藏键（不是 CSS 隐藏）', () => {
    const h = webOf('set.html');
    assert.ok(/cfgSchema\.filter\(f => !HIDDEN_KEYS\.has\(f\.key\) && !f\.advanced/.test(h), '表单模式未过滤');
    assert.ok(!/\.hidden-key\s*\{/.test(webOf('css/set.css')), '疑似用 CSS 类隐藏危险开关');
});
check('set.html 原始 JSON 两种模式都剔除隐藏键', () => {
    const h = webOf('set.html');
    assert.ok(/JSON\.stringify\(stripHiddenDeep\(raw\), null, 2\)/.test(h), '加载时未剔除');
    assert.ok(/config = stripHiddenDeep\(config\)/.test(h), '保存时未剔除');
});
check('set.html 含逐字红字文案', () => {
    assert.ok(webOf('set.html').includes(LOCK_TEXT), '红字文案不一致');
});
check('set.html 有独立「备用钥匙」卡片', () => {
    const h = webOf('set.html');
    assert.ok(h.includes('id="spare-key-card"'), '缺少卡片');
    assert.ok(h.includes('id="spare-email"') && h.includes('id="spare-password"'), '缺少输入项');
    assert.ok(/apiPost\('\/api\/auth\/set-password'/.test(h), '未调用 set-password');
    // 卡片必须在 details.advanced 之后，否则会打乱「首屏干净」的 DOM 顺序
    assert.ok(h.indexOf('id="spare-key-card"') > h.indexOf('<details class="advanced">'), '卡片位置不对');
});
check('set.html 无内联 <style> 块', () => {
    assert.ok(!/<style>/.test(webOf('set.html')), '出现内联样式块');
});
check('scheme.html 非本机不发 POST、直接给红字', () => {
    const h = webOf('scheme.html');
    assert.ok(/const isLocalPanel = LOOPBACK_HOSTS\.indexOf\(location\.hostname\) >= 0/.test(h), '缺少 isLocalPanel');
    assert.ok(h.includes(LOCK_TEXT), '缺少红字文案');
    assert.ok(/if \(!isLocalPanel\) \{[\s\S]{0,200}showToast\(DANGER_LOCKED_TEXT/.test(h), '非本机分支未拦截');
});

console.log('\n[4] 前端：密码登录双通道');
check('login.html 查询 auth/config 并按需显示 Tab', () => {
    const h = webOf('login.html');
    assert.ok(/fetch\('\/api\/auth\/config'/.test(h), '未查询 auth/config');
    assert.ok(/password_enabled === true/.test(h), '未按 password_enabled 判定');
    assert.ok(h.includes('id="login-tabs"') && h.includes('id="password-form"'), '缺少 Tab / 密码表单');
});
check('login.html 密码登录走 login-password 并保存 token', () => {
    const h = webOf('login.html');
    assert.ok(/fetch\('\/api\/auth\/login-password'/.test(h), '未调用 login-password');
    assert.ok(/sessionStorage\.setItem\('wow_token', data\.token\)/.test(h), '未保存 token');
    assert.ok(/retry_after_seconds/.test(h), '429 未处理');
});

console.log('\n[5] 样式与副本');
check('set.css 含新样式且集中在 #set-page 作用域', () => {
    const css = webOf('css/set.css');
    assert.ok(css.includes('.danger-locked'), '缺少 .danger-locked');
    assert.ok(css.includes('.spare-key-card'), '缺少 .spare-key-card');
    assert.ok(!/(^|[^.\w])(body|html)\s*\{/m.test(css), 'set.css 出现全局 body/html 规则');
});
check('web/ 与 themes/default/ 四份副本逐字节一致', () => {
    for (const f of ['set.html', 'login.html', 'scheme.html', 'css/set.css']) {
        const a = read(path.join(ROOT, 'web', f));
        const b = read(path.join(ROOT, 'themes/default', f));
        assert.strictEqual(a, b, `${f} 未同步到 themes/default`);
    }
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
if (fail) failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.err.message}`));
process.exit(fail ? 1 : 0);
