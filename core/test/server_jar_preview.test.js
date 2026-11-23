/**
 * 启动核心文件名解析 / 预览一致性测试（feat/ai-provider 分支顺带修复）
 *
 * 背景：Web 设置页「最终启动命令」预览曾硬编码 `server.jar`，但方案创建时
 * installer 会把核心命名为 vanilla-<ver>.jar / paper-<ver>.jar / mohist-<ver>-<build>.jar，
 * 项目里根本没有 server.jar —— 预览命令永远指向不存在的文件（用户报「启动命令带错路径」）。
 *
 * 修法：把 server._getServerJar 抽成纯函数 ServerManager.resolveServerJar(serverDir, config)，
 * 真实开服与 Web 预览共用；预览不再硬编码。
 *
 * 本测试全程用临时目录 + 配置桩，不联网、不 new ServerManager（无副作用）。
 * 运行：cd core && node test/server_jar_preview.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const ServerManager = require('../src/server');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

const WORK = path.join(os.tmpdir(), 'server_jar_preview_test');
fs.emptyDirSync(WORK);

function cfg(map) {
    return { getConfig: (k, d) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : d) };
}

console.log('\n=== resolveServerJar：与真实开服同一解析逻辑 ===');

check('vanilla：识别出 vanilla-1.20.1.jar（不再是 server.jar）', () => {
    const dir = path.join(WORK, 'vanilla');
    fs.emptyDirSync(dir);
    fs.writeFileSync(path.join(dir, 'vanilla-1.20.1.jar'), 'x');
    const got = ServerManager.resolveServerJar(dir, cfg({}));
    assert.strictEqual(got, 'vanilla-1.20.1.jar');
});

check('mohist：识别出带构建号的核心名', () => {
    const dir = path.join(WORK, 'mohist');
    fs.emptyDirSync(dir);
    fs.writeFileSync(path.join(dir, 'mohist-1.20.1-1003.jar'), 'x');
    assert.strictEqual(ServerManager.resolveServerJar(dir, cfg({})), 'mohist-1.20.1-1003.jar');
});

check('配置记录的 server.jar 优先于目录扫描', () => {
    const dir = path.join(WORK, 'cfg');
    fs.emptyDirSync(dir);
    fs.writeFileSync(path.join(dir, 'paper-1.20.1.jar'), 'x');
    fs.writeFileSync(path.join(dir, 'custom-core.jar'), 'x');
    const got = ServerManager.resolveServerJar(dir, cfg({ 'server.jar': 'custom-core.jar' }));
    assert.strictEqual(got, 'custom-core.jar');
});

check('配置指向不存在文件时回退目录扫描（防陈旧配置）', () => {
    const dir = path.join(WORK, 'stale');
    fs.emptyDirSync(dir);
    fs.writeFileSync(path.join(dir, 'vanilla-1.21.jar'), 'x');
    const got = ServerManager.resolveServerJar(dir, cfg({ 'server.jar': 'old-gone.jar' }));
    assert.strictEqual(got, 'vanilla-1.21.jar');
});

check('排除 installer / authlib-injector', () => {
    const dir = path.join(WORK, 'exclude');
    fs.emptyDirSync(dir);
    fs.writeFileSync(path.join(dir, 'forge-1.20.1-installer.jar'), 'x');
    fs.writeFileSync(path.join(dir, 'authlib-injector.jar'), 'x');
    fs.writeFileSync(path.join(dir, 'paper-1.20.1.jar'), 'x');
    assert.strictEqual(ServerManager.resolveServerJar(dir, cfg({})), 'paper-1.20.1.jar');
});

check('Forge/NeoForge：优先 forge- 前缀而非原版 minecraft_server', () => {
    const dir = path.join(WORK, 'forge');
    fs.emptyDirSync(dir);
    fs.writeFileSync(path.join(dir, 'minecraft_server.1.20.1.jar'), 'x');
    fs.writeFileSync(path.join(dir, 'forge-1.20.1-47.2.0.jar'), 'x');
    const got = ServerManager.resolveServerJar(dir, cfg({ 'server.type': 'forge' }));
    assert.strictEqual(got, 'forge-1.20.1-47.2.0.jar');
});

check('目录不存在时尊重配置记录（预览场景目录未物化）', () => {
    const dir = path.join(WORK, 'not-exist');
    const got = ServerManager.resolveServerJar(dir, cfg({ 'server.jar': 'paper-1.20.1.jar' }));
    assert.strictEqual(got, 'paper-1.20.1.jar');
});

check('无核心且无配置 → 抛错（不凭空造 server.jar）', () => {
    const dir = path.join(WORK, 'empty');
    fs.emptyDirSync(dir);
    assert.throws(() => ServerManager.resolveServerJar(dir, cfg({})), /未找到服务器核心/);
});

console.log('\n=== web_service 预览端点不再主路径硬编码 ===');

const webSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'web_service.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const setHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'set.html'), 'utf8');

check('server.js 导出 resolveServerJar 供预览复用', () => {
    assert.ok(/ServerManager\.resolveServerJar\s*=\s*resolveServerJar/.test(serverSrc), '未导出解析函数');
});

check('_getServerJar 委托给 resolveServerJar（单一逻辑源）', () => {
    assert.ok(/_getServerJar\(\)\s*\{[\s\S]{0,120}?resolveServerJar\(this\.serverDir, this\.config\)/.test(serverSrc),
        '_getServerJar 未复用纯函数');
});

check('preview-jvm 调用 resolveServerJar 而非写死 server.jar', () => {
    assert.ok(/ServerManager\.resolveServerJar\(/.test(webSrc), '预览未调用统一解析');
    // 主路径不应再有 `|| 'server.jar'` 作为 jar 名的唯一来源
    assert.ok(!/\|\|\s*'server\.jar';\s*\n\s*const command/.test(webSrc), '仍有硬编码 server.jar 兜底到命令');
});

check('前端仍原样展示后端 command（零拼接）', () => {
    assert.ok(setHtml.includes('cmdEl.textContent = r.command'), '前端未原样展示');
    assert.ok(!/['"]-jar['"]/.test(setHtml), '前端出现 -jar 拼接');
});

try { fs.removeSync(WORK); } catch (e) { /* ignore */ }
console.log(`\n通过 ${passed} 项，失败 ${failed} 项\n`);
process.exit(failed ? 1 : 0);
