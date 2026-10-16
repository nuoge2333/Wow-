/**
 * V3.5.7 文件管理 REST 路由端到端测试
 * 启动真实 Web 服务，用 fetch 逐个验证 9 条新路由（含认证、错误码、落盘结果）。
 *
 * 运行：cd core && node test/web_files_e2e.test.js
 *
 * 隔离性说明：测试使用系统临时目录作为方案根，**不碰项目内的 scheme/**，
 * 也不写 core/wow.yaml（配置通过打桩提供），可反复运行而不留下痕迹。
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// 固定 JWT secret，避免 config.getConfig('web.auth_token') 覆盖
process.env.WOW_WEB_AUTH_TOKEN = 'e2e-test-secret-v357';

const PORT = 18099;
const BASE = `http://127.0.0.1:${PORT}`;

// 方案根目录只能位于项目 scheme/ 下（utils.getServerDir 的路径约定），
// 因此这里用带 pid 的唯一子目录，避免与其他运行冲突。
const TEST_SCHEME = '_e2e_files_' + process.pid;
const root = path.join(__dirname, '..', '..', 'scheme', TEST_SCHEME);
fs.emptyDirSync(root);

// 无论进程如何退出，都尽力清理测试目录（同步钩子，保证在 exit 前执行）
process.on('exit', () => {
    try { if (fs.existsSync(root)) fs.removeSync(root); } catch (e) { /* ignore */ }
});

let passed = 0, failed = 0;
function check(title, cond, extra = '') {
    if (cond) { console.log(`  ✅ ${title}`); passed++; }
    else { console.log(`  ❌ ${title}${extra ? '  → ' + extra : ''}`); failed++; }
}

let TOKEN = '';

async function req(method, url, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + url, opts);
    let data = null;
    try { data = await r.json(); } catch (e) { /* 非 JSON */ }
    return { status: r.status, data };
}

