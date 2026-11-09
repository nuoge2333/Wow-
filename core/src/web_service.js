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
// V3.5.19：Web 端耗时指令的异步任务执行器
const WebTask = require('./web_task');
// V3.5.0：事件日志
const { logger } = require('./log');
// V3.5.3：Web 端命令安全策略（拒绝清单）
const { isWebCommandAllowed } = require('./command_policy');
// 便签聊天室存储（右侧栏便签墙的读写与持久化）
const WebNotes = require('./web_notes');
// 实例配置（server.properties）读写
const ServerProps = require('./server_props');

// 用于存储 WebSocket 客户端连接
let wsClients = [];
let httpServer = null;
let wsServer = null;
let ioServer = null;
let isRunning = false;
let logTailProcess = null;
// V3.5.16：Cloudflare Tunnel 句柄（用于 stopWeb 时一并关闭）
let tunnelHandle = null;

// PID 文件路径（跨进程状态持久化）
const WEB_PID_FILE = path.join(__dirname, '../.web.pid');
const WEB_PORT_FILE = path.join(__dirname, '../.web.port');

// ==================== 认证相关 ====================

// 内存中的验证码存储: { email: { code, expires } }
const verificationCodes = new Map();

/**
 * V3.5.16：判断当前绑定地址是否把面板暴露到本机之外
 * 127.0.0.1 / ::1 / localhost 之外的任何绑定（含 0.0.0.0、局域网 IP）都算对外暴露。
 */
function isExposedHost(host) {
    const h = String(host || '').trim().toLowerCase();
    if (!h) return false;
    if (h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]') return false;
    return true;
}

/**
 * V3.5.24：公网隧道的前置闸门——「隧道等于暴露，必须配 token」。
 *
 * 为什么单列一条而不复用 isExposedHost：
 *   两者管的是不同维度。isExposedHost 看的是**绑定地址**（0.0.0.0 / 局域网 IP）；
 *   而隧道的场景恰恰相反——面板往往老老实实绑在 127.0.0.1，只监听回环，
 *   isExposedHost 返回 false，但这个「本地面板」马上会被 cloudflared 映射到
 *   https://xxx.trycloudflare.com，成为任何人都能访问的公网服务。
 *   也就是说：**只查绑定地址会漏掉隧道这条路径**，那才是最危险的一种暴露——
 *   用户以为自己只开了本地，实际已经挂在公网上。
 *
 * 判断依据与 isExposedHost 分支保持一致：web.auth_token 或 web.auth_password
 * 任一非空即视为已配置凭据（两者都能通过登录校验）。
 *
 * @param {object} [options]
 * @param {boolean} [options.quiet] 不打印，只返回结果（供测试 / 预检用）
 * @returns {{ok: boolean, token: string, password: string}}
 */
function checkTunnelAuth(options = {}) {
    const token = config.getConfig('web.auth_token', null);
    const password = config.getConfig('web.auth_password', null);
    const hasToken = !!(token && String(token).trim());
    const hasPassword = !!(password && String(password).trim());
    const ok = hasToken || hasPassword;

    if (ok || options.quiet) {
        return { ok, token, password };
    }

    console.error('');
    console.error('❌ 拒绝建立隧道：公网隧道等于对外暴露，必须先配置认证凭据！');
    console.error('');
    console.error('   隧道会把本地面板映射成 https://xxx.trycloudflare.com，');
    console.error('   任何人拿到这个地址都能访问——等同于把面板挂到公网上。');
    console.error('   但 wow.yaml 里 web.auth_token 与 web.auth_password 都为空。');
    console.error('');
    console.error('   任选一种方式补齐后再试：');
    console.error('     wow config set web.auth_token  一串足够长的随机字符');
    console.error('     wow config set web.auth_password 你的密码    # 离线密码登录');
    console.error('');
    return { ok: false, token, password };
}

/** 给隧道闸门用的标准错误文案（throw 场景） */
const TUNNEL_AUTH_ERR =
    '公网隧道等于对外暴露，必须先配置认证凭据（web.auth_token 或 web.auth_password）。' +
    '请执行 `wow config set web.auth_token <随机字符>` 后重试。';

// ==================== Web ↔ CLI 回显（V3.5.19）====================

/**
 * 清洗一条指令文本。
 *
 * Web 控制台最常见的「Unknown command」有两个来源：
 *   1. 复制粘贴带进来的 \r\n、零宽字符；
 *   2. 手抖敲出连续空格，被拆成 ['scheme','','pull','x']，第一个参数变成空串。
 * 这里统一把控制字符压成空格、把连续空白压成单空格、再去首尾空白，
 * 后续按空白拆分就不可能再拆出空参数。
 *
 * @param {*} input
 * @returns {string}
 */
