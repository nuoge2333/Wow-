/**
 * 整合包管理模块
 * - 安装客户端整合包（解析 manifest，安装核心+模组+配置）
 * - 生成客户端整合包（导出当前服务器的模组和配置）
 * - 测试安装后的服务器，自动移除不兼容模组
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const utils = require('./utils');
const config = require('./config');
const Installer = require('./installer');
const ModManager = require('./mod_manager');
const SchemeManager = require('./scheme_manager');
const ServerManager = require('./server');
const stdinSession = require('./stdin_session');

/**
 * 问一行，优先复用调用方传进来的 readline。
 *
 * 不复用就必须保证「唯一消费者」——所以走 stdin_session 的临时租约，
 * 而不是再 `createInterface` 一个。后者会在 REPL / 菜单已经持有 stdin 时
 * 造成双读（用户输入 `world` 变成 `wwoorrlldd`）。
 *
 * @param {string} prompt
 * @param {object} [existingRl]
 * @returns {Promise<string>}
 */
async function askOnce(prompt, existingRl) {
    if (existingRl) {
        return new Promise(resolve => {
            existingRl.question(prompt, ans => resolve(String(ans == null ? '' : ans)));
        });
    }
    return stdinSession.ask(prompt);
}

class PackGenerator {
    constructor() {
        this.installer = new Installer();
        this.modManager = new ModManager();
        this.schemeManager = new SchemeManager();
        this.serverManager = new ServerManager();
        this.tempDir = utils.resolvePath('temp/packs');
        this.serverDir = utils.getServerDir();
        fs.ensureDirSync(this.tempDir);
    }

    /**
     * 解析整合包加载器标识（CurseForge manifest 的 minecraft.modLoaders[].id
     * 形如 fabric-0.16.10 / forge-47.3.0）。
     *
     * wow 不精确追踪加载器版本，这里按「默认版本表 → 已安装 jar 文件名推断」兜底，
     * 客户端启动器（Prism / GDLauncher / 官方）导入时会按 MC 版本再校正，
     * 关键是把 manifestType / modLoaders 字段补齐，让整合包能被正确识别。
     *
     * @param {string} loader 加载器名（forge/fabric/quilt/neoforge）
     * @param {string} serverDir 方案目录（用于扫描已安装 jar）
     * @returns {string} 形如 `fabric-0.16.10`
     */
    _resolveLoaderId(loader, serverDir) {
        const base = String(loader || 'forge').toLowerCase();
        const DEFAULT_LOADER_VERSION = {
            fabric: '0.16.10', quilt: '0.25.0', neoforge: '20.6.115', forge: '47.3.0'
        };
        let ver = DEFAULT_LOADER_VERSION[base] || 'latest';
        try {
            const files = fs.readdirSync(serverDir);
            const re = new RegExp(base + '[\\-. _](\\d[\\d.]+)', 'i');
            for (const f of files) {
                const m = f.match(re);
                if (m) { ver = m[1]; break; }
            }
        } catch (e) { /* 读不到就用默认版本 */ }
        return `${base}-${ver}`;
    }

