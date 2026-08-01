/**
 * 配置管理模块
 * 读写 wow.yaml，支持嵌套键访问
 * 默认配置在首次运行时生成
 */

const fs = require('fs-extra');
const yaml = require('js-yaml');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../wow.yaml');

const DEFAULT_CONFIG = {
    language: 'zh_CN',
    server: {
        dir: '../server',          // 相对于 core/ 的路径
        jar: null,
        java: null,
        jvm_args: ['-Xmx2G', '-Xms2G', '-XX:+UseG1GC']
    },
    download: {
        mirror: 'https://bmclapi2.bangbang93.com',
        timeout: 30,
        retry: 3
    },
    mod: {
        auto_dependencies: true,
        sources: ['curseforge', 'modrinth']
    },
    backup: {
        dir: '../server/backups',
        auto: false,
        max: 5
    },
    web: {
        port: 8080,
        host: '127.0.0.1',
        auth_token: null,
        run_startup: true,
        theme: 'default'
    },
    mail: {
        smtp: {
            host: null,
            port: 587,
            user: null,
            pass: null,
            from: null
        },
        admin_email: null,
        send_on_crash: true,
        send_logs_interval: 0
    },
    ai: {
        api_key: null,
        model: null,
        api_url: null
    },
    auth: {
        enable: false,
        javaagent: null,
        server: null
    },
    plugins: {
        port: 9000,
        enabled: false
    },
    verbose: false,
    // pool 相关路径（相对于 core/）
    pool: {
        dir: 'pool',
        cores: 'pool/cores',
        mods: 'pool/mods',
        plugins: 'pool/plugins',
        loader: 'pool/loader'
    },
    jre: {
        dir: 'jre',
        auto_download: true
    },
    auto_scheme: true,
    // 联机 / 内网穿透（陶瓦 Terracotta）配置 V3.3.0
    // 陶瓦(Terracotta) 基于 EasyTier，为 Minecraft: Java Edition 提供内网/局域网穿透联机。
    // 项目: https://github.com/burningtnt/Terracotta  国内镜像: https://gitee.com/burningtnt/Terracotta/releases
    // 3.3.0 仅实现「房主端 / 我要当房主」，加入端由 PCL/HMCL/BakaXL/FCL 等启动器内置支持。
    lan: {
        auto_room: false,          // 服务器启动时自动开房（非交互/后台场景推荐）
        room_code: '',             // 固定房间号（留空 = 由陶瓦自动生成）；好友在启动器输入此号即可加入
        server_port: 25565,        // 本地 MC 服务端端口（陶瓦会自动扫描本机该端口的 Minecraft 服务端）
        mirror: 'https://gitee.com/burningtnt/Terracotta/releases', // 二进制下载镜像（默认 Gitee）
        version: '0.4.2',          // 陶瓦版本号（对应 release tag v0.4.2）
        binary_url: ''             // 二进制完整下载地址（留空 = 按 mirror/version/platform 自动拼装）
        // 运行时状态（端口/pid/房间号/二进制路径）由 wow~ 写入 core/.lan.json，请勿手改本段之外的字段
    }
};

/**
 * 获取配置值，支持点号分隔键
 */
function getConfig(key, defaultValue = null) {
    const config = loadConfig();
    const parts = key.split('.');
    let current = config;
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return defaultValue;
        }
    }
    return current !== undefined ? current : defaultValue;
}

/**
 * 设置配置值，自动创建嵌套路径
 */
function setConfig(key, value) {
    const config = loadConfig();
    const parts = key.split('.');
    let current = config;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
    saveConfig(config);
}

/**
 * 加载配置文件，如果不存在则创建默认
 */
function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        // 创建默认配置
        saveConfig(DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
    }
    try {
        const fileContent = fs.readFileSync(CONFIG_FILE, 'utf8');
        const userConfig = yaml.load(fileContent);
        // 合并默认值（缺失的键补上）
        return mergeDeep(DEFAULT_CONFIG, userConfig);
    } catch (e) {
        console.error(`加载配置文件失败: ${e.message}`);
        return DEFAULT_CONFIG;
    }
}

/**
 * 保存配置
 */
function saveConfig(config) {
    try {
        fs.ensureDirSync(path.dirname(CONFIG_FILE));
        fs.writeFileSync(CONFIG_FILE, yaml.dump(config, { indent: 2, lineWidth: -1 }), 'utf8');
    } catch (e) {
        console.error(`保存配置文件失败: ${e.message}`);
    }
}

/**
 * 深度合并对象
 */
