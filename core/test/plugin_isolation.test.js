#!/usr/bin/env node
/**
 * 插件「绝对防崩」回归
 * ----------------------------------------------------------------
 * 公测期无法逐一验证插件生态，因此把「坏插件不能拖垮主程序」钉成用例：
 *
 *   1. index.js 语法错误 / 加载期抛错 → 该插件跳过，其它插件照常加载；
 *   2. plugin.json 损坏 → 跳过；
 *   3. handler 同步抛错 / 返回 rejected promise → 只输出「插件内部错误」，
 *      进程不退出，其它命令仍可用；
 *   4. 信任层内部异常 → 只跳过该插件，不影响整轮加载；
 *   5. unhandledRejection 护栏生效（插件 fire-and-forget 的异步异常不终止进程）。
 *
 * 运行：cd core && node test/plugin_isolation.test.js
 */
const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { Command } = require('commander');

const loader = require('../src/plugin_loader');
const trust = require('../src/plugin_trust');
const policy = require('../src/command_policy');

const WORK = path.join(os.tmpdir(), `plugin_isolation_${process.pid}`);
fs.emptyDirSync(WORK);
process.on('exit', () => { try { fs.removeSync(WORK); } catch (e) { /* ignore */ } });

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}
async function checkAsync(title, fn) {
    try { await fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

function makeLog() {
    const lines = { info: [], warn: [], error: [] };
    return {
        lines,
        info: (m) => lines.info.push(String(m)),
        warn: (m) => lines.warn.push(String(m)),
        error: (m) => lines.error.push(String(m)),
        all: () => [...lines.info, ...lines.warn, ...lines.error].join('\n')
    };
}

function freshProgram() {
    policy.resetPluginCommands();
    const p = new Command();
    p.name('wow').exitOverride();
    for (const n of ['init', 'server', 'mod', 'scheme', 'pool', 'plugin', 'web', 'lan', 'config']) {
        p.command(n);
    }
    return p;
}

/** 在 root 下造插件 */
function makePlugin(root, dirName, manifest, files) {
    const dir = path.join(root, dirName);
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'plugin.json'),
        typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2), 'utf8');
    for (const [rel, content] of Object.entries(files || {})) {
        const full = path.join(dir, rel);
        fs.ensureDirSync(path.dirname(full));
        fs.writeFileSync(full, content, 'utf8');
    }
    return dir;
}

/** 加载一组插件，默认全部预先信任 */
async function load(root, extra = {}) {
    const trustFile = path.join(WORK, `trust-${path.basename(root)}.json`);
    for (const d of fs.readdirSync(root)) {
        const p = path.join(root, d);
        if (!fs.existsSync(path.join(p, 'plugin.json'))) continue;
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(p, 'plugin.json'), 'utf8'));
            if (meta && meta.name) trust.grantTrust(meta.name, trust.fingerprint(p), trustFile);
        } catch (e) { /* 坏清单不信任，交给加载器跳过 */ }
    }
    const program = freshProgram();
    const log = makeLog();
    const out = await loader.loadPlugins(program, {
        dir: root, trustFile, interactive: false, quiet: true, log, ...extra
    });
    return { program, log, out };
}

async function captureConsole(fn) {
    const buf = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => buf.push(a.join(' '));
    console.error = (...a) => buf.push(a.join(' '));
    try { await fn(); } finally { console.log = origLog; console.error = origErr; }
    return buf.join('\n');
}

