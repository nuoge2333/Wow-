/**
 * MC 控制台接入模块（顶层命令 `wow :mc`）
 *
 * 在一个**独立进程**里接入「正在运行的服务器」的 MC 控制台：
 *   - 跟随 logs/latest.log 实时显示服务端输出（纯 Node 轮询，跨平台，不依赖 tail）
 *   - 每行输入作为一条 Mojang(MC) 指令，经 .console.queue 中继下发给持有 MC stdin 的进程
 *
 * 语义与 `wow server start` 后的 :mc 视图一致：输入即 MC 指令。
 * 退出只断开本视图，绝不停止服务器。
 */
const fs = require('fs-extra');
const path = require('path');
const stdinSession = require('./stdin_session');
const utils = require('./utils');
const aliveProbe = require('./alive_probe');
const timerRegistry = require('./timer_registry');

// P0（多实例监听泄漏绞杀）：本视图所有定时器登记到独立 scope，
// 退出视图时 clearScope 一键全清，杜绝旧 _follow 回调并发刷心跳 / 双写日志。
const FOLLOW_TIMER_SCOPE = 'mc.console.follow';

const FOLLOW_INTERVAL_MS = 300;
// 存活检测降频：每 10 个 tick（约 3s）查一次服务器进程是否还在。
// isRunning() 在 Windows 上要走 tasklist（execSync），不能每 300ms 查一次。
const LIVENESS_CHECK_EVERY = 10;
const TAIL_LINES = 12;
const EXIT_WORDS = new Set([':q', 'q', 'quit', ':quit', 'exit', ':exit', ':bye']);

// P0（输入路由）：`:mc` 视图下终端提示符必须是这个，绝不能显示 `wow> `。
const MC_PROMPT = '[MC 控制台]> ';
const WOW_PROMPT = 'wow> ';

// `:mc` 视图下的「非 MC 指令」白名单：视图切换 + 控制台辅助。
// MC 指令（seed / op Steve / say hi / list / ...）永不以 `:` 开头，也不叫
// 这些名字，所以这里可以安全地把它们当作元指令而非转发的 MC 指令。
const MC_VIEW_SWITCH = Object.freeze({
    ':wow': 'wow', ':2': 'wow', ':长命令': 'wow',
    ':m': 'menu', ':menu': 'menu', ':菜单': 'menu', 'm': 'menu',
    ':mc': 'mc', ':1': 'mc', ':minecraft': 'mc', ':服务端': 'mc',
    ':web': 'web'
});
const MC_VIEW_META = new Set([':help', ':h', ':?', ':log', ':logs', ':wowlog', ':wowlogs']);

/**
 * P0：把一行 `:mc` 视图输入路由成结构化结果。
 *
 * 铁律：只要不是「视图切换 / 退出 / 控制台辅助」，一律 `action:'mc'` 原样转发，
 * 绝不做 wow 的命名空间识别或 commander 解析——那正是 `seed` / `op Steve` /
 * `say hi` 发不出去的根因。
 *
 * @returns {{action:'noop'}|{action:'exit'}|{action:'meta',command:string}
 *           |{action:'switch',view:string}|{action:'mc',command:string}}
 */
function routeMcViewInput(raw) {
    const line = String(raw == null ? '' : raw).trim();
    if (!line) return { action: 'noop' };
    const lower = line.toLowerCase();
    if (isExitCommand(line)) return { action: 'exit' };
    if (MC_VIEW_META.has(lower)) return { action: 'meta', command: lower };
    const view = MC_VIEW_SWITCH[lower];
    if (view) return { action: 'switch', view };
    // 其余全部原样转发（只去首尾空白，内部大小写与空格不动）
    return { action: 'mc', command: line };
}

/**
 * 读取文件 [start, end) 字节区间。fd 在 finally 里关闭（C1：绝不泄漏描述符）。
 */
