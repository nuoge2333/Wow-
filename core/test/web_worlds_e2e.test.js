/**
 * 多存档管理 + 图标 REST 路由端到端测试
 * 启动真实 Web 服务，验证存档列表/迁移/新建/切换/图标保存/素材库复制全链路。
 *
 * 运行：cd core && node test/web_worlds_e2e.test.js
 * 隔离：用 scheme/ 下带 pid 的临时目录，配置通过打桩提供，不写 core/wow.yaml。
 */
const fs = require('fs-extra');
const path = require('path');

process.env.WOW_WEB_AUTH_TOKEN = 'e2e-worlds-secret-v357';
const PORT = 18117;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_SCHEME = '_e2e_worlds_' + process.pid;
const root = path.join(__dirname, '..', '..', 'scheme', TEST_SCHEME);
// utils.getPoolPath 把 pool.dir 相对 core/ 解析，故真实落盘在 core/test/.tmp_worlds_pool_<pid>
const poolRoot = path.join(__dirname, '.tmp_worlds_pool_' + process.pid);
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
let TOKEN = '';
async function req(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + url, opts);
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

(async () => {
    const webService = require('../src/web_service');
    const config = require('../src/config');

    // 打桩：当前方案 → 测试目录；pool.dir → 临时池；不写盘
    const origGetConfig = config.getConfig;
    config.getConfig = function (key, def) {
        if (key === 'server.scheme') return TEST_SCHEME;
        if (key === 'pool.dir') return path.join('test', path.basename(poolRoot));
        if (key === 'web.require_login') return false;
        return origGetConfig.call(this, key, def);
    };
    // 让 scheme_manager / utils 把方案根指向测试目录：
    // 由于 utils.resolvePath 固定到项目 scheme/，测试方案即 scheme/<TEST_SCHEME>，已由 root 提供。
    fs.writeFileSync(path.join(root, 'scheme.yaml'), `name: ${TEST_SCHEME}\nversion: 1.20.1\nloader: vanilla\n`);

    // V3.9.x：startWeb 现在会在启动时对所有方案做一次全局旧存档迁移。
    // 因此在 startWeb 之后再造旧 world，专门验证 GET /api/worlds 的兜底迁移路径。
    await webService.startWeb({ port: PORT, host: '127.0.0.1' });
    await new Promise(r => setTimeout(r, 800));

    console.log('\n多存档 + 图标 REST 路由端到端测试\n');

    // ── 存档列表 + 自动迁移 ──
    console.log('— GET /api/worlds —');
    fs.writeFileSync(path.join(root, 'server.properties'), '# 测试配置\nlevel-name=world\n');
    fs.ensureDirSync(path.join(root, 'world'));
    fs.writeFileSync(path.join(root, 'world', 'level.dat'), 'OLD');
    let r = await req('GET', '/api/worlds');
    check('列表成功', r.status === 200 && r.data.success, JSON.stringify(r.data));
    check('自动迁移旧 world', r.data && r.data.migration && r.data.migration.migrated === true, JSON.stringify(r.data && r.data.migration));
    check('level-name 改为 saves/world', r.data && r.data.levelName === 'saves/world', r.data && r.data.levelName);
    check('迁移后列表含 world', r.data && r.data.worlds && r.data.worlds.some(w => w.name === 'world'));
    const rawProps = fs.readFileSync(path.join(root, 'server.properties'), 'utf8');
    check('注释保留', rawProps.includes('# 测试配置'));

    // ── 新建存档 ──
    console.log('\n— POST /api/worlds/create —');
    r = await req('POST', '/api/worlds/create', { name: 'my_survival', seed: '999', levelType: 'flat' });
    check('新建成功', r.status === 200 && r.data.success, JSON.stringify(r.data));
    check('目录落盘', fs.existsSync(path.join(root, 'saves', 'my_survival')));
    check('level-name 指向新档', fs.readFileSync(path.join(root, 'server.properties'), 'utf8').includes('level-name=saves/my_survival'));
    r = await req('POST', '/api/worlds/create', { name: '../evil', levelType: 'normal' });
    check('非法名被拒', r.status === 400 && !r.data.success, `got ${r.status}`);

    // ── 切换存档 ──
    console.log('\n— POST /api/worlds/switch —');
    // 造一个带 level.dat 的存档
    fs.ensureDirSync(path.join(root, 'saves', 'target'));
    fs.writeFileSync(path.join(root, 'saves', 'target', 'level.dat'), 'X');
    r = await req('POST', '/api/worlds/switch', { name: 'target' });
    check('切换成功', r.status === 200 && r.data.success, JSON.stringify(r.data));
    check('level-name 更新', fs.readFileSync(path.join(root, 'server.properties'), 'utf8').includes('level-name=saves/target'));
    r = await req('POST', '/api/worlds/switch', { name: 'no_such' });
    check('切换不存在存档被拒', r.status === 400, `got ${r.status}`);

    // ── 图标保存双写 ──
    console.log('\n— POST /api/icons/save —');
    r = await req('POST', '/api/icons/save', { image: 'data:image/png;base64,' + PNG_B64, toPool: true, poolName: 'workbench' });
    check('保存成功', r.status === 200 && r.data.success, JSON.stringify(r.data));
    check('server-icon.png 落盘', fs.existsSync(path.join(root, 'server-icon.png')));
    check('当前存档 icon.png 落盘', fs.existsSync(path.join(root, 'saves', 'target', 'icon.png')));
    check('存入素材库落盘', fs.existsSync(path.join(poolRoot, 'icons', 'workbench.png')));

    // ── 素材库列表 + 应用 ──
    console.log('\n— GET /api/icons/pool / POST /api/icons/apply —');
    r = await req('GET', '/api/icons/pool');
    check('素材库列表含 workbench', r.status === 200 && r.data.icons && r.data.icons.some(i => i.name === 'workbench.png'), JSON.stringify(r.data));
    check('缩略图为 data URI', r.data && r.data.icons && r.data.icons[0] && r.data.icons[0].dataUrl.startsWith('data:image/png;base64,'));
    // 清空目标图标再应用
    fs.removeSync(path.join(root, 'server-icon.png'));
    r = await req('POST', '/api/icons/apply', { name: 'workbench.png' });
    check('应用素材成功', r.status === 200 && r.data.success, JSON.stringify(r.data));
    check('应用后 server-icon 恢复', fs.existsSync(path.join(root, 'server-icon.png')));
    r = await req('POST', '/api/icons/apply', { name: '../../evil.png' });
    check('路径穿越被拒', r.status === 400, `got ${r.status}`);

    // ── 收尾 ──
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
