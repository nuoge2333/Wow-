#!/usr/bin/env node

/**
 * wow - Minecraft 服务器管理工具
 * 主入口：解析子命令，调用对应模块
 */

const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const program = new Command();

// 导入模块
const config = require('./config');
const utils = require('./utils');
const ServerManager = require('./server');
const Installer = require('./installer');
const ModManager = require('./mod_manager');
const SchemeManager = require('./scheme_manager');
const ThemeManager = require('./theme_manager');
const JreManager = require('./jre_manager');
const PackGenerator = require('./pack_generator');
const LogHandler = require('./log_handler');
const Mailer = require('./mailer');
const { startWeb, stopWeb, webStatus } = require('./web_service');
const Terracotta = require('./terracotta');

// ==================== 配置与初始化 ====================

program
    .name('wow')
    .description('Minecraft 服务器管理工具 - 默认优先，可以修改')
    .version('3.3.6', '-V');

// ==================== init ====================

program
    .command('init')
    .description('初始化环境（创建目录、检测Java）')
    .action(() => {
        console.log('正在初始化 wow 环境...');

        // 创建必要目录
        const dirs = [
            utils.resolvePath('../server'),
            utils.resolvePath('../themes'),
            utils.resolvePath('../themes/default'),
            utils.resolvePath('pool/cores'),
            utils.resolvePath('pool/mods'),
            utils.resolvePath('pool/plugins'),
            utils.resolvePath('pool/loader'),
            utils.resolvePath('jre'),
            utils.resolvePath('schemes')
        ];
        for (const d of dirs) {
            fs.ensureDirSync(d);
        }
        console.log('✅ 目录结构已创建');

        // 检测 Java
        const javaPath = utils.detectJava();
        if (javaPath) {
            config.setConfig('server.java', javaPath);
            console.log(`✅ Java 已检测到: ${javaPath}`);
        } else {
            console.log('⚠️ 未检测到 Java，将使用自动下载的 JRE');
        }

        // 生成默认主题 - 复制 web/ 目录作为基础主题
        const defaultTheme = utils.resolvePath('../themes/default');
        const webSource = utils.resolvePath('./web');
        if (!fs.existsSync(path.join(defaultTheme, 'theme.json'))) {
            // 复制 web/ 目录内容到 themes/default/
            if (fs.existsSync(webSource)) {
                fs.copySync(webSource, defaultTheme);
            }
            // 确保 theme.json 存在
            if (!fs.existsSync(path.join(defaultTheme, 'theme.json'))) {
                fs.writeFileSync(path.join(defaultTheme, 'theme.json'), JSON.stringify({
                    name: 'default',
                    author: 'wow Team',
                    version: '1.0.0',
                    compatible: '3.1.0',
                    description: '默认主题'
                }, null, 2));
            }
            console.log('✅ 默认主题已创建');
        }

        // 生成默认配置
        if (!fs.existsSync(utils.resolvePath('../wow.yaml'))) {
            config.saveConfig(config.DEFAULT_CONFIG);
            console.log('✅ 配置文件已创建: core/wow.yaml');
        }

        console.log('\n✅ 初始化完成！');
        console.log('运行命令:');
        console.log('  wow server start   - 启动服务器');
        console.log('  wow web start      - 启动 Web 面板');
        console.log('  wow install <类型> <版本> - 安装服务端');
        console.log('  wow help           - 查看帮助');
    });

// ==================== set ====================

program
    .command('set <key> <value>')
    .description('设置配置项')
    .action((key, value) => {
        config.setConfig(key, value);
        console.log(`✅ 设置已更新: ${key} = ${value}`);
    });

// ==================== server ====================

const serverCmd = program.command('server').description('服务器管理');

serverCmd
    .command('start')
    .description('启动服务器')
    .option('-m, --memory <size>', '内存分配，如 4G')
    .option('--jvm-args <args>', '额外 JVM 参数')
    .action(async (options) => {
        const server = new ServerManager();
        await server.start(options.memory, options.jvmArgs);
    });

serverCmd
    .command('stop')
    .description('正常停止服务器')
    .action(async () => {
        const server = new ServerManager();
        await server.stop();
    });

serverCmd
    .command('kill')
    .description('强制终止服务器')
    .action(() => {
        const server = new ServerManager();
        server.kill();
    });

