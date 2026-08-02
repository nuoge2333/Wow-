#!/usr/bin/env node

/**
 * wow - Minecraft æå¡å¨ç®¡çå·¥å·
 * ä¸»å¥å£ï¼è§£æå­å½ä»¤ï¼è°ç¨å¯¹åºæ¨¡å
 */

const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const program = new Command();

// å¯¼å¥æ¨¡å
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

// ==================== éç½®ä¸åå§å ====================

program
    .name('wow')
    .description('Minecraft æå¡å¨ç®¡çå·¥å· - é»è®¤ä¼åï¼å¯ä»¥ä¿®æ¹')
    .version('3.3.1', '-V');

// ==================== init ====================

program
    .command('init')
    .description('åå§åç¯å¢ï¼åå»ºç®å½ãæ£æµJavaï¼')
    .action(() => {
        console.log('æ­£å¨åå§å wow ç¯å¢...');

        // åå»ºå¿è¦ç®å½
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
        console.log('â ç®å½ç»æå·²åå»º');

        // æ£æµ Java
        const javaPath = utils.detectJava();
        if (javaPath) {
            config.setConfig('server.java', javaPath);
            console.log(`â Java å·²æ£æµå°: ${javaPath}`);
        } else {
            console.log('â ï¸ æªæ£æµå° Javaï¼å°ä½¿ç¨èªå¨ä¸è½½ç JRE');
        }

        // çæé»è®¤ä¸»é¢ - å¤å¶ web/ ç®å½ä½ä¸ºåºç¡ä¸»é¢
        const defaultTheme = utils.resolvePath('../themes/default');
        const webSource = utils.resolvePath('./web');
        if (!fs.existsSync(path.join(defaultTheme, 'theme.json'))) {
            // å¤å¶ web/ ç®å½åå®¹å° themes/default/
            if (fs.existsSync(webSource)) {
                fs.copySync(webSource, defaultTheme);
            }
            // ç¡®ä¿ theme.json å­å¨
            if (!fs.existsSync(path.join(defaultTheme, 'theme.json'))) {
                fs.writeFileSync(path.join(defaultTheme, 'theme.json'), JSON.stringify({
                    name: 'default',
                    author: 'wow Team',
                    version: '1.0.0',
                    compatible: '3.1.0',
                    description: 'é»è®¤ä¸»é¢'
                }, null, 2));
            }
            console.log('â é»è®¤ä¸»é¢å·²åå»º');
        }

        // çæé»è®¤éç½®
        if (!fs.existsSync(utils.resolvePath('../wow.yaml'))) {
            config.saveConfig(config.DEFAULT_CONFIG);
            console.log('â éç½®æä»¶å·²åå»º: core/wow.yaml');
        }

        console.log('\nâ åå§åå®æï¼');
        console.log('è¿è¡å½ä»¤:');
        console.log('  wow server start   - å¯å¨æå¡å¨');
        console.log('  wow web start      - å¯å¨ Web é¢æ¿');
        console.log('  wow install <ç±»å> <çæ¬> - å®è£æå¡ç«¯');
        console.log('  wow help           - æ¥çå¸®å©');
    });

// ==================== set ====================

program
    .command('set <key> <value>')
    .description('è®¾ç½®éç½®é¡¹')
    .action((key, value) => {
        config.setConfig(key, value);
        console.log(`â è®¾ç½®å·²æ´æ°: ${key} = ${value}`);
    });

// ==================== server ====================

const serverCmd = program.command('server').description('æå¡å¨ç®¡ç');

serverCmd
    .command('start')
    .description('å¯å¨æå¡å¨')
    .option('-m, --memory <size>', 'åå­åéï¼å¦ 4G')
    .option('--jvm-args <args>', 'é¢å¤ JVM åæ°')
    .action(async (options) => {
        const server = new ServerManager();
        await server.start(options.memory, options.jvmArgs);
    });

