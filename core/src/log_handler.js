/**
 * 日志处理模块
 * - 实时查看日志 (tail)
 * - AI 分析日志 (支持 OpenAI/兼容 API)
 * - 生成日志报告
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const utils = require('./utils');
const config = require('./config');

class LogHandler {
    constructor() {
        this.serverDir = utils.getServerDir();
        this.logFile = path.join(this.serverDir, 'logs', 'latest.log');
        this.crashReportsDir = path.join(this.serverDir, 'crash-reports');
    }

    /**
     * 实时查看日志 (tail -f)
     */
    tail() {
        if (!fs.existsSync(this.logFile)) {
            console.log('日志文件不存在');
            return;
        }

        console.log(`实时查看日志: ${this.logFile}`);
        console.log('按 Ctrl+C 退出');

        const tail = spawn('tail', ['-f', this.logFile], { stdio: 'inherit' });
        process.on('SIGINT', () => {
            tail.kill();
            process.exit(0);
        });
    }

    /**
     * AI 分析日志
     */
    async analyze(options = {}) {
        const apiKey = options.apiKey || config.getConfig('ai.api_key');
        const model = options.model || config.getConfig('ai.model') || 'gpt-3.5-turbo';
        const apiUrl = options.apiUrl || config.getConfig('ai.api_url') || 'https://api.openai.com/v1/chat/completions';

        if (!apiKey) {
            console.error('❌ 未配置 AI API Key，请在 wow.yaml 中设置 ai.api_key');
            return;
        }

        // 检查服务器是否正在运行（分析需要服务器关闭）
        const ServerManager = require('./server');
        const server = new ServerManager();
        if (server.isRunning()) {
            console.log('⚠️ 服务器正在运行，请先停止服务器再进行日志分析');
            console.log('   wow server stop');
            return;
        }

        // 读取日志内容（最后 500 行）
        if (!fs.existsSync(this.logFile)) {
            console.log('日志文件不存在');
            return;
        }

        const content = fs.readFileSync(this.logFile, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        const recentLines = lines.slice(-500).join('\n');

        if (!recentLines.trim()) {
            console.log('日志为空');
            return;
        }

        console.log('📊 正在分析日志...');
        console.log(`   模型: ${model}`);
        console.log(`   日志行数: ${lines.length} (分析最近 500 行)`);

        // 构建提示词
        const prompt = `你是一个 Minecraft 服务器故障分析专家。请分析以下服务器日志，找出可能的问题并提供解决方案。

日志内容:
${recentLines}

请按以下格式输出:
1. 问题摘要 (一句话概述)
2. 具体错误 (列出关键错误信息)
3. 可能的原因 (列出可能的原因)
4. 解决方案 (给出具体的操作步骤)
5. 严重程度 (高/中/低)

注意: 如果日志中没有明显错误，请说明 "未检测到明显问题"。

请用中文回答。`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: '你是一个 Minecraft 服务器故障分析专家。' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 请求失败 (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            const analysis = data.choices?.[0]?.message?.content || '分析失败，请稍后重试。';

            console.log('\n' + '='.repeat(60));
            console.log('📋 日志分析报告');
            console.log('='.repeat(60));
            console.log(analysis);
            console.log('='.repeat(60));

            // 可选：保存报告
            const reportPath = path.join(this.serverDir, 'logs', 'analysis_report.txt');
            fs.writeFileSync(reportPath, `[${new Date().toISOString()}]\n${analysis}`, 'utf8');
            console.log(`\n✅ 报告已保存: ${reportPath}`);

        } catch (e) {
            console.error(`❌ AI 分析失败: ${e.message}`);
        }
    }

    /**
     * 生成日志分析报告（不调用 AI，仅统计和摘要）
     */
    report() {
        if (!fs.existsSync(this.logFile)) {
            console.log('日志文件不存在');
            return;
        }

        const content = fs.readFileSync(this.logFile, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());

        // 统计错误类型
        const errors = {
            error: 0,
            warn: 0,
            info: 0,
            fatal: 0,
            exception: 0
        };

        const errorMessages = [];

        for (const line of lines) {
            if (line.includes('[ERROR]') || line.includes('ERROR:')) {
                errors.error++;
                if (line.includes('Exception') || line.includes('Error:')) {
                    errorMessages.push(line.trim());
                }
            } else if (line.includes('[WARN]') || line.includes('WARN:')) {
                errors.warn++;
            } else if (line.includes('[INFO]') || line.includes('INFO:')) {
                errors.info++;
            } else if (line.includes('FATAL') || line.includes('fatal:')) {
                errors.fatal++;
            }
            if (line.includes('Exception')) {
                errors.exception++;
            }
        }

        // 生成报告
        console.log('\n' + '='.repeat(60));
        console.log('📄 日志统计报告');
        console.log('='.repeat(60));
        console.log(`总行数: ${lines.length}`);
        console.log(`错误: ${errors.error}`);
        console.log(`警告: ${errors.warn}`);
        console.log(`信息: ${errors.info}`);
        console.log(`严重错误: ${errors.fatal}`);
        console.log(`异常: ${errors.exception}`);
        console.log('='.repeat(60));

        if (errorMessages.length > 0) {
            console.log('\n📌 最近错误信息 (最多 10 条):');
            for (const msg of errorMessages.slice(-10)) {
                console.log(`  ${msg}`);
            }
        }

        // 检查崩溃报告
        if (fs.existsSync(this.crashReportsDir)) {
            const crashFiles = fs.readdirSync(this.crashReportsDir);
            if (crashFiles.length > 0) {
                console.log(`\n💥 发现 ${crashFiles.length} 个崩溃报告文件`);
                console.log(`  目录: ${this.crashReportsDir}`);
            }
        }

        console.log('\n✅ 报告生成完成');
    }

    /**
     * 获取最近 N 行日志
     */
    getRecentLogs(n = 100) {
        if (!fs.existsSync(this.logFile)) {
            return [];
        }
        const content = fs.readFileSync(this.logFile, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        return lines.slice(-n);
    }

    /**
     * 获取崩溃报告列表
     */
    getCrashReports() {
        if (!fs.existsSync(this.crashReportsDir)) {
            return [];
        }
        return fs.readdirSync(this.crashReportsDir)
            .filter(f => f.endsWith('.txt'))
            .map(f => ({
                name: f,
                path: path.join(this.crashReportsDir, f),
                size: fs.statSync(path.join(this.crashReportsDir, f)).size
            }));
    }
}

module.exports = LogHandler;