serverCmd
    .command('restart')
    .description('重启服务器')
    .option('-m, --memory <size>', '内存分配')
    .option('--jvm-args <args>', '额外 JVM 参数')
    .action(async (options) => {
        const server = new ServerManager();
        await server.restart(options.memory, options.jvmArgs);
    });

serverCmd
    .command('status')
    .description('查看服务器状态')
    .action(() => {
        const server = new ServerManager();
        server.status();
    });

// ==================== install ====================

program
    .command('install <target> [version]')
    .description('安装服务端核心 或 下载任意 URL 文件')
    .option('-b, --build <number>', '构建号（仅 Mohist 需要）')
    .option('-o, --output <path>', '输出路径（仅 URL 下载时有效）')
    .action(async (target, version, options) => {
        const installer = new Installer();
        try {
            if (target.startsWith('http://') || target.startsWith('https://')) {
                const output = options.output || path.join(utils.getServerDir(), path.basename(target));
                await installer.downloadFile(target, output);
            } else {
                await installer.install(target, version, options.build);
            }
        } catch (e) {
            console.error(`❌ 操作失败: ${e.message}`);
        }
    });

// ==================== mod ====================

const modCmd = program.command('mod').description('模组管理');

modCmd
    .command('remove <name>')
    .description('卸载模组')
    .action((name) => {
        const modManager = new ModManager();
        modManager.remove(name);
    });

modCmd
    .command('list')
    .description('列出已安装模组')
    .option('--loader <loader>', '过滤加载器')
    .option('-v, --mc-version <version>', '过滤版本')
    .action((options) => {
        const modManager = new ModManager();
        const mods = modManager.listMods(options.loader, options.mcVersion);
        if (mods.length === 0) {
            console.log('未安装模组');
            return;
        }
        console.log(`共 ${mods.length} 个模组:`);
        for (const mod of mods) {
            console.log(`  ${mod.enabled ? '✅' : '❌'} ${mod.name} (${mod.loader}/${mod.version})`);
        }
    });

modCmd
    .command('toggle <name>')
    .description('启用/禁用模组')
    .action((name) => {
        const modManager = new ModManager();
        modManager.toggleMod(name);
    });

modCmd
    .command('sync')
    .description('从 pool 同步模组到当前方案')
    .option('--loader <loader>', '加载器')
    .option('-v, --mc-version <version>', '版本')
    .action((options) => {
        const modManager = new ModManager();
        const loader = options.loader || 'forge';
        const version = options.mcVersion || '1.20.1';
        modManager.syncFromPool(loader, version);
    });

// ==================== scheme ====================

const schemeCmd = program.command('scheme').description('方案管理');

schemeCmd
    .command('create <name>')
    .description('创建新方案')
    .option('-v, --mc-version <version>', 'Minecraft 版本 (默认: 1.20.1)')
    .option('--loader <loader>', '模组加载器 (forge/fabric/neoforge/quilt)')
    .option('--type <type>', '核心类型 (vanilla/forge/mohist/catserver/paper)')
    .option('--build <number>', '构建号（仅 Mohist 需要）')
    .action(async (name, options) => {
        const schemeManager = new SchemeManager();
        try {
            await schemeManager.create(name, {
                version: options.mcVersion || '1.20.1',
                loader: options.loader || 'forge',
                type: options.type || 'vanilla',
                build: options.build
            });
        } catch (e) {
            console.error(`❌ 创建失败: ${e.message}`);
        }
    });

schemeCmd
    .command('list')
    .description('列出所有方案')
    .action(() => {
        const schemeManager = new SchemeManager();
        const schemes = schemeManager.list();
        if (schemes.length === 0) {
            console.log('没有方案');
            return;
        }
        console.log('方案列表:');
        for (const s of schemes) {
            const active = s.active ? ' (当前)' : '';
            console.log(`  ${s.active ? '▶' : ' '} ${s.name} - ${s.version} (${s.loader})${active}`);
        }
    });

schemeCmd
    .command('switch <name>')
    .description('切换到指定方案')
    .action(async (name) => {
        const schemeManager = new SchemeManager();
        try {
            await schemeManager.switch(name);
        } catch (e) {
            console.error(`❌ 切换失败: ${e.message}`);
        }
    });

schemeCmd
    .command('delete <name>')
    .description('删除方案')
    .action((name) => {
        const schemeManager = new SchemeManager();
        try {
            schemeManager.delete(name);
        } catch (e) {
            console.error(`❌ 删除失败: ${e.message}`);
        }
    });

