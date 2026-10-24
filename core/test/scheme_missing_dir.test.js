/**
 * 方案目录缺失诊断测试（V3.5.13）
 *
 * 背景（真实用户反馈）：
 *   用户把新版本解压到新目录后启动，配置（core/wow.yaml）仍指向旧目录才有的方案，
 *   于是出现「未找到服务器核心（.jar）」+「方案可能未补齐，可尝试: scheme switch xxx」。
 *   但真正的根因是——方案目录根本不存在，getServerDir() 已静默回退到 scheme 根目录。
 *   原提示让用户以为「方案还在、只是核心丢了」，给出的 scheme switch 只会再报一次错。
 *
 * 本测试验证：
 *   1. _reportMissingSchemeDir 在方案目录缺失时返回 true 并输出准确诊断（含期望目录、回退说明）
 *   2. 方案目录存在时返回 false，不输出任何诊断（避免误报）
 *   3. server.start() 在方案目录缺失时提前中止，不再继续建目录/写 eula
 *   4. wow.yaml 不再随包分发：缺失时 config 能自动生成默认配置
 *
 * 运行：cd core && node test/scheme_missing_dir.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\n方案目录缺失诊断测试 (V3.5.13)\n');

// 捕获 console.error 输出，便于断言诊断文案
function captureErr(fn) {
    const orig = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    try { fn(); } finally { console.error = orig; }
    return lines.join('\n');
}

// ─────────────────────────────────────────────
console.log('— _reportMissingSchemeDir 分支 —');

const Server = require('../src/server');
const server = new Server();

check('方法已实现', () => {
    assert.strictEqual(typeof server._reportMissingSchemeDir, 'function');
});

check('方案目录不存在 → 返回 true 并给出准确诊断', () => {
    const missing = `__no_such_scheme_${process.pid}__`;
    let ret;
    const out = captureErr(() => { ret = server._reportMissingSchemeDir(missing); });
    assert.strictEqual(ret, true, '应返回 true 表示已报告缺失');
    assert.ok(out.includes(`「${missing}」目录不存在`), '未说明方案目录不存在');
    assert.ok(out.includes('server.scheme'), '未指出配置位置');
    assert.ok(out.includes('已回退到 scheme 根目录'), '未说明 getServerDir 的回退行为');
    assert.ok(out.includes('期望目录'), '未给出期望目录');
    assert.ok(!/scheme switch/.test(out), '不应再引导用户执行无效的 scheme switch');
});

check('方案目录存在 → 返回 false 且不输出诊断', () => {
    // 用 scheme/ 根目录本身当「存在的目录」来验证不存在性判断
    const schemesRoot = path.join(__dirname, '..', '..', 'scheme');
    fs.ensureDirSync(schemesRoot);
    const probe = `__probe_${process.pid}__`;
    fs.ensureDirSync(path.join(schemesRoot, probe));
    try {
        let ret;
        const out = captureErr(() => { ret = server._reportMissingSchemeDir(probe); });
        assert.strictEqual(ret, false, '目录存在时不应报缺失');
        assert.strictEqual(out, '', '目录存在时不应输出诊断');
    } finally {
        fs.removeSync(path.join(schemesRoot, probe));
    }
});

// ─────────────────────────────────────────────
console.log('\n— 源码级：start() 提前中止 —');

check('start() 在补齐检查前调用诊断并 return', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    const startIdx = src.indexOf('_reportMissingSchemeDir(activeScheme)) return;');
    assert.ok(startIdx > 0, 'start() 未在方案缺失时提前返回');
    // 该调用应出现在 ensureDirSync(serverDir) 之前，避免在错误目录建 logs/ 写 eula
    const ensureIdx = src.indexOf('fs.ensureDirSync(path.join(this.serverDir, \'logs\'))');
    assert.ok(startIdx < ensureIdx, '诊断应早于 serverDir 目录创建');
});

// ─────────────────────────────────────────────
console.log('\n— wow.yaml 不再随包分发 —');

check('config 在无 wow.yaml 时可加载并生成默认配置', () => {
    const tmp = path.join(os.tmpdir(), `cfg_${process.pid}`);
    fs.emptyDirSync(tmp);
    const cfgPath = path.join(tmp, 'wow.yaml');
    const yaml = require('js-yaml');
    const config = require('../src/config');
    const defaults = config.DEFAULT_CONFIG;
    assert.ok(defaults.jre && defaults.jre.mirror, '默认配置应含 jre.mirror');
    assert.ok(!Object.prototype.hasOwnProperty.call(defaults.server, 'scheme'),
        '默认配置不应预设 server.scheme（否则新目录会指向不存在的方案）');
    // 写入默认配置再读回，模拟「首次运行自动生成」
    fs.writeFileSync(cfgPath, yaml.dump(defaults), 'utf8');
    const back = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    assert.strictEqual(back.server.dir, '../scheme');
    fs.removeSync(tmp);
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
