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
    'plugin list', 'plugin info',
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
    'plugin install', 'plugin remove',
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

    // 交互菜单 M / m 在开服控制台中不可用
    if (tokens[0] === 'm' || tokens[0] === 'M') {
        return { action: 'deny', reason: '交互菜单(M)在开服控制台中不可用，请另开终端运行 wow m' };
    }

    const head = tokens[0].toLowerCase();
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

/**
 * 以子进程方式执行一条 wow 指令，输出直接继承当前终端。
 * 子进程退出后返回，不阻塞 MC 服务端（MC 是独立进程）。
 */
function runWowSubcommand(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
            stdio: ['ignore', 'inherit', 'inherit'],
            windowsHide: true
        });
        child.on('error', reject);
        child.on('exit', code => {
            if (code && code !== 0) console.warn(`[wow] 子命令退出码: ${code}`);
            resolve();
        });
    });
}

class ServerManager {
    constructor() {
        this.serverDir = utils.getServerDir();
        this.pidFile = path.join(this.serverDir, 'server.pid');
        this.logFile = path.join(this.serverDir, 'logs', 'latest.log');
        this.process = null;
        this.jreManager = new JreManager();
        this.config = config;
        this.authlibJar = null;
        this._ensureAuthlibJar();
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
     * 获取服务器核心文件
     */
    _getServerJar() {
        const serverDir = this.serverDir;
        // 优先使用安装器写入的 server.jar 配置（Fabric/Quilt 安装后会同时存在原版 server.jar，
        // 必须以启动器jar为准，否则会误选原版核心）
        const cfgJar = this.config.getConfig('server.jar');
        if (cfgJar && fs.existsSync(path.join(serverDir, cfgJar))) {
            return cfgJar;
        }
        const files = fs.readdirSync(serverDir);
        const jarFiles = files.filter(f => f.endsWith('.jar') && !f.includes('authlib-injector'));
        if (jarFiles.length === 0) {
            throw new Error('未找到服务器核心文件 (.jar)');
        }
        if (jarFiles.length > 1) {
            const serverJar = jarFiles.find(f => f.toLowerCase().includes('server'));
            if (serverJar) return serverJar;
        }
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

        const systemJava = utils.detectJava();
        if (systemJava) {
            return systemJava;
        }

        throw new Error('未找到 Java，请安装 Java 或配置 server.java');
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

        // 默认 JVM 参数
        let jvmArgs = this.config.getConfig('server.jvm_args', ['-Xmx2G', '-Xms2G', '-XX:+UseG1GC']);
        if (Array.isArray(jvmArgs)) {
            jvmArgs = [...jvmArgs];
        } else {
            jvmArgs = ['-Xmx2G', '-Xms2G', '-XX:+UseG1GC'];
        }

        // 覆盖内存参数
        if (memory) {
            const memoryArg = memory.match(/^\d+[gG]$/) ? `-Xmx${memory}` : `-Xmx${memory}`;
            jvmArgs = jvmArgs.map(arg => {
                if (arg.startsWith('-Xmx')) return memoryArg;
                if (arg.startsWith('-Xms')) return `-Xms${memory}`;
                return arg;
            });
            if (!jvmArgs.some(a => a.startsWith('-Xmx'))) {
                jvmArgs.push(memoryArg);
                jvmArgs.push(`-Xms${memory}`);
            }
        }

        // 外置登录 (authlib-injector)
        const authConfig = this.config.getConfig('auth', {});
        if (authConfig.enable) {
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

        // 额外参数
        if (extraJvmArgs) {
            jvmArgs.push(extraJvmArgs);
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
     * 启动服务器
     */
    async start(memory = '2G', extraJvmArgs = '') {
        if (this.isRunning()) {
            console.log('服务器已在运行中');
            return;
        }

        fs.ensureDirSync(this.serverDir);
        fs.ensureDirSync(path.join(this.serverDir, 'logs'));

        // 自动同意 EULA
        const eulaFile = path.join(this.serverDir, 'eula.txt');
        if (!fs.existsSync(eulaFile) || !fs.readFileSync(eulaFile, 'utf8').includes('eula=true')) {
            fs.writeFileSync(eulaFile, '# Auto-generated by wow~\n# By changing the setting below to TRUE you are indicating your agreement to the EULA (https://aka.ms/MinecraftEULA).\neula=true\n', 'utf8');
            console.log('📝 已自动同意 Minecraft EULA');
        }

        try {
            this._getServerJar();
        } catch (e) {
            console.error('未找到服务器核心，请先用 install 命令安装');
            console.error('wow install <类型> <版本>');
            return;
        }

        const cmd = await this._buildCommand(memory, extraJvmArgs);
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

            logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
            this.process.stdout.on('data', (data) => {
                process.stdout.write(data);
                logStream.write(data);
            });
            this.process.stderr.on('data', (data) => {
                process.stderr.write(data);
                logStream.write(data);
            });

            // 接管 stdin：readline 读取用户输入，区分 wow 指令与 MC 指令
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
            this._rl = rl;
            console.log('💡 开服控制台：直接输入 MC 指令（如 /stop、op Steve）；也可直接输入 wow 指令（如 lan host、server status）。');
            console.log('   ⛔ 会修改运行中的方案文件的危险指令与交互菜单(M)已禁用，需用时请另开终端。');

            rl.on('line', async (raw) => {
                const line = (raw || '').trim();
                if (!line) return;
                const d = classifyConsoleInput(line);
                if (d.action === 'mc') {
                    if (this.process && this.process.stdin && this.process.stdin.writable) {
                        this.process.stdin.write(line + '\n');
                    }
                } else if (d.action === 'run') {
                    rl.pause();
                    try {
                        await runWowSubcommand(d.args);
                    } catch (e) {
                        console.error(`[wow] 指令执行失败: ${e.message}`);
                    }
                    if (!rl.closed) rl.resume();
                } else {
                    console.log(`⛔ ${d.reason}`);
                }
            });
            rl.on('SIGINT', () => {
                if (this.isRunning()) {
                    console.log('\n⏹ 收到中断信号，正在停止服务器...');
                    this.stop();
                }
            });

            // 捕获 Ctrl+C，优先向服务器发送 stop 命令优雅关闭
            this._sigintHandler = () => {
                console.log('\n⏹ 收到中断信号，正在停止服务器...');
                this.stop();
            };
            process.once('SIGINT', this._sigintHandler);
        } else {
            // 非交互模式（Web 面板 / Docker）：重定向到日志文件
            const logFd = fs.openSync(this.logFile, 'a');
            logStream = fs.createWriteStream('', { fd: logFd, autoClose: true });
            this.process = spawn(cmd.javaPath, cmd.fullCommand.slice(1), {
                cwd: this.serverDir,
                stdio: ['pipe', logStream, logStream],
                detached: false
            });
        }

        this._writePid(this.process.pid);
        console.log(`服务器已启动，PID: ${this.process.pid}`);
        console.log(`日志文件: ${this.logFile}`);

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
            if (logStream) logStream.end();
            console.log(`服务器进程退出，退出码: ${code}`);
            this._removePid();
            this.process = null;
        });

        this.process.on('error', (err) => {
            console.error(`进程错误: ${err.message}`);
        });

        // 交互模式：保持前台运行，直到服务器进程退出（可实时查看日志并输入指令）
        if (isInteractive) {
            await new Promise((resolve) => {
                this.process.on('exit', resolve);
            });
        }
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
            return;
        }

        const pid = this._readPid();

        // 优先尝试通过 stdin 发送 stop 命令
        console.log('正在停止服务器...');
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
                    return;
                }
            } else {
                process.kill(pid, 'SIGKILL');
            }
            console.log(`已强制终止进程 ${pid}`);
            this._removePid();
        } catch (e) {
            console.error(`强制终止失败: ${e.message}`);
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

module.exports = ServerManager;