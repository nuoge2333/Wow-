#!/usr/bin/env node
/**
 * cfproxy Worker 测试（本地模拟，不联网）
 * ----------------------------------------------------------------
 * Worker 的核心风险是「多 Key 轮换时判断错错误语义」，
 * 所以测试重点是：一个坏 Key 不能拖垮整个服务。
 *
 * 做法：把 globalThis.fetch 换成打桩函数，模拟上游的各种响应。
 *
 * 运行：node deploy/cfproxy-worker/worker.test.mjs
 */

const fs = await import('node:fs');
const path = await import('node:path');
const url = await import('node:url');

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'worker.js');

// ---- 加载 Worker（把 export default 换成可访问的全局）----
const code = fs.readFileSync(SRC, 'utf8').replace(/export default/, 'globalThis.__worker =');
eval(code);
const worker = globalThis.__worker;

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try { fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; failures.push({ name, err: e }); console.log(`  ❌ ${name}\n     ${e.message}`); }
}
async function checkAsync(name, fn) {
    try { await fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; failures.push({ name, err: e }); console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ---- 上游打桩 ----
const realFetch = globalThis.fetch;
let upstreamCalls = [];   // [{ url, key }]
let upstreamHandler = null;

globalThis.fetch = async (target, init) => {
    const headers = init && init.headers;
    const key = headers && headers.get ? headers.get('x-api-key') : null;
    upstreamCalls.push({ url: String(target), key });
    const r = await upstreamHandler(String(target), key, init);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
        status: r.status,
        headers: { 'Content-Type': 'application/json' }
    });
};

function mkReq(p, opts = {}) {
    return new Request('https://cfproxy.test' + p, {
        method: opts.method || 'GET',
        headers: opts.headers || {}
    });
}

console.log('\n===== cfproxy Worker 测试 =====\n');

// ==================== 1. 基础转发 ====================
console.log('【基础转发】');

await checkAsync('GET /v1/mods/238222 → 转发到官方同路径', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 200, body: { data: { id: 238222, name: 'JEI' } } });
    const resp = await worker.fetch(mkReq('/v1/mods/238222'), { CF_API_KEYS: 'k1' }, {});
    assert(resp.status === 200, `状态码应为 200，实际 ${resp.status}`);
    const j = await resp.json();
    assert(j.data.name === 'JEI', '应原样返回 JSON');
    assert(upstreamCalls[0].url === 'https://api.curseforge.com/v1/mods/238222',
        `上游 URL 不对: ${upstreamCalls[0].url}`);
});

await checkAsync('query 参数原样透传', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 200, body: { data: [] } });
    await worker.fetch(mkReq('/v1/mods/search?gameId=432&searchFilter=jei&pageSize=20'), { CF_API_KEYS: 'k1' }, {});
    const u = upstreamCalls[0].url;
    assert(u.includes('gameId=432') && u.includes('searchFilter=jei') && u.includes('pageSize=20'),
        `query 丢了: ${u}`);
});

await checkAsync('Key 放在 x-api-key 头里发给上游', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 200, body: {} });
    await worker.fetch(mkReq('/v1/games/432'), { CF_API_KEYS: 'my-secret-key' }, {});
    assert(upstreamCalls[0].key === 'my-secret-key', `上游收到的 Key: ${upstreamCalls[0].key}`);
});

await checkAsync('客户端自带 x-api-key 会被 Worker 覆盖（防止绕过 Key 池）', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 200, body: {} });
    await worker.fetch(mkReq('/v1/games/432', { headers: { 'x-api-key': 'client-fake' } }),
        { CF_API_KEYS: 'server-key' }, {});
    assert(upstreamCalls[0].key === 'server-key',
        `客户端 Key 不应生效，上游收到: ${upstreamCalls[0].key}`);
});

// ==================== 2. 路径限制 ====================
console.log('\n【路径限制】');

await checkAsync('/ 等非 /v1 路径 → 400，且不请求上游', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 200, body: {} });
    const resp = await worker.fetch(mkReq('/'), { CF_API_KEYS: 'k1' }, {});
    assert(resp.status === 400, `应 400，实际 ${resp.status}`);
    assert(upstreamCalls.length === 0, '不该请求上游');
});

