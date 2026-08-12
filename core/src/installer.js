/**
 * 服务端安装模块
 * - 下载服务端核心（vanilla, paper, purpur, spigot, bukkit, mohist, catserver, leaves...）
 * - 模组加载器（forge / fabric / neoforge / quilt）通过官方安装器安装：
 *   下载 installer.jar → java -jar 运行安装器 → 生成服务端核心
 * - 支持多种下载源；vanilla 版本清单支持镜像源轮换（默认镜像 → mojang → bangbang93）
 * - 安装后自动创建基础目录、记录配置、共享核心到 pool/cores/
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const AdmZip = require('adm-zip');
const ProgressBar = require('progress');
const utils = require('./utils');
const config = require('./config');
const JreManager = require('./jre_manager');

// 模组加载器安装器下载的镜像源（按优先级尝试）：
// 1) 配置默认镜像（通常 bmclapi2.bangbang93.com）
// 2) 各加载器官方 Maven
// 3) BMCLAPI2 镜像加速
const BMCLAPI2 = 'https://bmclapi2.bangbang93.com';
const MOJANG_META = 'https://launchermeta.mojang.com';

// vanilla 版本清单镜像源轮换顺序：默认配置 → mojang 官方 → bangbang93
function vanillaManifestMirrors(defaultMirror) {
    return [defaultMirror, MOJANG_META, BMCLAPI2].filter(Boolean);
}

// 服务端核心下载配置
const SERVER_SOURCES = {
    vanilla: {
        type: 'vanilla', kind: 'direct',
        fileName: (version) => `vanilla-${version}.jar`,
        needsManifest: true
    },
    forge: {
        type: 'forge', kind: 'installer',
        // 安装器下载候选（按优先级）：官方 Maven → BMCLAPI2
        installerCandidates: (mc, loader) => [
            `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${loader}/forge-${mc}-${loader}-installer.jar`,
            `${BMCLAPI2}/forge/download?mcversion=${mc}&version=${loader}&category=installer&format=jar`
        ],
        // 启动器安装参数（在服务器目录下运行）
        installArgs: () => ['--installServer'],
        // 安装后生成的服务端核心名匹配
        serverJarPattern: /^forge-.+-server\.jar$/,
        installerJarName: (mc, loader) => `forge-${mc}-${loader}-installer.jar`,
        resolveLoader: 'forge'
    },
    fabric: {
        type: 'fabric', kind: 'installer',
        installerCandidates: (mc, loader) => [
            `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${loader}/fabric-installer-${loader}.jar`,
            `${BMCLAPI2}/maven/net/fabricmc/fabric-installer/${loader}/fabric-installer-${loader}.jar`
        ],
        // Fabric 服务端安装：server 子命令需指定 -mcversion，并自动下载 Minecraft
        installArgs: (mc) => ['server', '-mcversion', mc, '-downloadMinecraft'],
        serverJarPattern: /^fabric-server-launch\.jar$/,
        installerJarName: (mc, loader) => `fabric-installer-${loader}.jar`,
        resolveLoader: 'fabric'
    },
    neoforge: {
        type: 'neoforge', kind: 'installer',
        installerCandidates: (mc, loader) => [
            `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loader}/neoforge-${loader}-installer.jar`,
            `${BMCLAPI2}/maven/net/neoforged/neoforge/${loader}/neoforge-${loader}-installer.jar`
        ],
        installArgs: () => ['--installServer'],
        serverJarPattern: /^neoforge-.+-server\.jar$/,
        installerJarName: (mc, loader) => `neoforge-${loader}-installer.jar`,
        resolveLoader: 'neoforge'
    },
    quilt: {
        type: 'quilt', kind: 'installer',
        installerCandidates: (mc, loader) => [
            `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${loader}/quilt-installer-${loader}.jar`
        ],
        // Quilt 服务端安装：install server <mc 版本>
        installArgs: (mc) => ['install', 'server', mc],
        serverJarPattern: /^quilt-server-launch\.jar$/,
        installerJarName: (mc, loader) => `quilt-installer-${loader}.jar`,
        resolveLoader: 'quilt'
    },
    paper: {
        type: 'paper', kind: 'direct',
        url: (version, mirror) => `${mirror}/paper/${version}/latest/download`,
        fileName: (version) => `paper-${version}.jar`
    },
    purpur: {
        type: 'purpur', kind: 'direct',
        url: (version) => `https://api.purpurmc.org/v2/purpur/${version}/latest/download`,
        fileName: (version) => `purpur-${version}.jar`
    },
    spigot: {
        type: 'spigot', kind: 'direct',
        url: (version, mirror) => `${mirror}/spigot/${version}/latest/download`,
        fileName: (version) => `spigot-${version}.jar`
    },
    bukkit: {
        type: 'bukkit', kind: 'direct',
        url: (version, mirror) => `${mirror}/craftbukkit/${version}/latest/download`,
        fileName: (version) => `bukkit-${version}.jar`
    },
    // 中文社区核心
    mohist: {
        type: 'mohist', kind: 'direct',
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
        type: 'catserver', kind: 'direct',
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
        type: 'leaves', kind: 'direct',
        url: (version, mirror) => `${mirror}/leaves/${version}/latest/download`,
        fileName: (version) => `leaves-${version}.jar`
    }
};

class Installer {
    constructor() {
        this.config = config;
        this.mirror = this.config.getConfig('download.mirror', BMCLAPI2);
        this.serverDir = utils.getServerDir();
        this.jreManager = new JreManager();
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
        // 模组加载器：返回常见 MC 版本供选择（具体加载器版本会自动解析）
        if (source.kind === 'installer') {
            return ['1.12.2', '1.16.5', '1.18.2', '1.19.2', '1.20.1', '1.20.4', '1.21.1', '1.21.4'];
        }

        // 其他类型返回预定义列表或空
        return ['1.12.2', '1.16.5', '1.18.2', '1.19.2', '1.20.1', '1.20.4', '1.21'];
    }

    /**
     * 安装入口：根据类型分支（直连下载 / 安装器安装）
     */
    async install(type, version, build = null, targetDir = null) {
        const source = SERVER_SOURCES[type];
        if (!source) {
            throw new Error(`不支持的服务端类型: ${type}`);
        }

        const installDir = targetDir || this.serverDir;
        fs.ensureDirSync(installDir);

        if (source.kind === 'installer') {
            return await this._installModLoader(type, version, build, installDir);
        }

        // ---- 直连下载型 ----
        const fileName = source.fileName(version, build || source.knownBuilds?.[version]);
        const targetPath = path.join(installDir, fileName);

        // 版本隔离：安装前清理目标目录下其它服务端核心，避免多个核心堆在根目录
        this._cleanupOtherCores(installDir, fileName);

        if (fs.existsSync(targetPath)) {
            console.log(`服务端核心已存在: ${fileName}`);
            this._recordConfig(type, version);
            return targetPath;
        }

        let downloadUrl;
        if (type === 'vanilla') {
            downloadUrl = await this._getVanillaDownloadUrl(version);
        } else if (type === 'mohist') {
            const buildNumber = build || source.knownBuilds?.[version];
            if (!buildNumber) {
                throw new Error(`Mohist 版本 ${version} 需要指定构建号（用 -b 参数）`);
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

        const tempPath = path.join(installDir, `${fileName}.tmp`);
        try {
            await this._downloadFile(downloadUrl, tempPath);
            fs.renameSync(tempPath, targetPath);
            console.log(`下载完成: ${targetPath}`);

            this._recordConfig(type, version);
            await this._copyToPool(type, version, targetPath);
            return targetPath;
        } catch (e) {
            if (fs.existsSync(tempPath)) fs.removeSync(tempPath);
            throw new Error(`下载失败: ${e.message}`);
        }
    }

    /**
     * 记录安装结果到配置
     */
    _recordConfig(type, version) {
        this.config.setConfig('server.version', version);
        this.config.setConfig('server.type', type);
    }

    /**
     * 模组加载器安装：下载安装器 → java 运行安装器 → 生成服务端核心
     */
    async _installModLoader(type, mc, loader, installDir) {
        const source = SERVER_SOURCES[type];
        // 解析加载器版本（未提供则自动查询）
        if (!loader) {
            loader = await this._resolveLoader(type, mc);
            console.log(`自动选择 ${type} 加载器版本: ${loader}`);
        }

        const installerName = source.installerJarName(mc, loader);
        const installerPath = path.join(installDir, installerName);

        // 清理旧安装器
        for (const f of fs.readdirSync(installDir)) {
            if (f.endsWith('-installer.jar')) {
                try { fs.removeSync(path.join(installDir, f)); } catch (e) {}
            }
        }

        // 下载安装器（多镜像源轮换）
        const candidates = source.installerCandidates(mc, loader);
        console.log(`下载 ${type} 安装器（MC ${mc}，加载器 ${loader}）...`);
        await this._downloadFirst(candidates, installerPath);

        // 预下载原版核心，并放到安装器「期望的位置」，使其跳过「自行下载原版核心」这一步。
        // 关键：现代 Forge/NeoForge 安装器仅在目标文件已存在时才跳过下载，
        // 而该目标路径写在安装器 jar 内 install_profile.json 的 serverJarPath（含 {LIBRARY_DIR} 等占位符），
        // 并非固定放在根目录的 minecraft_server.<mc>.jar（放错位置安装器仍会自行下载并卡在慢速 mojang）。
        const vanillaInfo = this._resolveInstallerVanillaTarget(installerPath, mc, installDir);
        if (vanillaInfo) {
            try {
                const vanillaUrl = await this._getVanillaDownloadUrl(vanillaInfo.mc);
                let sha1 = null;
                const m = vanillaUrl.match(/v1\/objects\/([0-9a-f]+)\//);
                if (m) sha1 = m[1];
                const vanillaCandidates = [];
                // 1) BMCLAPI2 按 SHA1 精确寻址：与官方对象字节一致，且国内快、稳
                if (sha1) vanillaCandidates.push(`${BMCLAPI2}/v1/objects/${sha1}/server.jar`);
                // 2) mojang 官方（精确但慢，兜底）
                vanillaCandidates.push(vanillaUrl);
                // 3) BMCLAPI2 按版本（备用）
                vanillaCandidates.push(`${BMCLAPI2}/version/${vanillaInfo.mc}/server`);

                // 仅对缺失的目标下载（避免重复），下载一次后复制到其余目标以省流量
                const missing = vanillaInfo.targetPaths.filter(p => !fs.existsSync(p));
                if (missing.length === 0) {
                    console.log(`原版核心已存在于安装器期望位置，安装器将直接复用`);
                } else {
                    console.log(`预下载原版核心（${vanillaInfo.mc}），供 ${type} 安装器复用，避免其自行下载...`);
                    const firstTarget = missing[0];
                    fs.ensureDirSync(path.dirname(firstTarget));
                    await this._downloadFirst(vanillaCandidates, firstTarget);
                    const sz = fs.statSync(firstTarget).size;
                    // 完整性校验：原版服务端核心至少数十 MB，过小说明下载被截断
                    if (sz < 10 * 1024 * 1024) {
                        try { fs.removeSync(firstTarget); } catch (e) {}
                        throw new Error(`原版核心下载不完整（${Math.round(sz / 1024 / 1024)}MB），疑似被截断`);
                    }
                    for (const p of missing.slice(1)) {
                        fs.ensureDirSync(path.dirname(p));
                        fs.copyFileSync(firstTarget, p);
                    }
                    console.log(`✅ 原版核心已就绪: ${path.basename(firstTarget)} (${Math.round(sz / 1024 / 1024)}MB)，放置于 ${missing.length} 个安装器期望位置`);
                }
            } catch (e) {
                console.warn(`⚠️ 预下载原版核心失败，将交由 ${type} 安装器自行下载: ${e.message}`);
            }
        } else {
            console.log(`该 ${type} 安装器无 serverJarPath 声明，跳过原版核心预下载（由其自行处理）`);
        }

        // 解析 java（与 server 启动一致：版本管理器环境下也能拿到真实 Java）
        const java = await this._resolveJava(mc);
        const args = [].concat(['-jar', installerName], source.installArgs(mc));
        console.log(`运行安装器: ${java} ${args.join(' ')}`);
        console.log(`   （工作目录: ${installDir}）`);

        await this._runInstaller(java, args, installDir);

        // 检测生成的服务端核心（现代 Forge/NeoForge 会把核心生成在 libraries/ 子目录，需递归扫描）
        const serverJarAbs = this._detectServerJar(installDir, source.serverJarPattern);
        if (!serverJarAbs) {
            throw new Error(`安装器执行完成，但未在 ${installDir} 找到匹配的服务端核心（${source.serverJarPattern}）。请检查 java 输出。`);
        }
        const serverJar = path.relative(installDir, serverJarAbs);
        console.log(`✅ 已生成服务端核心: ${serverJar}`);

        // 记录配置 & 共享核心
        this._recordConfig(type, mc);
        this.config.setConfig('server.jar', serverJar);

        // 现代 Forge / NeoForge 用 unix_args.txt 启动（不再能用 java -jar），记录启动参数文件
        const argsFileAbs = this._detectForgeArgsFile(serverJarAbs);
        this.config.setConfig('server.launchArgsFile', argsFileAbs ? path.relative(installDir, argsFileAbs) : '');
        if (argsFileAbs) console.log(`🔧 检测到启动参数文件（用 @args 方式启动）: ${path.relative(installDir, argsFileAbs)}`);

        // 预拉原版核心到根目录：Fabric/Quilt 的运行启动器会复用它，避免运行时再连慢速 mojang；
        // Forge/NeoForge 上方已按 serverJarPath 预置，这里兜底确保根目录也有完整副本。
        await this._ensureVanillaAtRoot(installDir, mc, type);

        await this._copyToPool(type, mc, serverJarAbs);

        // 清理安装器 jar（可选，保留也无妨；这里删除避免混淆）
        try { fs.removeSync(installerPath); } catch (e) {}
        return serverJarAbs;
    }

    /**
     * 从模组安装器 jar 内读取 install_profile.json，解析 Forge/NeoForge 期望的原版核心路径。
     * 安装器的 downloadVanilla 仅在「目标文件已存在」时跳过下载，而该目标路径写在 serverJarPath，
     * 形如 {LIBRARY_DIR}/net/minecraft/server/{MINECRAFT_VERSION}/server-{MINECRAFT_VERSION}.jar。
     * 把官方原版核心预置到该路径，安装器即复用、不再连慢速 mojang 下载。
     * 返回 { targetPaths: [绝对路径...], mc } 或 null（无 install_profile.json / 无 serverJarPath）。
     */
    _resolveInstallerVanillaTarget(installerPath, mc, installDir) {
        try {
            const zip = new AdmZip(installerPath);
            const entry = zip.getEntry('install_profile.json');
            if (!entry) return null;
            const profile = JSON.parse(entry.getData().toString('utf8'));
            const serverJarPath = profile.serverJarPath;
            if (!serverJarPath || typeof serverJarPath !== 'string') return null;
            const mcVersion = profile.minecraft || mc;
            const tokens = {
                ROOT: installDir,
                LIBRARY_DIR: path.join(installDir, 'libraries'),
                MINECRAFT_VERSION: mcVersion
            };
            const substituted = serverJarPath.replace(/\{([A-Z_]+)\}/g, (m, k) => (k in tokens ? tokens[k] : m));
            const primary = path.isAbsolute(substituted) ? substituted : path.resolve(installDir, substituted);
            // 保险：部分安装器也会读根目录的 minecraft_server.<mc>.jar
            const fallbackRoot = path.join(installDir, `minecraft_server.${mcVersion}.jar`);
            const targetPaths = [primary];
            if (path.resolve(fallbackRoot) !== path.resolve(primary)) targetPaths.push(fallbackRoot);
            return { targetPaths, mc: mcVersion };
        } catch (e) {
            return null;
        }
    }

    /**
     * 安装完成后，把官方原版核心预置到安装目录根 minecraft_server.<mc>.jar。
     * 用途：Fabric / Quilt 的运行启动器（fabric-server-launch.jar / quilt-server-launch.jar）
     * 启动时会优先复用目录里已存在的 minecraft_server.<mc>.jar，跳过从 mojang 拉取
     * （它们的安装器本身不复用预置文件、安装阶段仍会自行下载，故只能帮到运行时）。
     * Forge / NeoForge 已在上方按 serverJarPath 预置，这里兜底确保根目录也有完整副本。
     * 下载源优先 BMCLAPI2 按 SHA1 精确寻址（快且字节一致），失败则回退 mojang。
     */
    async _ensureVanillaAtRoot(installDir, mc, type) {
        const target = path.join(installDir, `minecraft_server.${mc}.jar`);
        if (fs.existsSync(target) && fs.statSync(target).size >= 10 * 1024 * 1024) {
            return; // 已存在且完整，运行启动器会直接复用
        }
        try {
            const vanillaUrl = await this._getVanillaDownloadUrl(mc);
            let sha1 = null;
            const m = vanillaUrl.match(/v1\/objects\/([0-9a-f]+)\//);
            if (m) sha1 = m[1];
            const candidates = [];
            if (sha1) candidates.push(`${BMCLAPI2}/v1/objects/${sha1}/server.jar`);
            candidates.push(vanillaUrl);
            candidates.push(`${BMCLAPI2}/version/${mc}/server`);
            console.log(`预拉原版核心到根目录（${mc}），供 ${type} 运行时启动器复用，避免其从 mojang 拉取...`);
            fs.ensureDirSync(installDir);
            await this._downloadFirst(candidates, target);
            const sz = fs.statSync(target).size;
            if (sz < 10 * 1024 * 1024) {
                try { fs.removeSync(target); } catch (e) {}
                throw new Error(`原版核心下载不完整（${Math.round(sz / 1024 / 1024)}MB）`);
            }
            console.log(`✅ 根目录原版核心已就绪: minecraft_server.${mc}.jar (${Math.round(sz / 1024 / 1024)}MB)`);
        } catch (e) {
            console.warn(`⚠️ 预拉根目录原版核心失败，${type} 运行时启动器将自行从 mojang 下载: ${e.message}`);
        }
    }

    /**
     * 解析加载器版本（各加载器实现不同）
     */
    async _resolveLoader(type, mc) {
        const resolver = SERVER_SOURCES[type].resolveLoader;
        if (resolver === 'forge') return this._resolveForgeLoader(mc);
        if (resolver === 'fabric') return this._resolveFabricInstaller();
        if (resolver === 'neoforge') return this._resolveNeoForgeLoader(mc);
        if (resolver === 'quilt') return this._resolveQuiltInstaller();
        throw new Error(`无法自动解析 ${type} 的加载器版本，请用 -b 参数手动指定`);
    }

    async _resolveForgeLoader(mc) {
        try {
            const data = await axios.get(`${BMCLAPI2}/forge/minecraft/${mc}`, { timeout: 10000 });
            const list = Array.isArray(data.data) ? data.data : [];
            // BMCLAPI 返回形如 [{version:"1.20.1-47.3.0",...}] 或字符串数组
            const versions = list.map(v => (typeof v === 'string' ? v : (v.version || v.raw || '')))
                .filter(v => /^\d+\.\d+\.\d+-\d+/.test(v) || /^\d+(\.\d+)*$/.test(v));
            if (versions.length === 0) throw new Error('无可用构建');
            // 取最后一个（通常最新）；拼出 installer 需要的 mc-loader 形式
            const v = versions[versions.length - 1];
            // 形如 1.20.1-47.3.0 → loader = 47.3.0
            const loader = v.includes('-') ? v.split('-').pop() : v;
            return loader;
        } catch (e) {
            throw new Error(`解析 Forge 版本失败: ${e.message}`);
        }
    }

    async _resolveFabricInstaller() {
        try {
            const data = await axios.get('https://meta.fabricmc.net/v2/versions/installer', { timeout: 10000 });
            const list = Array.isArray(data.data) ? data.data : [];
            const stable = list.filter(v => v && !v.version.includes('beta') && !v.version.includes('alpha'));
            const pick = (stable.length ? stable : list);
            if (!pick.length) throw new Error('无可用安装器版本');
            // meta.fabricmc.net 返回的版本是降序（最新在前），取最新稳定版安装器。
            // 做语义化排序兜底，避免依赖接口排序顺序变化。
            const semver = (s) => String(s.version).split('.').map(n => parseInt(n, 10) || 0);
            pick.sort((a, b) => {
                const A = semver(a), B = semver(b);
                for (let i = 0; i < Math.max(A.length, B.length); i++) {
                    if ((A[i] || 0) !== (B[i] || 0)) return (B[i] || 0) - (A[i] || 0);
                }
                return 0;
            });
            return pick[0].version;
        } catch (e) {
            throw new Error(`解析 Fabric 安装器版本失败: ${e.message}`);
        }
    }

    async _resolveNeoForgeLoader(mc) {
        try {
            const data = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { timeout: 10000 });
            const xml = data.data || '';
            const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
            if (!versions.length) throw new Error('无可用版本');
            // NeoForge 版本形如 21.4.111-beta ↔ MC 1.21.4；由 MC 版本推导前缀
            const parts = mc.split('.');
            const prefix = parts.length >= 2 ? `${parts[1]}.${parts[2] || '0'}` : '';
            const matched = versions.filter(v => v.startsWith(prefix + '.'));
            const pool = matched.length ? matched : versions;
            // 取最高版本（按点分数字比较）
            pool.sort((a, b) => a.split('.').map(Number).reduce((x, y) => x * 1000 + y, 0) - b.split('.').map(Number).reduce((x, y) => x * 1000 + y, 0));
            return pool[pool.length - 1];
        } catch (e) {
            throw new Error(`解析 NeoForge 版本失败: ${e.message}`);
        }
    }

    async _resolveQuiltInstaller() {
        try {
            const data = await axios.get('https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml', { timeout: 10000 });
            const xml = data.data || '';
            const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
            if (!versions.length) throw new Error('无可用版本');
            versions.sort((a, b) => a.split('.').map(Number).reduce((x, y) => x * 1000 + y, 0) - b.split('.').map(Number).reduce((x, y) => x * 1000 + y, 0));
            return versions[versions.length - 1];
        } catch (e) {
            throw new Error(`解析 Quilt 安装器版本失败: ${e.message}`);
        }
    }

    /**
     * 按顺序尝试多个下载 URL，任一成功即返回
     */
    async _downloadFirst(urls, destPath) {
        let lastErr;
        for (const url of urls) {
            try {
                console.log(`  ├─ 尝试: ${url}`);
                await this._downloadFile(url, destPath);
                if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
                    console.log(`  └─ ✅ 下载成功`);
                    return destPath;
                }
            } catch (e) {
                lastErr = e;
                console.log(`  ├─ ❌ 失败: ${e.message}`);
            }
        }
        throw new Error(`所有镜像源均下载失败: ${lastErr ? lastErr.message : '未知错误'}`);
    }

    /**
     * 解析可用的 java 可执行文件（异步）。
     * 与 server 启动逻辑保持一致：优先用户显式配置 → JreManager（已下载 JRE / 系统 Java / 自动下载 Temurin JRE）
     * → 兜底系统 java → 裸 'java'。这样在 mise/rtx 等版本管理器导致裸 'java' 不可用（如 简幻欢）时，
     * 安装器也能拿到真实可执行的 Java 路径，而不会因 "No version is set for shim: java" 直接失败。
     * @param {string} [mc] Minecraft 版本，用于选择对应 Java 大版本
     */
    async _resolveJava(mc) {
        const cfg = this.config.getConfig('server.java');
        if (cfg && fs.existsSync(cfg)) return cfg;
        const required = (this.jreManager && this.jreManager.getRequiredJavaVersion)
            ? this.jreManager.getRequiredJavaVersion(mc || '1.20.1')
            : '17';
        try {
            const javaPath = await this.jreManager.ensureJavaForMinecraft(mc || '1.20.1');
            if (javaPath) return javaPath;
        } catch (e) {
            console.warn(`⚠️ 自动解析/下载 Java 失败，回退系统 java: ${e.message}`);
        }
        const sys = utils.detectJava(required);
        if (sys) return sys;
        return 'java';
    }

    /**
     * 运行安装器（java -jar），实时输出安装日志
     */
    _runInstaller(java, args, cwd) {
        return new Promise((resolve, reject) => {
            const child = spawn(java, args, { cwd, stdio: 'inherit', windowsHide: true });
            child.on('error', e => reject(new Error(`启动 java 失败: ${e.message}（请确认已安装 Java 并可在 PATH 中调用）`)));
            child.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`安装器退出码 ${code}，安装未成功完成`));
            });
        });
    }

    /**
     * 在安装目录中检测生成的服务端核心
     */
    _detectServerJar(dir, pattern) {
        let found = null;
        // 现代 Forge/NeoForge 会把服务端核心生成在 libraries/ 子目录，必须递归扫描；
        // 跳过运行时数据目录，避免无谓遍历 world/logs/backups
        const skip = new Set(['world', 'logs', 'backups', 'node_modules']);
        const walk = (d) => {
            if (found) return;
            let entries;
            try { entries = fs.readdirSync(d, { withFileTypes: true }); }
            catch (e) { return; }
            for (const e of entries) {
                if (found) return;
                const p = path.join(d, e.name);
                if (e.isDirectory()) {
                    if (skip.has(e.name)) continue;
                    walk(p);
                } else if (e.isFile()
                    && e.name.endsWith('.jar')
                    && !e.name.includes('installer')
                    && !e.name.includes('authlib-injector')
                    && pattern.test(e.name)) {
                    found = p;
                    return;
                }
            }
        };
        walk(dir);
        return found;
    }

    /**
     * 现代 Forge / NeoForge 用 unix_args.txt / win_args.txt 提供完整 classpath 与模块参数，
     * 无法用 java -jar 直接启动。在 server jar 同目录查找该启动参数文件。
     */
    _detectForgeArgsFile(serverJarAbs) {
        const dir = path.dirname(serverJarAbs);
        for (const name of ['unix_args.txt', 'win_args.txt', 'args.txt']) {
            const p = path.join(dir, name);
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    // ==================== vanilla 镜像源轮换 ====================

    async _getVanillaVersions() {
        try {
            const manifest = await this._getVanillaManifest();
            return manifest.versions.map(v => v.id);
        } catch (e) {
            console.error('获取原版版本列表失败:', e.message);
            return ['1.20.1', '1.20.4', '1.21'];
        }
    }

    async _getVanillaManifest() {
        const mirrors = vanillaManifestMirrors(this.mirror);
        let lastErr;
        for (const m of mirrors) {
            try {
                const response = await axios.get(`${m}/mc/game/version_manifest.json`, { timeout: 10000 });
                if (response.data && Array.isArray(response.data.versions)) {
                    return response.data;
                }
            } catch (e) {
                lastErr = e;
            }
        }
        throw new Error(`获取原版版本清单失败（已尝试 ${mirrors.length} 个镜像源）: ${lastErr ? lastErr.message : '未知'}`);
    }

    async _getVanillaDownloadUrl(version) {
        const manifest = await this._getVanillaManifest();
        const versionInfo = manifest.versions.find(v => v.id === version);
        if (!versionInfo) {
            throw new Error(`版本 ${version} 不存在`);
        }
        const detailResponse = await axios.get(versionInfo.url, { timeout: 10000 });
        return detailResponse.data.downloads.server.url;
    }

    // ==================== 其它辅助 ====================

    /**
     * 清理目录下其它服务端核心，保持单核心隔离（避免多个核心堆在根目录）
     */
    _cleanupOtherCores(dir, keepFileName) {
        if (!fs.existsSync(dir)) return 0;
        const WHITE_LIST = ['authlib-injector'];
        const patterns = [];
        for (const key of Object.keys(SERVER_SOURCES)) {
            const src = SERVER_SOURCES[key];
            if (src.kind !== 'direct' || typeof src.fileName !== 'function') continue;
            let tmpl;
            try {
                tmpl = src.fileName('__V__', '__B__');
            } catch (e) {
                continue;
            }
            const re = tmpl
                .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
                .replace('__V__', '[^/]+')
                .replace('__B__', '[^/]+');
            patterns.push(new RegExp('^' + re + '$'));
        }
        // 额外清理旧的安装器 jar
        patterns.push(/^.+installer\.jar$/);
        let removed = 0;
        for (const item of fs.readdirSync(dir)) {
            if (!item.endsWith('.jar')) continue;
            if (item === keepFileName) continue;
            if (WHITE_LIST.some(w => item.includes(w))) continue;
            const full = path.join(dir, item);
            if (!fs.statSync(full).isFile()) continue;
            if (patterns.some(p => p.test(item))) {
                try {
                    fs.removeSync(full);
                    removed++;
                    console.log(`🧹 已清理旧核心: ${item}`);
                } catch (e) { /* 忽略 */ }
            }
        }
        return removed;
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
     * 下载文件（带进度条）
     */
    _downloadFile(url, destPath) {
        return new Promise((resolve, reject) => {
            axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 600000,
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

                writer.on('finish', () => resolve());
                writer.on('error', (err) => reject(err));
            }).catch(err => reject(err));
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
