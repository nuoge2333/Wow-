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

const manifest = await0(buildManifest());
function buildManifest() {
    // buildManifest 是 async，用同步包装
    return sync.buildManifest({ schemePath: sp, remoteName: 'demo', withConfig: true, withWorld: true });
}
function await0(p) {
    let out = null, err = null;
    p.then(v => { out = v; run(); }).catch(e => { err = e; run(); });
    function run() {
        if (err) { console.log('  ❌ buildManifest 抛错:', err.message); process.exit(1); }
        t('协议版本为 1', manifest.protocol === 1);
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
    }
}

// ==================== 3. multipart 解析 ====================
console.log('\n[3] web_service.parseMultipart —— 分块上传协议');
(async () => {
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

    console.log(`\n${'='.repeat(40)}`);
    console.log(`✅ 通过 ${passed} 项，失败 ${failed} 项`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
})();
