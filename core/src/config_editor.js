/**
 * 多格式模组配置编辑器 (V3.1)
 * 支持 JSON / TOML / YAML / Properties / 纯文本配置文件的读取与编辑
 * 覆盖 Minecraft 服务器 config/ 目录下常见格式
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const toml = require('toml');
const utils = require('./utils');

// 支持的配置文件扩展名
const SUPPORTED_EXTS = ['.json', '.toml', '.cfg', '.yml', '.yaml', '.properties', '.conf', '.txt', '.ini'];

/**
 * 扫描 config/ 目录下所有支持的配置文件
 * @param {string} serverDir - 服务器目录
 * @param {string} filter - 可选格式过滤（如 'toml'）
 * @returns {Array<{name, path, size, ext}>}
 */
function getConfigFiles(serverDir, filter = null) {
    const configDir = path.join(serverDir, 'config');
    if (!fs.existsSync(configDir)) return [];

    const results = [];
    const walkDir = (dir) => {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walkDir(fullPath);
            } else if (stat.isFile()) {
                const ext = path.extname(entry).toLowerCase();
                if (SUPPORTED_EXTS.includes(ext)) {
                    if (filter && ext !== `.${filter}`) continue;
                    results.push({
                        name: entry,
                        relPath: path.relative(configDir, fullPath),
                        fullPath,
                        size: stat.size,
                        ext
                    });
                }
            }
        }
    };
    walkDir(configDir);
    return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * 按扩展名解析配置文件内容
 * @param {string} filePath
 * @returns {{success: boolean, data?: object|string, error?: string, ext?: string}}
 */
function readConfig(filePath) {
    if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
    }

    const ext = path.extname(filePath).toLowerCase();
    const raw = fs.readFileSync(filePath, 'utf8');

    try {
        switch (ext) {
            case '.json':
                return { success: true, data: JSON.parse(raw), ext: 'json' };
            case '.toml':
                return { success: true, data: toml.parse(raw), ext: 'toml' };
            case '.yml':
            case '.yaml':
                return { success: true, data: yaml.load(raw) || {}, ext: 'yaml' };
            case '.properties':
            case '.cfg':
            case '.conf':
            case '.ini':
                return { success: true, data: parseProperties(raw), ext: 'properties' };
            default:
                // 纯文本
                return { success: true, data: raw, ext: 'text' };
        }
    } catch (e) {
        // 解析失败，降级为纯文本显示
        return { success: true, data: raw, ext: 'text', warning: `解析为结构化数据失败 (${e.message})，以纯文本显示` };
    }
}

/**
 * 获取配置文件中的嵌套键值
 * @param {string} filePath
 * @param {string} key - 点号分隔的嵌套路径，如 "general.enable"
 * @returns {{success: boolean, value?: any, error?: string}}
 */
function getConfigValue(filePath, key) {
    const result = readConfig(filePath);
    if (!result.success) return result;
    if (typeof result.data !== 'object') {
        return { success: false, error: '此文件不是结构化格式，无法读取键值' };
    }

    const parts = key.split('.');
    let current = result.data;
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return { success: false, error: `键 "${key}" 不存在` };
        }
    }
    return { success: true, value: current };
}

/**
 * 设置配置文件中的嵌套键值（自动备份）
 * @param {string} filePath
 * @param {string} key - 点号分隔的嵌套路径
 * @param {any} value - 新值（自动类型推断）
 * @returns {{success: boolean, error?: string, backupPath?: string}}
 */
function setConfigValue(filePath, key, value) {
    const ext = path.extname(filePath).toLowerCase();

    // 非结构化文件不支持键值设置
    if (['.txt'].includes(ext) || (!['.json', '.toml', '.yml', '.yaml', '.properties', '.cfg', '.conf', '.ini'].includes(ext))) {
        return { success: false, error: `不支持对 ${ext} 文件进行键值设置，请直接编辑文件内容` };
    }

    // 读取当前数据
    let data;
    let isProperties = false;
    const raw = fs.readFileSync(filePath, 'utf8');

    try {
        switch (ext) {
            case '.json':
                data = JSON.parse(raw);
                break;
            case '.toml':
                data = toml.parse(raw);
                break;
            case '.yml':
            case '.yaml':
                data = yaml.load(raw) || {};
                break;
            case '.properties':
            case '.cfg':
            case '.conf':
            case '.ini':
                data = parseProperties(raw);
                isProperties = true;
                break;
            default:
                return { success: false, error: `不支持的格式: ${ext}` };
        }
    } catch (e) {
        return { success: false, error: `解析文件失败: ${e.message}` };
    }

    // 自动类型推断
    const typedValue = inferType(value);

    // 设置嵌套键值
    const parts = key.split('.');
    let current = data;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = typedValue;

    // 备份
    const backupPath = filePath + '.backup';
    fs.copyFileSync(filePath, backupPath);

    // 写入
    try {
        let output;
        switch (ext) {
            case '.json':
                output = JSON.stringify(data, null, 2);
                break;
            case '.toml':
                output = serializeToml(data);
                break;
            case '.yml':
            case '.yaml':
                output = yaml.dump(data, { indent: 2, lineWidth: -1 });
                break;
            case '.properties':
            case '.cfg':
            case '.conf':
            case '.ini':
                output = serializeProperties(data);
                break;
            default:
                output = JSON.stringify(data, null, 2);
        }
        fs.writeFileSync(filePath, output, 'utf8');
        return { success: true, backupPath };
    } catch (e) {
        // 恢复备份
        fs.copyFileSync(backupPath, filePath);
        fs.removeSync(backupPath);
        return { success: false, error: `写入失败，已恢复备份: ${e.message}` };
    }
}

