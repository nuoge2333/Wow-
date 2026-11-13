/**
 * Web 面板安全模块（指令一 + 指令二共用）
 *
 * 只放**零副作用的纯逻辑**：不 require web_service（避免循环依赖）、
 * 不 require config（不读盘）、不起定时器、不注册路由。所有与运行时状态
 * 相关的东西（activeHost / tunnelHandle / 验证码表 / 签发 token）都由
 * web_service.js 通过 deps 注入，本模块只做判定与计算。
 *
 * 两件事：
 *   1. 危险开关拦截：非本机请求改 web.allow_* 一律 403（三个写入口统一）。
 *   2. 登录限流：按「IP + 通道」分桶，连续 401 失败 5 次锁 15 分钟。
 */

'use strict';

const { listFields } = require('./config_schema');

// ==================== 危险开关 ====================

/** 指令一指定的三个危险开关（显式常量，防 schema 漏标 danger 导致静默漏防） */
const EXPECTED_DANGER_KEYS = [
    'web.allow_scheme_ops',
    'web.allow_remote_install',
    'web.allow_plugins'
];

/**
 * 从 schema 派生：以后新增同类开关（web.allow_* 且 danger:true）会自动纳入。
 * 与显式常量双保险：常量里若有人误删 danger 标记，加载时直接 fail-fast，
 * 绝不让危险开关以「看起来普通」的姿态漏出防线。
 */
const DERIVED_DANGER_KEYS = listFields()
    .filter(f => f.danger === true && f.key.startsWith('web.allow_'))
    .map(f => f.key);

for (const k of EXPECTED_DANGER_KEYS) {
    if (!DERIVED_DANGER_KEYS.includes(k)) {
        throw new Error(`[web_security] 危险开关 ${k} 缺少 danger:true 标记，拒绝加载（防止静默漏防）`);
    }
}

const DANGER_KEYS = Array.from(new Set([
    ...EXPECTED_DANGER_KEYS,
    ...DERIVED_DANGER_KEYS
])).sort();

/** 逐字用于 403 响应与 set.html 红字兜底判定，测试也会精确断言 */
const DENY_MSG = '出于安全考虑，危险开关只能在 127.0.0.1 下修改';

// ==================== 回环 / 暴露判定 ====================

/** 与 web_service.js 的 isExposedHost 同口径 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

/** 出现这些头说明请求经过反向代理 / CDN，一律按「暴露」收紧，绝不用于放行 */
const FORWARDED_HEADERS = [
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'forwarded',
    'x-real-ip',
    'cf-connecting-ip',
    'cf-ray'
];

/**
 * socket.remoteAddress 归一到回环集合。
 * 常见形态：127.0.0.1 / ::1 / ::ffff:127.0.0.1 / 0:0:0:0:0:0:0:1。
 * 127.0.0.0/8 整个段都是本机回环，一并认下（不会放宽到外部地址）。
 */
function isLoopbackIp(addr) {
    let a = String(addr || '').trim().toLowerCase();
    if (a.startsWith('::ffff:')) a = a.slice(7);
    if (a.startsWith('127.')) return true;
    return a === '::1' || a === '0:0:0:0:0:0:0:1' || a === 'localhost';
}

/** Host 头归一：去端口、去 IPv6 方括号、去尾点、小写 */
function normalizeHost(raw) {
    let h = String(raw || '').trim().toLowerCase();
    if (!h) return '';
    if (h.startsWith('[')) {
        const i = h.indexOf(']');
        h = i > 0 ? h.slice(1, i) : h;
    } else {
        // 去掉 :端口，但别误伤不带方括号的 IPv6（含多个冒号）
        const colonCount = (h.match(/:/g) || []).length;
        if (colonCount === 1) {
            const i = h.lastIndexOf(':');
            if (i > 0 && /^\d+$/.test(h.slice(i + 1))) h = h.slice(0, i);
        }
    }
    return h.replace(/\.$/, '');
}

/** 空 Host / 缺失 Host 一律返回 false（不放宽） */
function isLoopbackHost(raw) {
    const h = normalizeHost(raw);
    return !!h && LOOPBACK_HOSTS.has(h);
}

