#!/usr/bin/env node
/**
 * V3.5.25：CurseForge 三层降级矩阵测试
 * ----------------------------------------------------------------
 * 待测规则一句话：**代理 → BYOK → 本地缓存，哪层能用用哪层。**
 *
 * 关键设计点（也是最容易写错的地方）：
 *
 *   1. 不是所有失败都该降级。
 *      429 / 超时 / 5xx / 连不上 → 换一层有意义
 *      401 / 403（Key 被拒）/ 404  → 换一层也一样，必须直接抛
 *      这两类混在一起处理，会掩盖「Key 填错了」这种用户能自己修的问题。
 *
 *   2. 缓存要先于网络读。
 *      新鲜命中时应当 **0 次网络请求** —— 这正好抵消代理层没有缓存的问题。
 *
 *   3. 缓存过期后仍要返回。
 *      网络全挂时，一份 3 天前的数据也比什么都拿不到强，但必须提示可能过期。
 *
 * 全程不联网：把 axios.get 打桩，按 URL 前缀决定返回什么。
 *
 * 运行：node test/cf_fallback.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

const SRC = path.join(__dirname, '../src');

// ---- 打桩 axios，记录每次请求 ----
const axios = require(path.join(SRC, '..', 'node_modules', 'axios'));
const realGet = axios.get;
let calls = [];          // [{ url, opts }]
let handler = null;      // (url, opts) => { status, data } | throw

axios.get = async (url, opts) => {
    calls.push({ url, opts });
    const r = await handler(url, opts);
    if (r === 'THROW_TIMEOUT') {
        const e = new Error('timeout of 5000ms exceeded');
        e.code = 'ECONNABORTED';
        throw e;
    }
    return { status: r.status, data: r.data };
};

const config = require(path.join(SRC, 'config'));
const cf = require(path.join(SRC, 'cf_client'));

// 用临时目录做缓存，避免污染真实缓存
const TMP_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'cfcache-'));
cf.CACHE_DIR_OVERRIDE = TMP_CACHE;

// 让 cf_client 认这个目录：直接改它内部常量不可行，故用环境变量方式已不支持，
// 这里改用「复制一份模块」太重，改为在测试里清空真实目录前后还原。
// —— 简化做法：测试全程使用真实 CACHE_DIR，但在开始与结束时清空。
const REAL_CACHE = cf.CACHE_DIR;

// 配置打桩
const realGetConfig = config.getConfig;
function setConf(obj) {
    config.getConfig = (k, d) => (k in obj ? obj[k] : d);
}

console.log('\n===== V3.5.25 CurseForge 三层降级 =====\n');

const F = {  // 假的文件响应
    id: 123, fileName: 'jei-1.20.1.jar', fileDate: '2025-01-01T00:00:00Z',
    fileLength: 1024, downloadUrl: 'https://edge.forgecdn.net/files/123/jei.jar', hashes: []
};

(async function run() {
    cf.clearCache();

    // ==================== 1. 无代理无 Key ====================
    console.log('【凭据缺失时的行为】');

    await checkAsync('无代理无 Key 无缓存 → 报错且提示申请 Key', async () => {
        setConf({});
        let err = null;
        try { await cf.getFileDownload(1, 2); } catch (e) { err = e; }
        assert.ok(err, '应抛错');
        assert.ok(/API Key|curseforge\.com/.test(err.message), `应提示申请 Key: ${err.message}`);
    });

    await checkAsync('完全没配时不应该发起任何网络请求', async () => {
        setConf({});
        calls = [];
        handler = () => ({ status: 200, data: { data: F } });
        try { await cf.getFileDownload(1, 2); } catch (e) { /* 预期失败 */ }
        assert.strictEqual(calls.length, 0, `不该发请求，实际发了 ${calls.length} 次`);
    });

    // ==================== 2. 只有 Key：直连 ====================
    console.log('\n【第二层：BYOK 直连】');

    await checkAsync('只有 Key → 直连官方 API，Key 放在 x-api-key 头', async () => {
        setConf({ 'curseforge.api_key': 'my-key' });
        calls = [];
        handler = () => ({ status: 200, data: { data: F } });
        const r = await cf.getFileDownload(101, 201, { noCache: true });
        assert.strictEqual(r.url, F.downloadUrl);
        assert.strictEqual(r.via, 'byok');
        assert.strictEqual(calls.length, 1);
        assert.ok(calls[0].url.startsWith(cf.CF_OFFICIAL), `应请求官方 base: ${calls[0].url}`);
        assert.strictEqual(calls[0].opts.headers['x-api-key'], 'my-key');
    });

    await checkAsync('超时为 5 秒（需求指定）', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        calls = [];
        handler = () => ({ status: 200, data: { data: F } });
        await cf.getFileDownload(102, 202, { noCache: true });
        assert.strictEqual(calls[0].opts.timeout, 5000, `超时应为 5000ms，实际 ${calls[0].opts.timeout}`);
    });

    // ==================== 3. 代理优先 ====================
    console.log('\n【第一层：公共代理优先】');

    await checkAsync('配了代理 → 先打代理，成功就不打直连', async () => {
        setConf({ 'curseforge.proxy_url': 'http://127.0.0.1:3000', 'curseforge.api_key': 'k' });
        calls = [];
        handler = (url) => ({ status: 200, data: { data: F } });
        const r = await cf.getFileDownload(103, 203, { noCache: true });
        assert.strictEqual(r.via, 'proxy');
        assert.ok(calls[0].url.startsWith('http://127.0.0.1:3000'), `首个请求应打代理: ${calls[0].url}`);
        assert.strictEqual(calls.filter(c => c.url.includes('api.curseforge.com')).length, 0,
            '代理成功时不该再直连');
    });

    await checkAsync('proxy_url 末尾多写斜杠不会拼出 //', async () => {
        setConf({ 'curseforge.proxy_url': 'http://127.0.0.1:3000//' });
        calls = [];
        handler = () => ({ status: 200, data: { data: F } });
        await cf.getFileDownload(104, 204, { noCache: true });
        assert.ok(!calls[0].url.includes('//mods'), `拼接错误: ${calls[0].url}`);
    });

    // ==================== 4. 降级触发条件 ====================
    console.log('\n【降级判定：哪些错误该换层】');

    await checkAsync('代理 429 → 降级到直连', async () => {
        setConf({ 'curseforge.proxy_url': 'http://p:3000', 'curseforge.api_key': 'k' });
        calls = [];
        handler = (url) => url.startsWith('http://p:3000')
            ? { status: 429, data: {} }
            : { status: 200, data: { data: F } };
        const r = await cf.getFileDownload(105, 205, { noCache: true });
        assert.strictEqual(r.via, 'byok', `429 后应降级直连，实际 ${r.via}`);
        assert.strictEqual(calls.length, 2);
    });

    await checkAsync('代理 500 → 降级到直连', async () => {
        setConf({ 'curseforge.proxy_url': 'http://p:3000', 'curseforge.api_key': 'k' });
        handler = (url) => url.startsWith('http://p:3000')
            ? { status: 500, data: {} } : { status: 200, data: { data: F } };
        const r = await cf.getFileDownload(106, 206, { noCache: true });
        assert.strictEqual(r.via, 'byok');
    });

    await checkAsync('代理超时 → 降级到直连', async () => {
        setConf({ 'curseforge.proxy_url': 'http://p:3000', 'curseforge.api_key': 'k' });
        handler = (url) => url.startsWith('http://p:3000')
            ? 'THROW_TIMEOUT' : { status: 200, data: { data: F } };
        const r = await cf.getFileDownload(107, 207, { noCache: true });
        assert.strictEqual(r.via, 'byok', '超时应降级');
    });

    await checkAsync('代理 403 → 不读缓存之前先试直连（代理拒绝不代表直连也不行）', async () => {
        setConf({ 'curseforge.proxy_url': 'http://p:3000', 'curseforge.api_key': 'k' });
        calls = [];
        cf.clearCache();
        handler = (url) => url.startsWith('http://p:3000')
            ? { status: 403, data: {} }
            : { status: 200, data: { data: F } };
        const r = await cf.getFileDownload(108, 208, { noCache: true });
        assert.strictEqual(r.via, 'byok', `代理 403 后应继续试直连，实际 ${r.via}`);
    });

    await checkAsync('直连 403（Key 无效）→ 不重试，但有缓存时用缓存兜底', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        // 先写入一份缓存
        handler = () => ({ status: 200, data: { data: F } });
        await cf.getFileDownload(109, 209);

        // 再让直连返回 403
        calls = [];
        handler = () => ({ status: 403, data: {} });
        const r = await cf.getFileDownload(109, 209, { noCache: true });
        assert.strictEqual(r.via, 'cache-stale', `Key 失效时应落到缓存，实际 ${r.via}`);
        assert.strictEqual(calls.length, 1, `直连 403 不该重试，实际请求 ${calls.length} 次`);
    });

    await checkAsync('直连 403 且无缓存 → 抛错（不能假装成功）', async () => {
        setConf({ 'curseforge.api_key': 'bad-key' });
        cf.clearCache();
        calls = [];
        handler = () => ({ status: 403, data: {} });
        let err = null;
        try { await cf.getFileDownload(1099, 2099, { noCache: true }); } catch (e) { err = e; }
        assert.ok(err, '无缓存兜底时应抛错');
        assert.strictEqual(calls.length, 1, '401/403 不该重试');
    });

    await checkAsync('404 → 直接失败，不降级也不读缓存', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        calls = [];
        handler = () => ({ status: 404, data: {} });
        let err = null;
        try { await cf.getFileDownload(1098, 2098, { noCache: true }); } catch (e) { err = e; }
        assert.ok(err, '404 应抛错');
        assert.strictEqual(calls.length, 1, '404 不该重试');
    });

    // ==================== 5. 缓存 ====================
    console.log('\n【第三层：本地缓存】');

    await checkAsync('写入缓存后，重复请求 0 次网络', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        calls = [];
        handler = () => ({ status: 200, data: { data: F } });
        await cf.getFileDownload(110, 210);          // 第一次：走网络
        const afterFirst = calls.length;
        await cf.getFileDownload(110, 210);          // 第二次：应命中缓存
        assert.strictEqual(afterFirst, 1, `首次应 1 次请求，实际 ${afterFirst}`);
        assert.strictEqual(calls.length, 1, `命中缓存后不应再请求，实际 ${calls.length} 次`);
    });

    await checkAsync('缓存命中时返回 via=cache 且 stale=false', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        handler = () => ({ status: 200, data: { data: F } });
        const r1 = await cf.getFileDownload(111, 211);
        const r2 = await cf.getFileDownload(111, 211);
        assert.strictEqual(r1.via, 'byok');
        assert.strictEqual(r2.via, 'cache');
        assert.strictEqual(r2.stale, false);
    });

    await checkAsync('不同 projectID/fileID 的缓存互不串味', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        handler = (url, opts) => {
            const m = url.match(/\/files\/(\d+)/);
            return { status: 200, data: { data: { ...F, id: Number(m[1]), fileName: `f${m[1]}.jar` } } };
        };
        const a = await cf.getFileDownload(112, 9001);
        const b = await cf.getFileDownload(112, 9002);
        assert.notStrictEqual(a.fileName, b.fileName, '不同 fileID 拿到了同样的缓存，键冲突了');
    });

    await checkAsync('缓存过期后网络全挂 → 仍返回旧数据并标记 stale', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        handler = () => ({ status: 200, data: { data: F } });
        await cf.getFileDownload(113, 213);          // 先写缓存

        // 把缓存文件的 cached_at 改成 3 天前
        const files = fs.readdirSync(cf.CACHE_DIR).filter(f => f.startsWith('file_113_213'));
        assert.strictEqual(files.length, 1, '缓存文件应存在');
        const p = path.join(cf.CACHE_DIR, files[0]);
        const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
        obj.cached_at = Date.now() - 3 * 24 * 3600 * 1000;
        fs.writeFileSync(p, JSON.stringify(obj));

        setConf({ 'curseforge.api_key': 'k' });
        handler = () => { const e = new Error('down'); e.code = 'ENOTFOUND'; return Promise.reject(e); };
        // 上面 handler 返回 rejected promise，axios 桩会 await 它 → 抛出
        const r = await cf.getFileDownload(113, 213);
        assert.strictEqual(r.stale, true, '过期缓存应标记 stale=true');
        assert.strictEqual(r.url, F.downloadUrl);
    });

    await checkAsync('缓存文件损坏 → 不崩溃，当没有缓存处理', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        handler = () => ({ status: 200, data: { data: F } });
        await cf.getFileDownload(114, 214);
        const files = fs.readdirSync(cf.CACHE_DIR).filter(f => f.startsWith('file_114_214'));
        fs.writeFileSync(path.join(cf.CACHE_DIR, files[0]), '{ 这不是 JSON');
        handler = () => ({ status: 200, data: { data: F } });
        const r = await cf.getFileDownload(114, 214);
        assert.ok(r && r.url, '缓存损坏时应重新请求而不是崩溃');
    });

    // ==================== 6. 403 禁用下载 ====================
    console.log('\n【作者禁用 API 下载（403 语义）】');

    await checkAsync('downloadUrl 为 null → 抛 CF_FILE_FORBIDDEN，不当作整体失败', async () => {
        setConf({ 'curseforge.api_key': 'k' });
        cf.clearCache();
        handler = () => ({ status: 200, data: { data: { ...F, downloadUrl: null, fileName: 'blocked.jar' } } });
        let err = null;
        try { await cf.getFileDownload(115, 215); } catch (e) { err = e; }
        assert.ok(err, '应抛错');
        assert.strictEqual(err.code, 'CF_FILE_FORBIDDEN', `错误码应为 CF_FILE_FORBIDDEN，实际 ${err.code}`);
        assert.strictEqual(err.fileName, 'blocked.jar', '错误里应带上文件名，便于汇总提示');
    });

    // ==================== 7. 结构断言 ====================
    console.log('\n【源码结构】');

    const src = fs.readFileSync(path.join(SRC, 'cf_client.js'), 'utf8');
    check('请求超时常量是 5000ms', () => {
        assert.ok(/REQUEST_TIMEOUT\s*=\s*5000/.test(src), '超时应为 5000ms');
    });
    check('缓存 TTL 是 24 小时', () => {
        assert.ok(/CACHE_TTL_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src), 'TTL 应为 24h');
    });
    check('缓存目录是 core/cache/cf_mods', () => {
        assert.ok(/cache\/cf_mods/.test(src), '缓存目录应为 cache/cf_mods');
    });
    check('错误分类区分「换层」与「仅缓存」两档（实测官方 API 无 Key 也返回 403）', () => {
        assert.ok(/function classifyError/.test(src), '应存在 classifyError');
        assert.ok(/'cache-only'/.test(src),
            '必须有 cache-only 档：直连 403 表示 Key 有问题，不该换层，但旧缓存仍应兜底');
        assert.ok(/status === 404\) return 'fail'/.test(src),
            '404 必须直接失败：资源不存在时换层与缓存都无意义');
    });

    check('classifyError 对同一状态码在不同层给出不同结论', () => {
        const e403 = { response: { status: 403 } };
        assert.strictEqual(cf.classifyError(e403, 'byok'), 'cache-only',
            '直连 403 = Key 有问题，应落到缓存但不换层');
        assert.strictEqual(cf.classifyError(e403, 'proxy'), 'next-layer',
            '代理 403 = 代理拒了你，应继续试直连');
        assert.strictEqual(cf.classifyError({ response: { status: 404 } }, 'byok'), 'fail');
        assert.strictEqual(cf.classifyError({ response: { status: 429 } }, 'byok'), 'next-layer');
        assert.strictEqual(cf.classifyError({ code: 'ECONNABORTED' }, 'proxy'), 'next-layer');
    });

    // ---- URL 拼接：cfproxy 是「换 base、path 原样转发」，/v1 必须恰好一次 ----
    check('buildUrl：官方 base 补 /v1', () => {
        assert.strictEqual(
            cf.buildUrl('https://api.curseforge.com', '/mods/search'),
            'https://api.curseforge.com/v1/mods/search');
    });

    check('buildUrl：代理 base（不带 /v1）补 /v1', () => {
        assert.strictEqual(
            cf.buildUrl('http://127.0.0.1:3000', '/mods/search'),
            'http://127.0.0.1:3000/v1/mods/search');
    });

    check('buildUrl：base 已带 /v1 时不重复', () => {
        const u = cf.buildUrl('http://127.0.0.1:3000/v1', '/mods/search');
        assert.strictEqual(u, 'http://127.0.0.1:3000/v1/mods/search');
        assert.ok(!/v1\/v1/.test(u), `出现了 /v1/v1: ${u}`);
    });

    check('buildUrl：base 末尾斜杠不拼出 //', () => {
        const u = cf.buildUrl('http://127.0.0.1:3000/', '/mods/1/files/2');
        assert.strictEqual(u, 'http://127.0.0.1:3000/v1/mods/1/files/2');
    });

    check('buildUrl：path 自带 /v1 也不会重复（防以后有人直接传全路径）', () => {
        const u = cf.buildUrl('https://api.curseforge.com', '/v1/mods/search');
        assert.strictEqual(u, 'https://api.curseforge.com/v1/mods/search');
    });

    // ==================== 8. 与 mod_search 的衔接 ====================
    console.log('\n【与模组搜索的衔接】');

    check('mod_search 不再硬性要求 Key（不再有「需要 API Key」的 400 拦截）', () => {
        const ms = fs.readFileSync(path.join(SRC, 'mod_search.js'), 'utf8');
        assert.ok(!/CurseForge 需要 API Key/.test(ms),
            '旧的「必须有 Key 否则 400」拦截应已移除，否则无 Key 用户永远走不到代理层');
    });

    check('mod_search 已改为调用 cf_client', () => {
        const ms = fs.readFileSync(path.join(SRC, 'mod_search.js'), 'utf8');
        assert.ok(/require\(['"]\.\/cf_client['"]\)/.test(ms), '应引入 cf_client');
        assert.ok(/cf\.(cfSearch|getProject)/.test(ms), '应调用 cf_client 的方法');
    });

    check('mod_search 不再自己拼 api.curseforge.com', () => {
        const ms = fs.readFileSync(path.join(SRC, 'mod_search.js'), 'utf8');
        assert.ok(!/https:\/\/api\.curseforge\.com/.test(ms),
            'base URL 应集中到 cf_client，否则代理替换会漏掉这个调用点');
    });

    check('cf_client 的报错不被层层包装（避免「请求失败: 请求失败:」）', () => {
        const ms = fs.readFileSync(path.join(SRC, 'mod_search.js'), 'utf8');
        assert.ok(/if \(e && e\.cfError\) throw httpError\(e\.message/.test(ms),
            'cf_client 的报错已是完整中文说明，mod_search 应直接透传而不是再套前缀');
    });

    // ---- 收尾 ----
    axios.get = realGet;
    config.getConfig = realGetConfig;
    cf.clearCache();
    try { fs.removeSync(TMP_CACHE); } catch (e) {}

    console.log('\n----------------------------------------');
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail > 0) {
        console.log('\n失败明细：');
        failures.forEach(f => console.log(`  · ${f.name}\n    ${f.err.stack || f.err.message}`));
        process.exit(1);
    }
    console.log('✅ 三层降级测试全部通过\n');
    process.exit(0);
})();
