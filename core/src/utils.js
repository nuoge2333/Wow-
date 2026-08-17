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
 * 取命令的完整路径（which）
 */
function _whichJava(cmd) {
    try {
        const whichResult = execSync(`which ${cmd}`, { stdio: 'pipe' });
        return whichResult.toString().trim();
    } catch {
        return cmd; // 如果无法获取完整路径，返回命令名
    }
}

/**
 * 当裸 `java` 不可用（典型：mise / rtx 等版本管理器下未设置全局版本，
 * 运行 `java -version` 会报 "No version is set for shim: java"）时，
 * 尝试用版本管理器解析本地已安装的 Java，避免回退到不可用的裸命令或被迫重新下载。
 * @param {string|null} preferredVersion 期望的特征版本（如 '17'），优先匹配，找不到再逐级兜底
 */
function _detectVersionManagerJava(preferredVersion) {
    const candidates = [];
    if (preferredVersion) candidates.push(preferredVersion);
    candidates.push('21', '17', '11', '8'); // Minecraft 1.21+ / 1.17-1.20 / 1.13-1.16 / 1.12.2 及以下
    // 版本管理器二进制（mise 与旧名 rtx 都尝试）
    const vms = ['mise', 'rtx'];
    for (const vm of vms) {
        for (const v of candidates) {
            try {
                const p = execSync(`${vm} where java@${v} 2>/dev/null`, { stdio: 'pipe', timeout: 3000 })
                    .toString().trim();
                if (p && fs.existsSync(p)) return p;
            } catch (e) { /* 该版本未安装或无此命令，继续 */ }
        }
    }
    // 兜底：直接扫描版本管理器的 installs 目录
    const homes = [
        process.env.MISE_DATA_DIR,
        process.env.XDG_DATA_HOME,
        path.join(os.homedir(), '.local', 'share')
    ];
    const roots = [];
    for (const h of homes) {
        if (!h) continue;
        roots.push(path.join(h, 'mise', 'installs', 'java'));
        roots.push(path.join(h, 'rtx', 'installs', 'java'));
    }
    const seen = new Set();
    for (const root of roots) {
        if (!root || seen.has(root) || !fs.existsSync(root)) continue;
        seen.add(root);
        try {
            for (const d of fs.readdirSync(root)) {
                const bin = path.join(root, d, 'bin', 'java');
                if (fs.existsSync(bin)) return bin;
            }
        } catch (e) { /* ignore */ }
    }
    return null;
}

/**
 * 检测 Java 是否可用，返回可执行文件路径或 null
 * @param {string|null} [preferredVersion] 期望的特征版本（如 '17'），用于版本管理器场景优先匹配
 */
function detectJava(preferredVersion = null) {
    const javaCmds = ['java', 'java.exe'];
    for (const cmd of javaCmds) {
        try {
            const result = execSync(`${cmd} -version 2>&1`, { stdio: 'pipe', timeout: 3000 });
            const output = result.toString();
            if (output.includes('version')) {
                return _whichJava(cmd);
            }
        } catch (e) {
            // 继续尝试下一个
        }
    }
    // 裸 java 不可用（mise/rtx 未设置全局版本等），尝试用版本管理器解析本地已安装 Java
    const vmJava = _detectVersionManagerJava(preferredVersion);
    if (vmJava) return vmJava;
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
 *
 * V3.4.x 起改为「直接在方案目录内运行」：若当前激活了方案（server.scheme 配置指向
 * 某个已存在的方案），则服务器直接以 core/schemes/<方案名> 为根目录启动，不再把方案
 * 复制到 server/ 目录再跑。这样可以彻底避免「复制方案到 server 目录」带来的问题：
 *   - 世界数据在 scheme 与 server 两套目录间来回复制、重复、易丢；
 *   - 切换方案时 server/ 被 _backup_ 目录堆积、且原 server/ 内容被整体清空；
 *   - 在方案目录里改了东西（配置/存档），因为实际跑的是 server/ 副本而不生效。
 * 仅当未激活任何方案时，才回退到默认 server.dir（../server）。
 */
function getServerDir() {
    const config = require('./config');
    const scheme = config.getConfig('server.scheme', null);
    if (scheme) {
        const schemePath = resolvePath(path.join('schemes', scheme));
        if (fs.existsSync(schemePath)) {
            return schemePath;
        }
        // 配置指向的方案目录已不存在，回退到默认 server 目录
    }
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