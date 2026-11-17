/**
 * 回归测试：诊断器误报修复（第三方审查 P0 + P1）
 *
 * P0：主动停止（server kill / stop 超时强杀）不得触发 error_scanner
 * P1：模组名提取——清洗 .jar 后缀、停用词黑名单、mod remove 建议前校验真实存在
 */
'use strict';

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const E = require(path.join(SRC, 'error_scanner.js'));

let pass = 0, fail = 0;
const failures = [];
function check(title, fn) {
    try { fn(); pass++; console.log(`  ✅ ${title}`); }
    catch (e) { fail++; failures.push({ title, err: e }); console.log(`  ❌ ${title}: ${e.message}`); }
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), `diagfp_${process.pid}_`));
const MODS = path.join(WORK, 'mods');
fs.ensureDirSync(MODS);
// 只装一个真实模组 sodium
fs.writeFileSync(path.join(MODS, 'sodium-fabric-0.5.8.jar'), '');
process.on('exit', () => { try { fs.removeSync(WORK); } catch (e) {} });

console.log('\n[A] P0 主动停止不触发诊断');

check('A1 底层 diagnoseOnCrash 收到 isManualStop:true 直接拒绝诊断', () => {
    const result = E.diagnoseOnCrash({
        isManualStop: true,
        print: false,
        logFile: path.join(WORK, 'nonexistent.log')
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.findings, []);
    assert.ok(result.summary.includes('跳过诊断'));
});

check('A2 非主动停止(isManualStop 缺省)仍正常诊断崩溃日志', () => {
    const log = path.join(WORK, 'crash.log');
    fs.writeFileSync(log, '[main/ERROR]: java.lang.OutOfMemoryError: Java heap space');
    const result = E.diagnoseOnCrash({ print: false, logFile: log });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.findings[0].type, 'out_of_memory');
});

check('A3 server.js exit 回调接收 signal 参数', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    assert.ok(/\.on\('exit',\s*\(code,\s*signal\)/.test(src), 'exit 回调未接收 signal');
});

check('A4 退出状态机不再用退出码/信号兜底判正常（防漏报）', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    // 旧实现里 code===0 / 143 / 137 一律判正常，是漏报根因，必须移除。
    assert.ok(!/code === 0 \|\| code === 143/.test(src), '仍残留 code===0 兜底');
    assert.ok(!/signalStop/.test(src), '仍残留 signalStop 信号兜底');
});

check('A5 isManualStop 严格按意图标记判定（intendedShutdown / 跨进程标记 / _stopRequested）', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    assert.ok(/const isManualStop = this\.intendedShutdown === true\s*\n?\s*\|\| this\._stopRequested === true \|\| manualFlag/.test(src),
        'isManualStop 未以 intendedShutdown 为准');
});

check('A6 stop() 与 kill() 都经 _markIntendedShutdown 置意图标记', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    const calls = (src.match(/this\._markIntendedShutdown\(\);/g) || []).length;
    assert.ok(calls >= 2, `stop/kill 应各置一次意图标记，实际调用数：${calls}`);
    // 统一入口内部必须同时写跨进程标记文件。
    assert.ok(/intendedShutdown = true;[\s\S]{0,120}_writeManualStopFlag\(\)/.test(src),
        '_markIntendedShutdown 未写跨进程标记');
});

check('A7 _diagnoseCrash 内部再次拦截 isManualStop', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    assert.ok(/if \(this\._isManualStop === true\) return;/.test(src), '_diagnoseCrash 缺二次拦截');
});

check('A8 _diagnoseCrash 向底层传递 isManualStop', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    assert.ok(/isManualStop: this\._isManualStop === true/.test(src), '未向底层传递 isManualStop');
});

check('A9 底层 diagnoseOnCrash 有 isManualStop 拦截分支', () => {
    const src = fs.readFileSync(path.join(SRC, 'error_scanner.js'), 'utf8');
    assert.ok(/opts\.isManualStop === true/.test(src), '底层缺 isManualStop 判断');
});