schemeCmd
    .command('info [name]')
    .description('查看方案信息')
    .action((name) => {
        const schemeManager = new SchemeManager();
        const target = name || schemeManager.currentScheme;
        if (!target) {
            console.log('未指定方案且无当前方案');
            return;
        }
        try {
            const meta = schemeManager._loadSchemeMeta(target);
            console.log(`方案: ${target}`);
            console.log(`  版本: ${meta.version}`);
            console.log(`  加载器: ${meta.loader}`);
            console.log(`  类型: ${meta.type}`);
            console.log(`  创建时间: ${meta.created_at}`);
            console.log(`  模组数: ${(meta.mods || []).length}`);
            console.log(`  兼容性: Java ${meta.compatibility?.java || '未知'}`);
        } catch (e) {
            console.error(`❌ 获取信息失败: ${e.message}`);
        }
    });

// ==================== theme ====================

const themeCmd = program.command('theme').description('主题包管理');

themeCmd
    .command('install <source>')
    .description('安装主题包（ZIP 文件路径）')
    .action(async (source) => {
        const themeManager = new ThemeManager();
        try {
            await themeManager.install(source);
        } catch (e) {
            console.error(`❌ 安装失败: ${e.message}`);
        }
    });

themeCmd
    .command('list')
    .description('列出已安装主题')
    .action(() => {
        const themeManager = new ThemeManager();
        const themes = themeManager.list();
        if (themes.length === 0) {
            console.log('没有主题包');
            return;
        }
        console.log('主题列表:');
        for (const t of themes) {
            const active = t.active ? ' (当前)' : '';
            console.log(`  ${t.active ? '▶' : ' '} ${t.name} - ${t.author} v${t.version}${active}`);
        }
    });

themeCmd
    .command('switch <name>')
    .description('切换主题')
    .action((name) => {
        const themeManager = new ThemeManager();
        try {
            themeManager.switch(name);
        } catch (e) {
            console.error(`❌ 切换失败: ${e.message}`);
        }
    });

themeCmd
    .command('delete <name>')
    .description('删除主题')
    .action((name) => {
        const themeManager = new ThemeManager();
        try {
            themeManager.delete(name);
        } catch (e) {
            console.error(`❌ 删除失败: ${e.message}`);
        }
    });

themeCmd
    .command('info <name>')
    .description('查看主题信息')
    .action((name) => {
        const themeManager = new ThemeManager();
        try {
            const info = themeManager.getInfo(name);
            console.log(`主题: ${info.name}`);
            console.log(`  作者: ${info.author}`);
            console.log(`  版本: ${info.version}`);
            console.log(`  兼容: wow ${info.compatible}`);
            console.log(`  描述: ${info.description}`);
            console.log(`  路径: ${info.path}`);
        } catch (e) {
            console.error(`❌ 获取信息失败: ${e.message}`);
        }
    });

// ==================== web ====================

const webCmd = program.command('web').description('Web 管理面板');

webCmd
    .command('start')
    .description('启动 Web 服务')
    .option('-p, --port <port>', '端口')
    .option('--host <host>', '绑定地址')
    .action((options) => {
        startWeb({
            port: options.port,
            host: options.host
        });
    });

webCmd
    .command('stop')
    .description('停止 Web 服务')
    .action(() => {
        stopWeb();
    });

webCmd
    .command('status')
    .description('查看 Web 服务状态')
    .action(() => {
        webStatus();
    });

// ==================== lan (V3.3.0 陶瓦内网穿透 / 联机) ====================

const lanCmd = program.command('lan').description('联机 / 内网穿透（陶瓦 Terracotta）');

lanCmd
    .command('host')
    .description('我要当房主：开房让好友联机（自动下载并启动陶瓦）')
    .option('-r, --room <code>', '指定固定房间号（留空则自动生成）')
    .action(async (options) => {
        try {
            const { roomCode } = await Terracotta.hostRoom({ roomCode: options.room });
            console.log(`\n🎮 好友在 PCL / HMCL / BakaXL / FCL 中选择「加入陶瓦房间」并输入房间号 ${roomCode} 即可联机。`);
        } catch (e) {
            console.error(`❌ 开房失败: ${e.message}`);
        }
    });

lanCmd
    .command('stop')
    .description('关闭联机房间（停止陶瓦）')
    .action(async () => {
        try {
            await Terracotta.stopHost();
        } catch (e) {
            console.error(`❌ 关房失败: ${e.message}`);
        }
    });