(async () => {
    // 动态 require，确保环境变量先生效
    const webService = require('../src/web_service');
    const config = require('../src/config');

    // 让方案目录指向临时测试目录。
    // 注意：不能用 config.setConfig —— 那会写盘污染 core/wow.yaml。
    // 这里改为打桩 getConfig，只影响当前进程内 file_manager 的根目录解析。
    const origGetConfig = config.getConfig;
    config.getConfig = function (key, def) {
        if (key === 'server.scheme') return TEST_SCHEME;
        return origGetConfig.call(this, key, def);
    };

    await webService.startWeb({ port: PORT, host: '127.0.0.1' });
    await new Promise(r => setTimeout(r, 800));

    // 拿 token：直接签一个（auth_token 已由环境变量固定）
    const jwt = require('jsonwebtoken');
    TOKEN = jwt.sign({ user: 'e2e' }, 'e2e-test-secret-v357', { expiresIn: '1h' });

    console.log('\n文件管理 REST 路由端到端测试 (V3.5.7)\n');

    // ── 认证 ──
    console.log('— 认证 —');
    {
        const saved = TOKEN; TOKEN = '';
        const r = await req('POST', '/api/files/mkdir', { path: '', name: 'noauth' });
        check('无 token 时返回 401', r.status === 401, `got ${r.status}`);
        TOKEN = saved;
    }

    // ── mkdir ──
    console.log('\n— POST /api/files/mkdir —');
    let r1 = await req('POST', '/api/files/mkdir', { path: '', name: 'docs' });
    check('根目录建文件夹成功', r1.status === 200 && r1.data.success, JSON.stringify(r1.data));
    check('落盘存在', fs.existsSync(path.join(root, 'docs')));

    let r2 = await req('POST', '/api/files/mkdir', { path: 'docs', name: 'sub' });
    check('嵌套建文件夹成功', r2.status === 200, JSON.stringify(r2.data));
    check('嵌套目录落盘', fs.existsSync(path.join(root, 'docs', 'sub')));

    let r3 = await req('POST', '/api/files/mkdir', { path: '', name: 'docs' });
    check('重名返回 409', r3.status === 409, `got ${r3.status}`);

    let r4 = await req('POST', '/api/files/mkdir', { path: '', name: 'a/b' });
    check('含路径分隔符返回 403', r4.status === 403, `got ${r4.status}`);

    let r4b = await req('POST', '/api/files/mkdir', { path: '', name: 'CON' });
    check('Windows 保留名返回 403', r4b.status === 403, `got ${r4b.status}`);

    let r4c = await req('POST', '/api/files/mkdir', { path: '', name: 'bad<name>' });
    check('非法字符返回 403', r4c.status === 403, `got ${r4c.status}`);

    let r5 = await req('POST', '/api/files/mkdir', { path: '../../etc', name: 'x' });
    check('路径穿越返回 403', r5.status === 403, `got ${r5.status}`);

    let r5b = await req('POST', '/api/files/mkdir', { path: '/etc', name: 'x' });
    check('绝对路径返回 403', r5b.status === 403, `got ${r5b.status}`);

    // ── 写文本 / 读文本 ──
    console.log('\n— PUT/GET /api/files/content —');
    let w1 = await req('PUT', '/api/files/content', { path: 'docs/note.txt', content: 'hello wow' });
    check('写文本成功', w1.status === 200 && w1.data.success, JSON.stringify(w1.data));
    check('文件落盘且内容正确',
        fs.existsSync(path.join(root, 'docs', 'note.txt')) &&
        fs.readFileSync(path.join(root, 'docs', 'note.txt'), 'utf8') === 'hello wow');

    let g1 = await req('GET', '/api/files/content?path=docs/note.txt');
    check('读文本成功且内容一致', g1.status === 200 && g1.data.content === 'hello wow');

    let g2 = await req('GET', '/api/files/content?path=docs/nope.txt');
    check('读不存在文件返回 404', g2.status === 404, `got ${g2.status}`);

    // 超限
    let w2 = await req('PUT', '/api/files/content', { path: 'docs/big.txt', content: 'x'.repeat(2 * 1024 * 1024 + 10) });
    check('写入超 2MB 返回 413', w2.status === 413, `got ${w2.status}`);

    // ── rename ──
    console.log('\n— POST /api/files/rename —');
    let n1 = await req('POST', '/api/files/rename', { path: 'docs/note.txt', newName: 'readme.txt' });
    check('重命名成功', n1.status === 200, JSON.stringify(n1.data));
    check('新名存在 / 旧名消失',
        fs.existsSync(path.join(root, 'docs', 'readme.txt')) &&
        !fs.existsSync(path.join(root, 'docs', 'note.txt')));

    let n2 = await req('POST', '/api/files/rename', { path: 'docs/readme.txt', newName: 'sub' });
    check('重名返回 409', n2.status === 409, `got ${n2.status}`);

    // ── copy ──
    console.log('\n— POST /api/files/copy —');
    let c1 = await req('POST', '/api/files/copy', { from: 'docs/readme.txt', to: 'docs/sub' });
    check('复制成功', c1.status === 200, JSON.stringify(c1.data));
    check('副本落盘', fs.existsSync(path.join(root, 'docs', 'sub', 'readme.txt')));

    let c2 = await req('POST', '/api/files/copy', { from: 'docs/readme.txt', to: 'docs/sub' });
    check('复制到已存在位置返回 409', c2.status === 409, `got ${c2.status}`);

    // ── move ──
    console.log('\n— POST /api/files/move —');
    let m1 = await req('POST', '/api/files/move', { from: 'docs/sub/readme.txt', to: '' });
    check('移动到根成功', m1.status === 200, JSON.stringify(m1.data));
    check('移动后落盘', fs.existsSync(path.join(root, 'readme.txt')));

    let m2 = await req('POST', '/api/files/move', { from: 'docs', to: 'docs/sub' });
    check('移入自身子目录返回 403', m2.status === 403, `got ${m2.status}`);

    // ── compress ──
    console.log('\n— POST /api/files/compress —');
    let z1 = await req('POST', '/api/files/compress', { paths: ['docs'], dest: 'bundle.zip' });
    check('压缩成功', z1.status === 200, JSON.stringify(z1.data));
    check('zip 落盘', fs.existsSync(path.join(root, 'bundle.zip')));

    let z2 = await req('POST', '/api/files/compress', { paths: [], dest: 'empty.zip' });
    check('空列表返回 400', z2.status === 400, `got ${z2.status}`);

    // ── extract ──
    console.log('\n— POST /api/files/extract —');
    let e1 = await req('POST', '/api/files/extract', { path: 'bundle.zip', dest: 'restored' });
    check('解压成功', e1.status === 200, JSON.stringify(e1.data));
    check('解压内容落盘', fs.existsSync(path.join(root, 'restored')));

    let e2 = await req('POST', '/api/files/extract', { path: 'readme.txt', dest: 'bad' });
    check('非 zip 返回 403', e2.status === 403, `got ${e2.status}`);

    let e3 = await req('POST', '/api/files/extract', { path: 'nope.zip', dest: 'bad' });
    check('zip 不存在返回 404', e3.status === 404, `got ${e3.status}`);

    // ── delete ──
    console.log('\n— DELETE /api/files —');
    let d1 = await req('DELETE', '/api/files', { path: 'restored' });
    check('删除目录成功', d1.status === 200, JSON.stringify(d1.data));
    check('目录已消失', !fs.existsSync(path.join(root, 'restored')));

    let d2 = await req('DELETE', '/api/files', { path: '' });
    check('删除根目录返回 403', d2.status === 403, `got ${d2.status}`);

    let d3 = await req('DELETE', '/api/files', { path: 'nope.txt' });
    check('删除不存在返回 404', d3.status === 404, `got ${d3.status}`);

    let d4 = await req('DELETE', '/api/files', { path: 'bundle.zip' });
    check('删除文件成功', d4.status === 200, JSON.stringify(d4.data));

    // ── 收尾 ──
    config.getConfig = origGetConfig;  // 还原打桩
    try { webService.stopWeb(); } catch (e) { /* ignore */ }

    // 立即清理（不同步等待服务器，避免事件循环被 WebSocket/定时器挂住，
    // 导致测试进程迟迟不退出、被外层 timeout 杀掉而跳过清理）
    try { if (fs.existsSync(root)) fs.removeSync(root); } catch (e) { /* exit 钩子会再试 */ }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed ? 1 : 0);
})().catch(e => {
    console.error('测试异常:', e);
    try { fs.removeSync(root); } catch (er) { /* ignore */ }
    process.exit(1);
});
