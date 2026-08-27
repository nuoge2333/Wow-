/**
 * Web 服务模块
 * - 提供 HTTP 服务与 WebSocket 实时通信
 * - 将 Web 前端的操作转换为 CLI 命令执行
 * - 实时推送服务器日志到 Web 前端
 * - 支持自定义主题包
 */

const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const config = require('./config');
const utils = require('./utils');
const ServerManager = require('./server');
const Terracotta = require('./terracotta');

// 用于存储 WebSocket 客户端连接
let wsClients = [];
let httpServer = null;
let wsServer = null;
let ioServer = null;
let isRunning = false;
let logTailProcess = null;

// PID 文件路径（跨进程状态持久化）
const WEB_PID_FILE = path.join(__dirname, '../.web.pid');
const WEB_PORT_FILE = path.join(__dirname, '../.web.port');

// ==================== 认证相关 ====================

// 内存中的验证码存储: { email: { code, expires } }
const verificationCodes = new Map();

// JWT 密钥
function getJwtSecret() {
    const configured = config.getConfig('web.auth_token');
    if (configured) return configured;
    // 自动生成并持久化
    const autoSecret = crypto.randomBytes(32).toString('hex');
    config.setConfig('web.auth_token', autoSecret);
    return autoSecret;
}

/**
 * 生成验证码并发送
 */
function generateAndSendCode(email) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    verificationCodes.set(email.toLowerCase(), {
        code,
        expires: Date.now() + 5 * 60 * 1000 // 5分钟有效
    });

    // 清理过期验证码
    for (const [k, v] of verificationCodes) {
        if (Date.now() > v.expires) verificationCodes.delete(k);
    }

    // 如果配置了 SMTP，发送邮件
    const Mailer = require('./mailer');
    const mailer = new Mailer();
    if (mailer.isConfigured()) {
        mailer.sendVerificationCode(email, code).catch(e => {
            console.warn(`发送验证码邮件失败: ${e.message}`);
        });
    } else {
        // SMTP 未配置时，在控制台输出验证码（开发模式）
        console.log(`[auth] 验证码已生成 -> ${email}: ${code}`);
    }

    return code;
}

/**
 * JWT 认证中间件
 */
function authMiddleware(req, res, next) {
    // 白名单路径（无需认证）
    const publicPaths = ['/api/auth/request-code', '/api/auth/login', '/api/auth/verify'];
    if (publicPaths.includes(req.path)) {
        return next();
    }
    // 静态文件放行
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未登录' });
    }

    const token = authHeader.substring(7);
    try {
        const secret = getJwtSecret();
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token 无效或已过期' });
    }
}

/**
 * 启动 Web 服务
 */