(async () => {
    console.log('\n=== 插件绝对防崩 ===\n');

    // ─────────────────────────────────────────────
    // 0. 运行期护栏（必须最先测：loadPlugins 成功后会自动安装，
    //    一旦装过就无法再观察「首次安装」的行为）
    // ─────────────────────────────────────────────
    check('0a 首次安装返回 true，重复安装返回 false', () => {
        const log = makeLog();
        const first = loader.installRejectionGuard(log);
        const second = loader.installRejectionGuard(log);
        assert.strictEqual(first, true, '首次安装应返回 true');
        assert.strictEqual(second, false, '第二次应直接返回 false');
    });

    check('0b unhandledRejection 被记录且不抛出', () => {
        const log = makeLog();
        const before = process.listenerCount('unhandledRejection');
        loader.installRejectionGuard(log);
        try {
            process.emit('unhandledRejection', new Error('plugin async boom'), Promise.resolve());
        } catch (e) {
            throw new Error(`护栏未生效，异常冒泡：${e.message}`);
        }
        assert.ok(process.listenerCount('unhandledRejection') >= before);
        // 首次安装时 handler 用的是第一个 log；已安装时用之前的 log，
        // 因此这里只断言「至少有一个 listener 且 emit 不抛」。
        assert.ok(process.listenerCount('unhandledRejection') >= 1);
    });

    // ─────────────────────────────────────────────
    // 1. 加载期崩溃隔离
    // ─────────────────────────────────────────────
    await checkAsync('1 index.js 语法错误：该插件跳过，其它插件照常加载', async () => {
        const root = path.join(WORK, 'load-crash');
        makePlugin(root, 'good', { name: 'good', commands: [{ name: 'good-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() { return "ok"; } };'
        });
        makePlugin(root, 'broken', { name: 'broken', commands: [{ name: 'broken-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run( { this is not js'
        });

        const { out, log } = await load(root);
        assert.deepStrictEqual(out.loaded.map(p => p.name), ['good']);
        assert.strictEqual(out.skipped.length, 1);
        assert.strictEqual(out.skipped[0].name, 'broken');
        assert.match(log.all(), /已跳过/);
    });

    await checkAsync('2 plugin.json 损坏：跳过且不影响其它插件', async () => {
        const root = path.join(WORK, 'bad-json');
        makePlugin(root, 'good2', { name: 'good2', commands: [{ name: 'good2-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() {} };'
        });
        makePlugin(root, 'badjson', '{ not json at all', {});

        const { out, log } = await load(root);
        assert.deepStrictEqual(out.loaded.map(p => p.name), ['good2']);
        assert.ok(out.skipped.some(s => s.dirName === 'badjson'));
        assert.match(log.all(), /plugin\.json 解析失败/);
    });

    await checkAsync('3 index.js 缺少声明的 handler：整插件跳过', async () => {
        const root = path.join(WORK, 'missing-handler');
        makePlugin(root, 'nofn', { name: 'nofn', commands: [{ name: 'nofn-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = {};'
        });
        const { out } = await load(root);
        assert.deepStrictEqual(out.loaded, []);
        assert.match(out.skipped[0].reason, /缺少处理函数/);
    });

    // ─────────────────────────────────────────────
    // 2. 执行期崩溃隔离
    // ─────────────────────────────────────────────
    await checkAsync('4 handler 同步抛错：只输出「插件内部错误」，进程不退出', async () => {
        const root = path.join(WORK, 'run-throw');
        makePlugin(root, 'boom', { name: 'boom', commands: [{ name: 'boom-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() { throw new Error("SECRET_INTERNAL_PATH=/etc/passwd"); } };'
        });
        const { program, log } = await load(root);
        process.exitCode = 0;

        const out = await captureConsole(async () => {
            await program.parseAsync(['node', 'wow', 'boom-cmd']);
        });

        assert.match(out, /插件内部错误/, '终端文案必须只说「插件内部错误」');
        assert.ok(!out.includes('/etc/passwd'), '插件内部信息泄漏到了终端');
        assert.match(log.all(), /boom-cmd 执行失败/);
        assert.strictEqual(process.exitCode, 1);
        process.exitCode = 0;
    });

    await checkAsync('5 handler 返回 rejected promise：同样被兜住', async () => {
        const root = path.join(WORK, 'run-reject');
        makePlugin(root, 'rejecter', { name: 'rejecter', commands: [{ name: 'reject-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { async run() { throw new Error("async boom"); } };'
        });
        const { program } = await load(root);
        process.exitCode = 0;
        const out = await captureConsole(async () => {
            await program.parseAsync(['node', 'wow', 'reject-cmd']);
        });
        assert.match(out, /插件内部错误/);
        process.exitCode = 0;
    });

    await checkAsync('6 一个命令崩溃后，另一个插件命令仍可正常执行', async () => {
        const root = path.join(WORK, 'mixed');
        makePlugin(root, 'bad', { name: 'bad', commands: [{ name: 'bad-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() { throw new Error("x"); } };'
        });
        makePlugin(root, 'fine', { name: 'fine', commands: [{ name: 'fine-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() { console.log("FINE_OK"); } };'
        });
        const { program } = await load(root);
        process.exitCode = 0;
        const out = await captureConsole(async () => {
            await program.parseAsync(['node', 'wow', 'bad-cmd']);
        });
        assert.match(out, /插件内部错误/);

        const out2 = await captureConsole(async () => {
            await program.parseAsync(['node', 'wow', 'fine-cmd']);
        });
        assert.match(out2, /FINE_OK/);
        process.exitCode = 0;
    });

    // ─────────────────────────────────────────────
    // 3. 信任层异常隔离
    // ─────────────────────────────────────────────
    await checkAsync('7 信任指纹计算抛错：只跳过该插件，整轮加载不中断', async () => {
        const root = path.join(WORK, 'trust-throw');
        makePlugin(root, 'p1', { name: 'p1', commands: [{ name: 'p1-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() {} };'
        });
        const orig = trust.fingerprint;
        trust.fingerprint = () => { throw new Error('EACCES: 目录不可读'); };
        let out;
        try {
            const r = await load(root, { interactive: false });
            out = r.out;
        } finally {
            trust.fingerprint = orig;
        }
        assert.deepStrictEqual(out.loaded, []);
        assert.strictEqual(out.skipped.length, 1);
        assert.match(out.skipped[0].reason, /加载过程异常/);
    });

    // ─────────────────────────────────────────────
    // 5. 组合场景：坏插件一堆，好插件仍能跑
    // ─────────────────────────────────────────────
    await checkAsync('8 五个坏插件 + 一个好插件：只有好的被加载', async () => {
        const root = path.join(WORK, 'many-bad');
        makePlugin(root, 'ok', { name: 'ok', commands: [{ name: 'ok-cmd', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() {} };'
        });
        makePlugin(root, 'syntax', { name: 'syntax', commands: [{ name: 's1', handler: 'run' }] }, {
            'index.js': 'function('
        });
        makePlugin(root, 'nofile', { name: 'nofile', commands: [{ name: 's2', handler: 'run' }] }, {});
        makePlugin(root, 'emptycmd', { name: 'emptycmd', commands: [] }, {
            'index.js': 'module.exports = {};'
        });
        makePlugin(root, 'badname', { name: 'badname', commands: [{ name: 'UPPER CASE', handler: 'run' }] }, {
            'index.js': 'module.exports = { run() {} };'
        });
        makePlugin(root, 'badjson2', '{{{', {});

        const { out } = await load(root);
        assert.deepStrictEqual(out.loaded.map(p => p.name), ['ok']);
        assert.strictEqual(out.skipped.length, 5);
    });

    console.log(`\n插件防崩: ${passed} 通过, ${failed} 失败\n`);
    process.exitCode = failed ? 1 : 0;
})();
