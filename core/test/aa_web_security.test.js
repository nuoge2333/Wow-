/**
 * web_security.js 纯逻辑单测（指令一 + 指令二共用底座）
 *
 * 不占端口、不启服务、不起定时器，纯函数 + mock req/res 断言。
 * 文件名前缀 aa_ 保证在 run.js 的字典序里排最前，尽早暴露底座问题。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const security = require(path.join(SRC, 'web_security'));
const { flattenConfigPatch } = require(path.join(SRC, 'web_service'));

let passed = 0;
let failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}

/** 造一个最小 Express 请求 */
function mkReq(opts = {}) {
    return {
        method: opts.method || 'POST',
        path: opts.path || '/api/config',
        body: opts.body || {},
        headers: opts.headers || { host: '127.0.0.1:8080' },
        socket: { remoteAddress: opts.ip || '127.0.0.1' }
    };
}
/** 造一个记录响应的 mock res */
function mkRes() {
    const r = {
        statusCode: 200,
        payload: null,
        status(n) { r.statusCode = n; return r; },
        json(o) { r.payload = o; return r; }
    };
    return r;
}
const LOCAL_CTX = { activeHost: '127.0.0.1', cfgHost: '127.0.0.1', tunnelActive: false, trustProxy: false };

console.log('=== 危险开关集合 ===');
check('DANGER_KEYS 恰为三个 web.allow_* 且带 danger 标记', () => {
    const derived = security.DERIVED_DANGER_KEYS;
    assert.deepStrictEqual([...derived].sort(), [
        'web.allow_extensions', 'web.allow_remote_install', 'web.allow_scheme_ops'
    ]);
});
check('显式常量 EXPECTED 与派生集合完全一致（双保险）', () => {
    const a = [...security.EXPECTED_DANGER_KEYS].sort();
    const b = [...security.DERIVED_DANGER_KEYS].sort();
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual([...security.DANGER_KEYS].sort(), a);
});
check('模块加载时对漏标 danger 的开关 fail-fast（源码有 throw）', () => {
    const src = fs.readFileSync(path.join(SRC, 'web_security.js'), 'utf8');
    assert.ok(/拒绝加载（防止静默漏防）/.test(src), '缺少 fail-fast 抛错');
    assert.ok(/DERIVED_DANGER_KEYS\.includes\(k\)/.test(src), '未做派生比对');
});
check('403 文案逐字精确', () => {
    assert.strictEqual(security.DENY_MSG, '出于安全考虑，危险开关只能在 127.0.0.1 下修改');
});

console.log('=== 回环 / 暴露判定 ===');
check('isLoopbackIp 认 127.0.0.1 / ::1 / ::ffff: / 127.* 段', () => {
    for (const ip of ['127.0.0.1', '127.0.0.2', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) {
        assert.ok(security.isLoopbackIp(ip), `${ip} 应判回环`);
    }
});
check('isLoopbackIp 拒绝局域网 / 公网 / 空值', () => {
    for (const ip of ['192.168.1.5', '10.0.0.1', '8.8.8.8', '::ffff:192.168.1.5', '', null]) {
        assert.ok(!security.isLoopbackIp(ip), `${ip} 不应判回环`);
    }
});
check('normalizeHost 去端口 / 去 IPv6 方括号 / 去尾点', () => {
    assert.strictEqual(security.normalizeHost('127.0.0.1:8080'), '127.0.0.1');
    assert.strictEqual(security.normalizeHost('[::1]:8080'), '::1');
    assert.strictEqual(security.normalizeHost('LOCALHOST.'), 'localhost');
    assert.strictEqual(security.normalizeHost('Example.COM:443'), 'example.com');
});
check('isLoopbackHost 空 Host 不放宽', () => {
    assert.ok(security.isLoopbackHost('127.0.0.1:8080'));
    assert.ok(security.isLoopbackHost('localhost'));
    assert.ok(!security.isLoopbackHost(''));
    assert.ok(!security.isLoopbackHost('192.168.1.5:8080'));
    assert.ok(!security.isLoopbackHost('panel.example.com'));
});
check('isExposed 与既有 isExposedHost 同口径', () => {
    assert.ok(!security.isExposed('127.0.0.1'));
    assert.ok(!security.isExposed(''));
    assert.ok(security.isExposed('0.0.0.0'));
    assert.ok(security.isExposed('192.168.1.5'));
});
check('hasForwardedHeaders 覆盖常见代理头', () => {
    for (const h of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
        'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray']) {
        assert.ok(security.hasForwardedHeaders({ [h]: 'x' }), `${h} 未识别`);
    }
    assert.ok(!security.hasForwardedHeaders({ host: '127.0.0.1' }));
});

