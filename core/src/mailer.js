/**
 * SMTP 邮件模块
 * - 发送验证码邮件（登录验证）
 * - 发送错误报告（服务器崩溃时）
 * - 定时发送日志摘要
 */

const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs-extra');
const config = require('./config');
const utils = require('./utils');
// V3.5.0：事件日志
const { logger } = require('./log');

class Mailer {
    constructor() {
        // V3.5.3：SMTP 凭据允许用环境变量承载（WOW_MAIL_SMTP_USER / WOW_MAIL_SMTP_PASS），避免明文落 wow.yaml
        const smtp = config.getConfig('mail.smtp', {}) || {};
        const resolved = Object.assign({}, smtp);
        if (process.env.WOW_MAIL_SMTP_USER) resolved.user = process.env.WOW_MAIL_SMTP_USER;
        if (process.env.WOW_MAIL_SMTP_PASS) resolved.pass = process.env.WOW_MAIL_SMTP_PASS;
        this.smtpConfig = resolved;
        this.adminEmail = config.getConfig('mail.admin_email', null);
        this.sendOnCrash = config.getConfig('mail.send_on_crash', true);
        this.sendLogsInterval = config.getConfig('mail.send_logs_interval', 0); // 小时
        this.whitelist = Mailer.loadWhitelist();
        this.transporter = null;
        this._initTransporter();
    }

    /**
     * 读取登录邮箱白名单（V3.5.8）。
     *
     * 配置项主键是 mail.whitelist（与 admin_email / send_on_crash 同风格，全小写下划线）。
     * 同时兼容 mail.WhiteList / mail.whiteList 写法，避免手写 YAML 时因大小写踩坑。
     * 支持三种写法：YAML 列表、逗号分隔字符串、单个邮箱字符串。
     * 空 = 不限制（向后兼容）；含 "*" = 放开所有邮箱。
     */
    static loadWhitelist() {
        let raw = null;
        for (const key of ['mail.whitelist', 'mail.WhiteList', 'mail.whiteList']) {
            const v = config.getConfig(key, null);
            if (v !== null && v !== undefined) { raw = v; break; }
        }
        return Mailer.normalizeWhitelist(raw);
    }

    /**
     * 归一化白名单：统一小写、去空白、去重，并滤掉非法项。
     * 返回值里可能包含 '*'（通配）。
     */
    static normalizeWhitelist(raw) {
        let list = [];
        if (Array.isArray(raw)) {
            list = raw;
        } else if (typeof raw === 'string') {
            list = raw.split(/[,;\s]+/);
        } else if (raw && typeof raw === 'object') {
            // 兼容 { a@b.com: true } 这种 YAML 映射写法
            list = Object.keys(raw).filter(k => raw[k]);
        }
        const out = [];
        for (const item of list) {
            const s = String(item == null ? '' : item).trim();
            if (!s) continue;
            const lower = s.toLowerCase();
            // '*' 通配所有；其余必须是形如 x@y.z 的邮箱
            if (lower !== '*' && !Mailer.isValidEmailStatic(lower)) continue;
            if (!out.includes(lower)) out.push(lower);
        }
        return out;
    }

    static isValidEmailStatic(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
    }

    /**
     * 判断某邮箱是否允许登录 Web 面板。
     * 语义（V3.5.8）：白名单为空 → 不限制；否则必须在名单内（或名单含 '*'）。
     * @returns {{allowed: boolean, reason: string}}
     */
    isEmailAllowed(email) {
        const wl = this.whitelist || [];
        if (wl.length === 0) return { allowed: true, reason: '白名单未配置，不限制' };
        if (wl.includes('*')) return { allowed: true, reason: '白名单通配放开' };
        const target = String(email || '').trim().toLowerCase();
        if (!target) return { allowed: false, reason: '邮箱为空' };
        if (wl.includes(target)) return { allowed: true, reason: '在白名单内' };
        return { allowed: false, reason: '邮箱不在白名单内' };
    }

    /**
     * 初始化邮件传输器
     */
    _initTransporter() {
        if (this.smtpConfig.host && this.smtpConfig.user && this.smtpConfig.pass) {
            this.transporter = nodemailer.createTransport({
                host: this.smtpConfig.host,
                port: this.smtpConfig.port || 587,
                secure: this.smtpConfig.port === 465,
                auth: {
                    user: this.smtpConfig.user,
                    pass: this.smtpConfig.pass
                },
                tls: {
                    rejectUnauthorized: false
                }
            });
        }
    }

    /**
     * 检查是否已配置 SMTP
     */
    isConfigured() {
        return !!this.transporter;
    }

