#!/usr/bin/env node
/**
 * `wow :mc` 控制台接入回归测试
 * ----------------------------------------------------------------
 * 盯三件事（均为纯函数，无需真实服务器）：
 *   1. 退出词识别（exit / :q / Ctrl+C 语义）；
 *   2. tailLines 只读尾部非空行；
 *   3. readRange 读取区间正确，且读取失败不抛错。
 *
 * 运行：node test/mc_console.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isExitCommand, tailLines, readRange } = require('../src/mc_console');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-mc-console-'));
const logFile = path.join(tmp, 'latest.log');

try {
    console.log('\n— :mc 退出词识别 —');
    ['exit', ':exit', ':q', 'q', 'quit', ':quit', ':bye', ' EXIT ', ':Q'].forEach(w => {
        check(`识别退出词 ${JSON.stringify(w)}`, () => {
            if (!isExitCommand(w)) throw new Error(`应识别为退出词: ${w}`);
        });
    });
    ['list', 'say hi', 'op Steve', '', '   ', 'exitnow', 'query'].forEach(w => {
        check(`非退出词原样下发 ${JSON.stringify(w)}`, () => {
            if (isExitCommand(w)) throw new Error(`不应识别为退出词: ${w}`);
        });
    });

    console.log('\n— 尾部日志读取 —');
    check('tailLines 读尾部 N 条非空行', () => {
        fs.writeFileSync(logFile, Array.from({ length: 20 }, (_, i) => `line-${i + 1}`).join('\n') + '\n');
        const lines = tailLines(logFile, 5);
        if (lines.length !== 5) throw new Error(`期望 5 行，实得 ${lines.length}`);
        if (lines[4] !== 'line-20') throw new Error(`末行错误: ${lines[4]}`);
    });
    check('tailLines 忽略空行', () => {
        fs.writeFileSync(logFile, 'a\n\n\nb\n');
        const lines = tailLines(logFile, 10);
        if (lines.join(',') !== 'a,b') throw new Error(`结果错误: ${lines.join(',')}`);
    });
    check('tailLines 文件不存在返回空数组', () => {
        if (tailLines(path.join(tmp, 'nope.log'), 5).length !== 0) throw new Error('应为空');
    });

    console.log('\n— 字节区间读取 —');
    check('readRange 读取指定区间', () => {
        fs.writeFileSync(logFile, 'abcdefghij');
        const s = readRange(logFile, 2, 6);
        if (s !== 'cdef') throw new Error(`期望 cdef，实得 ${s}`);
    });
    check('readRange 文件不存在返回空串（不抛错）', () => {
        const s = readRange(path.join(tmp, 'nope.log'), 0, 5);
        if (s !== '') throw new Error(`应为空串，实得 ${s}`);
    });
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

console.log('\n— _follow 存活检测（静态守卫）—');
const mcSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'mc_console.js'), 'utf8');
check('_follow 降频检测 isRunning 并优雅离开', () => {
    if (!/LIVENESS_CHECK_EVERY = 10/.test(mcSrc)) throw new Error('未定义降频常量');
    if (!/_livenessTick % LIVENESS_CHECK_EVERY/.test(mcSrc)) throw new Error('_follow 未降频检测');
    if (!/this\.server\.isRunning\(\)/.test(mcSrc)) throw new Error('未用 isRunning 判存活');
    if (!/this\._finish\('mc\.console:server-exit'\)/.test(mcSrc)) throw new Error('未触发优雅离开');
});
check('存活检测刻意不用心跳，避免「在跑但无中继」误踢', () => {
    // _follow 的新增检测块里应只有 isRunning，不应出现 isConsoleRelayAlive
    const m = mcSrc.match(/_livenessTick % LIVENESS_CHECK_EVERY[\s\S]{0,600}?_finish\('mc\.console:server-exit'\)/);
    if (!m) throw new Error('未找到存活检测块');
    if (/isConsoleRelayAlive/.test(m[0])) throw new Error('存活检测不应使用心跳（会误踢无中继场景）');
});

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
