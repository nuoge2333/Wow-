#!/usr/bin/env node
/**
 * V3.6.2：Web 面板「模组管理 / 实例配置」两页 + server.properties 读写
 * ----------------------------------------------------------------
 * 覆盖点：
 *   1. server_props：解析、分组、保留注释、就地更新、追加新键、非法输入拒绝
 *   2. web_service 路由接线：/api/resources（含池布局）、toggle 三种路径、copy、
 *      /api/props GET/POST
 *   3. 页面与菜单：mods.html / props.html 存在且被 left.html 引用
 *   4. 主题副本一致性（default 主题必须同步）
 *   5. 方案名传递加固（encodeURIComponent / args 数组，防「方案不存在」）
 *
 * 运行：node test/web_pages.test.js
 */

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const SRC = path.join(__dirname, '../src');
const ROOT = path.join(__dirname, '../..');
const ServerProps = require(path.join(SRC, 'server_props'));

console.log('\n📋 server.properties 读写\n');

check('解析：忽略注释 / 空行，保留 = 之后的内容', () => {
    const { entries, map } = ServerProps.parse('#c\n\nmotd=A=B\nmax-players=20\n');
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(map.motd, 'A=B');
    assert.strictEqual(map['max-players'], '20');
});

check('读取：按分组返回常用键，其余进 others', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-read-'));
    fs.writeFileSync(path.join(tmp, 'server.properties'),
        'motd=Hi\nmax-players=20\ntotally-custom-key=1\n', 'utf8');
    const r = ServerProps.readProps(tmp);
    assert.strictEqual(r.exists, true);
    const all = r.groups.reduce((n, g) => n + g.items.length, 0);
    assert.strictEqual(all, 2, 'motd / max-players 应进分组');
    assert.strictEqual(r.others.length, 1);
    assert.strictEqual(r.others[0].key, 'totally-custom-key');
    fs.removeSync(tmp);
});

check('写入：就地更新，保留注释与顺序', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-write-'));
    const f = path.join(tmp, 'server.properties');
    fs.writeFileSync(f, '# header\nmotd=Old\nview-distance=10\n', 'utf8');
    const r = ServerProps.writeProps(tmp, { motd: '新名字' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, 1);
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(text.startsWith('# header\n'), '注释应保留');
    assert.ok(text.includes('motd=新名字'));
    assert.ok(text.indexOf('motd=') < text.indexOf('view-distance='), '顺序应保持不变');
    fs.removeSync(tmp);
});

check('写入：新键追加到末尾，且不产生连续空行', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-add-'));
    const f = path.join(tmp, 'server.properties');
    fs.writeFileSync(f, 'motd=Old\n', 'utf8');
    const r = ServerProps.writeProps(tmp, { pvp: 'true', 'white-list': 'false' });
    assert.strictEqual(r.created, 2);
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(/pvp=true\nwhite-list=false\n$/.test(text), '应依次追加并以单个换行结尾');
    assert.ok(!/\n\n\n/.test(text), '不应出现连续空行');
    fs.removeSync(tmp);
});

check('写入：值里的换行被压成空格（properties 是单行格式）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-nl-'));
    ServerProps.writeProps(tmp, { motd: 'line1\nline2\r\nline3' });
    const r = ServerProps.readProps(tmp);
    assert.strictEqual(r.values.motd, 'line1 line2 line3');
    fs.removeSync(tmp);
});

check('写入：非法键名整批拒绝，不落半截修改', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-bad-'));
    const f = path.join(tmp, 'server.properties');
    fs.writeFileSync(f, 'motd=Keep\n', 'utf8');
    const r = ServerProps.writeProps(tmp, { pvp: 'true', 'bad key': 'x' });
    assert.strictEqual(r.ok, false);
    assert.ok(/非法配置项名称/.test(r.reason));
    assert.strictEqual(fs.readFileSync(f, 'utf8'), 'motd=Keep\n', '文件不应被改动');
    fs.removeSync(tmp);
});

check('写入：超长值截断到 1024 字符', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-long-'));
    ServerProps.writeProps(tmp, { motd: 'a'.repeat(4000) });
    const r = ServerProps.readProps(tmp);
    assert.strictEqual(r.values.motd.length, 1024);
    fs.removeSync(tmp);
});

check('写入：不存在的文件会被创建（首次配置）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-create-'));
    const r = ServerProps.writeProps(tmp, { motd: 'fresh', 'max-players': '10' });
    assert.strictEqual(r.ok, true);
    assert.ok(fs.existsSync(path.join(tmp, 'server.properties')));
    fs.removeSync(tmp);
});