function readRange(file, start, end) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const size = Math.max(0, end - start);
        const buf = Buffer.alloc(size);
        let read = 0;
        while (read < size) {
            const n = fs.readSync(fd, buf, read, size - read, start + read);
            if (!n) break;
            read += n;
        }
        return buf.slice(0, read).toString('utf8');
    } catch (e) {
        return '';
    } finally {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch (e) { /* 忽略 */ }
        }
    }
}

/** 读文本尾部若干非空行（只读取尾部字节，避免整份日志载入内存）。 */
function tailLines(file, n = TAIL_LINES, maxBytes = 256 * 1024) {
    try {
        if (!fs.existsSync(file)) return [];
        const size = fs.statSync(file).size;
        if (size === 0) return [];
        const start = Math.max(0, size - maxBytes);
        return readRange(file, start, size)
            .split(/\r?\n/)
            .filter(l => l.trim() !== '')
            .slice(-n);
    } catch (e) {
        return [];
    }
}

/** 是否退出 :mc 视图（对待发指令安全：MC 无这些单字指令）。 */
function isExitCommand(line) {
    return EXIT_WORDS.has(String(line == null ? '' : line).trim().toLowerCase());
}

/**
 * 日志静默但服务器仍在运行时的状态提示。
 * 只提示，绝不退出 :mc；刷提示前保存用户半行、刷完回填，不吞字。
 */
function printSilenceNotice(rl) {
    const savedLine = (rl && typeof rl.line === 'string') ? rl.line : '';
    const savedCursor = (rl && typeof rl.cursor === 'number') ? rl.cursor : savedLine.length;
    if (rl && rl.clearLine) { try { rl.clearLine(0); } catch (e) { /* 忽略 */ } }
    process.stdout.write('\x1b[90m⏳ 暂无新日志，服务器运行中...（进程存活中）\x1b[39m\n');
    if (rl && rl.prompt) { try { rl.prompt(true); } catch (e) { /* 忽略 */ } }
    if (savedLine && rl && rl.write) {
        try {
            rl.write(savedLine);
            const back = Math.max(0, savedLine.length - savedCursor);
            for (let i = 0; i < back && rl.write; i++) {
                try { rl.write(null, { name: 'left' }); } catch (e) { break; }
            }
        } catch (e) { /* 忽略 */ }
    }
}

class McConsole {
    constructor() {
        const ServerManager = require('./server');
        this.ServerManager = ServerManager;
        this.server = new ServerManager();
        this.logFile = path.join(utils.getServerDir(), 'logs', 'latest.log');
        this.lease = null;
        this.timer = null;
        this.lastSize = 0;
        this.closed = false;
        this._livenessTick = 0;
        this._silenceTicks = 0;
        this._fallbackDeaths = 0;
        // P0（Windows 假死修复）：跨进程判活统一走 alive_probe——
        // PID + Web /api/status 双证据、连续 3 次确证才判停，异常保守视为存活。
        this._liveness = (aliveProbe && typeof aliveProbe.createLivenessTracker === 'function')
            ? aliveProbe.createLivenessTracker(this.server, { deathThreshold: 3 })
            : null;
        this._finish = null; // attach() 内 finish 的引用，供 _follow() 检测退出后优雅离开
    }

    _fileSize() {
        try { return fs.statSync(this.logFile).size; } catch (e) { return 0; }
    }

