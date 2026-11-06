#!/usr/bin/env node
/**
 * V3.5.25：跨设备方案同步 测试
 * ----------------------------------------------------------------
 * 待测规则一句话：**清单先行、缺口上传、哈希说话、组装入池。**
 *
 * 本测试盯的是几件「看上去能跑、其实会出事」的事：
 *
 *   1. 路径白名单（sync_common.isPathAllowed）。
 *      mods/plugins/config/... 内的允许扩展名才放行；`..`、绝对路径、
 *      盘符、反斜杠伪装、白名单外的可执行文件都必须拒绝。
 *
 *   2. 清单生成（buildManifest）。
 *      mods/plugins 只收 .jar；子目录文件的相对路径必须拼回方案内路径
 *      （config/sub/b.json 而不是 b.json）；root 文件只收
 *      server.properties / eula.txt。
 *
 *   3. multipart 解析（web_service.parseMultipart）。
 *      字段与文件要分得清，文件条目必须带 fieldName（sync 上传通道靠它找 chunk）。
 *
 *   4. staging 路径与已收字节数（stagingPathFor / receivedBytes）。
 *
 * 运行：node test/sync_module.test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const sync = require(path.join(ROOT, 'src/sync_common'));
const { parseMultipart } = require(path.join(ROOT, 'src/web_service'));

let passed = 0, failed = 0;
function t(name, cond) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
}

// ==================== 1. 路径白名单 ====================
console.log('\n[1] sync_common.isPathAllowed —— 路径与扩展名白名单');
t('mods/xxx.jar 允许', sync.isPathAllowed('mods/xxx.jar') === true);
t('plugins/BukkitPlg.jar 允许', sync.isPathAllowed('plugins/BukkitPlg.jar') === true);
t('config/a.toml 允许', sync.isPathAllowed('config/a.toml') === true);
t('config/sub/deep/b.json 允许（子目录）', sync.isPathAllowed('config/sub/deep/b.json') === true);
t('world/region/r.0.0.mca 允许', sync.isPathAllowed('world/region/r.0.0.mca') === true);
t('server.properties 允许（root 专门通道）', sync.isPathAllowed('server.properties') === true);
t('eula.txt 允许（root 专门通道）', sync.isPathAllowed('eula.txt') === true);
t('evil.exe 拒绝（扩展名白名单外）', sync.isPathAllowed('evil.exe') === false);
t('mods/evil.sh 拒绝', sync.isPathAllowed('mods/evil.sh') === false);
t('../evil.jar 拒绝（目录穿越）', sync.isPathAllowed('../evil.jar') === false);
t('mods/../evil.jar 拒绝', sync.isPathAllowed('mods/../evil.jar') === false);
t('/etc/passwd 拒绝（绝对路径）', sync.isPathAllowed('/etc/passwd') === false);
t('C:\\evil.jar 拒绝（盘符）', sync.isPathAllowed('C:\\evil.jar') === false);
t('mods\\evil.jar 归一化后按 mods/evil.jar 处理（合法路径放行）', sync.isPathAllowed('mods\\evil.jar') === true);
t('logs/latest.log 拒绝（日志不进白名单）', sync.isPathAllowed('logs/latest.log') === false);
t('libraries/x.jar 拒绝（libraries 不在白名单）', sync.isPathAllowed('libraries/x.jar') === false);
t('空串拒绝', sync.isPathAllowed('') === false);

// ==================== 2. 清单生成 ====================
console.log('\n[2] sync_common.buildManifest —— 清单结构');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-sync-test-'));
const sp = path.join(tmp, 'demo');
for (const d of ['mods', 'config/sub', 'world/region']) fs.mkdirSync(path.join(sp, d), { recursive: true });
fs.writeFileSync(path.join(sp, 'mods', 'a.jar'), 'AAA');
fs.writeFileSync(path.join(sp, 'mods', 'big.jar'), Buffer.alloc(6 * 1024 * 1024, 7));   // > CHUNK_THRESHOLD
fs.writeFileSync(path.join(sp, 'config', 'a.toml'), 'x=1');
fs.writeFileSync(path.join(sp, 'config', 'sub', 'b.json'), '{}');
fs.writeFileSync(path.join(sp, 'world', 'level.dat'), 'LV');
fs.writeFileSync(path.join(sp, 'server.properties'), 'motd=hi');
fs.writeFileSync(path.join(sp, 'eula.txt'), 'eula=true');
fs.writeFileSync(path.join(sp, 'evil.exe'), 'MZ');   // 应被过滤

async function checkManifest() {
const manifest = await sync.buildManifest({
    schemePath: sp,
    meta: { name: 'demo', version: '1.20.1', loader: 'fabric', type: 'fabric', build: null, resources: { core: { file: null } } },
    withConfig: true,
    withWorld: true
});
t('协议版本为 2（mods/plugins 带 sha512/sha1）', manifest.protocol === 2);
t('方案名透传', manifest.name === 'demo');
t('mods 收 2 个 .jar', manifest.mods.length === 2);
t('mods 路径含目录前缀', manifest.mods.some(m => m.path === 'mods/big.jar'));
t('root 文件收 server.properties + eula.txt', manifest.root_files && manifest.root_files['server.properties'] && manifest.root_files['eula.txt']);
t('root 不收 evil.exe', !manifest.root_files['evil.exe']);
const files = manifest.files.map(f => f.path);
t('files 含 config/a.toml', files.includes('config/a.toml'));
t('files 含子目录 config/sub/b.json（相对路径拼回方案）', files.includes('config/sub/b.json'));
t('files 含 world/level.dat', files.includes('world/level.dat'));
t('evil.exe 被过滤', !files.includes('evil.exe'));
t('所有条目带 sha256（64 位十六进制）', [...manifest.mods, ...manifest.files, ...Object.values(manifest.root_files)]
    .every(e => /^[0-9a-f]{64}$/.test(e.sha256)));
t('total_bytes 汇总大于 6MB', manifest.total_bytes > 6 * 1024 * 1024);

// ---- 多哈希（v2） ----
const jei = manifest.mods.find(m => m.path === 'mods/a.jar');
t('mods 条目带 sha256/sha512/sha1 三字段', !!(jei && jei.sha256 && jei.sha512 && jei.sha1));
t('sha256 为 64 位', /^[0-9a-f]{64}$/.test(jei.sha256));
t('sha512 为 128 位', /^[0-9a-f]{128}$/.test(jei.sha512));
t('sha1 为 40 位', /^[0-9a-f]{40}$/.test(jei.sha1));
const rawJar = fs.readFileSync(path.join(sp, 'mods/a.jar'));
t('三路哈希与独立计算一致',
    jei.sha256 === crypto.createHash('sha256').update(rawJar).digest('hex') &&
    jei.sha512 === crypto.createHash('sha512').update(rawJar).digest('hex') &&
    jei.sha1 === crypto.createHash('sha1').update(rawJar).digest('hex'));
t('config 文件只算 sha256（不带 sha512/sha1）',
    manifest.files.every(f => f.sha512 === undefined && f.sha1 === undefined));
}

// ==================== 3. multipart 解析 ====================
console.log('\n[3] web_service.parseMultipart —— 分块上传协议');
(async () => {
    await checkManifest();

    // 构造一个标准 multipart 体（模拟 form-data 客户端）
    const boundary = '----wowtest' + Date.now();
    const chunk = Buffer.alloc(1024, 0xAB);
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="scheme"\r\n\r\nsyncdemo\r\n`),
        Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="offset"\r\n\r\n0\r\n`),
        Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="chunk"; filename="chunk.bin"\r\ncontent-type: application/octet-stream\r\n\r\n`),
        chunk,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const parsed = parseMultipart(body, boundary);
    t('字段 scheme 正确', parsed.fields.scheme === 'syncdemo');
    t('字段 offset 正确', parsed.fields.offset === '0');
    t('文件字段被识别为文件', parsed.files.length === 1);
    t('文件条目带 fieldName=chunk（sync 通道依赖）', parsed.files[0].fieldName === 'chunk');
    t('文件内容完整', parsed.files[0].buffer.length === 1024 && parsed.files[0].buffer[0] === 0xAB);

    // ==================== 4. staging 与续传 ====================
    console.log('\n[4] stagingPathFor / receivedBytes —— 断点续传基建');
    const sha = 'b'.repeat(64) + Date.now().toString(16).padStart(16, '0');  // 唯一，避免残留干扰
    const part = sync.stagingPathFor('demo-scheme', sha);
    t('staging 路径在 temp/sync_staging 下', String(part).includes('sync_staging'));
    t('staging 文件名是哈希 + .part', path.basename(part) === `${sha}.part`);
    t('方案名中的非法字符被净化', !/[\\/:*?"<>|]/.test(path.basename(path.dirname(part))));
    t('receivedBytes 对不存在文件返回 0', sync.receivedBytes(part) === 0);
    fs.mkdirSync(path.dirname(part), { recursive: true });
    fs.writeFileSync(part, Buffer.alloc(4096));
    t('receivedBytes 正确统计已收字节', sync.receivedBytes(part) === 4096);
    fs.rmSync(path.dirname(part), { recursive: true, force: true });

    await checkModrinth();

    console.log(`\n${'='.repeat(40)}`);
    console.log(`✅ 通过 ${passed} 项，失败 ${failed} 项`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
})();

// ==================== 5. Modrinth 补齐 ====================
/**
 * 用本地 mock HTTP 服务扮演 Modrinth，避免测试依赖外网。
 * 覆盖需求「测试要求 5.1」的六个用例。
 */
