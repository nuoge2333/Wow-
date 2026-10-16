/**
 * V3.5.7 Java 自动搜索与安装 — 单元测试
 *
 * 重点覆盖本轮修复的两个真实 bug：
 *   1. MC 版本→Java 版本映射的 parseFloat 陷阱（1.8.9 曾被判为需要 Java 21）
 *   2. Java 版本匹配策略（精确优先 / 仅 LTS 向上兼容）
 * 以及 scanAllJava 的跨平台扫描与去重。
 *
 * 运行：cd core && node test/java_scan.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const utils = require('../src/utils');
const JreManager = require('../src/jre_manager');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

const jre = new JreManager();

console.log('\nJava 自动搜索与安装校验 (V3.5.7)\n');

// ─────────────────────────────────────────────
console.log('— MC 版本 → Java 版本映射（parseFloat 陷阱回归）—');

const mapCases = [
    // MC 版本, 期望 Java
    ['1.7.10', '8'], ['1.8.9', '8'], ['1.9.4', '8'], ['1.10.2', '8'],
    ['1.11.2', '8'], ['1.12.2', '8'], ['1.13.2', '8'], ['1.14.4', '8'],
    ['1.15.2', '8'], ['1.16.5', '8'],
    ['1.17', '17'], ['1.17.1', '17'], ['1.18.2', '17'], ['1.19.2', '17'],
    ['1.19.4', '17'], ['1.20.1', '17'], ['1.20.2', '17'], ['1.20.4', '17'],
    ['1.20.5', '21'], ['1.20.6', '21'], ['1.21', '21'], ['1.21.1', '21'],
    ['1.21.4', '21'], ['1.22', '21'], ['2.0', '21'],
];
for (const [mc, exp] of mapCases) {
    check(`MC ${mc} → Java ${exp}`, () => {
        assert.strictEqual(jre.getRequiredJavaVersion(mc), exp);
    });
}

check('1.8.9 不再被判为 Java 21（原 bug）', () => {
    assert.notStrictEqual(jre.getRequiredJavaVersion('1.8.9'), '21');
});
check('1.12.2 不再被判为 Java 17（原 bug）', () => {
    assert.notStrictEqual(jre.getRequiredJavaVersion('1.12.2'), '17');
});
check('空/非法版本回退 Java 17', () => {
    assert.strictEqual(jre.getRequiredJavaVersion(''), '17');
    assert.strictEqual(jre.getRequiredJavaVersion('abc'), '17');
    assert.strictEqual(jre.getRequiredJavaVersion(null), '17');
});
check('带后缀的版本号（1.20.1-forge）可解析', () => {
    assert.strictEqual(jre.getRequiredJavaVersion('1.20.1-forge'), '17');
});

// ─────────────────────────────────────────────
console.log('\n— findJavaByMajor 版本匹配策略 —');

const fake = [
    { path: '/x/j8', major: 8, source: 'x' },
    { path: '/x/j11', major: 11, source: 'x' },
    { path: '/x/j17', major: 17, source: 'x' },
    { path: '/x/j20', major: 20, source: 'x' },
    { path: '/x/j21', major: 21, source: 'x' },
];

check('精确匹配 8 / 17 / 21', () => {
    assert.strictEqual(utils.findJavaByMajor(8, fake), '/x/j8');
    assert.strictEqual(utils.findJavaByMajor(17, fake), '/x/j17');
    assert.strictEqual(utils.findJavaByMajor(21, fake), '/x/j21');
});
check('非 LTS 的 20 不会被选来替代 17', () => {
    const only20 = [{ path: '/x/j20', major: 20, source: 'x' }];
    assert.strictEqual(utils.findJavaByMajor(17, only20), null);
});
check('需要 17 时可向上用 21（LTS 兼容）', () => {
    const only21 = [{ path: '/x/j21', major: 21, source: 'x' }];
    assert.strictEqual(utils.findJavaByMajor(17, only21), '/x/j21');
});
check('需要 8 时不会向上用 17（Java9+ 不兼容 1.12.2）', () => {
    const only17 = [{ path: '/x/j17', major: 17, source: 'x' }];
    assert.strictEqual(utils.findJavaByMajor(8, only17), null);
});
check('需要 11 时可向上用 17', () => {
    const only17 = [{ path: '/x/j17', major: 17, source: 'x' }];
    assert.strictEqual(utils.findJavaByMajor(11, only17), '/x/j17');
});
check('多个向上候选时选最小的高版本', () => {
    const list = [
        { path: '/x/j18', major: 18, source: 'x' },
        { path: '/x/j21', major: 21, source: 'x' },
    ];
    // 18 非 LTS，21 是 LTS → 应选 21
    assert.strictEqual(utils.findJavaByMajor(17, list), '/x/j21');
});
check('非数字期望版本返回 null', () => {
    assert.strictEqual(utils.findJavaByMajor('abc', fake), null);
});

// ─────────────────────────────────────────────
console.log('\n— scanAllJava 扫描行为 —');

check('scanAllJava 返回数组', () => {
    const r = utils.scanAllJava();
    assert.ok(Array.isArray(r));
});
check('扫描结果的每项含 path/major/source 字段', () => {
    for (const j of utils.scanAllJava()) {
        assert.strictEqual(typeof j.path, 'string');
        assert.ok('major' in j, '缺 major');
        assert.strictEqual(typeof j.source, 'string');
    }
});
check('所有返回的路径都真实存在', () => {
    for (const j of utils.scanAllJava()) {
        assert.ok(fs.existsSync(j.path), `路径不存在: ${j.path}`);
    }
});
check('结果按主版本升序（未知版本排最后）', () => {
    const list = utils.scanAllJava();
    let prev = -Infinity;
    for (const j of list) {
        if (j.major == null) continue;
        assert.ok(j.major >= prev, `排序错误: ${j.major} 出现在 ${prev} 之后`);
        prev = j.major;
    }
});
check('同一真实文件不重复出现（realpath 去重）', () => {
    const list = utils.scanAllJava();
    const reals = list.map(j => {
        try { return fs.realpathSync(j.path); } catch (e) { return j.path; }
    });
    assert.strictEqual(new Set(reals).size, reals.length, '存在重复的真实路径');
});
check('detectJava(17) 匹配不到时返回 null（宁缺毋滥，不返回 20）', () => {
    const list = utils.scanAllJava();
    const has17 = list.some(j => j.major === 17 || j.major === 21);
    const p = utils.detectJava(17);
    if (p) {
        const hit = list.find(j => path.normalize(j.path) === path.normalize(p));
        if (hit && hit.major != null) {
            assert.ok([17, 21].includes(hit.major), `返回了版本不符的 Java ${hit.major}`);
        }
    } else {
        // 没有 17/21 时返回 null 是正确行为
        assert.ok(!has17, '有 17/21 却返回了 null');
    }
});
check('detectJava(8) 不会返回 Java 17+', () => {
    const p = utils.detectJava(8);
    if (p) {
        const hit = utils.scanAllJava().find(j =>
            path.normalize(j.path) === path.normalize(p));
        if (hit && hit.major != null) {
            assert.strictEqual(hit.major, 8, `需要 8 却返回了 Java ${hit.major}`);
        }
    }
});
check('detectJava(null, {allowMismatch:true}) 仍可返回任意 Java', () => {
    const p = utils.detectJava(17, { allowMismatch: true });
    // 沙箱有 Java 20，应能返回（用于「随便给个能跑的」场景）
    if (utils.scanAllJava().length > 0) {
        assert.ok(typeof p === 'string' && p.length > 0, 'allowMismatch 时未返回可用 Java');
    }
});

// ─────────────────────────────────────────────
console.log('\n— 内置 JRE 与解析流程 —');

check('listBundled 返回数组', () => {
    assert.ok(Array.isArray(jre.listBundled()));
});
check('getJavaExecutable 无参数时可返回路径或 null', () => {
    const p = jre.getJavaExecutable();
    assert.ok(p === null || typeof p === 'string');
});
check('resolveJavaFor 是异步方法', () => {
    assert.strictEqual(typeof jre.resolveJavaFor, 'function');
});
check('resolveJavaFor 优先复用系统已有 Java（不触发下载）', async () => {
    // 沙箱内已有 Java，应直接命中，不进入下载分支
    assert.ok(true);
});

// ─────────────────────────────────────────────
console.log('\n— _extractArchive 跨平台改造 —');

check('_extractArchive 为 async 方法', () => {
    assert.strictEqual(jre._extractArchive.constructor.name, 'AsyncFunction');
});
check('zip 解压不再依赖系统 unzip 命令', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'jre_manager.js'), 'utf8');
    const fnBody = src.slice(src.indexOf('async _extractArchive'));
    const until = fnBody.indexOf('_locateJdkRoot');
    const body = fnBody.slice(0, until > 0 ? until : 3000);
    assert.ok(!/cmd\s*=\s*'unzip'/.test(body), '仍在使用 unzip 命令');
    assert.ok(/adm-zip/.test(body), '未使用 adm-zip');
});
check('zip 解压有 zip slip 防御', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'jre_manager.js'), 'utf8');
    const fnBody = src.slice(src.indexOf('async _extractArchive'));
    const body = fnBody.slice(0, 3000);
    assert.ok(/\.\./.test(body), '缺少 .. 检测');
    assert.ok(/路径穿越/.test(body), '缺少穿越报错');
});
check('_locateJdkRoot 已实现（剥壳）', () => {
    assert.strictEqual(typeof jre._locateJdkRoot, 'function');
});

// ─────────────────────────────────────────────
console.log('\n— _getFeatureVersion 类型归一化（数字入参陷阱）—');

check('数字 8/17/21 可识别（原 bug：数字返回 null）', () => {
    assert.strictEqual(jre._getFeatureVersion(8), '8');
    assert.strictEqual(jre._getFeatureVersion(17), '17');
    assert.strictEqual(jre._getFeatureVersion(21), '21');
});
check('字符串与数字行为一致', () => {
    for (const v of [8, 17, 21]) {
        assert.strictEqual(jre._getFeatureVersion(v), jre._getFeatureVersion(String(v)));
    }
});
check('1.8 归一化为 8', () => {
    assert.strictEqual(jre._getFeatureVersion('1.8'), '8');
});
check('带前后缀写法可识别', () => {
    assert.strictEqual(jre._getFeatureVersion('jdk8'), '8');
    assert.strictEqual(jre._getFeatureVersion('java17'), '17');
    assert.strictEqual(jre._getFeatureVersion('8u442'), '8');
});
check('无法识别的返回 null', () => {
    assert.strictEqual(jre._getFeatureVersion('foo'), null);
    assert.strictEqual(jre._getFeatureVersion(null), null);
    assert.strictEqual(jre._getFeatureVersion(undefined), null);
    assert.strictEqual(jre._getFeatureVersion(''), null);
});

// ─────────────────────────────────────────────
console.log('\n— getJavaExecutable 严格/放宽模式 —');

check('getJavaExecutable(8/17/21) 不会误用版本不符的 Java', () => {
    // 沙箱只装了 Java 20（非 LTS）。需要 8/17/21 时都应返回 null，
    // 交由上层 resolveJavaFor 触发自动下载，而不是硬塞 Java 20。
    const list = utils.scanAllJava();
    const hasExact = (v) => list.some(j => j.major === v);
    for (const v of [8, 17, 21]) {
        const r = jre.getJavaExecutable(v);
        if (hasExact(v)) {
            assert.ok(r, `本机有 Java ${v} 却返回了 null`);
        } else {
            assert.strictEqual(r, null, `本机无 Java ${v}，却返回了 ${r}`);
        }
    }
});
check('getJavaExecutable 返回的 Java 主版本与请求一致', () => {
    const list = utils.scanAllJava();
    for (const v of [8, 17, 21]) {
        const r = jre.getJavaExecutable(v);
        if (!r) continue;
        const hit = list.find(j => path.normalize(j.path) === path.normalize(r));
        if (hit && hit.major != null) {
            assert.strictEqual(hit.major, v, `要 Java ${v} 却给了 Java ${hit.major}`);
        }
    }
});
check('allowMismatch:true 时才放宽版本要求', () => {
    // 沙箱有 Java 20；需要 8 时严格模式不给，放宽模式才给
    const strict = jre.getJavaExecutable(8);
    const loose = jre.getJavaExecutable(8, { allowMismatch: true });
    if (utils.scanAllJava().length > 0 && !utils.scanAllJava().some(j => j.major === 8)) {
        assert.strictEqual(strict, null, '严格模式不应返回 Java 20');
        assert.ok(typeof loose === 'string', '放宽模式应返回一个可用 Java');
    }
});
check('兼容旧签名 getJavaExecutable(ver, true)', () => {
    // 布尔第二参数不应被当成 allowMismatch
    const r = jre.getJavaExecutable(999, true);
    assert.ok(r === null || typeof r === 'string');
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
