/**
 * äº¤äºå¼èåæ¨¡å (V3.1)
 * - wow m           â è¿å¥äº¤äºå¼ä¸»èåï¼çº¯æ°å­å¯¼èªï¼
 * - wow m <1-14>    â ç´æ¥è·³è½¬å°æå®åè½
 * èåä»æ¯ææ°å­éæ©ï¼å½ä»¤è¡ç¨æ³ï¼å¦ server startï¼è¯·æ¥é README.MD
 */

const readline = require('readline');

/**
 * åå»º readline æ¥å£
 */
function createRL() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * å¼æ­¥æé®
 */
function ask(rl, prompt) {
    return new Promise(resolve => rl.question(prompt, resolve));
}

/**
 * æ¸å±
 */
function clearScreen() {
    process.stdout.write('\x1Bc');
}

/**
 * æå°æ é¢æ 
 */
function printHeader(title) {
    console.log('â'.repeat(60));
    console.log(`  ${title}`);
    console.log('â'.repeat(60));
}

/**
 * æ¾ç¤ºä¸»èå
 * @param {object} options - æ¨¡åå®ä¾
 * @param {string} directChoice - ç´æ¥è·³è½¬çèåç¼å·ï¼wow m Nï¼
 */
async function showMainMenu(options = {}, directChoice = null) {
    const {
        serverManager,
        installer,
        modManager,
        schemeManager,
        themeManager,
        packGenerator,
        logHandler,
        config,
        utils
    } = options;

    // å¦æç´æ¥æå®äºèåé¡¹ï¼æ§è¡åè¿å
    if (directChoice) {
        await dispatchMenu(directChoice, options);
        return;
    }

    const rl = createRL();

    while (true) {
        clearScreen();
        printHeader('wow~ Minecraft æå¡å¨ç®¡çå¨ V3.3.1');

        // ç¶æä¿¡æ¯
        try {
            const info = serverManager ? serverManager.getInfo() : null;
            if (info) {
                console.log(`  æå¡å¨ç¶æ: ${info.running ? 'ð¢ è¿è¡ä¸­' : 'â« å·²åæ­¢'}`);
                if (info.jarFile && info.jarFile !== 'æªæ¾å°') {
                    console.log(`  æå¡ç«¯æ ¸å¿: ${info.jarFile}`);
                }
                if (info.running && info.pid) {
                    console.log(`  è¿ç¨ PID:   ${info.pid}`);
                }
            }
        } catch (e) {
            // å¿½ç¥
        }

        // Java ä¿¡æ¯
        try {
            if (utils) {
                const javaPath = utils.detectJava();
                if (javaPath) {
                    console.log(`  Java è·¯å¾:  ${javaPath}`);
                } else {
                    console.log(`  Java è·¯å¾:  (æªæ£æµå°)`);
                }
            }
        } catch (e) {
            // å¿½ç¥
        }

        console.log('â'.repeat(60));

        // ä¸»èåï¼çº¯æ°å­å¯¼èªï¼é¿å½ä»¤ä¸å¨æ­¤å¤æ§è¡ï¼è¯·ç´æ¥æ¥éææ¡£ä½¿ç¨å½ä»¤è¡ï¼
        const menuItems = [
            ['1', 'å¯å¨æå¡å¨'],
            ['2', 'ä¸è½½/å®è£å®ä¾'],
            ['3', 'åæ´éç½® (server.properties)'],
            ['4', 'ç®¡çæ¨¡ç»/æä»¶'],
            ['5', 'éè¯¯æ¥å¿åæ'],
            ['6', 'è®¤è¯è®¾ç½® (å¤ç½®ç»å½)'],
            ['7', 'ä¸è½½ç®¡çå¨è®¾ç½®'],
            ['8', 'å®è£æ´åå'],
            ['9', 'çæå®¢æ·ç«¯æ´åå'],
            ['10', 'æ¨¡ç»/æä»¶æç´¢ä¸è½½'],
            ['11', 'ç³»ç»è®¾ç½®'],
            ['12', 'æå¡å¨ç¶æçæ§'],
            ['13', 'å¤ä»½/æ¢å¤ (æ¹æ¡ç®¡ç)'],
            ['14', 'Web ä¸»é¢æ´æ¹'],
            ['15', 'èæº / æè¦å½æ¿ä¸» (é¶ç¦)']
        ];

        for (const [num, desc] of menuItems) {
            console.log(`  ${num.padStart(2)}. ${desc}`);
        }
        console.log(`   0. éåºç¨åº`);
        console.log('â'.repeat(60));

        const choice = (await ask(rl, 'è¯·éæ©æä½ (è¾å¥æ°å­ 0-15ï¼å½ä»¤ç¨æ³è§ README.MD): ')).trim();

        if (choice === '0') {
            const confirm = await ask(rl, 'ç¡®å®è¦éåºå? (y/N): ');
            if (confirm.toLowerCase() === 'y') {
                console.log('æè°¢ä½¿ç¨ wow~ï¼åè§!');
                break;
            }
            continue;
        }

        // çº¯æ°å­å¯¼èªï¼1-15 ç´æ¥ååå°å¯¹åºèåï¼æ°å¼æ¯è¾ï¼é¿åå­ç¬¦ä¸²æ¯è¾è¯¯å¤ï¼
        const num = parseInt(choice, 10);
        if (!isNaN(num) && num >= 1 && num <= 15) {
            await dispatchMenu(String(num), options);
            await ask(rl, '\næåè½¦é®è¿åä¸»èå...');
        } else {
            console.log('æ æçéæ©ãæ¬èåä»æ¯ææ°å­éæ©ï¼å¦éä½¿ç¨å½ä»¤ï¼å¦ server start / web startï¼ï¼è¯·ç´æ¥æ¥é README.MD ä¸­çå½ä»¤è¯´æã');
            await ask(rl, 'æåè½¦é®ç»§ç»­...');
        }
    }

    rl.close();
}

