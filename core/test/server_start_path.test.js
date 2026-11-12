#!/usr/bin/env node
/**
 * server start 主路径回归（执行令阶段 1/3/5）
 * ----------------------------------------------------------------
 * `start()` 有几个「改一处就静默坏掉」的坑，这里用源码形状把它们钉死：
 *   - stdio 必须是 pipe + 手动 write，不能把 logStream 塞进 stdio（否则
 *     child.stdout === null，_writePid 根本走不到，仪表盘全 0）；
 *   - 两处 spawn 都要登记 shutdown，否则强关终端 MC 变孤儿；
 *   - 交互分支要 set(VIEW.MC)、装 detach 用的 SIGINT；
 *   - log.disabled 时内存垫片不落盘、关服只留 latest.log。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const srv = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function check(title, fn) {
    try {
        fn();
        console.log(`  ✅ ${title}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${title}  → ${e.message}`);
        fail++;
    }
}

console.log('\n=== server start 主路径（执行令红线）===\n');

// 截取 start() 方法体，避免命中文件里其它同名注释
const startIdx = srv.indexOf('    async start(memory = null, extraJvmArgs = \'\') {');
const stopIdx = srv.indexOf('    async stop(timeout = 30000) {');
const startBody = startIdx > 0 && stopIdx > startIdx
    ? srv.slice(startIdx, stopIdx)
    : srv.slice(startIdx, startIdx + 7000);

check('定位到 start() 方法体', () => {
    assert.ok(startIdx > 0, '未找到 start() 定义');
});

check('两处 spawn 都用 stdio: [pipe,pipe,pipe]', () => {
    const n = (startBody.match(/stdio:\s*\['pipe',\s*'pipe',\s*'pipe'\]/g) || []).length;
    assert.strictEqual(n, 2, `交互/非交互分支应各一处，实际 ${n}`);
    assert.ok(!/stdio:\s*\[[^\]]*logStream/.test(startBody),
        '不能把 logStream 塞进 stdio（child.stdout 会变 null）');
});

check('两处 spawn 之后都调 _registerShutdown()', () => {
    const n = (startBody.match(/this\._registerShutdown\(\)/g) || []).length;
    assert.strictEqual(n, 2, `实际 ${n} 处`);
});

check('child.stdout / stderr 的 data 里都手动 logStream.write(data)', () => {
    const n = (startBody.match(/logStream\.write\(data\);/g) || []).length;
    assert.ok(n >= 4, `交互 2 路 + 非交互 2 路，实际 ${n} 行`);
    assert.ok(/_logMcChunk\(data\)/.test(startBody), '缺 MC 输出内存留痕');
});

check('_mode === mc && !tuiOwnsScreen() 的回显闸门保留', () => {
    assert.ok(/this\._mode === 'mc' && !tuiOwnsScreen\(\)/.test(startBody),
        'MC 输出回显条件被改动，可能从菜单底下顶出来');
});

check('spawn 之后才 _writePid(this.process.pid)', () => {
    assert.ok(/_writePid\(this\.process\.pid\)/.test(startBody));
    const lastSpawn = startBody.lastIndexOf('this.process = spawn(');
    const pid = startBody.indexOf('_writePid(this.process.pid)');
    assert.ok(pid > lastSpawn, 'PID 写入必须在 spawn 之后');
});

check('交互分支进入五大视图的 :mc', () => {
    assert.ok(/set\(require\('\.\/view_state'\)\.VIEW\.MC, 'server:start'\)|VIEW\.MC, 'server:start'/.test(startBody),
        '开服未把视图切到 mc');
    assert.ok(/this\._printConsoleIntro\(\)/.test(startBody));
    assert.ok(/this\._bindConsoleLine\(rl\)/.test(startBody));
});

check('SIGINT 只是 detach，回调里不含 stop()', () => {
    const m = startBody.match(/_sigintHandler\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,400}?\};/);
    assert.ok(m, '未找到 _sigintHandler');
    assert.ok(!/this\.stop\(/.test(m[0]), '单次 Ctrl+C 不能停服');
    assert.ok(/_detachConsole/.test(m[0]), '未走安全退场');
    assert.ok(/process\.once\('SIGINT', this\._sigintHandler\)/.test(startBody));
});

check('控制台五大视图常量里没有 lan', () => {
    assert.ok(!/CONSOLE_MODES\.lan|_startLanWatch|_stopLanWatch|mode === 'lan'/.test(srv),
        '还残留旧 :lan 视图逻辑');
    const m = srv.match(/const CONSOLE_MODES = \{[\s\S]{0,700}?\};/);
    assert.ok(m, '未找到 CONSOLE_MODES');
    assert.ok(!/\blan\b/.test(m[0]), 'CONSOLE_MODES 里仍有 lan');
    for (const k of ['mc:', 'wow:', 'menu:', 'web:']) {
        assert.ok(m[0].includes(k), `五大视图缺 ${k}`);
    }
});

check('log.disabled 时 _makeLogStream 走内存垫片，不落盘', () => {
    assert.ok(/logSink\.shouldPersist\(\)/.test(srv), '未收口到统一闸门');
    assert.ok(/if \(!logSink\.shouldPersist\(\)\) return MemoryWriteStream\(this\)/.test(srv),
        'disabled 未换成内存垫片');
    assert.ok(/function MemoryWriteStream\(owner\)/.test(srv), '缺内存垫片实现');
});

check('关服清理用 logSink.keepLatestOnly，且在 stop() 的 finally 里', () => {
    assert.ok(/logSink\.keepLatestOnly\(path\.dirname\(this\.logFile\)\)/.test(srv));
    const m = srv.match(/async stop\(timeout = 30000\)[\s\S]*?\n    \}/);
    assert.ok(m, '未找到 stop()');
    assert.ok(/finally\s*\{[\s\S]{0,200}?_cleanLogsOnStop\(\)/.test(m[0]),
        '清理不在 finally，异常关服会漏掉');
    assert.ok(/if \(logSink\.shouldPersist\(\)\) return/.test(srv),
        'log.disabled=false 时不应清理日志');
});

check('开服控制台声明 expectedOwners（消除「强制接管」误报）', () => {
    assert.ok(/expectedOwners:\s*\['repl'\]/.test(srv));
    assert.ok(!/console\.warn\(`⚠️ stdin 被/.test(srv),
        'server.js 不应自行打强制接管告警');
});

console.log(`\n==================================================`);
console.log(fail ? `❌ 通过 ${pass} 项，失败 ${fail} 项` : `✅ 全部通过：${pass} 项`);
process.exit(fail ? 1 : 0);
