#!/usr/bin/env node
/**
 * Web 面板内置文档查看 —— 真实 HTTP 端到端测试
 * ----------------------------------------------------------------
 * 启动真实 Web 服务（强制登录 + 合法 JWT），逐条验证：
 *   - /api/docs/list 可用且不泄露路径
 *   - /api/docs/content 白名单文档 200
 *   - 路径穿越 / 禁止文档 → 403（对应验收第 5 条「Postman 打 ../../package.json」）
 *   - 未登录 → 401（说明文档接口继承既有鉴权）
 *   - /api/docs/asset 拒绝穿越与非法扩展名
 *
 * 串行运行（run.js 用 spawnSync），端口 18107 不与其它 e2e 冲突。
 */
const path = require('path');

process.env.WOW_WEB_AUTH_TOKEN = 'e2e-docs-secret-3811';
const PORT = 18107;
const BASE = `http://127.0.0.1:${PORT}`;
const jwt = require('jsonwebtoken');
const TOKEN = jwt.sign({ user: 'e2e' }, 'e2e-docs-secret-3811', { expiresIn: '1h' });

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
    if (cond) { console.log(`  ✅ ${name}`); passed++; }
    else { console.log(`  ❌ ${name}${extra ? '  → ' + extra : ''}`); failed++; }
}

async function req(url, withToken = true) {
    const headers = {};
    if (withToken) headers['Authorization'] = 'Bearer ' + TOKEN;
    const r = await fetch(BASE + url, { headers });
    let data = null;
    try { data = await r.json(); } catch (e) { /* 非 JSON */ }
    return { status: r.status, data: data || {} };
}

(async () => {
    const webService = require('../src/web_service');
    const config = require('../src/config');

    // 显式打开强制登录，验证文档接口继承既有 JWT 鉴权
    const origGetConfig = config.getConfig;
    config.getConfig = function (key, def) {
        if (key === 'web.require_login') return true;
        return origGetConfig.call(this, key, def);
    };

    try {
        await webService.startWeb({ port: PORT, host: '127.0.0.1' });
        await new Promise(r => setTimeout(r, 800));

        console.log('\n📖 内置文档 API 端到端 (V3.8.0 帮助文档)\n');

        // ── list ──
        const l = await req('/api/docs/list');
        check('GET /api/docs/list → 200 + 目录清单', l.status === 200 && l.data.success === true &&
            Array.isArray(l.data.docs) && l.data.docs.length >= 10 && Array.isArray(l.data.groups),
            JSON.stringify(l).slice(0, 200));
        const listJson = JSON.stringify(l.data);
        check('list 不泄露 .md 路径 / 禁止文档名',
            !/\.md\b/i.test(listJson) && !/docs\//.test(listJson) &&
            !/CHANGELOG|RELEASE_POLICY|DECISIONS|TUI/i.test(listJson));

        // ── 正常读取 ──
        const c1 = await req('/api/docs/content?name=COMMANDS');
        check('GET content?name=COMMANDS → 200 + Markdown 原文',
            c1.status === 200 && c1.data.success === true &&
            c1.data.content.includes('完整命令参考'), JSON.stringify(c1).slice(0, 200));
        check('content 响应不含绝对路径字段',
            !('rel' in c1.data) && !('abs' in c1.data) && !('path' in c1.data));
        const c2 = await req('/api/docs/content?name=QUICKSTART');
        check('GET content?name=QUICKSTART → 200', c2.status === 200 && c2.data.success === true);
        const c3 = await req('/api/docs/content?name=commands');
        check('name 大小写不敏感 → 200', c3.status === 200 && c3.data.success === true);

        // ── 403：路径穿越与禁止文档（验收第 5 条） ──
        const attacks = [
            '/api/docs/content?name=../../package.json',
            '/api/docs/content?name=' + encodeURIComponent('../../package.json'),
            '/api/docs/content?name=' + encodeURIComponent('../../core/wow.yaml'),
            '/api/docs/content?name=' + encodeURIComponent('..%2F..%2Fcore%2Fwow.yaml'),
            '/api/docs/content?name=COMMANDS.md',
            '/api/docs/content?name=' + encodeURIComponent('docs/CONFIG'),
            '/api/docs/content?name=RELEASE_POLICY',
            '/api/docs/content?name=CHANGELOG',
            '/api/docs/content?name=DECISIONS',
            '/api/docs/content?name=TUI',
            '/api/docs/content?name=LAN_TERRACOTTA-TEST-REPORT',
            '/api/docs/content?name=NO_SUCH_DOC',
            '/api/docs/content'
        ];
        let all403 = true, detail = '';
        for (const u of attacks) {
            const r = await req(u);
            if (r.status !== 403 || r.data.success !== false) {
                all403 = false; detail += `${u} → ${r.status}; `;
            }
        }
        check(`路径穿越 / 禁止文档共 ${attacks.length} 种载荷全部 403`, all403, detail);

        const pj = await req('/api/docs/content?name=../../package.json');
        check('403 响应是友好 JSON（不回显路径、不回显文件内容）',
            pj.data.success === false && typeof pj.data.error === 'string' &&
            !/package\.json|\/workspace|ENOENT/.test(JSON.stringify(pj.data)));

        // ── 鉴权继承 ──
        const noAuth = await req('/api/docs/list', false);
        check('未登录访问 /api/docs/list → 401', noAuth.status === 401);

        // ── asset 接口 ──
        const as = [
            '/api/docs/asset?name=COMMANDS&file=' + encodeURIComponent('../../core/wow.yaml'),
            '/api/docs/asset?name=COMMANDS&file=evil.js',
            '/api/docs/asset?name=COMMANDS&file=' + encodeURIComponent('a/b.png'),
            '/api/docs/asset?name=' + encodeURIComponent('../../package.json') + '&file=x.png',
            '/api/docs/asset?name=CHANGELOG&file=x.png'
        ];
        let assetSafe = true;
        for (const u of as) {
            const r = await req(u);
            if (r.status === 200) { assetSafe = false; console.log('     意外 200:', u, r.status); }
        }
        check('asset 接口拒绝穿越 / 非图片 / 非法 name（无 200）', assetSafe);
    } finally {
        try { webService.stopWeb(); } catch (e) { /* ignore */ }
    }

    console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed ? 1 : 0);
})().catch(e => {
    console.error('❌ 测试异常:', e && e.stack || e);
    process.exit(1);
});
