/**
 * 本地初级错误诊断器（error_scanner）测试
 * ----------------------------------------------------------------
 * 覆盖：错误字典命中、模组名提取（方括号 / 包名）、日志前缀排除、
 *       前置缺失解析、降级策略、渲染类冲突、终端渲染、server.js 接入点。
 *
 * 全部为纯逻辑测试：不联网、不启动服务器、不依赖真实方案目录，
 * 模组目录用临时目录构造。
 *
 * 运行：cd core && node test/error_scanner.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const SRC = path.join(__dirname, '../src');
const E = require(path.join(SRC, 'error_scanner.js'));

let pass = 0, fail = 0;
const failures = [];

function check(title, fn) {
    try {
        fn();
        console.log(`  ✅ ${title}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${title}\n     ${e.message}`);
        fail++;
        failures.push({ title, err: e });
    }
}

function read(file) {
    return fs.readFileSync(path.join(SRC, file), 'utf8');
}

// 临时模组目录
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), `errscan_${process.pid}_`));
process.on('exit', () => { try { fs.removeSync(WORK); } catch (e) { /* ignore */ } });

const MODS = path.join(WORK, 'mods');
fs.ensureDirSync(MODS);
for (const f of [
    'sodium-fabric-0.5.8.jar',
    'iris-mc1.20.1-1.6.jar',
    'lithium-fabric-0.11.jar',
    'trinkets-3.7.0.jar'
]) {
    fs.writeFileSync(path.join(MODS, f), '');
}

const EMPTY_MODS = path.join(WORK, 'empty-mods');
fs.ensureDirSync(EMPTY_MODS);

/** 便捷：把行数组拼成日志并扫描 */
function scan(lines, modsDir = EMPTY_MODS) {
    return E.scanLog(lines.join('\n'), { modsDir });
}

/** 纯文本化渲染输出，便于断言 */
function renderText(result) {
    return E.stripAnsi(E.renderReport(result).join('\n'));
}

// ==================== 1. 错误字典 ====================
console.log('[1] 错误字典 ERROR_PATTERNS');

check('01 包含用户要求的全部 7 类核心崩溃类型', () => {
    const ids = E.ERROR_PATTERNS.map(p => p.id);
    for (const need of [
        'unsupported_class_version',
        'out_of_memory',
        'bind_exception',
        'eula',
        'no_class_def',
        'mixin_failed',
        'missing_dependency',
        'client_mod'
    ]) {
        assert.ok(ids.includes(need), `缺少错误类型: ${need}`);
    }
});

check('02 UnsupportedClassVersionError 可命中', () => {
    const r = scan(['java.lang.UnsupportedClassVersionError: net/minecraft/server/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0)']);
    assert.strictEqual(r.findings[0].type, 'unsupported_class_version');
});

check('03 OutOfMemoryError 可命中（含 java heap space 变体）', () => {
    const r = scan(['java.lang.OutOfMemoryError: Java heap space']);
    assert.strictEqual(r.findings[0].type, 'out_of_memory');
});

check('04 BindException 可命中', () => {
    const r = scan(['java.net.BindException: Address already in use: bind']);
    assert.strictEqual(r.findings[0].type, 'bind_exception');
});

check('05 EULA 提示可命中', () => {
    const r = scan(['You need to agree to the EULA in order to run the server. Go to eula.txt for more info.']);
    assert.strictEqual(r.findings[0].type, 'eula');
});

check('06 NoClassDefFoundError 可命中', () => {
    const r = scan(['java.lang.NoClassDefFoundError: com/example/Foo']);
    assert.strictEqual(r.findings[0].type, 'no_class_def');
});

check('07 Mixin apply failed 可命中', () => {
    const r = scan(['[main/ERROR]: Mixin apply failed for mixins.foo.json -> foo.mixins.json:BarMixin']);
    assert.strictEqual(r.findings[0].type, 'mixin_failed');
});

check('08 Missing mandatory dependencies 可命中', () => {
    const r = scan(['[main/ERROR]: Missing or unsupported mandatory dependencies:']);
    assert.strictEqual(r.findings[0].type, 'missing_dependency');
});

check('09 net.minecraft.client 相关报错优先判为客户端模组误装', () => {
    const r = scan([
        'java.lang.NoClassDefFoundError: net/minecraft/client/MinecraftClient',
        '\tat net.caffeinemc.mods.sodium.client.SodiumClientMod.onInitialize(SodiumClientMod.java:42)'
    ]);
    assert.strictEqual(r.findings[0].type, 'client_mod');
});