serverCmd
    .command('stop')
    .description('æ­£å¸¸åæ­¢æå¡å¨')
    .action(async () => {
        const server = new ServerManager();
        await server.stop();
    });

serverCmd
    .command('kill')
    .description('å¼ºå¶ç»æ­¢æå¡å¨')
    .action(() => {
        const server = new ServerManager();
        server.kill();
    });

serverCmd
    .command('restart')
    .description('éå¯æå¡å¨')
    .option('-m, --memory <size>', 'åå­åé')
    .option('--jvm-args <args>', 'é¢å¤ JVM åæ°')
    .action(async (options) => {
        const server = new ServerManager();
        await server.restart(options.memory, options.jvmArgs);
    });

serverCmd
    .command('status')
    .description('æ¥çæå¡å¨ç¶æ')
    .action(() => {
        const server = new ServerManager();
        server.status();
    });

// ==================== install ====================

program
    .command('install <target> [version]')
    .description('å®è£æå¡ç«¯æ ¸å¿ æ ä¸è½½ä»»æ URL æä»¶')
    .option('-b, --build <number>', 'æå»ºå·ï¼ä» Mohist éè¦ï¼')
    .option('-o, --output <path>', 'è¾åºè·¯å¾ï¼ä» URL ä¸è½½æ¶ææï¼')
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
            console.error(`â æä½å¤±è´¥: ${e.message}`);
        }
    });

// ==================== mod ====================

const modCmd = program.command('mod').description('æ¨¡ç»ç®¡ç');

modCmd
    .command('remove <name>')
    .description('å¸è½½æ¨¡ç»')
    .action((name) => {
        const modManager = new ModManager();
        modManager.remove(name);
    });

modCmd
    .command('list')
    .description('ååºå·²å®è£æ¨¡ç»')
    .option('--loader <loader>', 'è¿æ»¤å è½½å¨')
    .option('-v, --mc-version <version>', 'è¿æ»¤çæ¬')
    .action((options) => {
        const modManager = new ModManager();
        const mods = modManager.listMods(options.loader, options.mcVersion);
        if (mods.length === 0) {
            console.log('æªå®è£æ¨¡ç»');
            return;
        }
        console.log(`å± ${mods.length} ä¸ªæ¨¡ç»:`);
        for (const mod of mods) {
            console.log(`  ${mod.enabled ? 'â' : 'â'} ${mod.name} (${mod.loader}/${mod.version})`);
        }
    });

modCmd
    .command('toggle <name>')
    .description('å¯ç¨/ç¦ç¨æ¨¡ç»')
    .action((name) => {
        const modManager = new ModManager();
        modManager.toggleMod(name);
    });

modCmd
    .command('sync')
    .description('ä» pool åæ­¥æ¨¡ç»å°å½åæ¹æ¡')
    .option('--loader <loader>', 'å è½½å¨')
    .option('-v, --mc-version <version>', 'çæ¬')
    .action((options) => {
        const modManager = new ModManager();
        const loader = options.loader || 'forge';
        const version = options.mcVersion || '1.20.1';
        modManager.syncFromPool(loader, version);
    });

// ==================== scheme ====================

const schemeCmd = program.command('scheme').description('æ¹æ¡ç®¡ç');

schemeCmd
    .command('create <name>')
    .description('åå»ºæ°æ¹æ¡')
    .option('-v, --mc-version <version>', 'Minecraft çæ¬ (é»è®¤: 1.20.1)')
    .option('--loader <loader>', 'æ¨¡ç»å è½½å¨ (forge/fabric/neoforge/quilt)')
    .option('--type <type>', 'æ ¸å¿ç±»å (vanilla/forge/mohist/catserver/paper)')
    .option('--build <number>', 'æå»ºå·ï¼ä» Mohist éè¦ï¼')
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
            console.error(`â åå»ºå¤±è´¥: ${e.message}`);
        }
    });

