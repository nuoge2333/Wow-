/**
 * 服务端安装模块
 * - 下载服务端核心（vanilla, forge, mohist, catserver, paper...）
 * - 支持多种下载源
 * - 安装后自动创建基础目录
 * - 支持方案模式（共享核心到 pool/cores/）
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const ProgressBar = require('progress');
const utils = require('./utils');
const config = require('./config');

// 服务端核心下载配置
const SERVER_SOURCES = {
    vanilla: {
        type: 'vanilla',
        url: (version, mirror) => `${mirror}/mc/game/version_manifest.json`,
        fileName: (version) => `minecraft_server.${version}.jar`,
        needsManifest: true
    },
    forge: {
        type: 'forge',
        url: (version, mirror) => `${mirror}/forge/minecraft/${version}/latest/download`,
        fileName: (version) => `forge-${version}.jar`
    },
    fabric: {
        type: 'fabric',
        url: (version) => `https://meta.fabricmc.net/v2/versions/loader/${version}/server/jar`,
        fileName: (version) => `fabric-server-mc.${version}.jar`
    },
    paper: {
        type: 'paper',
        url: (version, mirror) => `${mirror}/paper/${version}/latest/download`,
        fileName: (version) => `paper-${version}.jar`
    },
    purpur: {
        type: 'purpur',
        url: (version) => `https://api.purpurmc.org/v2/purpur/${version}/latest/download`,
        fileName: (version) => `purpur-${version}.jar`
    },
    spigot: {
        type: 'spigot',
        url: (version, mirror) => `${mirror}/spigot/${version}/latest/download`,
        fileName: (version) => `spigot-${version}.jar`
    },
    bukkit: {
        type: 'bukkit',
        url: (version, mirror) => `${mirror}/craftbukkit/${version}/latest/download`,
        fileName: (version) => `bukkit-${version}.jar`
    },
    // 中文社区核心
    mohist: {
        type: 'mohist',
        url: (version, build) => `https://dl.mohistmc.cn:41211/project/mohist/${version}/builds/${build || 'latest'}/download`,
        fileName: (version, build) => `mohist-${version}-build${build || 'latest'}.jar`,
        needsBuild: true,
        knownBuilds: {
            '1.12.2': '264',
            '1.16.5': '238',
            '1.20.1': '346'
        }
    },
    catserver: {
        type: 'catserver',
        url: (version) => {
            const urls = {
                '1.12.2': 'https://catserver.moe/download/universal',
                '1.16.5': 'https://catmc.org/download/catserver_1_16_5',
                '1.18.2': 'https://catmc.org/download/catserver_1_18_2'
            };
            return urls[version] || null;
        },
        fileName: (version) => `catserver-${version}.jar`
    },
    // 其他
    leaves: {
        type: 'leaves',
        url: (version, mirror) => `${mirror}/leaves/${version}/latest/download`,
        fileName: (version) => `leaves-${version}.jar`
    }
};

class Installer {
    constructor() {
        this.config = config;
        this.mirror = this.config.getConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
        this.serverDir = utils.getServerDir();
    }

    /**
     * 获取服务端核心信息
     */
    getServerInfo(type) {
        return SERVER_SOURCES[type] || null;
    }

    /**
     * 获取支持的版本列表
     */
    async getAvailableVersions(type) {
        const source = SERVER_SOURCES[type];
        if (!source) throw new Error(`不支持的服务端类型: ${type}`);

        if (type === 'vanilla') {
            return this._getVanillaVersions();
        }
        if (type === 'paper') {
            return this._getPaperVersions();
        }
        if (type === 'purpur') {
            return this._getPurpurVersions();
        }
        if (type === 'mohist') {
            return Object.keys(source.knownBuilds);
        }
        if (type === 'catserver') {
            return Object.keys(SERVER_SOURCES.catserver.url({}));
        }

        // 其他类型返回预定义列表或空
        return ['1.12.2', '1.16.5', '1.18.2', '1.19.2', '1.20.1', '1.20.4', '1.21'];
    }

    /**
     * 获取原版版本列表
     */
    async _getVanillaVersions() {
        try {
            const response = await axios.get(`${this.mirror}/mc/game/version_manifest.json`, { timeout: 10000 });
            return response.data.versions.map(v => v.id);
        } catch (e) {
            console.error('获取原版版本列表失败:', e.message);
            return ['1.20.1', '1.20.4', '1.21'];
        }
    }

    /**
     * 获取 Paper 版本列表
     */
    async _getPaperVersions() {
        try {
            const response = await axios.get(`${this.mirror}/paper/list`, { timeout: 10000 });
            return Object.keys(response.data.versions || {});
        } catch (e) {
            console.error('获取 Paper 版本列表失败:', e.message);
            return ['1.20.1', '1.20.4', '1.21'];
        }
    }

    /**
     * 获取 Purpur 版本列表
     */
    async _getPurpurVersions() {
        try {
            const response = await axios.get('https://api.purpurmc.org/v2/purpur', { timeout: 10000 });
            return response.data.versions || [];
        } catch (e) {
            console.error('获取 Purpur 版本列表失败:', e.message);
            return ['1.20.1', '1.20.4', '1.21'];
        }
    }

    /**
     * 下载服务端核心
     */
    async install(type, version, build = null, targetDir = null) {
        const source = SERVER_SOURCES[type];
        if (!source) {
            throw new Error(`不支持的服务端类型: ${type}`);
        }

        const installDir = targetDir || this.serverDir;
        fs.ensureDirSync(installDir);

        // 检查是否已存在
        const fileName = source.fileName(version, build || source.knownBuilds?.[version]);
        const targetPath = path.join(installDir, fileName);

        if (fs.existsSync(targetPath)) {
            console.log(`服务端核心已存在: ${fileName}`);
            return targetPath;
        }

        // 构建下载 URL
        let downloadUrl;
        if (type === 'vanilla') {
            downloadUrl = await this._getVanillaDownloadUrl(version);
        } else if (type === 'mohist') {
            const buildNumber = build || source.knownBuilds?.[version];
            if (!buildNumber) {
                throw new Error(`Mohist 版本 ${version} 需要指定构建号`);
            }
            downloadUrl = source.url(version, buildNumber);
        } else if (typeof source.url === 'function') {
            downloadUrl = source.url(version, this.mirror);
        } else {
            downloadUrl = source.url;
        }

        if (!downloadUrl) {
            throw new Error(`无法获取 ${type} ${version} 的下载链接`);
        }

        console.log(`下载 ${type} ${version}...`);
        console.log(`URL: ${downloadUrl}`);

        // 下载文件
        const tempPath = path.join(installDir, `${fileName}.tmp`);
        try {
            await this._downloadFile(downloadUrl, tempPath);
            // 重命名
            fs.renameSync(tempPath, targetPath);
            console.log(`下载完成: ${targetPath}`);

            // 记录配置
            this.config.setConfig('server.version', version);
            this.config.setConfig('server.type', type);

            // 复制到 pool/cores 供共享
            await this._copyToPool(type, version, targetPath);

            return targetPath;
        } catch (e) {
            if (fs.existsSync(tempPath)) fs.removeSync(tempPath);
            throw new Error(`下载失败: ${e.message}`);
        }
    }

    /**
     * 复制核心到 pool/cores 供多方案共享
     */
    async _copyToPool(type, version, sourcePath) {
        const coreStorage = utils.getCoreStoragePath(type, version);
        fs.ensureDirSync(coreStorage);
        const targetPath = path.join(coreStorage, path.basename(sourcePath));
        if (!fs.existsSync(targetPath)) {
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`核心已共享到: ${targetPath}`);
        }
        return targetPath;
    }

    /**
     * 获取原版服务端下载 URL
     */
    async _getVanillaDownloadUrl(version) {
        try {
            const response = await axios.get(`${this.mirror}/mc/game/version_manifest.json`, { timeout: 10000 });
            const versionInfo = response.data.versions.find(v => v.id === version);
            if (!versionInfo) {
                throw new Error(`版本 ${version} 不存在`);
            }
            // 获取详细版本信息
            const detailResponse = await axios.get(versionInfo.url, { timeout: 10000 });
            return detailResponse.data.downloads.server.url;
        } catch (e) {
            throw new Error(`获取原版下载链接失败: ${e.message}`);
        }
    }

    /**
     * 下载文件（带进度条）
     */
    _downloadFile(url, destPath) {
        return new Promise((resolve, reject) => {
            axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 600000, // 10分钟超时
                maxRedirects: 10
            }).then(response => {
                const totalLength = parseInt(response.headers['content-length'] || '0', 10);
                const progress = new ProgressBar(`  下载中 [:bar] :percent :etas`, {
                    width: 40,
                    complete: '=',
                    incomplete: ' ',
                    renderThrottle: 100,
                    total: totalLength || 1
                });

                const writer = fs.createWriteStream(destPath);
                response.data.on('data', (chunk) => {
                    if (totalLength > 0) progress.tick(chunk.length);
                });

                response.data.pipe(writer);

                writer.on('finish', () => {
                    resolve();
                });

                writer.on('error', (err) => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        });
    }

    /**
     * 安装必要的目录结构
     */
    setupDirectories(targetDir = null) {
        const dir = targetDir || this.serverDir;
        const dirs = ['mods', 'plugins', 'config', 'logs', 'world', 'backups'];
        for (const d of dirs) {
            fs.ensureDirSync(path.join(dir, d));
        }
        console.log(`目录结构已创建: ${dir}`);
    }
	    /**
     * 下载任意 URL 文件到指定路径
     */
    async downloadFile(url, destPath) {
        fs.ensureDirSync(path.dirname(destPath));

        console.log(`下载文件: ${url}`);
        console.log(`  保存到: ${destPath}`);

        try {
            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 300000,
                maxRedirects: 10
            });

            const total = parseInt(response.headers['content-length'] || '0', 10);
            const progress = new ProgressBar(`  下载 [:bar] :percent :etas`, {
                width: 40,
                complete: '=',
                incomplete: ' ',
                total: total || 1
            });

            const writer = fs.createWriteStream(destPath);
            response.data.on('data', (chunk) => {
                if (total > 0) progress.tick(chunk.length);
            });
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            console.log(`✅ 下载完成: ${destPath}`);
            return destPath;
        } catch (e) {
            throw new Error(`下载失败: ${e.message}`);
        }
    }
}

module.exports = Installer;