check('10 每条 pattern 都有 id / severity / test 三要素', () => {
    for (const p of E.ERROR_PATTERNS) {
        assert.ok(typeof p.id === 'string' && p.id, '缺 id');
        assert.ok(['high', 'medium', 'low'].includes(p.severity), `severity 非法: ${p.id}`);
        assert.strictEqual(typeof p.test, 'function', `缺 test: ${p.id}`);
    }
});

check('11 每类错误都有对应的 i18n 文案（err.* / why.* / fix.*）', () => {
    for (const p of E.ERROR_PATTERNS) {
        assert.notStrictEqual(E.t(`err.${p.id}`), `err.${p.id}`, `缺 err.${p.id}`);
        assert.notStrictEqual(E.t(`why.${p.id}`), `why.${p.id}`, `缺 why.${p.id}`);
        assert.ok(Array.isArray(E.t(`fix.${p.id}`)), `缺 fix.${p.id}`);
    }
});

// ==================== 2. 模组名提取 ====================
console.log('\n[2] 模组名提取');

check('12 方括号标签可提取：[sodium]', () => {
    const ids = E.extractModIdsFromLine('[Server thread/ERROR]: [sodium] failed to init');
    assert.ok(ids.includes('sodium'), `未提取到 sodium，实际: ${JSON.stringify(ids)}`);
});

check('13 方括号路径可提取文件名：[/path/mods/iris.jar]', () => {
    const ids = E.extractModIdsFromLine('[ERROR] [/home/mc/mods/iris.jar] broken');
    assert.ok(ids.includes('iris'), `未提取到 iris，实际: ${JSON.stringify(ids)}`);
});

check('14 堆栈包名可提取：com.example.modid.ClassName → modid', () => {
    const ids = E.extractModIdsFromLine('\tat com.example.modid.ClassName.method(ClassName.java:10)');
    assert.ok(ids.includes('modid'), `未提取到 modid，实际: ${JSON.stringify(ids)}`);
});

check('15 深层包名取末尾模组段：...mods.sodium.client → sodium', () => {
    const ids = E.extractModIdsFromLine('\tat net.caffeinemc.mods.sodium.client.SodiumClientMod.onInitialize(SodiumClientMod.java:42)');
    assert.ok(ids.includes('sodium'), `未提取到 sodium，实际: ${JSON.stringify(ids)}`);
});

check('16 排除原版包名 minecraft / mojang', () => {
    assert.deepStrictEqual(E.extractModIdsFromLine('\tat net.minecraft.client.MinecraftClient.<init>(MinecraftClient.java:1)'), []);
    assert.deepStrictEqual(E.extractModIdsFromLine('com.mojang.authlib.GameProfile'), []);
});

check('17 排除加载器与 API 包名 fabricmc / spongepowered / netty', () => {
    assert.deepStrictEqual(E.extractModIdsFromLine('\tat net.fabricmc.loader.impl.FabricLoaderImpl.invokeEntrypoints(FabricLoaderImpl.java:385)'), []);
    assert.deepStrictEqual(E.extractModIdsFromLine('org.spongepowered.asm.mixin.transformer.MixinTransformer'), []);
    assert.deepStrictEqual(E.extractModIdsFromLine('io.netty.channel.AbstractChannel'), []);
});

check('18 日志前缀不被当成模组：[12:00:00] / [main/INFO] / [Server thread/WARN]', () => {
    for (const line of [
        '[12:00:00] [main/INFO]: Loading Minecraft 1.20.1',
        '[12:00:02.123] [Worker-Main-1/ERROR]: failed',
        '[12:00:03] [Netty Server IO #1/INFO]: channel',
        '[main/INFO]: no timestamp',
        '[Server thread/WARN]: no timestamp either'
    ]) {
        assert.deepStrictEqual(E.extractModIdsFromLine(line), [], `误提取: ${line}`);
    }
});

check('19 Mixin 配置名 mixins.xxx.json 不算模组名', () => {
    const ids = E.extractModIdsFromLine('[ERROR]: Mixin apply failed for mixins.unknown.json -> unknown.mixins.json:Foo');
    assert.ok(!ids.includes('unknown'), `误把 unknown 当模组: ${JSON.stringify(ids)}`);
});

check('20 上下文窗口提取：前 10 行内出现过的模组可被找到', () => {
    const lines = [
        '[12:00:00] [main/INFO]: Loading mods: [create] [jei]',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '[12:00:11] [main/ERROR]: java.lang.NoClassDefFoundError: com/example/Foo',
        '\tat com.example.modid.Foo(Foo.java:1)'
    ];
    const ctx = E.extractModIdsFromContext(lines, 10, 10);
    const ids = ctx.map(c => c.id);
    assert.ok(ids.includes('create'), '未在窗口内找到 create');
    assert.ok(ids.includes('modid'), '未在窗口内找到 modid');
});

