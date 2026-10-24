/**
 * 陶瓦启动失败诊断测试（V3.5.14）
 *
 * 背景（真实用户反馈）：
 *   用户执行 `lan host`，二进制下载解压都成功，随后报
 *   「启动陶瓦超时：未能读取本地 API 端口。请检查网络 / 防火墙，或查看陶瓦日志。」
 *   但这条提示把所有可能性都推给「网络 / 防火墙」——而陶瓦是本机 127.0.0.1 进程，
 *   根本不涉及网络。真实原因（无执行权限 / 崩溃 / 临时目录不可写）完全被掩盖。
 *
 * 根因：spawn 时 stdio 为 'ignore'，子进程的 stdout/stderr 被直接丢弃。
 *
 * 本测试用可控的假二进制（shell 脚本）复现各类失败，验证诊断文本准确：
 *   1. EACCES（无执行权限 / noexec 挂载）→ 明确指出无法执行
 *   2. 进程启动后崩溃 → 明确指出退出码，并回显子进程输出（关键！）
 *   3. 无任何输出且不写端口文件 → 不误导用户去查网络
 *   4. 源码级：不再使用 stdio 'ignore'，且不再出现「请检查网络 / 防火墙」
 *
 * 运行：cd core && node test/terracotta_diagnose.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

// 需要真实子进程，统一用 async 校验
const asyncChecks = [];
function checkAsync(title, fn) { asyncChecks.push({ title, fn }); }

const SRC = path.join(__dirname, '..', 'src', 'terracotta.js');
const LAN_DIR = path.join(__dirname, '..', 'lan');
const BIN = path.join(LAN_DIR, 'terracotta');
const PORT_FILE = path.join(LAN_DIR, 'wow_terracotta_port.json');
const STATE_FILE = path.join(__dirname, '..', '.lan.json');

console.log('\n陶瓦启动失败诊断测试 (V3.5.14)\n');

// 备份真实二进制，测试结束后还原（绝不能让测试破坏用户的 11MB 二进制）
fs.ensureDirSync(LAN_DIR);
const hadBin = fs.existsSync(BIN);
const backup = path.join(os.tmpdir(), `tc_backup_${process.pid}`);
if (hadBin) fs.copySync(BIN, backup);

function installFakeBin(script) {
    fs.writeFileSync(BIN, script, 'utf8');
    fs.chmodSync(BIN, 0o755);
    for (const f of [PORT_FILE, STATE_FILE]) {
        try { fs.unlinkSync(f); } catch (e) {}
    }
}
function restoreBin() {
    for (const f of [PORT_FILE, STATE_FILE]) {
        try { fs.unlinkSync(f); } catch (e) {}
    }
    if (hadBin) {
        fs.copySync(backup, BIN);
        fs.chmodSync(BIN, 0o755);
        fs.unlinkSync(backup);
    } else {
        try { fs.unlinkSync(BIN); } catch (e) {}
    }
}

// ─────────────────────────────────────────────
console.log('— 源码级断言 —');

check('不再以 stdio: ignore 丢弃子进程输出', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const body = src.slice(src.indexOf('function startDaemon'), src.indexOf('async function stopDaemon'));
    assert.ok(!/stdio:\s*\['ignore',\s*'ignore',\s*'ignore'\]/.test(body),
        '仍在丢弃子进程输出，失败原因将不可见');
    assert.ok(/stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/.test(body),
        '应改为 pipe 以收集输出');
});
check('不再把启动失败笼统归咎于网络 / 防火墙', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    // 只看 startDaemon 段落，且剔除注释行（注释里会提到旧文案作为说明）
    const body = src.slice(src.indexOf('function startDaemon'), src.indexOf('async function stopDaemon'));
    const code = body.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/请检查网络/.test(code),
        '仍有误导性提示：陶瓦是本机进程，启动失败与网络无关');
    // 注：局域网广播环节提及防火墙是合理的（UDP 多播），不在本断言范围内
});
check('记录 spawn 错误与进程退出状态', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    assert.ok(/spawnError/.test(src), '未记录 spawn error');
    assert.ok(/exitInfo/.test(src), '未记录进程退出状态');
});
check('进程提前退出时不再空等满 20 秒（且先读端口再判退出）', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const loop = src.slice(src.indexOf('const deadline = Date.now() + 20000'));
    const body = loop.slice(0, loop.indexOf('if (!port)'));
    const breakIdx = body.indexOf('if (spawnError || exitInfo) break;');
    assert.ok(breakIdx > 0, '未在进程退出时提前跳出轮询');
    // 顺序要求：必须「先尝试读端口文件」再「判断退出」，否则会漏掉
    // 「写完端口后立即退出」的场景（见行为级场景 D）
    const readIdx = body.indexOf('PORT_FILE');
    assert.ok(readIdx >= 0 && readIdx < breakIdx,
        '应先读取端口文件再判断进程退出，否则漏掉已写好的端口');
});
check('陶瓦以 detached 方式启动（不被终端 Ctrl+C 连坐）', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const spawnCall = src.slice(src.indexOf("spawn(bin, ['--hmcl', PORT_FILE]"), src.indexOf("spawn(bin, ['--hmcl', PORT_FILE]") + 600);
    assert.ok(/detached:\s*true/.test(spawnCall),
        '陶瓦未设置 detached:true —— 终端 SIGINT 会连带杀死它，' +
        '表现为日志出现 Received SIGINT 而 wow 报「未能读取本地 API 端口」');
});

// ─────────────────────────────────────────────
console.log('\n— 行为级：真实子进程 —');

const tc = require('../src/terracotta');

checkAsync('场景A：二进制无执行权限 → 明示 EACCES / noexec', async () => {
    installFakeBin('#!/bin/sh\nexit 0\n');
    fs.chmodSync(BIN, 0o644); // 去掉执行位
    let msg = '';
    try { await tc.startDaemon(); } catch (e) { msg = e.message; }
    assert.ok(msg, '应抛错');
    assert.ok(/EACCES|无法执行/.test(msg), `未指出无法执行: ${msg}`);
    assert.ok(/noexec/.test(msg), '未提示 noexec 挂载这一常见原因');
});

checkAsync('场景B：进程启动后崩溃 → 回显子进程的真实输出', async () => {
    installFakeBin('#!/bin/sh\necho "fatal: failed to release embedded easytier" >&2\nexit 1\n');
    let msg = '';
    const t0 = Date.now();
    try { await tc.startDaemon(); } catch (e) { msg = e.message; }
    const ms = Date.now() - t0;
    assert.ok(msg, '应抛错');
    assert.ok(/退出码 1|立即退出/.test(msg), `未说明进程已退出: ${msg}`);
    assert.ok(/failed to release embedded easytier/.test(msg),
        `未回显子进程输出（这是定位问题的关键）: ${msg}`);
    assert.ok(ms < 15000, `进程已退出却仍空等 ${ms}ms`);
});

checkAsync('场景C：进程不写端口且无输出 → 不误导到网络', async () => {
    installFakeBin('#!/bin/sh\nsleep 30\n');
    let msg = '';
    try { await tc.startDaemon(); } catch (e) { msg = e.message; }
    assert.ok(msg, '应抛错');
    assert.ok(!/网络|防火墙/.test(msg), `仍在误导用户查网络/防火墙: ${msg}`);
    assert.ok(/TMPDIR|临时目录|磁盘/.test(msg), '未提示临时目录/磁盘这类真实原因');
    assert.ok(/没有(任何)?输出/.test(msg), '未说明子进程无输出');
});

checkAsync('场景D：正常写入端口文件 → 启动成功（不回归）', async () => {
    // 假二进制直接把端口写入 argv[2] 指定的文件
    installFakeBin('#!/bin/sh\nprintf \'{"port":45678}\' > "$2"\nexit 0\n');
    // /meta 探活会失败，但 startDaemon 只要求端口文件可读
    const p = await tc.startDaemon();
    assert.strictEqual(p, 45678, `端口解析错误: ${p}`);
});

// ─────────────────────────────────────────────
(async () => {
    try {
        for (const { title, fn } of asyncChecks) {
            try { await fn(); console.log(`  ✅ ${title}`); passed++; }
            catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
        }
    } finally {
        restoreBin();
    }
    console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed ? 1 : 0);
})();