schemeCmd
    .command('list')
    .description('ååºæææ¹æ¡')
    .action(() => {
        const schemeManager = new SchemeManager();
        const schemes = schemeManager.list();
        if (schemes.length === 0) {
            console.log('æ²¡ææ¹æ¡');
            return;
        }
        console.log('æ¹æ¡åè¡¨:');
        for (const s of schemes) {
            const active = s.active ? ' (å½å)' : '';
            console.log(`  ${s.active ? 'â¶' : ' '} ${s.name} - ${s.version} (${s.loader})${active}`);
        }
    });

schemeCmd
    .command('switch <name>')
    .description('åæ¢å°æå®æ¹æ¡')
    .action(async (name) => {
        const schemeManager = new SchemeManager();
        try {
            await schemeManager.switch(name);
        } catch (e) {
            console.error(`â åæ¢å¤±è´¥: ${e.message}`);
        }
    });

schemeCmd
    .command('delete <name>')
    .description('å é¤æ¹æ¡')
    .action((name) => {
        const schemeManager = new SchemeManager();
        try {
            schemeManager.delete(name);
        } catch (e) {
            console.error(`â å é¤å¤±è´¥: ${e.message}`);
        }
    });

schemeCmd
    .command('info [name]')
    .description('æ¥çæ¹æ¡ä¿¡æ¯')
    .action((name) => {
        const schemeManager = new SchemeManager();
        const target = name || schemeManager.currentScheme;
        if (!target) {
            console.log('æªæå®æ¹æ¡ä¸æ å½åæ¹æ¡');
            return;
        }
        try {
            const meta = schemeManager._loadSchemeMeta(target);
            console.log(`æ¹æ¡: ${target}`);
            console.log(`  çæ¬: ${meta.version}`);
            console.log(`  å è½½å¨: ${meta.loader}`);
            console.log(`  ç±»å: ${meta.type}`);
            console.log(`  åå»ºæ¶é´: ${meta.created_at}`);
            console.log(`  æ¨¡ç»æ°: ${(meta.mods || []).length}`);
            console.log(`  å¼å®¹æ§: Java ${meta.compatibility?.java || 'æªç¥'}`);
        } catch (e) {
            console.error(`â è·åä¿¡æ¯å¤±è´¥: ${e.message}`);
        }
    });

// ==================== theme ====================

const themeCmd = program.command('theme').description('ä¸»é¢åç®¡ç');

themeCmd
    .command('install <source>')
    .description('å®è£ä¸»é¢åï¼ZIP æä»¶è·¯å¾ï¼')
    .action(async (source) => {
        const themeManager = new ThemeManager();
        try {
            await themeManager.install(source);
        } catch (e) {
            console.error(`â å®è£å¤±è´¥: ${e.message}`);
        }
    });

themeCmd
    .command('list')
    .description('ååºå·²å®è£ä¸»é¢')
    .action(() => {
        const themeManager = new ThemeManager();
        const themes = themeManager.list();
        if (themes.length === 0) {
            console.log('æ²¡æä¸»é¢å');
            return;
        }
        console.log('ä¸»é¢åè¡¨:');
        for (const t of themes) {
            const active = t.active ? ' (å½å)' : '';
            console.log(`  ${t.active ? 'â¶' : ' '} ${t.name} - ${t.author} v${t.version}${active}`);
        }
    });

themeCmd
    .command('switch <name>')
    .description('åæ¢ä¸»é¢')
    .action((name) => {
        const themeManager = new ThemeManager();
        try {
            themeManager.switch(name);
        } catch (e) {
            console.error(`â åæ¢å¤±è´¥: ${e.message}`);
        }
    });

themeCmd
    .command('delete <name>')
    .description('å é¤ä¸»é¢')
    .action((name) => {
        const themeManager = new ThemeManager();
        try {
            themeManager.delete(name);
        } catch (e) {
            console.error(`â å é¤å¤±è´¥: ${e.message}`);
        }
    });