lanCmd
    .command('status')
    .description('查看联机房间状态 / 房间号')
    .action(async () => {
        try {
            const s = await Terracotta.getStatus();
            if (!s.running) {
                console.log('当前未开房（陶瓦未运行）。使用 `wow lan host` 开房。');
                return;
            }
            console.log('🏠 联机房间状态:');
            console.log(`  运行状态:  🟢 运行中`);
            console.log(`  本地 API:  127.0.0.1:${s.port}`);
            console.log(`  房间号:    ${s.roomCode || '(生成中)'}`);
            console.log(`  状态机:    ${s.state || '未知'}`);
            if (s.roomCode) {
                console.log(`\n  把房间号发给好友，对方在 PCL / HMCL / BakaXL / FCL 中选择「加入陶瓦房间」并输入该房间号即可联机。`);
            }
            console.log(`  ${Terracotta.getCopyright()}`);
        } catch (e) {
            console.error(`❌ 查询失败: ${e.message}`);
        }
    });

// ==================== pack ====================

const packCmd = program.command('pack').description('整合包管理');

packCmd
    .command('install <source>')
    .description('安装客户端整合包（支持 ZIP 文件或 URL）')
    .action(async (source) => {
        const pack = new PackGenerator();
        try {
            await pack.install(source);
        } catch (e) {
            console.error(`❌ 安装失败: ${e.message}`);
        }
    });

packCmd
    .command('generate <name>')
    .description('生成客户端整合包')
    .option('-v, --mc-version <version>', 'Minecraft 版本')
    .option('--loader <loader>', '模组加载器 (forge/fabric)')
    .option('--output <path>', '输出目录')
    .action(async (name, options) => {
        const pack = new PackGenerator();
        try {
            await pack.generate(name, { ...options, version: options.mcVersion });
        } catch (e) {
            console.error(`❌ 生成失败: ${e.message}`);
        }
    });

// ==================== logs ====================

const logsCmd = program.command('logs').description('日志与 AI 分析');

logsCmd
    .command('tail')
    .description('实时查看日志')
    .action(() => {
        const log = new LogHandler();
        log.tail();
    });

logsCmd
    .command('analyze')
    .description('分析日志（AI 分析，需服务器关闭）')
    .option('--api-key <key>', 'AI API 密钥（覆盖配置）')
    .option('--model <model>', '模型名称')
    .option('--api-url <url>', 'API 端点')
    .action(async (options) => {
        const log = new LogHandler();
        await log.analyze(options);
    });

logsCmd
    .command('report')
    .description('生成日志分析报告（不调用 AI）')
    .action(() => {
        const log = new LogHandler();
        log.report();
    });

// ==================== down ====================

program
    .command('down <url>')
    .description('下载文件')
    .option('-o, --output <path>', '输出路径')
    .action(async (url, options) => {
        const output = options.output || path.join(utils.resolvePath('../temp'), path.basename(url));
        console.log(`下载: ${url}`);
        console.log(`  保存到: ${output}`);

        const axios = require('axios');
        const ProgressBar = require('progress');
        fs.ensureDirSync(path.dirname(output));

        try {
            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 300000
            });

            const total = parseInt(response.headers['content-length'] || '0', 10);
            const progress = new ProgressBar(`  下载 [:bar] :percent :etas`, {
                width: 40,
                complete: '=',
                incomplete: ' ',
                total: total || 1
            });

            const writer = fs.createWriteStream(output);
            response.data.on('data', (chunk) => progress.tick(chunk.length));
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            console.log(`✅ 下载完成: ${output}`);
        } catch (e) {
            console.error(`❌ 下载失败: ${e.message}`);
        }
    });

// ==================== config ====================

const configCmd = program.command('config').description('配置管理');

configCmd
    .command('wow <key> [value]')
    .description('查看/设置启动器配置')
    .action((key, value) => {
        if (value !== undefined) {
            config.setConfig(key, value);
            console.log(`✅ ${key} = ${value}`);
        } else {
            const val = config.getConfig(key);
            console.log(`${key} = ${val !== undefined ? val : 'null'}`);
        }
    });

configCmd
    .command('server <key> [value]')
    .description('查看/设置 server.properties')
    .action((key, value) => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        if (value !== undefined) {
            props.set(key, value);
            console.log(`✅ server.properties ${key} = ${value}`);
        } else {
            const val = props.get(key);
            console.log(`server.properties ${key} = ${val !== undefined ? val : 'null'}`);
        }
    });