function mergeDeep(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = mergeDeep(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

/**
 * 获取当前激活的配置
 */
function getFullConfig() {
    return loadConfig();
}

// ==================== ServerProperties 类 ====================

/**
 * Minecraft server.properties 文件管理
 */
class ServerProperties {
    constructor(serverDir) {
        this.filePath = path.join(serverDir, 'server.properties');
    }

    /**
     * 读取配置项
     */
    get(key) {
        if (!fs.existsSync(this.filePath)) return null;
        const content = fs.readFileSync(this.filePath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || trimmed === '') continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const k = trimmed.substring(0, eqIdx).trim();
            const v = trimmed.substring(eqIdx + 1).trim();
            if (k === key) return v;
        }
        return null;
    }

    /**
     * 设置配置项
     */
    set(key, value) {
        let content = '';
        let found = false;
        if (fs.existsSync(this.filePath)) {
            content = fs.readFileSync(this.filePath, 'utf8');
        }
        const lines = content.split('\n');
        const newLines = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || trimmed === '') return line;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) return line;
            const k = trimmed.substring(0, eqIdx).trim();
            if (k === key) {
                found = true;
                return `${key}=${value}`;
            }
            return line;
        });
        if (!found) {
            newLines.push(`${key}=${value}`);
        }
        fs.ensureDirSync(path.dirname(this.filePath));
        fs.writeFileSync(this.filePath, newLines.join('\n'), 'utf8');
    }

    /**
     * 获取所有配置项
     */
    getAll() {
        if (!fs.existsSync(this.filePath)) return {};
        const content = fs.readFileSync(this.filePath, 'utf8');
        const result = {};
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || trimmed === '') continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const k = trimmed.substring(0, eqIdx).trim();
            const v = trimmed.substring(eqIdx + 1).trim();
            result[k] = v;
        }
        return result;
    }

    /**
     * 分类列出所有属性（V3.1 新增）
     */
    listAll() {
        const all = this.getAll();
        if (Object.keys(all).length === 0) {
            console.log('  (空)');
            return all;
        }

        const categories = {
            '🌍 世界设置': ['level-name', 'level-seed', 'level-type', 'generate-structures', 'generator-settings', 'allow-nether', 'spawn-protection', 'max-world-size'],
            '🌐 网络设置': ['server-port', 'server-ip', 'online-mode', 'max-players', 'network-compression-threshold', 'use-native-transport', 'simulation-distance', 'view-distance'],
            '🎮 游戏规则': ['gamemode', 'difficulty', 'hardcore', 'pvp', 'force-gamemode', 'allow-flight', 'enable-command-block', 'op-permission-level'],
            '👥 玩家设置': ['white-list', 'enforce-whitelist', 'broadcast-console-to-ops', 'broadcast-rcon-to-ops', 'max-tick-time', 'player-idle-timeout'],
            '🐾 生物/实体': ['spawn-animals', 'spawn-monsters', 'spawn-npcs', 'entity-broadcast-range-percentage', 'max-entity-cramming'],
            '📡 RCON/查询': ['enable-rcon', 'rcon.password', 'rcon.port', 'enable-query', 'query.port'],
                    '🔧 资源/性能': ['resource-pack', 'resource-pack-sha1', 'motd', 'prevent-proxy-connections', 'snooper-enabled', 'rate-limit', 'previews-chat'],
            '📦 其他': []
        };

        // 收集已分类的 key
        const classified = new Set();
        for (const cat of Object.values(categories)) {
            cat.forEach(k => classified.add(k));
        }

        for (const [catName, keys] of Object.entries(categories)) {
            const items = [];
            for (const key of keys) {
                if (key in all) {
                    items.push({ key, value: all[key] });
                }
            }
            // "其他" 类别收集未分类的
            if (catName === '📦 其他') {
                for (const [k, v] of Object.entries(all)) {
                    if (!classified.has(k)) {
                        items.push({ key: k, value: v });
                    }
                }
            }
            if (items.length > 0) {
                console.log(`\n  ${catName}:`);
                for (const item of items) {
                    const displayVal = item.value || '(空)';
                    console.log(`    ${item.key} = ${displayVal}`);
                }
            }
        }

        return all;
    }

    /**
     * 快速设置常用属性（V3.1 新增）
     * @param {object} readline - readline 接口（可选，用于交互式输入）
     */
    async quickSet(readline) {
        const readlineModule = readline || require('readline');
        const rl = readlineModule.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

        console.log('\n⚡ 快速设置向导 (回车跳过)');
        console.log('─'.repeat(50));

        const quickItems = [
            { key: 'server-port', label: '服务器端口', default: '25565' },
            { key: 'max-players', label: '最大玩家数', default: '20' },
            { key: 'difficulty', label: '难度 (peaceful/easy/normal/hard)', default: 'easy' },
            { key: 'gamemode', label: '游戏模式 (survival/creative/adventure/spectator)', default: 'survival' },
            { key: 'motd', label: '服务器 MOTD 描述', default: 'A Minecraft Server' },
            { key: 'online-mode', label: '正版验证 (true/false)', default: 'true' },
            { key: 'pvp', label: 'PVP 开关 (true/false)', default: 'true' },
            { key: 'allow-flight', label: '允许飞行 (true/false)', default: 'false' },
            { key: 'white-list', label: '白名单 (true/false)', default: 'false' },
            { key: 'level-name', label: '世界名称', default: 'world' },
            { key: 'level-seed', label: '世界种子', default: '' },
            { key: 'enable-command-block', label: '命令方块 (true/false)', default: 'false' },
            { key: 'view-distance', label: '视距 (2-32)', default: '10' },
            { key: 'spawn-protection', label: '出生点保护半径', default: '16' }
        ];

        for (const item of quickItems) {
            const current = this.get(item.key);
            const currentStr = current !== null ? ` [当前: ${current}]` : '';
            const answer = await question(`  ${item.label}${currentStr} (默认: ${item.default}): `);
            const value = answer.trim() || (current !== null ? current : item.default);
            this.set(item.key, value);
            console.log(`    ✅ ${item.key} = ${value}`);
        }

        rl.close();
        console.log('\n✅ server.properties 快速设置完成');
    }

    /**
     * 重置属性为默认值（V3.1 新增）
     * @param {string} key
     */
    reset(key) {
        if (key in ServerProperties.DEFAULTS) {
            this.set(key, ServerProperties.DEFAULTS[key]);
            return { success: true, key, value: ServerProperties.DEFAULTS[key] };
        }
        // 如果不在默认列表中，删除该属性
        this.set(key, '');
        return { success: true, key, value: '(已清除)' };
    }
}

