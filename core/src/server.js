/**
 * 服务器进程管理模块
 * - 启动/停止/强制终止/重启/状态查询
 * - 管理 PID 文件
 * - 支持外置登录 (authlib-injector)
 * - 集成 JRE 自动下载
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn, exec } = require('child_process');
const readline = require('readline');
const utils = require('./utils');
const config = require('./config');
const JreManager = require('./jre_manager');
const axios = require('axios');
// V3.6.2（607 指令）：JVM 参数统一构建（parseArgs / GC 互斥 / 内存红线）
const Jvm = require('./jvm_args');
// V3.5.0：事件日志
const { logger } = require('./log');

/**
 * TUI 是否正占着终端画面（见 tui.markScreenActive）。
 *
 * 这里是「最后一道闸」：即使 `_mode` 因为某条路径没来得及切换（或将来新增了
 * 别的入口把菜单叫起来），只要菜单在画，MC 输出就不回显。日志照常落盘，
 * 退出菜单后 `:mc` / 菜单 5 仍可查看。
 */
function tuiOwnsScreen() {
    try { return require('./tui').isScreenActive(); } catch (e) { return false; }
}

// ==================== 开服控制台：wow 指令拦截 ====================
// 在 `wow server start` 的交互终端中，用户输入既可发给 MC 服务端（如 /stop、op），
// 也可直接输入 wow 指令（如 lan host、server status）。此处定义「允许 / 禁用」清单，
// 以及将输入分类后交由子进程执行或转发给 MC 的逻辑。

// wow 顶层指令命名空间（用于区分「wow 指令」与「MC 指令」）
const WOW_NAMESPACES = new Set([
    'server', 'scheme', 'mod', 'pack', 'theme', 'plugin', 'web', 'logs',
    'config', 'mail', 'pool', 'lan', 'down', 'install', 'init', 'set', 'help'
]);

// 允许在开服控制台直接执行的 wow 指令（不修改运行中的方案文件，且非长驻进程）
const ALLOWED_CONSOLE = new Set([
    'server status', 'server stop', 'server kill',
    'lan host', 'lan stop', 'lan status',
    'scheme list', 'scheme info', 'scheme status',
    'mod list',
    'logs analyze', 'logs report',
    'config wow', 'config server', 'config white',
    'web stop', 'web status',
    'pool stats',
    'mail test', 'mail send-code', 'mail crash',
    'down',
    'plugin list', 'plugin info', 'plugin trust', 'plugin path',
    'theme list', 'theme info',
    'help'
]);

// 在开服控制台明确禁用的指令：会修改运行中的方案文件 / 与开服进程冲突 / 长驻或抢占终端
const DENIED_CONSOLE = new Set([
    'server start', 'server restart',
    'scheme create', 'scheme switch', 'scheme delete', 'scheme edit', 'scheme pull',
    'scheme prune', 'scheme register', 'scheme export', 'scheme import',
    'mod remove', 'mod sync', 'mod toggle',
    'pack install', 'pack generate',
    'theme install', 'theme switch', 'theme delete',
    'plugin install', 'plugin remove', 'plugin untrust',
    'install',
    'init',
    'pool prune',
    'web start',          // 常驻进程，会在控制台子进程中挂起
    'logs tail'           // tail -f，会抢占终端
]);

/**
 * 分类开服控制台的一行输入：
 *  - action 'mc'   : 转发给 MC 服务端（MC 管理员指令，如 /stop、op Steve）
 *  - action 'run'  : 作为 wow 指令，由子进程执行（args 为已规范化的参数数组）
 *  - action 'deny' : 禁用指令（危险 / 冲突 / 长驻），返回 reason
 */
function classifyConsoleInput(rawLine) {
    const line = (rawLine || '').trim();
    if (!line) return { action: 'mc' };

    let tokens = line.split(/\s+/);
    if (tokens[0].toLowerCase() === 'wow') tokens = tokens.slice(1); // 允许行首带 wow
    if (tokens.length === 0) return { action: 'mc' };

    // V3.5.8：旧菜单命令 m / M 已移除（无参数启动即进数字菜单）。
    // 这里保留拦截并给新指引，避免 `wow m` 被当成 MC 指令转发后报 unknown command。
    if (tokens[0] === 'm' || tokens[0] === 'M') {
        return { action: 'deny', reason: '菜单命令已调整：直接运行 wow（无参数）即进入数字菜单；长命令模式为 wow L' };
    }

    // V3.5.8：长命令 REPL（wow L）是交互式界面，在开服控制台里会抢占 stdin，不可用
    if (tokens[0] === 'L') {
        return { action: 'deny', reason: '长命令模式(wow L)是交互式 REPL，在开服控制台中不可用，请另开终端运行' };
    }

    const head = tokens[0].toLowerCase();

    // V3.5.21：插件命令也属于 wow 命名空间（运行期才知道），
    // 但绝不能被当成 MC 指令转发给服务端（否则插件命令会变成「unknown command in game」）。
    // 插件命令在开服控制台里直接拒绝：它们多半带长驻 / 交互逻辑，
    // 而且此时方案文件正在被正在运行的服务端使用。
    // 注：这里不 require command_policy，避免 server.js 依赖链里多一个模块；
    // 直接用同名规则判断（两者必须保持一致，见 plugin_loader.registerPluginCommand）。
    try {
        const policy = require('./command_policy');
        if (policy.RUNTIME_PLUGIN_CMDS.has(head)) {
            return {
                action: 'deny',
                reason: `插件命令 ${head} 不提供在开服控制台中执行，请另开终端运行`
            };
        }
    } catch (e) { /* 策略模块不可用则不额外拦截 */ }

    if (!WOW_NAMESPACES.has(head)) return { action: 'mc' }; // 非 wow 命名空间 → 当作 MC 指令

    const two = tokens.slice(0, 2).join(' ').toLowerCase();

    // config / set 的写入形式需与只读形式区分
    if (head === 'config') {
        if ((tokens[1] === 'wow' || tokens[1] === 'server') && tokens.length >= 4) {
            return { action: 'deny', reason: '修改 wow.yaml / server.properties 会改动运行中的方案文件，开服控制台中不可用，请另开终端执行' };
        }
        if (two === 'config white' && tokens.length >= 4 && (tokens[2] === 'add' || tokens[2] === 'remove')) {
            return { action: 'deny', reason: '修改白名单文件会改动运行中的方案，开服控制台中不可用，请另开终端执行' };
        }
        return ALLOWED_CONSOLE.has(two)
            ? { action: 'run', args: tokens.map(t => t.toLowerCase()) }
            : { action: 'deny', reason: '该指令在开服控制台中不可用，请另开终端执行' };
    }
    if (head === 'set') {
        return { action: 'deny', reason: '快捷设置配置会改动运行中的方案文件，开服控制台中不可用，请另开终端执行' };
    }

    if (DENIED_CONSOLE.has(two) || DENIED_CONSOLE.has(head)) {
        return { action: 'deny', reason: '该指令会修改运行中的方案文件 / 与开服进程冲突 / 抢占终端，开服控制台中不可用，请另开终端执行' };
    }
    if (ALLOWED_CONSOLE.has(two) || ALLOWED_CONSOLE.has(head)) {
        return { action: 'run', args: tokens.map(t => t.toLowerCase()) };
    }
    return { action: 'deny', reason: '该指令在开服控制台中不可用（可能需修改运行中的方案文件），请另开终端执行' };
}

// ==================== V3.4.0 控制台视图（wow / Minecraft / 陶瓦）====================
// 开服控制台不再是「一个终端混着三种东西」，而是三个可切换的控制台视图：
//   mc  —— Minecraft 服务端控制台：输入转发给服务端，显示服务端日志
//   wow —— wow 指令控制台：输入作为 wow 指令执行，显示 wow 指令输出
//   lan —— 陶瓦联机控制台：显示陶瓦 HTTP API 的返回，只接受 lan 子命令
// 切换后会清屏并显示该控制台的最后 10 条日志，避免三种输出互相干扰。

const CONSOLE_MODES = {
    mc: { key: 'mc', name: 'Minecraft 服务端控制台', icon: '🎮', switchCmd: ':mc' },
    wow: { key: 'wow', name: 'wow 指令控制台', icon: '🧩', switchCmd: ':wow' },
    lan: { key: 'lan', name: '陶瓦联机控制台', icon: '🏠', switchCmd: ':lan' }
};

// 切换指令别名 → 模式
const MODE_ALIASES = {
    ':mc': 'mc', ':minecraft': 'mc', ':1': 'mc', ':服务端': 'mc',
    ':wow': 'wow', ':2': 'wow',
    ':lan': 'lan', ':terracotta': 'lan', ':taowa': 'lan', ':3': 'lan', ':陶瓦': 'lan'
};

// 切换后显示的日志条数（用户需求：最后十条）
const CONSOLE_TAIL_LINES = 10;