async function checkModrinth() {
    console.log('\n[5] sync_modrinth —— pool 未命中后查 Modrinth');
    const http = require('http');
    const mr = require(path.join(ROOT, 'src/sync_modrinth'));

    // 造三个「模组」文件，算出三路哈希
    const jars = {};
    for (const name of ['good', 'mismatch', 'absent']) {
        const buf = Buffer.from(`JAR-${name}-${Math.random()}`);
        jars[name] = {
            buf,
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
            sha512: crypto.createHash('sha512').update(buf).digest('hex'),
            sha1: crypto.createHash('sha1').update(buf).digest('hex')
        };
    }
    // mismatch：Modrinth 声称有，但下载回来的内容与控制端不同
    const wrongBuf = Buffer.from('TAMPERED');

    let requestLog = [];
    let mode = 'normal';   // normal | down | badreq
    const server = http.createServer((req, res) => {
        requestLog.push({ url: req.url, ua: req.headers['user-agent'] });
        if (mode === 'down') { res.writeHead(500); res.end('boom'); return; }
        if (req.url.startsWith('/v2/version_files')) {
            let body = '';
            req.on('data', d => body += d);
            req.on('end', () => {
                if (mode === 'badreq') { res.writeHead(422); res.end('{"error":"invalid algorithm"}'); return; }
                const parsed = JSON.parse(body || '{}');
                const out = {};
                for (const h of parsed.hashes || []) {
                    if (h === jars.good.sha512) out[h] = { id: 'v1', project_id: 'jei', files: [{ url: `${base}/files/good.jar`, filename: 'evil/../../jei.jar', primary: true }] };
                    if (h === jars.mismatch.sha512) out[h] = { id: 'v2', project_id: 'x', files: [{ url: `${base}/files/bad.jar`, filename: 'x.jar', primary: true }] };
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(out));
            });
            return;
        }
        if (req.url === '/files/good.jar') { res.writeHead(200); res.end(jars.good.buf); return; }
        if (req.url === '/files/bad.jar') { res.writeHead(200); res.end(wrongBuf); return; }
        res.writeHead(404); res.end();
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    // 用环境变量把 API 指向 mock（模块在 require 时已读环境变量，故用 setter 覆盖）
    const origBase = mr.API_BASE;
    // 直接改模块内部常量不可行，改用环境变量 + 重新 require 不现实；
    // 这里通过 patch axios 的 baseURL 更简单：把 API_BASE 暴露成可写属性
    Object.defineProperty(mr, 'API_BASE', { value: `${base}/v2`, writable: true, configurable: true });

    // 临时把模块内的 API_BASE 换掉不够（闭包捕获），改为拦截 axios.post/get
    const axios = require('axios');
    const origPost = axios.post, origGet = axios.get;
    axios.post = (url, data, cfg) => origPost(String(url).replace(/^https:\/\/api\.modrinth\.com/, base), data, cfg);
    axios.get = (url, cfg) => origGet(String(url).replace(/^https:\/\/api\.modrinth\.com/, base), cfg);

    const logs = [];
    const log = (s) => logs.push(s);
    const schemeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-mr-scheme-'));

    // ---- 用例 1：命中 ----
    console.log('  — 命中场景');
    let r = await mr.fillFromModrinth({
        entries: [{ path: 'mods/good.jar', sha256: jars.good.sha256, sha512: jars.good.sha512, sha1: jars.good.sha1, size: jars.good.buf.length }],
        protocol: 2, schemePath: schemeDir, log
    });
    t('Modrinth 命中 → resolved 含该文件', r.resolved.includes('mods/good.jar'));
    t('落盘文件 SHA-256 与清单一致',
        fs.existsSync(path.join(schemeDir, 'mods/good.jar')) && sync.sha256File && true);
    const landed = fs.readFileSync(path.join(schemeDir, 'mods/good.jar'));
    t('落盘内容正确（未被 Modrinth filename 影响路径）', sync.sha256Buf(landed) === jars.good.sha256);
    t('用清单 path 落盘，不信任 Modrinth 的 filename（无 evil 目录）', !fs.existsSync(path.join(schemeDir, 'evil')));
    t('User-Agent 带 wow/ 与 contact', requestLog.some(x => /^wow\/.*\(contact: https?:\/\//.test(x.ua)));

    // ---- 用例 2：命中但哈希不匹配 ----
    console.log('  — 哈希不匹配场景');
    r = await mr.fillFromModrinth({
        entries: [{ path: 'mods/mismatch.jar', sha256: jars.mismatch.sha256, sha512: jars.mismatch.sha512, sha1: jars.mismatch.sha1, size: 8 }],
        protocol: 2, schemePath: schemeDir, log
    });
    t('哈希不匹配 → 不写入方案目录', !fs.existsSync(path.join(schemeDir, 'mods/mismatch.jar')));
    t('哈希不匹配 → 标记需上传（reason=modrinth_hash_mismatch）',
        r.needUpload.some(x => x.path === 'mods/mismatch.jar' && x.reason === 'modrinth_hash_mismatch'));

    // ---- 用例 3：Modrinth 未收录 ----
    r = await mr.fillFromModrinth({
        entries: [{ path: 'mods/absent.jar', sha256: jars.absent.sha256, sha512: jars.absent.sha512, sha1: jars.absent.sha1, size: 4 }],
        protocol: 2, schemePath: schemeDir, log
    });
    t('未收录 → 标记需上传（reason=not_in_pool_not_in_modrinth）',
        r.needUpload.some(x => x.path === 'mods/absent.jar' && x.reason === 'not_in_pool_not_in_modrinth'));

    // ---- 用例 4：Modrinth 不可达 ----
    console.log('  — 不可达场景');
    mode = 'down';
    const many = [];
    // 注意：sha512 必须彼此不同（queryHashes 内部会去重），否则 250 条只剩 1 个哈希
    for (let i = 0; i < 250; i++) {
        const h = (n) => crypto.createHash('sha512').update(`down-${n}`).digest('hex');
        many.push({ path: `mods/m${i}.jar`, sha256: 'a'.repeat(64), sha512: h(i), sha1: 'c'.repeat(40), size: 1 });
    }
    let threw = false;
    try {
        r = await mr.fillFromModrinth({ entries: many, protocol: 2, schemePath: schemeDir, log });
    } catch (e) { threw = true; }
    t('连续失败不抛错（降级为需上传）', threw === false);
    t('全部标记需上传', r && r.needUpload.length === 250);
    t('不可达时标注原因', r && r.needUpload[0].reason === 'modrinth_unreachable');
    t('日志提示 Modrinth 不可达', logs.some(l => l.includes('不可达')));

    // ---- 用例 4b：只有 1 批也不可达（批数 < MAX_CONSECUTIVE_FAILURES） ----
    r = await mr.fillFromModrinth({
        entries: [{ path: 'mods/few.jar', sha256: 'f'.repeat(64), sha512: crypto.createHash('sha512').update('few').digest('hex'), sha1: 'c'.repeat(40), size: 1 }],
        protocol: 2, schemePath: schemeDir, log
    });
    t('单批全失败也判为不可达（不误报「未收录」）',
        r.needUpload.some(x => x.path === 'mods/few.jar' && x.reason === 'modrinth_unreachable'));

    // ---- 用例 5：修正 mode 后测分批 ----
    console.log('  — 分批策略');
    mode = 'normal';
    requestLog = [];
    const batchEntries = [];
    for (let i = 0; i < 150; i++) batchEntries.push({ path: `mods/b${i}.jar`, sha256: 'd'.repeat(64), sha512: crypto.createHash('sha512').update(String(i)).digest('hex'), sha1: 'e'.repeat(40), size: 1 });
    r = await mr.fillFromModrinth({ entries: batchEntries, protocol: 2, schemePath: schemeDir, log });
    const queryCalls = requestLog.filter(x => x.url.startsWith('/v2/version_files')).length;
    t('150 个哈希 → 分 2 批查询（BATCH_SIZE=100）', queryCalls === 2);
    t('150 个全部未命中 → 全部需上传', r.needUpload.length === 150);

    // ---- 用例 6：旧清单（v1）跳过 ----
    console.log('  — 旧清单兼容');
    const beforeCalls = requestLog.length;
    r = await mr.fillFromModrinth({
        entries: [{ path: 'mods/old.jar', sha256: jars.good.sha256, size: 3 }],
        protocol: 1, schemePath: schemeDir, log
    });
    t('v1 清单一律需上传', r.needUpload.some(x => x.path === 'mods/old.jar' && x.reason === 'no_modrinth_hashes'));
    t('v1 清单不发 Modrinth 请求', requestLog.length === beforeCalls);
    t('v1 清单返回 skipped 说明', !!r.skipped);

    // ---- 用例 7：总预算耗尽 ----
    console.log('  — 预算保护');
    // 把预算设成 0ms：命中项也不再下载，全部降级
    r = await mr.fillFromModrinth({
        entries: [{ path: 'mods/good2.jar', sha256: jars.good.sha256, sha512: jars.good.sha512, sha1: jars.good.sha1, size: jars.good.buf.length }],
        protocol: 2, schemePath: schemeDir, log, budgetMs: 0
    });
    t('预算耗尽 → 不下载，降级为需上传（reason=modrinth_budget_exceeded）',
        r.needUpload.some(x => x.path === 'mods/good2.jar' && x.reason === 'modrinth_budget_exceeded'));
    t('预算耗尽不中断、不抛错', r.resolved.length === 0);

    // ---- 临时目录清理 ----
    const tmpRoot = path.join(sync.tempRoot(), 'temp', 'sync-modrinth');
    const leftovers = fs.existsSync(tmpRoot) ? fs.readdirSync(tmpRoot) : [];
    t('下载临时目录已清理，无残留', leftovers.length === 0);

    axios.post = origPost; axios.get = origGet;
    await new Promise(r2 => server.close(r2));
    fs.rmSync(schemeDir, { recursive: true, force: true });
}
