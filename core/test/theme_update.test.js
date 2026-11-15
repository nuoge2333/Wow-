#!/usr/bin/env node
/**
 * 主题包更新机制（V3.9.0）——更新源解析 + 安全防滚 单元测试
 * ----------------------------------------------------------------
 * 全程本地 HTTP server + 自造 zip，不打真实网络。锁定 P0 红线：
 * 备份 / 身份校验 / 版本兼容 / Zip Slip / 失败自动回滚 / 超时提示。
 */
const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const http = require('http');
const axios = require('axios');
const AdmZip = require('adm-zip');

const SRC = path.join(__dirname, '../src');
const ROOT = path.join(__dirname, '../..');
const ThemeUpdater = require(path.join(SRC, 'theme_updater'));
const { parseSource, compareVersions, isCompatible } = ThemeUpdater;

let pass = 0, fail = 0;
const failures = [];
async function check(name, fn) {
    try { await fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; failures.push({ name, e }); console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 造 zip：entries = { '相对路径': 内容 }，返回 Buffer ──
function makeZip(entries) {
    const z = new AdmZip();
    for (const [name, content] of Object.entries(entries)) {
        z.addFile(name, Buffer.from(content));
    }
    return z.toBuffer();
}
const metaJson = (o) => JSON.stringify(Object.assign({
    name: '默认主题', author: 'nuoge', version: '2.0.0',
    compatible: '3.0.0', description: '测试主题', type: 'theme'
}, o));
// 正常包：套一层目录（测 _locateRoot）
const goodZip = (metaOverride, extra = {}) => makeZip(Object.assign({
    'theme/theme.json': metaJson(metaOverride),
    'theme/set.html': '<html>NEW</html>',
    'theme/css/set.css': '.x{}'
}, extra));

// 伪造真实 Zip Slip 恶意包：adm-zip 的 addFile 会自动规范化 "../"，
// 这里用等长字节替换，把占位文件名改成 "../evil.txt"（模拟第三方工具造的恶意 zip），
// local header + central directory 两处都会被替换，getEntries() 读到带 .. 的条目名。
function makeZipSlipZip() {
    const z = new AdmZip();
    z.addFile('theme/theme.json', Buffer.from(metaJson()));
    z.addFile('PWNME00.txt', Buffer.from('escape'));
    const buf = z.toBuffer();
    const from = Buffer.from('PWNME00.txt');   // 11 字节
    const to = Buffer.from('../evil.txt');     // 11 字节，等长
    let idx, n = 0;
    while ((idx = buf.indexOf(from)) !== -1) { to.copy(buf, idx); n++; }
    assert.strictEqual(n, 2, '应替换 local header + central directory 两处');
    return buf;
}

let server, PORT, BASE;
const routes = {};
const handler = (req, res) => {
    const key = req.url.split('?')[0];
    if (key === '/slow') { setTimeout(() => { try { res.end('late'); } catch (e) {} }, 600); return; }
    if (key === '/redirect.zip') { res.writeHead(302, { Location: '/direct.zip' }); res.end(); return; }
    if (key === '/notzip') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not a zip</html>'); return; }
    const r = routes[key];
    if (!r) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': r.length });
    res.end(r);
};

// ── 构造隔离环境 ──
function makeEnv(metaOverride, opts = {}) {
    const root = path.join(os.tmpdir(), `wow_thm_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const themesDir = path.join(root, 'themes');
    const webDir = path.join(root, 'web');
    const name = opts.name || 'default';
    const themeDir = path.join(themesDir, name);
    fs.ensureDirSync(themeDir);
    const oldMeta = Object.assign({
        name: '默认主题', author: 'nuoge', version: '1.0.0',
        compatible: '3.0.0', description: '旧版', type: 'theme',
        update_url: `${BASE}${opts.source || '/direct.zip'}`
    }, metaOverride || {});
    fs.writeFileSync(path.join(themeDir, 'theme.json'), JSON.stringify(oldMeta, null, 2));
    fs.writeFileSync(path.join(themeDir, 'set.html'), '<html>OLD</html>');
    fs.ensureDirSync(webDir);
    fs.writeFileSync(path.join(webDir, 'set.html'), '<html>OLD</html>');

    const tm = {
        themesDir, webDir,
        config: { getConfig: (k, d) => (k === 'web.theme' ? (opts.active || 'default') : d) },
        _applyTheme: (n) => {
            if (opts.failApply) throw new Error('模拟 web 应用失败');
            fs.removeSync(webDir);
            fs.copySync(path.join(themesDir, n), webDir);
        }
    };
    const updater = new ThemeUpdater(tm, {
        axios,
        currentVersion: '3.8.1-26.49',
        timeoutMs: opts.timeoutMs || 3000
    });
    return { root, themesDir, webDir, name, themeDir, tm, updater, oldMeta };
}

async function main() {
    server = http.createServer(handler);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    PORT = server.address().port;
    BASE = `http://127.0.0.1:${PORT}`;
    routes['/direct.zip'] = goodZip();
    routes['/incompatible.zip'] = goodZip({ compatible: '99.0.0' });
    routes['/wrongname.zip'] = goodZip({ name: '另一个主题' });
    routes['/same.zip'] = goodZip({ version: '1.0.0' });
    routes['/malicious.zip'] = makeZipSlipZip();
    routes['/nosrc.zip'] = makeZip({ 'theme/theme.json': metaJson({ name: '默认主题' }) });

    console.log('\n🎨 主题更新机制（更新源解析 + 安全防滚）\n');

    // ── 1. 源类型解析（纯函数） ──
    await check('GitHub 仓库主页 → git，owner/repo 正确', () => {
        const r = parseSource('https://github.com/nuoge/wow-theme');
        assert.strictEqual(r.kind, 'git');
        assert.strictEqual(r.owner, 'nuoge');
        assert.strictEqual(r.repo, 'wow-theme');
    });
    await check('Gitee / GitLab 仓库主页 → git', () => {
        assert.strictEqual(parseSource('https://gitee.com/a/b').kind, 'git');
        assert.strictEqual(parseSource('https://gitlab.com/a/b/-/tree/main').kind, 'git');
    });
    await check('带 .git 后缀能去掉', () => {
        assert.strictEqual(parseSource('https://github.com/a/b.git').repo, 'b');
    });
    await check('GitHub 上的 .zip 直链 → direct（不走 API）', () => {
        const r = parseSource('https://github.com/a/b/raw/main/theme.zip');
        assert.strictEqual(r.kind, 'direct');
        assert.ok(r.downloadUrl.endsWith('.zip'));
    });
    await check('私人网盘 / 静态博客直链 → direct', () => {
        const r = parseSource('https://pan.example.com/dl/theme.zip?x=1');
        assert.strictEqual(r.kind, 'direct');
    });
    await check('非 http/https / 空 URL 被拒绝', () => {
        assert.throws(() => parseSource('ftp://x/a.zip'), /http/);
        assert.throws(() => parseSource(''), /为空/);
        assert.throws(() => parseSource('不是URL'), /合法 URL/);
    });

    // ── 2. 版本比较 / 兼容判断 ──
    await check('版本号逐段比较（含 - 后缀）', () => {
        assert.strictEqual(compareVersions('2.0.0', '1.0.0'), 1);
        assert.strictEqual(compareVersions('1.0.0', '1.0.1'), -1);
        assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
        assert.strictEqual(compareVersions('3.8.1-26.49', '3.0.0'), 1);
    });
    await check('compatible 作为最低版本：当前 3.8.1 兼容 3.0.0，不兼容 99.0.0', () => {
        assert.strictEqual(isCompatible('3.0.0', '3.8.1-26.49'), true);
        assert.strictEqual(isCompatible('99.0.0', '3.8.1-26.49'), false);
        assert.strictEqual(isCompatible('>=3.5.0', '3.8.1-26.49'), true);
    });

    // ── 3. 正常更新（P0 全流程） ──
    await check('直链更新成功：版本升级、内容替换、_bak 清理、web/ 同步', async () => {
        const e = makeEnv();
        try {
            const r = await e.updater.update(e.name);
            assert.strictEqual(r.updated, true);
            assert.strictEqual(r.from, '1.0.0');
            assert.strictEqual(r.to, '2.0.0');
            const m = JSON.parse(fs.readFileSync(path.join(e.themeDir, 'theme.json'), 'utf8'));
            assert.strictEqual(m.version, '2.0.0');
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('NEW'));
            assert.strictEqual(fs.existsSync(path.join(e.themesDir, `${e.name}_bak`)), false, '_bak 应被清理');
            // 当前主题 → web/ 同步
            assert.ok(fs.readFileSync(path.join(e.webDir, 'set.html'), 'utf8').includes('NEW'));
        } finally { fs.removeSync(e.root); }
    });

    await check('跟随重定向（maxRedirects，等价 curl -L）', async () => {
        const e = makeEnv(null, { source: '/redirect.zip' });
        try {
            const r = await e.updater.update(e.name);
            assert.strictEqual(r.updated, true);
        } finally { fs.removeSync(e.root); }
    });

    await check('checkUpdate 只读：不修改任何主题文件', async () => {
        const e = makeEnv();
        try {
            const r = await e.updater.checkUpdate(e.name);
            assert.strictEqual(r.hasUpdate, true);
            assert.strictEqual(r.remoteVersion, '2.0.0');
            const m = JSON.parse(fs.readFileSync(path.join(e.themeDir, 'theme.json'), 'utf8'));
            assert.strictEqual(m.version, '1.0.0', '旧版不应被改动');
            assert.strictEqual(fs.existsSync(path.join(e.themesDir, `${e.name}_bak`)), false);
        } finally { fs.removeSync(e.root); }
    });

    await check('已是最新版本：不动任何文件', async () => {
        const e = makeEnv(null, { source: '/same.zip' });
        try {
            const before = fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8');
            const r = await e.updater.update(e.name);
            assert.strictEqual(r.updated, false);
            assert.ok(/已是最新/.test(r.reason));
            assert.strictEqual(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8'), before);
            assert.strictEqual(fs.existsSync(path.join(e.themesDir, `${e.name}_bak`)), false);
        } finally { fs.removeSync(e.root); }
    });

    await check('--force 忽略版本比对强制重装', async () => {
        const e = makeEnv(null, { source: '/same.zip' });
        try {
            const r = await e.updater.update(e.name, { force: true });
            assert.strictEqual(r.updated, true);
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('NEW'));
        } finally { fs.removeSync(e.root); }
    });

    // ── 4. 校验失败 → 中止 + 保留旧版 ──
    await check('P0 身份校验：name 不一致中止，旧版完整', async () => {
        const e = makeEnv(null, { source: '/wrongname.zip' });
        try {
            await assert.rejects(() => e.updater.update(e.name), /身份不符/);
            const m = JSON.parse(fs.readFileSync(path.join(e.themeDir, 'theme.json'), 'utf8'));
            assert.strictEqual(m.version, '1.0.0');
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('OLD'));
            assert.strictEqual(fs.existsSync(path.join(e.themesDir, `${e.name}_bak`)), false);
        } finally { fs.removeSync(e.root); }
    });

    await check('P0 兼容校验：版本不兼容中止并提示保留旧版', async () => {
        const e = makeEnv(null, { source: '/incompatible.zip' });
        try {
            await assert.rejects(() => e.updater.update(e.name), /不兼容.*已保留旧版/);
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('OLD'));
        } finally { fs.removeSync(e.root); }
    });

    await check('P0 Zip Slip：含 ../ 条目整体中止（复用 file_manager 防御）', async () => {
        const e = makeEnv(null, { source: '/malicious.zip' });
        try {
            await assert.rejects(() => e.updater.update(e.name), /Zip Slip|非法路径/);
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('OLD'));
            assert.strictEqual(fs.existsSync(path.join(e.root, 'pwned.txt')), false, '不能有逃逸文件');
        } finally { fs.removeSync(e.root); }
    });

    await check('下载内容非 ZIP（HTML）→ 中止并保留旧版', async () => {
        const e = makeEnv(null, { source: '/notzip' });
        try {
            await assert.rejects(() => e.updater.update(e.name), /不是有效的 ZIP/);
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('OLD'));
        } finally { fs.removeSync(e.root); }
    });

    await check('未声明 update_url → 明确提示，不联网', async () => {
        const e = makeEnv({ update_url: undefined });
        try {
            await assert.rejects(() => e.updater.update(e.name), /update_url/);
        } finally { fs.removeSync(e.root); }
    });

    // ── 5. 事务中途失败 → 自动回滚（含 web/） ──
    await check('P0：_applyTheme 中途抛错 → 主题与 web/ 完整还原', async () => {
        const e = makeEnv(null, { failApply: true });
        try {
            await assert.rejects(() => e.updater.update(e.name), /模拟 web 应用失败/);
            const m = JSON.parse(fs.readFileSync(path.join(e.themeDir, 'theme.json'), 'utf8'));
            assert.strictEqual(m.version, '1.0.0', '旧版 theme.json 应还原');
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('OLD'));
            assert.ok(fs.readFileSync(path.join(e.webDir, 'set.html'), 'utf8').includes('OLD'), 'web/ 面板不能白屏');
            assert.strictEqual(fs.existsSync(path.join(e.themesDir, `${e.name}_bak`)), false, '_bak 应被还原消耗');
        } finally { fs.removeSync(e.root); }
    });

    await check('P0：崩溃残留只有 _bak → 自动自愈还原旧版', async () => {
        const e = makeEnv();
        try {
            // 模拟上次崩溃后残留：把正式目录改名成 _bak
            fs.moveSync(e.themeDir, path.join(e.themesDir, `${e.name}_bak`), { overwrite: true });
            await assert.rejects(() => e.updater.update(e.name), /残留|还原/);
            assert.ok(fs.existsSync(path.join(e.themeDir, 'theme.json')), '旧版应被还原');
            assert.strictEqual(fs.existsSync(path.join(e.themesDir, `${e.name}_bak`)), false);
        } finally { fs.removeSync(e.root); }
    });

    // ── 6. 超时 / 网络容错 ──
    await check('网络超时（30s 默认，测试用小超时）→ 提示检查网络且旧版完整', async () => {
        const e = makeEnv(null, { source: '/slow', timeoutMs: 150 });
        try {
            await assert.rejects(() => e.updater.update(e.name), /检查网络|超时/);
            assert.ok(fs.readFileSync(path.join(e.themeDir, 'set.html'), 'utf8').includes('OLD'));
        } finally { fs.removeSync(e.root); }
    });
    await check('常量：默认网络超时为 30 秒', () => {
        assert.strictEqual(ThemeUpdater.NETWORK_TIMEOUT_MS, 30000);
    });

    // ── 7. Git 源转 API（注入 axios mock，验证 URL 转换 + zipball_url） ──
    await check('GitHub releases/latest → 取 zipball_url（带 UA、30s）', async () => {
        const calls = [];
        const mockAxios = {
            get: async (url, cfg) => {
                calls.push({ url, cfg });
                if (/releases\/latest$/.test(url)) return { data: { zipball_url: `${BASE}/direct.zip`, tag_name: 'v2.0.0' } };
                return { data: {} };
            }
        };
        const e = makeEnv();
        try {
            const u = new ThemeUpdater(e.tm, { axios: mockAxios, currentVersion: '3.8.1-26.49' });
            const dl = await u.resolveDownloadUrl('https://github.com/nuoge/wow-theme');
            assert.strictEqual(dl, `${BASE}/direct.zip`);
            assert.ok(calls[0].url.includes('api.github.com/repos/nuoge/wow-theme/releases/latest'));
            assert.ok(calls[0].cfg.headers['User-Agent']);
            assert.strictEqual(calls[0].cfg.maxRedirects, 5);
        } finally { fs.removeSync(e.root); }
    });
    await check('GitHub 无 release → 回退 tags，再兜底归档直链', async () => {
        const mockAxios = {
            get: async () => { throw new Error('404'); }
        };
        const e = makeEnv();
        try {
            const u = new ThemeUpdater(e.tm, { axios: mockAxios, currentVersion: '3.8.1-26.49' });
            const dl = await u.resolveDownloadUrl('https://github.com/a/b');
            assert.ok(dl.endsWith('.zip'), '兜底必须是 zip 直链');
            assert.ok(dl.includes('archive/refs/heads/main.zip'));
        } finally { fs.removeSync(e.root); }
    });

    // ── 8. 集成：list() 透出 update_url、跳过 _bak；CLI / Web 接线 ──
    await check('ThemeManager.list() 透出 update_url 且跳过 _bak', () => {
        const ThemeManager = require(path.join(SRC, 'theme_manager'));
        const src = fs.readFileSync(path.join(SRC, 'theme_manager.js'), 'utf8');
        assert.ok(/update_url:\s*meta\?\.update_url/.test(src), 'list 应透出 update_url');
        assert.ok(/name\.endsWith\('_bak'\)/.test(src), 'list 应跳过备份目录');
        assert.ok(/checkUpdate\(name/.test(src) && /update\(name/.test(src), '应有委托方法');
        assert.strictEqual(typeof ThemeManager, 'function', '导出仍是类，不破坏扩展白名单');
    });
    await check('CLI 注册 theme update（含 --all/--check/--force，action 为 async）', () => {
        const cli = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');
        assert.ok(/\.command\('update \[name\]'\)/.test(cli));
        assert.ok(/\.option\('--all'/.test(cli) && /\.option\('--check'/.test(cli) && /\.option\('--force'/.test(cli));
        assert.ok(/themeManager\.update\(themeName, opts\)/.test(cli));
    });
    await check('Web 两份 set.html 逐字节一致且含检查更新按钮（参数化 apiExec）', () => {
        const a = fs.readFileSync(path.join(ROOT, 'web/set.html'), 'utf8');
        const b = fs.readFileSync(path.join(ROOT, 'themes/default/set.html'), 'utf8');
        assert.strictEqual(a, b, '两份 set.html 必须一致');
        assert.ok(/data-action="update"[^>]*>检查更新</.test(a), '应有检查更新按钮');
        assert.ok(/apiExec\('theme update', \[name\]\)/.test(a), '命令必须参数化');
        assert.ok(!/apiExec\(`[^`]*\$\{/.test(a), '不能拼接变量进命令字符串');
    });

    console.log(`\n📊 结果: ${pass} 通过, ${fail} 失败\n`);
    if (fail) {
        failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.e.message}`));
        process.exitCode = 1;
    }
    server.close();
}

main().catch(e => { console.error('测试框架异常:', e); if (server) server.close(); process.exit(1); });