console.log('\n📋 web_service 路由接线（静态断言）\n');

const webSrc = fs.readFileSync(path.join(SRC, 'web_service.js'), 'utf8');

check('注册 /api/resources 与 /api/resources/toggle、/copy', () => {
    assert.ok(/app\.get\('\/api\/resources'/.test(webSrc));
    assert.ok(/app\.post\('\/api\/resources\/toggle'/.test(webSrc));
    assert.ok(/app\.post\('\/api\/resources\/copy'/.test(webSrc));
});

check('注册 /api/props 的 GET 与 POST', () => {
    assert.ok(/app\.get\('\/api\/props'/.test(webSrc));
    assert.ok(/app\.post\('\/api\/props'/.test(webSrc));
});

check('toggle 支持 mods-disabled 目录（clone-client 的禁用方式）', () => {
    assert.ok(/mods-disabled/.test(webSrc));
    assert.ok(/mods-disabled\/ 是 clone-client 的禁用区/.test(webSrc));
});

check('池列表兼容「插件无版本层」的目录布局', () => {
    assert.ok(/插件池的布局是 plugins\/<loader>\/\*\.jar/.test(webSrc));
});

check('方案不存在返回 404、未激活方案返回 400', () => {
    assert.ok(/方案「\$\{name\}」不存在/.test(webSrc));
    assert.ok(/当前没有激活方案/.test(webSrc));
});

console.log('\n📋 页面与菜单\n');

check('mods.html / props.html 存在且引用了对应 API', () => {
    const mods = fs.readFileSync(path.join(ROOT, 'web/mods.html'), 'utf8');
    const props = fs.readFileSync(path.join(ROOT, 'web/props.html'), 'utf8');
    assert.ok(/\/api\/resources/.test(mods));
    assert.ok(/\/api\/resources\/toggle/.test(mods));
    assert.ok(/\/api\/resources\/copy/.test(mods));
    assert.ok(/\/api\/props/.test(props));
});

check('left.html 菜单含「模组管理」「实例配置」', () => {
    const left = fs.readFileSync(path.join(ROOT, 'web/left.html'), 'utf8');
    assert.ok(/data-page="mods"/.test(left));
    assert.ok(/data-page="props"/.test(left));
    assert.ok(/模组管理/.test(left));
    assert.ok(/实例配置/.test(left));
});

check('props.html 对改动项做高亮，且保存只提交变化', () => {
    const props = fs.readFileSync(path.join(ROOT, 'web/props.html'), 'utf8');
    assert.ok(/classList\.add\('changed'\)/.test(props));
    assert.ok(/original\[key\] !== value/.test(props));
});

console.log('\n📋 方案名传递加固（「方案不存在」相关）\n');

const schemeHtml = fs.readFileSync(path.join(ROOT, 'web/scheme.html'), 'utf8');

check('详情 URL 对方案名编码（# 不再截断路径）', () => {
    assert.ok(/encodeURIComponent\(name\)\}\/status/.test(schemeHtml));
});

check('switch / delete / info 用 args 数组传方案名（含空格不再拆错）', () => {
    assert.ok(/cmd: 'scheme switch', args: \[name\]/.test(schemeHtml));
    assert.ok(/cmd: 'scheme delete', args: \[name\]/.test(schemeHtml));
    assert.ok(/apiExec\('scheme info', \[name\]\)/.test(schemeHtml));
});

check('其它页面不再把变量拼进命令字符串', () => {
    for (const page of ['set.html', 'tool.html', 'scheme.html']) {
        const src = fs.readFileSync(path.join(ROOT, 'web', page), 'utf8');
        assert.ok(!/apiExec\(`[^`]*\$\{/.test(src), `${page} 仍有拼接变量的 apiExec`);
    }
});

console.log('\n📋 主题副本一致性\n');

check('default 主题与 web 目录的页面全部一致', () => {
    const pages = ['mods.html', 'props.html', 'left.html', 'right.html', 'index.html',
        'scheme.html', 'set.html', 'tool.html', 'file.html', 'dashboard.html',
        'down.html', 'lan.html', 'login.html'];
    for (const p of pages) {
        const a = path.join(ROOT, 'web', p);
        const b = path.join(ROOT, 'themes/default', p);
        assert.ok(fs.existsSync(b), `主题缺少 ${p}`);
        assert.strictEqual(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'), `${p} 未同步`);
    }
});

console.log(`\n📊 结果: ${pass} 通过, ${fail} 失败\n`);
if (fail) {
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.err.message}`));
    process.exit(1);
}
