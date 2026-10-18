/**
 * wow 事件日志模块（V3.5.0 新增；V3.5.8 改为「按天单文件」）
 * ----------------------------------------------------------------
 * 记录 wow 本体运行过程中的事件：用户执行了哪些有效指令（含 Web 页面）、
 * 返回内容、是否运行成功，以及 Minecraft 运行过程中是否报错 / 崩溃。
 *
 * 日志级别（信息分级）：
 *   INFO  普通运行信息
 *   IMPT  重要运行信息（关键模块、关键操作）
 *   WARN  警告（相对危险的操作或迹象）
 *   ERRO  错误 / 崩溃
 *
 * 文件命名（V3.5.8 起）：
 *   Wow-[YYYY-MM-DD].log
 *     —— 同一天内的所有 wow 运行（CLI、交互模式、Web 面板及其子进程）
 *        统一追加写入同一份文件，不再按运行时长 / 进程拆成多份。
 *        进程跨过 00:00 会自动另起一个按新日期命名的文件。
 *
 *     历史说明：V3.5.0 ~ V3.5.7 曾采用「每进程一个 active 文件、退出时按
 *     运行时长分钟数重命名」的方案（Wow-[日期]-[分钟].log，重名再加序号）。
 *     该方案在一天内多次运行时会裂出十几份文件（实测单日 12 份），
 *     回看当天操作历史要在多个文件间跳转，故 V3.5.8 改回按天聚合。
 *     旧的 -active.log 遗留仍会被自动清理归并（见 _sweepLeftover）。
 *
 * 文件结构：
 *   1) 文件头（仅当天首次创建时写入一次）：
 *        Wow～ V<版本>
 *        运行系统：
 *        系统架构：
 *        JAVA版本：
 *        node版本：
 *   2) 每次进程会话一对分隔标记，用于区分同一天内的多次运行：
 *        ===== 会话开始 14:30:05 | PID 12345 | linux/x64 =====
 *        [14:30:05-INFO]...
 *        ===== 会话结束 15:02:33 | 运行 32 分钟 | 存在错误记录 =====
 *      （被 SIGKILL 强杀时不会写「会话结束」，此时以「会话开始」后
 *        无对应结束标记判断该次运行异常中断）
 *   3) 每行格式（二十四小时制）：
 *        [HH:MM:SS-信息分级]信息内容
 *
 * 并发说明：多个进程（如 Web 面板派生的子进程）会并发追加同一文件。
 * Node 的 appendFileSync 以 O_APPEND 打开，Linux/macOS 上单次写入
 * 小于 PIPE_BUF(4096) 时是原子的；log() 对超长行做了截断保护，
 * 保证不会出现半行交错。
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const utils = require('./utils');

// 合法日志级别
const LEVELS = { INFO: 'INFO', IMPT: 'IMPT', WARN: 'WARN', ERRO: 'ERRO' };

// 单行字节上限（含时间戳与级别前缀）。多进程并发 append 时，
// 小于 PIPE_BUF(4096) 的单次 write 在 POSIX 上是原子的，故留足余量后截断，
// 避免超长 stack 把两行拼成一坨、或把别人的半行插到中间。
const MAX_LINE_BYTES = 3600;

// ────────────────────────── 时间格式化助手 ──────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function ymd(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function hms(d) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ────────────────────────── 日志器本体 ──────────────────────────

class WowLogger {
    constructor() {
        // 日志目录：Wow/logs/（core 的上一级）
        this.logDir = utils.resolvePath('../logs');
        // 会话标识：取 PID，仅用于「会话开始/结束」标记里区分进程
        this.sessionId = process.pid || Date.now();
        this.startTime = Date.now();
        this.activeDate = ymd(new Date());
        this.activePath = null;
        this.env = { os: null, arch: null, java: null, node: null };
        this.crashFlag = false;
        this._initDone = false;
        this._sessionOpen = false;   // 本次进程是否已写「会话开始」且尚未结束
        this._exitHooked = false;    // exit 钩子只注册一次（跨天滚动后会话会重开）
        // 启动时清理历史遗留的 active 日志（V3.5.8 前的按进程命名方案，
        // 被强杀未收尾时会残留；一律归并为崩溃文件）
        this._sweepLeftover();
    }

    // 惰性初始化（首次写日志时）
    _ensureInit() {
        if (this._initDone) return;
        this._initDone = true;
        try { fs.ensureDirSync(this.logDir); } catch (e) { /* 忽略 */ }

        // 采集运行环境信息（仅首次）
        const sysOs = (() => {
            const p = os.platform();
            return p === 'win32' ? 'windows' : p === 'darwin' ? 'macos' : 'linux';
        })();
        this.env.os = sysOs;
        this.env.arch = os.arch();
        this.env.node = process.version.replace(/^v/, '');
        this.env.java = this._detectJavaVersion();

        // V3.5.8：直接打开当天文件（不再有 per-PID active 文件）
        // 先对齐日期：若进程在 23:59:5x 构造、00:00 后才写第一条日志，
        // 不重新取日期就会「按昨天建文件写头、紧接着又滚动」，留下只有头的空文件。
        this.activeDate = ymd(new Date());
        this.activePath = this._dayName(this.activeDate);
        this._openSession();
    }

    // 探测 Java 版本（仅用于文件头展示，失败降级为「未检测到」）
    _detectJavaVersion() {
        const javaPath = utils.detectJava();
        if (!javaPath) return '未检测到';
        try {
            const out = execSync(`"${javaPath}" -version 2>&1`, {
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'pipe']
            }).toString();
            const m = out.match(/version "([^"]+)"/) || out.match(/version ([^\r\n]+)/);
            return m ? m[1].trim() : javaPath;
        } catch (e) {
            return javaPath;
        }
    }

    // 当天日志文件全路径（V3.5.8：按天单文件）
    _dayName(date) {
        return path.join(this.logDir, `Wow-${date}.log`);
    }

    // 打开一个会话：写文件头（若新文件）+ 会话开始标记 + 注册退出钩子
    _openSession() {
        this._writeHeaderIfNew();
        this._writeSessionStart();
        this._registerExit();
    }

    // 仅当当天文件尚不存在时才写入文件头
    _writeHeaderIfNew() {
        try {
            if (!this.activePath || fs.existsSync(this.activePath)) return;
            let version = '';
            try { version = require('../package.json').version; } catch (e) { version = ''; }
            const header = [
                `Wow～${version ? ' V' + version : ''}`,
                `运行系统：${this.env.os}`,
                `系统架构：${this.env.arch}`,
                `JAVA版本：${this.env.java}`,
                `node版本：${this.env.node}`,
                ''
            ].join('\n');
            fs.writeFileSync(this.activePath, header, 'utf8');
        } catch (e) { /* 忽略 */ }
    }

    // 写「会话开始」分隔标记（幂等：一次进程只写一次）
    _writeSessionStart() {
        if (this._sessionOpen) return;
        this._sessionOpen = true;
        this._appendRaw(
            `\n===== 会话开始 ${hms(new Date())} | PID ${this.sessionId} | ${this.env.os}/${this.env.arch} =====\n`
        );
    }

    // 写「会话结束」分隔标记，附带本次运行时长与是否出现过错误
    _closeSession(extraReason) {
        if (!this._sessionOpen) return;
        this._sessionOpen = false;
        const elapsedMs = Date.now() - this.startTime;
        // 短会话按秒计，避免「运行 3 秒」显示成「运行 1 分钟」
        const dur = elapsedMs < 60000
            ? `运行 ${Math.max(1, Math.round(elapsedMs / 1000))} 秒`
            : `运行 ${Math.max(1, Math.round(elapsedMs / 60000))} 分钟`;
        const parts = [extraReason, dur];
        if (this.crashFlag) parts.push('⚠️ 存在错误记录');
        this._appendRaw(`===== 会话结束 ${hms(new Date())} | ${parts.filter(Boolean).join(' | ')} =====\n`);
    }

    _appendRaw(text) {
        try { fs.appendFileSync(this.activePath, text, 'utf8'); } catch (e) { /* 忽略写入失败 */ }
    }

    // 进程退出时收尾本会话。注意：SIGTERM/SIGKILL 不会触发 exit 钩子，
    // 这两种情况下不会写「会话结束」——正文行都是实时落盘的，不影响数据完整，
    // 只是少一个结束标记（以此可判断该次运行是被强杀的）。
    _registerExit() {
        if (this._exitHooked) return;
        this._exitHooked = true;
        process.once('exit', () => { try { this._closeSession(); } catch (e) { /* 忽略 */ } });
    }

    /**
     * 清理历史遗留的 active 日志（V3.5.8 前的按进程命名方案）。
     * 这些文件是「被 SIGKILL 强杀、没走到退出重命名」留下的，
     * 按崩溃归并（文件名追加 -Wrong），时长按文件修改时间估算。
     * 新方案自身不产生 active 文件，故可无条件清理全部遗留。
     */
    _sweepLeftover() {
        try {
            if (!fs.existsSync(this.logDir)) return;
            const files = fs.readdirSync(this.logDir)
                .filter(f => /^Wow-\d{4}-\d{2}-\d{2}-\d+-active\.log$/.test(f));
            for (const f of files) {
                const full = path.join(this.logDir, f);
                const m = f.match(/^Wow-(\d{4}-\d{2}-\d{2})-\d+-active\.log$/);
                if (!m) continue;
                const date = m[1];
                let mins = 1;
                try {
                    const st = fs.statSync(full);
                    mins = Math.max(1, Math.round((Date.now() - st.mtimeMs) / 60000));
                } catch (e) { /* 忽略 */ }
                const target = this._collisionName(date, mins, true);
                try { fs.renameSync(full, target); } catch (e) { /* 忽略 */ }
            }
        } catch (e) { /* 忽略 */ }
    }

    // 生成正式文件名（仅 _sweepLeftover 归并遗留文件时使用），重名则追加序号
    _collisionName(date, mins, wrong) {
        const base = path.join(this.logDir, `Wow-${date}-${mins}${wrong ? '-Wrong' : ''}`);
        let candidate = base + '.log';
        let i = 2;
        while (fs.existsSync(candidate)) {
            candidate = `${base}-${i}.log`;
            i++;
        }
        return candidate;
    }

    // 跨过 00:00：收尾当天会话，开启按新日期命名的文件
    _rollDayIfNeeded() {
        const date = ymd(new Date());
        if (date !== this.activeDate) {
            this._closeSession('跨天滚动');
            this.activeDate = date;
            this.activePath = this._dayName(date);
            this._openSession();
        }
    }

    // ─── 核心写日志函数（内部 log(level, message)）───
    log(level, message) {
        this._ensureInit();
        if (!LEVELS[level]) level = 'INFO';
        this._rollDayIfNeeded();
        const now = new Date();
        const msg = String(message == null ? '' : message);
        let buf = Buffer.from(`[${hms(now)}-${level}]${msg}\n`, 'utf8');
        // 超长行截断：保证多进程并发 append 的单次写入仍是原子的
        if (buf.length > MAX_LINE_BYTES) {
            buf = Buffer.concat([
                buf.slice(0, MAX_LINE_BYTES),
                Buffer.from('…[已截断]\n', 'utf8')
            ]);
        }
        try {
            fs.appendFileSync(this.activePath, buf);
        } catch (e) { /* 忽略写入失败 */ }
    }

    // 分级便捷方法
    info(message) { this.log('INFO', message); }
    impt(message) { this.log('IMPT', message); }
    warn(message) { this.log('WARN', message); }
    erro(message) { this.log('ERRO', message); }

    /**
     * 标记本次运行存在崩溃记录（影响「会话结束」标记，不再改文件名）
     */
    markCrash() { this.crashFlag = true; }

    /**
     * 记录一条「指令」事件：命令名 + 是否成功 + 结果摘要
     * @param {string} name     指令名（建议带命名空间，如 wow server start）
     * @param {boolean} success 是否成功
     * @param {string} [detail] 结果摘要（自动截断）
     */
    command(name, success, detail) {
        const d = detail ? ' | ' + String(detail).slice(0, 300) : '';
        this.log(success ? 'INFO' : 'ERRO', `指令 ${success ? '✅' : '❌'} ${name}${d}`);
        if (!success) this.crashFlag = true;
    }

    /**
     * 收尾当前会话（兼容旧方法名；V3.5.8 起不再重命名文件，
     * 仅写「会话结束」标记）
     */
    finalizeCurrent(extraReason) { this._closeSession(extraReason); }

    /**
     * 获取当前日志文件路径（供其它模块引用）
     */
    currentLogFile() { this._ensureInit(); return this.activePath; }

    /**
     * 获取日志目录
     */
    getLogDir() { return this.logDir; }
}

// 单例（所有模块 require 同一份）
const logger = new WowLogger();

// ────────────────────────── 全局异常兜底 ──────────────────────────
// 未捕获异常 / 未处理 Promise 拒绝：记入 ERRO 并标记崩溃。
// 不影响 Node 默认行为（进程仍会退出），仅追加一条事件记录。

let _globalHooked = false;
function installGlobalErrorHook() {
    if (_globalHooked) return;
    _globalHooked = true;
    process.on('uncaughtException', (err) => {
        try {
            const msg = (err && err.stack) ? err.stack.split('\n').slice(0, 3).join(' ') : String(err);
            logger.erro(`未捕获异常: ${msg}`);
            logger.markCrash();
        } catch (e) { /* 忽略 */ }
    });
    process.on('unhandledRejection', (reason) => {
        try {
            const msg = (reason && reason.stack) ? reason.stack.split('\n').slice(0, 3).join(' ') : String(reason);
            logger.erro(`未处理 Promise 拒绝: ${msg}`);
            logger.markCrash();
        } catch (e) { /* 忽略 */ }
    });
}

module.exports = { WowLogger, logger, LEVELS, installGlobalErrorHook };