console.log('=== isLocalRequest（两者取最严）===');
check('本机：回环 socket + 回环 Host + 无暴露信号 → 放行', () => {
    assert.ok(security.isLocalRequest(mkReq(), LOCAL_CTX));
});
check('绑定地址 0.0.0.0 → 锁死（维度一：绑定暴露）', () => {
    assert.ok(!security.isLocalRequest(mkReq(), { ...LOCAL_CTX, activeHost: '0.0.0.0' }));
});
check('配置 web.host=局域网但实际绑回环 → 仍锁死（取最严）', () => {
    assert.ok(!security.isLocalRequest(mkReq(), { ...LOCAL_CTX, cfgHost: '192.168.1.5' }));
});
check('请求来源非回环 → 锁死（维度二：来源 IP）', () => {
    assert.ok(!security.isLocalRequest(mkReq({ ip: '203.0.113.9' }), LOCAL_CTX));
});
check('隧道建立中 / 已建立 → 锁死', () => {
    assert.ok(!security.isLocalRequest(mkReq(), { ...LOCAL_CTX, tunnelActive: true }));
});
check('web.trust_proxy=true → 锁死（反代显式声明位）', () => {
    assert.ok(!security.isLocalRequest(mkReq(), { ...LOCAL_CTX, trustProxy: true }));
});
check('Host 非回环 → 锁死（单向收紧）', () => {
    assert.ok(!security.isLocalRequest(mkReq({ headers: { host: 'panel.example.com' } }), LOCAL_CTX));
});
check('伪造 Host: 127.0.0.1 但带 X-Forwarded-For → 仍锁死', () => {
    assert.ok(!security.isLocalRequest(
        mkReq({ headers: { host: '127.0.0.1', 'x-forwarded-for': '1.2.3.4' } }), LOCAL_CTX));
});
check('Host 缺失（HTTP/1.0）→ 不放宽', () => {
    assert.ok(!security.isLocalRequest(mkReq({ headers: {} }), LOCAL_CTX));
});

console.log('=== 写入键提取（三种载荷）===');
check('单键 {key,value} 显式取 body.key（最危险入口不漏拦）', () => {
    assert.deepStrictEqual(
        security.extractWriteKeys({ key: 'web.allow_extensions', value: true }, flattenConfigPatch),
        ['web.allow_extensions']);
});
check('批量 {patch} 能提出嵌套键', () => {
    const keys = security.extractWriteKeys(
        { patch: { 'web.allow_scheme_ops': true, web: { port: 8080 } } }, flattenConfigPatch);
    assert.ok(keys.includes('web.allow_scheme_ops'));
    assert.ok(keys.includes('web.port'));
});
check('整份嵌套对象（原始 JSON 模式）能提出 allow_* 键', () => {
    const keys = security.extractWriteKeys(
        { server: { memory: '2G' }, web: { allow_remote_install: true } }, flattenConfigPatch);
    assert.ok(keys.includes('web.allow_remote_install'));
});
check('不含危险键的载荷返回普通键', () => {
    const keys = security.extractWriteKeys({ patch: { 'web.port': 8081 } }, flattenConfigPatch);
    assert.deepStrictEqual(keys, ['web.port']);
});

console.log('=== guardDangerKeys 中间件 ===');
const guard = security.guardDangerKeys({ ctx: () => LOCAL_CTX, flatten: flattenConfigPatch });
check('本机改危险开关 → next() 放行', () => {
    let next = false;
    const res = mkRes();
    guard(mkReq({ body: { key: 'web.allow_extensions', value: true } }), res, () => { next = true; });
    assert.ok(next, '本机不应拦截');
    assert.strictEqual(res.payload, null);
});
check('非本机（绑定 0.0.0.0）改危险开关 → 403 + 精确文案', () => {
    const g = security.guardDangerKeys({
        ctx: () => ({ ...LOCAL_CTX, activeHost: '0.0.0.0' }), flatten: flattenConfigPatch
    });
    let next = false;
    const res = mkRes();
    g(mkReq({ body: { key: 'web.allow_scheme_ops', value: true } }), res, () => { next = true; });
    assert.ok(!next, '不应放行');
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.payload.error, security.DENY_MSG);
    assert.ok(res.payload.keys.includes('web.allow_scheme_ops'));
});
check('/api/config/batch 载荷同样被拦', () => {
    const g = security.guardDangerKeys({
        ctx: () => ({ ...LOCAL_CTX, trustProxy: true }), flatten: flattenConfigPatch
    });
    const res = mkRes();
    g(mkReq({ path: '/api/config/batch', body: { patch: { 'web.allow_remote_install': true } } }), res, () => {});
    assert.strictEqual(res.statusCode, 403);
});
check('不含危险键的配置写入 → 放行（不误伤整份保存）', () => {
    let next = false;
    const res = mkRes();
    const g = security.guardDangerKeys({
        ctx: () => ({ ...LOCAL_CTX, activeHost: '0.0.0.0' }), flatten: flattenConfigPatch
    });
    g(mkReq({ body: { web: { port: 8081 }, server: { memory: '4G' } } }), res, () => { next = true; });
    assert.ok(next, '普通配置不应被拦');
    assert.strictEqual(res.payload, null);
});
check('非目标路径 / 非 POST 直接放行', () => {
    let n = 0;
    const g = security.guardDangerKeys({ ctx: () => LOCAL_CTX, flatten: flattenConfigPatch });
    g(mkReq({ path: '/api/status', body: { key: 'web.allow_extensions' } }), mkRes(), () => { n++; });
    g(mkReq({ method: 'GET', body: { key: 'web.allow_extensions' } }), mkRes(), () => { n++; });
    assert.strictEqual(n, 2);
});
check('ctx 抛异常时 fail-closed（收紧，不 fail-open）', () => {
    const g = security.guardDangerKeys({
        ctx: () => { throw new Error('ctx boom'); }, flatten: flattenConfigPatch
    });
    const res = mkRes();
    g(mkReq({ body: { key: 'web.allow_extensions' } }), res, () => {});
    assert.strictEqual(res.statusCode, 403);
});