await checkAsync('防止路径穿越：/v1/../etc 之类不能穿透', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 200, body: {} });
    // URL 构造时 ../ 已被规范化，这里测的是「规范化后不在 /v1 下」的情况
    const resp = await worker.fetch(mkReq('/v1/../../evil'), { CF_API_KEYS: 'k1' }, {});
    // 规范化后是 /evil，应被 400 挡掉
    assert(resp.status === 400, `应 400，实际 ${resp.status}（规范化后路径）`);
});

// ==================== 3. 多 Key 轮换 ====================
console.log('\n【多 Key 轮换与熔断】');

await checkAsync('逗号分隔解析多个 Key', async () => {
    const resp = await worker.fetch(mkReq('/__health'), { CF_API_KEYS: 'a,b,c' }, {});
    const j = await resp.json();
    assert(j.keyCount === 3, `应解析出 3 个 Key，实际 ${j.keyCount}`);
});

await checkAsync('支持分号/换行分隔，且忽略空白项', async () => {
    const resp = await worker.fetch(mkReq('/__health'), { CF_API_KEYS: ' a , b ;\n c \n\n ' }, {});
    const j = await resp.json();
    assert(j.keyCount === 3, `应 3 个，实际 ${j.keyCount}: ${JSON.stringify(j.keys)}`);
});

await checkAsync('第一个 Key 429 → 自动换第二个，最终成功', async () => {
    upstreamCalls = [];
    let n = 0;
    upstreamHandler = () => {
        n++;
        return n === 1 ? { status: 429, body: { error: 'rate limited' } }
                       : { status: 200, body: { data: 'ok' } };
    };
    const resp = await worker.fetch(mkReq('/v1/games/432'), { CF_API_KEYS: 'bad,good' }, {});
    assert(resp.status === 200, `应最终成功，实际 ${resp.status}`);
    assert(upstreamCalls.length === 2, `应尝试 2 次，实际 ${upstreamCalls.length}`);
});

await checkAsync('所有 Key 都 429 → 503，并列出尝试记录', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 429, body: {} });
    const resp = await worker.fetch(mkReq('/v1/games/432'), { CF_API_KEYS: 'k1' }, {});
    assert(resp.status === 503, `应 503，实际 ${resp.status}`);
    const j = await resp.json();
    assert(Array.isArray(j.attempts), '应返回 attempts 明细');
});

await checkAsync('坏 Key 被标记后，后续请求不再优先用它（熔断生效）', async () => {
    // 每次都记录「本次请求的第一个上游调用用了哪个 Key」
    let firstKeyOfCall = null;
    upstreamHandler = (u, key) => {
        if (firstKeyOfCall === null) firstKeyOfCall = key;
        return key === 'bad-key'
            ? { status: 429, body: {} }
            : { status: 200, body: { data: 'ok' } };
    };
    const probe = async () => {
        firstKeyOfCall = null;
        await worker.fetch(mkReq('/v1/games/432'), { CF_API_KEYS: 'bad-key,good-key' }, {});
        return firstKeyOfCall;
    };

    // 阶段一：多打几次，让 bad-key 被标记为不健康
    for (let i = 0; i < 12; i++) await probe();

    // 阶段二：再打 20 次，统计「第一个 Key 就是 bad-key」的次数
    let badFirst = 0;
    for (let i = 0; i < 20; i++) {
        if (await probe() === 'bad-key') badFirst++;
    }
    assert(badFirst === 0,
        `熔断后 bad-key 仍被优先使用 ${badFirst} 次（期望 0）——冷却没有生效`);
});

// ==================== 4. 403 语义区分 ====================
console.log('\n【403 的两种含义】');
await checkAsync('Key 全坏时的 403 → 原样透传给客户端（说明是资源限制）', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 403, body: { error: 'forbidden by author' } });
    const resp = await worker.fetch(mkReq('/v1/mods/1/files/2'), { CF_API_KEYS: 'only-key' }, {});
    assert(resp.status === 403, `应透传 403，实际 ${resp.status}`);
});

await checkAsync('单请求内一定会把所有 Key 试一遍（不因一个坏 Key 整体失败）', async () => {
    for (const n of [1, 2, 3]) {
        const keys = Array.from({ length: n }, (_, i) => `k${i}`).join(',');
        upstreamCalls = [];
        upstreamHandler = () => ({ status: 429, body: {} });
        await worker.fetch(mkReq('/v1/games/432'), { CF_API_KEYS: keys }, {});
        // 上限是 MAX_KEY_ATTEMPTS(3)，所以 n>3 时最多 3 次
        const expect = Math.min(n, 3);
        assert(upstreamCalls.length === expect,
            `${n} 个 Key 应尝试 ${expect} 次，实际 ${upstreamCalls.length} 次`);
        // 且不能重复用同一个 Key
        const uniq = new Set(upstreamCalls.map(c => c.key));
        assert(uniq.size === upstreamCalls.length,
            `${n} 个 Key 时出现了重复使用同一个 Key 的情况`);
    }
});