/**
 * 平铺列出配置文件中所有键值
 * @param {string} filePath
 * @returns {{success: boolean, entries?: Array<{key, value, type}>, error?: string}}
 */
function listConfig(filePath) {
    const result = readConfig(filePath);
    if (!result.success) return result;
    if (typeof result.data !== 'object' || result.data === null) {
        return { success: false, error: '此文件不是结构化格式' };
    }

    const entries = [];
    const flatten = (obj, prefix = '') => {
        for (const key in obj) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            const val = obj[key];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                flatten(val, fullKey);
            } else {
                entries.push({ key: fullKey, value: val, type: typeof val });
            }
        }
    };
    flatten(result.data);
    return { success: true, entries };
}

/**
 * 备份 config/ 目录下所有配置文件
 * @param {string} serverDir
 * @returns {{success: boolean, count: number, backupDir: string}}
 */
function backupConfigs(serverDir) {
    const configDir = path.join(serverDir, 'config');
    if (!fs.existsSync(configDir)) {
        return { success: false, count: 0, backupDir: null, error: 'config 目录不存在' };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupDir = path.join(serverDir, 'backups', 'config', `config_backup_${timestamp}`);
    fs.ensureDirSync(backupDir);

    fs.copySync(configDir, backupDir);
    const count = getConfigFiles(serverDir).length;

    // 写备份信息文件
    const info = {
        timestamp,
        time: new Date().toISOString(),
        sourceDir: configDir,
        fileCount: count
    };
    fs.writeFileSync(path.join(backupDir, 'backup_info.json'), JSON.stringify(info, null, 2));

    return { success: true, count, backupDir };
}

// ==================== 私有辅助函数 ====================

/**
 * 解析 properties 格式（key=value，支持 # 注释）
 */
function parseProperties(content) {
    const result = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        result[key] = value;
    }
    return result;
}

/**
 * 序列化 properties 格式
 */
function serializeProperties(data) {
    const lines = [];
    for (const key in data) {
        const val = data[key];
        if (Array.isArray(val)) {
            lines.push(`# ${key} = [${val.join(', ')}]`);
        } else if (typeof val === 'object' && val !== null) {
            lines.push(`# ${key} = ${JSON.stringify(val)}`);
        } else {
            lines.push(`${key}=${val}`);
        }
    }
    return lines.join('\n') + '\n';
}

/**
 * 简易 TOML 序列化（嵌套对象+基本类型）
 * 注意：这是简化实现，复杂场景建议使用 @iarna/toml
 */
function serializeToml(data, prefix = '') {
    const lines = [];
    const tables = [];

    for (const key in data) {
        const val = data[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            // 嵌套对象 → [section]
            const section = prefix ? `${prefix}.${key}` : key;
            lines.push(`\n[${section}]`);
            for (const subKey in val) {
                lines.push(`${subKey}=${formatTomlValue(val[subKey])}`);
            }
        } else {
            lines.push(`${key}=${formatTomlValue(val)}`);
        }
    }
    return lines.join('\n').trim() + '\n';
}

function formatTomlValue(val) {
    if (typeof val === 'string') return `"${val}"`;
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (Array.isArray(val)) return `[${val.map(v => formatTomlValue(v)).join(', ')}]`;
    if (val === null || val === undefined) return '""';
    return String(val);
}

/**
 * 自动类型推断
 */
function inferType(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null') return null;
    if (/^-?\d+$/.test(val)) return parseInt(val, 10);
    if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
    return val;
}

module.exports = {
    getConfigFiles,
    readConfig,
    getConfigValue,
    setConfigValue,
    listConfig,
    backupConfigs,
    SUPPORTED_EXTS
};
