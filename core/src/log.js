/**
 * wow 事件日志模块（V3.5.0 新增）
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
 * 文件命名：
 *   Wow-[YYYY-MM-DD]-[MIN].log
 *     MIN = 本次 wow 进程运行了多久（分钟），用于衡量当天运行时长；
 *          进程跨过 00:00 会自动另起一个按新日期命名的文件。
 *   若本次运行出现崩溃记录（MC 非零退出 / 未捕获异常等），文件名追加 -Wrong：
 *   Wow-[YYYY-MM-DD]-[MIN]-Wrong.log
 *
 * 文件开头固定为：
 *   Wow～ V<版本>
 *   运行系统：
 *   系统架构：
 *   JAVA版本：
 *   node版本：
 *
 * 每行格式（二十四小时制）：
 *   [HH:MM:SS-信息分级]信息内容
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const utils = require('./utils');

// 合法日志级别
const LEVELS = { INFO: 'INFO', IMPT: 'IMPT', WARN: 'WARN', ERRO: 'ERRO' };

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
        // 每个进程独立会话文件，以 PID 区分，避免多进程（Web 派生子进程）重命名互相干扰
        this.sessionId = process.pid || Date.now();
        this.startTime = Date.now();
        this.activeDate = ymd(new Date());
        this.dayStart = Date.now();
        this.activePath = null;
        this.env = { os: null, arch: null, java: null, node: null };
        this.crashFlag = false;
        this._initDone = false;
        // 启动时清理「上次被强杀遗留」的 active 日志（仅处理早于今天的，归为崩溃）
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

        this.activePath = this._activeName(this.activeDate);
        this._writeHeaderIfNew();
        this._registerExit();
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

    // 当前会话的 active 文件名（含 PID，跨进程唯一）
    _activeName(date) {
        return path.join(this.logDir, `Wow-${date}-${this.sessionId}-active.log`);
    }

    // 仅当 active 文件尚不存在时才写入文件头
    _writeHeaderIfNew() {
        try {
            if (!fs.existsSync(this.activePath)) {
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
            }
        } catch (e) { /* 忽略 */ }
    }

    // 进程退出时把 active 文件重命名为带运行时长的正式文件名
    _registerExit() {
        const finalize = () => { try { this.finalizeCurrent(); } catch (e) { /* 忽略 */ } };
        process.once('exit', finalize);
    }

    // 清理上次遗留（被 SIGKILL 等强杀、未正常收尾）的 active 日志：归为崩溃并估算时长
    _sweepLeftover() {
        try {
            if (!fs.existsSync(this.logDir)) return;
            const today = ymd(new Date());
            const files = fs.readdirSync(this.logDir)
                .filter(f => f.endsWith('-active.log'));
            for (const f of files) {
                const full = path.join(this.logDir, f);
                const m = f.match(/^Wow-(\d{4}-\d{2}-\d{2})-(\d+)-active\.log$/);
                if (!m) continue;
                const date = m[1];
                // 只清理「早于今天」的遗留文件（当天的留给当前进程自己收尾）
                if (date >= today) continue;
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

    // 生成正式文件名，若已存在则追加序号避免覆盖
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

    // 跨过 00:00：收尾当天文件，开启按新日期命名的文件
    _rollDayIfNeeded() {
        const date = ymd(new Date());
        if (date !== this.activeDate) {
            this.finalizeCurrent();
            this.activeDate = date;
            this.dayStart = Date.now();
            this.activePath = this._activeName(date);
            this._writeHeaderIfNew();
        }
    }

    // 本次运行在该日期内已持续的分钟数（最小 1）
    _minutesForDay() {
        return Math.max(1, Math.ceil((Date.now() - this.dayStart) / 60000));
    }

    // 把当前的 active 文件重命名为带运行时长的正式文件
    finalizeCurrent() {
        if (!this.activePath) return;
        try {
            if (!fs.existsSync(this.activePath)) { this.activePath = null; return; }
            const mins = this._minutesForDay();
            const target = this._collisionName(this.activeDate, mins, this.crashFlag);
            fs.renameSync(this.activePath, target);
        } catch (e) { /* 忽略 */ }
        this.activePath = null;
    }

    // ─── 核心写日志函数（内部 log(level, message)）───
    log(level, message) {
        this._ensureInit();
        if (!LEVELS[level]) level = 'INFO';
        this._rollDayIfNeeded();
        const now = new Date();
        const line = `[${hms(now)}-${level}]${message}\n`;
        try {
            fs.appendFileSync(this.activePath, line, 'utf8');
        } catch (e) { /* 忽略写入失败 */ }
    }

    // 分级便捷方法
    info(message) { this.log('INFO', message); }
    impt(message) { this.log('IMPT', message); }
    warn(message) { this.log('WARN', message); }
    erro(message) { this.log('ERRO', message); }

    /**
     * 标记本次运行存在崩溃记录（影响最终文件名 -Wrong）
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
     * 获取当前 active 日志文件路径（供其它模块引用）
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