function startWeb(options = {}) {
    const port = options.port || config.getConfig('web.port', 8080);
    const host = options.host || config.getConfig('web.host', '127.0.0.1');
    const theme = config.getConfig('web.theme', 'default');

    // 如果已启动，先停止
    if (isRunning) {
        console.log('Web 服务已在运行中');
        return;
    }

    // 确保主题已应用
    const webDir = utils.resolvePath('../web');
    const themeDir = utils.resolvePath(`../themes/${theme}`);
    
    // 如果 web 目录不存在，从主题复制
    if (!fs.existsSync(webDir)) {
        const sourceTheme = fs.existsSync(themeDir) ? themeDir : utils.resolvePath('../themes/default');
        if (fs.existsSync(sourceTheme)) {
            fs.ensureDirSync(webDir);
            fs.copySync(sourceTheme, webDir);
        } else {
            // 创建最小默认页面（极端后备）
            fs.ensureDirSync(webDir);
            fs.writeFileSync(path.join(webDir, 'index.html'), `
<!DOCTYPE html>
<html>
<head><title>wow Minecraft Server</title></head>
<body>
<h1>wow Minecraft Server</h1>
<p>Web 服务已启动，但未找到主题包。</p>
<p>请安装主题包: wow theme install &lt;主题包.zip&gt;</p>
</body>
</html>
            `);
        }
    }

    // 创建 HTTP 服务
    const app = require('express')();
    const express = require('express');
    const http = require('http');

    // 静态文件服务（主题）
    app.use(express.static(webDir));

    // 解析 JSON 请求体
    app.use(express.json());

    // 认证中间件（保护 /api/* 路由）
    app.use(authMiddleware);

    // ===== 认证 API =====

    /**
     * 请求验证码
     */
    app.post('/api/auth/request-code', (req, res) => {
        const { email } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, error: '请输入有效的邮箱地址' });
        }

        try {
            const code = generateAndSendCode(email);
            const Mailer = require('./mailer');
            const mailer = new Mailer();
            if (mailer.isConfigured()) {
                res.json({ success: true, message: '验证码已发送到您的邮箱' });
            } else {
                // SMTP 未配置，在控制台输出（开发模式），仍返回成功
                console.log(`\n📧 [开发模式] 验证码 -> ${email}: ${code}\n`);
                res.json({ success: true, message: '验证码已生成（SMTP 未配置，请查看控制台）', devCode: code });
            }
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 验证码登录
     */
    app.post('/api/auth/login', (req, res) => {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, error: '缺少邮箱或验证码' });
        }

        const stored = verificationCodes.get(email.toLowerCase());
        if (!stored) {
            return res.status(401).json({ success: false, error: '请先获取验证码' });
        }

        if (Date.now() > stored.expires) {
            verificationCodes.delete(email.toLowerCase());
            return res.status(401).json({ success: false, error: '验证码已过期，请重新获取' });
        }

        if (stored.code !== code.trim()) {
            return res.status(401).json({ success: false, error: '验证码错误' });
        }

        // 验证通过，生成 JWT
        verificationCodes.delete(email.toLowerCase());
        const secret = getJwtSecret();
        const sessionTimeout = config.getConfig('web.session_timeout', 86400);
        const token = jwt.sign(
            { email: email.toLowerCase(), iat: Math.floor(Date.now() / 1000) },
            secret,
            { expiresIn: sessionTimeout }
        );

        res.json({ success: true, token });
    });

    /**
     * 验证 token 是否有效
     */
    app.get('/api/auth/verify', (req, res) => {
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.json({ valid: false });
        }

        try {
            const secret = getJwtSecret();
            const decoded = jwt.verify(authHeader.substring(7), secret);
            res.json({ valid: true, email: decoded.email });
        } catch (e) {
            res.json({ valid: false });
        }
    });

    // ===== API 路由 =====

    /**
     * 执行 CLI 命令（将 Web 操作转为命令执行）
     */
    app.post('/api/exec', async (req, res) => {
        const { command, args = [] } = req.body;

        if (!command) {
            return res.status(400).json({ error: '缺少 command 字段' });
        }

        // 只检查命令是否为空，不限制具体命令
        if (!command || command.trim().length === 0) {
            return res.status(400).json({ error: '命令不能为空' });
        }
        // 安全检查：只阻止明显的系统命令（如 rm -rf /），但这类命令在 wow CLI 中本身就不存在

        try {
            // 执行命令
            const result = await execCommand(command, args);
            res.json({ success: true, output: result });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 获取服务器状态
     */
    app.get('/api/status', (req, res) => {
        const server = new ServerManager();
        const info = server.getInfo();
        res.json({
            running: info.running,
            pid: info.pid,
            serverDir: info.serverDir,
            jarFile: info.jarFile
        });
    });

    /**
     * 获取配置
     */
    app.get('/api/config/:key?', (req, res) => {
        const key = req.params.key;
        if (key) {
            const value = config.getConfig(key);
            res.json({ key, value });
        } else {
            res.json(config.getFullConfig());
        }
    });

    /**
     * 更新配置
     */
    app.post('/api/config', (req, res) => {
        const { key, value } = req.body;
        if (!key) {
            return res.status(400).json({ error: '缺少 key' });
        }
        config.setConfig(key, value);
        res.json({ success: true, key, value });
    });

    /**
     * 获取服务器日志（最近 N 行）
     */
    app.get('/api/logs', (req, res) => {
        const lines = parseInt(req.query.lines) || 50;
        const server = new ServerManager();
        const logFile = server.logFile;

        if (!fs.existsSync(logFile)) {
            return res.json({ logs: [], message: '日志文件不存在' });
        }

        try {
            const content = fs.readFileSync(logFile, 'utf8');
            const logLines = content.split('\n').filter(l => l.trim());
            const lastLines = logLines.slice(-lines);
            res.json({ logs: lastLines, total: logLines.length });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * 获取已安装模组列表
     */
    app.get('/api/mods', (req, res) => {
        const ModManager = require('./mod_manager');
        const modManager = new ModManager();
        const mods = modManager.listMods();
        res.json({ mods });
    });

    /**
     * 获取方案列表
     */
    app.get('/api/schemes', (req, res) => {
        const SchemeManager = require('./scheme_manager');
        const schemeManager = new SchemeManager();
        const schemes = schemeManager.list();
        res.json({ schemes, current: schemeManager.currentScheme });
    });

    /**
     * 获取主题列表
     */
    app.get('/api/themes', (req, res) => {
        const ThemeManager = require('./theme_manager');
        const themeManager = new ThemeManager();
        const themes = themeManager.list();
        res.json({ themes, current: config.getConfig('web.theme', 'default') });
    });

        /**
     * 联机 / 内网穿透（陶瓦 Terracotta）— V3.3.0
     */
    app.post('/api/lan/host', async (req, res) => {
        try {
            const roomCode = (req.body && req.body.roomCode) || config.getConfig('lan.room_code', '');
            const result = await Terracotta.hostRoom({ roomCode });
            res.json({ success: true, roomCode: result.roomCode, port: result.port, copyright: Terracotta.getCopyright() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/lan/stop', async (req, res) => {
        try {
            await Terracotta.stopHost();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/lan/status', async (req, res) => {
        try {
            const s = await Terracotta.getStatus();
            s.copyright = Terracotta.getCopyright();
            res.json(s);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

// ===== 创建 HTTP 服务器 =====

    const server = http.createServer(app);

    // ===== WebSocket 支持 =====

    // 使用 socket.io 提供 WebSocket 支持
    const io = require('socket.io')(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        console.log(`WebSocket 客户端已连接: ${socket.id}`);
        wsClients.push(socket);

        // 发送欢迎消息
        socket.emit('message', { type: 'info', content: '已连接到 wow Web 服务' });

        // 开始推送日志
        startLogTail(socket);

        socket.on('disconnect', () => {
            console.log(`WebSocket 客户端已断开: ${socket.id}`);
            wsClients = wsClients.filter(c => c.id !== socket.id);
            stopLogTail();
        });

        // 接收命令（前端直接发送命令）
        socket.on('command', async (data) => {
            const { command, args } = data;
            if (!command) return;

            try {
                const result = await execCommand(command, args || []);
                socket.emit('command_result', { command, success: true, output: result });
            } catch (e) {
                socket.emit('command_result', { command, success: false, error: e.message });
            }
        });
    });

    // ===== 启动服务器 =====

    server.listen(port, host, () => {
        isRunning = true;
        console.log(`Web 服务已启动: http://${host}:${port}`);
        console.log(`  主题: ${theme}`);
        console.log(`  静态目录: ${webDir}`);

        // 写��� PID 文件和端口文件（跨进程状态）
        try {
            fs.writeFileSync(WEB_PID_FILE, String(process.pid), 'utf8');
            fs.writeFileSync(WEB_PORT_FILE, String(port), 'utf8');
        } catch (e) {}
    });

    // 保存服务器实例以便停止
    httpServer = server;
    ioServer = io;

    // 自动打开浏览器（仅限本地访问）
    if (host === '127.0.0.1' || host === 'localhost') {
        try {
            const open = require('open');
            open(`http://${host}:${port}`);
        } catch (e) {
            // 忽略，有些环境没有 open 包
        }
    }

    return server;
}

/**
 * 停止 Web 服务
 * 支持跨进程：优先通过 PID 文件杀进程，兼容同进程内存模式
 */
function stopWeb() {
    // 方式 1：通过 PID 文件停止（跨进程兼容）
    if (fs.existsSync(WEB_PID_FILE)) {
        try {
            const pid = parseInt(fs.readFileSync(WEB_PID_FILE, 'utf8').trim());
            if (pid && pid > 0) {
                try {
                    process.kill(pid, 'SIGTERM');
                    console.log(`Web 服务已停止 (PID: ${pid})`);
                } catch (e) {
                    // 进程已不存在，清理文件
                    console.log('Web 服务进程已不存在，清理残留文件');
                }
            }
        } catch (e) {}
        // 清理文件
        try { fs.unlinkSync(WEB_PID_FILE); } catch (e) {}
        try { fs.unlinkSync(WEB_PORT_FILE); } catch (e) {}
        return;
    }

    // 方式 2：同进程内存模式（fallback）
    if (!isRunning || !httpServer) {
        console.log('Web 服务未运行');
        return;
    }

    // 停止日志推送
    stopLogTail();

    // 断开所有 WebSocket 连接
    if (ioServer) {
        for (const client of wsClients) {
            client.disconnect();
        }
        wsClients = [];
        ioServer.close();
        ioServer = null;
    }

    // 关闭 HTTP 服务器
    httpServer.close(() => {
        isRunning = false;
        httpServer = null;
        console.log('Web 服务已停止');
    });
}

/**
 * 获取 Web 服务状态（支持跨进程）
 */
function webStatus() {
    // 先检查 PID 文件
    if (fs.existsSync(WEB_PID_FILE)) {
        try {
            const pid = parseInt(fs.readFileSync(WEB_PID_FILE, 'utf8').trim());
            if (pid && pid > 0) {
                try {
                    process.kill(pid, 0); // 仅检测进程是否存在
                    const port = fs.existsSync(WEB_PORT_FILE) ?
                        fs.readFileSync(WEB_PORT_FILE, 'utf8').trim() :
                        config.getConfig('web.port', 8080);
                    const host = config.getConfig('web.host', '127.0.0.1');
                    console.log(`Web 服务运行中: http://${host}:${port} (PID: ${pid})`);
                    return { running: true, host, port, pid };
                } catch (e) {
                    // 进程不存在，清理文件
                    try { fs.unlinkSync(WEB_PID_FILE); } catch (e) {}
                    try { fs.unlinkSync(WEB_PORT_FILE); } catch (e) {}
                }
            }
        } catch (e) {}
    }

    // fallback: 同进程内存模式
    if (isRunning && httpServer) {
        const addr = httpServer.address();
        const port = addr ? addr.port : config.getConfig('web.port', 8080);
        const host = config.getConfig('web.host', '127.0.0.1');
        console.log(`Web 服务运行中: http://${host}:${port}`);
        console.log(`  已连接客户端: ${wsClients.length}`);
        return { running: true, host, port, clients: wsClients.length };
    }

    console.log('Web 服务未运行');
    return { running: false };
}

/**
 * 执行命令（内部函数）
 */
function execCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        const cmdParts = command.split(' ');
        const mainCmd = cmdParts[0];
        const subCmd = cmdParts.slice(1).join(' ');

        // 实际执行命令：调用 cli.js 的对应功能
        // 这里用子进程方式执行
        const cliPath = path.join(__dirname, 'cli.js');
        const fullArgs = [cliPath, mainCmd, ...subCmd.split(' '), ...args];

        const proc = spawn(process.execPath, fullArgs, {
            cwd: path.join(__dirname, '..')
        });

        let output = '';
        let error = '';

        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.stderr.on('data', (data) => {
            error += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(output || '命令执行完成');
            } else {
                reject(new Error(error || `命令执行失败，退出码: ${code}`));
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * 日志推送（WebSocket）
 */
let logTailTimer = null;
let logTailLastPos = 0;

function startLogTail(socket) {
    // 每个客户端单独推送日志
    const server = new ServerManager();
    const logFile = server.logFile;

    if (!fs.existsSync(logFile)) {
        socket.emit('message', { type: 'warning', content: '日志文件不存在' });
        return;
    }

    // 读取日志并推送
    let lastPos = 0;
    const pushLogs = () => {
        try {
            const stats = fs.statSync(logFile);
            if (stats.size > lastPos) {
                const fd = fs.openSync(logFile, 'r');
                const buffer = Buffer.alloc(stats.size - lastPos);
                fs.readSync(fd, buffer, 0, buffer.length, lastPos);
                fs.closeSync(fd);

                const content = buffer.toString('utf8');
                const lines = content.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    socket.emit('log', { line, timestamp: Date.now() });
                }
                lastPos = stats.size;
            }
        } catch (e) {
            // 忽略读取错误
        }
    };

    // 每 500ms 推送一次
    const timer = setInterval(pushLogs, 500);
    // 保存到 socket 对象以便清理
    socket._logTimer = timer;

    // 初始推送一次
    pushLogs();
}

function stopLogTail() {
    if (logTailTimer) {
        clearInterval(logTailTimer);
        logTailTimer = null;
    }
}

module.exports = {
    startWeb,
    stopWeb,
    webStatus,
    isRunning: () => isRunning
};