    /** 接入运行中服务器；返回是否已进入视图。 */
    async attach() {
        if (!this.server.isRunning()) {
            console.log('⛔ 服务器未运行，无法接入 :mc 控制台。请先启动：wow server start');
            return false;
        }

        console.log('🎮 已接入 MC 控制台（:mc 视图）');
        console.log('   直接输入 Mojang 指令回车下发；输入 exit 或按 Ctrl+C 退出（不会停止服务器）。');
        if (!this.ServerManager.isConsoleRelayAlive()) {
            console.log('   ⚠️  控制台中继未就绪：请用 wow server start 启动服务器，否则指令可能不会被消费。');
        }
        console.log('─'.repeat(64));

        const initial = tailLines(this.logFile, TAIL_LINES);
        initial.forEach(l => console.log(l));
        this.lastSize = this._fileSize();

        // P0（多实例监听泄漏绞杀）：进入 :mc 视图前，先按 scope 清掉本视图
        // 可能残留的旧定时器（例如上一轮 attach 没走干净 finish 的极端情况）。
        timerRegistry.clearScope(FOLLOW_TIMER_SCOPE);
        // 纯 Node 轮询跟随日志（跨平台，Windows 无 tail 也能用）
        this.timer = setInterval(() => this._follow(), FOLLOW_INTERVAL_MS);
        timerRegistry.track(FOLLOW_TIMER_SCOPE, this.timer);
        if (this.timer.unref) this.timer.unref();

        // 顶层 `wow :mc` 也是货真价实的 :mc 视图，打上状态标记（退出时清回）。
        try {
            const vs = require('./view_state');
            vs.set(vs.VIEW.MC, 'mc.console:attach');
        } catch (e) { /* 状态模块不可用时不影响控制台 */ }

        // 走全项目唯一的 stdin 租约出口（绝不自建 readline，守住单例红线）
        this.lease = await stdinSession.claim('mc.console', {
            terminal: Boolean(process.stdin.isTTY),
            prompt: MC_PROMPT
        });
        const rl = this.lease.rl;
        await new Promise((resolve) => {
            const finish = async (reason = 'mc.console:detach') => {
                if (this.closed) return;
                this.closed = true;
                // P0（多实例监听泄漏绞杀）：退出视图三连清——
                //   1) 定时器按 scope 全清（含可能登记但句柄已丢的残留）；
                //   2) 摘掉本视图在 rl 上挂的 line/SIGINT/close 监听，防止旧
                //      handler 在租约复用后再把一条指令处理两遍；
                //   3) 提示符复位到 shell（view_state 同步）。
                timerRegistry.clearScope(FOLLOW_TIMER_SCOPE);
                if (this.timer) { clearInterval(this.timer); this.timer = null; }
                try { rl.removeAllListeners('line'); } catch (e) { /* 忽略 */ }
                try { rl.removeAllListeners('SIGINT'); } catch (e) { /* 忽略 */ }
                try {
                    await this.lease.release();   // release 内部 teardown 会再清 close 监听并 close
                } catch (e) { /* 忽略 */ }
                this.lease = null;
                try {
                    const vs = require('./view_state');
                    vs.set(vs.VIEW.SHELL, reason);
                } catch (e) { /* 忽略 */ }
                resolve();
            };
            this._finish = finish; // 暴露给 _follow()，供检测退出路径复用同一套收尾
            rl.on('line', (raw) => {
                if (this.closed) return;
                const route = routeMcViewInput(raw);
                if (route.action === 'noop') { rl.prompt(); return; }
                if (route.action === 'exit') {
                    console.log('↩ 已离开 :mc 视图（服务器仍在运行）。');
                    finish();
                    return;
                }
                if (route.action === 'switch') {
                    // 顶层独立进程里切视图：提示用哪条命令，不在此进程另开消费者
                    if (route.view === 'wow') console.log('💡 长命令视图请另开终端运行：wow L');
                    else if (route.view === 'menu') console.log('💡 数字菜单请另开终端运行：wow');
                    else if (route.view === 'web') console.log('💡 Web 面板请用：wow web status');
                    else { rl.prompt(); return; }
                    rl.prompt();
                    return;
                }
                if (route.action === 'meta') {
                    // :help 等辅助指令在当前顶层视图给出简要提示
                    if (route.command === ':help' || route.command === ':h' || route.command === ':?') {
                        console.log('   直接输入 Mojang 指令下发；exit 离开；:mc 保持当前视图。');
                    }
                    rl.prompt();
                    return;
                }
                // action === 'mc'：任何输入原封不动转发，绝不走 wow/commander 解析
                const ok = this.ServerManager.enqueueConsoleCommand(route.command);
                if (!ok) console.log('⚠️ 指令下发失败：控制台中继未就绪');
                rl.prompt();
            });
            rl.on('SIGINT', () => {
                console.log('\n↩ 已离开 :mc 视图（服务器仍在运行）。');
                finish();
            });
            rl.on('close', () => { finish(); });
            rl.prompt();
        });
        return true;
    }

