/**
 * cfproxy for wow~ —— Cloudflare Workers 版
 * ================================================================
 * 作用：把对 CurseForge API 的请求转发出去，并自动补上 x-api-key。
 *      这样客户端（wow~）就不需要在本地保存 API Key。
 *
 * 设计要点（都是踩过坑的地方）：
 *
 * 1. 透传式而非重写式
 *    Worker 不做任何路径改写，收到 /v1/mods/search 就转发到
 *    https://api.curseforge.com/v1/mods/search。
 *    这样 wow~ 的 cf_client.buildUrl() 不需要任何改动就能直接对接。
 *
 * 2. 多 Key 轮换 + 单 Key 熔断
 *    每次请求随机挑一个「健康」的 Key。如果某个 Key 返回 403（无效/被封）
 *    或 429（额度耗尽），把它标记为不健康，冷却一段时间后再试。
 *    关键点：**不能因为一个坏 Key 就让所有请求失败**。
 *
 * 3. 403 的语义要小心
 *    CurseForge 对「Key 无效」返回 403，响应体为空。但 403 也可能表示
 *    「作者禁止第三方分发」。前者是 Key 的问题（该换 Key），后者是资源的
 *    问题（换 Key 也没用）。区分方式：换 Key 重试一次，如果还是 403，
 *    说明是资源本身的限制，原样返回给客户端。
 *
 * 4. CORS
 *    浏览器里直接调 Worker 时需要。预检请求（OPTIONS）直接放行。
 *
 * 5. 不缓存
 *    Worker 层不做缓存。wow~ 客户端已有 24h 本地缓存，
 *    在这里再缓存一层会造成「两层缓存有效期不一致」的调试噩梦。
 *
 * 部署：Cloudflare 控制台 → Workers & Pages → 创建 → 在线编辑 → 粘贴本文件
 *      然后在 Settings → Variables 里加一个 Secret：CF_API_KEYS
 */

// ==================== 配置 ====================

const CF_API_BASE = 'https://api.curseforge.com';

// 单个 Key 被判定为不健康后的冷却时间（毫秒）
const KEY_COOLDOWN_MS = 10 * 60 * 1000;   // 10 分钟

// 单次请求最多尝试几个 Key（防止 N 个坏 Key 时把请求拖死）
const MAX_KEY_ATTEMPTS = 3;

// 上游超时（毫秒）。比客户端 5 秒略长一点，留出误差余量，
// 让客户端先超时并降级，而不是 Worker 先断。
const UPSTREAM_TIMEOUT_MS = 8000;

// ==================== Key 池状态 ====================
// 说明：Workers 的全局作用域在同一个 isolate 内是复用的，
// 所以这个 Map 能在一定范围内共享。但它有两条明确的局限：
//
//   1. **不是持久存储**：isolate 被回收后状态就丢了。可接受——丢了最多
//      是多试几次坏 Key，不影响正确性。
//   2. **不跨 isolate 共享**：Workers 会在不同边缘节点起多个 isolate，
//      各自的 keyState 互相独立。所以在 A 节点被标记的坏 Key，
//      到 B 节点还会被再试一次。
//
// 要真正全局共享需要 Durable Objects 或 KV，但代价是每次请求多一次
// 跨网络往返，对「只是转发一下」的代理来说不值得。当前的折中是：
// 单个请求内一定会把所有（未试过的）Key 试一遍，保证不会因为一个坏
// Key 而整体失败；跨请求的加速只是优化，不是正确性的前提。

const keyState = new Map();   // key -> { badUntil: number, lastStatus: number, reason: string }

function parseKeys(env) {
    const raw = (env && env.CF_API_KEYS) || '';
    // 支持逗号 / 分号 / 换行分隔，顺手去掉首尾空白和空项
    return raw
        .split(/[,;\n\r]+/)
        .map(k => k.trim())
        .filter(k => k.length > 0);
}

