/**
 * log.disabled 统一闸门测试（执行令配置项二）
 *
 * 硬红线：log.disabled=true 时 wow 本体**绝对不能产生任何日志文件**。
 * 覆盖：
 *   1) log_sink.shouldPersist() 随配置切换；
 *   2) openStream / appendLine / keepLatestOnly 的运行时行为；
 *   3) 全仓 7 个 wow 日志落盘点都收口到统一闸门（静态断言）；
 *   4) cleanLogs 不再把 latest.log 算进待删列表。
 *
 * 运行：cd core && node test/log_sink.test.js
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const assert = require('assert');
const os = require('os');

const SRC = path.join(__dirname, '..', 'src');
const config = require(path.join(SRC, 'config'));
const logSink = require(path.join(SRC, 'log_sink'));

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}

async function acheck(title, fn) {
    try { await fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}  → ${e.message}`); failed++; }
}

function withConfig(value, fn) {
    const orig = config.getConfig;
    config.getConfig = function (key, def) {
        if (key === 'log.disabled') return value;
        return orig.call(this, key, def);
    };
    try { return fn(); } finally { config.getConfig = orig; }
}

const readSrc = f => fs.readFileSync(path.join(SRC, f), 'utf8');

async function main() {
    console.log('\n[1] log_sink —— 判定与内存缓冲');

    check('默认（未开启 log.disabled）应允许落盘', () => {
        withConfig(false, () => assert.strictEqual(logSink.shouldPersist(), true));
    });

    check('log.disabled=true 时 shouldPersist 返回 false', () => {
        withConfig(true, () => assert.strictEqual(logSink.shouldPersist(), false));
    });

    check('导出 7 个统一入口', () => {
        for (const k of ['shouldPersist', 'pushMemory', 'recent', 'clearMemory', 'appendLine', 'openStream', 'keepLatestOnly']) {
            assert.strictEqual(typeof logSink[k], 'function', `缺少 ${k}`);
        }
    });

    check('内存环形缓冲 push/recent/clear 正常', () => {
        logSink.clearMemory('unit-test');
        logSink.pushMemory('unit-test', 'a\nb\n');
        logSink.pushMemory('unit-test', 'c');
        assert.deepStrictEqual(logSink.recent('unit-test', 2), ['b', 'c']);
        assert.deepStrictEqual(logSink.recent('unit-test', 10), ['a', 'b', 'c']);
        logSink.clearMemory('unit-test');
        assert.deepStrictEqual(logSink.recent('unit-test', 10), []);
    });

    check('内存缓冲有上限，不会无限增长', () => {
        logSink.clearMemory('unit-max');
        for (let i = 0; i < 2100; i++) logSink.pushMemory('unit-max', 'L' + i);
        const r = logSink.recent('unit-max', 99999);
        assert.ok(r.length <= 2000, `缓冲未封顶: ${r.length}`);
        assert.strictEqual(r[r.length - 1], 'L2099');
        logSink.clearMemory('unit-max');
    });

    console.log('\n[2] 运行时：disabled 时绝不产生文件');

    check('openStream：disabled 返回内存垫片，不创建文件与目录', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-logsink-'));
        const file = path.join(tmp, 'nested', 'cloudflared.log');
        try {
            withConfig(true, () => {
                const s = logSink.openStream(file, 'test-stream');
                s.write('hello\n');
                s.write('world\n');
                s.end();
            });
            assert.ok(!fs.existsSync(file), 'disabled 时仍创建了 cloudflared.log');
            assert.ok(!fs.existsSync(path.dirname(file)), 'disabled 时仍创建了日志目录');
            assert.deepStrictEqual(logSink.recent('test-stream', 2), ['hello', 'world']);
        } finally {
            logSink.clearMemory('test-stream');
            fs.removeSync(tmp);
        }
    });

    await acheck('openStream：enabled 时正常落盘', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-logsink-'));
        const file = path.join(tmp, 'nested', 'cloudflared.log');
        try {
            const s = withConfig(false, () => logSink.openStream(file, 'test-stream2'));
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => resolve(), 2000);
                if (typeof s.on === 'function') {
                    s.on('error', () => { clearTimeout(timer); reject(new Error('写入失败')); });
                    s.on('finish', () => { clearTimeout(timer); resolve(); });
                }
                s.write('line1\n');
                s.end();
                // 内存垫片（无 .on）时立即结束
                if (typeof s.on !== 'function') { clearTimeout(timer); resolve(); }
            });
            assert.ok(fs.existsSync(file), 'enabled 时未落盘');
            assert.ok(fs.readFileSync(file, 'utf8').includes('line1'));
        } finally {
            fs.removeSync(tmp);
        }
    });

    check('appendLine：disabled 不写盘、enabled 写盘', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-logsink-'));
        const file = path.join(tmp, '.lan-api.log');
        try {
            const r1 = withConfig(true, () => logSink.appendLine(file, '{"a":1}', 'test-append'));
            assert.strictEqual(r1, false);
            assert.ok(!fs.existsSync(file), 'disabled 时仍创建了 .lan-api.log');
            assert.deepStrictEqual(logSink.recent('test-append', 1), ['{"a":1}']);

            const r2 = withConfig(false, () => logSink.appendLine(file, '{"a":2}', 'test-append'));
            assert.strictEqual(r2, true);
            assert.ok(fs.readFileSync(file, 'utf8').includes('{"a":2}'));
        } finally {
            logSink.clearMemory('test-append');
            fs.removeSync(tmp);
        }
    });

    console.log('\n[3] keepLatestOnly —— 关服只留 latest.log');

    check('删掉所有非 latest.log 条目（含子目录），保留 latest.log', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-logsink-'));
        try {
            fs.writeFileSync(path.join(tmp, 'latest.log'), 'KEEP');
            fs.writeFileSync(path.join(tmp, 'wow-console.log'), 'x');
            fs.writeFileSync(path.join(tmp, 'wow-stdout.log'), 'x');
            fs.writeFileSync(path.join(tmp, 'analysis_report.txt'), 'x');
            fs.ensureDirSync(path.join(tmp, 'crash-reports'));
            fs.writeFileSync(path.join(tmp, 'crash-reports', 'c.txt'), 'x');
            fs.ensureDirSync(path.join(tmp, 'old-log-dir'));

            const removed = logSink.keepLatestOnly(tmp);
            assert.strictEqual(removed, 5, `删除数不对: ${removed}`);
            assert.deepStrictEqual(fs.readdirSync(tmp).sort(), ['latest.log']);
            assert.strictEqual(fs.readFileSync(path.join(tmp, 'latest.log'), 'utf8'), 'KEEP');
        } finally {
            fs.removeSync(tmp);
        }
    });

    check('目录不存在 / 空目录不抛异常', () => {
        assert.strictEqual(logSink.keepLatestOnly(path.join(os.tmpdir(), 'wow-no-such-dir-xyz')), 0);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-logsink-'));
        try { assert.strictEqual(logSink.keepLatestOnly(tmp), 0); }
        finally { fs.removeSync(tmp); }
    });

    console.log('\n[4] 静态断言：全仓 wow 日志落盘点都收口到统一闸门');

    check('tunnel.js 用 logSink.openStream 取代裸 createWriteStream', () => {
        const src = readSrc('tunnel.js');
        assert.ok(/require\('\.\/log_sink'\)/.test(src), 'tunnel.js 未引入 log_sink');
        assert.ok(/logSink\.openStream\(logFile/.test(src), 'cloudflared.log 未走统一闸门');
        assert.ok(!/fs\.createWriteStream\(logFile/.test(src), '仍存在裸 createWriteStream(cloudflared.log)');
    });

    check('terracotta.js 的 .lan-api.log 写入经 shouldPersist 判定', () => {
        const src = readSrc('terracotta.js');
        assert.ok(/require\('\.\/log_sink'\)/.test(src), 'terracotta.js 未引入 log_sink');
        const body = src.slice(src.indexOf('function appendApiLog'), src.indexOf('function readApiLog'));
        assert.ok(/logSink\.shouldPersist\(\)/.test(body), 'appendApiLog 未判定 shouldPersist');
        assert.ok(/logSink\.pushMemory\('lan-api'/.test(body), 'disabled 时未转内存');
    });

    check('terracotta.js 的 readApiLog 在 disabled 时读内存', () => {
        const src = readSrc('terracotta.js');
        const body = src.slice(src.indexOf('function readApiLog'), src.indexOf('function readApiLog') + 900);
        assert.ok(/logSink\.shouldPersist\(\)/.test(body), 'readApiLog 未判定 shouldPersist');
        assert.ok(/logSink\.recent\('lan-api'/.test(body), 'readApiLog 未读内存缓冲');
    });

    check('server.js 四个落盘点全走 logSink', () => {
        const src = readSrc('server.js');
        assert.ok(/require\('\.\/log_sink'\)/.test(src), 'server.js 未引入 log_sink');
        for (const m of ['_makeLogStream', '_appendWowLog', '_wowLogTarget', '_cleanLogsOnStop']) {
            const i = src.indexOf(m + '(');
            assert.ok(i > 0, `找不到 ${m}`);
            const body = src.slice(i, i + 700);
            assert.ok(/logSink\.(shouldPersist|keepLatestOnly)\(/.test(body), `${m} 未收口到 log_sink`);
        }
        // 保留 tui_screen_gate 锁定的两行 logStream.write(data);
        assert.ok((src.match(/logStream\.write\(data\);/g) || []).length >= 2, 'logStream.write 被误删');
    });

    check('server.js 的 _cleanLogsOnStop 复用 keepLatestOnly 且只在 disabled 执行', () => {
        const src = readSrc('server.js');
        const i = src.indexOf('_cleanLogsOnStop()');
        const body = src.slice(i, i + 500);
        assert.ok(/if \(logSink\.shouldPersist\(\)\) return;/.test(body), '未在 enabled 时跳过');
        assert.ok(/logSink\.keepLatestOnly\(/.test(body), '未复用 keepLatestOnly');
    });

    check('log.js 单例惰性判定收口到 log_sink', () => {
        const src = readSrc('log.js');
        assert.ok(/require\('\.\/log_sink'\)\.shouldPersist\(\)/.test(src), 'log.js 未收口');
        assert.ok(/new WowLogger\(\{ lazyMemory: true \}\)/.test(src), '惰性特性被破坏');
    });

    check('log_handler.js 的 analysis_report.txt 收口到 log_sink', () => {
        const src = readSrc('log_handler.js');
        assert.ok(/require\('\.\/log_sink'\)\.shouldPersist\(\)/.test(src), 'log_handler.js 未收口');
    });

    console.log('\n[5] cleanLogs：不再误删 latest.log');

    check('cleanLogs 默认分支排除 latest.log，并新增 keepLatestOnly 分支', () => {
        const src = readSrc('interactive.js');
        const body = src.slice(src.indexOf('async function cleanLogs'), src.indexOf('async function cleanLogs') + 2600);
        assert.ok(/if \(f === 'latest\.log'\) continue;/.test(body), '按天清理未排除 latest.log');
        assert.ok(/logSink\.keepLatestOnly\(logDir\)/.test(body), '缺 log.disabled 的只留 latest.log 分支');
        assert.ok(/logSink\.shouldPersist\(\)/.test(body), 'cleanLogs 未判定 shouldPersist');
    });

    check('log_sink 不碰 readline、不注册信号（不打破单例 / shutdown 职责）', () => {
        const src = readSrc('log_sink.js');
        assert.ok(!/require\(['"]readline['"]\)/.test(src), 'log_sink 不该引入 readline');
        assert.ok(!/createInterface\s*\(/.test(src), 'log_sink 不该创建 readline 实例');
        assert.ok(!/process\.on\s*\(/.test(src), 'log_sink 不该注册信号');
    });

    console.log(`\n${'='.repeat(46)}`);
    console.log(`✅ 通过 ${passed} 项，失败 ${failed} 项`);
    console.log('='.repeat(46));
    return failed;
}

main().then(code => process.exit(code ? 1 : 0), e => {
    console.error(e);
    process.exit(1);
});