function sanitizeCommandText(input) {
    if (input === null || input === undefined) return '';
    let s = String(input);
    s = s.replace(/[\u0000-\u001f\u007f]/g, ' ');   // 控制字符（含 \r \n \t \0）
    s = s.replace(/[\u200b-\u200f\ufeff]/g, '');    // 零宽空格 / BOM
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

/** 默认回显出口：没接 REPL 时直接打到 stdout */
let echoSink = (line) => {
    try { console.log(line); } catch (e) { /* 忽略 */ }
};

/**
 * 替换回显出口。`wow web start` 进入长命令模式后会把它接到 readline，
 * 避免回显把正在输入的提示符顶乱。
 * @param {(line:string)=>void} fn
 */
function setEchoSink(fn) {
    echoSink = typeof fn === 'function' ? fn : (line) => {
        try { console.log(line); } catch (e) { /* 忽略 */ }
    };
}

/** 广播一条控制台消息给所有已连接的 Web 客户端 */
function broadcastConsole(line, kind = 'system') {
    for (const client of wsClients) {
        try {
            client.emit('console', { line, kind, timestamp: Date.now() });
        } catch (e) { /* 单个客户端异常不影响其它 */ }
    }
}

/**
 * 在 wow 事件日志 + Web 控制台 + 终端同时打印 `[WebCLI] ...`。
 * 这是「Web 操作 = 代理发 CLI 指令」这条最高原则的可见化落点。
 */
function webCliEcho(text) {
    const line = `[WebCLI] ${text}`;
    try { logger.impt(line); } catch (e) { /* 日志失败不影响主流程 */ }
    broadcastConsole(line, 'webcli');
    try { echoSink(line); } catch (e) { /* 忽略 */ }
}

/**
 * 文件操作等「系统级动作」的回显，格式贴近用户熟悉的 shell 命令。
 * 注意：这里只打印、不执行——真正的落盘由 file_manager 用 fs API 完成。
 */
function systemEcho(text) {
    const line = `[System] ${text}`;
    try { logger.info(line); } catch (e) { /* 忽略 */ }
    broadcastConsole(line, 'system');
    try { echoSink(line); } catch (e) { /* 忽略 */ }
}

/** 文件操作回显时补上「在哪个方案里做的」，跨方案浏览时不至于看懵 */
function schemeSuffix(scheme) {
    return scheme ? `  @${scheme}` : '';
}

/**
 * 把嵌套配置对象压成「点号键 → 值」（V3.5.19）
 * 设置页的「原始 JSON」模式提交的是整份 wow.yaml，这里转成扁平键后
 * 再交给 config_schema 做白名单校验。
 */
function flattenConfigPatch(obj, prefix = '', out = {}) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    for (const [k, v] of Object.entries(obj)) {
        if (prefix === '' && (k === 'patch' || k === 'key' || k === 'value')) continue;
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            flattenConfigPatch(v, key, out);
        } else {
            out[key] = v;
        }
    }
    return out;
}

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

    // V3.5.16：--public / --host 0.0.0.0 显式对外暴露
    // 优先级：显式 --host > --public（等价 0.0.0.0）> 配置 web.host > 默认回环
    let host = options.host;
    if (!host && options.public) host = '0.0.0.0';
    if (!host) host = config.getConfig('web.host', '127.0.0.1');
    host = String(host).trim() || '127.0.0.1';

    const theme = config.getConfig('web.theme', 'default');

    // 如果已启动，先停止
    if (isRunning) {
        console.log('Web 服务已在运行中');
        return;
    }

    // ===== V3.5.16 安全闸门 =====
    // 对外暴露 + web.auth_token 为空 => 强制拒绝启动。
    // 没有签名密钥时，JWT 校验形同虚设，暴露到公网等同于把服务器控制权交出去。
    if (isExposedHost(host)) {
        const authToken = config.getConfig('web.auth_token', null);
        const hasToken = !!(authToken && String(authToken).trim());

        if (!hasToken) {
            console.error('');
            console.error('❌ 拒绝启动：暴露公网必须设置 auth_token 或管理员密码！');
            console.error('');
            console.error(`   当前绑定地址: ${host}${host === '0.0.0.0' ? '（所有网卡，等于对外暴露）' : '（非回环地址，可被外部访问）'}`);
            console.error('   但 wow.yaml 里 web.auth_token 为空。');
            console.error('');
            console.error('   任选一种方式补齐后再启动：');
            console.error('     wow config set web.auth_token  一串足够长的随机字符');
            console.error('     wow config set web.auth_password 你的密码    # 离线密码登录');
            console.error('');
            console.error('   若只想本机访问，去掉 --public / --host 参数即可（默认 127.0.0.1）。');
            console.error('');
            logger.warn(`Web 启动被拒绝：绑定 ${host} 但未配置 web.auth_token`);
            return;
        }
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

    // ===== 方案同步端点（V3.5.25，继承 JWT 认证） =====
    require('./sync_server').registerSyncRoutes(app);

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
     * 便签聊天室（右侧栏）
     * - GET  /api/notes：拉取便签墙（旧在前、新在后）
     * - POST /api/notes：发言（以 JWT 中的登录邮箱为发言人），并通过
     *   socket.io 广播 'note' 事件让所有在线面板实时刷新
     */
    app.get('/api/notes', (req, res) => {
        res.json({ success: true, notes: WebNotes.listNotes() });
    });

    app.post('/api/notes', (req, res) => {
        const email = (req.user && req.user.email) || 'admin@local';
        const note = WebNotes.addNote({
            email,
            content: req.body && req.body.content
        });
        if (!note) {
            return res.status(400).json({ success: false, error: '便签内容不能为空' });
        }
        // 实时广播：所有已连接的 socket.io 客户端（右侧便签栏）立即收到
        try {
            if (ioServer) ioServer.emit('note', note);
        } catch (e) { /* 广播失败不影响落库 */ }
        logger.impt(`Web 便签: ${note.email} (${note.content.length} 字)`);
        res.json({ success: true, note });
    });

    /**
     * 取 query/body 里的单值参数
     *
     * 前端若把同名参数拼了两遍（历史上 file.html 的 withScheme 就重复包裹过一次），
     * Express 会解析成**数组** `['a','a']`，`String(['a','a'])` 得到 `"a,a"`，
     * 拿去查方案名必然找不到，于是 /api/files 直接 404。
     * 这里统一「取第一个非空值」，拼重复了也不会垮。
     */
    const pickParam = (v) => {
        if (Array.isArray(v)) {
            for (const x of v) {
                const s = pickParam(x);
                if (s) return s;
            }
            return '';
        }
        if (v == null) return '';
        return String(v).trim();
    };

    // ===== 资源管理 / 实例配置（V3.6.2 新增页面）=====

    /**
     * 列出「当前方案 + 共享池」的模组 / 插件 / 核心。
     *
     * GET /api/resources?scheme=<name>
     *   scheme 省略 = 当前激活方案。
     *
     * 方案侧读 mods/ 与 mods-disabled/ 两个目录：clone-client 把客户端模组
     * 禁用后放进 mods-disabled/，而 CLI 的 disable 用 DISABLED_ 前缀，
     * 两种历史写法都要能在页面上看到并启用。
     */
    app.get('/api/resources', (req, res) => {
        try {
            const SchemeManager = require('./scheme_manager');
            const sm = new SchemeManager();
            const wanted = pickParam(req.query.scheme);
            const name = wanted || sm.currentScheme || '';
            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: '当前没有激活方案，请先在「方案管理」中切换方案'
                });
            }
            if (!sm._schemeExists(name)) {
                return res.status(404).json({ success: false, error: `方案「${name}」不存在` });
            }
            const schemePath = sm._getSchemePath(name);
            const meta = sm._loadSchemeMeta(name);

            const readFiles = (dir) => {
                const out = [];
                if (!fs.existsSync(dir)) return out;
                let names = [];
                try { names = fs.readdirSync(dir); } catch (e) { return out; }
                for (const file of names.sort()) {
                    const p = path.join(dir, file);
                    let st;
                    try { st = fs.statSync(p); } catch (e) { continue; }
                    if (!st.isFile()) continue;
                    if (!/\.(jar|zip)$/i.test(file)) continue;
                    out.push({ name: file, size: st.size, mtime: st.mtimeMs });
                }
                return out;
            };

            const modsDir = path.join(schemePath, 'mods');
            const disabledDir = path.join(schemePath, 'mods-disabled');
            const pluginsDir = path.join(schemePath, 'plugins');

            const mods = readFiles(modsDir).map(f => ({
                ...f,
                enabled: !/^DISABLED_/i.test(f.name),
                location: 'mods'
            }));
            for (const f of readFiles(disabledDir)) {
                mods.push({ ...f, enabled: false, location: 'mods-disabled' });
            }
            const plugins = readFiles(pluginsDir).map(f => ({
                ...f,
                enabled: !/^DISABLED_/i.test(f.name),
                location: 'plugins'
            }));

            // 共享池
            const poolDir = utils.getPoolPath();
            const poolByLoader = (root) => {
                const out = [];
                if (!fs.existsSync(root)) return out;
                let loaders = [];
                try { loaders = fs.readdirSync(root); } catch (e) { return out; }
                for (const loader of loaders) {
                    const ldir = path.join(root, loader);
                    let lst;
                    try { lst = fs.statSync(ldir); } catch (e) { continue; }
                    if (!lst.isDirectory()) continue;
                    // 插件池的布局是 plugins/<loader>/*.jar（没有版本层）
                    for (const f of readFiles(ldir)) {
                        out.push({ ...f, loader, version: '' });
                    }
                    // 模组池的布局是 mods/<loader>/<version>/*.jar
                    let versions = [];
                    try { versions = fs.readdirSync(ldir); } catch (e) { continue; }
                    for (const version of versions) {
                        const vdir = path.join(ldir, version);
                        let vst;
                        try { vst = fs.statSync(vdir); } catch (e) { continue; }
                        if (!vst.isDirectory()) continue;
                        for (const f of readFiles(vdir)) {
                            out.push({ ...f, loader, version });
                        }
                    }
                }
                return out;
            };

            const cores = [];
            const coresDir = path.join(poolDir, 'cores');
            const walkCores = (dir, type, version, depth) => {
                if (depth > 3) return;
                let names = [];
                try { names = fs.readdirSync(dir); } catch (e) { return; }
                for (const file of names) {
                    const p = path.join(dir, file);
                    let st;
                    try { st = fs.statSync(p); } catch (e) { continue; }
                    if (st.isDirectory()) { walkCores(p, type, version, depth + 1); continue; }
                    if (!/\.jar$/i.test(file) || /installer/i.test(file)) continue;
                    cores.push({
                        name: file,
                        size: st.size,
                        type,
                        version,
                        rel: path.relative(poolDir, p).split(path.sep).join('/')
                    });
                }
            };
            if (fs.existsSync(coresDir)) {
                for (const type of fs.readdirSync(coresDir)) {
                    const tdir = path.join(coresDir, type);
                    let tst;
                    try { tst = fs.statSync(tdir); } catch (e) { continue; }
                    if (!tst.isDirectory()) continue;
                    for (const version of fs.readdirSync(tdir)) {
                        const vdir = path.join(tdir, version);
                        let vst;
                        try { vst = fs.statSync(vdir); } catch (e) { continue; }
                        if (!vst.isDirectory()) continue;
                        walkCores(vdir, type, version, 0);
                    }
                }
            }

            res.json({
                success: true,
                scheme: {
                    name,
                    version: meta.version,
                    loader: meta.loader,
                    type: meta.type,
                    state: meta.state,
                    active: sm.currentScheme === name,
                    path: schemePath
                },
                mods,
                plugins,
                pool: {
                    mods: poolByLoader(path.join(poolDir, 'mods')),
                    plugins: poolByLoader(path.join(poolDir, 'plugins')),
                    cores
                },
                schemes: sm.list().map(s => ({ name: s.name, active: s.active, version: s.version }))
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** 解析 scheme 参数 + 目标 kind 目录（mods / plugins），并防路径穿越 */
    function resolveResourceTarget(req) {
        const SchemeManager = require('./scheme_manager');
        const sm = new SchemeManager();
        const wanted = String((req.body && req.body.scheme) || '').trim();
        const name = wanted || sm.currentScheme || '';
        if (!name) return { error: '当前没有激活方案，请先在「方案管理」中切换方案', status: 400 };
        if (!sm._schemeExists(name)) return { error: `方案「${name}」不存在`, status: 404 };

        const kind = String((req.body && req.body.kind) || 'mods');
        if (kind !== 'mods' && kind !== 'plugins') {
            return { error: 'kind 只能是 mods 或 plugins', status: 400 };
        }
        const fileName = path.basename(String((req.body && req.body.name) || ''));
        if (!fileName || !/\.(jar|zip)$/i.test(fileName)) {
            return { error: '文件名不合法', status: 400 };
        }
        const schemePath = sm._getSchemePath(name);
        return { sm, name, kind, fileName, schemePath, dir: path.join(schemePath, kind) };
    }

    /**
     * 启用 / 禁用方案内的模组或插件。
     * POST /api/resources/toggle { scheme?, kind, name }
     *
     * 规则：
     *   - mods/ 下无前缀 → 加 DISABLED_ 前缀（禁用）
     *   - mods/ 下带前缀 → 去掉前缀（启用）
     *   - mods-disabled/ 下 → 移回 mods/（启用；这是 clone-client 的禁用方式）
     */
    app.post('/api/resources/toggle', (req, res) => {
        try {
            const t = resolveResourceTarget(req);
            if (t.error) return res.status(t.status).json({ success: false, error: t.error });

            const inMain = path.join(t.dir, t.fileName);
            const disabledName = /^DISABLED_/i.test(t.fileName)
                ? t.fileName.replace(/^DISABLED_/i, '')
                : `DISABLED_${t.fileName}`;
            const inMainDisabled = path.join(t.dir, disabledName);
            const disabledDir = path.join(t.schemePath, 'mods-disabled');
            const inDisabledDir = path.join(disabledDir, t.fileName);
            const inDisabledDirStripped = path.join(disabledDir, disabledName);

            if (fs.existsSync(inMain)) {
                const isDisabled = /^DISABLED_/i.test(t.fileName);
                // disabledName 已按当前状态取反：未禁用 → 加前缀；已禁用 → 去前缀
                const target = inMainDisabled;
                if (fs.existsSync(target)) {
                    return res.status(409).json({ success: false, error: `目标文件已存在：${path.basename(target)}` });
                }
                fs.moveSync(inMain, target);
                return res.json({ success: true, enabled: isDisabled, name: path.basename(target) });
            }
            // mods-disabled/ 是 clone-client 的禁用区：启用 = 移回 mods/ 并去掉禁用语义
            // （不能保留 DISABLED_ 前缀，否则用户点了「启用」还是禁用状态）
            if (t.kind === 'mods' && fs.existsSync(inDisabledDir)) {
                fs.ensureDirSync(t.dir);
                const target = path.join(t.dir, t.fileName.replace(/^DISABLED_/i, ''));
                if (fs.existsSync(target)) {
                    return res.status(409).json({ success: false, error: `mods/ 下已存在同名文件：${path.basename(target)}` });
                }
                fs.moveSync(inDisabledDir, target);
                return res.json({ success: true, enabled: true, name: path.basename(target) });
            }
            if (t.kind === 'mods' && fs.existsSync(inDisabledDirStripped)) {
                fs.ensureDirSync(t.dir);
                const target = path.join(t.dir, t.fileName.replace(/^DISABLED_/i, ''));
                if (fs.existsSync(target)) {
                    return res.status(409).json({ success: false, error: `mods/ 下已存在同名文件：${path.basename(target)}` });
                }
                fs.moveSync(inDisabledDirStripped, target);
                return res.json({ success: true, enabled: true, name: path.basename(target) });
            }
            return res.status(404).json({ success: false, error: `找不到文件：${t.fileName}` });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 在 pool 与方案之间复制资源。
     * POST /api/resources/copy { scheme?, kind, name, direction: 'pool2scheme'|'scheme2pool' }
     */
    app.post('/api/resources/copy', (req, res) => {
        try {
            const t = resolveResourceTarget(req);
            if (t.error) return res.status(t.status).json({ success: false, error: t.error });
            const direction = String((req.body && req.body.direction) || '');

            if (direction === 'pool2scheme') {
                // 在 pool 的对应分类下找同名文件（优先同 loader/version）
                const poolRoot = path.join(utils.getPoolPath(), t.kind);
                const meta = t.sm._loadSchemeMeta(t.name);
                const preferDir = path.join(poolRoot, String(meta.loader || '').toLowerCase(), String(meta.version || ''));
                let source = path.join(preferDir, t.fileName);
                if (!fs.existsSync(source)) {
                    // 全池搜索（loader/version 目录层级不统一）
                    const hits = [];
                    const walk = (dir, depth) => {
                        if (depth > 3) return;
                        let names = [];
                        try { names = fs.readdirSync(dir); } catch (e) { return; }
                        for (const n of names) {
                            const p = path.join(dir, n);
                            let st;
                            try { st = fs.statSync(p); } catch (e) { continue; }
                            if (st.isDirectory()) { walk(p, depth + 1); continue; }
                            if (n === t.fileName) hits.push(p);
                        }
                    };
                    walk(poolRoot, 0);
                    if (!hits.length) {
                        return res.status(404).json({ success: false, error: `共享池中没有 ${t.fileName}` });
                    }
                    source = hits[0];
                }
                fs.ensureDirSync(t.dir);
                const target = path.join(t.dir, t.fileName);
                if (fs.existsSync(target)) {
                    return res.status(409).json({ success: false, error: '方案中已存在同名文件' });
                }
                fs.copyFileSync(source, target);
                return res.json({ success: true, direction, name: t.fileName });
            }

            if (direction === 'scheme2pool') {
                const source = path.join(t.dir, t.fileName);
                if (!fs.existsSync(source)) {
                    return res.status(404).json({ success: false, error: `方案中没有 ${t.fileName}` });
                }
                const meta = t.sm._loadSchemeMeta(t.name);
                const loader = String(meta.loader || 'vanilla').toLowerCase();
                const version = String(meta.version || 'unknown');
                const poolDir = path.join(utils.getPoolPath(), t.kind, loader, version);
                fs.ensureDirSync(poolDir);
                const target = path.join(poolDir, t.fileName.replace(/^DISABLED_/i, ''));
                if (fs.existsSync(target)) {
                    return res.json({ success: true, direction, name: path.basename(target), already: true });
                }
                fs.copyFileSync(source, target);
                return res.json({ success: true, direction, name: path.basename(target) });
            }

            return res.status(400).json({ success: false, error: 'direction 只能是 pool2scheme 或 scheme2pool' });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 实例配置：读写 server.properties
     * GET  /api/props?scheme=<name>
     * POST /api/props { scheme?, updates: { key: value } }
     */
    app.get('/api/props', (req, res) => {
        try {
            const SchemeManager = require('./scheme_manager');
            const sm = new SchemeManager();
            const wanted = pickParam(req.query.scheme);
            const name = wanted || sm.currentScheme || '';
            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: '当前没有激活方案，请先在「方案管理」中切换方案'
                });
            }
            if (!sm._schemeExists(name)) {
                return res.status(404).json({ success: false, error: `方案「${name}」不存在` });
            }
            const schemePath = sm._getSchemePath(name);
            const data = ServerProps.readProps(schemePath);
            const meta = sm._loadSchemeMeta(name);
            // 配置项的中文名 / 说明：字典在后端统一维护，前端直接渲染，
            // 不必自己再抄一份 —— 键名与翻译只此一处真源。
            const PropsDocs = require('./props_docs');
            res.json({
                success: true,
                scheme: {
                    name,
                    version: meta.version,
                    loader: meta.loader,
                    active: sm.currentScheme === name
                },
                schemes: sm.list().map(s => ({ name: s.name, active: s.active, version: s.version })),
                exists: data.exists,
                file: data.file,
                groups: data.groups,
                others: data.others,
                docs: PropsDocs.allDocs(),
                raw: data.raw
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/props', (req, res) => {
        try {
            const SchemeManager = require('./scheme_manager');
            const sm = new SchemeManager();
            const wanted = String((req.body && req.body.scheme) || '').trim();
            const name = wanted || sm.currentScheme || '';
            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: '当前没有激活方案，请先在「方案管理」中切换方案'
                });
            }
            if (!sm._schemeExists(name)) {
                return res.status(404).json({ success: false, error: `方案「${name}」不存在` });
            }
            const updates = req.body && req.body.updates;
            if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
                return res.status(400).json({ success: false, error: 'updates 必须是对象' });
            }
            const r = ServerProps.writeProps(sm._getSchemePath(name), updates);
            if (!r.ok) {
                return res.status(400).json({ success: false, error: r.reason });
            }
            logger.impt(`Web 修改实例配置: ${name}（${r.changed} 项更新，${r.created} 项新增）`);
            res.json({ success: true, changed: r.changed, created: r.created, file: r.file });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // ========================================================================
    // 模组表单引擎（V3.6.2 · 608 进阶）
    // 引擎与数据解耦：这里只做「读写 schema 库 + 调引擎」，不认识任何具体模组。
    // ========================================================================

    /**
     * 列出表单包（用户扩展库优先于官方内置库）
     */
    app.get('/api/schema/list', (req, res) => {
        try {
            const Store = require('./schema_store');
            const r = Store.loadAll();
            res.json({
                success: true,
                schemas: r.schemas.map(s => ({
                    mod_id: s.mod_id,
                    display_name: s.display_name,
                    platforms: s.platforms,
                    origin: s._origin,
                    origin_label: s._originLabel,
                    file_count: s.config_files.length,
                    field_count: s.config_files.reduce((a, f) => a + f.fields.length, 0),
                    author: s.author || '',
                    version: s.version || ''
                })),
                errors: r.errors,
                custom_dir: Store.customDir()
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 单个表单包详情（含字段清单，供「查看」用）
     */
    app.get('/api/schema/:modId', (req, res) => {
        try {
            const Store = require('./schema_store');
            const s = Store.get(req.params.modId);
            if (!s) return res.status(404).json({ success: false, error: `没找到表单包「${req.params.modId}」` });
            const { _source, _origin, _originLabel, ...rest } = s;
            res.json({ success: true, schema: rest, origin: _origin, origin_label: _originLabel });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 导入表单包：粘贴 JSON 文本，或给一个 GitHub / 直链 URL。
     * 导入一律落到用户扩展库 custom-schemas/，不会改安装目录。
     */
    app.post('/api/schema/import', async (req, res) => {
        try {
            const Store = require('./schema_store');
            const body = req.body || {};
            let text = body.json;
            const url = String(body.url || '').trim();

            if (url) {
                if (!/^https?:\/\//i.test(url)) {
                    return res.status(400).json({ success: false, error: '只支持 http / https 链接' });
                }
                // 把常见的 GitHub 页面地址转成 raw 直链，省得用户自己找
                let fetchUrl = url;
                const gh = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
                if (gh) fetchUrl = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
                try {
                    const axios = require('axios');
                    const resp = await axios.get(fetchUrl, {
                        timeout: 20000,
                        maxContentLength: Store.MAX_SCHEMA_BYTES,
                        responseType: 'text',
                        transformResponse: [d => d]
                    });
                    text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
                } catch (e) {
                    return res.status(400).json({ success: false, error: `下载失败：${e.message}` });
                }
            }

            if (typeof text !== 'string' || !text.trim()) {
                return res.status(400).json({ success: false, error: '请粘贴 JSON 内容，或填写下载链接' });
            }
            const parsed = Store.parseImport(text);
            if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.reason });
            const saved = Store.saveCustom(parsed.schema);
            logger.impt(`Web 导入表单包: ${parsed.schema.mod_id}`);
            res.json({
                success: true,
                mod_id: parsed.schema.mod_id,
                display_name: parsed.schema.display_name,
                file: saved.file,
                warnings: parsed.warnings || []
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 删除用户扩展库里的表单包（官方内置不可删）
     */
    app.delete('/api/schema/:modId', (req, res) => {
        try {
            const Store = require('./schema_store');
            const r = Store.removeCustom(req.params.modId);
            if (!r.ok) return res.status(400).json({ success: false, error: r.reason });
            logger.impt(`Web 删除表单包: ${req.params.modId}`);
            res.json({ success: true, file: r.file });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 懒加载目录树：一次只列一层
     */
    app.get('/api/modcfg/tree', (req, res) => {
        try {
            const Engine = require('./schema_engine');
            const r = Engine.listDir(req.query.dir);
            if (!r.ok) return res.status(400).json({ success: false, error: r.reason });
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 读文件：有匹配表单包且不超 200 行 → 给表单数据；否则源码模式
     */
    app.get('/api/modcfg/file', (req, res) => {
        try {
            const Engine = require('./schema_engine');
            const r = Engine.readFileForEdit(req.query.path);
            if (!r.ok) return res.status(400).json({ success: false, error: r.reason });
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 表单模式保存：只接收变更集 { file, changes: {key: value} }。
     * 返回改写后的全文，前端据此自动切到源码模式让用户复核。
     */
    app.post('/api/modcfg/save', (req, res) => {
        try {
            const Engine = require('./schema_engine');
            const Store = require('./schema_store');
            const { file, changes } = req.body || {};
            if (!file || typeof file !== 'string') {
                return res.status(400).json({ success: false, error: '缺少 file' });
            }
            if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
                return res.status(400).json({ success: false, error: 'changes 必须是以键名为键的对象' });
            }
            const hit = Store.findByPath(file);
            if (!hit) return res.status(400).json({ success: false, error: '这个文件没有匹配的表单包，请用源码模式' });

            const r = Engine.writeChanges(file, hit.file, changes);
            if (!r.ok) return res.status(400).json({ success: false, error: r.reason });

            if (r.changed > 0) logger.impt(`Web 表单保存: ${file}（${r.changed} 项）`);
            res.json({
                success: true,
                changed: r.changed,
                applied: r.applied,
                missing: r.missing,
                text: r.text,
                backup: r.backup
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 源码模式整体保存（备份 + 原子写）
     */
    app.post('/api/modcfg/save-raw', (req, res) => {
        try {
            const Engine = require('./schema_engine');
            const { file, content } = req.body || {};
            if (!file || typeof content !== 'string') {
                return res.status(400).json({ success: false, error: '需要 file 与 content' });
            }
            const r = Engine.saveRaw(file, content);
            if (!r.ok) return res.status(400).json({ success: false, error: r.reason });
            logger.impt(`Web 源码保存: ${file}`);
            res.json({ success: true, path: r.path });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 执行 CLI 命令（将 Web 操作转为命令执行）
     */
    app.post('/api/exec', async (req, res) => {
        const { args = [] } = req.body;
        // V3.5.19：入参统一清洗（去 \r\n、压缩连续空格），避免「带空格就 unknown command」
        const command = sanitizeCommandText(req.body && req.body.command);
        const cleanArgs = (Array.isArray(args) ? args : [])
            .map(a => sanitizeCommandText(a))
            .filter(a => a !== '');

        if (!command) {
            return res.status(400).json({ error: '命令不能为空' });
        }

        // V3.5.3：Web 端命令安全策略（拒绝清单）——拦截灾难性/不可逆操作
        const policy = isWebCommandAllowed([command, ...cleanArgs].join(' '));
        if (!policy.allowed) {
            logger.warn(`Web 指令被拒绝: ${command} | ${policy.reason}`);
            return res.status(403).json({ error: policy.reason, code: 'POLICY_DENIED' });
        }

        // V3.5.19：先回显再执行——Web 上点的每一个按钮，终端里都要看得见它发了什么
        webCliEcho(`wow ${[command, ...cleanArgs].join(' ')}`);

        try {
            // 执行命令
            const result = await execCommand(command, cleanArgs);
            res.json({ success: true, output: result });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 向运行中的 Minecraft 服务端发送一条控制台指令（V3.5.19）
     * POST /api/console  { line: "say hi" }
     *
     * 为什么单独开一条路由：控制台指令不是 wow 指令，绝不能走 /api/exec
     * （那会变成 `wow list` → unknown command）。这里只做三件事：
     *   清洗 → 回显 [WebCLI] → 投递给持有 stdin 的进程。
     */
    app.post('/api/console', (req, res) => {
        const line = sanitizeCommandText(req.body && req.body.line);
        if (!line) {
            return res.status(400).json({ success: false, error: '指令不能为空' });
        }
        if (line.length > 512) {
            return res.status(413).json({ success: false, error: '指令过长（上限 512 字符）' });
        }

        const server = new ServerManager();
        if (!server.isRunning()) {
            return res.status(409).json({ success: false, error: '服务器未运行，无法发送控制台指令' });
        }

        webCliEcho(line);

        const relayAlive = typeof ServerManager.isConsoleRelayAlive === 'function'
            && ServerManager.isConsoleRelayAlive();

        if (relayAlive) {
            const ok = ServerManager.enqueueConsoleCommand(line);
            return res.json({ success: ok, via: 'relay', line, queued: ok });
        }

        // 兜底：没有中继进程（如服务端由旧版本拉起），尝试直接写 stdin
        let sent = false;
        try { sent = server.sendCommand(line); } catch (e) { sent = false; }
        if (!sent) {
            return res.status(409).json({
                success: false,
                error: '当前服务端进程没有控制台接收器（可能是旧版本启动的），请重启服务器后再试'
            });
        }
        res.json({ success: true, via: 'stdin', line });
    });

    /**
     * 异步任务：提交（V3.5.19）
     * POST /api/tasks/run  { command: "scheme create", args: ["名字","--version","1.20.1"], name }
     * 立即返回 task_id，不等待下载/安装完成。
     */
    app.post('/api/tasks/run', (req, res) => {
        const body = req.body || {};
        const command = sanitizeCommandText(body.command);
        const args = (Array.isArray(body.args) ? body.args : [])
            .map(a => sanitizeCommandText(a))
            .filter(a => a !== '');

        if (!command) {
            return res.status(400).json({ success: false, error: '缺少 command' });
        }

        const policy = isWebCommandAllowed([command, ...args].join(' '));
        if (!policy.allowed) {
            logger.warn(`Web 异步任务被拒绝: ${command} | ${policy.reason}`);
            return res.status(403).json({ success: false, error: policy.reason, code: 'POLICY_DENIED' });
        }

        const r = WebTask.runTask({
            command,
            args,
            name: sanitizeCommandText(body.name),
            type: sanitizeCommandText(body.type) || '方案'
        });
        if (!r.ok) {
            return res.status(400).json({ success: false, error: r.reason });
        }

        webCliEcho(`wow ${[command, ...args].join(' ')}`);
        res.json({ success: true, task_id: r.task.id, task: r.task });
    });

    /**
     * 异步任务：列表（V3.5.19）
     * GET /api/tasks  → { tasks, stats }
     */
    app.get('/api/tasks', (req, res) => {
        try {
            const Queue = require('./download_queue');
            res.json({ success: true, tasks: Queue.list(), stats: Queue.stats() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 异步任务：清理已结束的任务（V3.5.19）
     */
    app.delete('/api/tasks', (req, res) => {
        try {
            const Queue = require('./download_queue');
            res.json({ success: true, removed: Queue.clearFinished() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 获取服务器状态
     * V3.5.19：补齐 running / pid 之外的现场信息（方案名、启动时刻、控制台中继是否在线），
     * 仪表盘不再出现「状态一片空白」。
     */
    app.get('/api/status', (req, res) => {
        try {
            const server = new ServerManager();
            const info = server.getInfo();

            // 启动时刻：PID 文件的 mtime 近似等于「服务器写入 PID 的时间」
            let startedAt = null;
            try {
                const pidFile = path.join(info.serverDir, 'server.pid');
                const pidPath = fs.existsSync(pidFile) ? pidFile : null;
                if (pidPath) startedAt = fs.statSync(pidPath).mtimeMs;
            } catch (e) { /* 拿不到就算了，不影响状态展示 */ }

            res.json({
                running: !!info.running,
                pid: info.pid || null,
                serverDir: info.serverDir,
                jarFile: info.jarFile,
                logFile: info.logFile,
                scheme: config.getConfig('server.scheme', null),
                startedAt,
                // V3.5.19：控制台指令是否有进程在接收（决定 Web 控制台能不能发 MC 指令）
                consoleRelay: typeof ServerManager.isConsoleRelayAlive === 'function'
                    ? ServerManager.isConsoleRelayAlive()
                    : false,
                web: {
                    port: parseInt(fs.existsSync(WEB_PORT_FILE) ? fs.readFileSync(WEB_PORT_FILE, 'utf8').trim() : 0, 10) || config.getConfig('web.port', 8080),
                    host: config.getConfig('web.host', '127.0.0.1')
                }
            });
        } catch (e) {
            res.status(500).json({ error: e.message, running: false, pid: null });
        }
    });

    /**
     * 配置表单结构（V3.5.19）
     * GET /api/config/schema
     * 返回「有哪些键、什么类型、中文怎么解释」，前端据此生成表单。
     * 必须注册在 /api/config/:key 之前，否则会被当成 key="schema"。
     */
    app.get('/api/config/schema', (req, res) => {
        try {
            const schema = require('./config_schema');
            const fields = schema.listFields().map(f => {
                const value = config.getConfig(f.key, null);
                const isSecret = f.type === 'secret';
                return {
                    ...f,
                    // 密钥类永不回显明文，只告诉前端「是否已设置」
                    value: isSecret ? null : value,
                    hasValue: isSecret ? !!(value && String(value).trim()) : undefined
                };
            });
            res.json({ success: true, fields });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 批量保存配置（V3.5.19）
     * POST /api/config/batch  { patch: { "auto_scheme": true, "web.port": 8080 } }
     * 或直接传扁平对象 { "auto_scheme": true }。
     * 未在 config_schema 登记过的键一律忽略，防止前端塞垃圾键把 wow.yaml 写花。
     */
    app.post('/api/config/batch', (req, res) => {
        try {
            const body = req.body || {};
            const rawPatch = (body.patch && typeof body.patch === 'object') ? body.patch : body;
            const flat = flattenConfigPatch(rawPatch);

            const schema = require('./config_schema');
            const check = schema.validatePatch(flat);
            if (!check.ok) {
                return res.status(400).json({
                    success: false,
                    error: `配置项 ${check.key} 取值非法：${check.reason}`,
                    key: check.key
                });
            }

            const applied = config.setConfigs(check.values);
            const keys = Object.keys(check.values);
            if (keys.length) {
                logger.impt(`Web 修改配置: ${keys.join(', ')}`);
                webCliEcho(`config set ${keys.join(' ')}`);
            }
            res.json({ success: true, applied, keys, skipped: check.skipped });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /**
     * 最终启动命令预览（V3.6.2 · 607 指令五）
     * POST /api/config/preview-jvm
     *   入参（均可省略，省略时读当前配置）：
     *     template: 'g1' | 'zgc' | 'custom'
     *     override_args: string[]   （Web 端必须传 JSON 数组，禁止前端拼长串）
     *     memory: '4G'
     * 出参：后端跑完「模板 → 合并 → GC 互斥 → 兜底 → agent 过滤 → 内存红线」
     * 完整链路后，返回最终的 java 命令字符串；前端原样展示，不做任何拼接。
     */
    app.post('/api/config/preview-jvm', (req, res) => {
        try {
            const Jvm = require('./jvm_args');
            const os = require('os');
            const body = req.body || {};

            const template = body.template !== undefined && body.template !== null && body.template !== ''
                ? body.template
                : config.getConfig('server.jvm.template', Jvm.DEFAULT_TEMPLATE);
            const override = body.override_args !== undefined
                ? body.override_args
                : config.getConfig('server.jvm.override_args', []);
            const memory = (body.memory && String(body.memory).trim())
                || config.getConfig('server.memory')
                || '2G';
            const authEnable = config.getConfig('auth.enable', false) === true;

            const built = Jvm.buildJvmArgs({
                template,
                override,
                heap: memory,
                filterJavaagent: authEnable
            });
            // 显式 memory（前端预览传入 / 配置的 server.memory）与 CLI --memory 同语义：覆盖堆参数
            const memOverride = body.memory !== undefined && body.memory !== null && String(body.memory).trim() !== ''
                ? Jvm.applyMemoryOverride(built.args, memory)
                : { args: built.args };
            const args = [...memOverride.args];
            // 预览也要体现 wow 独家注入的外置登录 agent（jar 路径启动时才确定，用占位说明）
            if (authEnable) {
                const authServer = config.getConfig('auth.server') || 'https://authlib-injector.yushi.moe';
                args.push(`-javaagent:<authlib-injector.jar>=${authServer}`);
            }

            const jarFile = (body.jar && String(body.jar).trim()) || 'server.jar';
            const command = ['java', ...args, '-jar', jarFile, 'nogui'].join(' ');

            const totalBytes = os.totalmem();
            const memCheck = Jvm.checkMemLimit(memOverride.args, totalBytes);

            res.json({
                success: true,
                command,
                args,
                removed: built.removed,
                injected: built.injected,
                warnings: built.warnings,
                memory: {
                    total_bytes: totalBytes,
                    total_text: Jvm.formatBytes(totalBytes),
                    limit_bytes: memCheck.limitBytes,
                    limit_text: Jvm.formatBytes(memCheck.limitBytes),
                    xmx_bytes: memCheck.xmxBytes,
                    xmx_text: memCheck.xmxText,
                    over_limit: !memCheck.ok,
                    message: memCheck.message || null
                }
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
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
     * V3.5.19：同时支持两种载荷——
     *   单个键：{ key: "web.port", value: 8080 }
     *   整份配置：{ server: {...}, web: {...} }（设置页「原始 JSON」模式仍在用）
     * 历史上后一种会因缺少 key 直接 400，用户以为「保存成功」其实什么都没写。
     */
    app.post('/api/config', (req, res) => {
        const body = req.body || {};
        const { key, value } = body;

        if (!key) {
            // 整份配置：按 schema 白名单落到扁平键再写
            try {
                const flat = flattenConfigPatch(body);
                const schema = require('./config_schema');
                const check = schema.validatePatch(flat);
                if (!check.ok) {
                    return res.status(400).json({ error: `配置项 ${check.key} 取值非法：${check.reason}` });
                }
                const applied = config.setConfigs(check.values);
                const keys = Object.keys(check.values);
                if (keys.length) logger.impt(`Web 保存配置: ${keys.join(', ')}`);
                return res.json({ success: true, applied, keys, skipped: check.skipped });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
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
     * 单个方案详情（V3.5.19）
     * GET /api/scheme/:name/status
     * 前端「方案详情」弹窗一直在请求这个地址，但此前后端从未实现，
     * 于是永远走到「无法获取详细信息」分支。
     */
    app.get('/api/scheme/:name/status', (req, res) => {
        try {
            const SchemeManager = require('./scheme_manager');
            const sm = new SchemeManager();
            const name = String(req.params.name || '').trim();
            if (!name) return res.status(400).json({ success: false, error: '缺少方案名' });
            if (!sm._schemeExists(name)) {
                return res.status(404).json({ success: false, error: `方案「${name}」不存在` });
            }

            // 这里直接读 scheme.yaml，不调 sm.status()——那个方法会往 stdout 打一整块表格，
            // 面板每开一次详情弹窗就往终端刷一遍，太脏。
            const meta = sm._loadSchemeMeta(name);
            const res0 = meta.resources || {};
            const mods = res0.mods || [];
            const plugins = res0.plugins || [];
            const core = res0.core || {};

            res.json({
                success: true,
                name,
                state: meta.state,
                version: meta.version,
                loader: meta.loader,
                type: meta.type,
                build: meta.build || null,
                created_at: meta.created_at || null,
                updated_at: meta.updated_at || null,
                active: sm.currentScheme === name,
                core: { file: core.file || '--', in_pool: !!core.in_pool },
                mods: {
                    count: mods.length,
                    shared: mods.filter(m => m.in_pool).length,
                    unique: mods.filter(m => !m.in_pool).length
                },
                plugins: {
                    count: plugins.length,
                    shared: plugins.filter(p => p.in_pool).length,
                    unique: plugins.filter(p => !p.in_pool).length
                },
                unique_resources: meta.unique_resources || [],
                world: meta.world || { exists: false }
            });
        } catch (e) {
            res.status(400).json({ success: false, error: e.message });
        }
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
    // V3.5.19：支持 ?scheme= 指定方案（文件管理器右上角的方案下拉框），
    // 不传则沿用「当前激活方案」，与旧行为完全一致。

    /** 取本次请求的方案参数（query 优先，其次 body） */
    const schemeOf = (req) => {
        const q = pickParam(req.query && req.query.scheme);
        return q || pickParam(req.body && req.body.scheme);
    };

    /** 方案参数 → 方案根目录绝对路径（非法方案名会抛错，由各路由转成 403/404） */
    const rootOf = (req) => {
        const FileManager = require('./file_manager');
        return FileManager.getRoot(schemeOf(req) || undefined);
    };

    /**
     * 列出目录内容
     * GET /api/files?path=<相对路径>&scheme=<方案名>
     */
    app.get('/api/files', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const rootAbs = rootOf(req);
            const result = await FileManager.listFiles(req.query.path || '', rootAbs);
            res.json({
                success: true,
                path: result.path,
                root: rootAbs,
                scheme: schemeOf(req) || config.getConfig('server.scheme', null),
                files: result.files
            });
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
            const info = FileManager.resolveDownload(req.query.path || '', rootOf(req));
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
                const scheme = pickParam(parsed.fields.scheme) || pickParam(req.query.scheme);
                const result = await FileManager.saveUploads(
                    parsed.fields.path || '',
                    parsed.files,
                    FileManager.getRoot(String(scheme).trim() || undefined)
                );
                if (result.uploaded) {
                    systemEcho(`cp -r <上传> ${parsed.fields.path || '.'}  (${result.uploaded} 个文件${schemeSuffix(scheme)})`);
                }
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
            const scheme = schemeOf(req);
            const r = await FileManager.makeDir(parentPath, name, rootOf(req));
            logger.info(`Web 新建文件夹: ${r.path}`);
            systemEcho(`mkdir ${r.path}${schemeSuffix(scheme)}`);
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
            const scheme = schemeOf(req);
            const r = await FileManager.renameEntry(p, newName, rootOf(req));
            logger.info(`Web 重命名: ${r.from} → ${r.to}`);
            systemEcho(`mv ${r.from} ${r.to}${schemeSuffix(scheme)}`);
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
            const scheme = schemeOf(req);
            const r = await FileManager.transferEntry(from, to, false, rootOf(req));
            logger.info(`Web 移动: ${r.from} → ${r.to}`);
            systemEcho(`mv ${r.from} ${r.to}${schemeSuffix(scheme)}`);
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
            const scheme = schemeOf(req);
            const r = await FileManager.transferEntry(from, to, true, rootOf(req));
            logger.info(`Web 复制: ${r.from} → ${r.to}`);
            systemEcho(`cp -r ${r.from} ${r.to}${schemeSuffix(scheme)}`);
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
            const scheme = schemeOf(req);
            const r = await FileManager.removeEntry(p, rootOf(req));
            logger.warn(`Web 删除${r.type === 'dir' ? '目录' : '文件'}: ${r.path}`);
            systemEcho(`rm -rf ${r.path}${schemeSuffix(scheme)}`);
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
            const scheme = schemeOf(req);
            const r = await FileManager.compress(paths, dest, rootOf(req));
            logger.info(`Web 压缩: ${r.entries} 项 → ${r.path}`);
            systemEcho(`zip -r ${r.path} ${paths.join(' ')}${schemeSuffix(scheme)}`);
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
            const scheme = schemeOf(req);
            const r = await FileManager.extract(zipPath, dest, rootOf(req));
            logger.info(`Web 解压: ${zipPath} → ${r.path}（${r.extracted} 项）`);
            systemEcho(`unzip ${zipPath} -d ${r.path || '.'}${schemeSuffix(scheme)}`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /**
     * 读取文本文件（预览 / 编辑）
     * GET /api/files/content?path=xxx&scheme=xxx
     */
    app.get('/api/files/content', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const r = await FileManager.readText(req.query.path || '', undefined, rootOf(req));
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
            const scheme = schemeOf(req);
            const r = await FileManager.writeText(p, content, undefined, rootOf(req));
            logger.info(`Web 保存文件: ${r.path}（${r.size} 字节）`);
            systemEcho(`cat > ${r.path}  (${r.size} 字节${schemeSuffix(scheme)})`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    // ===== 文本编辑器专用别名（V3.5.19）=====
    // 需求单点名要 /api/file/read 与 /api/file/write。上面两条 REST 路由
    // （GET/PUT /api/files/content）早已实现同样的能力，这里只做薄别名转发，
    // 不复制第二份读写逻辑，避免以后改一处漏一处。

    /** GET /api/file/read?path=xxx */
    app.get('/api/file/read', async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const r = await FileManager.readText(req.query.path || '', undefined, rootOf(req));
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    });

    /** POST /api/file/write  { path, content }（同时接受 PUT，方便前端按语义调用） */
    const fileWriteHandler = async (req, res) => {
        try {
            const FileManager = require('./file_manager');
            const { path: p, content = '' } = req.body || {};
            const scheme = schemeOf(req);
            const r = await FileManager.writeText(p, content, undefined, rootOf(req));
            logger.info(`Web 保存文件: ${r.path}（${r.size} 字节）`);
            systemEcho(`cat > ${r.path}  (${r.size} 字节${schemeSuffix(scheme)})`);
            res.json({ success: true, ...r });
        } catch (e) {
            res.status(fileErrStatus(e)).json({ success: false, error: e.message });
        }
    };
    app.post('/api/file/write', fileWriteHandler);
    app.put('/api/file/write', fileWriteHandler);

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
            // V3.5.20：统计口径抽到 pool_stats.js，CLI 的 `pool stats` 与本接口共用，
            // 避免两处各写一遍导致数字对不上。
            const stats = require('./pool_stats');
            res.json({ success: true, ...stats.getStats() });
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
            // V3.5.19 修复：原实现写成 `ServerManager.isRunning()`（类上根本没有这个静态方法），
            // 永远恒为 false，导致仪表盘 CPU/内存/人数 一直是 0。改为实例方法。
            const server = new ServerManager();
            const info = server.getInfo();
            const running = !!info.running;

            let cpu = '0%';
            let memory = '0 MB';
            let uptime = '0s';
            let players = 0;

            if (running) {
                const pid = info.pid;
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

            res.json({ success: true, running, pid: info.pid || null, cpu, memory, uptime, players });
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

        // V3.5.19：日志改为「单一定时器 + 广播」，新客户端只从当前时刻开始收增量，
        // 历史记录由前端首次 GET /api/logs 拉取，避免每个页面都重复读整份日志。
        startBroadcastTail();

        // 连上就先把当前任务列表推一份，任务队列页不必等首次轮询
        try {
            const Queue = require('./download_queue');
            socket.emit('tasks', { tasks: Queue.list(), stats: Queue.stats() });
        } catch (e) { /* 队列不可用不影响连接 */ }

        socket.on('disconnect', () => {
            console.log(`WebSocket 客户端已断开: ${socket.id}`);
            wsClients = wsClients.filter(c => c.id !== socket.id);
            // V3.6.2 修复：函数名笔误——这里原本写成 stopBroadcastTail()（不存在），
            // 导致最后一个客户端断开时抛 ReferenceError，整个面板进程直接崩溃。
            // 实际的停止函数是 stopLogTail()。
            if (wsClients.length === 0) stopLogTail();
        });

        // 接收命令（前端直接发送命令）
        socket.on('command', async (data) => {
            const command = sanitizeCommandText(data && data.command);
            const args = (Array.isArray(data && data.args) ? data.args : [])
                .map(a => sanitizeCommandText(a))
                .filter(a => a !== '');
            if (!command) return;

            // V3.5.3：与 /api/exec 共用同一套命令安全策略
            const policy = isWebCommandAllowed([command, ...args].join(' '));
            if (!policy.allowed) {
                logger.warn(`WebSocket 指令被拒绝: ${command} | ${policy.reason}`);
                socket.emit('command_result', { command, success: false, error: policy.reason });
                return;
            }

            // V3.5.19：与 HTTP 侧一致，先回显 [WebCLI]
            webCliEcho(`wow ${[command, ...args].join(' ')}`);

            try {
                const result = await execCommand(command, args);
                socket.emit('command_result', { command, success: true, output: result });
            } catch (e) {
                socket.emit('command_result', { command, success: false, error: e.message });
            }
        });
    });

    // V3.5.19：异步任务进度 → 广播给所有客户端（方案创建 / 拉取 / 瘦身）
    WebTask.bus.on('update', (task) => {
        if (!task) return;
        for (const client of wsClients) {
            try {
                client.emit('task', task);
            } catch (e) { /* 忽略单个客户端异常 */ }
        }
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
        const shownHost = (host === '0.0.0.0' || host === '::') ? '127.0.0.1' : host;
        console.log(`Web 服务已启动: http://${shownHost}:${port}`);
        if (host === '0.0.0.0' || host === '::') {
            console.log(`  绑定地址: ${host}（所有网卡，局域网/公网可访问）`);
        } else if (host !== '127.0.0.1' && host !== 'localhost') {
            console.log(`  绑定地址: ${host}`);
        }
        console.log(`  主题: ${theme}`);
        console.log(`  静态目录: ${webDir}`);

        // V3.5.16：对外暴露时的额外提示
        if (isExposedHost(host)) {
            console.log('');
            console.log('  🔒 安全提示：面板已对外暴露，登录校验已启用。');
            console.log('     请确认 web.auth_password（或 web.auth_token）足够复杂。');
            // 列出可用访问地址（局域网 IP），方便用户复制
            try {
                const nets = os.networkInterfaces();
                const addrs = [];
                for (const list of Object.values(nets || {})) {
                    for (const info of list || []) {
                        const isV4 = info.family === 'IPv4' || info.family === 4;
                        if (isV4 && !info.internal) addrs.push(info.address);
                    }
                }
                if (addrs.length) {
                    console.log('     本机可用访问地址：');
                    for (const a of addrs) console.log(`       http://${a}:${port}`);
                }
            } catch (e) { /* 枚举网卡失败不影响启动 */ }
            console.log('');
        }

        // V3.5.16：检测到陶瓦联机已开启 -> 打印虚拟局域网 IP
        try {
            if (Terracotta.isRunning()) {
                require('./netinfo').buildLanAccessHint({ port }).then(lines => {
                    for (const line of lines) console.log(line);
                }).catch(() => {});
            }
        } catch (e) { /* 探测失败不影响启动 */ }

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

    // V3.5.19：端口占用等启动错误必须给出人话提示，而不是抛一段未捕获的 EADDRINUSE 堆栈
    server.on('error', (err) => {
        isRunning = false;
        if (err && err.code === 'EADDRINUSE') {
            console.error('');
            console.error(`❌ Web 面板启动失败：端口 ${port} 已被占用`);
            console.error(`   换个端口：wow web start -p ${Number(port) + 1}`);
            console.error(`   或先停掉占用进程：wow web stop`);
            console.error('');
        } else {
            console.error(`❌ Web 面板启动失败: ${err && err.message}`);
        }
        try { logger.erro(`Web 面板启动失败: ${err && err.message}`); } catch (e) { /* 忽略 */ }
    });

    // 自动打开浏览器（仅限本地访问）
    if (host === '127.0.0.1' || host === 'localhost') {
        try {
            const open = require('open');
            open(`http://${host}:${port}`);
        } catch (e) {
            // 忽略，有些环境没有 open 包
        }
    }

    // V3.5.16：Cloudflare Tunnel（--tunnel）
    // 服务先起来再拉隧道，避免隧道抢在 listen 之前连不上 127.0.0.1。
    //
    // V3.5.24：隧道前先过认证闸门。这里必须在调 startTunnelForLocal **之前**
    // 就地检查一次，不能只依赖函数内部那道——否则面板已经起来了，
    // 用户看到的是一句「隧道启动失败」，容易误以为整个 web start 失败。
    // 这里的措辞要点明：面板本身是好的，只是隧道没建。
    if (options.tunnel) {
        if (!checkTunnelAuth().ok) {
            console.error('');
            console.error('   ⚠️  已跳过隧道：面板本身已正常启动，但隧道未建立（缺认证凭据）。');
            console.error(`   本地地址: http://127.0.0.1:${port}`);
            console.error('   补齐凭据后可用 `wow web tunnel` 单独补建隧道。');
            console.error('');
            try {
                logger.warn('Cloudflare Tunnel 已跳过：未配置 web.auth_token / web.auth_password');
            } catch (e) { /* 日志失败不影响 */ }
        } else {
            startTunnelForLocal(port).catch(e => {
                console.error('');
                console.error(`❌ Cloudflare Tunnel 启动失败: ${e.message}`);
                console.error('   Web 面板本身仍在本地正常运行，可继续用本机地址访问。');
                console.error('');
                logger.erro(`Cloudflare Tunnel 启动失败: ${e.message}`);
            });
        }
    }

    // V3.5.24：外部直接对返回的 server 调 close() 时回收内部状态。
    // 场景：同进程嵌入式用法（测试脚本、被别的程序 require 后自管生命周期），
    // 调用方拿到 server 后自己 close()，不会走 stopWeb()，于是 isRunning 永远停在 true，
    // 之后任何一次 startWeb() 都只会打印「Web 服务已在运行中」然后返回 undefined。
    server.on('close', () => {
        isRunning = false;
        if (httpServer === server) httpServer = null;
        stopTunnelHandle();
        stopLogTail();
    });

    return server;
}

/**
 * V3.5.16：为已启动的本地面板拉一条 Cloudflare 快速隧道
 * 独立成函数，便于 web start --tunnel 与 web tunnel 复用。
 */
async function startTunnelForLocal(port) {
    // V3.5.24：「隧道等于暴露，必须配 token」。
    // 放在最前面，是在下载 cloudflared（几十 MB）和建立连接**之前**就拦下，
    // 而不是等隧道拉起来、公网地址都打印出来了才发现没凭据。
    if (!checkTunnelAuth().ok) {
        throw new Error(TUNNEL_AUTH_ERR);
    }

    const Tunnel = require('./tunnel');
    const localUrl = `http://127.0.0.1:${port}`;
    console.log('');
    console.log(`  ☁️  正在建立 Cloudflare 隧道 -> ${localUrl}`);
    console.log('     首次使用需下载 cloudflared，请稍候...');

    const t = await Tunnel.startTunnel(localUrl);
    tunnelHandle = t;

    // 高亮打印公网地址
    const bar = '═'.repeat(58);
    console.log('');
    console.log(bar);
    console.log('  🌍  公网地址已就绪（任何人可访问，请勿泄露给不受信任的人）');
    console.log('');
    console.log(`      ${t.url}`);
    console.log('');
    console.log(bar);
    console.log('  提示：该地址每次启动都会变化；关闭 wow 后隧道随即失效。');
    console.log(`  日志: ${t.logFile}`);
    console.log('');

    try {
        logger.impt(`Cloudflare Tunnel 已建立: ${t.url} -> ${localUrl}`);
    } catch (e) { /* 日志失败不影响 */ }

    // 进程退出时收尾，避免 cloudflared 变孤儿
    const cleanup = () => {
        if (tunnelHandle) {
            try { tunnelHandle.stop(); } catch (e) {}
            tunnelHandle = null;
        }
    };
    process.once('exit', cleanup);
    process.once('SIGINT', () => { cleanup(); process.exit(0); });
    process.once('SIGTERM', () => { cleanup(); process.exit(0); });

    return t;
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
        // V3.5.16：即便 HTTP 服务不在本进程，也要顺手关掉残留隧道
        stopTunnelHandle();
        console.log('Web 服务未运行');
        return;
    }

    // V3.5.16：先关隧道，再关 HTTP
    stopTunnelHandle();

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
        // V3.5.19：同进程模式下也要清掉 PID/端口文件，否则残留文件会让
        // `wow web status` 误以为面板还在（旧实现只在「跨进程」分支清理）
        cleanupOwnStateFiles();
        console.log('Web 服务已停止');
    });
}

/**
 * V3.5.19：清理本进程自己写的状态文件。
 * 只在文件里的 PID 确实是当前进程时才删，避免误删另一个实例的登记信息。
 */
function cleanupOwnStateFiles() {
    let pid = null;
    try {
        if (fs.existsSync(WEB_PID_FILE)) {
            pid = parseInt(fs.readFileSync(WEB_PID_FILE, 'utf8').trim(), 10);
        }
    } catch (e) { /* 读不到就当没有 */ }

    // pid 文件里不是自己 → 说明登记的是另一个实例，别动
    if (pid !== process.pid) return;

    try { fs.unlinkSync(WEB_PID_FILE); } catch (e) { /* 忽略 */ }
    try { fs.unlinkSync(WEB_PORT_FILE); } catch (e) { /* 忽略 */ }
}

/**
 * V3.5.16：关闭隧道句柄（幂等，未开启时静默）
 */
function stopTunnelHandle() {
    if (!tunnelHandle) return;
    try {
        tunnelHandle.stop();
        console.log('Cloudflare 隧道已关闭');
    } catch (e) { /* 已退出 */ }
    tunnelHandle = null;
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
 * V3.5.19：参数按空白拆分并过滤空项——历史实现 `command.split(' ')` 会把
 * `scheme pull  test` 拆出空字符串，最终以 `scheme pull "" test` 传给 commander，
 * 方案名变成空串，用户看到的就是「命令未知 / 方案不存在」。
 */
function execCommand(command, args = []) {
    const cmdText = sanitizeCommandText(command);
    const argList = (Array.isArray(args) ? args : [])
        .map(a => sanitizeCommandText(a))
        .filter(a => a !== '');
    const fullCmd = `wow ${[cmdText, ...argList].join(' ')}`.trim();
    logger.impt(`Web 页面执行指令: ${fullCmd}`);
    return new Promise((resolve, reject) => {
        const parts = cmdText.split(/\s+/).filter(Boolean);
        const mainCmd = parts[0];
        const subParts = parts.slice(1);

        // 实际执行命令：调用 cli.js 的对应功能（子进程方式）
        const cliPath = path.join(__dirname, 'cli.js');
        const fullArgs = [cliPath, mainCmd, ...subParts, ...argList];

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
 * 日志实时推送（WebSocket 广播，V3.5.19）
 * ------------------------------------------------------------
 * 旧实现给每个 socket 各开一个 500ms 定时器（且从文件开头读），三个页面同时开着
 * 就是三份重复 IO，日志还会因为 500ms 轮询有明显延迟。
 * 现在改为「一个定时器 + 广播」：
 *   - 全局只维护一个读取游标 logTailPos；
 *   - 每 250ms 读一次增量，按行广播给所有客户端；
 *   - 首个客户端连上时启动，最后一个断开时停掉，空闲时零开销。
 * 历史日志仍由前端首屏 GET /api/logs 拉取，二者互补。
 */
let logTailTimer = null;
let logTailPos = 0;
let logTailPath = null;
const LOG_TAIL_INTERVAL = 250;
const LOG_TAIL_MAX_CHUNK = 256 * 1024;

function startBroadcastTail() {
    if (logTailTimer) return;

    try {
        const server = new ServerManager();
        logTailPath = server.logFile;
        // 从当前末尾开始：只推增量，避免新客户端一连上就被历史日志刷屏
        logTailPos = fs.existsSync(logTailPath) ? fs.statSync(logTailPath).size : 0;
    } catch (e) {
        logTailPath = null;
    }

    logTailTimer = setInterval(pushLogDelta, LOG_TAIL_INTERVAL);
    if (logTailTimer.unref) logTailTimer.unref();
}

function stopLogTail() {
    if (!logTailTimer) return;
    clearInterval(logTailTimer);
    logTailTimer = null;
}

function pushLogDelta() {
    if (!logTailPath || wsClients.length === 0) return;

    try {
        if (!fs.existsSync(logTailPath)) return;
        const stats = fs.statSync(logTailPath);

        // 日志被轮转 / 截断：游标归零重读，否则 pos > size 会永久卡死
        if (stats.size < logTailPos) logTailPos = 0;
        if (stats.size === logTailPos) return;

        const pending = stats.size - logTailPos;
        const start = pending > LOG_TAIL_MAX_CHUNK ? stats.size - LOG_TAIL_MAX_CHUNK : logTailPos;
        const len = stats.size - start;

        const buf = Buffer.alloc(len);
        const fd = fs.openSync(logTailPath, 'r');
        try {
            fs.readSync(fd, buf, 0, len, start);
        } finally {
            fs.closeSync(fd);
        }
        logTailPos = stats.size;

        const lines = buf.toString('utf8').split(/\r?\n/).filter(l => l.trim());
        for (const line of lines) {
            for (const client of wsClients) {
                try {
                    client.emit('log', { line, timestamp: Date.now() });
                } catch (e) { /* 忽略单个客户端异常 */ }
            }
        }
    } catch (e) {
        // 读取失败（文件被占用 / 权限）静默跳过，下一轮再试
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
                fieldName,
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
    // V3.5.16
    startTunnelForLocal,
    stopTunnelHandle,
    isExposedHost,
    // V3.5.24：隧道认证闸门（测试与预检用）
    checkTunnelAuth,
    TUNNEL_AUTH_ERR,
    // V3.5.19：供 CLI 长命令模式接管回显、供测试直接验证清洗逻辑
    setEchoSink,
    sanitizeCommandText,
    flattenConfigPatch,
    webCliEcho,
    systemEcho,
    // V3.5.25：方案同步（multipart 解析复用）
    parseMultipart,
    isRunning: () => isRunning
};