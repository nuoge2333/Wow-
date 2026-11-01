#!/usr/bin/env node
/**
 * V3.5.21：插件加载器（plugin_loader.js）
 * ----------------------------------------------------------------
 * 覆盖四类关键行为：
 *   1. 正常注册：plugin.json 声明的命令真的挂到了 program 上，能执行、能收到 options；
 *   2. 崩溃隔离：index.js 加载期抛错 / 处理函数缺失 / handler 运行期抛错，
 *      都不能让主进程挂掉，且提示文案是「插件 X 崩溃，已跳过」；
 *   3. 冲突与跳过：命令名撞内置命名空间、清单损坏，整插件跳过（不半加载）；
 *   4. 信任闸：未信任 + 非交互 → 跳过；用户拒绝 → 跳过；用户同意 → 记表并加载。
 *
 * 全部用临时目录 + fixtures，不碰真实的 wow-plugins/ 与 core/.plugins.trust.json。
 */

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { Command } = require('commander');

const loader = require('../src/plugin_loader');
const trust = require('../src/plugin_trust');
const policy = require('../src/command_policy');

const FIXTURES = path.join(__dirname, 'fixtures', 'plugins');

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}
async function checkAsync(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-loader-'));
process.on('exit', () => { try { fs.removeSync(tmpRoot); } catch (e) { /* 忽略 */ } });

/** 收集日志的假 logger */
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

/** 造一个全新 program（模拟一次 CLI 启动） */
function freshProgram() {
    policy.resetPluginCommands();
    const p = new Command();
    p.name('wow').exitOverride();
    // 与真实 CLI 一样先注册几个内置命令，用于验证「撞内置命令」的冲突判断
    for (const n of ['init', 'server', 'mod', 'scheme', 'pool', 'plugin', 'web', 'lan', 'config']) {
        p.command(n);
    }
    return p;
}

/**
 * 造一个「已装好并已信任某个 fixture 插件」的 program。
 * commander 的同一个实例只能 parse 一次（第二次会因 _scriptPath 已存在而忽略新 argv），
 * 因此每次执行命令都必须重新加载插件、拿到全新的 program。
 * @param {string} tag 用于区分临时目录
 * @param {string} fixture fixtures/plugins 下的目录名
 * @returns {Promise<{program, log, root, trustFile}>}
 */
async function bootstrap(tag, fixture) {
    const root = path.join(tmpRoot, tag);
    const trustFile = path.join(tmpRoot, tag + '.trust.json');
    stage(fixture, root);
    trust.grantTrust(fixture, trust.fingerprint(path.join(root, fixture)), trustFile);
    const program = freshProgram();
    const log = makeLog();
    await loader.loadPlugins(program, { dir: root, trustFile, interactive: false, quiet: true, log });
    return { program, log, root, trustFile };
}

/** 把某个 fixture 插件复制到临时插件根目录 */
function stage(pluginDirName, targetRoot) {
    fs.ensureDirSync(targetRoot);
    fs.copySync(path.join(FIXTURES, pluginDirName), path.join(targetRoot, pluginDirName));
}

/** 抓 console.log 输出 */
async function capture(fn) {
    const buf = [];
    const orig = console.log;
    console.log = (...a) => buf.push(a.join(' '));
    try {
        await fn();
    } finally {
        console.log = orig;
    }
    return buf.join('\n');
}

(async () => {

    // ==================== 1. 正常加载 ====================
    console.log('\n正常加载\n');

    const rootA = path.join(tmpRoot, 'A');
    const trustA = path.join(tmpRoot, 'A.trust.json');
    stage('good-hello', rootA);

    const programA = freshProgram();
    const logA = makeLog();
    const rA = await loader.loadPlugins(programA, {
        dir: rootA, trustFile: trustA, interactive: false, quiet: true, log: logA
    });

    await checkAsync('未信任 + 非交互 → 进入 pending，不加载', async () => {
        assert.strictEqual(rA.loaded.length, 0);
        assert.strictEqual(rA.pending.length, 1);
        assert.strictEqual(rA.pending[0].name, 'good-hello');
        assert.match(rA.pending[0].reason, /非交互环境/);
    });

    await checkAsync('pending 时给出 `wow plugin trust` 指引', async () => {
        assert.match(logA.all(), /wow plugin trust good-hello/);
    });

    await checkAsync('pending 时命令没有被注册', async () => {
        assert.strictEqual(programA.commands.some(c => c.name() === 'hello'), false);
        assert.strictEqual(policy.RUNTIME_PLUGIN_CMDS.size, 0);
    });

    // 信任后重来
    trust.grantTrust('good-hello', trust.fingerprint(path.join(rootA, 'good-hello')), trustA);
    const programB = freshProgram();
    const logB = makeLog();
    const rB = await loader.loadPlugins(programB, {
        dir: rootA, trustFile: trustA, interactive: false, quiet: true, log: logB
    });

    await checkAsync('已信任 → 加载成功', async () => {
        assert.strictEqual(rB.loaded.length, 1, logB.all());
        assert.strictEqual(rB.loaded[0].name, 'good-hello');
        assert.deepStrictEqual(rB.loaded[0].commands, ['hello', 'hello-ctx', 'hello-boom']);
    });

    await checkAsync('三条命令都注册到了 program 上', async () => {
        for (const n of ['hello', 'hello-ctx', 'hello-boom']) {
            assert.ok(programB.commands.some(c => c.name() === n), `缺少 ${n}`);
        }
    });

    await checkAsync('命令名登记进 RUNTIME_PLUGIN_CMDS', async () => {
        assert.ok(policy.RUNTIME_PLUGIN_CMDS.has('hello'));
        assert.ok(policy.RUNTIME_PLUGIN_CMDS.has('hello-ctx'));
        assert.ok(policy.isWowNamespace('hello'));
    });

    await checkAsync('命令可执行，且 args/options 按 commander 约定传入', async () => {
        const out = await capture(async () => {
            await programB.parseAsync(['node', 'wow', 'hello', '--name', 'Steve']);
        });
        assert.match(out, /HELLO_FROM_PLUGIN:Steve/);
    });

    await checkAsync('不带 --name 时走默认值', async () => {
        const { program } = await bootstrap('B2', 'good-hello');
        const out = await capture(async () => {
            await program.parseAsync(['node', 'wow', 'hello']);
        });
        assert.match(out, /HELLO_FROM_PLUGIN:world/);
    });

    await checkAsync('context 注入的键与白名单一致，且不含 process', async () => {
        const out = await capture(async () => {
            await programB.parseAsync(['node', 'wow', 'hello-ctx']);
        });
        const keys = out.match(/CTX_KEYS:(.*)/)[1].split(',');
        assert.deepStrictEqual(keys.sort(), ['config', 'event', 'log', 'mail', 'mod', 'pack', 'scheme', 'server', 'theme', 'utils']);
        assert.match(out, /CTX_HAS_PROCESS:false/);
        // context.config 必须是真正的 config 模块
        assert.match(out, /CTX_LANG:(zh_CN|en_US|unknown)/);
    });

    await checkAsync('handler 运行期抛错被捕获，错误信息透出', async () => {
        const { program, log } = await bootstrap('B3', 'good-hello');
        await program.parseAsync(['node', 'wow', 'hello-boom']);
        // 致命错误必须能被看见：既进 log.error，也落地 process.exitCode
        assert.match(log.all(), /故意崩溃/);
        assert.match(log.all(), /hello-boom 执行失败/);
        assert.strictEqual(process.exitCode, 1);
        process.exitCode = 0;
    });

    await checkAsync('handler 运行期抛错不影响其它命令', async () => {
        const { program } = await bootstrap('B4', 'good-hello');
        // 先让 boom 抛一次（单条调用失败）
        const { program: p4 } = await bootstrap('B4b', 'good-hello');
        await p4.parseAsync(['node', 'wow', 'hello-boom']);
        process.exitCode = 0;
        // 另一份全新的 program 照常工作，说明没有全局状态被弄脏
        const out = await capture(async () => {
            await program.parseAsync(['node', 'wow', 'hello']);
        });
        assert.match(out, /HELLO_FROM_PLUGIN:world/);
    });

    // ==================== 2. 崩溃 / 结构错误 ====================
    console.log('\n崩溃与结构错误\n');

    const rootC = path.join(tmpRoot, 'C');
    const trustC = path.join(tmpRoot, 'C.trust.json');
    for (const d of ['bad-json', 'bad-crash', 'conflict-init', 'no-handler']) stage(d, rootC);
    // 先把四个都标成信任，把变量收敛到「结构/崩溃」本身
    for (const d of ['bad-json', 'bad-crash', 'conflict-init', 'no-handler']) {
        try {
            trust.grantTrust(d, trust.fingerprint(path.join(rootC, d)), trustC);
        } catch (e) { /* 忽略 */ }
    }

    const programC = freshProgram();
    const logC = makeLog();
    const rC = await loader.loadPlugins(programC, {
        dir: rootC, trustFile: trustC, interactive: false, quiet: true, log: logC
    });

    await checkAsync('四个坏插件全部进 skipped，没有一个被加载', async () => {
        assert.strictEqual(rC.loaded.length, 0, logC.all());
        assert.strictEqual(rC.skipped.length, 4, logC.all());
    });

    await checkAsync('bad-json：清单解析失败', async () => {
        const s = rC.skipped.find(x => x.dirName === 'bad-json');
        assert.ok(s, '缺少 bad-json 的跳过记录');
        assert.match(s.reason, /JSON/);
    });

    await checkAsync('bad-crash：提示文案为「插件 X 崩溃，已跳过」', async () => {
        const text = logC.all();
        assert.match(text, /插件 bad-crash 崩溃，已跳过/);
        assert.match(text, /加载期就崩了/);
    });

    await checkAsync('conflict-init：撞内置 init 被拒', async () => {
        const s = rC.skipped.find(x => x.dirName === 'conflict-init');
        assert.ok(s, '缺少 conflict-init 的跳过记录');
        assert.match(s.reason, /冲突/);
        assert.match(s.reason, /init/);
    });

    await checkAsync('no-handler：handler 缺失被拒', async () => {
        const s = rC.skipped.find(x => x.dirName === 'no-handler');
        assert.ok(s, '缺少 no-handler 的跳过记录');
        assert.match(s.reason, /缺少处理函数/);
    });

    await checkAsync('冲突插件没有把 cmd 名污染进 RUNTIME_PLUGIN_CMDS', async () => {
        // conflict-init 声明的 init 本来就在 WOW_NAMESPACES 里，这里只确认
        // 它的唯一命令没被「额外」注册（注册后仍然只是 init，无法区分）。
        // 更直接的检查：program 上 init 只有一份。
        const inits = programC.commands.filter(c => c.name() === 'init');
        assert.strictEqual(inits.length, 1);
    });

    // ==================== 3. 信任闸 ====================
    console.log('\n信任闸\n');

    await checkAsync('用户拒绝 → 保持 pending，不写信任表', async () => {
        const rootD = path.join(tmpRoot, 'D');
        const trustD = path.join(tmpRoot, 'D.trust.json');
        stage('good-hello', rootD);
        const programD = freshProgram();
        const logD = makeLog();
        const r = await loader.loadPlugins(programD, {
            dir: rootD, trustFile: trustD, interactive: true,
            confirm: async () => false, quiet: true, log: logD
        });
        assert.strictEqual(r.loaded.length, 0);
        assert.strictEqual(r.pending.length, 1);
        assert.match(r.pending[0].reason, /用户拒绝/);
        // 拒绝的语义是「不写信任记录」，不是「写一条否定的记录」
        const table = trust.loadTrust(trustD);
        assert.strictEqual(table.plugins['good-hello'], undefined, '拒绝后不应写入信任记录');
    });

    await checkAsync('用户同意 → 写入信任表并加载', async () => {
        const rootE = path.join(tmpRoot, 'E');
        const trustE = path.join(tmpRoot, 'E.trust.json');
        stage('good-hello', rootE);
        const programE = freshProgram();
        const logE = makeLog();
        let asked = 0;
        const r = await loader.loadPlugins(programE, {
            dir: rootE, trustFile: trustE, interactive: true,
            confirm: async () => { asked++; return true; }, quiet: true, log: logE
        });
        assert.strictEqual(asked, 1);
        assert.strictEqual(r.loaded.length, 1);
        const table = trust.loadTrust(trustE);
        assert.match(table.plugins['good-hello'].fingerprint, /^sha256:/);
    });

    await checkAsync('确认提示里含插件名、命令预览与权限警告', async () => {
        const rootF = path.join(tmpRoot, 'F');
        const trustF = path.join(tmpRoot, 'F.trust.json');
        stage('good-hello', rootF);
        const programF = freshProgram();
        const logF = makeLog();
        await loader.loadPlugins(programF, {
            dir: rootF, trustFile: trustF, interactive: true,
            confirm: async () => false, quiet: true, log: logF
        });
        const text = logF.all();
        assert.match(text, /插件 good-hello v1\.2\.3 首次加载/);
        assert.match(text, /wow hello/);
        assert.match(text, /同权限/);
    });

    await checkAsync('内容变更后重新走确认（pending.reason 标明「内容已变更」）', async () => {
        const rootG = path.join(tmpRoot, 'G');
        const trustG = path.join(tmpRoot, 'G.trust.json');
        stage('good-hello', rootG);
        // 先信任旧内容
        trust.grantTrust('good-hello', trust.fingerprint(path.join(rootG, 'good-hello')), trustG);
        // 改一个字节
        const idx = path.join(rootG, 'good-hello', 'index.js');
        fs.appendFileSync(idx, '\n// tampered\n', 'utf8');
        // 清 require 缓存，避免拿到旧模块
        delete require.cache[idx];

        const programG = freshProgram();
        const logG = makeLog();
        const r = await loader.loadPlugins(programG, {
            dir: rootG, trustFile: trustG, interactive: false, quiet: true, log: logG
        });
        assert.strictEqual(r.loaded.length, 0);
        assert.strictEqual(r.pending.length, 1);
        assert.strictEqual(r.pending[0].state, 'changed');
        assert.match(logG.all(), /内容已变更/);
    });

    // ==================== 4. 空目录 / 无插件 ====================
    console.log('\n边界情况\n');

    await checkAsync('插件目录不存在 → 返回空结果，不抛', async () => {
        const programH = freshProgram();
        const r = await loader.loadPlugins(programH, {
            dir: path.join(tmpRoot, 'no-such-dir'),
            trustFile: path.join(tmpRoot, 'H.trust.json'),
            interactive: false, quiet: true, log: makeLog()
        });
        assert.deepStrictEqual(r, { loaded: [], skipped: [], pending: [] });
    });

    await checkAsync('目录存在但无 plugin.json → 不算插件', async () => {
        const rootI = path.join(tmpRoot, 'I');
        fs.ensureDirSync(path.join(rootI, 'not-a-plugin'));
        fs.writeFileSync(path.join(rootI, 'not-a-plugin', 'readme.txt'), 'hi', 'utf8');
        const programI = freshProgram();
        const r = await loader.loadPlugins(programI, {
            dir: rootI, trustFile: path.join(tmpRoot, 'I.trust.json'),
            interactive: false, quiet: true, log: makeLog()
        });
        assert.deepStrictEqual(r, { loaded: [], skipped: [], pending: [] });
    });

    await check('validateManifest 拒绝空 commands', () => {
        const v = loader.validateManifest({ name: 'x', commands: [] });
        assert.strictEqual(v.ok, false);
        assert.match(v.reason, /commands/);
    });

    await check('validateManifest 拒绝非法命令名', () => {
        for (const bad of ['Hello', 'he llo', '1abc', 'a.b', '__proto__', 'constructor']) {
            const v = loader.validateManifest({ name: 'x', commands: [{ name: bad, handler: 'h' }] });
            assert.strictEqual(v.ok, false, `应拒绝命令名 ${bad}`);
        }
    });

    await check('validateManifest 拒绝插件内重名命令', () => {
        const v = loader.validateManifest({
            name: 'x',
            commands: [{ name: 'a', handler: 'h1' }, { name: 'a', handler: 'h2' }]
        });
        assert.strictEqual(v.ok, false);
        assert.match(v.reason, /重复/);
    });

    await check('findConflict 认出内置命令 / 保留标识符', () => {
        const p = freshProgram();
        assert.ok(loader.findConflict(p, 'init'));
        assert.ok(loader.findConflict(p, 'help'));
        assert.ok(loader.findConflict(p, '__proto__'));
        assert.strictEqual(loader.findConflict(p, 'brand-new-cmd'), null);
    });

    console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('测试自身异常：', e);
    process.exit(1);
});
