#!/usr/bin/env node
/**
 * 内容安装器（content_installer）测试 —— V3.8.0 P0 下载中心
 * ----------------------------------------------------------------
 * 钉死：
 *   - 铁律「不得默认塞当前方案」：缺 targetScheme / 方案不存在必须抛错；
 *   - kind 只能是 mods / plugins，且分别落到 scheme/<name>/mods|plugins/；
 *   - 单文件模式（autoResolve=false）走 stream 下载，落盘内容正确；
 *   - 自动依赖模式（autoResolve=true）把整份清单逐一下载；
 *   - 单个文件下载失败 → 记录 skipped + 降级提示，不抛致命错、不影响其它文件；
 *   - 进度回调（onProgress）在流式下载中被触发。
 *
 * 全程不碰真实网络 / 真实 scheme 目录：
 *   - patch axios.get：/project/.../version 返回版本 JSON，CDN 链接返回可读流；
 *   - 注入轻量 schemeManager stub。
 *
 * 运行：cd core && node test/content_installer.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { Readable } = require('stream');
const axios = require('axios');

const WORK = path.join(os.tmpdir(), `content_installer_${process.pid}`);
fs.emptyDirSync(WORK);

const installer = require('../src/content_installer');
const ModSearch = require('../src/mod_search');
const dep = require('../src/dep_resolver');

// ─────────────────────────────────────────────
// axios.get 分流：版本查询返回 JSON，CDN 返回可读流
// ─────────────────────────────────────────────
const ORIG_GET = axios.get;
const CDN_BODY = Buffer.from('JAR-CONTENT');
axios.get = async (url) => {
    if (/\/project\/[^/]+\/version/.test(url)) {
        return {
            data: [{
                version_number: '1.0',
                files: [{ primary: true, url: 'https://cdn/main.jar', filename: 'main.jar' }],
                dependencies: []
            }]
        };
    }
    // 下载链接：模拟失败标记 FAIL 前缀
    if (String(url).startsWith('FAIL:')) {
        const e = new Error('模拟下载失败');
        e.code = 'ETEST';
        throw e;
    }
    return {
        headers: { 'content-length': String(CDN_BODY.length) },
        data: Readable.from([CDN_BODY])
    };
};

// 注入的 SM stub：只认 alpha / beta 两个方案
const sm = {
    _schemeExists: (name) => name === 'alpha' || name === 'beta',
    _getSchemePath: (name) => path.join(WORK, 'scheme', name)
};

let passed = 0, failed = 0;
const queue = [];
function run(title, fn) {
    queue.push(
        Promise.resolve().then(fn).then(
            () => { console.log(`  ✅ ${title}`); passed++; },
            (e) => { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
        )
    );
}

console.log('\n=== 内容安装器 content_installer ===\n');

run('缺 targetScheme → 抛错（禁止默认塞当前方案）', async () => {
    await assert.rejects(
        () => installer.installToScheme({ project: 'x', kind: 'mods', schemeManager: sm }),
        /必须指定目标方案/
    );
});

run('非法 kind → 抛错', async () => {
    await assert.rejects(
        () => installer.installToScheme({ project: 'x', kind: 'resourcepack', targetScheme: 'alpha', schemeManager: sm }),
        /kind 只能是 mods 或 plugins/
    );
});

run('缺 project → 抛错', async () => {
    await assert.rejects(
        () => installer.installToScheme({ kind: 'mods', targetScheme: 'alpha', schemeManager: sm }),
        /缺少 project/
    );
});

run('目标方案不存在 → 抛错', async () => {
    await assert.rejects(
        () => installer.installToScheme({ project: 'x', kind: 'mods', targetScheme: 'ghost', schemeManager: sm }),
        /不存在/
    );
});

run('单文件模式 → 落到 mods/ 且内容正确', async () => {
    const r = await installer.installToScheme({
        project: 'main', kind: 'mods', targetScheme: 'alpha',
        loader: 'fabric', mcVersion: '1.20.1', schemeManager: sm
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.installed.length, 1);
    assert.strictEqual(r.installed[0].filename, 'main.jar');
    const dest = path.join(WORK, 'scheme', 'alpha', 'mods', 'main.jar');
    assert.ok(fs.existsSync(dest), 'mods/main.jar 应存在');
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'JAR-CONTENT');
});

run('plugins 模式 → 落到 plugins/ 而非 mods/', async () => {
    const r = await installer.installToScheme({
        project: 'main', kind: 'plugins', targetScheme: 'beta',
        schemeManager: sm
    });
    assert.strictEqual(r.ok, true);
    assert.ok(fs.existsSync(path.join(WORK, 'scheme', 'beta', 'plugins', 'main.jar')));
    assert.ok(!fs.existsSync(path.join(WORK, 'scheme', 'beta', 'mods', 'main.jar')));
});

run('autoResolve 无依赖 → 仍只装本体', async () => {
    const r = await installer.installToScheme({
        project: 'main', kind: 'mods', targetScheme: 'alpha',
        autoResolve: true, schemeManager: sm
    });
    assert.strictEqual(r.installed.length, 1);
    assert.deepStrictEqual(r.skipped, []);
});

run('单个下载失败 → skipped + warnings，不致命', async () => {
    // 临时让单文件解析返回 FAIL 链接
    const orig = installer.resolveSingleFile;
    // installToScheme 内部直接调用模块内函数，无法通过导出覆盖，
    // 故此处改用注入 autoResolve 的方式：让 dep.resolve 返回 FAIL 链接
    const origResolve = dep.resolve;
    dep.resolve = async () => ({
        items: [
            { projectId: 'ok', fileUrl: 'https://cdn/ok.jar', filename: 'ok.jar', depth: 0 },
            { projectId: 'bad', fileUrl: 'FAIL:https://cdn/bad.jar', filename: 'bad.jar', depth: 1 }
        ],
        warnings: []
    });
    try {
        const r = await installer.installToScheme({
            project: 'main', kind: 'mods', targetScheme: 'alpha',
            autoResolve: true, schemeManager: sm
        });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.installed.length, 1);
        assert.strictEqual(r.skipped.length, 1);
        assert.ok(r.warnings.some(w => w.includes('下载失败')));
        void orig;
    } finally {
        dep.resolve = origResolve;
    }
});

run('onProgress 回调被触发', async () => {
    const prog = [];
    await installer.installToScheme({
        project: 'main', kind: 'mods', targetScheme: 'alpha',
        schemeManager: sm, onProgress: (p) => prog.push(p)
    });
    assert.ok(prog.length > 0, '应有进度事件');
    assert.strictEqual(prog[prog.length - 1].total, CDN_BODY.length);
});

run('autoResolve 清单逐项落盘（含依赖 depth）', async () => {
    const origResolve = dep.resolve;
    dep.resolve = async () => ({
        items: [
            { projectId: 'A', fileUrl: 'https://cdn/A.jar', filename: 'A.jar', depth: 0 },
            { projectId: 'B', fileUrl: 'https://cdn/B.jar', filename: 'B.jar', depth: 1 },
            { projectId: 'C', fileUrl: 'https://cdn/C.jar', filename: 'C.jar', depth: 2 }
        ],
        warnings: ['依赖解析：已达深度上限']
    });
    try {
        const r = await installer.installToScheme({
            project: 'A', kind: 'mods', targetScheme: 'beta',
            autoResolve: true, schemeManager: sm
        });
        assert.strictEqual(r.installed.length, 3);
        assert.deepStrictEqual(r.installed.map(i => i.depth), [0, 1, 2]);
        for (const n of ['A.jar', 'B.jar', 'C.jar']) {
            assert.ok(fs.existsSync(path.join(WORK, 'scheme', 'beta', 'mods', n)), `${n} 应落盘`);
        }
        assert.ok(r.warnings.some(w => w.includes('深度上限')));
    } finally {
        dep.resolve = origResolve;
    }
});

Promise.all(queue).then(() => {
    axios.get = ORIG_GET;
    fs.removeSync(WORK);
    console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
});