themeCmd
    .command('info <name>')
    .description('æ¥çä¸»é¢ä¿¡æ¯')
    .action((name) => {
        const themeManager = new ThemeManager();
        try {
            const info = themeManager.getInfo(name);
            console.log(`ä¸»é¢: ${info.name}`);
            console.log(`  ä½è: ${info.author}`);
            console.log(`  çæ¬: ${info.version}`);
            console.log(`  å¼å®¹: wow ${info.compatible}`);
            console.log(`  æè¿°: ${info.description}`);
            console.log(`  è·¯å¾: ${info.path}`);
        } catch (e) {
            console.error(`â è·åä¿¡æ¯å¤±è´¥: ${e.message}`);
        }
    });

// ==================== web ====================

const webCmd = program.command('web').description('Web ç®¡çé¢æ¿');

webCmd
    .command('start')
    .description('å¯å¨ Web æå¡')
    .option('-p, --port <port>', 'ç«¯å£')
    .option('--host <host>', 'ç»å®å°å')
    .action((options) => {
        startWeb({
            port: options.port,
            host: options.host
        });
    });

webCmd
    .command('stop')
    .description('åæ­¢ Web æå¡')
    .action(() => {
        stopWeb();
    });

webCmd
    .command('status')
    .description('æ¥ç Web æå¡ç¶æ')
    .action(() => {
        webStatus();
    });

// ==================== lan (V3.3.0 é¶ç¦åç½ç©¿é / èæº) ====================

const lanCmd = program.command('lan').description('èæº / åç½ç©¿éï¼é¶ç¦ Terracottaï¼');

lanCmd
    .command('host')
    .description('æè¦å½æ¿ä¸»ï¼å¼æ¿è®©å¥½åèæºï¼èªå¨ä¸è½½å¹¶å¯å¨é¶ç¦ï¼')
    .option('-r, --room <code>', 'æå®åºå®æ¿é´å·ï¼çç©ºåèªå¨çæï¼')
    .action(async (options) => {
        try {
            const { roomCode } = await Terracotta.hostRoom({ roomCode: options.room });
            console.log(`\nð® å¥½åå¨ PCL / HMCL / BakaXL / FCL ä¸­éæ©ãå å¥é¶ç¦æ¿é´ãå¹¶è¾å¥æ¿é´å· ${roomCode} å³å¯èæºã`);
        } catch (e) {
            console.error(`â å¼æ¿å¤±è´¥: ${e.message}`);
        }
    });

lanCmd
    .command('stop')
    .description('å³é­èæºæ¿é´ï¼åæ­¢é¶ç¦ï¼')
    .action(async () => {
        try {
            await Terracotta.stopHost();
        } catch (e) {
            console.error(`â å³æ¿å¤±è´¥: ${e.message}`);
        }
    });

lanCmd
    .command('status')
    .description('æ¥çèæºæ¿é´ç¶æ / æ¿é´å·')
    .action(async () => {
        try {
            const s = await Terracotta.getStatus();
            if (!s.running) {
                console.log('å½åæªå¼æ¿ï¼é¶ç¦æªè¿è¡ï¼ãä½¿ç¨ `wow lan host` å¼æ¿ã');
                return;
            }
            console.log('ð  èæºæ¿é´ç¶æ:');
            console.log(`  è¿è¡ç¶æ:  ð¢ è¿è¡ä¸­`);
            console.log(`  æ¬å° API:  127.0.0.1:${s.port}`);
            console.log(`  æ¿é´å·:    ${s.roomCode || '(çæä¸­)'}`);
            console.log(`  ç¶ææº:    ${s.state || 'æªç¥'}`);
            if (s.roomCode) {
                console.log(`\n  ææ¿é´å·åç»å¥½åï¼å¯¹æ¹å¨ PCL / HMCL / BakaXL / FCL ä¸­éæ©ãå å¥é¶ç¦æ¿é´ãå¹¶è¾å¥è¯¥æ¿é´å·å³å¯èæºã`);
            }
            console.log(`  ${Terracotta.getCopyright()}`);
        } catch (e) {
            console.error(`â æ¥è¯¢å¤±è´¥: ${e.message}`);
        }
    });

