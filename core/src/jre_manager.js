/**
 * JRE 管理模块
 * - 按需自动下载对应平台的 JRE
 * - 存储到 core/jre/{version}/{platform}/
 * - 支持多版本共存
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const ProgressBar = require('progress');
const utils = require('./utils');
// V3.5.0：事件日志
const { logger } = require('./log');

// JRE 下载源配置
const JRE_SOURCES = {
    // 使用 Eclipse Temurin (Adoptium) 作为默认源
    temurin: {
        // V3.5.7 修正：baseUrl 末尾不能带 /version。
        // 拼出的路径段本身已区分 latest/{feature} 与 version/{full}，
        // baseUrl 若再带 /version 会得到 /v3/binary/version/latest/8/... 这种 404 路径。
        baseUrl: 'https://api.adoptium.net/v3/binary',
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

// V3.5.7：MC 版本号必须按「点分整数」比较，不能用 parseFloat
// （parseFloat('1.8.9')=1.8 会被当成 1.80，比 1.16 还大 → 误判 Java 版本）
function _parseMcVersion(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : 0];
}

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
     * @param {string} version - 特征版本号（8/11/17/21）或完整版本（如 17.0.12+7）
     * @param {string} os - windows/linux/macos
     * @param {string} arch - x64/arm64
     */
    _getDownloadUrl(version, os, arch) {
        // 使用 Temurin API
        const osMap = JRE_SOURCES.temurin.platformMap;
        const archMap = JRE_SOURCES.temurin.archMap;

        // 简化：只支持 x64 常用版本
        const osName = osMap[os] || 'linux';
        const archName = archMap[arch] || 'x64';

        // 特征版本号（8/11/17/21）
        const featureVersion = this._getFeatureVersion(version);
        if (!featureVersion) return null;

        // Temurin API：
        //   /v3/binary/latest/{feature}/ga/{os}/{arch}/jdk/hotspot/normal/eclipse
        //     -> 307 跳到 GitHub Release 最新 GA 版的 tar.gz/zip
        //   /v3/binary/version/{fullVersion}/ga/{os}/{arch}/jdk/hotspot/normal/eclipse
        //     -> 跳到指定完整版本（用户可在 config.jre.version 锁定）
        // 之前用字面 "version" + 仅特征号 会导致 404
        const userPinned = this.config.getConfig('jre.version', null);
        const pathSeg = userPinned
            ? `version/${userPinned}`
            : `latest/${featureVersion}`;

        return `${JRE_SOURCES.temurin.baseUrl}/${pathSeg}/ga/${osName}/${archName}/jdk/hotspot/normal/eclipse`;
    }

    /**
     * 获取特征版本号
     * V3.5.7：入参归一化为字符串。旧实现只与字符串字面量比较，
     * 传入数字 8（getJavaExecutable(8) 这类调用很自然）会返回 null，
     * 导致直接跳过版本匹配、掉进「任意 Java」兜底分支。
     */
    _getFeatureVersion(version) {
        if (version === null || version === undefined) return null;
        const v = String(version).trim();
        if (v === '8' || v === '1.8') return '8';
        if (v === '11') return '11';
        if (v === '17') return '17';
        if (v === '21') return '21';
        // 允许 'jdk8' / 'java17' / '8u442' 之类带前缀写法
        const m = v.match(/(?:^|\D)(8|11|17|21)(?:\D|$)/);
        if (m) return m[1];
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
        logger.impt(`下载 JRE: ${version} (${this.os}-${this.arch})`);
        const downloadUrl = this._getDownloadUrl(featureVersion, this.os, this.arch);
        if (!downloadUrl) {
            throw new Error(`无法获取 JRE ${version} 的下载链接`);
        }

        const tempDir = path.join(this.jreDir, `temp_${featureVersion}`);
        fs.ensureDirSync(tempDir);

        try {
            // 下载 JRE 包
            const archivePath = await this._downloadFile(downloadUrl, tempDir, `jre-${featureVersion}`);

            // 解压到临时目录（而不是直接解到 versionDir）：
            // Temurin 的归档内层会再套一层 jdk-17.0.12+7/，直接解到 versionDir 会得到
            // versionDir/jdk-17.0.12+7/bin/java，与预期的 versionDir/bin/java 不符，
            // 需要解完后把真正的 JDK 根「剥壳」提升一层。
            const stageDir = path.join(tempDir, 'stage');
            await this._extractArchive(archivePath, stageDir);

            // 定位真正的 JDK 根（含 bin/java 的那一层）
            const realRoot = this._locateJdkRoot(stageDir);
            if (!realRoot) {
                throw new Error('解压后未找到 bin/java，压缩包结构异常');
            }

            // 清掉可能残留的旧目录，再把 JDK 根搬到 versionDir
            if (fs.existsSync(versionDir)) fs.removeSync(versionDir);
            fs.ensureDirSync(path.dirname(versionDir));
            fs.moveSync(realRoot, versionDir, { overwrite: true });

            // 清理临时文件
            fs.removeSync(tempDir);

            // macOS/Linux 补执行权限（zip 解压常丢失 +x，会导致 java 无法执行）
            if (this.os !== 'windows') {
                const binDir = path.join(versionDir, 'bin');
                try {
                    for (const f of fs.readdirSync(binDir)) {
                        fs.chmodSync(path.join(binDir, f), 0o755);
                    }
                } catch (e) { /* 权限修复失败不阻断，后续会再校验可执行性 */ }
            }

            if (!fs.existsSync(javaPath)) {
                throw new Error('安装后仍未找到 java 可执行文件');
            }

            // 记录已下载
            if (!this.downloadedVersions.includes(featureVersion)) {
                this.downloadedVersions.push(featureVersion);
            }

            console.log(`JRE ${version} 安装完成: ${javaPath}`);
            logger.info(`JRE 安装完成: ${version} -> ${javaPath}`);
            return javaPath;
        } catch (e) {
            try { fs.removeSync(tempDir); } catch (err) { /* ignore */ }
            logger.erro(`JRE 下载失败: ${version} -> ${e.message}`);
            throw new Error(`JRE ${version} 下载失败: ${e.message}`);
        }
    }

    /**
     * 在解压产物中定位真正的 JDK 根目录（含 bin/java 的那一层）
     * 兼容：stage/bin/java（已剥壳）、stage/jdk-xxx/bin/java（一层套壳）、
     * 以及 macOS 的 stage/jdk-xxx/Contents/Home/bin/java
     */
    _locateJdkRoot(stageDir) {
        const exe = this._getJavaExe();
        // 1) 直接就是 JDK 根
        if (fs.existsSync(path.join(stageDir, 'bin', exe))) return stageDir;
        // 2) 一/两层套壳
        const entries = fs.readdirSync(stageDir).filter(d =>
            fs.statSync(path.join(stageDir, d)).isDirectory());
        for (const d of entries) {
            const p = path.join(stageDir, d);
            if (fs.existsSync(path.join(p, 'bin', exe))) return p;
            const macHome = path.join(p, 'Contents', 'Home');
            if (fs.existsSync(path.join(macHome, 'bin', exe))) return macHome;
            // 再多探一层，防御 tar.gz 里带顶层 ./ 之类
            for (const d2 of fs.readdirSync(p)) {
                const p2 = path.join(p, d2);
                try {
                    if (!fs.statSync(p2).isDirectory()) continue;
                } catch (e) { continue; }
                if (fs.existsSync(path.join(p2, 'bin', exe))) return p2;
            }
        }
        return null;
    }

    /**
     * 下载文件（带进度条）
     */
    _downloadFile(url, targetDir, fileName) {
        return new Promise((resolve, reject) => {
            fs.ensureDirSync(targetDir);

            axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 300000, // 5分钟超时
                maxRedirects: 5
            }).then(response => {
                // V3.5.7：Temurin 的 Linux/macOS 产物是 .tar.gz，Windows 是 .zip。
                // 旧实现无条件写 `.zip`，导致 Linux/macOS 下解压分支选错（zip 解 tar.gz）而失败。
                // 这里按 ① 重定向后的最终 URL ② content-type 依次推断真实扩展名。
                const finalUrl = (response.request && response.request.res && response.request.res.responseUrl)
                    || (response.config && response.config.url) || url;
                const ctype = String(response.headers['content-type'] || '').toLowerCase();
                let ext = '.zip';
                if (/\.tar\.gz(\?|$)/i.test(finalUrl)) ext = '.tar.gz';
                else if (/\.tgz(\?|$)/i.test(finalUrl)) ext = '.tgz';
                else if (/\.zip(\?|$)/i.test(finalUrl)) ext = '.zip';
                else if (ctype.includes('gzip') || ctype.includes('tar')) ext = '.tar.gz';
                else if (this.os !== 'windows') ext = '.tar.gz';

                const filePath = path.join(targetDir, `${fileName}${ext}`);
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
     * 解压归档文件
     * V3.5.7：改为纯 Node 实现（zip 走 adm-zip、tar.gz 走系统 tar），
     * 旧实现无条件调 `unzip` —— 该命令在 Windows 上不存在，导致 Windows 用户
     * 永远无法完成 JRE 自动安装。tar 在 Win10 1803+ 已内置，且 Linux/macOS 都有，故保留。
     */
    async _extractArchive(archivePath, targetDir) {
        fs.ensureDirSync(targetDir);
        const lower = archivePath.toLowerCase();

        if (lower.endsWith('.zip')) {
            const AdmZip = require('adm-zip');
            let zip;
            try {
                zip = new AdmZip(archivePath);
            } catch (e) {
                throw new Error(`JRE 压缩包无法读取: ${e.message}`);
            }
            // zip slip 防御：拒绝含 .. 或绝对路径的条目
            const destAbs = path.resolve(targetDir);
            const destSep = destAbs.endsWith(path.sep) ? destAbs : destAbs + path.sep;
            for (const entry of zip.getEntries()) {
                const name = String(entry.entryName || '').replace(/\\/g, '/');
                if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
                    throw new Error(`JRE 压缩包包含非法绝对路径条目: ${entry.entryName}`);
                }
                const segs = name.split('/').filter(s => s !== '' && s !== '.');
                if (segs.includes('..')) {
                    throw new Error(`JRE 压缩包包含路径穿越条目: ${entry.entryName}`);
                }
                const abs = path.resolve(destAbs, segs.join('/'));
                if (abs !== destAbs && !abs.startsWith(destSep)) {
                    throw new Error(`JRE 压缩包条目越界: ${entry.entryName}`);
                }
            }
            zip.extractAllTo(targetDir, true);
            return;
        }

        if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
            await new Promise((resolve, reject) => {
                const proc = spawn('tar', ['-xzf', archivePath, '-C', targetDir]);
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`解压失败，退出码: ${code}`));
                });
                proc.on('error', reject);
            });
            return;
        }

        throw new Error(`不支持的归档格式: ${archivePath}`);
    }

    /**
     * 获取可用的 JRE 版本列表
     */
    getAvailableVersions() {
        return this.downloadedVersions;
    }

    /**
     * 获取当前配置的 Java 可执行文件路径
     * V3.5.7：改为「配置 > 系统扫描（按版本匹配）> 内置 JRE」的优先级，
     * 并保证返回的 Java 主版本与期望一致；找不到匹配版本返回 null（由上层触发下载）。
     * @param {string|number|null} version 期望的特征版本（8/11/17/21）
     * @param {boolean|object} [opts] 传 true 等价于 {verbose:true}；
     *        或传 {verbose, allowMismatch}。allowMismatch=true 时允许返回版本不符的 Java。
     */
    getJavaExecutable(version = null, opts = {}) {
        // 兼容旧签名 getJavaExecutable(ver, true)
        const o = (typeof opts === 'boolean') ? { verbose: opts } : (opts || {});
        const verbose = !!o.verbose;
        const allowMismatch = o.allowMismatch === true;
        // 1) 用户显式指定了 java 路径，最高优先
        const userJava = this.config.getConfig('server.java');
        if (userJava) {
            if (fs.existsSync(userJava)) {
                // 校验用户指定的版本是否满足期望，不满足只给提示不阻断（用户显式指定应当被尊重）
                if (verbose && version) {
                    const actual = utils.scanAllJava().find(j =>
                        path.normalize(j.path) === path.normalize(userJava));
                    const want = parseInt(version, 10);
                    if (actual && actual.major != null && actual.major !== want) {
                        console.log(`⚠️  配置指定的 Java 是 ${actual.major}，但该服务器需要 ${want}。`);
                        console.log('   如启动失败，请在菜单 11 → 1 修改 Java 路径，或清除该项以启用自动选择。');
                    }
                }
                return userJava;
            }
            if (verbose) {
                console.log(`⚠️  配置的 Java 路径不存在，已忽略: ${userJava}`);
            }
        }

        // 2) 期望版本：参数 > 配置 > 默认 17
        const targetVersion = version || this.config.getConfig('server.java_version', '17');
        const featureVersion = this._getFeatureVersion(targetVersion);

        // 3) 系统扫描：优先精确命中期望版本
        let scanned = [];
        try {
            scanned = utils.scanAllJava();
        } catch (e) {
            scanned = [];
        }

        if (featureVersion) {
            const matched = utils.findJavaByMajor(featureVersion, scanned);
            if (matched) {
                const hit = scanned.find(j => path.normalize(j.path) === path.normalize(matched));
                if (verbose) {
                    console.log(`✅ 使用系统 Java ${hit && hit.major != null ? hit.major : '?'}`
                        + `（${hit ? hit.source : '系统'}）: ${matched}`);
                }
                return matched;
            }
        }

        // 4) 内置 JRE（core/jre/{feature}/bin/java）
        if (featureVersion) {
            const bundled = path.join(this.jreDir, featureVersion, 'bin', this._getJavaExe());
            if (fs.existsSync(bundled)) {
                if (verbose) console.log(`✅ 使用内置 JRE ${featureVersion}: ${bundled}`);
                return bundled;
            }
        }

        // 5) 期望版本无法识别（如配置里写了 'foo'）时的保底：内置 17 + 任意系统 Java
        if (!featureVersion) {
            const defBundle = path.join(this.jreDir, '17', 'bin', this._getJavaExe());
            if (fs.existsSync(defBundle)) return defBundle;
            const fallback = utils.detectJava(null, { allowMismatch: true });
            if (fallback) {
                if (verbose) console.log(`⚠️  期望版本「${targetVersion}」无法识别，使用: ${fallback}`);
                return fallback;
            }
        }

        // 6) V3.5.7：严格模式 —— 找不到匹配版本时返回 null，由上层触发自动下载。
        //    旧实现在这里无条件返回「任意一个已安装的 Java」，导致需要 Java 21 时会
        //    拿到 Java 17 甚至 Java 8，服务器启动即崩。调用方想放宽可显式调用
        //    getJavaExecutable(ver, { allowMismatch: true })，或直接用 resolveJavaFor。
        if (allowMismatch) {
            const anyJava = scanned.find(j => j.major != null);
            if (anyJava) {
                if (verbose) {
                    console.log(`⚠️  未找到 Java ${featureVersion}，暂用 Java ${anyJava.major}: ${anyJava.path}`);
                }
                return anyJava.path;
            }
        }

        return null;
    }

    /**
     * 诊断：为某个 Minecraft 版本准备 Java，返回可用路径（必要时自动下载）
     * 与 ensureJavaForMinecraft 的区别是它会先做版本匹配校验，并把选择过程打印出来。
     * @param {string} minecraftVersion
     * @param {boolean} [verbose]
     */
    async resolveJavaFor(minecraftVersion, verbose = true) {
        const required = this.getRequiredJavaVersion(minecraftVersion);
        if (verbose) {
            console.log(`\n🔍 Minecraft ${minecraftVersion} 需要 Java ${required}，正在查找...`);
        }

        // 先看系统里有没有精确/兼容版本
        let scanned = [];
        try { scanned = utils.scanAllJava(); } catch (e) { scanned = []; }
        const matched = utils.findJavaByMajor(required, scanned);
        if (matched) {
            const hit = scanned.find(j => path.normalize(j.path) === path.normalize(matched));
            if (verbose) {
                console.log(`✅ 已找到匹配的 Java ${hit && hit.major != null ? hit.major : required}`
                    + `（${hit ? hit.source : '系统'}）`);
            }
            return matched;
        }

        // 再看内置 JRE
        const bundled = path.join(this.jreDir, String(required), 'bin', this._getJavaExe());
        if (fs.existsSync(bundled)) return bundled;

        // 都没有：自动下载
        if (verbose) {
            console.log(`📥 本机未找到 Java ${required}，开始自动下载（来源：Eclipse Temurin）...`);
        }
        return await this.ensureJre(String(required));
    }

    /**
     * 列出内置（已下载）的 JRE 版本
     */
    listBundled() {
        this._scanDownloaded();
        return this.downloadedVersions.slice();
    }

    /**
     * 检查服务器需要的 Java 版本
     * V3.5.7 修复：旧实现用 parseFloat 比较，把 MC 版本当小数处理，导致
     *   parseFloat('1.8.9') = 1.8，而 1.8 <= 1.16 为 false（因为 1.80 > 1.16），
     * 于是 1.8.9 被判为需要 Java 21 —— 1.3~1.19 的版本全部误判。
     * MC 版本号是「点分整数」(major.minor.patch)，必须逐段比较。
     *
     * 官方 Java 要求：
     *   ≤ 1.16.5  -> Java 8
     *   1.17 ~ 1.20.x -> Java 17
     *   ≥ 1.20.5  -> Java 21
     * @param {string} minecraftVersion 如 "1.12.2"
     * @returns {string} '8' | '17' | '21'
     */
    getRequiredJavaVersion(minecraftVersion) {
        const cmp = _parseMcVersion(minecraftVersion);
        if (!cmp) return '17';

        // 1.20.5+ 起需要 Java 21
        if (cmp[0] > 1 || (cmp[0] === 1 && (cmp[1] > 20 || (cmp[1] === 20 && (cmp[2] || 0) >= 5)))) {
            return '21';
        }
        // 1.17 ~ 1.20.4 -> Java 17
        if (cmp[0] === 1 && cmp[1] >= 17) return '17';
        // ≤ 1.16.x -> Java 8
        return '8';
    }

    /**
     * 获取指定 MC 版本所需的特征 Java 版本
     * V3.5.7：由各文件原本分散的 _getRequiredJava 逻辑统一到此处，避免两套映射漂移。
     * @param {string} minecraftVersion
     * @returns {number|null}
     */
    _getRequiredJava(minecraftVersion) {
        const v = this.getRequiredJavaVersion(minecraftVersion);
        const n = parseInt(v, 10);
        return isNaN(n) ? null : n;
    }

    /**
     * 确保系统 Java 或自动下载的 JRE 可用
     * V3.5.7：改为委托 resolveJavaFor，保证版本确实匹配（旧实现只调 getJavaExecutable，
     * 找不到就下载，但下载前没有优先复用系统已有的同版本 Java）。
     */
    async ensureJavaForMinecraft(minecraftVersion) {
        return await this.resolveJavaFor(minecraftVersion, true);
    }
}

module.exports = JreManager;