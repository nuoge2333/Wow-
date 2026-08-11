/**
 * 工具函数模块
 * 包含 Java 检测、目录创建、路径解析等
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/**
 * 获取当前操作系统类型
 */
function getOS() {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
}

/**
 * 检测 Java 是否可用，返回可执行文件路径或 null
 */
function detectJava() {
    const javaCmds = ['java', 'java.exe'];
    for (const cmd of javaCmds) {
        try {
            const result = execSync(`${cmd} -version 2>&1`, { stdio: 'pipe', timeout: 3000 });
            const output = result.toString();
            if (output.includes('version')) {
                // 找到 java，尝试获取完整路径
                try {
                    const whichResult = execSync(`which ${cmd}`, { stdio: 'pipe' });
                    return whichResult.toString().trim();
                } catch {
                    return cmd; // 如果无法获取完整路径，返回命令名
                }
            }
        } catch (e) {
            // 继续尝试下一个
        }
    }
    return null;
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
    fs.ensureDirSync(dirPath);
    return dirPath;
}

/**
 * 获取绝对路径（相对于 core/ 目录）
 */
function resolvePath(relativePath) {
    return path.resolve(__dirname, '..', relativePath);
}

/**
 * 获取 pool 目录下的子路径
 */
function getPoolPath(subPath = '') {
    const config = require('./config');
    const poolDir = config.getConfig('pool.dir', 'pool');
    return resolvePath(path.join(poolDir, subPath));
}

/**
 * 获取模组存储路径: pool/mods/{loader}/{version}/
 */
function getModStoragePath(loader, version) {
    const modsBase = getPoolPath('mods');
    return path.join(modsBase, loader, version);
}

/**
 * 获取插件存储路径: pool/plugins/{loader}/
 */
function getPluginStoragePath(loader) {
    const pluginsBase = getPoolPath('plugins');
    return path.join(pluginsBase, loader);
}

/**
 * 获取核心存储路径: pool/cores/{type}/{version}/
 */
function getCoreStoragePath(type, version) {
    const coresBase = getPoolPath('cores');
    return path.join(coresBase, type, version);
}

/**
 * 获取加载器安装包路径: pool/loader/{loader}/{version}/
 */
function getLoaderStoragePath(loader, version) {
    const loaderBase = getPoolPath('loader');
    return path.join(loaderBase, loader, version);
}

/**
 * 获取 JRE 存储路径
 */
function getJrePath() {
    const config = require('./config');
    const jreDir = config.getConfig('jre.dir', 'jre');
    return resolvePath(jreDir);
}

/**
 * 获取当前激活的服务器目录
 */
function getServerDir() {
    const config = require('./config');
    const serverDir = config.getConfig('server.dir', '../server');
    return resolvePath(serverDir);
}

/**
 * 检查某个命令是否存在
 */
function commandExists(cmd) {
    try {
        const result = execSync(`which ${cmd}`, { stdio: 'pipe' });
        return result.toString().trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * 获取文件大小（人性化格式）
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 安全地删除目录（先检查是否存在）
 */
function removeDirIfExists(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.removeSync(dirPath);
    }
}

module.exports = {
    getOS,
    detectJava,
    ensureDir,
    resolvePath,
    getPoolPath,
    getModStoragePath,
    getPluginStoragePath,
    getCoreStoragePath,
    getLoaderStoragePath,
    getJrePath,
    getServerDir,
    commandExists,
    formatFileSize,
    removeDirIfExists
};