function isExposed(host) {
    const h = normalizeHost(host);
    if (!h) return false;   // 未绑定不算暴露（与既有 isExposedHost 一致）
    return !LOOPBACK_HOSTS.has(h);
}

function hasForwardedHeaders(headers) {
    if (!headers) return false;
    return FORWARDED_HEADERS.some(h => !!headers[h]);
}

/**
 * 「是否可信为本机请求」——用户选定的「两者取最严」。
 *
 * 必须**全部为真**才返回 true：
 *   - socket.remoteAddress 是回环
 *   - 没有隧道（含 tunnelPending 建立中窗口）
 *   - 管理员没有声明 web.trust_proxy
 *   - 实际绑定地址与配置绑定地址都不是对外暴露
 * 再叠加**单向收紧**项（出现即锁死，绝不会因为「看起来回环」而放宽）：
 *   - Host 头不是回环 / 缺失
 *   - 出现任一转发头（反向代理、CDN）
 *
 * 注意：X-Forwarded-For 完全不可信（无 trust proxy），只用于收紧，
 * 绝不据此放行，也绝不 app.set('trust proxy', true)。
 *
 * @param {object} req Express 请求
 * @param {object} ctx { activeHost, cfgHost, tunnelActive, trustProxy }
 */
function isLocalRequest(req, ctx = {}) {
    const socket = req && req.socket;
    const headers = (req && req.headers) || {};

    // --- 出现即锁死（单向收紧）---
    if (hasForwardedHeaders(headers)) return false;
    if (!isLoopbackHost(headers.host)) return false;

    // --- 必须全部为真 ---
    if (!isLoopbackIp(socket && socket.remoteAddress)) return false;
    if (ctx.tunnelActive) return false;
    if (ctx.trustProxy) return false;
    if (isExposed(ctx.activeHost) || isExposed(ctx.cfgHost)) return false;

    return true;
}

// ==================== 配置写入键提取 ====================

/**
 * 从三种写入载荷里提取「准备写入的点号键」：
 *   1. 单键：{ key: 'web.allow_plugins', value: true }
 *   2. 批量：{ patch: { 'web.port': 8080, web: {...} } } 或直接扁平对象
 *   3. 整份嵌套对象（原始 JSON 模式）：{ server: {...}, web: {...} }
 *
 * 注意：web_service.js 的 flattenConfigPatch 会跳过顶层 patch/key/value，
 * 因此单键载荷**必须显式取 body.key**，否则会静默漏拦（这正是最危险的入口）。
 *
 * @param {object} body req.body
 * @param {(obj:object)=>object} flatten 注入的 flattenConfigPatch
 * @returns {string[]}
 */
function extractWriteKeys(body, flatten) {
    const b = (body && typeof body === 'object') ? body : {};
    if (typeof b.key === 'string' && b.key.trim()) return [b.key.trim()];

    const src = (b.patch && typeof b.patch === 'object') ? b.patch : b;
    if (typeof flatten === 'function') {
        try { return Object.keys(flatten(src) || {}); }
        catch (e) { return Object.keys(src || {}); }
    }
    return Object.keys(src || {});
}

/**
 * Express 中间件工厂：拦截非本机请求对危险开关的写入。
 * 命中即拦（「出现即拦」，不比较值，避免 coerce / 类型归一化带来的绕过面）。
 *
 * @param {object} deps { ctx: ()=>object, flatten: (obj)=>object }
 */
function guardDangerKeys(deps = {}) {
    const getCtx = deps.ctx || (() => ({}));
    const flatten = deps.flatten;

    return function dangerGuard(req, res, next) {
        try {
            if (!req || req.method !== 'POST') return next();
            const p = req.path || '';
            if (p !== '/api/config' && p !== '/api/config/batch') return next();

            const keys = extractWriteKeys(req.body, flatten);
            const hit = keys.filter(k => DANGER_KEYS.includes(k));
            if (!hit.length) return next();

            // 注意：这里**不吞** getCtx() 的异常。上下文取不到本身就是危险信号，
            // 必须让它冒泡到外层 catch 统一收紧；若在此 fallback 成 {} ，
            // isLocalRequest 反而会因为「没有任何暴露信号」误判为本机而放行。
            const ctx = getCtx() || {};
            if (isLocalRequest(req, ctx)) return next();

            return res.status(403).json({ success: false, error: DENY_MSG, keys: hit });
        } catch (e) {
            // 判定异常一律按「非本机」收紧，绝不 fail-open
            return res.status(403).json({ success: false, error: DENY_MSG });
        }
    };
}