// Minecraft server.properties 默认值
ServerProperties.DEFAULTS = {
    'server-port': '25565',
    'server-ip': '',
    'max-players': '20',
    'level-name': 'world',
    'level-type': 'minecraft\:normal',
    'gamemode': 'survival',
    'difficulty': 'easy',
    'pvp': 'true',
    'hardcore': 'false',
    'allow-nether': 'true',
    'spawn-monsters': 'true',
    'spawn-animals': 'true',
    'spawn-npcs': 'true',
    'online-mode': 'true',
    'white-list': 'false',
    'allow-flight': 'false',
    'enable-command-block': 'false',
    'force-gamemode': 'false',
    'generate-structures': 'true',
    'view-distance': '10',
    'simulation-distance': '10',
    'max-world-size': '29999984',
    'spawn-protection': '16',
    'network-compression-threshold': '256',
    'motd': 'A Minecraft Server',
    'enable-rcon': 'false',
    'enable-query': 'false',
    'player-idle-timeout': '0',
    'max-tick-time': '60000',
    'prevent-proxy-connections': 'false',
    'use-native-transport': 'true',
    'enforce-whitelist': 'false',
    'broadcast-console-to-ops': 'true',
    'broadcast-rcon-to-ops': 'true',
    'op-permission-level': '4',
    'entity-broadcast-range-percentage': '100',
    'max-entity-cramming': '24',
    'snooper-enabled': 'true',
    'rate-limit': '0',
    'previews-chat': 'false',
    'resource-pack': '',
    'resource-pack-sha1': ''
};

// ==================== WhitelistManager 类 ====================

/**
 * Minecraft 白名单管理
 */
class WhitelistManager {
    constructor(serverDir) {
        this.filePath = path.join(serverDir, 'whitelist.json');
    }

    /**
     * 列出白名单玩家
     */
    list() {
        if (!fs.existsSync(this.filePath)) return [];
        try {
            const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (Array.isArray(data)) {
                return data.map(entry => entry.name || entry.uuid || entry);
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    /**
     * 添加玩家到白名单
     */
    add(playerName) {
        const list = [];
        if (fs.existsSync(this.filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                if (Array.isArray(data)) list.push(...data);
            } catch (e) {}
        }
        // 检查是否已存在
        const exists = list.some(entry =>
            (entry.name && entry.name.toLowerCase() === playerName.toLowerCase()) ||
            (entry.uuid && entry.uuid === playerName)
        );
        if (!exists) {
            list.push({ uuid: this._generateOfflineUUID(playerName), name: playerName });
        }
        fs.ensureDirSync(path.dirname(this.filePath));
        fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
    }

    /**
     * 从白名单移除玩家
     */
    remove(playerName) {
        if (!fs.existsSync(this.filePath)) return;
        try {
            let list = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (!Array.isArray(list)) return;
            list = list.filter(entry =>
                !(entry.name && entry.name.toLowerCase() === playerName.toLowerCase())
            );
            fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
        } catch (e) {}
    }

    /**
     * 生成离线模式 UUID（基于玩家名）
     */
    _generateOfflineUUID(playerName) {
        // 使用 "OfflinePlayer:" + name 的 MD5 生成 UUID（与 Minecraft 离线模式一致）
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update('OfflinePlayer:' + playerName).digest('hex');
        // 设置 version 位为 3 (name-based UUID)
        const uuid = hash.substring(0, 8) + '-' +
                     hash.substring(8, 12) + '-' +
                     '3' + hash.substring(13, 16) + '-' +
                     hash.substring(16, 20) + '-' +
                     hash.substring(20);
        return uuid;
    }
}

module.exports = {
    getConfig,
    setConfig,
    loadConfig,
    saveConfig,
    getFullConfig,
    DEFAULT_CONFIG,
    ServerProperties,
    WhitelistManager
};