check('21 超出上下文窗口的模组不应被提取', () => {
    const lines = ['[main/INFO]: mods: [faraway]'];
    for (let i = 0; i < 20; i++) lines.push('');
    lines.push('[ERROR]: java.lang.NoClassDefFoundError: x');
    const ids = E.extractModIdsFromContext(lines, lines.length - 1, 10).map(c => c.id);
    assert.ok(!ids.includes('faraway'), '窗口外的模组被误提取');
});

check('22 normalizeModId 剥离版本与加载器标记', () => {
    assert.strictEqual(E.normalizeModId('sodium-fabric-0.5.8.jar'), 'sodium');
    assert.strictEqual(E.normalizeModId('iris-mc1.20.1-1.6'), 'iris');
    assert.strictEqual(E.normalizeModId('jei-1.20.1-forge-15.2'), 'jei');
    assert.strictEqual(E.normalizeModId('cloth-config-11.1.106-fabric'), 'cloth-config');
});

check('23 本地已安装的模组优先作为嫌疑人', () => {
    const r = E.scanLog([
        '[ERROR]: java.lang.NoClassDefFoundError: com/example/Foo',
        '\tat com.example.sodiumlike.Thing(Thing.java:1)',
        '\tat net.caffeinemc.mods.sodium.client.SodiumClientMod.x(SodiumClientMod.java:42)'
    ].join('\n'), { modsDir: MODS });
    assert.strictEqual(r.findings[0].mod, 'sodium', `应优先选本地已装的 sodium，实际: ${r.findings[0].mod}`);
});

// ==================== 3. 前置缺失联动 ====================
console.log('\n[3] 前置缺失联动');

check('24 Forge 格式可解析出缺失的前置 modid', () => {
    const dep = E.parseMissingDependencies([
        "Missing or unsupported mandatory dependencies:",
        "\tMod ID: 'cloth-config', Requested by: 'trinkets', Expected range: '[11.0,)', Actual version: '[MISSING]'"
    ], 0);
    assert.ok(dep.missing.includes('cloth-config'), `缺失项解析错误: ${JSON.stringify(dep)}`);
    assert.ok(dep.requiredBy.includes('trinkets'), `声明方解析错误: ${JSON.stringify(dep)}`);
});

check('25 Fabric 格式（which is missing）可解析', () => {
    const dep = E.parseMissingDependencies([
        "Mod 'Trinkets' (trinkets) 3.7.0 requires any version of cloth-config, which is missing!"
    ], 0);
    assert.ok(dep.missing.includes('cloth-config'), `缺失项解析错误: ${JSON.stringify(dep)}`);
});

check('26 前置缺失时输出里带上具体缺失模组名', () => {
    const r = scan([
        '[main/ERROR]: Missing or unsupported mandatory dependencies:',
        "\tMod ID: 'cloth-config', Requested by: 'trinkets', Expected range: '[11.0,)', Actual version: '[MISSING]'"
    ], MODS);
    const text = renderText(r);
    assert.ok(text.includes('cloth-config'), '输出未提及缺失的 cloth-config');
    assert.ok(text.includes('trinkets'), '输出未提及声明方 trinkets');
});

check('27 建议中不得出现并不存在的 `wow mod install` 命令', () => {
    const r = scan([
        '[main/ERROR]: Missing or unsupported mandatory dependencies:',
        "\tMod ID: 'cloth-config', Requested by: 'trinkets'"
    ], MODS);
    const text = renderText(r);
    assert.ok(!/wow mod install/.test(text), '输出了不存在的命令 wow mod install');
});

check('27b 前置缺失时嫌疑人取 Requested by，而非上下文里的 missing 等词', () => {
    // 实测中曾把 "which is missing" 里的 missing 当成模组名
    const r = scan([
        '[12:00:02] [main/ERROR]: Missing or unsupported mandatory dependencies:',
        "\tMod ID: 'cloth-config', Requested by: 'trinkets', Expected range: '[11.0,)', Actual version: '[MISSING]'"
    ], MODS);
    assert.strictEqual(r.findings[0].mod, 'trinkets',
        `嫌疑人应为 trinkets，实际: ${r.findings[0].mod}`);
    assert.ok(!r.suspects.includes('missing'), 'missing 不应出现在嫌疑人里');
});

// ==================== 4. 降级策略 ====================
console.log('\n[4] 降级策略');

