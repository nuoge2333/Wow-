#!/usr/bin/env node
/**
 * 插件 Web UI 挂载回归
 * ----------------------------------------------------------------
 * 钉死安全边界：
 *   1. 默认关闭（不删档但要清产物）；
 *   2. 只复制插件声明的前端子目录，index.js 绝不外露；
 *   3. 符号链接 / 隐藏文件 / 超限文件不进静态目录；
 *   4. 响应头必须带 CSP：frame-ancestors 'self'; connect-src 'self';
 *   5. 不新开端口，只挂 /plugin-web/<插件>/。
 *
 * 运行：cd core && node test/plugin_web.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert');

const pluginWeb = require('../src/plugin_web');

const WORK = path.join(os.tmpdir(), `plugin_web_${process.pid}`);
fs.emptyDirSync(WORK);
const PLUGINS = path.join(WORK, 'wow-plugins');
const OUT = path.join(WORK, 'plugin-web');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}
async function checkAsync(title, fn) {
    try { await fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

/** 造一个插件 */
function makePlugin(dirName, manifest, files = {}) {
    const dir = path.join(PLUGINS, dirName);
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(dir, rel);
        fs.ensureDirSync(path.dirname(full));
        fs.writeFileSync(full, content, 'utf8');
    }
    return dir;
}

makePlugin('hello', { name: 'hello', version: '1.0.0', commands: [{ name: 'hi', handler: 'hi' }], web: 'frontend' }, {
    'index.js': 'module.exports = { hi() {} };   // 绝不能出现在静态目录里',
    'frontend/index.html': '<h1>hello ui</h1>',
    'frontend/app.js': 'console.log(1)',
    'frontend/.env': 'SECRET=1',
    'other/secret.txt': 'not-exposed'
});
makePlugin('noweb', { name: 'noweb', commands: [{ name: 'n', handler: 'n' }] }, {
    'index.js': 'module.exports={n(){}}'
});
makePlugin('evil', { name: '../evil', commands: [{ name: 'e', handler: 'e' }], web: 'frontend' }, {
    'frontend/index.html': 'x'
});
makePlugin('traverse', { name: 'traverse', commands: [{ name: 't', handler: 't' }], web: '../../etc' }, {
    'frontend/index.html': 'x'
});

console.log('\n=== 插件 Web UI 挂载 ===\n');

// 顶层 await 会让 Node 把 .js 当成 ESM，故包一层 IIFE
(async () => {

check('1 normalizeWebField 只接受安全的相对目录', () => {
    assert.strictEqual(pluginWeb.normalizeWebField('frontend'), 'frontend');
    assert.strictEqual(pluginWeb.normalizeWebField('a/b'), 'a/b');
    assert.strictEqual(pluginWeb.normalizeWebField('a\\b'), 'a/b');
    assert.strictEqual(pluginWeb.normalizeWebField('../etc'), null);
    assert.strictEqual(pluginWeb.normalizeWebField('/etc'), null);
    assert.strictEqual(pluginWeb.normalizeWebField('C:/win'), null);
    assert.strictEqual(pluginWeb.normalizeWebField(''), null);
    assert.strictEqual(pluginWeb.normalizeWebField(123), null);
});

check('2 scan 只挑声明了 web 且目录存在的插件，非法插件名被拒', () => {
    const list = pluginWeb.scan(PLUGINS);
    const names = list.map(x => x.name);
    assert.ok(names.includes('hello'));
    assert.ok(!names.includes('noweb'), '未声明 web 的插件不该出现');
    assert.ok(!names.includes('../evil'), '危险插件名不该出现');
    assert.ok(!names.includes('traverse'), '穿越型 web 目录不该出现');
});

check('3 sync 把前端资源复制到隔离目录', () => {
    const r = pluginWeb.sync({ pluginsDir: PLUGINS, outRoot: OUT });
    assert.deepStrictEqual(r.mounted, ['hello']);
    const dest = path.join(OUT, 'hello');
    assert.ok(fs.existsSync(path.join(dest, 'index.html')));
    assert.ok(fs.existsSync(path.join(dest, 'app.js')));
    assert.strictEqual(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), '<h1>hello ui</h1>');
});

check('4 index.js / 隐藏文件 / 其它子目录都不进静态目录', () => {
    const dest = path.join(OUT, 'hello');
    assert.ok(!fs.existsSync(path.join(dest, 'index.js')), 'index.js 泄漏到静态目录');
    assert.ok(!fs.existsSync(path.join(dest, '.env')), '隐藏文件泄漏到静态目录');
    assert.ok(!fs.existsSync(path.join(dest, 'secret.txt')), '非 web 子目录泄漏');
});

await checkAsync('5 符号链接被跳过（不跟随到插件目录之外）', async () => {
    const outside = path.join(WORK, 'outside.txt');
    fs.writeFileSync(outside, 'TOP_SECRET', 'utf8');
    const linkPath = path.join(PLUGINS, 'hello', 'frontend', 'leak.txt');
    try {
        fs.symlinkSync(outside, linkPath);
    } catch (e) {
        return; // 某些环境不允许建符号链接，跳过
    }
    const r = pluginWeb.sync({ pluginsDir: PLUGINS, outRoot: OUT });
    assert.deepStrictEqual(r.mounted, ['hello']);
    assert.ok(!fs.existsSync(path.join(OUT, 'hello', 'leak.txt')), '符号链接被复制出去了');
    fs.removeSync(linkPath);
});

check('6 全量重建：上一次的产物不会残留', () => {
    fs.ensureDirSync(path.join(OUT, 'ghost'));
    fs.writeFileSync(path.join(OUT, 'ghost', 'index.html'), 'old', 'utf8');
    pluginWeb.sync({ pluginsDir: PLUGINS, outRoot: OUT });
    assert.ok(!fs.existsSync(path.join(OUT, 'ghost')), '已卸载插件的页面仍可访问');
});

// ─────────────────────────────────────────────
// mount：默认关闭 / 开启后的响应头
// ─────────────────────────────────────────────
function request(port, urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
    });
}

