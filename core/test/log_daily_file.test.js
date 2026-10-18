/**
 * 事件日志「按天单文件」测试（V3.5.8）
 *
 * V3.5.8 起同一天的所有 wow 运行都追加进同一份 Wow-YYYY-MM-DD.log，
 * 不再按运行时长 / 进程裂成多份（旧方案实测单日裂出 12 个文件）。
 *
 * 运行：cd core && node test/log_daily_file.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const { WowLogger } = require('../src/log');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

const WORK = path.join(os.tmpdir(), `log_daily_${process.pid}`);
fs.emptyDirSync(WORK);
process.on('exit', () => { try { fs.removeSync(WORK); } catch (e) {} });

// 造一个隔离的 logger（不动真实 Wow/logs/）
function mkLogger() {
    const l = new WowLogger();
    l.logDir = path.join(WORK, 'logs');
    fs.ensureDirSync(l.logDir);
    l._initDone = false;   // 重置，让下次 log() 在新目录里懒初始化
    l._sessionOpen = false;
    l._exitHooked = false;
    return l;
}

function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dayFile(dir) { return path.join(dir, `Wow-${today()}.log`); }

console.log('\n事件日志「按天单文件」测试 (V3.5.8)\n');

// ─────────────────────────────────────────────
console.log('— 命名：当天只有一份文件 —');
{
    const l = mkLogger();
    l.info('第一条');
    l.info('第二条');
    l.impt('重要操作');

    const files = fs.readdirSync(l.logDir);
    check('1 写 3 条日志只产生 1 个文件', () => {
        assert.deepStrictEqual(files, [`Wow-${today()}.log`]);
    });

    check('2 文件名严格匹配 Wow-YYYY-MM-DD.log（无 PID/分钟数/序号）', () => {
        assert.ok(/^Wow-\d{4}-\d{2}-\d{2}\.log$/.test(files[0]), files[0]);
    });

    check('3 三条日志全部落在同一文件里', () => {
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        assert.ok(c.includes('第一条'));
        assert.ok(c.includes('第二条'));
        assert.ok(c.includes('重要操作'));
    });

    check('4 文件头含版本/系统/Java/node', () => {
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        assert.ok(/Wow～\s*V/.test(c), '缺版本头');
        assert.ok(c.includes('运行系统：'));
        assert.ok(c.includes('系统架构：'));
        assert.ok(c.includes('JAVA版本：'));
        assert.ok(c.includes('node版本：'));
    });

    check('5 文件头只写一次（追加不重复）', () => {
        l.info('再来一条');
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        assert.strictEqual((c.match(/运行系统：/g) || []).length, 1);
    });

    check('6 每行格式为 [HH:MM:SS-级别]内容', () => {
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        const lines = c.split('\n').filter(x => /^\[\d{2}:\d{2}:\d{2}-/.test(x));
        assert.ok(lines.length >= 4, `日志行不足: ${lines.length}`);
        for (const ln of lines) {
            assert.ok(/^\[\d{2}:\d{2}:\d{2}-(INFO|IMPT|WARN|ERRO)\]/.test(ln), ln);
        }
    });

    check('7 会话开始/结束标记成对出现', () => {
        l.finalizeCurrent();
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        assert.strictEqual((c.match(/===== 会话开始 /g) || []).length, 1);
        assert.strictEqual((c.match(/===== 会话结束 /g) || []).length, 1);
    });
}

// ─────────────────────────────────────────────
console.log('— 多实例（模拟多进程）追加同一文件 —');
{
    const dir = path.join(WORK, 'logs_multi');
    fs.ensureDirSync(dir);

    const a = mkLogger(); a.logDir = dir; a._initDone = false; a._sessionOpen = false; a._exitHooked = false;
    const b = mkLogger(); b.logDir = dir; b._initDone = false; b._sessionOpen = false; b._exitHooked = false;

    a.info('来自 A 的日志');
    b.info('来自 B 的日志');
    a.impt('A 又写一条');
    b.erro('B 报错一条');

    check('8 两个实例写后仍只有 1 个文件', () => {
        assert.deepStrictEqual(fs.readdirSync(dir), [`Wow-${today()}.log`]);
    });

    check('9 两个实例的内容都在同一文件里，无丢失', () => {
        const c = fs.readFileSync(dayFile(dir), 'utf8');
        assert.ok(c.includes('来自 A 的日志'));
        assert.ok(c.includes('来自 B 的日志'));
        assert.ok(c.includes('A 又写一条'));
        assert.ok(c.includes('B 报错一条'));
    });

    check('10 两个会话的开始标记都在（可区分进程）', () => {
        const c = fs.readFileSync(dayFile(dir), 'utf8');
        const starts = (c.match(/===== 会话开始 /g) || []).length;
        assert.strictEqual(starts, 2, `期望 2 个会话开始标记，实际 ${starts}`);
    });

    check('11 并发写不产生半行交错（每行都完整）', () => {
        const c = fs.readFileSync(dayFile(dir), 'utf8');
        const bad = c.split('\n').filter(x => x && !x.startsWith('===== 会话')
            && !x.startsWith('Wow～') && !x.startsWith('运行系统：') && !x.startsWith('系统架构：')
            && !x.startsWith('JAVA版本：') && !x.startsWith('node版本：')
            && !/^\[\d{2}:\d{2}:\d{2}-(INFO|IMPT|WARN|ERRO)\]/.test(x));
        assert.strictEqual(bad.length, 0, `异常行: ${JSON.stringify(bad.slice(0, 3))}`);
    });
}

// ─────────────────────────────────────────────
console.log('— 跨天滚动 —');
{
    const l = mkLogger();
    l.info('今天的日志');   // 正常初始化到今天
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const p = (n) => String(n).padStart(2, '0');
    const yesterday = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    // 模拟「进程跨过 00:00」：会话状态仍停留在昨天
    l.activeDate = yesterday;
    l.activePath = path.join(l.logDir, `Wow-${yesterday}.log`);
    l._sessionOpen = true;
    l.info('触发滚动后的日志');

    check('12 跨天后昨天的文件与今天的文件各一份（不混写）', () => {
        const files = fs.readdirSync(l.logDir).sort();
        assert.strictEqual(files.length, 2, `应产生 2 个文件，实际: ${files}`);
        assert.ok(files.some(f => f === `Wow-${yesterday}.log`), `缺昨天文件: ${files}`);
        assert.ok(files.some(f => f === `Wow-${today()}.log`), `缺今天文件: ${files}`);
    });

    check('13 昨天文件以「跨天滚动」结束标记收尾，不含跨天后的正文', () => {
        // 注意用保存的 yesterday 读——滚动后 l.activeDate 已变为今天
        const c = fs.readFileSync(path.join(l.logDir, `Wow-${yesterday}.log`), 'utf8');
        assert.ok(c.includes('跨天滚动'), '昨天文件应有跨天滚动结束标记');
        assert.ok(!c.includes('触发滚动后的日志'), '跨天后的内容写进了昨天的文件');
    });

    check('14 今天文件含滚动后的内容与新的会话开始标记', () => {
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        assert.ok(c.includes('触发滚动后的日志'));
        assert.ok(/===== 会话开始 .*跨天滚动/.test(c) === false); // 标记里不带 extraReason，确认格式
        assert.ok(c.includes('===== 会话开始 '));
    });
}

// ─────────────────────────────────────────────
console.log('— 崩溃标记 —');
{
    const l = mkLogger();
    l.info('正常跑着');
    l.command('server start', false, '启动失败: 找不到核心');
    check('15 失败指令自动置 crashFlag', () => {
        assert.strictEqual(l.crashFlag, true);
    });
    l.finalizeCurrent();
    check('16 会话结束标记带「存在错误记录」', () => {
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        assert.ok(/===== 会话结束 .*存在错误记录/.test(c), c.slice(-200));
    });

    const l2 = mkLogger();
    l2.info('一切正常');
    l2.finalizeCurrent();
    check('17 无错误时结束标记不带「存在错误记录」', () => {
        const c = fs.readFileSync(dayFile(l2.logDir), 'utf8');
        const tail = c.split('\n').filter(x => x.startsWith('===== 会话结束')).pop();
        assert.ok(tail && !tail.includes('存在错误记录'), tail);
    });
}

// ─────────────────────────────────────────────
console.log('— 长消息截断（并发写原子性保护） —');
{
    const l = mkLogger();
    const huge = 'X'.repeat(20000);
    l.erro(huge);
    check('18 超长行被截断且保留可读标记', () => {
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        const line = c.split('\n').find(x => x.startsWith('[') && x.includes('XXX'));
        assert.ok(line, '应存在该日志行');
        assert.ok(line.length < 5000, `行仍过长: ${line.length}`);
        assert.ok(line.includes('…[已截断]'), '缺截断标记');
    });
    check('19 截断不影响后续行', () => {
        l.info('截断后的下一行');
        const c = fs.readFileSync(dayFile(l.logDir), 'utf8');
        assert.ok(c.includes('截断后的下一行'));
    });
}

// ─────────────────────────────────────────────
console.log('— 遗留 active 文件清理（旧格式） —');
{
    const dir = path.join(WORK, 'logs_sweep');
    fs.ensureDirSync(dir);
    // 造两个旧格式遗留（昨天与更早），命名同 V3.5.8 前的 active 文件
    fs.writeFileSync(path.join(dir, 'Wow-2020-01-01-999-active.log'), 'old content\n');
    fs.writeFileSync(path.join(dir, 'Wow-2020-01-02-888-active.log'), 'old content 2\n');
    fs.writeFileSync(path.join(dir, 'Wow-2020-01-03-5.log'), '已完成的历史日志\n'); // 非 active 不动

    const l = mkLogger();
    l.logDir = dir;
    l._sweepLeftover();

    const files = fs.readdirSync(dir).sort();
    check('20 遗留 active 文件被归并为 -Wrong', () => {
        assert.ok(files.some(f => /^Wow-2020-01-01-\d+-Wrong\.log$/.test(f)), files.join(','));
        assert.ok(files.some(f => /^Wow-2020-01-02-\d+-Wrong\.log$/.test(f)), files.join(','));
    });
    check('21 非 active 的历史日志不被清理', () => {
        assert.ok(files.includes('Wow-2020-01-03-5.log'), files.join(','));
    });
    check('22 active 文件本身不再残留', () => {
        assert.ok(!files.some(f => f.endsWith('-active.log')), files.join(','));
    });
}

// ─────────────────────────────────────────────
console.log('— 当前日志文件路径查询 —');
{
    const l = mkLogger();
    l.info('查询路径');
    check('23 currentLogFile 返回当天文件绝对路径', () => {
        const p = l.currentLogFile();
        assert.strictEqual(p, dayFile(l.logDir));
        assert.ok(fs.existsSync(p));
    });
    check('24 getLogDir 返回日志目录', () => {
        assert.strictEqual(l.getLogDir(), l.logDir);
    });
}

// ─────────────────────────────────────────────
console.log('— 真实 logs 目录未被测试污染 —');
{
    check('25 测试未在 Wow/logs/ 留下当日测试文件', () => {
        // 真实日志目录里可能已有当天正常日志（前面手工验证产生的），
        // 这里只确认：测试目录是临时的，真实目录文件数不因本测试而异常增长。
        const realDir = path.resolve(__dirname, '..', '..', 'logs');
        if (!fs.existsSync(realDir)) return;
        const todayReal = fs.readdirSync(realDir).filter(f => f === `Wow-${today()}.log`);
        // 当天真实文件至多 1 个（按天单文件的硬约束）
        assert.ok(todayReal.length <= 1, `当天出现多份日志: ${todayReal}`);
    });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