check('28 模组相关错误但无法定位模组 → fallback=true 且带 AI 提示', () => {
    const r = scan([
        '[main/ERROR]: Mixin apply failed for mixins.unknown.json',
        'org.spongepowered.asm.mixin.transformer.MixinTransformer.applyMixins(MixinTransformer.java:900)'
    ]);
    assert.strictEqual(r.fallback, true, 'fallback 应为 true');
    assert.ok(r.aiHint && r.aiHint.includes('wow logs analyze'), '缺少 AI 兜底提示');
    assert.ok(renderText(r).includes('wow logs analyze'), '渲染输出缺少 AI 提示');
});

check('29 环境类错误（EULA/内存/Java/端口）不应触发 AI 兜底', () => {
    const cases = [
        'You need to agree to the EULA in order to run the server.',
        'java.lang.OutOfMemoryError: Java heap space',
        'java.lang.UnsupportedClassVersionError: x',
        'java.net.BindException: Address already in use'
    ];
    for (const line of cases) {
        const r = scan([line]);
        assert.strictEqual(r.fallback, false, `不该 fallback: ${line}`);
        assert.strictEqual(r.aiHint, null, `不该有 aiHint: ${line}`);
    }
});

check('30 空日志给出明确提示而非崩溃', () => {
    const r = E.scanLog('', { modsDir: EMPTY_MODS });
    assert.strictEqual(r.ok, false);
    assert.ok(r.summary.length > 0);
});

check('31 无匹配错误时 ok=false 且仍给出通用建议', () => {
    const r = scan(['[main/INFO]: Done (3.2s)! For help, type "help"']);
    assert.strictEqual(r.ok, false);
    assert.ok(r.advice.length > 0, '应给出通用建议');
});

check('32 未知模组时命令用 <模组名> 占位，不出现「该模组」', () => {
    const r = scan(['[main/ERROR]: Mixin apply failed for mixins.x.json']);
    const text = renderText(r);
    assert.ok(!/mod (remove|toggle) 该模组/.test(text), '命令里出现了无法执行的「该模组」');
});

check('33 scanLog 对 null / undefined 不抛错', () => {
    assert.doesNotThrow(() => E.scanLog(null));
    assert.doesNotThrow(() => E.scanLog(undefined));
    assert.doesNotThrow(() => E.scanLog(123));
});

// ==================== 5. 冲突检测与渲染 ====================
console.log('\n[5] 冲突检测与终端渲染');

check('34 本地存在多个渲染/优化类模组 → 给出冲突警告', () => {
    const r = E.scanLog('[main/ERROR]: java.lang.NoClassDefFoundError: x', { modsDir: MODS });
    assert.ok(r.renderWarning, '未给出渲染类冲突警告');
    assert.ok(r.renderWarning.mods.includes('sodium'));
    assert.ok(r.renderWarning.mods.includes('iris'));
});

check('35 仅一个渲染类模组时不误报冲突', () => {
    const only = path.join(WORK, 'only-one');
    fs.ensureDirSync(only);
    fs.writeFileSync(path.join(only, 'sodium-fabric-0.5.8.jar'), '');
    const r = E.scanLog('[main/ERROR]: java.lang.NoClassDefFoundError: x', { modsDir: only });
    assert.strictEqual(r.renderWarning, null, '单个渲染模组不应报警');
});

check('36 渲染输出包含要求的分区标题', () => {
    const r = E.scanLog([
        'java.lang.NoClassDefFoundError: net/minecraft/client/MinecraftClient',
        '\tat net.caffeinemc.mods.sodium.client.SodiumClientMod.x(SodiumClientMod.java:42)'
    ].join('\n'), { modsDir: MODS });
    const text = renderText(r);
    for (const need of ['正在进行本地初级诊断', '【明确报错】', '【wow 建议】']) {
        assert.ok(text.includes(need), `缺少标题: ${need}`);
    }
});

check('37 渲染输出包含上下文，且标出当前行', () => {
    const r = E.scanLog([
        '[12:00:00] [main/INFO]: boot',
        '[12:00:01] [main/ERROR]: java.lang.OutOfMemoryError: Java heap space'
    ].join('\n'), { modsDir: EMPTY_MODS });
    const text = renderText(r);
    assert.ok(text.includes('上下文'), '缺少上下文分区');
    assert.ok(text.includes('OutOfMemoryError'), '上下文中未包含报错行');
    assert.ok(/^\s*>/m.test(text.split('\n').find(l => l.includes('OutOfMemoryError')) || ''), '未用 > 标出当前行');
});

check('38 renderReport 不直接打印，只返回行数组', () => {
    const r = scan(['java.lang.OutOfMemoryError: x']);
    const out = E.renderReport(r);
    assert.ok(Array.isArray(out), '应返回数组');
    assert.ok(out.length > 0);
});