// ==================== 登录限流 ====================

const DEFAULT_MAX_FAILS = 5;
const DEFAULT_LOCK_MS = 15 * 60 * 1000;   // 15 分钟

/**
 * 按「IP + 通道」分桶的失败计数器。
 *
 * 分桶理由：隧道 / 反代下所有请求都来自同一个 127.0.0.1，若全通道共用一个
 * 桶，攻击者爆破密码通道会把管理员的验证码通道一起锁死（自我 DoS）。
 * noteFailure 由调用方**仅在凭据校验失败（401）时**调用；400 / 403 / 429
 * 不计数，否则白名单拒绝等正常错误也会把人锁住。
 */
function createRateLimiter(opts = {}) {
    const maxFails = opts.maxFails || DEFAULT_MAX_FAILS;
    const lockMs = opts.lockMs || DEFAULT_LOCK_MS;
    const buckets = new Map();   // 'channel|ip' -> { fails, lockedUntil }

    const keyOf = (ip, channel) => `${channel || 'default'}|${String(ip || '?')}`;

    function isLocked(ip, channel) {
        const k = keyOf(ip, channel);
        const e = buckets.get(k);
        if (!e) return { locked: false, retryAfter: 0 };
        if (e.lockedUntil && Date.now() < e.lockedUntil) {
            return { locked: true, retryAfter: Math.ceil((e.lockedUntil - Date.now()) / 1000) };
        }
        if (e.lockedUntil) buckets.delete(k);   // 锁已过期，自动解封
        return { locked: false, retryAfter: 0 };
    }

    function noteFailure(ip, channel) {
        const k = keyOf(ip, channel);
        const e = buckets.get(k) || { fails: 0, lockedUntil: 0 };
        e.fails += 1;
        if (e.fails >= maxFails) {
            e.lockedUntil = Date.now() + lockMs;
            e.fails = 0;
        }
        buckets.set(k, e);
        return isLocked(ip, channel);
    }

    function noteSuccess(ip, channel) {
        buckets.delete(keyOf(ip, channel));
    }

    function reset(ip, channel) {
        if (ip === undefined && channel === undefined) {
            buckets.clear();
            return;
        }
        buckets.delete(keyOf(ip, channel));
    }

    /** 供测试 / 运维查看，不影响判定 */
    function stats() {
        const out = [];
        for (const [k, e] of buckets) out.push({ key: k, fails: e.fails, lockedUntil: e.lockedUntil });
        return out;
    }

    return {
        isLocked, noteFailure, noteSuccess, reset, stats,
        maxFails, lockMs
    };
}

/** 从请求里取限流用的 IP（只信 socket，不信任何转发头） */
function clientIp(req) {
    try { return (req && req.socket && req.socket.remoteAddress) || '?'; }
    catch (e) { return '?'; }
}

// ==================== 邮箱掩码 ====================

/**
 * 登录前公开的 /api/auth/config 不能回管理员邮箱明文，
 * 但又要让 set.html 能提示「验证码会发到哪个邮箱」，故给掩码。
 *   admin@example.com -> a***@example.com
 *   a@b.com           -> a***@b.com
 */
function maskEmail(email) {
    const s = String(email || '').trim();
    if (!s) return '';
    const at = s.indexOf('@');
    if (at < 0) return '***';
    const local = s.slice(0, at);
    return (local ? local[0] : '') + '***' + s.slice(at);
}

module.exports = {
    EXPECTED_DANGER_KEYS,
    DERIVED_DANGER_KEYS,
    DANGER_KEYS,
    DENY_MSG,
    LOOPBACK_HOSTS,
    FORWARDED_HEADERS,
    isLoopbackIp,
    normalizeHost,
    isLoopbackHost,
    isExposed,
    hasForwardedHeaders,
    isLocalRequest,
    extractWriteKeys,
    guardDangerKeys,
    createRateLimiter,
    clientIp,
    maskEmail,
    DEFAULT_MAX_FAILS,
    DEFAULT_LOCK_MS
};