configCmd
    .command('white <action> [player]')
    .description('白名单管理 (add/remove/list)')
    .action((action, player) => {
        const WhitelistManager = require('./config').WhitelistManager;
        const wl = new WhitelistManager(utils.getServerDir());

        if (action === 'list') {
            const list = wl.list();
            console.log('白名单:');
            for (const p of list) {
                console.log(`  ${p}`);
            }
            if (list.length === 0) console.log('  空');
        } else if (action === 'add' && player) {
            wl.add(player);
            console.log(`✅ ${player} 已添加到白名单`);
        } else if (action === 'remove' && player) {
            wl.remove(player);
            console.log(`✅ ${player} 已从白名单移除`);
        } else {
            console.log('用法: config white <add|remove|list> [player]');
        }
    });

// ==================== mail ====================

const mailCmd = program.command('mail').description('邮件管理');

// 频率限制：15分钟/次
const MAIL_RATE_LIMIT_FILE = path.join(__dirname, '../.mail_last_sent');
const MAIL_RATE_LIMIT_MS = 15 * 60 * 1000; // 15分钟

function checkMailRateLimit() {
    if (!fs.existsSync(MAIL_RATE_LIMIT_FILE)) {
        fs.writeFileSync(MAIL_RATE_LIMIT_FILE, '0', 'utf8');
        return true;
    }
    const lastSent = parseInt(fs.readFileSync(MAIL_RATE_LIMIT_FILE, 'utf8'), 10);
    const now = Date.now();
    if (now - lastSent < MAIL_RATE_LIMIT_MS) {
        const remaining = Math.ceil((MAIL_RATE_LIMIT_MS - (now - lastSent)) / 1000);
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        console.log(`⏳ 发送频率限制: 请等待 ${minutes} 分 ${seconds} 秒后再试`);
        return false;
    }
    return true;
}

function updateMailRateLimit() {
    fs.writeFileSync(MAIL_RATE_LIMIT_FILE, String(Date.now()), 'utf8');
}

mailCmd
    .command('test')
    .description('测试邮件配置，发送验证码到管理员邮箱')
    .action(async () => {
        if (!checkMailRateLimit()) return;
        const mailer = new Mailer(config);
        await mailer.test();
        updateMailRateLimit();
    });

mailCmd
    .command('send-code <email>')
    .description('发送验证码到指定邮箱（用于登录测试）')
    .action(async (email) => {
        if (!checkMailRateLimit()) return;
        const mailer = new Mailer(config);
        const code = mailer.generateCode();
        const result = await mailer.sendVerificationCode(email, code);
        if (result.success) {
            console.log(`✅ 验证码已发送到 ${email}`);
            console.log(`   📧 验证码: ${code} (5分钟内有效)`);
        } else {
            console.error(`❌ 发送失败: ${result.error}`);
        }
        updateMailRateLimit();
    });

mailCmd
    .command('crash <message>')
    .description('模拟发送崩溃报告（用于测试）')
    .action(async (message) => {
        if (!checkMailRateLimit()) return;
        const mailer = new Mailer(config);
        const result = await mailer.sendCrashReport({
            type: '模拟崩溃',
            message: message || '人工触发的测试崩溃报告',
            timestamp: new Date().toISOString()
        });
        if (result.success) {
            console.log(`✅ 崩溃报告已发送到管理员邮箱`);
        } else {
            console.error(`❌ 发送失败: ${result.error}`);
        }
        updateMailRateLimit();
    });

// ==================== menu (V3.1 新增) ====================

program
    .command('m [num]')
    .description('交互式菜单模式（不带参数进入菜单，带数字直接跳转）')
    .action(async (num) => {
        const { showMainMenu, dispatchMenu } = require('./interactive');

        const options = {
            serverManager: new ServerManager(),
            installer: new Installer(),
            modManager: new ModManager(),
            schemeManager: new SchemeManager(),
            themeManager: new ThemeManager(),
            packGenerator: new PackGenerator(),
            logHandler: new LogHandler(),
            config,
            utils
        };

        if (num) {
            // 直接跳转：wow m 1
            await dispatchMenu(num, options);
        } else {
            // 进入交互式菜单
            await showMainMenu(options);
        }
    });

// ==================== config mods (V3.1 新增) ====================

const configModsCmd = configCmd.command('mods').description('模组配置管理 (config/ 目录)');

