/**
 * 资源池扫描端到端测试：验证下载入池（installUrl）直接落在 pool/<kind>/ 根目录的
 * 插件/模组 jar 能被 GET /api/resources 正确列出。
 *
 * 背景：poolByLoader 旧逻辑只遍历 <loader>/[version/] 子目录，
 * 而 installUrl 下载时把 jar 直接落在 pool/plugins/ 与 pool/mods/ 根目录，
 * 导致这些资源在「模组管理」页的资源池列表里完全看不到（Windows 端最明显）。
 *
 * 运行：cd core && node test/web_pool_scan_e2e.test.js
 * 隔离：scheme/ 下带 pid 的临时方案 + core/test/.tmp_pool_scan_<pid> 临时池，配置打桩不写 wow.yaml。
 */
const fs = require('fs-extra');
const path = require('path');

process.env.WOW_WEB_AUTH_TOKEN = 'e2e-poolscan-secret-v391';
const PORT = 18123;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_SCHEME = '_e2e_poolscan_' + process.pid;
const root = path.join(__dirname, '..', '..', 'scheme', TEST_SCHEME);
const poolRoot = path.join(__dirname, '.tmp_pool_scan_' + process.pid);
fs.emptyDirSync(root);
fs.emptyDirSync(poolRoot);

process.on('exit', () => {
    try { if (fs.existsSync(root)) fs.removeSync(root); } catch (e) {}
    try { if (fs.existsSync(poolRoot)) fs.removeSync(poolRoot); } catch (e) {}
});

let passed = 0, failed = 0;
function check(title, cond, extra = '') {
    if (cond) { console.log(`  ✅ ${title}`); passed++; }
    else { console.log(`  ❌ ${title}${extra ? '  → ' + extra : ''}`); failed++; }
}
async function req(url) {
    const r = await fetch(BASE + url);
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
}

(async () => {
    const webService = require('../src/web_service');
    const config = require('../src/config');

    const origGetConfig = config.getConfig;
    config.getConfig = function (key, def) {
        if (key === 'server.scheme') return TEST_SCHEME;
        if (key === 'pool.dir') return path.join('test', path.basename(poolRoot));
        if (key === 'web.require_login') return false;
        return origGetConfig.call(this, key, def);
    };
    fs.writeFileSync(path.join(root, 'scheme.yaml'), `name: ${TEST_SCHEME}\nversion: 1.20.1\nloader: paper\n`);

    // 造数据：模拟 installUrl 落盘（根目录散落 jar，无 loader 子目录）
    fs.ensureDirSync(path.join(poolRoot, 'plugins'));
    fs.ensureDirSync(path.join(poolRoot, 'mods'));
    fs.writeFileSync(path.join(poolRoot, 'plugins', 'EssentialsX.jar'), 'PLUGIN');
    fs.writeFileSync(path.join(poolRoot, 'mods', 'jei.jar'), 'MOD');
    // 同时保留一份标准 loader 布局，确保旧路径仍可用（不回归）
    fs.ensureDirSync(path.join(poolRoot, 'plugins', 'paper'));
    fs.writeFileSync(path.join(poolRoot, 'plugins', 'paper', 'ViaVersion.jar'), 'PLUGIN2');

    await webService.startWeb({ port: PORT, host: '127.0.0.1' });
    await new Promise(r => setTimeout(r, 800));

    console.log('\n资源池扫描（根目录散落 jar）端到端测试\n');

    const r = await req('/api/resources');
    check('GET /api/resources 成功', r.status === 200 && r.data && r.data.success, JSON.stringify(r.data && r.data.error));
    const poolPlugins = (r.data && r.data.pool && r.data.pool.plugins) || [];
    const poolMods = (r.data && r.data.pool && r.data.pool.mods) || [];

    check('根目录插件 EssentialsX.jar 可见', poolPlugins.some(f => f.name === 'EssentialsX.jar'), JSON.stringify(poolPlugins));
    check('根目录散落条目标记 uncategorized', poolPlugins.some(f => f.name === 'EssentialsX.jar' && f.uncategorized === true));
    check('loader 子目录插件 ViaVersion.jar 仍可见（无回归）', poolPlugins.some(f => f.name === 'ViaVersion.jar'));
    check('根目录模组 jei.jar 可见', poolMods.some(f => f.name === 'jei.jar'), JSON.stringify(poolMods));
    check('size/mtime 正常', poolPlugins.some(f => f.name === 'EssentialsX.jar' && f.size === 6 && typeof f.mtime === 'number'));

    // 收尾
    config.getConfig = origGetConfig;
    try { webService.stopWeb(); } catch (e) {}
    try { if (fs.existsSync(root)) fs.removeSync(root); } catch (e) {}
    try { if (fs.existsSync(poolRoot)) fs.removeSync(poolRoot); } catch (e) {}

    console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed ? 1 : 0);
})().catch(e => {
    console.error('测试异常:', e);
    try { fs.removeSync(root); } catch (er) {}
    try { fs.removeSync(poolRoot); } catch (er) {}
    process.exit(1);
});