console.log('=== createRateLimiter ===');
check('连续 5 次 401 失败 → 锁 15 分钟', () => {
    const lim = security.createRateLimiter();
    assert.strictEqual(lim.maxFails, 5);
    assert.strictEqual(lim.lockMs, 15 * 60 * 1000);
    for (let i = 0; i < 4; i++) {
        assert.ok(!lim.noteFailure('1.2.3.4', 'login-password').locked, `第 ${i + 1} 次不应锁`);
    }
    const r = lim.noteFailure('1.2.3.4', 'login-password');
    assert.ok(r.locked, '第 5 次应锁定');
    assert.ok(r.retryAfter > 0 && r.retryAfter <= 900);
});
check('锁定期内按通道隔离，其它通道不受影响', () => {
    const lim = security.createRateLimiter();
    for (let i = 0; i < 5; i++) lim.noteFailure('1.2.3.4', 'login-password');
    assert.ok(lim.isLocked('1.2.3.4', 'login-password').locked);
    assert.ok(!lim.isLocked('1.2.3.4', 'login').locked);
    assert.ok(!lim.isLocked('1.2.3.4', 'request-code').locked);
    assert.ok(!lim.isLocked('5.6.7.8', 'login-password').locked);
});
check('noteSuccess 清零该桶', () => {
    const lim = security.createRateLimiter();
    for (let i = 0; i < 4; i++) lim.noteFailure('1.2.3.4', 'login');
    lim.noteSuccess('1.2.3.4', 'login');
    for (let i = 0; i < 4; i++) assert.ok(!lim.noteFailure('1.2.3.4', 'login').locked);
});
check('锁过期后自动解封', () => {
    const lim = security.createRateLimiter({ lockMs: 10 });
    for (let i = 0; i < 5; i++) lim.noteFailure('1.2.3.4', 'login');
    assert.ok(lim.isLocked('1.2.3.4', 'login').locked);
    const origNow = Date.now;
    Date.now = () => origNow() + 1000;
    try { assert.ok(!lim.isLocked('1.2.3.4', 'login').locked); }
    finally { Date.now = origNow; }
});
check('reset() 支持清空全部与单桶', () => {
    const lim = security.createRateLimiter();
    lim.noteFailure('a', 'login');
    lim.reset('a', 'login');
    assert.ok(!lim.isLocked('a', 'login').locked);
    lim.noteFailure('b', 'login');
    lim.reset();
    assert.strictEqual(lim.stats().length, 0);
});

console.log('=== 辅助函数 ===');
check('maskEmail 保留首字符与域名，不回明文', () => {
    assert.strictEqual(security.maskEmail('admin@example.com'), 'a***@example.com');
    assert.strictEqual(security.maskEmail('a@b.com'), 'a***@b.com');
    assert.strictEqual(security.maskEmail(''), '');
    assert.strictEqual(security.maskEmail(null), '');
    assert.ok(!security.maskEmail('admin@example.com').includes('dmin'));
});
check('clientIp 只信 socket.remoteAddress', () => {
    const req = mkReq({ ip: '10.0.0.1', headers: { 'x-forwarded-for': '8.8.8.8' } });
    assert.strictEqual(security.clientIp(req), '10.0.0.1');
});
check('模块零副作用：不 require web_service / config / 不起定时器', () => {
    const src = fs.readFileSync(path.join(SRC, 'web_security.js'), 'utf8');
    assert.ok(!/require\(['"]\.\/web_service['"]\)/.test(src), '不应 require web_service（循环依赖）');
    assert.ok(!/require\(['"]\.\/config['"]\)/.test(src), '不应 require config（读盘副作用）');
    assert.ok(!/setInterval|setTimeout/.test(src), '不应起定时器');
});

console.log(`\n✅ 通过 ${passed} 项，失败 ${failed} 项\n`);
process.exit(failed ? 1 : 0);