    /**
     * 安装客户端整合包
     * @param {string} source - 整合包文件路径或 URL
     */
    async install(source, existingRl) {
        console.log(`📦 安装整合包: ${source}`);

        // 1. 下载或复制到临时目录
        const packPath = await this._preparePack(source);
        const extractDir = path.join(this.tempDir, `extract_${Date.now()}`);
        fs.ensureDirSync(extractDir);

        // 2. 解压整合包
        await this._extractZip(packPath, extractDir);
        console.log('✅ 整合包已解压');

        // 3. 解析 manifest
        const manifest = await this._parseManifest(extractDir);
        if (!manifest) {
            throw new Error('未找到 manifest.json 或 modpack.json');
        }

        console.log(`   Minecraft 版本: ${manifest.minecraft}`);
        console.log(`   模组加载器: ${manifest.loader}`);
        console.log(`   模组数量: ${manifest.mods?.length || 0}`);

        // 4. 询问用户使用哪个存档
        const worldOption = await this._askWorldOption(existingRl);
        let worldSource = null;
        if (worldOption === 'new') {
            console.log('将创建新世界');
        } else if (worldOption === 'existing') {
            // 列出可用的存档
            const worlds = this._listWorlds();
            if (worlds.length === 0) {
                console.log('没有现有存档，将创建新世界');
            } else {
                const selected = await this._selectWorld(worlds, existingRl);
                if (selected) {
                    // V3.5.2 起方案目录已迁至项目根 scheme/，存档直接在方案目录的 world/ 下
                    worldSource = path.join(this.serverDir, 'world');
                    if (!fs.existsSync(worldSource)) {
                        worldSource = null;
                        console.log('⚠️ 存档不存在，将创建新世界');
                    }
                }
            }
        } else {
            console.log('未选择存档，将创建新世界');
        }

        // 5. 创建临时方案
        const schemeName = `pack_install_${Date.now()}`;
        await this.schemeManager.create(schemeName, {
            version: manifest.minecraft,
            loader: manifest.loader,
            type: manifest.loader === 'forge' ? 'forge' : 'vanilla'
        });

        // 6. 安装模组
        // 6a. 可远程下载的模组（第三方 manifest 的 files/mods[] 带 url）
        if (manifest.mods && manifest.mods.length > 0) {
            console.log(`📥 安装 ${manifest.mods.length} 个模组...`);
            for (const mod of manifest.mods) {
                try {
                    await this.modManager.install(mod.url || mod.file, {
                        loader: manifest.loader,
                        version: manifest.minecraft,
                        deps: true
                    });
                } catch (e) {
                    console.warn(`⚠️ 模组 ${mod.name} 安装失败: ${e.message}`);
                    // 记录失败模组，稍后可能重试或跳过
                }
            }
        }
        // 6b. 随包分发（overrides/mods）的模组：直接复制进当前方案 mods/
        const overridesModsSrc = manifest.overrides
            ? path.join(extractDir, manifest.overrides, 'mods')
            : path.join(extractDir, 'mods');
        if (fs.existsSync(overridesModsSrc)) {
            const schemeModsDir = path.join(this.serverDir, 'mods');
            fs.ensureDirSync(schemeModsDir);
            fs.copySync(overridesModsSrc, schemeModsDir);
            console.log('✅ 随包模组已复制到方案 mods/');
        }

        // 6c. Modrinth 索引里「非模组」的远程文件（config / 资源包 / 脚本等）：
        // 随包文件已由 6b/7 从解压目录复制，这里只补下载链接型文件。
        if (manifest.extraFiles && manifest.extraFiles.length) {
            console.log(`📥 下载 ${manifest.extraFiles.length} 个整合包附加文件（config / 资源包等）...`);
            for (const ef of manifest.extraFiles) {
                try {
                    const dest = path.join(this.serverDir, ef.relPath);
                    fs.ensureDirSync(path.dirname(dest));
                    await this.installer.downloadFile(ef.url, dest);
                } catch (e) {
                    console.warn(`⚠️ 文件 ${ef.relPath} 下载失败: ${e.message}`);
                }
            }
        }

        // 7. 复制配置文件（优先 overrides/config，其次顶层 config）
        const configSrc = manifest.overrides
            ? path.join(extractDir, manifest.overrides, 'config')
            : path.join(extractDir, 'config');
        if (fs.existsSync(configSrc)) {
            const configDest = path.join(this.serverDir, 'config');
            fs.copySync(configSrc, configDest);
            console.log('✅ 配置文件已复制');
        }

        // 8. 复制世界（如果用户选择了现有存档）
        if (worldSource) {
            const worldDest = path.join(this.serverDir, 'world');
            if (fs.existsSync(worldDest)) fs.removeSync(worldDest);
            fs.copySync(worldSource, worldDest);
            console.log(`✅ 已使用存档: ${path.basename(worldSource)}`);
        }

        // 9. 测试启动
        console.log('🧪 正在测试服务器启动...');
        const testResult = await this._testServer();

        if (testResult.success) {
            console.log('✅ 整合包安装成功！服务器可正常启动');
            // 询问是否保留该方案
            const keep = await this._askConfirm('是否保留此方案？ (y/N): ', existingRl);
            if (keep.toLowerCase() !== 'y') {
                await this.schemeManager.delete(schemeName);
                console.log('方案已删除');
            }
            return;
        }

        // 10. 测试失败，尝试修复
        console.log('⚠️ 服务器启动失败，正在分析日志...');
        const incompatibleMods = await this._analyzeLogAndFindIncompatible();
        if (incompatibleMods.length > 0) {
            console.log(`发现 ${incompatibleMods.length} 个可能不兼容的模组:`);
            for (const mod of incompatibleMods) {
                console.log(`  - ${mod}`);
                await this.modManager.remove(mod);
                console.log(`  已删除: ${mod}`);
            }
            // 再次测试
            console.log('🔄 重新测试...');
            const retryResult = await this._testServer();
            if (retryResult.success) {
                console.log('✅ 修复成功！服务器可正常启动');
                return;
            }
        }

        // 11. 仍然失败，提示用户
        console.log('❌ 整合包安装失败，无法自动修复。');
        console.log('请检查日志文件: logs/latest.log');
        console.log('您可以手动删除不兼容的模组后重试。');
        // 询问是否删除该方案
        const del = await this._askConfirm('是否删除此方案？ (y/N): ', existingRl);
        if (del.toLowerCase() === 'y') {
            await this.schemeManager.delete(schemeName);
            console.log('方案已删除');
        }
    }