    /**
     * 生成6位数字验证码
     */
    generateCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    /**
     * 发送邮件
     */
    async sendMail(to, subject, html, text = null) {
        if (!this.isConfigured()) {
            console.warn('SMTP 未配置，邮件未发送');
            return { success: false, error: 'SMTP 未配置' };
        }

        try {
            const info = await this.transporter.sendMail({
                from: this.smtpConfig.from || this.smtpConfig.user,
                to: to,
                subject: subject,
                text: text || html.replace(/<[^>]*>/g, ''),
                html: html
            });

            // 检查是否有被拒收的收件人
            if (info.rejected && info.rejected.length > 0) {
                console.warn(`邮件被拒收: ${info.rejected.join(', ')}`);
                logger.warn(`邮件被拒收: ${to} (${info.rejected.join(', ')})`);
                return {
                    success: false,
                    error: `邮件被拒收: ${info.rejected.join(', ')}`,
                    rejected: info.rejected
                };
            }

            console.log(`邮件已发送: ${info.messageId}`);
            logger.info(`邮件已发送: ${to} (${info.messageId})`);
            return {
                success: true,
                messageId: info.messageId,
                accepted: info.accepted
            };
        } catch (e) {
            console.error(`邮件发送失败: ${e.message}`);
            logger.erro(`邮件发送失败: ${to} -> ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    /**
     * 测试邮件配置，发送验证码到管理员邮箱
     */
    async test() {
        if (!this.adminEmail) {
            console.log('⚠️ 未配置管理员邮箱 (mail.admin_email)');
            return { success: false, error: '未配置管理员邮箱' };
        }
        const code = this.generateCode();
        const result = await this.sendVerificationCode(this.adminEmail, code);
        if (result.success) {
            console.log(`✅ 测试邮件已发送到 ${this.adminEmail}`);
            console.log(`   📧 验证码: ${code} (5分钟内有效)`);
        }
        return result;
    }

    /**
     * 发送验证码
     */
    async sendVerificationCode(email, code) {
        const subject = '[wow] 邮箱验证码';
        const html = `
            <h1>wow 验证码</h1>
            <p>您正在尝试登录 wow 管理面板。</p>
            <p>验证码: <strong style="font-size:24px;">${code}</strong></p>
            <p>此验证码 5 分钟内有效。</p>
            <p>如果您没有请求此验证码，请忽略此邮件。</p>
            <hr>
            <small>wow Minecraft 服务器管理工具</small>
        `;
        return this.sendMail(email, subject, html);
    }

    /**
     * 发送崩溃报告
     */
    async sendCrashReport(crashInfo, logContent) {
        if (!this.sendOnCrash || !this.adminEmail) {
            logger.warn('崩溃报告未发送：邮件未配置或未启用崩溃报告');
            return { success: false, error: '邮件未配置或未启用崩溃报告' };
        }
        logger.impt(`准备发送崩溃报告: ${crashInfo.type || '未知'} | ${crashInfo.time || crashInfo.timestamp || '未知时间'}`);
        // 兼容 CLI 传参格式：timestamp -> time, message -> error
        const time = crashInfo.time || crashInfo.timestamp || '未知时间';
        const version = crashInfo.version || '未知';
        const type = crashInfo.type || '未知';
        const memory = crashInfo.memory || '未知';
        const error = crashInfo.error || crashInfo.message || '未捕获错误';

        const subject = `[wow 崩溃报告] ${time}`;
        const html = `
            <h1>⚠️ 服务器崩溃报告</h1>
            <p><strong>时间:</strong> ${time}</p>
            <p><strong>服务器版本:</strong> ${version}</p>
            <p><strong>核心类型:</strong> ${type}</p>
            <p><strong>可用内存:</strong> ${memory}</p>
            <hr>
            <h2>错误信息</h2>
            <pre style="background:#f4f4f4;padding:10px;border-radius:5px;overflow:auto;max-height:300px;">${error}</pre>
            <h2>最近日志</h2>
            <pre style="background:#f4f4f4;padding:10px;border-radius:5px;overflow:auto;max-height:400px;">${logContent || '无日志'}</pre>
            <hr>
            <small>wow Minecraft 服务器管理工具</small>
        `;
        return this.sendMail(this.adminEmail, subject, html);
    }

    /**
     * 发送定时日志摘要
     */
    async sendLogSummary() {
        const interval = this.sendLogsInterval;
        if (!interval || interval <= 0 || !this.adminEmail) return;

        // 读取最近日志
        const serverDir = utils.getServerDir();
        const logFile = path.join(serverDir, 'logs', 'latest.log');
        if (!fs.existsSync(logFile)) return;

        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split('\n');
        const last = lines.slice(-200).join('\n');

        const subject = `[wow 日志摘要] ${new Date().toLocaleString()}`;
        const html = `
            <h1>📋 服务器日志摘要</h1>
            <p><strong>时间:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>总行数:</strong> ${lines.length}</p>
            <hr>
            <h2>最新 200 行</h2>
            <pre style="background:#f4f4f4;padding:10px;border-radius:5px;overflow:auto;max-height:500px;">${last}</pre>
            <hr>
            <small>wow Minecraft 服务器管理工具</small>
        `;
        return this.sendMail(this.adminEmail, subject, html);
    }

    /**
     * 验证邮箱地址格式
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
}

module.exports = Mailer;