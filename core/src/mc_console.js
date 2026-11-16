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

const FOLLOW_INTERVAL_MS = 300;
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

        // 纯 Node 轮询跟随日志（跨平台，Windows 无 tail 也能用）
        this.timer = setInterval(() => this._follow(), FOLLOW_INTERVAL_MS);
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
            const finish = async () => {
                if (this.closed) return;
                this.closed = true;
                if (this.timer) { clearInterval(this.timer); this.timer = null; }
                try { await this.lease.release(); } catch (e) { /* 忽略 */ }
                this.lease = null;
                try {
                    const vs = require('./view_state');
                    vs.set(vs.VIEW.SHELL, 'mc.console:detach');
                } catch (e) { /* 忽略 */ }
                resolve();
            };
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
        let size;
        try { size = fs.statSync(this.logFile).size; } catch (e) { return; }
        if (size <= this.lastSize) {
            // 日志轮转 / 截断：重置基线，避免下次读出整段旧内容
            if (size < this.lastSize) this.lastSize = size;
            return;
        }
        const chunk = readRange(this.logFile, this.lastSize, size);
        this.lastSize = size;
        if (!chunk) return;
        // 尽量不让实时日志打断正在输入的这一行
        const rl = this.lease && this.lease.rl;
        if (rl && rl.clearLine) { try { rl.clearLine(0); } catch (e) { /* 忽略 */ } }
        process.stdout.write(chunk);
        if (!chunk.endsWith('\n')) process.stdout.write('\n');
        if (rl && rl.prompt) { try { rl.prompt(true); } catch (e) { /* 忽略 */ } }
    }
}

module.exports = {
    McConsole, isExitCommand, tailLines, readRange,
    routeMcViewInput, MC_PROMPT, WOW_PROMPT
};