    /**
     * 生成客户端整合包
     */
    async generate(name, options = {}) {
        const version = options.version || config.getConfig('server.version', '1.20.1');
        const loader = (options.loader || 'forge').toLowerCase();
        const outputDir = options.output || path.join(this.tempDir, 'packs');

        console.log(`📦 生成整合包: ${name}`);
        console.log(`  版本: ${version}`);
        console.log(`  加载器: ${loader}`);

        const packDir = path.join(outputDir, name);
        fs.emptyDirSync(packDir);

        // 1. 收集模组列表，原样打进 overrides/mods（随包分发，客户端导入即可识别）
        const mods = this.modManager.listMods(loader, version);
        const overridesMods = path.join(packDir, 'overrides', 'mods');
        fs.ensureDirSync(overridesMods);
        for (const mod of mods) {
            const destPath = path.join(overridesMods, path.basename(mod.path));
            if (!fs.existsSync(destPath)) fs.copyFileSync(mod.path, destPath);
        }

        // 2. 复制配置文件到 overrides/config
        const configSrc = path.join(this.serverDir, 'config');
        if (fs.existsSync(configSrc)) {
            fs.copySync(configSrc, path.join(packDir, 'overrides', 'config'));
        }

        // 3. 生成符合 CurseForge 规范的 manifest.json
        //    manifestType / manifestVersion / minecraft.modLoaders / overrides
        //    为客户端启动器（Prism / GDLauncher / 官方）识别整合包的必备字段。
        //    模组走 overrides/mods 随包分发，故 files（CurseForge 远程解析项）留空。
        const loaderId = this._resolveLoaderId(loader, this.serverDir);
        const manifest = {
            manifestType: 'minecraftModpack',
            manifestVersion: 1,
            name,
            version: '1.0.0',
            author: 'wow',
            minecraft: {
                version,
                modLoaders: [{ id: loaderId, primary: true }]
            },
            files: [],
            overrides: 'overrides'
        };
        fs.writeFileSync(path.join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

        // 4. 打包成 ZIP
        const zipPath = path.join(outputDir, `${name}.zip`);
        if (fs.existsSync(zipPath)) fs.removeSync(zipPath);
        await this._zipDirectory(packDir, zipPath);

        console.log(`✅ 整合包已生成: ${zipPath}`);
        console.log(`   模组 ${mods.length} 个已随包打包（overrides/mods），客户端导入即可识别`);
        return zipPath;
    }

    // ==================== 辅助方法 ====================

    /**
     * 准备整合包（下载或复制到临时目录）
     */
    async _preparePack(source) {
        if (source.startsWith('http://') || source.startsWith('https://')) {
            const fileName = path.basename(source);
            const destPath = path.join(this.tempDir, fileName);
            await this.installer.downloadFile(source, destPath);
            return destPath;
        } else {
            if (!fs.existsSync(source)) {
                throw new Error(`文件不存在: ${source}`);
            }
            return source;
        }
    }

    /**
     * 解压 ZIP
     */
    _extractZip(zipPath, destDir) {
        return new Promise((resolve, reject) => {
            const AdmZip = require('adm-zip');
            try {
                const zip = new AdmZip(zipPath);
                zip.extractAllTo(destDir, true);
                resolve();
            } catch (e) {
                reject(new Error(`解压 ZIP 失败: ${e.message}`));
            }
        });
    }

    /**
     * 解析 manifest（CurseForge manifest.json 或 Modrinth modrinth.index.json）
     */
    async _parseManifest(extractDir) {
        const possibleFiles = ['manifest.json', 'modpack.json', 'pack.json', 'modrinth.index.json'];
        for (const file of possibleFiles) {
            const manifestPath = path.join(extractDir, file);
            if (!fs.existsSync(manifestPath)) continue;
            const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            // —— Modrinth mrpack 格式（modrinth.index.json）——
            if (this._isModrinthIndex(data)) {
                return this._parseModrinthIndex(data);
            }

            // —— CurseForge 规范：minecraft.version + minecraft.modLoaders[].id ——
            const mc = data.minecraft || data.version || '1.20.1';
            const mcVersion = (typeof mc === 'string') ? mc : (mc.version || '1.20.1');
            // modLoaders id 形如 fabric-0.16.10 / forge-47.3.0 → 取前缀作为加载器名
            const rawLoader = data.loader || (Array.isArray(data.modLoaders) && data.modLoaders[0] && data.modLoaders[0].id) || data.modLoader || 'forge';
            const loader = String(rawLoader).split('-')[0] || 'forge';
            // 随包分发的模组/配置目录（CF 规范用 overrides；旧格式平铺在顶层）
            const overrides = data.overrides || null;
            // 可远程下载的模组（第三方 manifest 可能带 url；wow 生成的包 files 留空）
            const mods = (data.mods || data.files || []).filter(m => m && (m.url || m.file || m.projectID));
            return { minecraft: mcVersion, loader, mods, overrides, config: data.config || {}, extraFiles: [] };
        }
        return null;
    }

    /**
     * 判定是否为 Modrinth mrpack 索引（modrinth.index.json）。
     * 特征：含 formatVersion 且 game === 'minecraft'，依赖写在 dependencies 里。
     */
    _isModrinthIndex(data) {
        return !!(data && typeof data.formatVersion !== 'undefined' &&
            data.game === 'minecraft' && data.dependencies && typeof data.dependencies === 'object');
    }

    /**
     * 解析 Modrinth mrpack 索引（modrinth.index.json）为内部统一结构。
     *
     * Modrinth 与 CurseForge 关键差异：
     *   - 版本/加载器写在 `dependencies`（minecraft + fabric/forge/quilt/neoforge），
     *     而非 minecraft.modLoaders[]。
     *   - 文件在 `files[]`，每条带 `path`（相对方案根，如 mods/a.jar）与
     *     `downloads[]`（远程直链）；无下载链接的文件随包内嵌于解压目录，
     *     由 install() 的 6b/7 兜底复制，本解析器只处理远程链接型文件。
     *
     * 归一化结果：`mods` = 带下载链接的模组（交给 install 6a 远程安装）；
     * `extraFiles` = 其余带下载链接的文件（config / 资源包等，install 6c 下载）。
     *
     * @param {object} data 已解析的 modrinth.index.json
     * @returns {object} 与 CurseForge 解析一致的内部结构
     */
    _parseModrinthIndex(data) {
        const deps = data.dependencies || {};
        const mcVersion = deps.minecraft ||
            (typeof data.version === 'string' ? data.version : '1.20.1');
        // 加载器：dependencies 里除 minecraft 外的已知加载器键（按优先级取第一个命中的）
        const LOADER_KEYS = ['neoforge', 'forge', 'fabric', 'quilt'];
        let loader = 'forge';
        for (const k of LOADER_KEYS) {
            if (deps[k]) { loader = k; break; }
        }

        const files = Array.isArray(data.files) ? data.files : [];
        const isModPath = (p) => /^mods[\\/][^\\/]+$/i.test(p) || /\.jar$/i.test(p);
        const mods = [];
        const extraFiles = [];
        for (const f of files) {
            if (!f || !f.path) continue;
            const rel = String(f.path).replace(/\\/g, '/');
            const dl = Array.isArray(f.downloads) ? f.downloads : [];
            if (!dl.length) continue; // 无下载链接的随包文件由 6b/7 从解压目录复制
            if (isModPath(rel)) {
                mods.push({ name: path.basename(rel), url: dl[0], file: rel });
            } else {
                extraFiles.push({ relPath: rel, url: dl[0], size: f.fileSize || 0 });
            }
        }
        return { minecraft: mcVersion, loader, mods, overrides: null, config: {}, extraFiles, inZipFiles: [] };
    }

    /**
     * 询问存档选项
     */
    async _askWorldOption(existingRl) {
        // existingRl 由调用方（交互菜单 / TUI）传入时直接复用；
        // 否则走 stdin_session 的临时租约，保证不会与已有消费者并存。
        const answer = await askOnce('选择存档: (1) 新建 (2) 使用现有存档 (默认: 新建): ', existingRl);
        return answer.trim() === '2' ? 'existing' : 'new';
    }

    /**
     * 列出可用的存档
     */
    _listWorlds() {
        const worldsDir = path.join(this.serverDir, 'worlds');
        if (!fs.existsSync(worldsDir)) return [];
        return fs.readdirSync(worldsDir).filter(f => fs.statSync(path.join(worldsDir, f)).isDirectory());
    }

    /**
     * 选择存档
     */
    async _selectWorld(worlds, existingRl) {
        console.log('可用存档:');
        for (let i = 0; i < worlds.length; i++) {
            console.log(`  ${i + 1}. ${worlds[i]}`);
        }
        const answer = await askOnce('请输入编号 (默认: 1): ', existingRl);
        const idx = parseInt(answer) - 1;
        if (idx >= 0 && idx < worlds.length) return worlds[idx];
        return worlds[0];
    }

    /**
     * 测试服务器启动
     */
    _testServer() {
        return new Promise((resolve) => {
            const server = new ServerManager();
            // 启动服务器，等待一段时间检测是否崩溃
            server.start('1G').then(() => {
                // 等待10秒，检测进程是否存在
                setTimeout(() => {
                    const running = server.isRunning();
                    if (running) {
                        // 停止服务器
                        server.stop().then(() => {
                            resolve({ success: true });
                        }).catch(() => {
                            server.kill();
                            resolve({ success: true });
                        });
                    } else {
                        resolve({ success: false });
                    }
                }, 10000);
            }).catch(() => {
                resolve({ success: false });
            });
        });
    }

    /**
     * 分析日志找出不兼容模组
     */
    async _analyzeLogAndFindIncompatible() {
        const logFile = path.join(this.serverDir, 'logs', 'latest.log');
        if (!fs.existsSync(logFile)) {
            return [];
        }
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split('\n');
        const incompatible = [];
        // 常见的模组不兼容错误模式
        const patterns = [
            /Caused by: java.lang.ClassNotFoundException: (\w+)/,
            /Error loading mod: (\w+)/,
            /Mod (\w+) requires/,
            /Conflict with mod (\w+)/
        ];
        for (const line of lines) {
            for (const pattern of patterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    const modName = match[1];
                    if (!incompatible.includes(modName)) {
                        incompatible.push(modName);
                    }
                }
            }
        }
        return incompatible;
    }

    /**
     * 询问确认
     */
    async _askConfirm(prompt, existingRl) {
        return askOnce(prompt, existingRl);
    }

    /**
     * 打包目录为 ZIP
     */
    _zipDirectory(dirPath, zipPath) {
        return new Promise((resolve, reject) => {
            const AdmZip = require('adm-zip');
            try {
                const zip = new AdmZip();
                zip.addLocalFolder(dirPath);
                zip.writeZip(zipPath);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }
}

module.exports = PackGenerator;