function now() {
    return Date.now();
}

function isHealthy(key) {
    const st = keyState.get(key);
    if (!st) return true;
    return !(st.badUntil && st.badUntil > now());
}

/**
 * 挑一个 Key。优先健康的；全都坏了就随机挑一个赌一把
 * （可能已经恢复，或者上游的临时故障已经过去）。
 */
function pickKey(keys) {
    const healthy = keys.filter(isHealthy);
    const pool = healthy.length > 0 ? healthy : keys;
    return pool[Math.floor(Math.random() * pool.length)];
}

function markBad(key, status, reason) {
    keyState.set(key, { badUntil: now() + KEY_COOLDOWN_MS, lastStatus: status, reason });
}

function markGood(key) {
    if (keyState.has(key)) keyState.delete(key);
}

/** Key 打码，只留头尾，用于日志和错误响应，避免密钥泄露 */
function maskKey(key) {
    if (!key) return '(空)';
    if (key.length <= 10) return key.slice(0, 2) + '***';
    return key.slice(0, 6) + '***' + key.slice(-4);
}

// ==================== CORS ====================

function corsHeaders(request) {
    const origin = request.headers.get('Origin') || '*';
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, x-api-key, x-client-name',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers': 'x-cfproxy-key-index, x-cfproxy-attempts',
        'Vary': 'Origin'
    };
}

function jsonResponse(obj, status, extraHeaders) {
    return new Response(JSON.stringify(obj, null, 2), {
        status: status || 200,
        headers: Object.assign(
            { 'Content-Type': 'application/json; charset=utf-8' },
            extraHeaders || {}
        )
    });
}

// ==================== 请求转发 ====================

/**
 * 用指定 Key 打一次上游。返回 { ok, status, body } 或抛出超时。
 */