// ==================== pack ====================

const packCmd = program.command('pack').description('æ´ååç®¡ç');

packCmd
    .command('install <source>')
    .description('å®è£å®¢æ·ç«¯æ´ååï¼æ¯æ ZIP æä»¶æ URLï¼')
    .action(async (source) => {
        const pack = new PackGenerator();
        try {
            await pack.install(source);
        } catch (e) {
            console.error(`â å®è£å¤±è´¥: ${e.message}`);
        }
    });

packCmd
    .command('generate <name>')
    .description('çæå®¢æ·ç«¯æ´åå')
    .option('-v, --mc-version <version>', 'Minecraft çæ¬')
    .option('--loader <loader>', 'æ¨¡ç»å è½½å¨ (forge/fabric)')
    .option('--output <path>', 'è¾åºç®å½')
    .action(async (name, options) => {
        const pack = new PackGenerator();
        try {
            await pack.generate(name, { ...options, version: options.mcVersion });
        } catch (e) {
            console.error(`â çæå¤±è´¥: ${e.message}`);
        }
    });

// ==================== logs ====================

const logsCmd = program.command('logs').description('æ¥å¿ä¸ AI åæ');

logsCmd
    .command('tail')
    .description('å®æ¶æ¥çæ¥å¿')
    .action(() => {
        const log = new LogHandler();
        log.tail();
    });

logsCmd
    .command('analyze')
    .description('åææ¥å¿ï¼AI åæï¼éæå¡å¨å³é­ï¼')
    .option('--api-key <key>', 'AI API å¯é¥ï¼è¦çéç½®ï¼')
    .option('--model <model>', 'æ¨¡ååç§°')
    .option('--api-url <url>', 'API ç«¯ç¹')
    .action(async (options) => {
        const log = new LogHandler();
        await log.analyze(options);
    });

logsCmd
    .command('report')
    .description('çææ¥å¿åææ¥åï¼ä¸è°ç¨ AIï¼')
    .action(() => {
        const log = new LogHandler();
        log.report();
    });

// ==================== down ====================

program
    .command('down <url>')
    .description('ä¸è½½æä»¶')
    .option('-o, --output <path>', 'è¾åºè·¯å¾')
    .action(async (url, options) => {
        const output = options.output || path.join(utils.resolvePath('../temp'), path.basename(url));
        console.log(`ä¸è½½: ${url}`);
        console.log(`  ä¿å­å°: ${output}`);

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
            const progress = new ProgressBar(`  ä¸è½½ [:bar] :percent :etas`, {
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

            console.log(`â ä¸è½½å®æ: ${output}`);
        } catch (e) {
            console.error(`â ä¸è½½å¤±è´¥: ${e.message}`);
        }
    });

// ==================== config ====================

const configCmd = program.command('config').description('éç½®ç®¡ç');

configCmd
    .command('wow <key> [value]')
    .description('æ¥ç/è®¾ç½®å¯å¨å¨éç½®')
    .action((key, value) => {
        if (value !== undefined) {
            config.setConfig(key, value);
            console.log(`â ${key} = ${value}`);
        } else {
            const val = config.getConfig(key);
            console.log(`${key} = ${val !== undefined ? val : 'null'}`);
        }
    });

configCmd
    .command('server <key> [value]')
    .description('æ¥ç/è®¾ç½® server.properties')
    .action((key, value) => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        if (value !== undefined) {
            props.set(key, value);
            console.log(`â server.properties ${key} = ${value}`);
        } else {
            const val = props.get(key);
            console.log(`server.properties ${key} = ${val !== undefined ? val : 'null'}`);
        }
    });

