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

        // 走全项目唯一的 stdin 租约出口（绝不自建 readline，守住单例红线）
        this.lease = await stdinSession.claim('mc.console', {
            terminal: Boolean(process.stdin.isTTY),
            prompt: 'mc> '
        });
        const rl = this.lease.rl;
        await new Promise((resolve) => {
            const finish = async () => {
                if (this.closed) return;
                this.closed = true;
                if (this.timer) { clearInterval(this.timer); this.timer = null; }
                try { await this.lease.release(); } catch (e) { /* 忽略 */ }
                this.lease = null;
                resolve();
            };
            rl.on('line', (raw) => {
                if (this.closed) return;
                const line = (raw || '').trim();
                if (!line) { rl.prompt(); return; }
                if (isExitCommand(line)) {
                    console.log('↩ 已离开 :mc 视图（服务器仍在运行）。');
                    finish();
                    return;
                }
                const ok = this.ServerManager.enqueueConsoleCommand(line);
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

module.exports = { McConsole, isExitCommand, tailLines, readRange };
