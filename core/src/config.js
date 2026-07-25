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
    auto_scheme: true
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
}

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