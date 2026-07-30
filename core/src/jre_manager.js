/**
 * JRE 管理模块
 * - 按需自动下载对应平台的 JRE
 * - 存储到 core/jre/{version}/{platform}/
 * - 支持多版本共存
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { spawn, execSync } = require('child_process');
const ProgressBar = require('progress');
const utils = require('./utils');

// JRE 下载源配置
const JRE_SOURCES = {
    // 使用 Eclipse Temurin (Adoptium) 作为默认源
    temurin: {
        baseUrl: 'https://api.adoptium.net/v3/binary/version',
        platformMap: {
            windows: 'windows',
            linux: 'linux',
            macos: 'mac'
        },
        archMap: {
            x64: 'x64',
            arm64: 'aarch64'
        }
    },
    // 备用源：微软 OpenJDK
    microsoft: {
        baseUrl: 'https://aka.ms/download-jdk',
        platformMap: {
            windows: 'windows',
            linux: 'linux',
            macos: 'macos'
        }
    }
};

class JreManager {
    constructor() {
        this.jreDir = utils.getJrePath();
        this.config = require('./config');
        this.os = utils.getOS();
        this.arch = process.arch; // x64, arm64, ia32
        this.versions = {
            '8': 'jdk8u442-b06',      // Java 8 (Minecraft 1.12.2 及以下)
            '17': 'jdk-17.0.12+7',    // Java 17 (Minecraft 1.17-1.20)
            '21': 'jdk-21.0.4+7'      // Java 21 (Minecraft 1.21+)
        };
        this.downloadedVersions = [];
        this._scanDownloaded();
    }

    /**
     * 检测是否为安卓（Termux）环境
     * Termux 使用 Android 的 Bionic libc，无法运行常规 glibc 版 JRE，
     * 因此 Java 必须通过 pkg 安装（openjdk-17 / openjdk-21）。
     */
    isAndroid() {
        // Termux 会设置 PREFIX 指向其 usr 目录
        if (process.env.PREFIX && fs.existsSync(process.env.PREFIX)) {
            return true;
        }
        // 原生安卓 / Termux 都存在 build.prop
        if (fs.existsSync('/system/build.prop')) {
            return true;
        }
        try {
            const u = execSync('uname -o 2>/dev/null', { stdio: 'pipe' }).toString();
            if (u.includes('Android')) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    /**
     * 扫描已下载的 JRE 版本
     */
    _scanDownloaded() {
        try {
            if (fs.existsSync(this.jreDir)) {
                const dirs = fs.readdirSync(this.jreDir);
                this.downloadedVersions = dirs.filter(d => 
                    fs.existsSync(path.join(this.jreDir, d, 'bin', this._getJavaExe()))
                );
            }
        } catch (e) {
            this.downloadedVersions = [];
        }
    }

    /**
     * 获取当前平台的 Java 可执行文件名
     */
    _getJavaExe() {
        return this.os === 'windows' ? 'java.exe' : 'java';
    }

    /**
     * 获取 JRE 下载 URL
     */
    _getDownloadUrl(version, os, arch) {
        // 使用 Temurin API
        const osMap = JRE_SOURCES.temurin.platformMap;
        const archMap = JRE_SOURCES.temurin.archMap;
        
        // 简化：只支持 x64 常用版本
        const osName = osMap[os] || 'linux';
        const archName = archMap[arch] || 'x64';
        
        // 版本映射到 JRE 特征版本
        const featureVersion = this._getFeatureVersion(version);
        if (!featureVersion) return null;

        // 构建 API URL
        const url = `${JRE_SOURCES.temurin.baseUrl}/${featureVersion}/ga/${osName}/${archName}/jdk/hotspot/normal/eclipse`;
        return url;
    }

    /**
     * 获取特征版本号
     */
    _getFeatureVersion(version) {
        if (version === '8' || version === '1.8') return '8';
        if (version === '11') return '11';
        if (version === '17') return '17';
        if (version === '21') return '21';
        return null;
    }

    /**
     * 确保指定版本的 JRE 已下载
     */
    async ensureJre(version) {
        const featureVersion = this._getFeatureVersion(version);
        if (!featureVersion) {
            throw new Error(`不支持的 Java 版本: ${version}`);
        }

        const versionDir = path.join(this.jreDir, featureVersion);
        const javaPath = path.join(versionDir, 'bin', this._getJavaExe());

        if (fs.existsSync(javaPath)) {
            // 已存在，直接使用
            return javaPath;
        }

        // 检查是否启用自动下载
        const autoDownload = this.config.getConfig('jre.auto_download', true);
        if (!autoDownload) {
            throw new Error(`JRE ${version} 未安装，且自动下载已禁用`);
        }

        // 下载
        console.log(`正在下载 JRE ${version} (${this.os}-${this.arch})...`);
        const downloadUrl = this._getDownloadUrl(featureVersion, this.os, this.arch);
        if (!downloadUrl) {
            throw new Error(`无法获取 JRE ${version} 的下载链接`);
        }

        const tempDir = path.join(this.jreDir, `temp_${featureVersion}`);
        fs.ensureDirSync(tempDir);

        try {
            // 下载 JRE 包
            const archivePath = await this._downloadFile(downloadUrl, tempDir, `jre-${featureVersion}`);
            
            // 解压
            await this._extractArchive(archivePath, versionDir);
            
            // 清理临时文件
            fs.removeSync(tempDir);
            
            // 记录已下载
            this.downloadedVersions.push(featureVersion);
            
            console.log(`JRE ${version} 安装完成: ${javaPath}`);
            return javaPath;
        } catch (e) {
            fs.removeSync(tempDir);
            throw new Error(`JRE ${version} 下载失败: ${e.message}`);
        }
    }

    /**
     * 下载文件（带进度条）
     */
    _downloadFile(url, targetDir, fileName) {
        return new Promise((resolve, reject) => {
            const filePath = path.join(targetDir, `${fileName}.zip`);
            fs.ensureDirSync(targetDir);

            axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 300000, // 5分钟超时
                maxRedirects: 5
            }).then(response => {
                const totalLength = response.headers['content-length'];
                const progress = new ProgressBar(`  下载中 [:bar] :percent :etas`, {
                    width: 40,
                    complete: '=',
                    incomplete: ' ',
                    renderThrottle: 100,
                    total: parseInt(totalLength) || 1
                });

                const writer = fs.createWriteStream(filePath);
                response.data.on('data', (chunk) => {
                    progress.tick(chunk.length);
                });

                response.data.pipe(writer);

                writer.on('finish', () => {
                    resolve(filePath);
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
     * 解压归档文件（支持 .zip 和 .tar.gz）
     */
    _extractArchive(archivePath, targetDir) {
        return new Promise((resolve, reject) => {
            const extract = require('child_process').spawn;
            let cmd;
            let args;

            if (archivePath.endsWith('.zip')) {
                // 使用系统 unzip 命令
                cmd = 'unzip';
                args = ['-q', archivePath, '-d', targetDir];
            } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
                cmd = 'tar';
                args = ['-xzf', archivePath, '-C', targetDir];
            } else {
                reject(new Error(`不支持的文件格式: ${archivePath}`));
                return;
            }

            const proc = spawn(cmd, args);
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`解压失败，退出码: ${code}`));
                }
            });
            proc.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * 获取可用的 JRE 版本列表
     */
    getAvailableVersions() {
        return this.downloadedVersions;
    }

    /**
     * 获取当前配置的 Java 可执行文件路径
     */
    getJavaExecutable(version = null) {
        // 如果用户指定了 java 路径，优先使用
        const userJava = this.config.getConfig('server.java');
        if (userJava && fs.existsSync(userJava)) {
            return userJava;
        }

        // 使用指定的 JRE 版本
        const targetVersion = version || this.config.getConfig('server.java_version', '17');
        const featureVersion = this._getFeatureVersion(targetVersion);
        const javaPath = path.join(this.jreDir, featureVersion, 'bin', this._getJavaExe());

        if (fs.existsSync(javaPath)) {
            return javaPath;
        }

        // 尝试自动检测系统 Java
        const systemJava = utils.detectJava();
        if (systemJava) {
            return systemJava;
        }

        return null;
    }

    /**
     * 检查服务器需要的 Java 版本
     */
    getRequiredJavaVersion(minecraftVersion) {
        const version = parseFloat(minecraftVersion);
        if (!version) return '17';
        if (version <= 1.16) return '8';
        if (version <= 1.20) return '17';
        return '21';
    }

    /**
     * 安卓/Termux 环境：通过 pkg 安装 OpenJDK（Bionic 兼容版）
     * Termux 的 openjdk-17 / openjdk-21 才是能在安卓上运行的 Java，
     * 常规的 glibc Temurin JRE 在 Termux 里跑不起来。
     */
    async ensureTermuxJava(featureVersion) {
        // 安卓上 Java 8 无 pkg 包，旧版 MC 统一用 openjdk-17；1.21+ 用 openjdk-21
        const pkgName = featureVersion === '21' ? 'openjdk-21' : 'openjdk-17';
        console.log(`检测到 Termux/安卓环境，正在通过 pkg 安装 ${pkgName}...`);
        try {
            execSync(`pkg update -y && pkg install -y ${pkgName}`, { stdio: 'inherit' });
        } catch (e) {
            if (pkgName !== 'openjdk-17') {
                console.log(`${pkgName} 安装失败，回退到 openjdk-17...`);
                execSync('pkg update -y && pkg install -y openjdk-17', { stdio: 'inherit' });
            } else {
                throw new Error(`pkg 安装 ${pkgName} 失败，请手动运行: pkg install openjdk-17`);
            }
        }

        const javaPath = utils.detectJava();
        if (!javaPath) {
            throw new Error('OpenJDK 已安装但未能在 PATH 中检测到 java，请手动运行: pkg install openjdk-17');
        }
        console.log(`已通过 pkg 安装 Java: ${javaPath}`);
        return javaPath;
    }

    /**
     * 确保系统 Java 或自动下载的 JRE 可用
     */
    async ensureJavaForMinecraft(minecraftVersion) {
        const requiredVersion = this.getRequiredJavaVersion(minecraftVersion);
        let javaPath = this.getJavaExecutable(requiredVersion);

        if (!javaPath) {
            if (this.isAndroid()) {
                // 安卓/Termux：不能用 glibc 版 JRE，改用 pkg 安装 OpenJDK
                javaPath = await this.ensureTermuxJava(requiredVersion);
            } else {
                // 自动下载
                javaPath = await this.ensureJre(requiredVersion);
            }
        }

        return javaPath;
    }
}

module.exports = JreManager;