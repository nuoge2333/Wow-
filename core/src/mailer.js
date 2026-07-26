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

class Mailer {
    constructor() {
        this.smtpConfig = config.getConfig('mail.smtp', {});
        this.adminEmail = config.getConfig('mail.admin_email', null);
        this.sendOnCrash = config.getConfig('mail.send_on_crash', true);
        this.sendLogsInterval = config.getConfig('mail.send_logs_interval', 0); // 小时
        this.transporter = null;
        this._initTransporter();
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
                text: text || html.replace(/<[^>]*>/g, ''), // 简单转换
                html: html
            });
            console.log(`邮件已发送: ${info.messageId}`);
            return { success: true };
        } catch (e) {
            console.error(`邮件发送失败: ${e.message}`);
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
            return { success: false, error: '邮件未配置或未启用崩溃报告' };
        }

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