async function callUpstream(targetUrl, method, key, body, clientHeaders) {
    const headers = new Headers();
    // 只透传必要的头，不把客户端的 Host / Cookie 等带过去
    headers.set('Accept', 'application/json');
    headers.set('x-api-key', key);
    // 自定义 UA：CurseForge 建议带上，便于他们识别调用方
    headers.set('User-Agent', clientHeaders.get('x-client-name') || 'wow-cfproxy/1.0');

    let payload;
    if (method !== 'GET' && method !== 'HEAD') {
        const ct = clientHeaders.get('Content-Type');
        if (ct) headers.set('Content-Type', ct);
        payload = body;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
        const resp = await fetch(targetUrl, {
            method,
            headers,
            body: payload,
            signal: controller.signal,
            redirect: 'follow'
        });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, body: text };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 主处理逻辑。
 */
async function handle(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // ---- CORS 预检 ----
    if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ---- 自检端点：/__health ----
    // 用来确认 Worker 活着、有几个 Key、各自状态。
    // 注意不返回 Key 本身，只返回打码后的标识。
    if (url.pathname === '/__health') {
        const keys = parseKeys(env);
        const detail = keys.map((k, i) => ({
            index: i,
            key: maskKey(k),
            healthy: isHealthy(k),
            lastStatus: (keyState.get(k) || {}).lastStatus || null
        }));
        return jsonResponse({
            ok: true,
            service: 'cfproxy (Cloudflare Workers)',
            keyCount: keys.length,
            healthyCount: keys.filter(isHealthy).length,
            keys: detail,
            upstream: CF_API_BASE,
            time: new Date().toISOString()
        }, 200, corsHeaders(request));
    }

    // ---- 校验 Key 池 ----
    const keys = parseKeys(env);
    if (keys.length === 0) {
        return jsonResponse({
            error: '未配置 API Key',
            hint: '在 Cloudflare 控制台的 Worker → Settings → Variables and Secrets 中添加变量 CF_API_KEYS，多个 Key 用英文逗号分隔。'
        }, 500, corsHeaders(request));
    }

    // ---- 构造上游 URL：path + query 原样透传 ----
    // 关键：不做路径改写，保证 wow~ 的 buildUrl 拼出来的 /v1/... 能直接用
    const targetUrl = CF_API_BASE + url.pathname + url.search;

    // ---- 只允许 /v1 下的路径，挡住乱转发 ----
    if (!url.pathname.startsWith('/v1/')) {
        return jsonResponse({
            error: '路径不被允许',
            hint: '只代理 /v1/ 下的 CurseForge API 路径，例如 /v1/mods/search。',
            received: url.pathname
        }, 400, corsHeaders(request));
    }

    // ---- 读 body（仅非 GET） ----
    let bodyBuf = null;
    if (method !== 'GET' && method !== 'HEAD') {
        bodyBuf = await request.arrayBuffer();
    }

    // ---- 多 Key 轮换尝试 ----
    const tried = [];
    const attempted = new Set();

    for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
        const key = pickKey(keys.filter(k => !attempted.has(k)));
        // 所有 Key 都试过了
        if (!key) break;
        attempted.add(key);

        let result;
        try {
            result = await callUpstream(targetUrl, method, key, bodyBuf, request.headers);
        } catch (e) {
            // 网络错误 / 超时：不怪 Key，换下一个试试
            tried.push({ key: maskKey(key), status: 0, reason: e.name === 'AbortError' ? 'timeout' : 'network' });
            continue;
        }

        tried.push({ key: maskKey(key), status: result.status });

        if (result.ok) {
            markGood(key);
            return new Response(result.body, {
                status: 200,
                headers: Object.assign(
                    { 'Content-Type': 'application/json; charset=utf-8' },
                    corsHeaders(request),
                    {
                        'x-cfproxy-key-index': String(keys.indexOf(key)),
                        'x-cfproxy-attempts': String(attempt + 1)
                    }
                )
            });
        }

        // ---- 403：可能是 Key 无效，也可能是资源禁止分发，需要区分 ----
        // 判据：如果还有**没试过**的 Key，就换一个再试；试不出不同的结果，
        // 说明是资源本身的限制（作者禁了第三方分发），原样返回给客户端。
        if (result.status === 403) {
            const remaining = keys.filter(k => !attempted.has(k));
            if (remaining.length > 0) {
                markBad(key, 403, 'forbidden');
                continue;
            }
            return new Response(result.body, {
                status: 403,
                headers: Object.assign(
                    { 'Content-Type': 'application/json; charset=utf-8' },
                    corsHeaders(request)
                )
            });
        }

        // ---- 429：额度耗尽，换 Key ----
        if (result.status === 429) {
            markBad(key, 429, 'rate_limited');
            continue;
        }

        // ---- 5xx：上游故障，换 Key 意义不大，但可以再试一次 ----
        if (result.status >= 500 && attempt < MAX_KEY_ATTEMPTS - 1) {
            continue;
        }

        // ---- 其他（400/404 等）：这是业务的正常答复，原样返回 ----
        return new Response(result.body, {
            status: result.status,
            headers: Object.assign(
                { 'Content-Type': 'application/json; charset=utf-8' },
                corsHeaders(request)
            )
        });
    }

    // ---- 全部失败 ----
    return jsonResponse({
        error: '所有 API Key 均不可用',
        attempts: tried,
        hint: '请检查 CF_API_KEYS 是否正确、是否已过期，或稍后再试。'
    }, 503, corsHeaders(request));
}

// ==================== 入口 ====================

export default {
    async fetch(request, env, ctx) {
        try {
            return await handle(request, env, ctx);
        } catch (e) {
            // 兜底：任何未预料的异常都要返回 JSON，
            // 不能让人看到一堆 HTML 或空白页
            return jsonResponse({
                error: 'Worker 内部错误',
                message: e && e.message ? e.message : String(e)
            }, 500, corsHeaders(request));
        }
    }
};