configModsCmd
    .command('list')
    .description('列出 config/ 下所有配置文件')
    .option('--format <ext>', '过滤格式 (json/toml/yaml/cfg/properties)')
    .action((options) => {
        const configEditor = require('./config_editor');
        const serverDir = utils.getServerDir();
        const files = configEditor.getConfigFiles(serverDir, options.format);

        if (files.length === 0) {
            console.log('config 目录下没有配置文件');
            return;
        }

        console.log(`配置文件 (${files.length}):`);
        for (const f of files) {
            const sizeStr = utils.formatFileSize(f.size);
            console.log(`  ${sizeStr.padStart(8)} | ${f.ext.padEnd(6)} | ${f.relPath}`);
        }
    });

configModsCmd
    .command('view <file>')
    .description('查看指定配置文件内容')
    .action((file) => {
        const configEditor = require('./config_editor');
        const serverDir = utils.getServerDir();
        const configDir = path.join(serverDir, 'config');

        // 支持相对路径或文件名查找
        let filePath = path.join(configDir, file);
        if (!fs.existsSync(filePath)) {
            // 模糊匹配
            const files = configEditor.getConfigFiles(serverDir);
            const match = files.find(f => f.relPath === file || f.name === file || f.relPath.includes(file));
            if (match) {
                filePath = match.fullPath;
            } else {
                console.error(`❌ 文件不存在: ${file}`);
                return;
            }
        }

        const result = configEditor.readConfig(filePath);
        if (!result.success) {
            console.error(`❌ 读取失败: ${result.error}`);
            return;
        }

        const relPath = path.relative(configDir, filePath);
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`文件: ${relPath} (${result.ext})`);
        if (result.warning) console.log(`⚠ ${result.warning}`);
        console.log('═'.repeat(60));
        if (typeof result.data === 'object') {
            console.log(JSON.stringify(result.data, null, 2));
        } else {
            console.log(result.data);
        }
    });

configModsCmd
    .command('get <file> <key>')
    .description('读取配置文件中的嵌套键值（点号分隔，如 general.enable）')
    .action((file, key) => {
        const configEditor = require('./config_editor');
        const serverDir = utils.getServerDir();
        const configDir = path.join(serverDir, 'config');
        let filePath = path.join(configDir, file);
        if (!fs.existsSync(filePath)) {
            const files = configEditor.getConfigFiles(serverDir);
            const match = files.find(f => f.relPath === file || f.name === file || f.relPath.includes(file));
            if (match) filePath = match.fullPath;
            else {
                console.error(`❌ 文件不存在: ${file}`);
                return;
            }
        }

        const result = configEditor.getConfigValue(filePath, key);
        if (result.success) {
            console.log(`${key} = ${JSON.stringify(result.value)}`);
        } else {
            console.error(`❌ ${result.error}`);
        }
    });

configModsCmd
    .command('set <file> <key> <value>')
    .description('设置配置文件中的嵌套键值（自动备份）')
    .action((file, key, value) => {
        const configEditor = require('./config_editor');
        const serverDir = utils.getServerDir();
        const configDir = path.join(serverDir, 'config');
        let filePath = path.join(configDir, file);
        if (!fs.existsSync(filePath)) {
            const files = configEditor.getConfigFiles(serverDir);
            const match = files.find(f => f.relPath === file || f.name === file || f.relPath.includes(file));
            if (match) filePath = match.fullPath;
            else {
                console.error(`❌ 文件不存在: ${file}`);
                return;
            }
        }

        const result = configEditor.setConfigValue(filePath, key, value);
        if (result.success) {
            console.log(`✅ ${key} = ${value}`);
            if (result.backupPath) console.log(`   备份: ${result.backupPath}`);
        } else {
            console.error(`❌ ${result.error}`);
        }
    });

// ==================== config server 增强 (V3.1) ====================

configCmd
    .command('server-list')
    .description('分类列出所有 server.properties 属性')
    .action(() => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        props.listAll();
    });

configCmd
    .command('server-quick')
    .description('server.properties 快速设置向导')
    .action(async () => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        await props.quickSet();
    });

configCmd
    .command('server-reset <key>')
    .description('重置 server.properties 属性为默认值')
    .action((key) => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        const result = props.reset(key);
        console.log(`✅ ${result.key} 已重置为 ${result.value}`);
    });

// ==================== 解析执行 ====================

program.parse(process.argv);