// ==================== Web 控制台指令中继（V3.5.19）====================
// 背景：Web 面板与 Minecraft 进程通常不在同一个 Node 进程里（面板由 `wow web start`
// 拉起的进程托管，服务端由 `wow server start` 拉起的子进程托管）。面板进程拿不到
// MC 子进程的 stdin 管道，于是「在网页控制台敲 list」只能退化成执行 `wow list`，
// 最终报 unknown command。
//
// 方案：用两个小文件做单向中继——
//   .console.queue  面板追加待执行的 MC 指令（每行一条）
//   .console.alive  持有 stdin 的那个进程定时刷新心跳，面板据此判断「有没有人在收」
// 持有 stdin 的进程每 250ms 取走队列并写入 MC stdin。纯文件实现，跨平台且无端口占用。
const CONSOLE_QUEUE_FILE = path.join(__dirname, '../.console.queue');
const CONSOLE_ALIVE_FILE = path.join(__dirname, '../.console.alive');
const CONSOLE_RELAY_INTERVAL = 250;


/**
 * 读取文本文件最后 n 行（不存在或读取失败返回空数组）。
 * 只读取文件尾部若干字节，避免整份日志载入内存（latest.log 可能很大）。
 */
function tailLines(file, n = CONSOLE_TAIL_LINES, maxBytes = 256 * 1024) {
    try {
        if (!fs.existsSync(file)) return [];
        const size = fs.statSync(file).size;
        if (size === 0) return [];
        const start = Math.max(0, size - maxBytes);
        const len = size - start;
        const buf = Buffer.alloc(len);
        const fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
        const lines = buf.toString('utf8').split(/\r?\n/).filter(l => l.trim() !== '');
        return lines.slice(-n);
    } catch (e) {
        return [];
    }
}

/**
 * 以子进程方式执行一条 wow 指令。
 * V3.4.0：输出改为管道并「tee」——既实时打到终端，也追加到 wow 控制台日志，
 * 以便切换回 wow 控制台时能显示最后 10 条 wow 日志。
 * @param {string[]} args    wow 子命令参数
 * @param {string} [logFile] wow 控制台日志文件（可选）
 */
function runWowSubcommand(args, logFile) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
        const tee = (chunk, isErr) => {
            if (isErr) process.stderr.write(chunk);
            else process.stdout.write(chunk);
            if (logFile) {
                try { fs.appendFileSync(logFile, chunk); } catch (e) {}
            }
        };
        if (child.stdout) child.stdout.on('data', c => tee(c, false));
        if (child.stderr) child.stderr.on('data', c => tee(c, true));
        child.on('error', reject);
        child.on('exit', code => {
            if (code && code !== 0) {
                const msg = `[wow] 子命令退出码: ${code}\n`;
                process.stderr.write(msg);
                if (logFile) { try { fs.appendFileSync(logFile, msg); } catch (e) {} }
            }
            resolve();
        });
    });
}

class ServerManager {
    constructor() {
        this.serverDir = utils.getServerDir();
        this.pidFile = path.join(this.serverDir, 'server.pid');
        this.logFile = path.join(this.serverDir, 'logs', 'latest.log');
        // V3.4.0：wow 指令控制台的日志（供切回 wow 控制台时显示最后 10 条）
        this.wowLogFile = path.join(this.serverDir, 'logs', 'wow-console.log');
        // V3.4.0：服务端进程原始 stdout/stderr 的存档。
        // 不能再往 logs/latest.log 里写：Minecraft 自己的 log4j 启动时会重建
        // latest.log，而 wow 的写入流仍持有旧 fd 并按原偏移继续追加，
        // 结果是同一份日志被写两遍、行首被截断、内容交错（V3.4.0 修复）。
        // 这里单独存档，主要用于排查 log4j 初始化之前的早期崩溃。
        this.stdoutLogFile = path.join(this.serverDir, 'logs', 'wow-stdout.log');
        this.process = null;
        this.jreManager = new JreManager();
        this.config = config;
        this.authlibJar = null;
        // V3.4.0 控制台视图：'mc' | 'wow' | 'lan'，默认停在 Minecraft 服务端控制台
        this._mode = 'mc';
        this._lanTimer = null;
        this._lanLastSig = '';
        this._ensureAuthlibJar();
    }

    // ==================== V3.4.0 控制台视图切换 ====================

    /** 向 wow 控制台日志追加一行（失败静默） */
    _appendWowLog(text) {
        try {
            fs.ensureDirSync(path.dirname(this.wowLogFile));
            fs.appendFileSync(this.wowLogFile, text.endsWith('\n') ? text : text + '\n', 'utf8');
        } catch (e) {}
    }

