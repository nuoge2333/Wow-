/**
 * 交互式菜单模块 (V3.1)
 * - wow m           → 进入交互式主菜单（纯数字导航）
 * - wow m <1-14>    → 直接跳转到指定功能
 * 菜单仅支持数字选择；命令行用法（如 server start）请查阅 README.MD
 */

const readline = require('readline');
const pkg = require('../package.json');
// V3.5.0：事件日志
const { logger } = require('./log');

/**
 * 创建 readline 接口
 */
function createRL() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * 异步提问
 */
function ask(rl, prompt) {
    return new Promise(resolve => rl.question(prompt, resolve));
}

/**
 * 清屏
 */
function clearScreen() {
    process.stdout.write('\x1Bc');
}

/**
 * 打印标题栏
 */
function printHeader(title) {
    console.log('═'.repeat(60));
    console.log(`  ${title}`);
    console.log('═'.repeat(60));
}

/**
 * 显示主菜单
 * @param {object} options - 模块实例
 * @param {string} directChoice - 直接跳转的菜单编号（wow m N）
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

    // 如果直接指定了菜单项，执行后返回
    if (directChoice) {
        const rl = createRL();
        try {
            await dispatchMenu(directChoice, options, rl);
        } finally {
            rl.close();
        }
        return;
    }

    const rl = createRL();

    while (true) {
        clearScreen();
        printHeader('wow~ Minecraft 服务器管理器 V' + pkg.version);

        // 状态信息
        try {
            const info = serverManager ? serverManager.getInfo() : null;
            if (info) {
                console.log(`  服务器状态: ${info.running ? '🟢 运行中' : '⚫ 已停止'}`);
                if (info.jarFile && info.jarFile !== '未找到') {
                    console.log(`  服务端核心: ${info.jarFile}`);
                }
                if (info.running && info.pid) {
                    console.log(`  进程 PID:   ${info.pid}`);
                }
            }
        } catch (e) {
            // 忽略
        }

        // Java 信息
        try {
            if (utils) {
                // V3.5.7：改为展示「主菜单扫描到的全部 Java 版本清单」+ 当前生效的 Java，
                // 便于用户一眼看出本机装了哪些版本、当前用的是哪个。
                const allJava = (typeof utils.scanAllJava === 'function') ? utils.scanAllJava() : [];
                const majors = [...new Set(allJava.map(j => j.major).filter(m => m != null))]
                    .sort((a, b) => a - b);
                if (majors.length) {
                    console.log(`  已装 Java:  ${majors.map(m => 'Java ' + m).join(', ')}`);
                }

                const configured = config ? config.getConfig('server.java', null) : null;
                const javaPath = utils.detectJava();
                if (configured && javaPath) {
                    console.log(`  当前 Java:  ${javaPath}（已手动指定）`);
                } else if (javaPath) {
                    console.log(`  当前 Java:  ${javaPath}`);
                } else if (majors.length) {
                    console.log('  当前 Java:  (未匹配到服务器需求的版本，可在菜单 11 → 1 安装)');
                } else {
                    console.log('  当前 Java:  (未检测到，可在菜单 11 → 1 自动安装)');
                }
            }
        } catch (e) {
            // 忽略
        }

        console.log('─'.repeat(60));

        // 主菜单（纯数字导航；长命令不在此处执行，请直接查阅文档使用命令行）
        const menuItems = [
            ['1', '启动服务器'],
            ['2', '新建方案'],
            ['3', '变更配置 (server.properties)'],
            ['4', '管理模组/插件'],
            ['5', '错误日志分析'],
            ['6', '认证设置 (外置登录)'],
            ['7', '下载管理器设置'],
            ['8', '安装整合包'],
            ['9', '生成客户端整合包'],
            ['10', '模组/插件搜索下载'],
            ['11', '系统设置'],
            ['12', '服务器状态监控'],
            ['13', '方案管理 (切换/列表/删除)'],
            ['14', 'Web 主题更改'],
            ['15', '联机 / 我要当房主 (陶瓦)']
        ];

        for (const [num, desc] of menuItems) {
            console.log(`  ${num.padStart(2)}. ${desc}`);
        }
        console.log(`   0. 退出程序`);
        console.log('─'.repeat(60));

        const choice = (await ask(rl, '请选择操作 (输入数字 0-15，命令用法见 README.MD): ')).trim();

        if (choice === '0') {
            const confirm = await ask(rl, '确定要退出吗? (y/N): ');
            if (confirm.toLowerCase() === 'y') {
                console.log('感谢使用 wow~，再见!');
                break;
            }
            continue;
        }

        // 纯数字导航：1-15 直接分发到对应菜单（数值比较，避免字符串比较误判）
        const num = parseInt(choice, 10);
        if (!isNaN(num) && num >= 1 && num <= 15) {
            const label = menuItems[num - 1] ? menuItems[num - 1][1] : '';
            logger.impt(`菜单操作: ${num} ${label}`);
            await dispatchMenu(String(num), options, rl);
            await ask(rl, '\n按回车键返回主菜单...');
        } else {
            logger.warn(`无效菜单选择: ${choice}`);
            console.log('无效的选择。本菜单仅支持数字选择；如需使用命令（如 server start / web start），请直接查阅 README.MD 中的命令说明。');
            await ask(rl, '按回车键继续...');
        }
    }

    rl.close();
}

/**
 * 分发菜单选择
 */