check('39 stripAnsi 可完整清除颜色码', () => {
    const painted = E.paint('hello', 'red', 'bold');
    assert.ok(!/\x1b\[/.test(E.stripAnsi(painted)));
    assert.strictEqual(E.stripAnsi(painted), 'hello');
});

check('40 非 TTY 下 paint 不带颜色码', () => {
    const saved = process.stdout.isTTY;
    process.stdout.isTTY = false;
    // 重新加载模块以获得正确判定
    delete require.cache[require.resolve(path.join(SRC, 'error_scanner.js'))];
    const E2 = require(path.join(SRC, 'error_scanner.js'));
    assert.strictEqual(E2.paint('x', 'red'), 'x');
    process.stdout.isTTY = saved;
    delete require.cache[require.resolve(path.join(SRC, 'error_scanner.js'))];
});

// ==================== 6. server.js 接入 ====================
console.log('\n[6] server.js 接入');

check('41 server.js 在非零退出码分支调用 _diagnoseCrash', () => {
    const src = read('server.js');
    assert.ok(/_diagnoseCrash\(code\)/.test(src), '未调用 _diagnoseCrash');
    const exitIdx = src.indexOf("if (code && code !== 0)");
    const callIdx = src.indexOf('this._diagnoseCrash(code)');
    assert.ok(exitIdx > 0 && callIdx > exitIdx, '调用位置不在异常退出分支内');
});

check('42 _diagnoseCrash 内部包了 try/catch，不会影响退出流程', () => {
    const src = read('server.js');
    const start = src.indexOf('_diagnoseCrash(code) {');
    const body = src.slice(start, start + 1200);
    assert.ok(/try\s*\{/.test(body) && /catch/.test(body), '缺少异常保护');
});

check('43 不再直接 console.log「服务器进程退出，退出码」这类裸输出', () => {
    const src = read('server.js');
    const start = src.indexOf("if (code && code !== 0)");
    const body = src.slice(start, start + 600);
    assert.ok(!/console\.log\(`服务器进程退出，退出码: \$\{code\}`\);\s*\n\s*logger\.erro/.test(body),
        '异常退出分支仍在直接 print 退出码');
});

check('44 诊断器不发起任何网络请求（不依赖 fetch / axios / http 模块）', () => {
    const src = read('error_scanner.js');
    // 去掉注释后再检查，避免把说明文字里的网址误判成请求
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(/.test(code), '不应使用 fetch');
    assert.ok(!/require\(['"]axios['"]\)/.test(code), '不应引用 axios');
    assert.ok(!/require\(['"]https?['"]\)/.test(code), '不应引用 http/https 模块');
    assert.ok(!/https?:\/\/[^\s'"`]/.test(code), '不应包含任何 http(s) 地址字面量');
});

check('45 正常退出（code === 0）不触发诊断', () => {
    const src = read('server.js');
    const elseIdx = src.indexOf("} else {\n                console.log(`服务器进程退出，退出码: ${code}`);");
    assert.ok(elseIdx > 0, '未找到 else 分支');
    const elseBody = src.slice(elseIdx, elseIdx + 300);
    assert.ok(!/_diagnoseCrash/.test(elseBody), '正常退出分支不该调用诊断');
});

// ==================== 7. i18n 预留 ====================
console.log('\n[7] i18n');

check('46 支持 zh/en 两套语言表，key 一致', () => {
    const zh = Object.keys(E.MESSAGES.zh).sort();
    const en = Object.keys(E.MESSAGES.en).sort();
    assert.deepStrictEqual(en, zh, '中英文 key 不一致');
});

check('47 setLocale 可切换语言', () => {
    E.setLocale('en');
    assert.ok(E.t('err.eula').length > 0);
    assert.strictEqual(E.getLocale(), 'en');
    E.setLocale('zh');
    assert.strictEqual(E.getLocale(), 'zh');
    assert.ok(E.t('err.eula').includes('EULA'), '中文文案异常');
});

check('48 未知 key 原样返回，不抛错', () => {
    assert.strictEqual(E.t('no.such.key'), 'no.such.key');
});

// ==================== 汇总 ====================
console.log('\n----------------------------------------');
if (fail === 0) {
    console.log(`✅ 全部通过：${pass} 项`);
    process.exit(0);
} else {
    console.log(`❌ ${fail} 项失败 / ${pass} 项通过`);
    for (const f of failures) {
        console.log(`   • ${f.title}: ${f.err.message}`);
    }
    process.exit(1);
}