    /**
     * V3.5.0：扫描一段 Minecraft 输出，将含错误特征的内容记入事件日志（ERRO）。
     * 仅抽取错误特征行，避免把整份 MC 日志刷进 wow 事件日志。
     */
    _logMcChunk(data) {
        try {
            const text = data.toString();
            if (!text) return;
            const lines = text.split(/\r?\n/);
            for (const raw of lines) {
                const line = raw.trim();
                if (!line) continue;
                if (/\[(ERROR|SEVERE|FATAL)\]|Exception in thread|Exception:|Caused by:|Error:|java\.lang\.|Unhandled|crash|无法|失败/i.test(line)) {
                    logger.erro(`[MC] ${line.slice(0, 300)}`);
                }
            }
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 处理一行「非元指令」的控制台输入（MC 指令转发 / wow 子命令 / 陶瓦指令）。
     *
     * 从 start() 的 rl.on('line') 里抽出来，`_bindConsoleLine` 也调它，
     * 保证「首次进入控制台」与「从 M 模式返回后」两条路径的行为完全一致。
     *
     * @param {string} line 已 trim 的输入
     * @param {import('readline').Interface} rl 当前控制台的 readline
     */
    async _handleConsoleLine(line, rl) {
        // ── 陶瓦控制台：允许省略 lan 前缀（host / status / stop）──
        let effective = line;
        if (this._mode === 'lan' && /^(host|status|stop)(\s|$)/i.test(line)) {
            effective = 'lan ' + line;
        }

        const d = classifyConsoleInput(effective);

        if (d.action === 'deny') {
            console.log(`⛔ ${d.reason}`);
            if (this._mode === 'wow') this._appendWowLog(`⛔ ${d.reason}`);
            return;
        }

        if (d.action === 'mc') {
            // Minecraft 指令：只能在 Minecraft 控制台执行
            if (this._mode !== 'mc') {
                this._printUnsupported(line, 'mc');
                return;
            }
            if (this.process && this.process.stdin && this.process.stdin.writable) {
                this.process.stdin.write(line + '\n');
            }
            return;
        }

        // d.action === 'run'：wow 指令
        const isLanCmd = d.args[0] === 'lan';
        if (this._mode === 'mc') {
            this._printUnsupported(line, isLanCmd ? 'lan' : 'wow');
            return;
        }
        if (this._mode === 'lan' && !isLanCmd) {
            this._printUnsupported(line, 'wow');
            return;
        }

        try { rl.pause(); } catch (e) { /* 已关闭 */ }
        try {
            // wow 控制台的输出记入 wow 日志；陶瓦指令的 API 返回已由 terracotta 落盘
            const logTarget = this._mode === 'wow' ? this.wowLogFile : null;
            if (logTarget) this._appendWowLog(`$ wow ${d.args.join(' ')}`);
            await runWowSubcommand(d.args, logTarget);
        } catch (e) {
            const msg = `[wow] 指令执行失败: ${e.message}`;
            console.error(msg);
            if (this._mode === 'wow') this._appendWowLog(msg);
        }
        try { if (!rl.closed) rl.resume(); } catch (e) { /* 忽略 */ }
    }

    /**
     * 构造 M 模式需要的管理器集合。
     *
     * 与 cli.js 的 buildMenuOptions() 是同一份清单，但这里不能 require cli
     * （循环依赖：cli → server → cli）。所以就地建一遍，且**每个都包 try/catch**
     * ——某个模块坏了只让对应菜单项降级，不能让「控制台里打 :wow」整个崩掉。
     *
     * 注意 ServerManager 直接复用 `this`：这样才能看到「正在运行的服务器」状态，
     * 新建一个实例会去读 pid 文件，虽然结果一样但多一次 IO，而且启动/停止的
     * 事件流也对不上。
     */
    _menuOptions() {
        const opt = {
            serverManager: this,
            config,
            utils
        };
        const lazy = [
            ['installer', './installer'],
            ['modManager', './mod_manager'],
            ['schemeManager', './scheme_manager'],
            ['themeManager', './theme_manager'],
            ['packGenerator', './pack_generator'],
            ['logHandler', './log_handler']
        ];
        for (const [field, mod] of lazy) {
            try {
                const Ctor = require(mod);
                opt[field] = new Ctor();
            } catch (e) {
                opt[field] = null;
            }
        }
        return opt;
    }

    /** 打印当前控制台的标题栏与操作提示 */
    _printConsoleBanner(mode) {
        const m = CONSOLE_MODES[mode];
        // V3.6.3：:wow 已改为「进 M 模式」，它的「日志视图」单独给了 :wowlog
        const others = Object.keys(CONSOLE_MODES)
            .filter(k => k !== mode)
            .map(k => (k === 'wow'
                ? `${CONSOLE_MODES[k].switchCmd} → 进入 M 模式菜单`
                : `${CONSOLE_MODES[k].switchCmd} → ${CONSOLE_MODES[k].name}`))
            .join('　');
        console.log('═'.repeat(64));
        console.log(`  ${m.icon} ${m.name}`);
        console.log('─'.repeat(64));
        console.log(`  切换: ${others}`);
        console.log(`  其他: :wowlog 查看 wow 指令日志　:log 重新显示日志　:help 查看帮助`);
        console.log('═'.repeat(64));
    }

    /**
     * 创建开服控制台的 readline。
     *
     * V3.6.3：抽成方法是因为 M 模式退出后要**重新建一个**——M 模式的 TUI
     * 会把自己的 readline 关掉再交还 stdin（否则两边抢键盘），回来时这个
     * rl 已经 close，必须重建。集中在这里创建可以保证两处参数完全一致。
     */
    _createConsoleRl() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        this._rl = rl;
        rl.on('SIGINT', () => {
            if (this.isRunning()) {
                console.log('\n⏹ 收到中断信号，正在停止服务器...');
                this.stop();
            }
        });
        return rl;
    }

    /** 启动时的控制台引导提示（与 _printConsoleBanner 分开：这里只讲一次） */
    _printConsoleIntro() {
        console.log('💡 开服控制台（V3.6.3 起 :wow 进入 M 模式菜单，Ctrl+C 退出菜单回到本控制台）：');
        console.log(`   ${CONSOLE_MODES.mc.switchCmd} ${CONSOLE_MODES.mc.icon} ${CONSOLE_MODES.mc.name}（当前）　` +
            `${CONSOLE_MODES.wow.switchCmd} ${CONSOLE_MODES.wow.icon} M 模式菜单　` +
            `${CONSOLE_MODES.lan.switchCmd} ${CONSOLE_MODES.lan.icon} ${CONSOLE_MODES.lan.name}`);
        console.log('   输入 :help 查看帮助。⛔ 会修改运行中方案文件的危险指令仍不可用。');
    }

    /**
     * V3.6.3（609 指令约束③）：从开服控制台进入 M 模式。
     *
     * 时序要点：
     *   1. 先 `rl.close()` —— TUI 需要独占 stdin，两个 readline 同时挂着会把
     *      每个按键读两遍；
     *   2. 让出一轮事件循环再进 TUI —— rl.close() 释放 stdin 是异步的，
     *      在 close 回调里同步新建 readline 会让两个接口短暂并存；
     *   3. TUI 返回后重建控制台 readline，并把视图切回 `:wow`
     *      （约束③：进 L 模式回来必须落在 `:wow`，退出 TUI 同理）。
     *
     * 期间服务端 stdout 仍在写 logStream，只是不回显——`_mode` 保持 'wow'
     * 的话 MC 输出会被 `if (this._mode === 'mc')` 挡掉，正好不刷屏。
     */
    async _enterMenuFromConsole() {
        // 进菜单期间把视图钉在 wow：MC 输出不回显，避免把 TUI 画面顶乱
        this._mode = 'wow';
        this._stopLanWatch();

        // 菜单期间摘掉「Ctrl+C = 停服」：菜单自己的键盘处理会问「确定要退出吗」，
        // 但 raw 模式只在 TUI 里生效，停在「按回车键返回」这种行输入提示上时，
        // Ctrl+C 会直冲 process 的 SIGINT——用户只是想退出菜单，服务器却跟着关了。
        // 退出菜单时（下面 finally 里的路径）再装回去。
        if (this._sigintHandler) {
            try { process.removeListener('SIGINT', this._sigintHandler); } catch (e) { /* 忽略 */ }
        }

        const oldRl = this._rl;
        this._rl = null;
        if (oldRl) {
            try { oldRl.close(); } catch (e) { /* 已关闭 */ }
        }
        await new Promise(r => setImmediate(r));

        // 选 L 时 onEnterLongCommand 已经把控制台接回来了（并且打了一次横幅），
        // 标记一下，避免下面的 _backToConsole 再打一遍同样的画面。
        let restored = false;
        try {
            const interactive = require('./interactive');
            await interactive.showMainMenu({
                ...this._menuOptions(),
                // 关键：M 模式里选「进入 L 模式」时，必须回到本控制台的 :wow 视图，
                // 而不是退到另一个 REPL（那会与这里的 stdin 抢占）。
                onEnterLongCommand: async () => {
                    await this._backToConsole('wow');
                    restored = true;
                },
                // 关键：菜单里的「0 退出 / Ctrl+C 确认」只能退出菜单，
                // 不能 process.exit——否则正在跑的 Minecraft 服务端会跟着一起没。
                returnOnExit: true
            });
        } catch (e) {
            console.error(`❌ 菜单启动失败: ${e.message}`);
            logger.erro(`开服控制台内启动菜单失败: ${e.message}`);
        }

        // 从 M 模式返回：重建 readline + 回到 :wow 视图
        if (!restored) await this._backToConsole('wow');

        // 服务端还在跑就把 SIGINT 装回去（菜单里把服务器停了的话，进程已退出，
        // 再装也没意义，还会让下一次 Ctrl+C 走到 stop() 的空路径上）。
        if (this._sigintHandler && this.process && !this.process.killed) {
            try { process.once('SIGINT', this._sigintHandler); } catch (e) { /* 忽略 */ }
        }
    }

    /**
     * 回到控制台：重建 readline 并切到指定视图。
     *
     * 与 `_switchConsole` 的区别：这里会**先重建 rl**，因为从 M 模式 / L 模式
     * 回来时旧 rl 已经关掉了。`_switchConsole` 只管画面不管 rl。
     *
     * @param {'mc'|'wow'|'lan'} [mode='wow'] 要落回的视图
     */
    async _backToConsole(mode = 'wow') {
        if (!this.process) return;   // 服务端已退出，不需要控制台了
        if (!this._rl || this._rl.closed) {
            const rl = this._createConsoleRl();
            // 重新绑定 line 处理器。这里复用 start() 里的同一段路由逻辑，
            // 通过 _bindConsoleLine() 提取，避免两处各写一遍逐渐分叉。
            this._bindConsoleLine(rl);
        }
        await this._switchConsole(mode);
    }

    /**
     * 把「一行输入 → 控制台路由」的处理器绑到 rl 上。
     *
     * 抽出来的原因：start() 与 _backToConsole() 都要绑，两边逻辑必须完全一致
     * （尤其是 :wow / :wowlog / 三视图切换 的顺序判定）。
     */
    _bindConsoleLine(rl) {
        rl.on('line', async (raw) => {
            if (this._rl !== rl) return;   // 陈旧 rl 的残留事件
            const line = (raw || '').trim();
            if (!line) return;
            const lower = line.toLowerCase();

            if (MODE_ALIASES[lower] === 'wow') {
                // 已经在控制台里，直接进菜单
                await this._enterMenuFromConsole();
                return;
            }
            if (MODE_ALIASES[lower]) {
                await this._switchConsole(MODE_ALIASES[lower]);
                return;
            }
            if (lower === ':wowlog' || lower === ':wowlogs') {
                await this._printConsoleTail('wow');
                return;
            }
            if (lower === ':log' || lower === ':logs') {
                await this._printConsoleTail(this._mode);
                return;
            }
            if (lower === ':help' || lower === ':h' || lower === ':?') {
                this._printConsoleHelp();
                return;
            }
            await this._handleConsoleLine(line, rl);
        });
    }

    /**
     * 显示当前控制台最近 CONSOLE_TAIL_LINES 条日志。
     * - mc  : Minecraft 服务端 latest.log
     * - wow : wow 指令控制台日志
     * - lan : 陶瓦 HTTP API 的返回流水（用户需求：陶瓦显示 HTTP API 返回）
     */
    async _printConsoleTail(mode) {
        console.log(`  ── 最近 ${CONSOLE_TAIL_LINES} 条日志 ──`);
        if (mode === 'lan') {
            let entries = [];
            try {
                const Terracotta = require('./terracotta');
                entries = Terracotta.readApiLog(CONSOLE_TAIL_LINES);
                if (entries.length === 0) {
                    // 还没有任何 API 流水：若陶瓦在运行就实时查一次，让用户立刻看到返回
                    if (Terracotta.isRunning()) {
                        await Terracotta.getStatus().catch(() => null);
                        entries = Terracotta.readApiLog(CONSOLE_TAIL_LINES);
                    }
                }
            } catch (e) {
                console.log(`  （读取陶瓦 API 流水失败: ${e.message}）`);
            }
            if (entries.length === 0) {
                console.log('  （暂无陶瓦 HTTP API 记录。陶瓦未启动时可输入 host 开房）');
            } else {
                for (const e of entries) {
                    const t = (e.t || '').replace('T', ' ').slice(0, 19);
                    const body = e.error
                        ? `ERROR ${e.error}`
                        : (typeof e.body === 'object' ? JSON.stringify(e.body) : String(e.body === undefined ? '' : e.body));
                    console.log(`  [${t}] ${e.method || 'GET'} ${e.url || ''} → ${e.status === null || e.status === undefined ? '-' : e.status} ${body}`);
                }
            }
            console.log('─'.repeat(64));
            return;
        }

        const file = mode === 'wow' ? this.wowLogFile : this.logFile;
        const lines = tailLines(file, CONSOLE_TAIL_LINES);
        if (lines.length === 0) {
            console.log(mode === 'wow'
                ? '  （暂无 wow 指令日志。可输入 server status、scheme list 等指令）'
                : `  （暂无服务端日志：${file}）`);
        } else {
            lines.forEach(l => console.log('  ' + l));
        }
        console.log('─'.repeat(64));
    }

    /**
     * 切换控制台视图：清屏 → 标题栏 → 最后 10 条日志。
     * 陶瓦视图会启动一个轻量轮询，把状态变化实时显示为 HTTP API 返回。
     */
    async _switchConsole(mode) {
        if (!CONSOLE_MODES[mode]) return;
        const prev = this._mode;
        this._mode = mode;
        this._stopLanWatch();

        try {
            require('./interactive').clearScreen();
        } catch (e) {
            process.stdout.write('\x1Bc');
        }
        this._printConsoleBanner(mode);
        await this._printConsoleTail(mode);

        if (mode === 'mc') {
            console.log('  输入 Minecraft 指令（如 op Steve、say hi、stop）直接发送给服务端。');
        } else if (mode === 'wow') {
            console.log('  输入 wow 指令（如 server status、scheme list、logs analyze）。');
        } else {
            console.log('  输入 host 开房 / status 查看房间 / stop 关房（等价于 lan host|status|stop）。');
            this._startLanWatch();
        }
        if (prev !== mode) {
            const label = CONSOLE_MODES[mode].name;
            if (mode === 'wow') this._appendWowLog(`[wow] 已切换到${label}`);
        }
    }

    /** 陶瓦视图：轮询陶瓦状态，仅在状态变化时输出一行 HTTP API 返回 */
    _startLanWatch() {
        this._stopLanWatch();
        const tick = async () => {
            if (this._mode !== 'lan') return;
            try {
                const Terracotta = require('./terracotta');
                if (!Terracotta.isRunning()) return;
                const s = await Terracotta.getStatus();
                const sig = `${s.state}|${s.roomCode}`;
                if (sig !== this._lanLastSig) {
                    this._lanLastSig = sig;
                    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
                    console.log(`  [${ts}] GET /state → 200 ${JSON.stringify({ state: s.state, room: s.roomCode || null })}`);
                }
            } catch (e) {
                // 陶瓦未运行 / 端口失效：静默
            }
        };
        this._lanTimer = setInterval(tick, 5000);
        if (this._lanTimer.unref) this._lanTimer.unref();
        tick();
    }

    /** 停止陶瓦视图轮询 */
    _stopLanWatch() {
        if (this._lanTimer) {
            clearInterval(this._lanTimer);
            this._lanTimer = null;
        }
        this._lanLastSig = '';
    }

    /** 打印「当前控制台不支持该指令」的提示，并引导切换 */
    _printUnsupported(line, targetMode) {
        const cur = CONSOLE_MODES[this._mode];
        const tgt = CONSOLE_MODES[targetMode];
        const msg = [
            `⛔ 不支持：「${line}」不属于${cur.icon} ${cur.name}。`,
            `   它是${tgt.icon} ${tgt.name}的指令，请先输入 ${tgt.switchCmd} 切换到该控制台，再执行。`
        ].join('\n');
        console.log(msg);
        if (this._mode === 'wow') this._appendWowLog(msg);
    }

    /** 打印控制台帮助 */
    _printConsoleHelp() {
        console.log('');
        console.log('📖 开服控制台帮助（V3.6.3 起 :wow 进入 M 模式菜单）');
        console.log('   切换控制台（切换后会清屏并显示该控制台最后 10 条日志）：');
        for (const k of Object.keys(CONSOLE_MODES)) {
            const m = CONSOLE_MODES[k];
            const mark = k === this._mode ? '← 当前' : '';
            if (k === 'wow') {
                console.log(`     ${m.switchCmd.padEnd(6)} 🧩 进入 M 模式菜单（七页 TUI，Ctrl+C 退出菜单）`);
                continue;
            }
            console.log(`     ${m.switchCmd.padEnd(6)} ${m.icon} ${m.name} ${mark}`);
        }
        console.log('   :wowlog     查看 wow 指令控制台最后 10 条日志');
        console.log('   :log        重新显示当前控制台最后 10 条日志');
        console.log('   :help       显示本帮助');
        console.log('   说明：每个控制台只接受自己的指令，输入其他控制台的指令会提示切换。');
        console.log('        陶瓦控制台显示的是陶瓦本地 HTTP API 的返回内容。');
        console.log('        M 模式里可切页面 Q/W/E/R/T/Y、数字执行功能、L 进长命令模式；');
        console.log('        从 M 模式返回时总是落在 :wow（约束：进 L 模式回来也必须是 :wow）。');
        console.log('');
    }

    /**
     * 确保 authlib-injector.jar 存在（如果启用外置登录）
     */
    async _ensureAuthlibJar() {
        const authConfig = this.config.getConfig('auth', {});
        if (!authConfig.enable) {
            this.authlibJar = null;
            return;
        }

        // 如果用户直接指定了 javaagent 路径，直接使用
        if (authConfig.javaagent) {
            const agentPath = authConfig.javaagent;
            if (fs.existsSync(agentPath)) {
                this.authlibJar = agentPath;
                return;
            } else {
                console.warn(`⚠️ 指定的 javaagent 路径不存在: ${agentPath}`);
            }
        }

        // 尝试从 pool 中查找 authlib-injector.jar
        const poolDir = utils.getPoolPath();
        const jarPath = path.join(poolDir, 'authlib-injector.jar');
        if (fs.existsSync(jarPath)) {
            this.authlibJar = jarPath;
            return;
        }

        // 如果启用自动下载，则下载
        if (authConfig.auto_download !== false) {
            console.log('📥 正在下载 authlib-injector.jar ...');
            try {
                await this._downloadAuthlibInjector(poolDir);
                this.authlibJar = path.join(poolDir, 'authlib-injector.jar');
            } catch (e) {
                console.error(`❌ 下载 authlib-injector 失败: ${e.message}`);
                this.authlibJar = null;
            }
        } else {
            console.warn('⚠️ authlib-injector.jar 未找到，且自动下载已禁用');
            this.authlibJar = null;
        }
    }

    /**
     * 下载 authlib-injector
     */
    async _downloadAuthlibInjector(targetDir) {
        // 获取最新版本信息
        const manifestUrl = 'https://authlib-injector.yushi.moe/artifact/latest.json';
        const response = await axios.get(manifestUrl, { timeout: 10000 });
        const data = response.data;
        const downloadUrl = data.download_url;
        if (!downloadUrl) {
            throw new Error('无法获取 authlib-injector 下载链接');
        }

        const jarPath = path.join(targetDir, 'authlib-injector.jar');
        const writer = fs.createWriteStream(jarPath);
        const downloadResp = await axios({
            method: 'get',
            url: downloadUrl,
            responseType: 'stream',
            timeout: 60000
        });
        downloadResp.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        console.log(`✅ authlib-injector 已下载: ${jarPath}`);
    }

    /**
     * 检查服务器是否正在运行
     */
    isRunning() {
        if (this.process && this.process.pid) {
            return this._isProcessAlive(this.process.pid);
        }
        const pid = this._readPid();
        if (pid) {
            return this._isProcessAlive(pid);
        }
        return false;
    }

    /**
     * 检查进程是否存在
     */
    _isProcessAlive(pid) {
        try {
            if (utils.getOS() === 'windows') {
                const result = exec(`tasklist /FI "PID eq ${pid}"`, { timeout: 2000 });
                return result.stdout.includes(`${pid}`);
            }
            process.kill(pid, 0);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 读取 PID 文件
     */
    _readPid() {
        try {
            if (fs.existsSync(this.pidFile)) {
                const pid = parseInt(fs.readFileSync(this.pidFile, 'utf8').trim());
                return pid || null;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    /**
     * 写入 PID 文件
     */
    _writePid(pid) {
        fs.ensureDirSync(this.serverDir);
        fs.writeFileSync(this.pidFile, pid.toString(), 'utf8');
    }

    /**
     * 删除 PID 文件
     */
    _removePid() {
        if (fs.existsSync(this.pidFile)) {
            fs.removeSync(this.pidFile);
        }
    }

    /**
     * V3.5.13：诊断并报告「配置指向的方案目录不存在」。
     *
     * getServerDir() 在方案目录缺失时会静默回退到 scheme 根目录，导致原本的
     * 「未找到服务器核心」提示严重误导——用户会以为方案还在、只是核心丢了，
     * 从而被引导去执行 scheme switch <方案>（对不存在的方案只会再报一次错）。
     *
     * @returns {boolean} true 表示确实缺失（已输出诊断），false 表示目录存在、不该报错
     */
    _reportMissingSchemeDir(schemeName) {
        const schemeDir = utils.resolvePath(path.join('../scheme', schemeName));
        if (fs.existsSync(schemeDir)) return false;
        console.error('未找到服务器核心（.jar）');
        console.error(`当前配置指向的方案「${schemeName}」目录不存在`);
        console.error('配置位置: core/wow.yaml -> server.scheme');
        console.error(`期望目录: ${schemeDir}`);
        console.error(`当前实际使用: ${this.serverDir}（已回退到 scheme 根目录）`);
        console.error('');
        console.error('常见原因：换了新的解压目录（旧方案仍在旧目录里），或方案已删除。');
        console.error(`若方案在旧目录：复制 ${path.join('旧目录', 'scheme', schemeName)} 到 ${path.join('本目录', 'scheme', schemeName)}`);
        console.error(`若需重新建方案: scheme create ${schemeName} --type <类型> --version <MC版本>`);
        logger.erro(`启动服务器失败：方案目录不存在（方案=${schemeName}，期望目录=${schemeDir}）`);
        return true;
    }

    /**
     * 获取服务器核心文件
     */
    _getServerJar() {
        const serverDir = this.serverDir;
        // 1) 优先使用配置里记录的核心（Fabric/Quilt 安装后会同时存在原版 server.jar，
        //    必须以启动器 jar 为准，否则会误选原版核心）
        const cfgJar = this.config.getConfig('server.jar');
        if (cfgJar && fs.existsSync(path.join(serverDir, cfgJar))) {
            return cfgJar;
        }
        const files = fs.readdirSync(serverDir);
        // 排除安装器（*-installer.jar 不是可运行的服务器核心，误选会导致 "Invalid or corrupt jarfile"）
        // 以及外置登录用的 authlib-injector
        const jarFiles = files.filter(f => {
            const lf = f.toLowerCase();
            return lf.endsWith('.jar') && !lf.includes('authlib-injector') && !lf.includes('installer');
        });
        if (jarFiles.length === 0) {
            // V3.5.8：新型 Forge/NeoForge 只有 args 文件、根目录没有独立核心 jar，
            // 此时配置里若记录了 server.jar（可能在 libraries/ 深处）就直接认它，
            // 不再盲目报「未找到核心」。
            const argsCfg = this.config.getConfig('server.launchArgsFile');
            if (argsCfg && fs.existsSync(path.join(serverDir, argsCfg))) {
                return cfgJar && fs.existsSync(path.join(serverDir, cfgJar))
                    ? cfgJar
                    : argsCfg;
            }
            throw new Error('未找到服务器核心文件 (.jar)');
        }
        if (jarFiles.length === 1) {
            return jarFiles[0];
        }
        // 多个候选：按配置的服务端类型（server.type）精确匹配，避免盲选
        const type = (this.config.getConfig('server.type') || '').toLowerCase();
        const prefer = {
            quilt: /quilt-server-launch\.jar$/,
            fabric: /fabric-server-launch\.jar$/,
            forge: /forge-.+-server\.jar$/,
            neoforge: /neoforge-.+-server\.jar$/
        }[type];
        if (prefer) {
            const hit = jarFiles.find(f => prefer.test(f));
            if (hit) return hit;
        }
        // Forge/NeoForge 老版本：根目录的核心叫 forge-<mc>-<loader>.jar（无 -server 后缀），
        // 与同目录的 minecraft_server.<mc>.jar（原版）并存——旧实现会「含 server」地误选原版，
        // 结果装的是 Forge、跑起来却是原版。这里显式优先 forge-/neoforge- 前缀的核心。
        if (type === 'forge' || type === 'neoforge') {
            const prefix = type === 'forge' ? 'forge-' : 'neoforge-';
            const fam = jarFiles.filter(f => {
                const lf = f.toLowerCase();
                return lf.startsWith(prefix)
                    && !lf.startsWith('minecraft_server.')
                    && !/^server-[\d.]+\.jar$/.test(lf);
            });
            if (fam.length) {
                return fam.find(f => /-server\.jar$/i.test(f)) || fam[0];
            }
        }
        // 兜底：优先选含 'server' 的启动器 jar
        const byServer = jarFiles.find(f => f.toLowerCase().includes('server'));
        if (byServer) return byServer;
        // 仍无法确定：告警后取首个（保持原有尽力而为行为）
        console.warn(`⚠️ 检测到多个核心 jar（${jarFiles.join(', ')}），已默认选用 ${jarFiles[0]}。如需指定，请在 wow.yaml 设置 server.jar。`);
        return jarFiles[0];
    }

    /**
     * 获取 Java 可执行文件路径
     */
    async _getJavaExecutable() {
        let javaPath = this.config.getConfig('server.java');
        if (javaPath && fs.existsSync(javaPath)) {
            return javaPath;
        }

        const mcVersion = this._detectMinecraftVersion();
        const javaExec = await this.jreManager.ensureJavaForMinecraft(mcVersion);
        if (javaExec) {
            return javaExec;
        }

        // V3.5.7：ensureJavaForMinecraft 已极尽所能（含自动下载），仍失败时说明
        // 确实没有可用 Java。此时不再退到「任意能跑的 java」——用错版本会启动即崩，
        // 提示用户更清晰。仅在完全没有 Java 时才抛错。
        const required = (this.jreManager && this.jreManager.getRequiredJavaVersion)
            ? this.jreManager.getRequiredJavaVersion(mcVersion)
            : null;
        const systemJava = required
            ? utils.detectJava(required)
            : utils.detectJava();
        if (systemJava) {
            return systemJava;
        }

        if (required) {
            const anyJava = utils.detectJava(null, { allowMismatch: true });
            if (anyJava) {
                console.warn(`⚠️ 未找到 Java ${required}（此版本 Minecraft 需要），当前将使用 ${anyJava}。`);
                console.warn('   如果服务器启动失败，请在菜单 8 → 1 自动安装对应的 Java。');
                return anyJava;
            }
        }

        throw new Error(`未找到 Java ${required || ''}，请在菜单 8 → 1 自动安装，或手动配置 server.java`);
    }

    /**
     * 检测 Minecraft 版本（从核心文件名或配置）
     */
    _detectMinecraftVersion() {
        const configVersion = this.config.getConfig('server.version');
        if (configVersion) return configVersion;

        try {
            const jarFile = this._getServerJar();
            const match = jarFile.match(/(\d+\.\d+(?:\.\d+)?)/);
            return match ? match[1] : '1.20.1';
        } catch (e) {
            return '1.20.1';
        }
    }

    /**
     * 构建启动命令
     */
    async _buildCommand(memory, extraJvmArgs) {
        const javaPath = await this._getJavaExecutable();
        const jarFile = this._getServerJar();

        // V3.6.2（607 指令）：JVM 参数统一走 jvm_args 模块。
        // 新结构 server.jvm.{template, override_args}；旧 server.jvm_args 不再读取。
        const template = this.config.getConfig('server.jvm.template', Jvm.DEFAULT_TEMPLATE);
        const override = this.config.getConfig('server.jvm.override_args', []);
        const heap = (memory && String(memory).trim())
            || this.config.getConfig('server.memory')
            || '2G';
        const authConfig = this.config.getConfig('auth', {});
        const authEnable = !!(authConfig && authConfig.enable === true);

        const built = Jvm.buildJvmArgs({
            template,
            override,
            heap,
            // 607 P4-1：外置登录开启时，用户手填的 -javaagent 一律剥离，wow 独家托管
            filterJavaagent: authEnable
        });
        let jvmArgs = built.args;
        if (built.removed.length) {
            console.log(`🧹 已移除冲突/禁用参数: ${built.removed.join(' ')}`);
        }
        if (built.injected.length) {
            console.log(`🛟 custom 模板缺少 -Xmx，已自动注入: ${built.injected.join(' ')}`);
        }
        built.warnings.forEach(w => console.warn(`⚠️ ${w}`));

        // 显式 memory 参数（CLI --memory / 面板）优先级最高：替换/补齐 -Xmx / -Xms
        if (memory) {
            const mo = Jvm.applyMemoryOverride(jvmArgs, heap);
            jvmArgs = mo.args;
        }

        // 外置登录 (authlib-injector)：由 wow 独家注入（用户手填的 agent 已在上面剥离）
        if (authEnable) {
            if (!this.authlibJar) {
                await this._ensureAuthlibJar();
            }
            if (this.authlibJar) {
                const authServer = authConfig.server || 'https://authlib-injector.yushi.moe';
                const agentArg = `-javaagent:${this.authlibJar}=${authServer}`;
                jvmArgs.push(agentArg);
                console.log(`🔐 已添加 authlib-injector (server: ${authServer})`);
            } else {
                console.warn('⚠️ authlib-injector 未就绪，外置登录将不生效');
            }
        }

        // CLI 附加参数（607 P0-1：同样禁止 split(" ")，走引号感知解析）
        if (extraJvmArgs) {
            jvmArgs.push(...Jvm.parseArgs(extraJvmArgs));
        }

        // 现代 Forge / NeoForge：核心生成在 libraries/ 子目录，且必须用 @unix_args.txt 提供完整
        // classpath / 模块参数启动，无法用 java -jar <jar>。若存在 server.launchArgsFile，则走该模式。
        const serverDir = this.serverDir;
        const launchArgsFile = this.config.getConfig('server.launchArgsFile');
        if (launchArgsFile && fs.existsSync(path.join(serverDir, launchArgsFile))) {
            const userJvm = path.join(serverDir, 'user_jvm_args.txt');
            const prefix = fs.existsSync(userJvm)
                ? ['@' + path.relative(serverDir, userJvm)]
                : [];
            return {
                javaPath,
                jvmArgs,
                jarFile,
                fullCommand: [javaPath, ...jvmArgs, ...prefix, '@' + launchArgsFile, 'nogui']
            };
        }

        return {
            javaPath,
            jvmArgs,
            jarFile,
            fullCommand: [javaPath, ...jvmArgs, '-jar', jarFile, 'nogui']
        };
    }

    /**
     * V3.5.25：开服前隔离客户端专用模组。
     *
     * 为什么不拦着不让启动：客户端模组留在 mods/ 里，最坏情况是服务端直接起不来，
     * 而报错通常指向「某个 mixin 注入失败」，用户根本看不出是装错了模组。
     * 这里把确定的客户端模组挪进 mods_client_disabled/，把「必然崩」变成「不崩」。
     *
     * 原则：
     *   1. 只移动不删除；
     *   2. 任何异常只警告，绝不阻断启动；
     *   3. 原版 / 纯插件端直接跳过（那里根本没有 mods/ 的加载器）。
     */
    _quarantineClientMods() {
        try {
            if (this.config.getConfig('mod.client_only.enabled', true) !== true) return;

            // 加载器来源：方案 scheme.yaml 的 loader 优先，回退到 server.type。
            let loader = '';
            const activeScheme = this.config.getConfig('server.scheme', null);
            if (activeScheme) {
                try {
                    const SchemeManager = require('./scheme_manager');
                    const meta = new SchemeManager()._loadSchemeMeta(activeScheme);
                    if (meta && meta.loader) loader = meta.loader;
                } catch (e) { /* 方案元数据读不到就退回 server.type */ }
            }
            if (!loader) loader = this.config.getConfig('server.type', '');

            const filter = require('./client_mod_filter');
            if (!filter.loaderSupportsMods(loader)) return;

            const modsDir = path.join(this.serverDir, 'mods');
            if (!fs.existsSync(modsDir)) return;

            const { map } = filter.buildClientModSet({
                extra: this.config.getConfig('mod.client_only.extra', []) || [],
                disableBuiltin: this.config.getConfig('mod.client_only.disable_builtin', false) === true
            });

            const result = filter.scanAndQuarantine({
                modsDir,
                quarantineDir: path.join(this.serverDir, filter.QUARANTINE_DIRNAME),
                clientSet: map,
                log: (level, msg) => {
                    if (level === 'warn') console.warn(`⚠️ ${msg}`);
                    else console.log(`   ${msg}`);
                }
            });

            if (result.movedCount > 0) {
                for (const line of filter.formatSummary(result)) console.log(line);
                try {
                    logger.warn(
                        `启动前隔离客户端专用模组 ${result.movedCount} 个: ` +
                        result.quarantined.map(q => q.file).join(', ')
                    );
                } catch (e) {}
            }
            for (const err of result.errors) {
                console.warn(`⚠️ 检查模组 ${err.file} 失败（已跳过）: ${err.reason}`);
            }
        } catch (e) {
            // 隔离是「锦上添花」，任何意外都不该阻断启动
            console.warn(`⚠️ 客户端模组隔离检查失败（不影响启动）: ${e.message}`);
        }
    }

    /**
     * 启动服务器
     */
    async start(memory = null, extraJvmArgs = '') {
        if (this.isRunning()) {
            console.log('服务器已在运行中');
            logger.info('启动服务器：服务器已在运行中');
            return false;
        }

        // V3.4.x：若激活了方案，确保方案已补齐为完整实例（FULL）再直接在其目录内启动。
        // 因为现在服务器直接在方案目录运行（不再复制到 server/），minimal/partial 方案
        // 缺少核心/模组文件，必须先 materialize 才能启动。
        const activeScheme = this.config.getConfig('server.scheme', null);
        if (activeScheme) {
            // V3.5.13：方案目录不存在时后续步骤必然失败（getServerDir 已回退到 scheme 根目录），
            // 立刻中止并明确说明原因，避免把「目录不存在」误报成「核心丢失」。
            if (this._reportMissingSchemeDir(activeScheme)) return false;
            try {
                const SchemeManager = require('./scheme_manager');
                const sm = new SchemeManager();
                const meta = sm._loadSchemeMeta(activeScheme);
                if (meta && meta.state && meta.state !== 'full') {
                    console.log(`🔧 方案 ${activeScheme} 尚未补齐，正在从 pool 复制资源...`);
                    await sm._materializeScheme(activeScheme);
                }
            } catch (e) {
                console.warn(`⚠️ 方案补齐检查失败（将尝试直接启动）: ${e.message}`);
            }
        }

        fs.ensureDirSync(this.serverDir);
        fs.ensureDirSync(path.join(this.serverDir, 'logs'));

        // V3.5.25：开服前隔离客户端专用模组（钠 / Iris 之类）。
        // 放在核心检查之前、EULA 之后：此时方案目录已确定且已补齐，
        // 若隔离出问题也只是警告 —— 隔离逻辑绝不能成为「服务器起不来」的新理由。
        this._quarantineClientMods();

        // 自动同意 EULA
        const eulaFile = path.join(this.serverDir, 'eula.txt');
        if (!fs.existsSync(eulaFile) || !fs.readFileSync(eulaFile, 'utf8').includes('eula=true')) {
            fs.writeFileSync(eulaFile, '# Auto-generated by wow~\n# By changing the setting below to TRUE you are indicating your agreement to the EULA (https://aka.ms/MinecraftEULA).\neula=true\n', 'utf8');
            console.log('📝 已自动同意 Minecraft EULA');
        }

        try {
            this._getServerJar();
        } catch (e) {
            // V3.5.2 起核心安装统一走 scheme create，不再存在 install <类型> <版本> 命令
            const activeScheme = this.config.getConfig('server.scheme', null);
            // V3.5.13：兜底——正常流程已在补齐检查前拦下「方案目录不存在」，此处仅在异常路径下复用同一诊断。
            if (activeScheme && this._reportMissingSchemeDir(activeScheme)) return false;
            console.error('未找到服务器核心（.jar）');
            if (activeScheme) {
                console.error(`当前方案「${activeScheme}」目录内没有可运行的核心`);
                console.error(`目录: ${this.serverDir}`);
                console.error(`方案可能未补齐，可尝试: scheme switch ${activeScheme}`);
            } else {
                console.error('当前未激活任何方案');
                console.error('请先创建并切换方案: scheme create <名称> --type <类型> --version <MC版本>');
                console.error('例如: scheme create myserver --type vanilla --version 1.20.1');
            }
            logger.erro(`启动服务器失败：未找到服务器核心文件（方案=${activeScheme || '无'}，目录=${this.serverDir}）`);
            return false;
        }

        const cmd = await this._buildCommand(memory, extraJvmArgs);

        // V3.6.2（607 指令 P1-1）：80% 物理内存红线。
        // 在 spawn 之前拦截，防止服务器起来后被系统 OOM 杀掉（表现为「服务器突然消失」）。
        const memCheck = Jvm.checkMemLimit(cmd.jvmArgs, require('os').totalmem());
        if (!memCheck.ok) {
            console.error('');
            console.error(`\x1b[31m${memCheck.message}\x1b[39m`);
            console.error('');
            logger.erro(`启动服务器被拦截：-Xmx ${memCheck.xmxText} 超过物理内存（${memCheck.totalText}）的 80% 红线`);
            return false;
        }

        console.log(`启动命令: ${cmd.fullCommand.join(' ')}`);

        const isInteractive = Boolean(process.stdin.isTTY);
        let logStream = null;

        if (isInteractive) {
            // 交互模式：wow 接管终端输入——拦截 wow 指令，其余转发给 MC 服务端控制台
            this.process = spawn(cmd.javaPath, cmd.fullCommand.slice(1), {
                cwd: this.serverDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false
            });

            // 写入独立的 stdout 存档（不写 latest.log，避免与 MC 的 log4j 双写）
            logStream = fs.createWriteStream(this.stdoutLogFile, { flags: 'w' });
            // V3.4.0：服务端输出始终落盘，但只有停留在 Minecraft 控制台时才回显到终端，
            // 否则切到 wow / 陶瓦控制台后会被服务端日志刷屏，切换就失去意义。
            this.process.stdout.on('data', (data) => {
                // 回显条件：停在 Minecraft 视图 **且** 终端画面没被 TUI 占用。
                // 后者兜住「菜单已经画出来、`_mode` 却没切走」的情况——
                // 那种时候日志会从菜单底下顶出来，把七页界面冲乱。
                if (this._mode === 'mc' && !tuiOwnsScreen()) process.stdout.write(data);
                logStream.write(data);
                this._logMcChunk(data);
            });
            this.process.stderr.on('data', (data) => {
                if (this._mode === 'mc' && !tuiOwnsScreen()) process.stderr.write(data);
                logStream.write(data);
                this._logMcChunk(data);
            });

            // 接管 stdin：readline 读取用户输入，按当前控制台视图路由
            const rl = this._createConsoleRl();
            this._mode = 'mc';
            this._printConsoleIntro();

            // V3.6.3：路由逻辑抽到 _bindConsoleLine，_backToConsole() 重建 rl 时
            // 复用同一份判定（:wow 进菜单 / :wowlog 看日志 / 三视图切换 / 指令分发）。
            this._bindConsoleLine(rl);


            // 捕获 Ctrl+C，优先向服务器发送 stop 命令优雅关闭
            this._sigintHandler = () => {
                console.log('\n⏹ 收到中断信号，正在停止服务器...');
                this.stop();
            };
            process.once('SIGINT', this._sigintHandler);
        } else {
            // 非交互模式（Web 面板 / Docker）：
            // **不能**把 stdio 直接设成 logStream——那样 Node 会把
            // `child.stdout` / `child.stderr` 置为 null，下面两个 `.on()`
            // 立刻抛 TypeError，`_writePid()` 根本走不到。
            // 结果就是：面板里服务器明明在跑，却永远显示「已停止」，
            // 仪表盘 CPU / 内存 / 时长全是 0。
            // 改成 pipe + 自己往文件写：流拿得到（错误扫描照常），落盘也不丢。
            logStream = fs.createWriteStream(this.stdoutLogFile, { flags: 'w' });
            this.process = spawn(cmd.javaPath, cmd.fullCommand.slice(1), {
                cwd: this.serverDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false
            });
            this.process.stdout.on('data', (data) => {
                logStream.write(data);
                this._logMcChunk(data);
            });
            this.process.stderr.on('data', (data) => {
                logStream.write(data);
                this._logMcChunk(data);
            });
        }

        this._writePid(this.process.pid);
        console.log(`服务器已启动，PID: ${this.process.pid}`);
        console.log(`日志文件: ${this.logFile}`);
        logger.impt(`服务器已启动 | PID ${this.process.pid} | 核心 ${cmd.jarFile} | 内存 ${memory}`);

        // V3.5.19：拉起 Web 控制台指令中继（交互 / 非交互模式都需要，Web 面板才知道该把指令交给谁）
        this._startConsoleRelay();

        // V3.3.0 联机 / 内网穿透（陶瓦 Terracotta）：若开启 auto_room，服务器启动后自动开房
        if (config.getConfig('lan.auto_room', false)) {
            const Terracotta = require('./terracotta');
            // 非阻塞：稍等 MC 服务端绑定端口，再由陶瓦扫描并开房
            setTimeout(() => {
                Terracotta.autoHost().catch(e => console.warn(`[lan] 自动开房失败: ${e.message}`));
            }, 4000);
        }

        this.process.on('exit', (code) => {
            if (this._sigintHandler) {
                process.removeListener('SIGINT', this._sigintHandler);
                this._sigintHandler = null;
            }
            if (this._rl) {
                try { this._rl.close(); } catch (e) {}
                this._rl = null;
            }
            this._stopLanWatch();
            // V3.5.19：进程没了，中继与心跳一并收掉，避免面板误判「还能发指令」
            this._stopConsoleRelay();
            if (logStream) logStream.end();
            if (code && code !== 0) {
                logger.erro(`Minecraft 进程异常退出（退出码 ${code}），疑似崩溃`);
                logger.markCrash();
                // V3.5.18：异常退出时做本地初级诊断（纯本地正则 + 模组扫描，不联网）。
                // 放在 logStream.end() 之后调用，但诊断器自己读 latest.log，
                // 该文件由 MC 自身写出、与 logStream（wow-stdout）无关，不受影响。
                this._diagnoseCrash(code);
            } else {
                console.log(`服务器进程退出，退出码: ${code}`);
                logger.info('Minecraft 进程已正常退出');
            }
            this._removePid();
            this.process = null;
        });

        this.process.on('error', (err) => {
            console.error(`进程错误: ${err.message}`);
            logger.erro(`Minecraft 进程启动/运行错误: ${err.message}`);
            logger.markCrash();
        });

        // 交互模式：保持前台运行，直到服务器进程退出（可实时查看日志并输入指令）
        if (isInteractive) {
            await new Promise((resolve) => {
                this.process.on('exit', resolve);
            });
        }

        // 真把进程拉起来过：交互模式走完 exit，非交互模式进程仍在后台跑。
        // 与上面 5 处「没启动就返回 false」一起构成调用方可判定的契约——
        // M 模式的 `1` 靠它区分「服务端跑完退出了」和「压根没起来」，
        // 后者 stdin 没人接管，TUI 必须先收回键盘（否则终端停在行模式、
        // 按什么键都只是回显）。
        return true;
    }

    /**
     * V3.5.18：异常退出时的本地初级诊断。
     * ------------------------------------------------------------
     * 设计约束：
     *   1. 绝不抛错——诊断器自身失败不能影响进程退出与 PID 清理；
     *   2. 不同步阻塞——读日志 + 扫描在毫秒级，但仍有 IO，放到下一个 tick，
     *      确保 exit 回调里的清理（_removePid 等）先完成；
     *   3. 只在异常退出时调用，正常退出不打扰。
     *
     * @param {number|string} code 退出码
     */
    _diagnoseCrash(code) {
        const run = () => {
            try {
                const scanner = require('./error_scanner');
                const result = scanner.diagnoseOnCrash({
                    exitCode: code,
                    logFile: this.logFile
                });
                if (result && result.ok) {
                    logger.erro(`本地诊断：${result.summary}`);
                    // 把诊断结论写进事件日志，便于事后复盘
                    for (const f of result.findings) {
                        logger.erro(`  发现 ${f.type} | 模组=${f.mod || '未知'} | ${f.rawLine.slice(0, 160)}`);
                    }
                }
            } catch (e) {
                // 诊断是锦上添花，失败就静默跳过
                try { logger.erro(`本地诊断失败（已忽略）: ${e.message}`); } catch (_) {}
            }
        };
        // 放到下一个 tick，避免与 exit 回调内的清理竞争
        setTimeout(run, 0);
    }

    /**
     * V3.5.19：启动「Web 控制台指令中继」。
     * 每 250ms 刷新一次心跳文件，并取走 .console.queue 里待执行的 MC 指令写入 stdin。
     * 只有持有 MC stdin 的进程才需要跑这个中继，因此由 start() 负责拉起。
     */
    _startConsoleRelay() {
        this._stopConsoleRelay();

        const tick = () => {
            try {
                // 心跳：让 Web 面板知道「有人在收指令」
                fs.writeFileSync(CONSOLE_ALIVE_FILE, String(Date.now()), 'utf8');
                if (!this.process || !this.process.stdin || !this.process.stdin.writable) return;
                if (!fs.existsSync(CONSOLE_QUEUE_FILE)) return;

                let raw = '';
                try {
                    raw = fs.readFileSync(CONSOLE_QUEUE_FILE, 'utf8');
                } catch (e) {
                    return;
                }
                // 先删再写：即使写入 stdin 抛错，也不会把同一条指令反复投递
                try { fs.unlinkSync(CONSOLE_QUEUE_FILE); } catch (e) { return; }

                for (const line of raw.split(/\r?\n/)) {
                    const t = line.trim();
                    if (!t) continue;
                    try {
                        this.process.stdin.write(t + '\n');
                        logger.info(`Web 控制台指令已转发给 MC: ${t}`);
                    } catch (e) {
                        // MC 正在退出 / 管道已关闭，丢弃即可
                    }
                }
            } catch (e) {
                // 中继失败绝不影响服务端本身
            }
        };

        this._consoleRelayTimer = setInterval(tick, CONSOLE_RELAY_INTERVAL);
        // 不让中继单独吊住事件循环（服务端进程退出后本进程应能正常结束）
        if (this._consoleRelayTimer.unref) this._consoleRelayTimer.unref();
        tick();
    }

    /** V3.5.19：停止中继并清掉心跳文件 */
    _stopConsoleRelay() {
        if (this._consoleRelayTimer) {
            clearInterval(this._consoleRelayTimer);
            this._consoleRelayTimer = null;
        }
        try {
            if (fs.existsSync(CONSOLE_ALIVE_FILE)) fs.unlinkSync(CONSOLE_ALIVE_FILE);
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 向服务器发送命令（支持跨进程）
     */
    sendCommand(command) {
        if (!this.isRunning()) {
            console.log('服务器未运行');
            return false;
        }

        // 同进程：直接通过 stdin 写入
        if (this.process && this.process.stdin && this.process.stdin.writable) {
            this.process.stdin.write(command + '\n');
            return true;
        }

        // 跨进程：通过 PID 文件找到进程并发送命令
        const pid = this._readPid();
        if (pid && this._isProcessAlive(pid)) {
            const os = utils.getOS();
            if (os === 'linux') {
                // Linux: 通过 /proc/{pid}/fd/0 写入 stdin
                try {
                    const stdinPath = `/proc/${pid}/fd/0`;
                    if (fs.existsSync(stdinPath)) {
                        fs.appendFileSync(stdinPath, command + '\n');
                        return true;
                    }
                } catch (e) {
                    // 尝试通过 /proc 写入失败
                }
            }
            // Windows 或其他：无法跨进程发送命令
            console.warn('⚠️ 跨进程模式：无法向服务器 stdin 发送 stop 命令');
            console.warn('   将自动发送 SIGTERM 信号，由 Minecraft 优雅保存并退出（在同一终端会话中启动服务器可直接执行 stop 命令）');
            return false;
        }

        return false;
    }

    /**
     * 正常停止服务器
     * - 优先发送 "stop" 命令到 stdin
     * - 跨进程时使用 SIGTERM（Minecraft 服务器会正常保存退出）
     * - 超时后降级为 SIGKILL
     */
    async stop(timeout = 30000) {
        // V3.3.0 关闭联机房间（陶瓦），与服务器停止同步
        _stopLanIfRunning();

        if (!this.isRunning()) {
            console.log('服务器未运行');
            logger.info('停止服务器：服务器未运行');
            return;
        }

        const pid = this._readPid();

        // 优先尝试通过 stdin 发送 stop 命令
        console.log('正在停止服务器...');
        logger.impt('正在停止服务器（发送 stop 指令）...');
        const sent = this.sendCommand('stop');
        if (sent) {
            console.log('已发送 stop 命令，等待服务器保存并退出...');
            const startTime = Date.now();
            while (this.isRunning() && (Date.now() - startTime) < timeout) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (this.isRunning()) {
                console.warn('服务器未在超时时间内退出，使用强制终止');
                this.kill();
            } else {
                console.log('✅ 服务器已正常停止');
            }
            return;
        }

        // 跨进程：无法通过 stdin，使用 SIGTERM（Minecraft 会优雅退出）
        if (pid && this._isProcessAlive(pid)) {
            console.log('跨进程模式：发送 SIGTERM 信号...');
            try {
                process.kill(pid, 'SIGTERM');
                console.log('等待服务器保存并退出...');

                const startTime = Date.now();
                while (this._isProcessAlive(pid) && (Date.now() - startTime) < timeout) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                if (this._isProcessAlive(pid)) {
                    console.warn('服务器未响应 SIGTERM，使用强制终止');
                    process.kill(pid, 'SIGKILL');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (!this._isProcessAlive(pid)) {
                    this._removePid();
                    console.log('✅ 服务器已停止');
                }
            } catch (e) {
                console.warn('进程已不存在');
                this._removePid();
            }
        }
    }

    /**
     * 强制终止服务器
     */
    kill() {
        // V3.3.0 关闭联机房间（陶瓦）
        _stopLanIfRunning();

        const pid = this._readPid();
        if (!pid) {
            console.log('未找到 PID 文件，服务器可能未运行');
            return;
        }

        if (!this._isProcessAlive(pid)) {
            console.log('进程已不存在，清理 PID 文件');
            this._removePid();
            return;
        }

        try {
            if (utils.getOS() === 'windows') {
                const result = exec(`taskkill /F /PID ${pid}`, { timeout: 5000 });
                if (result.stderr && !result.stderr.includes('SUCCESS')) {
                    console.error(`强制终止失败: ${result.stderr}`);
                    logger.erro(`强制终止服务器失败: ${result.stderr}`);
                    return;
                }
            } else {
                process.kill(pid, 'SIGKILL');
            }
            console.log(`已强制终止进程 ${pid}`);
            logger.warn(`已强制终止服务器进程 ${pid}`);
            this._removePid();
        } catch (e) {
            console.error(`强制终止失败: ${e.message}`);
            logger.erro(`强制终止服务器失败: ${e.message}`);
        }
    }

    /**
     * 重启服务器
     */
    async restart(memory, extraJvmArgs) {
        console.log('正在停止服务器...');
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('正在启动服务器...');
        await this.start(memory, extraJvmArgs);
    }

    /**
     * 获取服务器状态
     */
    status() {
        const running = this.isRunning();
        const pid = this._readPid();

        console.log(`服务器状态: ${running ? '运行中' : '已停止'}`);
        if (running && pid) {
            console.log(`  PID: ${pid}`);
            console.log(`  日志: ${this.logFile}`);
            try {
                if (fs.existsSync(this.logFile)) {
                    const content = fs.readFileSync(this.logFile, 'utf8');
                    const lines = content.split('\n').slice(-50);
                    const playerLines = lines.filter(l => l.includes('joined') || l.includes('left'));
                    if (playerLines.length > 0) {
                        const last = playerLines[playerLines.length - 1];
                        console.log(`  最近玩家活动: ${last.trim()}`);
                    }
                }
            } catch (e) {}
        } else if (pid && !running) {
            console.log(`  残留 PID 文件: ${pid} (进程已不存在)`);
        }

        return { running, pid };
    }

    /**
     * 获取当前服务器配置摘要
     */
    getInfo() {
        const running = this.isRunning();
        const pid = this._readPid();
        let jarFile = '未找到';
        try {
            jarFile = this._getServerJar();
        } catch (e) {}
        return {
            running,
            pid,
            serverDir: this.serverDir,
            jarFile,
            logFile: this.logFile
        };
    }
}

/**
 * V3.3.0 模块级辅助：若陶瓦联机房间正在运行，则关闭它（服务器停止/强杀时同步清理）
 */
function _stopLanIfRunning() {
    try {
        const Terracotta = require('./terracotta');
        if (Terracotta.isRunning()) {
            Terracotta.stopHost().catch(e => console.warn(`[lan] 关房失败: ${e.message}`));
        }
    } catch (e) {
        // 忽略
    }
}

/**
 * V3.5.19：是否有进程正在接收 Web 控制台指令。
 * 判据是心跳文件在 maxAgeMs 内被刷新过——比「PID 存在」更准确：
 * 服务端跑着但没人读 stdin 时，指令发过去只会石沉大海。
 * @param {number} [maxAgeMs]
 * @returns {boolean}
 */
function isConsoleRelayAlive(maxAgeMs = 3000) {
    try {
        if (!fs.existsSync(CONSOLE_ALIVE_FILE)) return false;
        const t = parseInt(fs.readFileSync(CONSOLE_ALIVE_FILE, 'utf8').trim(), 10);
        if (!Number.isFinite(t)) return false;
        return Date.now() - t <= maxAgeMs;
    } catch (e) {
        return false;
    }
}

/**
 * V3.5.19：把一条 MC 指令追加进中继队列（由持有 stdin 的进程取走执行）。
 * @param {string} line
 * @returns {boolean} 是否成功落盘
 */
function enqueueConsoleCommand(line) {
    try {
        const text = String(line == null ? '' : line).replace(/[\r\n]+/g, ' ').trim();
        if (!text) return false;
        fs.appendFileSync(CONSOLE_QUEUE_FILE, text + '\n', 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = ServerManager;
// V3.5.21：把开服控制台的输入分类器挂到导出上，供单测直接验证
// 「插件命令不会被当成 MC 指令转发」这一行为（它是模块内私有函数，原本无法从外部调用）。
ServerManager.classifyConsoleInput = classifyConsoleInput;
// V3.5.19：Web 面板需要判断中继是否在线、并往队列里投递指令
ServerManager.isConsoleRelayAlive = isConsoleRelayAlive;
ServerManager.enqueueConsoleCommand = enqueueConsoleCommand;
ServerManager.CONSOLE_QUEUE_FILE = CONSOLE_QUEUE_FILE;