async function dispatchMenu(choice, options, rl) {
    // 复用调用方（showMainMenu）已有的 readline 接口，不要再新建一个挂在同一 process.stdin 上。
    // 否则两个 readline 接口同时消费同一 stdin，每个按键会被读两次 → 终端把输入回显成两倍
    // （如输入 1.20.1 显示成 11..2200..11）。本函数仅在外部未传入 rl 时才自建并负责关闭。
    const ownRl = !rl;
    if (!rl) rl = createRL();
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


    try {
        switch (choice) {
            case '1': {
                // 启动服务器
                printHeader('启动服务器');
                if (!serverManager) {
                    console.log('服务器管理模块未加载');
                    break;
                }
                if (serverManager.isRunning()) {
                    console.log('服务器已在运行中');
                    const subChoice = await ask(rl, '是否停止服务器? (y/N): ');
                    if (subChoice.toLowerCase() === 'y') {
                        await serverManager.stop();
                    }
                } else {
                    const memory = await ask(rl, '内存分配 (默认 2G): ') || '2G';
                    // 启动期间让出 readline，使服务器能直接读取终端输入（指令 / Ctrl+C）
                    rl.pause();
                    await serverManager.start(memory);
                    rl.resume();
                }
                break;
            }

            case '2': {
                // 新建方案（V3.5.7）
                // 旧实现是「下载/安装实例」：直接调 installer.install 装到当前目录，
                // 既不建方案、也不问方案名，与「方案即服务器运行目录」的模型冲突，
                // 且和菜单 13 的「创建方案」功能重叠。现改为统一入口。
                printHeader('新建方案');
                if (!schemeManager) {
                    console.log('方案管理模块未加载');
                    break;
                }

                // 1) 方案名
                const sName = (await ask(rl, '方案名称: ')).trim();
                if (!sName) {
                    console.log('未输入方案名，已取消。');
                    break;
                }

                // 名称校验：复用 file_manager 的跨平台校验段（拒绝路径分隔符、
                // Windows 保留字符/保留设备名、以点或空格结尾等）
                let fm;
                try {
                    fm = require('./file_manager');
                } catch (e) { fm = null; }
                if (fm && typeof fm.validateNameSegment === 'function') {
                    const check = fm.validateNameSegment(sName);
                    if (!check.ok) {
                        console.log(`❌ 方案名不合法: ${check.reason}`);
                        break;
                    }
                }

                // 目录已存在则直接拒绝（避免 create 抛错后留下残缺目录）
                if (typeof schemeManager._schemeExists === 'function'
                    && schemeManager._schemeExists(sName)) {
                    console.log(`❌ 方案「${sName}」已存在。可用菜单 13 → 2 查看全部方案。`);
                    break;
                }

                // 2) 核心类型
                const sTypes = ['vanilla', 'forge', 'fabric', 'paper', 'purpur', 'spigot', 'bukkit', 'mohist', 'leaves'];
                console.log('\n支持的服务器类型:');
                sTypes.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
                const stChoice = (await ask(rl, '\n选择类型 (默认 1 vanilla): ')).trim();
                let type = 'vanilla';
                if (stChoice) {
                    const stIdx = parseInt(stChoice, 10) - 1;
                    if (!(stIdx >= 0 && stIdx < sTypes.length)) {
                        console.log('类型选择无效，已取消。');
                        break;
                    }
                    type = sTypes[stIdx];
                }

                // 3) 版本 / 加载器 / 构建号
                const sVersion = (await ask(rl, 'Minecraft 版本 (默认 1.20.1): ')).trim() || '1.20.1';
                const sLoader = (await ask(rl, `加载器 (默认 ${type}): `)).trim() || type;
                const sBuild = (await ask(rl, '构建号 (留空自动选择最新): ')).trim() || null;

                // 4) 创建（务必用对象签名——旧菜单 13-1 用三个位置参数调用，
                //    导致用户输入的版本/加载器被静默忽略，这里已修正）
                console.log('');
                try {
                    await schemeManager.create(sName, {
                        type,
                        version: sVersion,
                        loader: sLoader,
                        build: sBuild
                    });
                    console.log(`\n✅ 方案「${sName}」创建完成。`);
                    const sDir = (schemeManager.schemesDir)
                        ? require('path').join(schemeManager.schemesDir, sName)
                        : `scheme/${sName}`;
                    console.log(`   目录: ${sDir}`);
                    console.log('   可在菜单 13 → 1 切换到此方案后启动服务器。');
                } catch (e) {
                    console.log(`\n❌ 创建失败: ${e.message}`);
                }
                break;
            }

            case '4': {
                // 管理模组/插件
                printHeader('管理模组/插件');
                if (!modManager) {
                    console.log('模组管理模块未加载');
                    break;
                }
                console.log('\n  1. 列出已安装模组');
                console.log('  2. 安装模组');
                console.log('  3. 卸载模组');
                console.log('  4. 启用/禁用模组');
                console.log('  5. 查看模组配置');
                console.log('  6. 编辑模组配置');
                console.log('  7. 备份模组配置');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-7): ');

                const serverDir = utils ? utils.getServerDir() : '../scheme';
                const configEditor = require('./config_editor');

                switch (subChoice) {
                    case '1': {
                        const mods = modManager.listMods();
                        console.log(`\n已安装模组 (${mods.length}):`);
                        for (const mod of mods) {
                            const status = mod.enabled ? '✅' : '❌';
                            const sizeKB = (mod.size / 1024).toFixed(1);
                            console.log(`  ${status} ${mod.name} (${sizeKB} KB) [${mod.loader}/${mod.version}]`);
                        }
                        break;
                    }
                    case '2': {
                        const target = await ask(rl, '模组 URL 或本地路径: ');
                        if (target) {
                            await modManager.install(target);
                        }
                        break;
                    }
                    case '3': {
                        const mods = modManager.listMods();
                        mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.name}`));
                        const idx = parseInt(await ask(rl, '选择要卸载的模组编号: ')) - 1;
                        if (idx >= 0 && idx < mods.length) {
                            modManager.remove(mods[idx].name);
                        }
                        break;
                    }
                    case '4': {
                        const mods = modManager.listMods();
                        mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.status || (m.enabled ? '✅' : '❌')} ${m.name}`));
                        const idx = parseInt(await ask(rl, '选择要切换的模组编号: ')) - 1;
                        if (idx >= 0 && idx < mods.length) {
                            modManager.toggleMod(mods[idx].name);
                        }
                        break;
                    }
                    case '5': {
                        const files = configEditor.getConfigFiles(serverDir);
                        if (files.length === 0) {
                            console.log('config 目录下没有配置文件');
                        } else {
                            console.log(`\n配置文件 (${files.length}):`);
                            files.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext}, ${utils ? utils.formatFileSize(f.size) : f.size} B)`));
                            const idx = parseInt(await ask(rl, '\n选择要查看的文件编号: ')) - 1;
                            if (idx >= 0 && idx < files.length) {
                                const result = configEditor.readConfig(files[idx].fullPath);
                                if (result.success) {
                                    console.log(`\n${'═'.repeat(60)}`);
                                    console.log(`文件: ${files[idx].relPath}`);
                                    if (result.warning) console.log(`⚠ ${result.warning}`);
                                    console.log('═'.repeat(60));
                                    if (typeof result.data === 'object') {
                                        console.log(JSON.stringify(result.data, null, 2));
                                    } else {
                                        console.log(result.data);
                                    }
                                } else {
                                    console.log(`读取失败: ${result.error}`);
                                }
                            }
                        }
                        break;
                    }
                    case '6': {
                        const files = configEditor.getConfigFiles(serverDir);
                        if (files.length === 0) {
                            console.log('config 目录下没有配置文件');
                        } else {
                            console.log(`\n可编辑的配置文件 (JSON/TOML/YAML):`);
                            const editable = files.filter(f => ['.json', '.toml', '.yml', '.yaml', '.properties', '.cfg', '.conf', '.ini'].includes(f.ext));
                            editable.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext})`));
                            if (editable.length === 0) {
                                console.log('  没有可编辑的结构化配置文件');
                                break;
                            }
                            const idx = parseInt(await ask(rl, '\n选择要编辑的文件编号: ')) - 1;
                            if (idx >= 0 && idx < editable.length) {
                                const file = editable[idx];
                                // 先显示当前键值
                                const listResult = configEditor.listConfig(file.fullPath);
                                if (listResult.success) {
                                    console.log(`\n当前键值 (${file.relPath}):`);
                                    listResult.entries.forEach(e => console.log(`  ${e.key} = ${JSON.stringify(e.value)}`));
                                }
                                const key = await ask(rl, '\n输入要修改的键 (点号分隔, 如 general.enable): ');
                                const value = await ask(rl, '输入新值: ');
                                if (key && value !== undefined) {
                                    const setResult = configEditor.setConfigValue(file.fullPath, key, value);
                                    if (setResult.success) {
                                        console.log(`✅ 已设置 ${key} = ${value}`);
                                        if (setResult.backupPath) console.log(`   备份已保存: ${setResult.backupPath}`);
                                    } else {
                                        console.log(`❌ 设置失败: ${setResult.error}`);
                                    }
                                }
                            }
                        }
                        break;
                    }
                    case '7': {
                        const backupResult = configEditor.backupConfigs(serverDir);
                        if (backupResult.success) {
                            console.log(`✅ 已备份 ${backupResult.count} 个配置文件`);
                            console.log(`   备份目录: ${backupResult.backupDir}`);
                        } else {
                            console.log(`❌ 备份失败: ${backupResult.error}`);
                        }
                        break;
                    }
                }
                break;
            }

            case '3': {
                // 修改服务器配置 (server.properties)
                printHeader('修改服务器配置 (server.properties)');
                const ServerProperties = require('./config').ServerProperties;
                const serverDir = utils ? utils.getServerDir() : '../scheme';
                const props = new ServerProperties(serverDir);

                console.log('\n  1. 查看所有属性');
                console.log('  2. 设置/修改单个属性');
                console.log('  3. 快速设置向导');
                console.log('  4. 重置属性为默认值');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-4): ');

                switch (subChoice) {
                    case '1':
                        props.listAll();
                        break;
                    case '2': {
                        const key = await ask(rl, '属性名: ');
                        const current = props.get(key);
                        console.log(`当前值: ${current !== null ? current : '(未设置)'}`);
                        const value = await ask(rl, '新值: ');
                        if (value) {
                            props.set(key, value);
                            console.log(`✅ ${key} = ${value}`);
                        }
                        break;
                    }
                    case '3':
                        await props.quickSet(undefined, rl);
                        break;
                    case '4': {
                        const key = await ask(rl, '要重置的属性名: ');
                        const result = props.reset(key);
                        console.log(`✅ ${result.key} 已重置为 ${result.value}`);
                        break;
                    }
                }
                break;
            }

            case '5': {
                // 错误日志分析
                printHeader('错误日志分析');
                if (!logHandler) {
                    console.log('日志处理模块未加载');
                    break;
                }
                console.log('\n  1. AI 分析最近日志');
                console.log('  2. 生成统计报告');
                console.log('  3. 实时日志跟踪');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-3): ');
                switch (subChoice) {
                    case '1':
                        await logHandler.analyze();
                        break;
                    case '2':
                        await logHandler.report();
                        break;
                    case '3':
                        console.log('正在跟踪日志 (Ctrl+C 退出)...');
                        logHandler.tail();
                        break;
                }
                break;
            }

            case '6': {
                // 认证设置
                printHeader('认证设置 (外置登录)');
                if (!config) {
                    console.log('配置模块未加载');
                    break;
                }
                const authConfig = config.getConfig('auth', {});
                console.log(`\n  外置登录: ${authConfig.enable ? '✅ 已启用' : '❌ 未启用'}`);
                console.log(`  认证服务器: ${authConfig.server || '(未设置)'}`);
                console.log(`  javaagent: ${authConfig.javaagent || '(自动)'}`);
                const enable = await ask(rl, '\n启用外置登录? (y/N): ');
                if (enable.toLowerCase() === 'y') {
                    config.setConfig('auth.enable', true);
                    const server = await ask(rl, '认证服务器地址 (默认 https://authlib-injector.yushi.moe): ');
                    if (server) config.setConfig('auth.server', server);
                    console.log('✅ 外置登录已启用，下次启动服务器时生效');
                } else if (enable !== '') {
                    config.setConfig('auth.enable', false);
                    console.log('外置登录已禁用');
                }
                break;
            }

            case '7': {
                // 下载管理器设置
                printHeader('下载管理器设置');
                if (!config) {
                    console.log('配置模块未加载');
                    break;
                }
                const mirror = config.getConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
                const timeout = config.getConfig('download.timeout', 30);
                const retry = config.getConfig('download.retry', 3);
                console.log(`\n  镜像地址: ${mirror}`);
                console.log(`  超时时间: ${timeout}s`);
                console.log(`  重试次数: ${retry}`);
                console.log('\n  1. 修改镜像地址');
                console.log('  2. 修改超时时间');
                console.log('  3. 修改重试次数');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-3): ');
                switch (subChoice) {
                    case '1': {
                        console.log('\n  1. BMCLAPI2 (推荐) - https://bmclapi2.bangbang93.com');
                        console.log('  2. 官方源 - https://launcher.mojang.com');
                        console.log('  3. 自定义');
                        const m = await ask(rl, '选择: ');
                        if (m === '1') config.setConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
                        else if (m === '2') config.setConfig('download.mirror', 'https://launcher.mojang.com');
                        else if (m === '3') {
                            const custom = await ask(rl, '自定义地址: ');
                            if (custom) config.setConfig('download.mirror', custom);
                        }
                        console.log('✅ 镜像地址已更新');
                        break;
                    }
                    case '2': {
                        const t = await ask(rl, '超时时间(秒): ');
                        if (t) config.setConfig('download.timeout', parseInt(t));
                        console.log('✅ 超时时间已更新');
                        break;
                    }
                    case '3': {
                        const r = await ask(rl, '重试次数: ');
                        if (r) config.setConfig('download.retry', parseInt(r));
                        console.log('✅ 重试次数已更新');
                        break;
                    }
                }
                break;
            }

            case '8': {
                // 安装整合包
                printHeader('安装整合包');
                if (!packGenerator) {
                    console.log('整合包模块未加载');
                    break;
                }
                console.log('\n  1. 从本地文件安装 (.zip)');
                console.log('  2. 从 URL 下载安装');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-2): ');
                if (subChoice === '1') {
                    const filePath = await ask(rl, '整合包文件路径: ');
                    if (filePath) {
                        await packGenerator.install(filePath, rl);
                    }
                } else if (subChoice === '2') {
                    const url = await ask(rl, '整合包 URL: ');
                    if (url) {
                        await packGenerator.install(url, rl);
                    }
                }
                break;
            }

            case '9': {
                // 生成客户端整合包
                printHeader('生成客户端整合包');
                if (!packGenerator) {
                    console.log('整合包模块未加载');
                    break;
                }
                const name = await ask(rl, '整合包名称: ') || 'client-pack';
                const version = await ask(rl, 'Minecraft 版本 (默认 1.20.1): ') || '1.20.1';
                await packGenerator.generate({ name, version });
                break;
            }

            case '10': {
                // 模组/插件搜索下载
                printHeader('模组/插件搜索下载');
                if (!modManager) {
                    console.log('模组管理模块未加载');
                    break;
                }
                console.log('\n  1. 从 URL 下载模组');
                console.log('  2. 从本地安装模组');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-2): ');
                if (subChoice === '1') {
                    const url = await ask(rl, '模组下载 URL: ');
                    if (url) {
                        await modManager.install(url);
                    }
                } else if (subChoice === '2') {
                    const filePath = await ask(rl, '模组文件路径: ');
                    if (filePath) {
                        await modManager.install(filePath);
                    }
                }
                break;
            }

            case '11': {
                // 系统设置
                printHeader('系统设置');
                if (!config || !utils) {
                    console.log('配置模块未加载');
                    break;
                }
                console.log('\n  1. Java 设置（扫描/选择/自动安装）');
                console.log('  2. 修改 JVM 参数');
                console.log('  3. 查看系统信息');
                console.log('  4. 重置配置');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-4): ');
                switch (subChoice) {
                    case '1': {
                        // V3.5.7：由「手填 Java 路径」升级为「扫描本机全部 Java 并列出选择」
                        await javaSettingsFlow(rl, config, utils);
                        break;
                    }
                    case '2': {
                        const current = config.getConfig('server.jvm_args', []).join(' ');
                        console.log(`当前 JVM 参数: ${current}`);
                        const newArgs = await ask(rl, '新 JVM 参数 (空格分隔): ');
                        if (newArgs) {
                            config.setConfig('server.jvm_args', newArgs.split(/\s+/));
                            console.log('✅ JVM 参数已更新');
                        }
                        break;
                    }
                    case '3': {
                        const os = require('os');
                        console.log(`\n  操作系统: ${os.type()} ${os.release()}`);
                        console.log(`  架构: ${os.arch()}`);
                        console.log(`  内存: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`);
                        console.log(`  CPU: ${os.cpus()[0]?.model || 'Unknown'}`);
                        console.log(`  Node.js: ${process.version}`);
                        break;
                    }
                    case '4': {
                        const confirm = await ask(rl, '确定重置所有配置? (y/N): ');
                        if (confirm.toLowerCase() === 'y') {
                            config.saveConfig(config.DEFAULT_CONFIG);
                            console.log('✅ 配置已重置为默认值');
                        }
                        break;
                    }
                }
                break;
            }

            case '12': {
                // 服务器状态监控
                printHeader('服务器状态监控');
                if (!serverManager) {
                    console.log('服务器管理模块未加载');
                    break;
                }
                serverManager.status();
                if (serverManager.isRunning()) {
                    const tailChoice = await ask(rl, '\n是否查看实时日志? (y/N): ');
                    if (tailChoice.toLowerCase() === 'y' && logHandler) {
                        logHandler.tail();
                    }
                }
                break;
            }

            case '13': {
                // 备份/恢复（方案管理）
                // V3.5.7：「创建方案」已上移到主菜单第 2 项，此处只保留日常管理操作，
                // 原 2-5 项顺次重编号为 1-4。
                printHeader('备份/恢复 (方案管理)');
                if (!schemeManager) {
                    console.log('方案管理模块未加载');
                    break;
                }
                console.log('\n  1. 切换方案');
                console.log('  2. 列出方案');
                console.log('  3. 删除方案');
                console.log('  4. 方案信息');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-4): ');
                switch (subChoice) {
                    case '1': {
                        schemeManager.list();
                        const name = await ask(rl, '要切换到的方案名: ');
                        if (name) {
                            schemeManager.switch(name);
                        }
                        break;
                    }
                    case '2':
                        schemeManager.list();
                        break;
                    case '3': {
                        schemeManager.list();
                        const name = await ask(rl, '要删除的方案名: ');
                        if (name) {
                            const confirm = await ask(rl, `确定删除方案 "${name}"? (y/N): `);
                            if (confirm.toLowerCase() === 'y') {
                                await schemeManager.delete(name);
                            }
                        }
                        break;
                    }
                    case '4': {
                        schemeManager.list();
                        const name = await ask(rl, '方案名: ');
                        if (name) {
                            schemeManager.info(name);
                        }
                        break;
                    }
                }
                break;
            }

            case '14': {
                // Web 主题更改
                printHeader('Web 主题更改');
                if (!themeManager) {
                    console.log('主题管理模块未加载');
                    break;
                }
                console.log('\n  1. 列出已安装主题');
                console.log('  2. 安装主题');
                console.log('  3. 切换主题');
                console.log('  4. 删除主题');
                console.log('  0. 返回');
                const subChoice = await ask(rl, '\n请选择 (0-4): ');
                switch (subChoice) {
                    case '1':
                        themeManager.list();
                        break;
                    case '2': {
                        const filePath = await ask(rl, '主题 ZIP 文件路径: ');
                        if (filePath) {
                            await themeManager.install(filePath, rl);
                        }
                        break;
                    }
                    case '3': {
                        themeManager.list();
                        const name = await ask(rl, '要切换的主题名: ');
                        if (name) {
                            await themeManager.switch(name, rl);
                        }
                        break;
                    }
                    case '4': {
                        themeManager.list();
                        const name = await ask(rl, '要删除的主题名: ');
                        if (name) {
                            themeManager.delete(name);
                        }
                        break;
                    }
                }
                break;
            }

            case '15': {
                // 联机 / 我要当房主（陶瓦 Terracotta）
                printHeader('联机 / 我要当房主 (陶瓦)');
                const Terracotta = require('./terracotta');
                console.log('\n   powered by Terracotta | 陶瓦联机 (AGPLv3)');
                console.log('   基于 EasyTier 的内网穿透，好友无需公网 IP 即可加入你的 Minecraft 服务端。');
                console.log('   加入端由 PCL / HMCL / BakaXL / FCL 等启动器内置支持。\n');
                console.log('  1. 我要当房主（开房）');
                console.log('  2. 查看房间号 / 状态');
                console.log('  3. 关房（停止陶瓦）');
                console.log('  0. 返回');
                const sub = await ask(rl, '\n请选择 (0-3): ');
                try {
                    if (sub === '1') {
                        console.log('提示：开房前请先启动 Minecraft 服务端（菜单 1），陶瓦会自动扫描本机服务端端口。');
                        await Terracotta.hostRoom({ promptPort: (msg) => ask(rl, msg) });
                    } else if (sub === '2') {
                        const s = await Terracotta.getStatus();
                        if (!s.running) {
                            console.log('当前未开房（陶瓦未运行）。选择 1 开房。');
                        } else {
                            console.log(`运行状态:  🟢 运行中`);
                            console.log(`本地 API:  127.0.0.1:${s.port}`);
                            console.log(`房间号:    ${s.roomCode || '(生成中)'}`);
                            console.log(`状态机:    ${s.state || '未知'}`);
                            if (s.roomCode) {
                                console.log(`\n把房间号发给好友，对方在 PCL / HMCL / BakaXL / FCL 中选择「加入陶瓦房间」并输入该房间号即可联机。`);
                            }
                        }
                    } else if (sub === '3') {
                        await Terracotta.stopHost();
                    }
                } catch (e) {
                    console.error(`❌ 操作失败: ${e.message}`);
                }
                break;
            }

            default:
                console.log(`未知菜单选项: ${choice}`);
        }
    } catch (e) {
        console.error(`执行菜单操作时出错: ${e.message}`);
    } finally {
        if (ownRl) rl.close();
    }
}