check('A10 跨进程主动停止标记只认 60 秒内', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    assert.ok(/Date\.now\(\) - ts\) < 60000/.test(src), '标记未设时效');
});

console.log('\n[B] P1 模组名提取清洗');

check('B1 .jar 及其后内容被截断：jna-5.12.1.jar:5 → jna', () => {
    assert.strictEqual(E.normalizeModId('jna-5.12.1.jar:5'), 'jna');
    assert.strictEqual(E.normalizeModId('iris-1.6.jar:42'), 'iris');
});

check('B2 合法模组名清洗不受影响', () => {
    assert.strictEqual(E.normalizeModId('sodium-fabric-0.5.8.jar'), 'sodium');
    assert.strictEqual(E.normalizeModId('jarvis-mod-1.0'), 'jarvis-mod');
});

check('B3 停用词 in/at/more/thread/Exception/Error 不被识别为模组', () => {
    for (const line of ['[in] at more', '[Exception]', '[Error]: something', 'thread in at more']) {
        const ids = E.extractModIdsFromLine(line);
        assert.deepStrictEqual(ids, [], `停用词被误识别：${line} → ${JSON.stringify(ids)}`);
    }
});

check('B4 停用词黑名单已导出且覆盖要求的词', () => {
    const sw = E.NON_MOD_STOP_WORDS;
    assert.ok(sw, '未导出 NON_MOD_STOP_WORDS');
    for (const word of ['in', 'at', 'more', 'thread', 'exception', 'error']) {
        assert.ok(sw.has(word), `黑名单缺：${word}`);
    }
});

check('B5 合法模组名仍能被提取（黑名单不过度过滤）', () => {
    const ids = E.extractModIdsFromLine('[sodium] Caught exception from mod');
    assert.ok(ids.includes('sodium'), `sodium 被误过滤：${JSON.stringify(ids)}`);
});

console.log('\n[C] P1 mod remove 建议前校验真实存在');

check('C1 未安装的模组不生成 mod remove 建议', () => {
    const r = E.scanLog('[main/ERROR]: Mixin apply failed for foo.mixins.json\n\tat com.evilmod.core.Mixin.apply(Mixin.java:1)', { modsDir: MODS });
    const text = E.stripAnsi(E.renderReport(r).join('\n'));
    const evil = /wow mod (remove|toggle)\s+evilmod/i.test(text);
    assert.strictEqual(evil, false, `未安装的 evilmod 竟生成了删除建议：\n${text}`);
});

check('C2 真实安装的模组可生成 mod remove 建议', () => {
    const r = E.scanLog('[main/ERROR]: Mixin apply failed for mixins.sodium.json\n\tat net.caffeinemc.mods.sodium.client.SodiumMixin.x(SodiumMixin.java:1)', { modsDir: MODS });
    const text = E.stripAnsi(E.renderReport(r).join('\n'));
    assert.ok(/wow mod (remove|toggle)\s+sodium/.test(text), `已装的 sodium 未生成建议：\n${text}`);
});

check('C3 buildAdvice 存在性校验用 fs.existsSync', () => {
    const src = fs.readFileSync(path.join(SRC, 'error_scanner.js'), 'utf8');
    assert.ok(/fs\.existsSync\(path\.join\(modsDir, matched\.file\)\)/.test(src), '未用 fs.existsSync 校验 Jar');
});

check('C4 未知模组时命令用占位符，不出现裸的该模组', () => {
    const r = E.scanLog('[main/ERROR]: Mixin apply failed for mixins.x.json', { modsDir: MODS });
    const text = E.stripAnsi(E.renderReport(r).join('\n'));
    assert.ok(!/wow mod remove 该模组/.test(text), '出现无法执行的「该模组」命令');
});

console.log('\n----------------------------------------');
if (fail === 0) {
    console.log(`✅ 全部通过：${pass} 项`);
    process.exit(0);
} else {
    console.log(`❌ ${fail} 项失败 / ${pass} 项通过`);
    for (const f of failures) console.log(`   • ${f.title}: ${f.err.message}`);
    process.exit(1);
}