configCmd
    .command('white <action> [player]')
    .description('ç½ååç®¡ç (add/remove/list)')
    .action((action, player) => {
        const WhitelistManager = require('./config').WhitelistManager;
        const wl = new WhitelistManager(utils.getServerDir());

        if (action === 'list') {
            const list = wl.list();
            console.log('ç½åå:');
            for (const p of list) {
                console.log(`  ${p}`);
            }
            if (list.length === 0) console.log('  ç©º');
        } else if (action === 'add' && player) {
            wl.add(player);
            console.log(`â ${player} å·²æ·»å å°ç½åå`);
        } else if (action === 'remove' && player) {
            wl.remove(player);
            console.log(`â ${player} å·²ä»ç½ååç§»é¤`);
        } else {
            console.log('ç¨æ³: config white <add|remove|list> [player]');
        }
    });

// ==================== mail ====================

const mailCmd = program.command('mail').description('é®ä»¶ç®¡ç');

// é¢çéå¶ï¼15åé/æ¬¡
const MAIL_RATE_LIMIT_FILE = path.join(__dirname, '../.mail_last_sent');
const MAIL_RATE_LIMIT_MS = 15 * 60 * 1000; // 15åé

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
        console.log(`â³ åéé¢çéå¶: è¯·ç­å¾ ${minutes} å ${seconds} ç§ååè¯`);
        return false;
    }
    return true;
}

function updateMailRateLimit() {
    fs.writeFileSync(MAIL_RATE_LIMIT_FILE, String(Date.now()), 'utf8');
}

mailCmd
    .command('test')
    .description('æµè¯é®ä»¶éç½®ï¼åééªè¯ç å°ç®¡çåé®ç®±')
    .action(async () => {
        if (!checkMailRateLimit()) return;
        const mailer = new Mailer(config);
        await mailer.test();
        updateMailRateLimit();
    });

mailCmd
    .command('send-code <email>')
    .description('åééªè¯ç å°æå®é®ç®±ï¼ç¨äºç»å½æµè¯ï¼')
    .action(async (email) => {
        if (!checkMailRateLimit()) return;
        const mailer = new Mailer(config);
        const code = mailer.generateCode();
        const result = await mailer.sendVerificationCode(email, code);
        if (result.success) {
            console.log(`â éªè¯ç å·²åéå° ${email}`);
            console.log(`   ð§ éªè¯ç : ${code} (5åéåææ)`);
        } else {
            console.error(`â åéå¤±è´¥: ${result.error}`);
        }
        updateMailRateLimit();
    });

mailCmd
    .command('crash <message>')
    .description('æ¨¡æåéå´©æºæ¥åï¼ç¨äºæµè¯ï¼')
    .action(async (message) => {
        if (!checkMailRateLimit()) return;
        const mailer = new Mailer(config);
        const result = await mailer.sendCrashReport({
            type: 'æ¨¡æå´©æº',
            message: message || 'äººå·¥è§¦åçæµè¯å´©æºæ¥å',
            timestamp: new Date().toISOString()
        });
        if (result.success) {
            console.log(`â å´©æºæ¥åå·²åéå°ç®¡çåé®ç®±`);
        } else {
            console.error(`â åéå¤±è´¥: ${result.error}`);
        }
        updateMailRateLimit();
    });

// ==================== menu (V3.1 æ°å¢) ====================

program
    .command('m [num]')
    .description('äº¤äºå¼èåæ¨¡å¼ï¼ä¸å¸¦åæ°è¿å¥èåï¼å¸¦æ°å­ç´æ¥è·³è½¬ï¼')
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
            // ç´æ¥è·³è½¬ï¼wow m 1
            await dispatchMenu(num, options);
        } else {
            // è¿å¥äº¤äºå¼èå
            await showMainMenu(options);
        }
    });

// ==================== config mods (V3.1 æ°å¢) ====================

const configModsCmd = configCmd.command('mods').description('æ¨¡ç»éç½®ç®¡ç (config/ ç®å½)');