/**
 * Java 设置流程（V3.5.7 新增）
 * 1) 扫描本机所有 Java（PATH / 系统包 / IDE / 版本管理器）
 * 2) 列出并标注主版本与来源，供用户选择
 * 3) 支持「自动检测」与「手动输入路径」
 * 4) 支持按 MC 版本自动安装缺失的 Java（Temurin）
 */
async function javaSettingsFlow(rl, config, utils) {
    let JreManager;
    try {
        JreManager = require('./jre_manager');
    } catch (e) {
        console.log(`Java 管理模块加载失败: ${e.message}`);
        return;
    }
    const jre = new JreManager();

    for (;;) {
        const current = config.getConfig('server.java', null);
        console.log('\n' + '─'.repeat(52));
        console.log(`当前配置: ${current ? current : '(自动检测)'}`);

        let list = [];
        try { list = utils.scanAllJava(); } catch (e) { list = []; }

        if (list.length === 0) {
            console.log('\n本机未扫描到任何可用的 Java。');
        } else {
            console.log(`\n本机扫描到 ${list.length} 个 Java：`);
            list.forEach((j, i) => {
                const ver = j.major != null ? `Java ${j.major}` : '版本未知';
                console.log(`  ${String(i + 1).padStart(2)}. ${ver.padEnd(9)} [${j.source}]  ${j.path}`);
            });
        }

        const bundled = jre.listBundled ? jre.listBundled() : [];
        if (bundled.length) {
            console.log(`\n内置 JRE（core/jre）: Java ${bundled.join(', Java ')}`);
        }

        console.log('\n  a. 自动检测（清除手动配置）');
        console.log('  m. 手动输入 Java 路径');
        console.log('  i. 自动安装缺失的 Java（按 MC 版本）');
        console.log('  0. 返回');
        console.log('─'.repeat(52));

        const c = (await ask(rl, '\n请选择: ')).trim().toLowerCase();

        if (c === '0' || c === '') break;

        if (c === 'a') {
            config.setConfig('server.java', null);
            console.log('✅ 已切换为自动检测模式。');
            continue;
        }

        if (c === 'm') {
            const p = (await ask(rl, 'Java 可执行文件完整路径: ')).trim();
            if (!p) { console.log('未输入，已取消。'); continue; }
            const fs = require('fs');
            if (!fs.existsSync(p)) {
                console.log(`❌ 路径不存在: ${p}`);
                continue;
            }
            // 探测该路径的真实版本，避免用户误填
            const hit = (utils.scanAllJava() || [])
                .find(j => require('path').normalize(j.path) === require('path').normalize(p));
            if (hit && hit.major != null) {
                console.log(`   该 Java 主版本: ${hit.major}`);
            } else {
                console.log('⚠️  无法确认该路径可执行（不在扫描结果中），仍将写入配置。');
            }
            config.setConfig('server.java', p);
            console.log('✅ Java 路径已更新。');
            continue;
        }

        if (c === 'i') {
            const mc = (await ask(rl, '目标 Minecraft 版本 (如 1.20.1): ')).trim();
            if (!mc) { console.log('未输入，已取消。'); continue; }
            const need = jre.getRequiredJavaVersion(mc);
            console.log(`\nMinecraft ${mc} 需要 Java ${need}。`);
            try {
                const p = await jre.resolveJavaFor(mc, true);
                console.log(`\n✅ 可用 Java: ${p}`);
                const setIt = await ask(rl, '是否写入配置 server.java? (y/N): ');
                if (setIt.toLowerCase() === 'y') {
                    config.setConfig('server.java', p);
                    console.log('✅ 已写入配置。');
                }
            } catch (e) {
                console.log(`\n❌ 处理失败: ${e.message}`);
            }
            continue;
        }

        // 数字：选择列出的某个 Java
        const idx = parseInt(c, 10);
        if (!isNaN(idx) && idx >= 1 && idx <= list.length) {
            const picked = list[idx - 1];
            config.setConfig('server.java', picked.path);
            console.log(`✅ 已选择 ${picked.major != null ? 'Java ' + picked.major : '该 Java'}: ${picked.path}`);
            continue;
        }

        console.log('无效选择。');
    }
}

module.exports = {
    showMainMenu,
    dispatchMenu,
    createRL,
    ask,
    clearScreen,
    printHeader,
    javaSettingsFlow
};