await checkAsync('单 Key 的 403 不会无限重试（最多试完 Key 池）', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 403, body: {} });
    await worker.fetch(mkReq('/v1/mods/1/files/2'), { CF_API_KEYS: 'k1,k2,k3,k4,k5' }, {});
    assert(upstreamCalls.length <= 3,
        `最多尝试 ${3} 次，实际尝试 ${upstreamCalls.length} 次`);
});

// ==================== 5. CORS ====================
console.log('\n【CORS】');

await checkAsync('OPTIONS 预检 → 204 且带 CORS 头', async () => {
    const resp = await worker.fetch(
        mkReq('/v1/mods/search', { method: 'OPTIONS', headers: { Origin: 'https://example.com' } }),
        { CF_API_KEYS: 'k1' }, {});
    assert(resp.status === 204, `应 204，实际 ${resp.status}`);
    assert(resp.headers.get('Access-Control-Allow-Origin') === 'https://example.com',
        'ACAO 应回显 Origin');
    assert(/x-api-key/.test(resp.headers.get('Access-Control-Allow-Headers') || ''),
        'Allow-Headers 应包含 x-api-key');
});

await checkAsync('普通响应也带 CORS 头', async () => {
    upstreamHandler = () => ({ status: 200, body: {} });
    const resp = await worker.fetch(
        mkReq('/v1/games/432', { headers: { Origin: 'https://example.com' } }),
        { CF_API_KEYS: 'k1' }, {});
    assert(resp.headers.get('Access-Control-Allow-Origin'), '应有 ACAO 头');
});

// ==================== 6. 健康检查 ====================
console.log('\n【自检端点】');

await checkAsync('/__health 返回 Key 数量且不泄露明文', async () => {
    const resp = await worker.fetch(mkReq('/__health'), { CF_API_KEYS: 'abcdef1234567890' }, {});
    const j = await resp.json();
    assert(j.ok === true, 'ok 应为 true');
    assert(j.keyCount === 1);
    const body = JSON.stringify(j);
    assert(!body.includes('abcdef1234567890'),
        '健康检查不应返回明文 Key！');
    assert(j.keys[0].key.includes('***'), '应以掩码形式返回');
});

// ==================== 7. 缺配置 ====================
console.log('\n【配置缺失】');

await checkAsync('没配 CF_API_KEYS → 500 且给出明确指引', async () => {
    upstreamCalls = [];
    upstreamHandler = () => ({ status: 200, body: {} });
    const resp = await worker.fetch(mkReq('/v1/games/432'), {}, {});
    assert(resp.status === 500, `应 500，实际 ${resp.status}`);
    const j = await resp.json();
    assert(/CF_API_KEYS/.test(JSON.stringify(j)), '错误信息应提到 CF_API_KEYS');
    assert(upstreamCalls.length === 0, '不该请求上游');
});

// ==================== 8. 与 wow 客户端的兼容性 ====================
console.log('\n【与 wow~ 客户端对接】');

await checkAsync('wow 的 buildUrl 拼出的三种路径都能被正确转发', async () => {
    const paths = ['/v1/mods/search', '/v1/mods/238222', '/v1/mods/238222/files/4567890'];
    for (const p of paths) {
        upstreamCalls = [];
        upstreamHandler = () => ({ status: 200, body: { data: {} } });
        const resp = await worker.fetch(mkReq(p), { CF_API_KEYS: 'k1' }, {});
        assert(resp.status === 200, `${p} 失败`);
        assert(upstreamCalls[0].url === 'https://api.curseforge.com' + p,
            `${p} 转发成了 ${upstreamCalls[0].url}`);
    }
});

// ---- 收尾 ----
globalThis.fetch = realFetch;

console.log('\n----------------------------------------');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
    console.log('\n失败明细：');
    failures.forEach(f => console.log(`  · ${f.name}\n    ${f.err.stack || f.err.message}`));
    process.exit(1);
}
console.log('✅ cfproxy Worker 测试全部通过\n');

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