function listen(app) {
    return new Promise((resolve) => {
        const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

await checkAsync('7 默认关闭：不挂载，且清掉历史产物', async () => {
    fs.ensureDirSync(path.join(OUT, 'hello'));
    fs.writeFileSync(path.join(OUT, 'hello', 'index.html'), 'stale', 'utf8');

    const express = require('express');
    const app = express();
    const r = pluginWeb.mount(app, { enabled: false, pluginsDir: PLUGINS, outRoot: OUT, warn: () => {}, info: () => {} });
    assert.strictEqual(r.enabled, false);
    assert.strictEqual(r.mounted.length, 0);
    assert.ok(!fs.existsSync(path.join(OUT, 'hello')), '关闭后历史产物仍在磁盘上');

    const srv = await listen(app);
    const res = await request(srv.address().port, '/plugin-web/hello/');
    srv.close();
    assert.strictEqual(res.status, 404);
});

await checkAsync('8 开启后挂到 /plugin-web/<插件>/，并带强制 CSP', async () => {
    const express = require('express');
    const app = express();
    const r = pluginWeb.mount(app, { enabled: true, pluginsDir: PLUGINS, outRoot: OUT, warn: () => {}, info: () => {} });
    assert.strictEqual(r.enabled, true);
    assert.deepStrictEqual(r.mounted, ['hello']);

    const srv = await listen(app);
    const port = srv.address().port;
    try {
        const res = await request(port, '/plugin-web/hello/');
        assert.strictEqual(res.status, 200);
        assert.match(res.body, /hello ui/);

        const csp = res.headers['content-security-policy'] || '';
        assert.match(csp, /frame-ancestors 'self'/);
        assert.match(csp, /connect-src 'self'/);
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
        assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');

        // 插件代码与隐藏文件不可达
        const js = await request(port, '/plugin-web/hello/index.js');
        assert.strictEqual(js.status, 404, 'index.js 可通过静态路由访问');
        const env = await request(port, '/plugin-web/hello/.env');
        assert.strictEqual(env.status, 404, '隐藏文件可通过静态路由访问');

        // 路径穿越
        const trav = await request(port, '/plugin-web/../plugin.json');
        assert.notStrictEqual(trav.status, 200, '路径穿越未被拦截');
    } finally {
        srv.close();
    }
});

await checkAsync('9 没有任何插件声明 web 时，开启也不报错', async () => {
    const emptyDir = path.join(WORK, 'empty-plugins');
    fs.ensureDirSync(emptyDir);
    const express = require('express');
    const app = express();
    const r = pluginWeb.mount(app, { enabled: true, pluginsDir: emptyDir, outRoot: OUT, warn: () => {}, info: () => {} });
    assert.strictEqual(r.enabled, true);
    assert.deepStrictEqual(r.mounted, []);
});

function writeSparse(file, bytes) {
    fs.ensureDirSync(path.dirname(file));
    const fd = fs.openSync(file, 'w');
    fs.ftruncateSync(fd, bytes);
    fs.closeSync(fd);
}

await checkAsync('10 单文件超限只跳过该文件，插件其余部分照常挂载', async () => {
    const bigDir = path.join(WORK, 'big-plugins');
    const dir = path.join(bigDir, 'huge');
    fs.ensureDirSync(path.join(dir, 'frontend'));
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
        name: 'huge', commands: [{ name: 'h', handler: 'h' }], web: 'frontend'
    }), 'utf8');
    writeSparse(path.join(dir, 'frontend', 'big.bin'), 6 * 1024 * 1024);
    fs.writeFileSync(path.join(dir, 'frontend', 'index.html'), 'ok', 'utf8');

    const warns = [];
    const out = path.join(WORK, 'out2');
    const r = pluginWeb.sync({ pluginsDir: bigDir, outRoot: out, warn: m => warns.push(m) });
    assert.deepStrictEqual(r.mounted, ['huge']);
    assert.ok(fs.existsSync(path.join(out, 'huge', 'index.html')));
    assert.ok(!fs.existsSync(path.join(out, 'huge', 'big.bin')), '超限文件被复制出去了');
    assert.ok(warns.some(w => w.includes('跳过')));
});

await checkAsync('11 总大小超限 → 整个插件跳过，不拖垮其它插件', async () => {
    const bigDir = path.join(WORK, 'total-plugins');
    const dir = path.join(bigDir, 'fat');
    fs.ensureDirSync(path.join(dir, 'frontend'));
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
        name: 'fat', commands: [{ name: 'f', handler: 'f' }], web: 'frontend'
    }), 'utf8');
    // 6 个 4MB = 24MB > 20MB 总上限
    for (let i = 0; i < 6; i++) writeSparse(path.join(dir, 'frontend', `f${i}.bin`), 4 * 1024 * 1024);

    const r = pluginWeb.sync({ pluginsDir: bigDir, outRoot: path.join(WORK, 'out3'), warn: () => {} });
    assert.deepStrictEqual(r.mounted, []);
    assert.strictEqual(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /上限/);
});

console.log(`\n插件 Web UI: ${passed} 通过, ${failed} 失败\n`);
fs.removeSync(WORK);
process.exitCode = failed ? 1 : 0;
})();