    _follow() {
        if (this.closed) return;

        // 降频存活检测：每 10 个 tick（约 3s）探一次服务器进程是否还在。
        // 顶层 `wow :mc` 是独立进程，拿不到子进程 exit 事件，只能靠跨进程判活。
        // P0（Windows 假死修复）：统一走 alive_probe —— PID 文件 + Web /api/status
        // 双证据、连续 3 次「确证死亡」才判停；探测中/异常/不确定一律保守视为存活。
        // 刻意不用心跳 isConsoleRelayAlive()——「服务器在跑但无中继」是受支持场景。
        if (++this._livenessTick % LIVENESS_CHECK_EVERY === 0) {
            let certainDead = false;
            if (this._liveness) {
                certainDead = this._liveness.tick().certainDead;
            } else {
                // 降级兜底：探测器不可用时仍连续确认，绝不单次判停
                let alive = true;
                try { alive = this.server.isRunning() !== false; } catch (e) { /* 保守视为存活 */ }
                this._fallbackDeaths = alive ? 0 : this._fallbackDeaths + 1;
                certainDead = this._fallbackDeaths >= 3;
            }
            if (certainDead) {
                const rl = this.lease && this.lease.rl;
                // 先清掉用户半行，避免提示被拼到输入行尾
                if (rl && rl.clearLine) { try { rl.clearLine(0); } catch (e) { /* 忽略 */ } }
                console.log('\n⏹ 检测到服务器已退出，正在离开 :mc 控制台（服务器进程已结束）。');
                if (this._finish) void this._finish('mc.console:server-exit');
                return;
            }
        }

        let size;
        try { size = fs.statSync(this.logFile).size; } catch (e) { return; }
        if (size <= this.lastSize) {
            // 日志轮转 / 截断：重置基线，避免下次读出整段旧内容
            if (size < this.lastSize) this.lastSize = size;
            // 日志静默 ≠ 服务器停止：进程存活时仅显示状态提示，绝不退出 :mc
            if (++this._silenceTicks === 40) {   // 300ms × 40 ≈ 12s
                printSilenceNotice(this.lease && this.lease.rl);
            }
            return;
        }
        this._silenceTicks = 0;
        const chunk = readRange(this.logFile, this.lastSize, size);
        this.lastSize = size;
        if (!chunk) return;
        // BUG-02：刷实时日志前先保存用户正在输入的半行，刷完原样回填，绝不吞字。
        // 先 clearLine 抹掉旧行 → 写日志 → prompt(true) 重绘提示符 → write(savedLine) 回填输入。
        const rl = this.lease && this.lease.rl;
        const savedLine = (rl && typeof rl.line === 'string') ? rl.line : '';
        const savedCursor = (rl && typeof rl.cursor === 'number') ? rl.cursor : savedLine.length;
        if (rl && rl.clearLine) { try { rl.clearLine(0); } catch (e) { /* 忽略 */ } }
        process.stdout.write(chunk);
        if (!chunk.endsWith('\n')) process.stdout.write('\n');
        if (rl && rl.prompt) { try { rl.prompt(true); } catch (e) { /* 忽略 */ } }
        // 回填被 clearLine/prompt 抹掉的输入，并把光标放回用户原来的位置
        if (savedLine && rl && rl.write) {
            try {
                rl.write(savedLine);
                const back = Math.max(0, savedLine.length - savedCursor);
                for (let i = 0; i < back && rl.write; i++) {
                    try { rl.write(null, { name: 'left' }); } catch (e) { break; }
                }
            } catch (e) { /* 忽略 */ }
        }
    }
}

module.exports = {
    McConsole, isExitCommand, tailLines, readRange,
    routeMcViewInput, MC_PROMPT, WOW_PROMPT
};
