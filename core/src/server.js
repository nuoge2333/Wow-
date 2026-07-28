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
const utils = require('./utils');
const config = require('./config');
const JreManager = require('./jre_manager');
const axios = require('axios');

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

        const logFd = fs.openSync(this.logFile, 'a');
        const logStream = fs.createWriteStream('', { fd: logFd, autoClose: true });
        this.process = spawn(cmd.javaPath, cmd.fullCommand.slice(1), {
            cwd: this.serverDir,
            stdio: ['pipe', logStream, logStream],
            detached: false
        });

        this._writePid(this.process.pid);
        console.log(`服务器已启动，PID: ${this.process.pid}`);
        console.log(`日志文件: ${this.logFile}`);

        this.process.on('exit', (code) => {
            console.log(`服务器进程退出，退出码: ${code}`);
            this._removePid();
            this.process = null;
        });

        this.process.on('error', (err) => {
            console.error(`进程错误: ${err.message}`);
        });
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

module.exports = ServerManager;