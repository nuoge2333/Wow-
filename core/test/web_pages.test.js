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
    assert.ok(/cmd: 'scheme delete', args: \[name, '-y'\]/.test(schemeHtml));
    assert.ok(/apiExec\('scheme info', \[name\]\)/.test(schemeHtml));
});

check('其它页面不再把变量拼进命令字符串', () => {
    for (const page of ['set.html', 'tool.html', 'scheme.html']) {
        const src = fs.readFileSync(path.join(ROOT, 'web', page), 'utf8');
        assert.ok(!/apiExec\(`[^`]*\$\{/.test(src), `${page} 仍有拼接变量的 apiExec`);
    }
});

console.log('\n📥 V3.8.0 下载中心（down.html）\n');

const downHtml = fs.readFileSync(path.join(ROOT, 'web', 'down.html'), 'utf8');

check('Tab 重排：模组搜索 / 插件搜索 / 核心下载 / 下载队列', () => {
    for (const t of ['mods', 'plugins', 'core', 'queue']) {
        assert.ok(downHtml.includes(`data-tab="${t}"`), `缺少 Tab ${t}`);
        assert.ok(downHtml.includes(`id="tab-${t}"`), `缺少 Tab 内容 ${t}`);
    }
});

check('默认源 Modrinth 且置顶（模组与插件两处）', () => {
    const hits = downHtml.match(/<option value="modrinth" selected>/g) || [];
    assert.strictEqual(hits.length, 2, '模组/插件都应默认选中 Modrinth');
    for (const sel of ['id="mod-source"', 'id="plugin-source"']) {
        const pos = downHtml.indexOf(sel);
        assert.ok(pos > 0, `缺少 ${sel}`);
        const block = downHtml.slice(pos, pos + 200);
        assert.ok(block.indexOf('value="modrinth"') < block.indexOf('value="curseforge"'),
            'CurseForge 必须排在 Modrinth 之后（次选）');
    }
});

check('筛选控件齐全：类别 / MC 版本 / 加载器（模组与插件）', () => {
    for (const id of [
        'mod-category-filter', 'mod-version-filter', 'mod-loader-filter',
        'plugin-category-filter', 'plugin-version-filter', 'plugin-loader-filter'
    ]) {
        assert.ok(downHtml.includes(`id="${id}"`), `缺少筛选控件 ${id}`);
    }
    for (const slug of ['technology', 'magic', 'optimization', 'adventure', 'library']) {
        assert.ok(downHtml.includes(`value="${slug}"`), `缺少类别 ${slug}`);
    }
});

check('插件加载器为 Bukkit 系（bukkit/spigot/paper/purpur/folia）', () => {
    const pos = downHtml.indexOf('id="plugin-loader-filter"');
    const block = downHtml.slice(pos, downHtml.indexOf('</select>', pos));
    for (const l of ['bukkit', 'spigot', 'paper', 'purpur', 'folia']) {
        assert.ok(block.includes(`value="${l}"`), `插件加载器缺少 ${l}`);
    }
});

check('搜索请求携带 category / version / projectType', () => {
    for (const frag of ["category: ui.category.value", "version: ui.version.value.trim()", 'projectType: ui.projectType']) {
        assert.ok(downHtml.includes(frag), `搜索参数缺少 ${frag}`);
    }
    assert.ok(downHtml.includes("projectType: isPlugin ? 'plugin' : 'mod'"), '插件 Tab 必须传 projectType=plugin');
});

check('下载到资源池弹窗：节点齐全且不写入方案', () => {
    for (const id of [
        'install-modal', 'install-modal-title', 'install-modal-sub',
        'install-pool-note', 'install-cf-warn',
        'install-confirm-btn', 'install-cancel-btn'
    ]) {
        assert.ok(downHtml.includes(`id="${id}"`), `缺少弹窗节点 ${id}`);
    }
    assert.ok(downHtml.includes('downloadPool') || downHtml.includes('下载到资源池'),
        '弹窗标题应体现「下载到资源池」');
    assert.ok(!downHtml.includes('install-scheme-select'), '不应再有选方案字段');
    assert.ok(!downHtml.includes("'--scheme', scheme"), '不应再提交 --scheme 参数');
});

check('下载统一走 install mod / install plugin 入池', () => {
    assert.ok(!downHtml.includes("'pool/mods/'"), '仍残留 down -o pool/mods/ 的旧写法');
    assert.ok(downHtml.includes("apiTask(command, args") && downHtml.includes("'install plugin' : 'install mod'"),
        '应按 kind 提交 install mod / install plugin 异步任务');
    assert.ok(!downHtml.includes("'mod install'"), '不应再提交已废弃的 mod install');
    assert.ok(downHtml.includes("activateTab('queue')"), '提交后应切到下载队列 Tab');
});

check('核心下载统一走 install core',
    () => assert.ok(downHtml.includes('apiTask(`install core ${type}`') || downHtml.includes('install core ${type}'),
        '核心下载应提交 install core 任务'));

console.log('\n🧩 内容页统一留白（不贴边）\n');

const mainCss = fs.readFileSync(path.join(ROOT, 'web', 'css', 'main.css'), 'utf8');
const toolHtml = fs.readFileSync(path.join(ROOT, 'web', 'tool.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(ROOT, 'web', 'login.html'), 'utf8');
const lanHtml = fs.readFileSync(path.join(ROOT, 'web', 'lan.html'), 'utf8');

check('main.css: 内容页 body 有统一留白 padding', () => {
    assert.ok(/body\s*\{[^}]*padding:\s*20px\s+24px/s.test(mainCss),
        '内容页 body 未设置 20px 24px 留白');
});

check('main.css: web 与 default 主题两份一致', () => {
    assert.strictEqual(mainCss,
        fs.readFileSync(path.join(ROOT, 'themes/default/css/main.css'), 'utf8'),
        'main.css 两份不一致');
});

check('main.css: shell / no-scroll 排除留白（否则 #app 的 100vw 会溢出）', () => {
    const m = mainCss.match(/body\.no-scroll\s*,\s*body\.shell\s*\{([^}]*)\}/);
    assert.ok(m, '找不到 shell 排除规则');
    assert.ok(/padding:\s*0/.test(m[1]), 'shell 未清零 padding');
});

check('down.html: 零散水平 margin 已清掉，改由 body 统一留白', () => {
    assert.ok(!/margin:\s*15px/.test(downHtml), '.page-header 仍有 15px 全向 margin');
    assert.ok(!/margin:\s*14px/.test(downHtml), '.tab-bar 仍有 14px 全向 margin');
    assert.ok(!/margin-left:\s*14px/.test(downHtml), '.search-bar 仍有左 margin');
    assert.ok(!/margin-right:\s*14px/.test(downHtml), '.btn-search 仍有右 margin');
});

check('tool.html: 标题不再用 10px 全向 margin 模拟留白', () => {
    assert.ok(!/margin:10px/.test(toolHtml), '工具页 h2 仍是 margin:10px');
});

check('login.html / lan.html: 不重复留白', () => {
    assert.ok(/body\s*\{[^}]*padding:\s*0/s.test(loginHtml), '登录页未显式排除 body 留白');
    assert.ok(!/lan-wrap\s*\{[^}]*padding:\s*20px\s+24px/.test(lanHtml),
        'lan-wrap 会与 body 留白叠加成双倍');
});

console.log('\n📖 内置帮助文档抽屉（纯前端展示 + 安全读取）\n');

const docsCss = fs.readFileSync(path.join(ROOT, 'web', 'css', 'docs.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const viewerJs = fs.readFileSync(path.join(ROOT, 'web', 'js', 'docs_viewer.js'), 'utf8');
const leftHtml = fs.readFileSync(path.join(ROOT, 'web', 'left.html'), 'utf8');
const rightHtml = fs.readFileSync(path.join(ROOT, 'web', 'right.html'), 'utf8');
const docsBackend = fs.readFileSync(path.join(SRC, 'web_docs.js'), 'utf8');

check('index.html: 引入本地 vendor 与 docs 样式/脚本，顺序正确且无 CDN', () => {
    assert.ok(indexHtml.includes('/css/docs.css'));
    assert.ok(indexHtml.includes('/js/vendor/marked.min.js'));
    assert.ok(indexHtml.includes('/js/vendor/purify.min.js'));
    assert.ok(indexHtml.includes('/js/docs_viewer.js'));
    const iM = indexHtml.indexOf('/js/vendor/marked.min.js');
    const iP = indexHtml.indexOf('/js/vendor/purify.min.js');
    const iV = indexHtml.indexOf('/js/docs_viewer.js');
    assert.ok(iM < iV && iP < iV, '渲染库必须在 viewer 之前加载');
    assert.ok(!/cdn\.|cdnjs|jsdelivr|unpkg/i.test(indexHtml), '渲染库不得从 CDN 加载（离线要能防 XSS）');
});

check('index.html: 抽屉 DOM 完整（遮罩 / 目录 / 渲染区 / 关闭 / 提示）', () => {
    for (const id of ['docs-overlay', 'docs-drawer', 'docs-close-btn', 'docs-nav',
        'docs-content', 'docs-toast']) {
        assert.ok(indexHtml.includes(`id="${id}"`), `缺少 ${id}`);
    }
    assert.ok(indexHtml.includes('role="dialog"') && indexHtml.includes('aria-modal="true"'));
});

check('docs.css: 右侧滑出 72vw、手机全屏、渲染区独立滚动', () => {
    assert.ok(/\.docs-overlay\s*\{[^}]*position:\s*fixed/s.test(docsCss));
    assert.ok(/\.docs-drawer\s*\{[^}]*width:\s*72vw/s.test(docsCss));
    assert.ok(/\.docs-drawer\s*\{[^}]*transform:\s*translateX\(100%\)/s.test(docsCss));
    assert.ok(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.docs-drawer\s*\{[^}]*width:\s*100vw/.test(docsCss),
        '手机端未设为全屏');
    assert.ok(/\.docs-content\s*\{[^}]*overflow-y:\s*auto/s.test(docsCss), '渲染区必须独立滚动');
});

check('docs_viewer.js: marked 渲染后必经 DOMPurify 清洗，全文件仅一处 innerHTML', () => {
    assert.ok(viewerJs.includes('window.marked.parse'), '未用 marked 渲染');
    assert.ok(viewerJs.includes('window.DOMPurify.sanitize'), '未经 DOMPurify 清洗');
    assert.ok(viewerJs.includes('FORBID_TAGS'), '未禁用 script/style 等标签');
    const writes = (viewerJs.match(/\.innerHTML\s*=/g) || []).length;
    assert.strictEqual(writes, 1, `innerHTML 写入点应只有清洗后 1 处，实际 ${writes}`);
    assert.ok(/textContent = String\(md \|\| ''\)/.test(viewerJs), '库缺失时未降级为纯文本');
});

check('docs_viewer.js: 外链强制 target=_blank + rel=noopener noreferrer', () => {
    assert.ok(viewerJs.includes("setAttribute('target', '_blank')"));
    assert.ok(viewerJs.includes("setAttribute('rel', 'noopener noreferrer')"));
    assert.ok(viewerJs.includes("addEventListener('click', onContentClick)"), '渲染区未做点击委托拦截');
});

check('docs_viewer.js: 内部 .md 链接在抽屉内切换，未开放文档不外跳', () => {
    assert.ok(viewerJs.includes('resolveDocName'));
    assert.ok(viewerJs.includes('selectDoc(target'));
    assert.ok(viewerJs.includes('该文档未开放'));
    assert.ok(viewerJs.includes('preventDefault()'));
});

check('docs_viewer.js: 危险协议兜底 + 相对图片重写到受控 asset 接口', () => {
    assert.ok(/javascript\|vbscript\|data/.test(viewerJs), '未拦截 javascript:/data: 协议');
    assert.ok(viewerJs.includes("ASSET_URL + '?name='"));
    assert.ok(viewerJs.includes('/api/docs/asset'));
});

check('docs_viewer.js: Esc / 遮罩 / X 三种关闭 + postMessage 同源校验', () => {
    assert.ok(/Escape/.test(viewerJs) && viewerJs.includes('keydown'));
    assert.ok(viewerJs.includes('e.target === overlay'));
    assert.ok(viewerJs.includes('e.origin !== window.location.origin'));
    assert.ok(viewerJs.includes("type === 'open-docs'"));
});

check('docs_viewer.js: 目录标题用 textContent，API 只传文档名', () => {
    assert.ok(viewerJs.includes('btn.textContent = d.title'));
    assert.ok(viewerJs.includes("'/api/docs/list'"));
    assert.ok(viewerJs.includes("'/api/docs/content?name='"));
    assert.ok(!viewerJs.includes('name=../../'), '前端不得拼路径');
});

check('left.html / right.html: 双入口 + postMessage 打开顶层抽屉', () => {
    assert.ok(leftHtml.includes('id="docs-open-btn-left"'));
    assert.ok(rightHtml.includes('id="docs-open-btn"'));
    assert.ok(leftHtml.includes("type: 'open-docs'"));
    assert.ok(rightHtml.includes("type: 'open-docs'"));
    assert.ok(rightHtml.includes('e.stopPropagation()'), '右上角按钮必须阻止冒泡，否则会误折叠便签栏');
});

check('web_service.js: 三条只读 docs 路由 + 非法 name 走 403', () => {
    assert.ok(webSrc.includes("app.get('/api/docs/list'"));
    assert.ok(webSrc.includes("app.get('/api/docs/content'"));
    assert.ok(webSrc.includes("app.get('/api/docs/asset'"));
    assert.ok(/r\.reason === 'forbidden' \? 403 : 404/.test(webSrc));
    assert.ok(webSrc.includes("require('./web_docs')"));
});

check('web_docs.js: 后端白名单写死，用户输入不参与路径拼接', () => {
    assert.ok(docsBackend.includes('const DOC_DEFS'));
    assert.ok(docsBackend.includes('path.resolve(REPO_ROOT, def.rel)'));
    assert.ok(!docsBackend.includes('path.join(REPO_ROOT, name)'), '禁止用 name 拼路径');
    assert.ok(docsBackend.includes('FORBIDDEN_PATTERNS'));
});

check('主题副本：docs.css / docs_viewer.js / 两份 vendor 逐字节一致', () => {
    for (const rel of ['css/docs.css', 'js/docs_viewer.js',
        'js/vendor/marked.min.js', 'js/vendor/purify.min.js']) {
        const a = path.join(ROOT, 'web', rel);
        const b = path.join(ROOT, 'themes/default', rel);
        assert.ok(fs.existsSync(b), `主题缺少 ${rel}`);
        assert.strictEqual(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'), `${rel} 未同步`);
    }
});

console.log('\n📱 移动端菜单抽屉（☰ 唤出左菜单 / 💬 唤出右便签）\n');

check('index.html: 移动端顶栏 + 遮罩四要素齐全', () => {
    const idx = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
    for (const id of ['mobile-topbar', 'mobile-menu-btn', 'mobile-notify-btn', 'mobile-backdrop']) {
        assert.ok(idx.includes(`id="${id}"`), `缺少 #${id}`);
    }
});

check('index.html: ☰/💬/遮罩 接线（menu-open / notify-open / 关闭）', () => {
    const idx = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
    assert.ok(idx.includes("toggle('menu-open')"), '菜单按钮未接 menu-open');
    assert.ok(idx.includes("toggle('notify-open')"), '便签按钮未接 notify-open');
    assert.ok(idx.includes("classList.remove('menu-open', 'notify-open')"), '遮罩/切换未关闭抽屉');
});

check('main.css: 移动端把侧栏改成可滑出抽屉（≤768px）', () => {
    const css = fs.readFileSync(path.join(ROOT, 'web/css/main.css'), 'utf8');
    assert.ok(/@media\s*\(max-width:\s*768px\)/.test(css), '缺少 768px 媒体查询');
    assert.ok(css.includes('#mobile-topbar') && css.includes('display: flex'), '顶栏未 display:flex');
    assert.ok(/#menu-frame[\s\S]*?translateX\(-100%\)/.test(css), '左菜单默认应滑出视口');
    assert.ok(css.includes('body.menu-open #menu-frame'), 'menu-open 未唤出左菜单');
    assert.ok(css.includes('body.notify-open #notify-frame'), 'notify-open 未唤出右便签');
    assert.ok(css.includes('#mobile-backdrop'), '缺少遮罩元素样式');
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

check('dashboard 控制台日志用 rAF 攒批渲染（消除突发 O(N²) 卡顿）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'web', 'dashboard.html'), 'utf8');
    assert.ok(/function scheduleRender\(\)/.test(src), '未定义攒批调度');
    assert.ok(/requestAnimationFrame/.test(src), '未使用 requestAnimationFrame');
    assert.ok(/function appendConsole[\s\S]{0,500}?scheduleRender\(\)/.test(src), 'appendConsole 未走攒批');
    assert.ok(/renderConsole\(\)/.test(src), 'renderConsole 渲染主逻辑不应被删除');
});

console.log(`\n📊 结果: ${pass} 通过, ${fail} 失败\n`);
if (fail) {
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.err.message}`));
    process.exit(1);
}
