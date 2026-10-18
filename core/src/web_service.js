/**
 * Web 服务模块
 * - 提供 HTTP 服务与 WebSocket 实时通信
 * - 将 Web 前端的操作转换为 CLI 命令执行
 * - 实时推送服务器日志到 Web 前端
 * - 支持自定义主题包
 */

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const crypto = require('crypto');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const config = require('./config');
const utils = require('./utils');
const ServerManager = require('./server');
const Terracotta = require('./terracotta');
// V3.5.0：事件日志
const { logger } = require('./log');
// V3.5.3：Web 端命令安全策略（拒绝清单）
const { isWebCommandAllowed } = require('./command_policy');

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
    // V3.5.3：优先使用环境变量，避免密钥明文落盘
    const envSecret = process.env.WOW_WEB_AUTH_TOKEN;
    if (envSecret) return envSecret;
    const configured = config.getConfig('web.auth_token');
    if (configured) return configured;
    // 自动生成并持久化
    const autoSecret = crypto.randomBytes(32).toString('hex');
    config.setConfig('web.auth_token', autoSecret);
    return autoSecret;
}

// V3.5.3：离线密码（不配 SMTP 时的替代登录）。存 scrypt 哈希，避免明文落盘。
const SCRYPT_PREFIX = 'scrypt$';
function hashPassword(plain) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(String(plain), salt, 64);
    return SCRYPT_PREFIX + salt.toString('hex') + '$' + derived.toString('hex');
}
function verifyPassword(plain, stored) {
    if (!stored || typeof stored !== 'string' || !stored.startsWith(SCRYPT_PREFIX)) return false;
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const derived = crypto.scryptSync(String(plain), salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
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
    try {
        // 白名单路径（无需认证）
        // 注：/api/download 允许通过 ?token= 认证（浏览器 window.open 无法带 Authorization 头），
        //     故在中间件层放行，由路由内部完成校验。
        const publicPaths = ['/api/auth/request-code', '/api/auth/login', '/api/auth/verify', '/api/download'];
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
    } catch (e) {
        // 防御：任何非预期异常都不应导致进程崩溃
        return res.status(500).json({ error: `认证处理异常: ${e.message}` });
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
    // V3.5.7：默认上限由 100kb 提升到 4mb，以支持「保存文本文件」接口（其自身限 2MB）。
    // 否则 2MB 的 PUT /api/files/content 会在 body 解析阶段就被拒（且抛未捕获异常）。
    app.use(express.json({ limit: '4mb' }));

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

        // V3.5.8：邮箱白名单（mail.whitelist）。不在名单内直接拒绝，且**不生成验证码**，
        // 避免把验证码塞进 verificationCodes 造成试探面。响应文案保持中性，
        // 不向请求方泄露「白名单存在但我把你拒了」之外的任何信息。
        try {
            const Mailer = require('./mailer');
            const wl = new Mailer();
            const verdict = wl.isEmailAllowed(email);
            if (!verdict.allowed) {
                logger.impt(`Web 登录被拒（邮箱不在白名单内）: ${email}`);
                return res.status(403).json({ success: false, error: '该邮箱无权登录，请联系管理员' });
            }
        } catch (e) {
            // 白名单读取异常不应阻断登录（保持可用性），但要留痕
            console.warn(`⚠️ 白名单校验异常，已按放行处理: ${e.message}`);
        }

        try {
            const code = generateAndSendCode(email);
            const Mailer = require('./mailer');
            const mailer = new Mailer();
            if (mailer.isConfigured()) {
                res.json({ success: true, message: '验证码已发送到您的邮箱' });
            } else {
                // V3.5.3：生产环境严禁回显验证码（避免登录绕过）
                const devMode = config.getConfig('web.dev_mode', false) === true ||
                    process.env.NODE_ENV === 'development';
                if (devMode) {
                    // 仅开发模式：在控制台输出并随响应返回，方便本地调试
                    console.log(`\n📧 [开发模式] 验证码 -> ${email}: ${code}\n`);
                    res.json({ success: true, message: '验证码已生成（SMTP 未配置，开发模式）', devCode: code });
                } else {
                    // 生产环境未配 SMTP：不回显验证码，提示配置 SMTP 或离线密码
                    res.status(403).json({
                        success: false,
                        error: '请先在终端配置 SMTP 或设置离线密码（web.auth_password）后再登录'
                    });
                }
            }
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 验证码登录
     */
    /**
     * 签发 JWT（验证码登录与离线密码登录共用）
     */
    function issueToken(res, email) {
        const secret = getJwtSecret();
        const sessionTimeout = config.getConfig('web.session_timeout', 86400);
        const token = jwt.sign(
            { email: String(email || 'admin@local').toLowerCase(), iat: Math.floor(Date.now() / 1000) },
            secret,
            { expiresIn: sessionTimeout }
        );
        return res.json({ success: true, token });
    }

    app.post('/api/auth/login', (req, res) => {
        const { email, code, password } = req.body;

        // V3.5.8：邮箱白名单（mail.whitelist）——即便验证码已被拿到，
        // 名单外的邮箱也不得换取 token。这是 request-code 之外的第二道闸，
        // 防止「白名单是后配的，但此前已发出过验证码」这类时序漏洞。
        if (email) {
            try {
                const Mailer = require('./mailer');
                const verdict = new Mailer().isEmailAllowed(email);
                if (!verdict.allowed) {
                    logger.impt(`Web 登录被拒（登录阶段白名单校验）: ${email}`);
                    return res.status(403).json({ success: false, error: '该邮箱无权登录，请联系管理员' });
                }
            } catch (e) {
                console.warn(`⚠️ 登录阶段白名单校验异常，已按放行处理: ${e.message}`);
            }
        }

        // V3.5.3：离线密码登录（未配 SMTP 时的替代方式）
        let offlineHash = config.getConfig('web.auth_password', null);
        if (offlineHash) {
            // 首次使用若是明文，则哈希后持久化，避免明文落盘
            if (!offlineHash.startsWith(SCRYPT_PREFIX)) {
                offlineHash = hashPassword(offlineHash);
                config.setConfig('web.auth_password', offlineHash);
            }
            if (password) {
                if (verifyPassword(password, offlineHash)) {
                    logger.impt(`Web 离线密码登录成功: ${email || 'admin@local'}`);
                    return issueToken(res, email || 'admin@local');
                }
                return res.status(401).json({ success: false, error: '离线密码错误' });
            }
        }

        // 验证码登录
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

        verificationCodes.delete(email.toLowerCase());
        return issueToken(res, email);
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

        if (!command || command.trim().length === 0) {
            return res.status(400).json({ error: '命令不能为空' });
        }

        // V3.5.3：Web 端命令安全策略（拒绝清单）——拦截灾难性/不可逆操作
        const policy = isWebCommandAllowed(command);
        if (!policy.allowed) {
            logger.warn(`Web 指令被拒绝: ${command} | ${policy.reason}`);
            return res.status(403).json({ error: policy.reason });
        }

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

    // ===== 文件管理（V3.5.6）=====
    // 所有路径严格限制在服务器（方案）运行目录内，详见 file_manager.js

    /**
     * 列出目录内容
     * GET /api/files?path=<相对路径>
     */
    app.get('/api/files', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const result = await FileManager.listFiles(req.query.path || '');
            res.json({ success: true, path: result.path, root: FileManager.getRoot(), files: result.files });
        } catch (e) {
            const code = e.code === 'EPATH' ? 403 : (e.code === 'ENOENT' ? 404 : 400);
            res.status(code).json({ success: false, error: e.message });
        }
    });

    /**
     * 下载单个文件
     * GET /api/download?path=<相对路径>
     * 说明：浏览器 window.open 无法附带 Authorization 头，故同时接受 ?token= 查询参数。
     */
    app.get('/api/download', (req, res) => {
        // 允许通过 query token 认证（仅用于本接口的下载场景）
        if (!req.user && req.query.token) {
            try {
                const secret = getJwtSecret();
                req.user = jwt.verify(String(req.query.token), secret);
            } catch (e) {
                return res.status(401).json({ error: 'Token 无效或已过期' });
            }
        }
        if (!req.user) {
            return res.status(401).json({ error: '未登录' });
        }

        try {
            const FileManager = require('./file_manager');
            const info = FileManager.resolveDownload(req.query.path || '');
            // 文件名含非 ASCII 时用 RFC 5987 编码，避免部分浏览器乱码
            const asciiName = info.name.replace(/[^\x20-\x7e]/g, '_');
            res.setHeader('Content-Disposition',
                `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(info.name)}`);
            res.setHeader('Content-Length', info.size);
            res.setHeader('Content-Type', 'application/octet-stream');
            fs.createReadStream(info.abs).pipe(res);
        } catch (e) {
            const code = e.code === 'EPATH' ? 403 : (e.code === 'ENOENT' ? 404 : 400);
            res.status(code).json({ success: false, error: e.message });
        }
    });

    /**
     * 上传文件（multipart/form-data）
     * 表单字段：files[]（可多个，支持 webkitRelativePath 相对路径）、path（目标子目录）
     * 说明：不使用额外的 multipart 依赖，此处以二进制方式收集并按 multipart 规范解析。
     */
    app.post('/api/upload', (req, res) => {
        const contentType = req.headers['content-type'] || '';
        const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!m) {
            return res.status(400).json({ success: false, error: '请求必须为 multipart/form-data' });
        }
        const boundary = m[1] || m[2];

        const MAX_TOTAL = 512 * 1024 * 1024; // 单次上传总上限 512MB，防内存耗尽
        const chunks = [];
        let total = 0;
        let aborted = false;

        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_TOTAL) {
                aborted = true;
                res.status(413).json({ success: false, error: '上传内容过大（上限 512MB）' });
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', async () => {
            if (aborted) return;
            try {
                const buf = Buffer.concat(chunks);
                const parsed = parseMultipart(buf, boundary);
                const FileManager = require('./file_manager');
                const result = await FileManager.saveUploads(parsed.fields.path || '', parsed.files);
                res.json({ success: true, uploaded: result.uploaded, files: result.files, skipped: result.skipped });
            } catch (e) {
                const code = e.code === 'EPATH' ? 403 : 500;
                res.status(code).json({ success: false, error: e.message });
            }
        });

        req.on('error', (e) => {
            if (!aborted) res.status(500).json({ success: false, error: `上传中断: ${e.message}` });
        });
    });

    // ===== 文件操作（V3.5.7，纯 Node 跨平台；旧版走 shell 在 Windows 上不可用）=====

    /** 错误码 → HTTP 状态映射 */
    const fileErrStatus = (e) => ({
        EPATH: 403, ENOENT: 404, ENOTDIR: 400, EISDIR: 400,
        EEXIST: 409, ETOOBIG: 413, EBADZIP: 400
    }[e.code] || 500);

    /**
     * 新建文件夹
     * POST /api/files/mkdir  { path: 父目录, name: 新文件夹名 }
     */
    app.post('/api/files/mkdir', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { path: parentPath = '', name } = req.body || {};
            const r = await FileManager.makeDir(parentPath, name);
            logger.info(`Web 新建文件夹: ${r.path}`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 重命名
     * POST /api/files/rename  { path: 原路径, newName: 新名称 }
     */
    app.post('/api/files/rename', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { path: p, newName } = req.body || {};
            const r = await FileManager.renameEntry(p, newName);
            logger.info(`Web 重命名: ${r.from} → ${r.to}`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 移动
     * POST /api/files/move  { from: 源路径, to: 目标目录 }
     */
    app.post('/api/files/move', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { from, to } = req.body || {};
            const r = await FileManager.transferEntry(from, to, false);
            logger.info(`Web 移动: ${r.from} → ${r.to}`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 复制
     * POST /api/files/copy  { from: 源路径, to: 目标目录 }
     */
    app.post('/api/files/copy', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { from, to } = req.body || {};
            const r = await FileManager.transferEntry(from, to, true);
            logger.info(`Web 复制: ${r.from} → ${r.to}`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 删除（不可逆）
     * DELETE /api/files  { path: 路径 }
     * 前端必须已让用户二次确认。
     */
    app.delete('/api/files', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { path: p } = req.body || {};
            const r = await FileManager.removeEntry(p);
            logger.warn(`Web 删除${r.type === 'dir' ? '目录' : '文件'}: ${r.path}`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 压缩为 zip
     * POST /api/files/compress  { paths: [...], dest: "xxx.zip" }
     */
    app.post('/api/files/compress', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { paths = [], dest } = req.body || {};
            if (!Array.isArray(paths) || paths.length === 0) {
                return res.status(400).json({ success: false, error: '请至少选择一个要压缩的条目' });
            }
            const r = await FileManager.compress(paths, dest);
            logger.info(`Web 压缩: ${r.entries} 项 → ${r.path}`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 解压 zip
     * POST /api/files/extract  { path: zip 路径, dest: 目标目录 }
     */
    app.post('/api/files/extract', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { path: zipPath, dest = '' } = req.body || {};
            const r = await FileManager.extract(zipPath, dest);
            logger.info(`Web 解压: ${zipPath} → ${r.path}（${r.extracted} 项）`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 读取文本文件（预览 / 编辑）
     * GET /api/files/content?path=xxx
     */
    app.get('/api/files/content', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const r = await FileManager.readText(req.query.path || '');
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 保存文本文件
     * PUT /api/files/content  { path, content }
     */
    app.put('/api/files/content', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { path: p, content = '' } = req.body || {};
            const r = await FileManager.writeText(p, content);
            logger.info(`Web 保存文件: ${r.path}（${r.size} 字节）`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    // ===== 模组搜索与下载队列（V3.5.6）=====

    /**
     * 搜索模组
     * GET /api/mod/search?source=<modrinth|curseforge>&query=<关键词>&loader=<加载器>&version=<MC版本>
     */
    app.get('/api/mod/search', async (req, res) => {
        try {
            const ModSearch = require('./mod_search');
            const result = await ModSearch.search(
                req.query.source,
                req.query.query,
                req.query.loader,
                req.query.version
            );
            res.json({ success: true, source: result.source, results: result.results });
        } catch (e) {
            res.status(e.status || 502).json({ success: false, error: e.message });
        }
    });

    /**
     * 模组详情（含依赖列表）
     * GET /api/mod/info?source=<来源>&project=<项目 id 或 slug>
     */
    app.get('/api/mod/info', async (req, res) => {
        try {
            const ModSearch = require('./mod_search');
            const info = await ModSearch.getInfo(req.query.source, req.query.project);
            res.json({ success: true, ...info });
        } catch (e) {
            res.status(e.status || 502).json({ success: false, error: e.message });
        }
    });

    /**
     * 下载队列状态
     * GET /api/download/status        → 队列
     * DELETE /api/download/status     → 清理已完成任务
     */
    app.get('/api/download/status', (req, res) => {
        try {
            const Queue = require('./download_queue');
            res.json({ success: true, queue: Queue.list(), stats: Queue.stats() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.delete('/api/download/status', (req, res) => {
        try {
            const Queue = require('./download_queue');
            const removed = Queue.clearFinished();
            res.json({ success: true, removed });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // ===== 其余页面数据（V3.5.6）=====

    /**
     * Pool 资源共享统计
     * GET /api/pool/stats
     * 统计 pool/ 下各类资源的文件数，以及被方案引用的数量（同名文件出现在方案目录内视为已引用）。
     */
    app.get('/api/pool/stats', async (req, res) => {
        try {
            const poolDir = utils.resolvePath('pool');
            const schemeDir = utils.resolvePath('../scheme');

            // 收集方案目录内所有文件名（用于判定"被引用"）
            const schemeFiles = new Set();
            const collect = (dir, depth) => {
                if (depth > 6 || !fs.existsSync(dir)) return;
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const ent of entries) {
                    const full = path.join(dir, ent.name);
                    if (ent.isDirectory()) {
                        if (ent.name === 'logs' || ent.name === 'world' || ent.name === 'libraries') continue;
                        collect(full, depth + 1);
                    } else {
                        schemeFiles.add(ent.name);
                    }
                }
            };
            collect(schemeDir, 0);

            // 遍历 pool 下的资源文件
            const byType = {};
            let total = 0;
            let refs = 0;
            const walk = (dir, typeKey, depth) => {
                if (depth > 4 || !fs.existsSync(dir)) return;
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const ent of entries) {
                    const full = path.join(dir, ent.name);
                    if (ent.isDirectory()) {
                        walk(full, typeKey, depth + 1);
                    } else if (ent.name.endsWith('.jar') || ent.name.endsWith('.zip')) {
                        total++;
                        byType[typeKey] = (byType[typeKey] || 0) + 1;
                        if (schemeFiles.has(ent.name)) refs++;
                    }
                }
            };
            if (fs.existsSync(poolDir)) {
                for (const sub of fs.readdirSync(poolDir)) {
                    const full = path.join(poolDir, sub);
                    if (fs.statSync(full).isDirectory()) walk(full, sub, 0);
                }
            }

            // 统计去重后的文件大小
            let totalSize = 0;
            const seen = new Set();
            const sizeWalk = (dir, depth) => {
                if (depth > 4 || !fs.existsSync(dir)) return;
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const ent of entries) {
                    const full = path.join(dir, ent.name);
                    if (ent.isDirectory()) {
                        sizeWalk(full, depth + 1);
                    } else if (!seen.has(ent.name)) {
                        seen.add(ent.name);
                        try { totalSize += fs.statSync(full).size; } catch { /* 忽略 */ }
                    }
                }
            };
            if (fs.existsSync(poolDir)) sizeWalk(poolDir, 0);

            res.json({ success: true, total, refs, unique: total - refs, byType, totalSize, poolDir });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 插件列表
     * GET /api/plugins
     */
    app.get('/api/plugins', (req, res) => {
        try {
            const PluginManager = require('./plugin_manager');
            const pm = new PluginManager();
            const plugins = pm.list();
            res.json({ success: true, plugins });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 最近一次日志 AI 分析结果
     * GET /api/logs/analysis
     * 读 logs/ 下由 `logs analyze` 生成的最近报告；无报告时给出明确说明而非 404。
     */
    app.get('/api/logs/analysis', async (req, res) => {
        try {
            const reportDir = utils.resolvePath('../logs');
            if (!fs.existsSync(reportDir)) {
                return res.json({ success: true, result: '', message: '暂无分析报告，请先执行「日志分析」。' });
            }
            const reports = fs.readdirSync(reportDir)
                .filter(f => /^analysis[-_.]/i.test(f) || /\.analysis\.(json|md|txt)$/i.test(f))
                .map(f => {
                    const full = path.join(reportDir, f);
                    return { name: f, full, mtime: fs.statSync(full).mtimeMs };
                })
                .sort((a, b) => b.mtime - a.mtime);

            if (!reports.length) {
                return res.json({ success: true, result: '', message: '暂无分析报告，请先执行「日志分析」。' });
            }

            const latest = reports[0];
            if (latest.name.endsWith('.json')) {
                let parsed;
                try {
                    parsed = JSON.parse(fs.readFileSync(latest.full, 'utf8'));
                } catch (e) {
                    return res.json({ success: true, result: '', message: `报告 ${latest.name} 解析失败: ${e.message}` });
                }
                const text = parsed.result || parsed.analysis || parsed.summary || JSON.stringify(parsed, null, 2);
                return res.json({ success: true, result: text, file: latest.name });
            }
            res.json({ success: true, result: fs.readFileSync(latest.full, 'utf8'), file: latest.name });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 运行时指标（CPU / 内存 / 运行时长 / 在线人数）
     * GET /api/metrics
     */
    app.get('/api/metrics', async (req, res) => {
        try {
            const ServerManager = require('./server');
            const running = ServerManager.isRunning ? ServerManager.isRunning() : false;

            let cpu = '0%';
            let memory = '0 MB';
            let uptime = '0s';
            let players = 0;

            if (running) {
                const pid = ServerManager.getPid ? ServerManager.getPid() : null;
                if (pid) {
                    const m = readProcessMetrics(pid);
                    if (m) {
                        cpu = m.cpu;
                        memory = m.memory;
                        uptime = m.uptime;
                    }
                }
                // 在线人数：从最近日志中抓取
                players = await countOnlinePlayers();
            }

            res.json({ success: true, running, cpu, memory, uptime, players });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

// ===== 创建 HTTP 服务器 =====

    const server = http.createServer(app);

    // ===== WebSocket 支持 =====

    // 使用 socket.io 提供 WebSocket 支持
    // V3.5.3：CORS 默认仅同源；跨域部署时在 web.cors_origins 配置白名单
    const corsOrigins = config.getConfig('web.cors_origins', []) || [];
    const io = require('socket.io')(server, {
        cors: {
            origin: corsOrigins.length ? corsOrigins : false,
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

            // V3.5.3：与 /api/exec 共用同一套命令安全策略
            const policy = isWebCommandAllowed(command);
            if (!policy.allowed) {
                logger.warn(`WebSocket 指令被拒绝: ${command} | ${policy.reason}`);
                socket.emit('command_result', { command, success: false, error: policy.reason });
                return;
            }

            try {
                const result = await execCommand(command, args || []);
                socket.emit('command_result', { command, success: true, output: result });
            } catch (e) {
                socket.emit('command_result', { command, success: false, error: e.message });
            }
        });
    });

    // ===== 全局错误处理（必须最后注册）=====
    // V3.5.7：此前没有错误中间件，express 内部抛出的异常（如 body 超限的
    // PayloadTooLargeError）会直接打印堆栈并返回 HTML 错误页，前端拿不到 JSON。
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        // body 解析类错误映射为明确的状态码
        if (err && (err.type === 'entity.too.large' || err.status === 413)) {
            return res.status(413).json({ success: false, error: '请求体过大' });
        }
        if (err && err.type === 'entity.parse.failed') {
            return res.status(400).json({ success: false, error: '请求体不是合法 JSON' });
        }
        const status = (err && err.status) ? err.status : 500;
        try {
            logger.erro(`Web 请求异常 ${req.method} ${req.path}: ${err && err.message}`);
        } catch (e) { /* 日志失败不影响响应 */ }
        if (res.headersSent) return next(err);
        res.status(status).json({
            success: false,
            error: (err && err.message) ? err.message : '服务器内部错误'
        });
    });

    // ===== 启动服务器 =====

    server.listen(port, host, () => {
        isRunning = true;
        console.log(`Web 服务已启动: http://${host}:${port}`);
        console.log(`  主题: ${theme}`);
        console.log(`  静态目录: ${webDir}`);

        // V3.5.7：危险配置自检（仅提示，不阻断）
        try {
            const { auditDangerousConfig } = require('./command_policy');
            const warnings = auditDangerousConfig();
            if (warnings.length) {
                console.log('');
                console.log('  ⚠️  安全提示');
                for (const w of warnings) {
                    console.log(`     • ${w}`);
                }
                console.log('');
                logger.warn(`Web 危险配置自检: ${warnings.join(' | ')}`);
            }
        } catch (e) {
            // 自检失败不影响启动
        }

        logger.impt(`Web 管理面板已启动 | 地址 http://${host}:${port} | 主题 ${theme}`);

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
    logger.impt('正在停止 Web 管理面板...');

    // V3.5.7 修复：若 PID 文件记录的正是当前进程，说明服务与本调用者在同一进程，
    // 此时绝不能走「杀进程」分支 —— 否则 process.kill(self, 'SIGTERM') 会把自己终止，
    // 导致调用方（如测试脚本、CLI 内嵌调用）在 stopWeb() 处直接挂掉、后续代码全不执行。
    // 这是同进程内存模式的典型场景，应直接走方式 2。
    let pidIsSelf = false;
    if (fs.existsSync(WEB_PID_FILE)) {
        try {
            const pid = parseInt(fs.readFileSync(WEB_PID_FILE, 'utf8').trim(), 10);
            pidIsSelf = (pid === process.pid);
        } catch (e) { /* 读不到就当不是自己 */ }
    }

    // 方式 1：通过 PID 文件停止（跨进程兼容，仅当目标确实是别的进程）
    if (fs.existsSync(WEB_PID_FILE) && !pidIsSelf) {
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
    logger.info('查询 Web 管理面板状态：未运行');
    return { running: false };
}

/**
 * 执行命令（内部函数）
 * V3.5.0：Web 页面（/api/exec 与 WebSocket command）发起的指令统一在此落盘记录。
 */
function execCommand(command, args = []) {
    const argStr = (args && args.length) ? ' ' + args.join(' ') : '';
    const fullCmd = `wow ${command}${argStr}`.trim();
    logger.impt(`Web 页面执行指令: ${fullCmd}`);
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
                const out = output || '命令执行完成';
                logger.command(fullCmd, true, out.slice(0, 200));
                resolve(out);
            } else {
                const err = error || `命令执行失败，退出码: ${code}`;
                logger.command(fullCmd, false, err.slice(0, 200));
                reject(new Error(err));
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

/**
 * 读取进程运行指标（V3.5.6）
 * 数据源：/proc/<pid>/stat 与 /proc/<pid>/status，Windows 上不可用时返回 null。
 * @param {number|string} pid
 * @returns {{cpu:string, memory:string, uptime:string}|null}
 */
function readProcessMetrics(pid) {
    try {
        const statPath = `/proc/${pid}/stat`;
        const statusPath = `/proc/${pid}/status`;
        if (!fs.existsSync(statPath)) return null;

        const stat = fs.readFileSync(statPath, 'utf8');
        // 字段以空格分隔，第 2 项为进程名且可能含空格/括号，故从最后一个 ')' 之后开始切分
        const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        // afterName[0] = state，相对 stat 第 3 项
        const utime = parseInt(afterName[11], 10) || 0;  // 第 14 项
        const stime = parseInt(afterName[12], 10) || 0;  // 第 15 项

        // 内存：VmRSS
        let memory = '0 MB';
        let startTicks = null;
        if (fs.existsSync(statusPath)) {
            const status = fs.readFileSync(statusPath, 'utf8');
            const m = status.match(/VmRSS:\s*(\d+)\s*kB/i);
            if (m) memory = (parseInt(m[1], 10) / 1024).toFixed(1) + ' MB';
        }

        // 运行时长：以 /proc/<pid> 目录创建时间估算更稳妥，这里用 stat 的 starttime 字段
        startTicks = parseInt(afterName[19], 10) || null; // 第 22 项 starttime
        let uptime = '0s';
        if (startTicks) {
            const hz = 100; // 常见 USER_HZ，用作估算
            const bootTime = readBootTime();
            if (bootTime) {
                const startedAt = bootTime + startTicks / hz;
                uptime = formatDuration(Date.now() / 1000 - startedAt);
            }
        }

        // CPU 百分比需两次采样，这里给出累计 CPU 时间的相对占比（以进程生命周期为分母）
        let cpu = '0%';
        const totalTicks = utime + stime;
        if (startTicks) {
            const hz = 100;
            const runtimeSeconds = Math.max((Date.now() / 1000) - (readBootTime() + startTicks / hz), 0.001);
            const cpuSeconds = totalTicks / hz;
            cpu = Math.min((cpuSeconds / runtimeSeconds) * 100, 100 * os.cpus().length).toFixed(1) + '%';
        }

        return { cpu, memory, uptime };
    } catch (e) {
        return null;
    }
}

/** 读取系统启动时间（秒） */
function readBootTime() {
    try {
        const txt = fs.readFileSync('/proc/stat', 'utf8');
        const m = txt.match(/^btime\s+(\d+)/m);
        return m ? parseInt(m[1], 10) : null;
    } catch (e) {
        return null;
    }
}

/** 秒 → 人类可读时长 */
function formatDuration(seconds) {
    const s = Math.max(Math.floor(seconds), 0);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

/**
 * 从服务器最近日志中统计在线人数（V3.5.6）
 * 匹配 Minecraft 日志中的 "There are N of a max" / "N/M players" 等常见格式。
 */
async function countOnlinePlayers() {
    try {
        const logPath = path.join(utils.getServerDir(), 'logs', 'latest.log');
        if (!logPath || !fs.existsSync(logPath)) return 0;

        const MAX_READ = 256 * 1024; // 只读尾部 256KB
        const stat = fs.statSync(logPath);
        const start = Math.max(stat.size - MAX_READ, 0);
        const fd = fs.openSync(logPath, 'r');
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);

        const text = buf.toString('utf8');
        const patterns = [
            /There are (\d+) of a max/i,
            /online players?:\s*(\d+)/i,
            /players online:\s*(\d+)/i
        ];
        for (const re of patterns) {
            const all = text.match(new RegExp(re.source, 'gi'));
            if (all && all.length) {
                const last = all[all.length - 1].match(re);
                if (last && last[1] !== undefined) return parseInt(last[1], 10);
            }
        }
        return 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 解析 multipart/form-data 请求体（V3.5.6）
 * 仅依赖 Node 原生 Buffer，避免引入 multer 等额外依赖。
 * @param {Buffer} buf 完整请求体
 * @param {string} boundary 分隔串
 * @returns {{fields:Object, files:Array<{name:string, rel:string, buffer:Buffer}>}}
 */
function parseMultipart(buf, boundary) {
    const fields = {};
    const files = [];
    const delimiter = Buffer.from(`--${boundary}`);

    // 按分隔串切分各部分
    const parts = [];
    let start = buf.indexOf(delimiter);
    while (start !== -1) {
        const next = buf.indexOf(delimiter, start + delimiter.length);
        if (next === -1) {
            parts.push(buf.slice(start + delimiter.length));
            break;
        }
        parts.push(buf.slice(start + delimiter.length, next));
        start = next;
    }

    for (let part of parts) {
        // 去掉每段首尾的 CRLF
        if (part.length >= 2 && part[0] === 0x0d && part[1] === 0x0a) part = part.slice(2);
        if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
            part = part.slice(0, part.length - 2);
        }
        if (part.length === 0) continue;

        // 头与体以 \r\n\r\n 分隔
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const headerText = part.slice(0, headerEnd).toString('utf8');
        const body = part.slice(headerEnd + 4);

        const disposition = headerText.match(/content-disposition:[^\r\n]*/i);
        if (!disposition) continue;
        const nameMatch = disposition[0].match(/name="([^"]*)"/i);
        const fileMatch = disposition[0].match(/filename="([^"]*)"/i);
        const fieldName = nameMatch ? nameMatch[1] : null;
        if (!fieldName) continue;

        if (fileMatch) {
            // 文件字段：filename 可能是 webkitRelativePath（含子目录）
            const rawName = fileMatch[1];
            const cleanName = rawName.replace(/\\/g, '/').split('/').pop() || rawName;
            // 保留完整相对路径（目录层级交由 file_manager 再次净化）
            files.push({
                name: cleanName,
                rel: rawName,
                buffer: body
            });
        } else {
            fields[fieldName] = body.toString('utf8').trim();
        }
    }

    return { fields, files };
}

module.exports = {
    startWeb,
    stopWeb,
    webStatus,
    isRunning: () => isRunning
};