/**
 * ååèåéæ©
 */
async function dispatchMenu(choice, options) {
    const {
        serverManager,
        installer,
        modManager,
        schemeManager,
        themeManager,
        packGenerator,
        logHandler,
        config,
        utils,
        mailer
    } = options;

    const rl = createRL();

    try {
        switch (choice) {
            case '1': {
                // å¯å¨æå¡å¨
                printHeader('å¯å¨æå¡å¨');
                if (!serverManager) {
                    console.log('æå¡å¨ç®¡çæ¨¡åæªå è½½');
                    break;
                }
                if (serverManager.isRunning()) {
                    console.log('æå¡å¨å·²å¨è¿è¡ä¸­');
                    const subChoice = await ask(rl, 'æ¯å¦åæ­¢æå¡å¨? (y/N): ');
                    if (subChoice.toLowerCase() === 'y') {
                        await serverManager.stop();
                    }
                } else {
                    const memory = await ask(rl, 'åå­åé (é»è®¤ 2G): ') || '2G';
                    // å¯å¨æé´è®©åº readlineï¼ä½¿æå¡å¨è½ç´æ¥è¯»åç»ç«¯è¾å¥ï¼æä»¤ / Ctrl+Cï¼
                    rl.pause();
                    await serverManager.start(memory);
                    rl.resume();
                }
                break;
            }

            case '2': {
                // ä¸è½½/å®è£å®ä¾
                printHeader('ä¸è½½/å®è£å®ä¾');
                if (!installer) {
                    console.log('å®è£å¨æ¨¡åæªå è½½');
                    break;
                }
                console.log('\næ¯æçæå¡å¨ç±»å:');
                const types = ['vanilla', 'forge', 'fabric', 'paper', 'purpur', 'spigot', 'bukkit', 'mohist', 'leaves'];
                types.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
                console.log('  0. è¿å');
                const tChoice = await ask(rl, '\néæ©ç±»å (1-9): ');
                const tIdx = parseInt(tChoice) - 1;
                if (tIdx >= 0 && tIdx < types.length) {
                    const version = await ask(rl, 'Minecraft çæ¬ (å¦ 1.20.1): ');
                    if (version) {
                        await installer.install(types[tIdx], version);
                    }
                }
                break;
            }

            case '4': {
                // ç®¡çæ¨¡ç»/æä»¶
                printHeader('ç®¡çæ¨¡ç»/æä»¶');
                if (!modManager) {
                    console.log('æ¨¡ç»ç®¡çæ¨¡åæªå è½½');
                    break;
                }
                console.log('\n  1. ååºå·²å®è£æ¨¡ç»');
                console.log('  2. å®è£æ¨¡ç»');
                console.log('  3. å¸è½½æ¨¡ç»');
                console.log('  4. å¯ç¨/ç¦ç¨æ¨¡ç»');
                console.log('  5. æ¥çæ¨¡ç»éç½®');
                console.log('  6. ç¼è¾æ¨¡ç»éç½®');
                console.log('  7. å¤ä»½æ¨¡ç»éç½®');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-7): ');

                const serverDir = utils ? utils.getServerDir() : '../server';
                const configEditor = require('./config_editor');

                switch (subChoice) {
                    case '1': {
                        const mods = modManager.listMods();
                        console.log(`\nå·²å®è£æ¨¡ç» (${mods.length}):`);
                        for (const mod of mods) {
                            const status = mod.enabled ? 'â' : 'â';
                            const sizeKB = (mod.size / 1024).toFixed(1);
                            console.log(`  ${status} ${mod.name} (${sizeKB} KB) [${mod.loader}/${mod.version}]`);
                        }
                        break;
                    }
                    case '2': {
                        const target = await ask(rl, 'æ¨¡ç» URL ææ¬å°è·¯å¾: ');
                        if (target) {
                            await modManager.install(target);
                        }
                        break;
                    }
                    case '3': {
                        const mods = modManager.listMods();
                        mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.name}`));
                        const idx = parseInt(await ask(rl, 'éæ©è¦å¸è½½çæ¨¡ç»ç¼å·: ')) - 1;
                        if (idx >= 0 && idx < mods.length) {
                            modManager.remove(mods[idx].name);
                        }
                        break;
                    }
                    case '4': {
                        const mods = modManager.listMods();
                        mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.status || (m.enabled ? 'â' : 'â')} ${m.name}`));
                        const idx = parseInt(await ask(rl, 'éæ©è¦åæ¢çæ¨¡ç»ç¼å·: ')) - 1;
                        if (idx >= 0 && idx < mods.length) {
                            modManager.toggleMod(mods[idx].name);
                        }
                        break;
                    }
                    case '5': {
                        const files = configEditor.getConfigFiles(serverDir);
                        if (files.length === 0) {
                            console.log('config ç®å½ä¸æ²¡æéç½®æä»¶');
                        } else {
                            console.log(`\néç½®æä»¶ (${files.length}):`);
                            files.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext}, ${utils ? utils.formatFileSize(f.size) : f.size} B)`));
                            const idx = parseInt(await ask(rl, '\néæ©è¦æ¥ççæä»¶ç¼å·: ')) - 1;
                            if (idx >= 0 && idx < files.length) {
                                const result = configEditor.readConfig(files[idx].fullPath);
                                if (result.success) {
                                    console.log(`\n${'â'.repeat(60)}`);
                                    console.log(`æä»¶: ${files[idx].relPath}`);
                                    if (result.warning) console.log(`â  ${result.warning}`);
                                    console.log('â'.repeat(60));
                                    if (typeof result.data === 'object') {
                                        console.log(JSON.stringify(result.data, null, 2));
                                    } else {
                                        console.log(result.data);
                                    }
                                } else {
                                    console.log(`è¯»åå¤±è´¥: ${result.error}`);
                                }
                            }
                        }
                        break;
                    }
                    case '6': {
                        const files = configEditor.getConfigFiles(serverDir);
                        if (files.length === 0) {
                            console.log('config ç®å½ä¸æ²¡æéç½®æä»¶');
                        } else {
                            console.log(`\nå¯ç¼è¾çéç½®æä»¶ (JSON/TOML/YAML):`);
                            const editable = files.filter(f => ['.json', '.toml', '.yml', '.yaml', '.properties', '.cfg', '.conf', '.ini'].includes(f.ext));
                            editable.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext})`));
                            if (editable.length === 0) {
                                console.log('  æ²¡æå¯ç¼è¾çç»æåéç½®æä»¶');
                                break;
                            }
                            const idx = parseInt(await ask(rl, '\néæ©è¦ç¼è¾çæä»¶ç¼å·: ')) - 1;
                            if (idx >= 0 && idx < editable.length) {
                                const file = editable[idx];
                                // åæ¾ç¤ºå½åé®å¼
                                const listResult = configEditor.listConfig(file.fullPath);
                                if (listResult.success) {
                                    console.log(`\nå½åé®å¼ (${file.relPath}):`);
                                    listResult.entries.forEach(e => console.log(`  ${e.key} = ${JSON.stringify(e.value)}`));
                                }
                                const key = await ask(rl, '\nè¾å¥è¦ä¿®æ¹çé® (ç¹å·åé, å¦ general.enable): ');
                                const value = await ask(rl, 'è¾å¥æ°å¼: ');
                                if (key && value !== undefined) {
                                    const setResult = configEditor.setConfigValue(file.fullPath, key, value);
                                    if (setResult.success) {
                                        console.log(`â å·²è®¾ç½® ${key} = ${value}`);
                                        if (setResult.backupPath) console.log(`   å¤ä»½å·²ä¿å­: ${setResult.backupPath}`);
                                    } else {
                                        console.log(`â è®¾ç½®å¤±è´¥: ${setResult.error}`);
                                    }
                                }
                            }
                        }
                        break;
                    }
                    case '7': {
                        const backupResult = configEditor.backupConfigs(serverDir);
                        if (backupResult.success) {
                            console.log(`â å·²å¤ä»½ ${backupResult.count} ä¸ªéç½®æä»¶`);
                            console.log(`   å¤ä»½ç®å½: ${backupResult.backupDir}`);
                        } else {
                            console.log(`â å¤ä»½å¤±è´¥: ${backupResult.error}`);
                        }
                        break;
                    }
                }
                break;
            }

            case '3': {
                // ä¿®æ¹æå¡å¨éç½® (server.properties)
                printHeader('ä¿®æ¹æå¡å¨éç½® (server.properties)');
                const ServerProperties = require('./config').ServerProperties;
                const serverDir = utils ? utils.getServerDir() : '../server';
                const props = new ServerProperties(serverDir);

                console.log('\n  1. æ¥çææå±æ§');
                console.log('  2. è®¾ç½®/ä¿®æ¹åä¸ªå±æ§');
                console.log('  3. å¿«éè®¾ç½®åå¯¼');
                console.log('  4. éç½®å±æ§ä¸ºé»è®¤å¼');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-4): ');

                switch (subChoice) {
                    case '1':
                        props.listAll();
                        break;
                    case '2': {
                        const key = await ask(rl, 'å±æ§å: ');
                        const current = props.get(key);
                        console.log(`å½åå¼: ${current !== null ? current : '(æªè®¾ç½®)'}`);
                        const value = await ask(rl, 'æ°å¼: ');
                        if (value) {
                            props.set(key, value);
                            console.log(`â ${key} = ${value}`);
                        }
                        break;
                    }
                    case '3':
                        await props.quickSet();
                        break;
                    case '4': {
                        const key = await ask(rl, 'è¦éç½®çå±æ§å: ');
                        const result = props.reset(key);
                        console.log(`â ${result.key} å·²éç½®ä¸º ${result.value}`);
                        break;
                    }
                }
                break;
            }

            case '5': {
                // éè¯¯æ¥å¿åæ
                printHeader('éè¯¯æ¥å¿åæ');
                if (!logHandler) {
                    console.log('æ¥å¿å¤çæ¨¡åæªå è½½');
                    break;
                }
                console.log('\n  1. AI åææè¿æ¥å¿');
                console.log('  2. çæç»è®¡æ¥å');
                console.log('  3. å®æ¶æ¥å¿è·è¸ª');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-3): ');
                switch (subChoice) {
                    case '1':
                        await logHandler.analyze();
                        break;
                    case '2':
                        await logHandler.report();
                        break;
                    case '3':
                        console.log('æ­£å¨è·è¸ªæ¥å¿ (Ctrl+C éåº)...');
                        logHandler.tail();
                        break;
                }
                break;
            }

            case '6': {
                // è®¤è¯è®¾ç½®
                printHeader('è®¤è¯è®¾ç½® (å¤ç½®ç»å½)');
                if (!config) {
                    console.log('éç½®æ¨¡åæªå è½½');
                    break;
                }
                const authConfig = config.getConfig('auth', {});
                console.log(`\n  å¤ç½®ç»å½: ${authConfig.enable ? 'â å·²å¯ç¨' : 'â æªå¯ç¨'}`);
                console.log(`  è®¤è¯æå¡å¨: ${authConfig.server || '(æªè®¾ç½®)'}`);
                console.log(`  javaagent: ${authConfig.javaagent || '(èªå¨)'}`);
                const enable = await ask(rl, '\nå¯ç¨å¤ç½®ç»å½? (y/N): ');
                if (enable.toLowerCase() === 'y') {
                    config.setConfig('auth.enable', true);
                    const server = await ask(rl, 'è®¤è¯æå¡å¨å°å (é»è®¤ https://authlib-injector.yushi.moe): ');
                    if (server) config.setConfig('auth.server', server);
                    console.log('â å¤ç½®ç»å½å·²å¯ç¨ï¼ä¸æ¬¡å¯å¨æå¡å¨æ¶çæ');
                } else if (enable !== '') {
                    config.setConfig('auth.enable', false);
                    console.log('å¤ç½®ç»å½å·²ç¦ç¨');
                }
                break;
            }

            case '7': {
                // ä¸è½½ç®¡çå¨è®¾ç½®
                printHeader('ä¸è½½ç®¡çå¨è®¾ç½®');
                if (!config) {
                    console.log('éç½®æ¨¡åæªå è½½');
                    break;
                }
                const mirror = config.getConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
                const timeout = config.getConfig('download.timeout', 30);
                const retry = config.getConfig('download.retry', 3);
                console.log(`\n  éåå°å: ${mirror}`);
                console.log(`  è¶æ¶æ¶é´: ${timeout}s`);
                console.log(`  éè¯æ¬¡æ°: ${retry}`);
                console.log('\n  1. ä¿®æ¹éåå°å');
                console.log('  2. ä¿®æ¹è¶æ¶æ¶é´');
                console.log('  3. ä¿®æ¹éè¯æ¬¡æ°');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-3): ');
                switch (subChoice) {
                    case '1': {
                        console.log('\n  1. BMCLAPI2 (æ¨è) - https://bmclapi2.bangbang93.com');
                        console.log('  2. å®æ¹æº - https://launcher.mojang.com');
                        console.log('  3. èªå®ä¹');
                        const m = await ask(rl, 'éæ©: ');
                        if (m === '1') config.setConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
                        else if (m === '2') config.setConfig('download.mirror', 'https://launcher.mojang.com');
                        else if (m === '3') {
                            const custom = await ask(rl, 'èªå®ä¹å°å: ');
                            if (custom) config.setConfig('download.mirror', custom);
                        }
                        console.log('â éåå°åå·²æ´æ°');
                        break;
                    }
                    case '2': {
                        const t = await ask(rl, 'è¶æ¶æ¶é´(ç§): ');
                        if (t) config.setConfig('download.timeout', parseInt(t));
                        console.log('â è¶æ¶æ¶é´å·²æ´æ°');
                        break;
                    }
                    case '3': {
                        const r = await ask(rl, 'éè¯æ¬¡æ°: ');
                        if (r) config.setConfig('download.retry', parseInt(r));
                        console.log('â éè¯æ¬¡æ°å·²æ´æ°');
                        break;
                    }
                }
                break;
            }

            case '8': {
                // å®è£æ´åå
                printHeader('å®è£æ´åå');
                if (!packGenerator) {
                    console.log('æ´ååæ¨¡åæªå è½½');
                    break;
                }
                console.log('\n  1. ä»æ¬å°æä»¶å®è£ (.zip)');
                console.log('  2. ä» URL ä¸è½½å®è£');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-2): ');
                if (subChoice === '1') {
                    const filePath = await ask(rl, 'æ´ååæä»¶è·¯å¾: ');
                    if (filePath) {
                        await packGenerator.install(filePath);
                    }
                } else if (subChoice === '2') {
                    const url = await ask(rl, 'æ´åå URL: ');
                    if (url) {
                        await packGenerator.install(url);
                    }
                }
                break;
            }

            case '9': {
                // çæå®¢æ·ç«¯æ´åå
                printHeader('çæå®¢æ·ç«¯æ´åå');
                if (!packGenerator) {
                    console.log('æ´ååæ¨¡åæªå è½½');
                    break;
                }
                const name = await ask(rl, 'æ´åååç§°: ') || 'client-pack';
                const version = await ask(rl, 'Minecraft çæ¬ (é»è®¤ 1.20.1): ') || '1.20.1';
                await packGenerator.generate({ name, version });
                break;
            }

            case '10': {
                // æ¨¡ç»/æä»¶æç´¢ä¸è½½
                printHeader('æ¨¡ç»/æä»¶æç´¢ä¸è½½');
                if (!modManager) {
                    console.log('æ¨¡ç»ç®¡çæ¨¡åæªå è½½');
                    break;
                }
                console.log('\n  1. ä» URL ä¸è½½æ¨¡ç»');
                console.log('  2. ä»æ¬å°å®è£æ¨¡ç»');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-2): ');
                if (subChoice === '1') {
                    const url = await ask(rl, 'æ¨¡ç»ä¸è½½ URL: ');
                    if (url) {
                        await modManager.install(url);
                    }
                } else if (subChoice === '2') {
                    const filePath = await ask(rl, 'æ¨¡ç»æä»¶è·¯å¾: ');
                    if (filePath) {
                        await modManager.install(filePath);
                    }
                }
                break;
            }

            case '11': {
                // ç³»ç»è®¾ç½®
                printHeader('ç³»ç»è®¾ç½®');
                if (!config || !utils) {
                    console.log('éç½®æ¨¡åæªå è½½');
                    break;
                }
                console.log('\n  1. ä¿®æ¹ Java è·¯å¾');
                console.log('  2. ä¿®æ¹ JVM åæ°');
                console.log('  3. æ¥çç³»ç»ä¿¡æ¯');
                console.log('  4. éç½®éç½®');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-4): ');
                switch (subChoice) {
                    case '1': {
                        const current = config.getConfig('server.java', '(èªå¨æ£æµ)');
                        console.log(`å½å Java: ${current}`);
                        const newPath = await ask(rl, 'æ° Java è·¯å¾ (çç©ºèªå¨æ£æµ): ');
                        config.setConfig('server.java', newPath || null);
                        console.log('â Java è·¯å¾å·²æ´æ°');
                        break;
                    }
                    case '2': {
                        const current = config.getConfig('server.jvm_args', []).join(' ');
                        console.log(`å½å JVM åæ°: ${current}`);
                        const newArgs = await ask(rl, 'æ° JVM åæ° (ç©ºæ ¼åé): ');
                        if (newArgs) {
                            config.setConfig('server.jvm_args', newArgs.split(/\s+/));
                            console.log('â JVM åæ°å·²æ´æ°');
                        }
                        break;
                    }
                    case '3': {
                        const os = require('os');
                        console.log(`\n  æä½ç³»ç»: ${os.type()} ${os.release()}`);
                        console.log(`  æ¶æ: ${os.arch()}`);
                        console.log(`  åå­: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`);
                        console.log(`  CPU: ${os.cpus()[0]?.model || 'Unknown'}`);
                        console.log(`  Node.js: ${process.version}`);
                        break;
                    }
                    case '4': {
                        const confirm = await ask(rl, 'ç¡®å®éç½®ææéç½®? (y/N): ');
                        if (confirm.toLowerCase() === 'y') {
                            config.saveConfig(config.DEFAULT_CONFIG);
                            console.log('â éç½®å·²éç½®ä¸ºé»è®¤å¼');
                        }
                        break;
                    }
                }
                break;
            }

            case '12': {
                // æå¡å¨ç¶æçæ§
                printHeader('æå¡å¨ç¶æçæ§');
                if (!serverManager) {
                    console.log('æå¡å¨ç®¡çæ¨¡åæªå è½½');
                    break;
                }
                serverManager.status();
                if (serverManager.isRunning()) {
                    const tailChoice = await ask(rl, '\næ¯å¦æ¥çå®æ¶æ¥å¿? (y/N): ');
                    if (tailChoice.toLowerCase() === 'y' && logHandler) {
                        logHandler.tail();
                    }
                }
                break;
            }

            case '13': {
                // å¤ä»½/æ¢å¤
                printHeader('å¤ä»½/æ¢å¤ (æ¹æ¡ç®¡ç)');
                if (!schemeManager) {
                    console.log('æ¹æ¡ç®¡çæ¨¡åæªå è½½');
                    break;
                }
                console.log('\n  1. åå»ºæ¹æ¡');
                console.log('  2. åæ¢æ¹æ¡');
                console.log('  3. ååºæ¹æ¡');
                console.log('  4. å é¤æ¹æ¡');
                console.log('  5. æ¹æ¡ä¿¡æ¯');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-5): ');
                switch (subChoice) {
                    case '1': {
                        const name = await ask(rl, 'æ¹æ¡åç§°: ');
                        if (name) {
                            const version = await ask(rl, 'MC çæ¬ (é»è®¤ 1.20.1): ') || '1.20.1';
                            const loader = await ask(rl, 'å è½½å¨ (é»è®¤ vanilla): ') || 'vanilla';
                            schemeManager.create(name, version, loader);
                        }
                        break;
                    }
                    case '2': {
                        schemeManager.list();
                        const name = await ask(rl, 'è¦åæ¢å°çæ¹æ¡å: ');
                        if (name) {
                            schemeManager.switch(name);
                        }
                        break;
                    }
                    case '3':
                        schemeManager.list();
                        break;
                    case '4': {
                        schemeManager.list();
                        const name = await ask(rl, 'è¦å é¤çæ¹æ¡å: ');
                        if (name) {
                            const confirm = await ask(rl, `ç¡®å®å é¤æ¹æ¡ "${name}"? (y/N): `);
                            if (confirm.toLowerCase() === 'y') {
                                schemeManager.delete(name);
                            }
                        }
                        break;
                    }
                    case '5': {
                        schemeManager.list();
                        const name = await ask(rl, 'æ¹æ¡å: ');
                        if (name) {
                            schemeManager.info(name);
                        }
                        break;
                    }
                }
                break;
            }

            case '14': {
                // Web ä¸»é¢æ´æ¹
                printHeader('Web ä¸»é¢æ´æ¹');
                if (!themeManager) {
                    console.log('ä¸»é¢ç®¡çæ¨¡åæªå è½½');
                    break;
                }
                console.log('\n  1. ååºå·²å®è£ä¸»é¢');
                console.log('  2. å®è£ä¸»é¢');
                console.log('  3. åæ¢ä¸»é¢');
                console.log('  4. å é¤ä¸»é¢');
                console.log('  0. è¿å');
                const subChoice = await ask(rl, '\nè¯·éæ© (0-4): ');
                switch (subChoice) {
                    case '1':
                        themeManager.list();
                        break;
                    case '2': {
                        const filePath = await ask(rl, 'ä¸»é¢ ZIP æä»¶è·¯å¾: ');
                        if (filePath) {
                            await themeManager.install(filePath);
                        }
                        break;
                    }
                    case '3': {
                        themeManager.list();
                        const name = await ask(rl, 'è¦åæ¢çä¸»é¢å: ');
                        if (name) {
                            await themeManager.switch(name);
                        }
                        break;
                    }
                    case '4': {
                        themeManager.list();
                        const name = await ask(rl, 'è¦å é¤çä¸»é¢å: ');
                        if (name) {
                            themeManager.delete(name);
                        }
                        break;
                    }
                }
                break;
            }

            case '15': {
                // èæº / æè¦å½æ¿ä¸»ï¼é¶ç¦ Terracottaï¼
                printHeader('èæº / æè¦å½æ¿ä¸» (é¶ç¦)');
                const Terracotta = require('./terracotta');
                console.log('\n   powered by Terracotta | é¶ç¦èæº (AGPLv3)');
                console.log('   åºäº EasyTier çåç½ç©¿éï¼å¥½åæ éå¬ç½ IP å³å¯å å¥ä½ ç Minecraft æå¡ç«¯ã');
                console.log('   å å¥ç«¯ç± PCL / HMCL / BakaXL / FCL ç­å¯å¨å¨åç½®æ¯æã\n');
                console.log('  1. æè¦å½æ¿ä¸»ï¼å¼æ¿ï¼');
                console.log('  2. æ¥çæ¿é´å· / ç¶æ');
                console.log('  3. å³æ¿ï¼åæ­¢é¶ç¦ï¼');
                console.log('  0. è¿å');
                const sub = await ask(rl, '\nè¯·éæ© (0-3): ');
                try {
                    if (sub === '1') {
                        console.log('æç¤ºï¼å¼æ¿åè¯·åå¯å¨ Minecraft æå¡ç«¯ï¼èå 1ï¼ï¼é¶ç¦ä¼èªå¨æ«ææ¬æºæå¡ç«¯ç«¯å£ã');
                        await Terracotta.hostRoom({});
                    } else if (sub === '2') {
                        const s = await Terracotta.getStatus();
                        if (!s.running) {
                            console.log('å½åæªå¼æ¿ï¼é¶ç¦æªè¿è¡ï¼ãéæ© 1 å¼æ¿ã');
                        } else {
                            console.log(`è¿è¡ç¶æ:  ð¢ è¿è¡ä¸­`);
                            console.log(`æ¬å° API:  127.0.0.1:${s.port}`);
                            console.log(`æ¿é´å·:    ${s.roomCode || '(çæä¸­)'}`);
                            console.log(`ç¶ææº:    ${s.state || 'æªç¥'}`);
                            if (s.roomCode) {
                                console.log(`\nææ¿é´å·åç»å¥½åï¼å¯¹æ¹å¨ PCL / HMCL / BakaXL / FCL ä¸­éæ©ãå å¥é¶ç¦æ¿é´ãå¹¶è¾å¥è¯¥æ¿é´å·å³å¯èæºã`);
                            }
                        }
                    } else if (sub === '3') {
                        await Terracotta.stopHost();
                    }
                } catch (e) {
                    console.error(`â æä½å¤±è´¥: ${e.message}`);
                }
                break;
            }

            default:
                console.log(`æªç¥èåéé¡¹: ${choice}`);
        }
    } catch (e) {
        console.error(`æ§è¡èåæä½æ¶åºé: ${e.message}`);
    }

    rl.close();
}

module.exports = {
    showMainMenu,
    dispatchMenu,
    createRL,
    ask,
    clearScreen,
    printHeader
};
