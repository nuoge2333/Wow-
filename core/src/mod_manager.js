/**
 * 模组管理模块
 * - 安装/卸载/列出模组
 * - 自动下载依赖
 * - 模组存储到 pool/mods/{loader}/{version}/
 * - 支持从方案目录同步
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');
const config = require('./config');
const { execSync } = require('child_process');

class ModManager {
    constructor() {
        this.poolMods = utils.getPoolPath('mods');
        this.serverMods = path.join(utils.getServerDir(), 'mods');
        this.sources = config.getConfig('mod.sources', ['curseforge', 'modrinth']);
        this.autoDependencies = config.getConfig('mod.auto_dependencies', true);
        this.loaders = ['forge', 'fabric', 'neoforge', 'quilt'];
    }

    /**
     * 获取模组存储路径（按加载器+版本）
     */
    getModStoragePath(loader, version) {
        // loader 映射规范化
        const normLoader = this._normalizeLoader(loader);
        return path.join(this.poolMods, normLoader, version);
    }

    /**
     * 规范化加载器名称
     */
    _normalizeLoader(loader) {
        const map = {
            'forge': 'forge',
            'fabric': 'fabric',
            'neoforge': 'neoforge',
            'quilt': 'quilt'
        };
        return map[loader.toLowerCase()] || loader;
    }

    /**
     * 检测模组类型（从文件名或元数据判断）
     */
    _detectLoader(modFile) {
        const name = path.basename(modFile).toLowerCase();
        if (name.includes('forge')) return 'forge';
        if (name.includes('fabric')) return 'fabric';
        if (name.includes('neoforge') || name.includes('neo')) return 'neoforge';
        if (name.includes('quilt')) return 'quilt';
        return 'forge'; // 默认
    }

    /**
     * 检测模组适用的 Minecraft 版本
     */
    _detectVersion(modFile) {
        const name = path.basename(modFile);
        const match = name.match(/(\d+\.\d+(?:\.\d+)?)/);
        return match ? match[1] : '1.20.1';
    }

    /**
     * 列出**指定目录**下的模组（供「全方案扫描」复用，不依赖当前方案）。
     * @param {string} modDir 模组目录绝对路径
     * @param {string} [loader] 按加载器过滤
     * @param {string} [version] 按 MC 版本过滤
     * @returns {Array<object>} 模组信息数组
     */
    listModsInDir(modDir, loader = null, version = null) {
        if (!modDir || !fs.existsSync(modDir)) return [];

        const files = fs.readdirSync(modDir);
        const mods = files.filter(f => f.endsWith('.jar') || f.endsWith('.zip'));
        const result = [];

        for (const mod of mods) {
            const modPath = path.join(modDir, mod);
            const stats = fs.statSync(modPath);
            const modLoader = this._detectLoader(mod);
            const modVersion = this._detectVersion(mod);

            // 过滤
            if (loader && modLoader !== loader) continue;
            if (version && modVersion !== version) continue;

            result.push({
                name: mod,
                path: modPath,
                size: stats.size,
                loader: modLoader,
                version: modVersion,
                enabled: !mod.startsWith('DISABLED_')
            });
        }

        return result;
    }

    /**
     * 列出已安装的模组（当前方案）
     */
    listMods(loader = null, version = null) {
        if (!fs.existsSync(this.serverMods)) {
            console.log('模组目录不存在');
            return [];
        }
        return this.listModsInDir(this.serverMods, loader, version);
    }

    /**
     * 从 jar / zip 里读取 modID（"读 modID"）。
     *  - 模组：fabric.mod.json / quilt.mod.json 的 id，META-INF/mods.toml 的 modId，
     *    mcmod.info 的 modid —— 复用 client_mod_filter.readModMeta 的成熟解析。
     *  - 插件（Bukkit/Spigot/Paper）：plugin.yml / paper-plugin.yml 的 name。
     * 读不到一律返回 null（损坏包 / 资源包 / 无元数据），绝不抛错。
     * @param {string} jarPath jar 绝对路径
     * @param {'mods'|'plugins'} kind 所在目录类别
     * @returns {string|null}
     */
    _readJarModId(jarPath, kind = 'mods') {
        if (kind === 'plugins') {
            try {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(jarPath);
                const pick = (name) => {
                    const e = zip.getEntries().find(x => String(x.entryName).toLowerCase() === name);
                    return e ? e.getData().toString('utf8') : null;
                };
                const yml = pick('plugin.yml') || pick('paper-plugin.yml');
                if (yml) {
                    const m = yml.match(/^\s*name\s*:\s*['"]?([^\s'"#]+)/m);
                    if (m) return m[1];
                }
            } catch (e) { /* 读不了就交给下面兜底 */ }
        }
        try {
            const cmf = require('./client_mod_filter');
            const meta = cmf.readModMeta(jarPath);
            if (meta && meta.ok && Array.isArray(meta.mods) && meta.mods.length) {
                return meta.mods.map(m => m.modId).filter(Boolean).join(', ') || null;
            }
        } catch (e) { /* 元数据不可读 */ }
        return null;
    }

    /**
     * 全方案扫描：列出**所有方案**（含当前激活方案）的模组 / 插件，按方案分组。
     *
     * V3.6.4（P1-11）：原先 `mod list` 只能看当前方案的 mods/，
     * 多方案用户无法一眼看清每个方案装了什么，也看不到插件与 modID。
     * 这里遍历 scheme/ 下各方案的 **mods/ 与 plugins/**，逐个读取 modID，
     * 返回分组结构，由调用方（CLI / 菜单）分组展示。
     *
     * @param {string} [loader] 按加载器过滤
     * @param {string} [version] 按 MC 版本过滤
     * @returns {Array<{scheme:string, active:boolean, version:string, loader:string,
     *                  mods:Array, plugins:Array}>}
     */
    listModsAllSchemes(loader = null, version = null) {
        const SchemeManager = require('./scheme_manager');
        const sm = new SchemeManager();
        const schemes = sm.list() || [];
        const groups = [];
        const scan = (dir, kind) => this.listModsInDir(dir, loader, version)
            .map(m => ({ ...m, kind, modId: this._readJarModId(m.path, kind) }));
        for (const s of schemes) {
            const schemePath = path.join(sm.schemesDir, s.name);
            groups.push({
                scheme: s.name,
                active: !!s.active,
                version: s.version,
                loader: s.loader,
                type: s.type,
                mods: scan(path.join(schemePath, 'mods'), 'mods'),
                plugins: scan(path.join(schemePath, 'plugins'), 'plugins')
            });
        }
        return groups;
    }

    /**
     * 安装模组（从本地文件或 URL）
     */
    async install(target, options = {}) {
        const { loader, version, deps = this.autoDependencies } = options;
        const destDir = this.serverMods;

        fs.ensureDirSync(destDir);

        // 判断 target 是 URL 还是本地文件
        let sourcePath;
        let fileName;

        if (target.startsWith('http://') || target.startsWith('https://')) {
            // 从 URL 下载
            console.log(`下载模组: ${target}`);
            fileName = target.split('/').pop();
            if (!fileName.endsWith('.jar') && !fileName.endsWith('.zip')) {
                fileName += '.jar';
            }
            sourcePath = await this._downloadMod(target, path.join(destDir, fileName));
        } else {
            // 本地文件
            sourcePath = target;
            if (!fs.existsSync(sourcePath)) {
                throw new Error(`文件不存在: ${target}`);
            }
            fileName = path.basename(sourcePath);
        }

        // 复制到方案 mods 目录
        const targetPath = path.join(destDir, fileName);
        if (fs.existsSync(targetPath)) {
            console.log(`模组已存在: ${fileName}`);
            return targetPath;
        }

        fs.copyFileSync(sourcePath, targetPath);
        console.log(`模组已安装: ${fileName}`);

        // 复制到 pool/mods 共享
        const modLoader = loader || this._detectLoader(fileName);
        const modVersion = version || this._detectVersion(fileName);
        const poolPath = this.getModStoragePath(modLoader, modVersion);
        fs.ensureDirSync(poolPath);
        const poolTarget = path.join(poolPath, fileName);
        if (!fs.existsSync(poolTarget)) {
            fs.copyFileSync(targetPath, poolTarget);
            console.log(`模组已共享到: ${poolTarget}`);
        }

        // 自动安装依赖
        if (deps) {
            await this._installDependencies(fileName, modLoader, modVersion);
        }

        return targetPath;
    }

    /**
     * 下载模组文件
     */
    _downloadMod(url, destPath) {
        return new Promise((resolve, reject) => {
            const axios = require('axios');
            const ProgressBar = require('progress');
            const fs = require('fs-extra');

            fs.ensureDirSync(path.dirname(destPath));

            axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                // V3.6.4（P1-12）：Modrinth 等源较慢，120s→300s
                timeout: 300000,
                maxRedirects: 5
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
                writer.on('finish', () => resolve(destPath));
                writer.on('error', (err) => reject(err));
            }).catch(err => {
                // V3.6.4（P1-12）：超时给「配置代理 / 重试」的明确指引
                if (err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
                    /timeout|超时|exceeded/i.test(String(err.message || '')))) {
                    err.message = '网络较慢，建议配置代理或重试（下载超时 300s）';
                }
                reject(err);
            });
        });
    }

    /**
     * 自动安装依赖（模拟）
     */
    async _installDependencies(modFile, loader, version) {
        // 这里可以实现自动依赖解析
        // 实际实现需要查询 CurseForge/Modrinth API
        // 暂时只做提示
        console.log(`  依赖检查: ${modFile} (${loader}/${version})`);
        // TODO: 实现实际的依赖解析
    }

    /**
     * 卸载模组
     */
    remove(modName, loader = null) {
        const modDir = this.serverMods;
        if (!fs.existsSync(modDir)) {
            console.log('模组目录不存在');
            return false;
        }

        let targetPath = path.join(modDir, modName);
        if (!fs.existsSync(targetPath)) {
            // 尝试查找匹配的文件名
            const files = fs.readdirSync(modDir);
            const matched = files.find(f => f.toLowerCase().includes(modName.toLowerCase()));
            if (matched) {
                targetPath = path.join(modDir, matched);
            } else {
                console.log(`模组不存在: ${modName}`);
                return false;
            }
        }

        fs.removeSync(targetPath);
        console.log(`模组已卸载: ${path.basename(targetPath)}`);
        return true;
    }

    /**
     * 启用/禁用模组
     */
    toggleMod(modName) {
        const modDir = this.serverMods;
        if (!fs.existsSync(modDir)) {
            console.log('模组目录不存在');
            return false;
        }

        const target = path.join(modDir, modName);
        if (!fs.existsSync(target)) {
            console.log(`模组不存在: ${modName}`);
            return false;
        }

        const baseName = path.basename(target);
        if (baseName.startsWith('DISABLED_')) {
            // 启用
            const newName = baseName.replace('DISABLED_', '');
            const newPath = path.join(modDir, newName);
            fs.renameSync(target, newPath);
            console.log(`模组已启用: ${newName}`);
        } else {
            // 禁用
            const newName = `DISABLED_${baseName}`;
            const newPath = path.join(modDir, newName);
            fs.renameSync(target, newPath);
            console.log(`模组已禁用: ${newName}`);
        }
        return true;
    }

    /**
     * 从 pool 同步模组到当前方案
     */
    syncFromPool(loader, version) {
        const poolPath = this.getModStoragePath(loader, version);
        if (!fs.existsSync(poolPath)) {
            console.log(`池中无模组: ${loader}/${version}`);
            return 0;
        }

        const mods = fs.readdirSync(poolPath).filter(f => f.endsWith('.jar'));
        let count = 0;
        for (const mod of mods) {
            const source = path.join(poolPath, mod);
            const target = path.join(this.serverMods, mod);
            if (!fs.existsSync(target)) {
                fs.copyFileSync(source, target);
                count++;
            }
        }
        console.log(`已同步 ${count} 个模组`);
        return count;
    }

    /**
     * 获取模组信息（从 jar 读取元数据）
     */
    getModInfo(modPath) {
        // 简单实现：从文件名解析，完整版需要读取 jar 的 MANIFEST.MF 或 fabric.mod.json
        const name = path.basename(modPath);
        return {
            name: name,
            loader: this._detectLoader(modPath),
            version: this._detectVersion(modPath),
            path: modPath,
            size: fs.statSync(modPath).size
        };
    }
}

module.exports = ModManager;