configModsCmd
    .command('list')
    .description('ååº config/ ä¸ææéç½®æä»¶')
    .option('--format <ext>', 'è¿æ»¤æ ¼å¼ (json/toml/yaml/cfg/properties)')
    .action((options) => {
        const configEditor = require('./config_editor');
        const serverDir = utils.getServerDir();
        const files = configEditor.getConfigFiles(serverDir, options.format);

        if (files.length === 0) {
            console.log('config ç®å½ä¸æ²¡æéç½®æä»¶');
            return;
        }

        console.log(`éç½®æä»¶ (${files.length}):`);
        for (const f of files) {
            const sizeStr = utils.formatFileSize(f.size);
            console.log(`  ${sizeStr.padStart(8)} | ${f.ext.padEnd(6)} | ${f.relPath}`);
        }
    });

configModsCmd
    .command('view <file>')
    .description('æ¥çæå®éç½®æä»¶åå®¹')
    .action((file) => {
        const configEditor = require('./config_editor');
        const serverDir = utils.getServerDir();
        const configDir = path.join(serverDir, 'config');

        // æ¯æç¸å¯¹è·¯å¾ææä»¶åæ¥æ¾
        let filePath = path.join(configDir, file);
        if (!fs.existsSync(filePath)) {
            // æ¨¡ç³å¹é
            const files = configEditor.getConfigFiles(serverDir);
            const match = files.find(f => f.relPath === file || f.name === file || f.relPath.includes(file));
            if (match) {
                filePath = match.fullPath;
            } else {
                console.error(`â æä»¶ä¸å­å¨: ${file}`);
                return;
            }
        }

        const result = configEditor.readConfig(filePath);
        if (!result.success) {
            console.error(`â è¯»åå¤±è´¥: ${result.error}`);
            return;
        }

        const relPath = path.relative(configDir, filePath);
        console.log(`\n${'â'.repeat(60)}`);
        console.log(`æä»¶: ${relPath} (${result.ext})`);
        if (result.warning) console.log(`â  ${result.warning}`);
        console.log('â'.repeat(60));
        if (typeof result.data === 'object') {
            console.log(JSON.stringify(result.data, null, 2));
        } else {
            console.log(result.data);
        }
    });

configModsCmd
    .command('get <file> <key>')
    .description('è¯»åéç½®æä»¶ä¸­çåµå¥é®å¼ï¼ç¹å·åéï¼å¦ general.enableï¼')
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
                console.error(`â æä»¶ä¸å­å¨: ${file}`);
                return;
            }
        }

        const result = configEditor.getConfigValue(filePath, key);
        if (result.success) {
            console.log(`${key} = ${JSON.stringify(result.value)}`);
        } else {
            console.error(`â ${result.error}`);
        }
    });

configModsCmd
    .command('set <file> <key> <value>')
    .description('è®¾ç½®éç½®æä»¶ä¸­çåµå¥é®å¼ï¼èªå¨å¤ä»½ï¼')
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
                console.error(`â æä»¶ä¸å­å¨: ${file}`);
                return;
            }
        }

        const result = configEditor.setConfigValue(filePath, key, value);
        if (result.success) {
            console.log(`â ${key} = ${value}`);
            if (result.backupPath) console.log(`   å¤ä»½: ${result.backupPath}`);
        } else {
            console.error(`â ${result.error}`);
        }
    });

// ==================== config server å¢å¼º (V3.1) ====================

configCmd
    .command('server-list')
    .description('åç±»ååºææ server.properties å±æ§')
    .action(() => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        props.listAll();
    });

configCmd
    .command('server-quick')
    .description('server.properties å¿«éè®¾ç½®åå¯¼')
    .action(async () => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        await props.quickSet();
    });

configCmd
    .command('server-reset <key>')
    .description('éç½® server.properties å±æ§ä¸ºé»è®¤å¼')
    .action((key) => {
        const ServerProperties = require('./config').ServerProperties;
        const props = new ServerProperties(utils.getServerDir());
        const result = props.reset(key);
        console.log(`â ${result.key} å·²éç½®ä¸º ${result.value}`);
    });

// ==================== è§£ææ§è¡ ====================

program.parse(process.argv);