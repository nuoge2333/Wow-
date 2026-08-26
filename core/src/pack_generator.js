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
                    worldSource = path.join(this.serverDir, '..', '..', 'server', 'worlds', selected);
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

        // 7. 复制配置文件
        const configSrc = path.join(extractDir, 'config');
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
        const loader = options.loader || 'forge';
        const outputDir = options.output || path.join(this.tempDir, 'packs');

        console.log(`📦 生成整合包: ${name}`);
        console.log(`  版本: ${version}`);
        console.log(`  加载器: ${loader}`);

        const packDir = path.join(outputDir, name);
        fs.ensureDirSync(packDir);

        // 1. 收集模组列表
        const mods = this.modManager.listMods(loader, version);
        const modList = [];
        for (const mod of mods) {
            // 这里简化处理，实际需要从模组 jar 中提取元数据或从 pool 中获取
            modList.push({
                name: mod.name,
                version: mod.version || 'unknown',
                url: `file://${mod.path}` // 或使用 pool 中的相对路径
            });
        }

        // 2. 收集配置文件
        const configSrc = path.join(this.serverDir, 'config');
        if (fs.existsSync(configSrc)) {
            const configDest = path.join(packDir, 'config');
            fs.copySync(configSrc, configDest);
        }

        // 3. 生成 manifest.json
        const manifest = {
            name: name,
            version: '1.0.0',
            minecraft: version,
            loader: loader,
            mods: modList,
            generated: new Date().toISOString()
        };
        fs.writeFileSync(path.join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

        // 4. 复制模组文件到 pack/mods
        const modsDest = path.join(packDir, 'mods');
        fs.ensureDirSync(modsDest);
        for (const mod of mods) {
            const srcPath = mod.path;
            const destPath = path.join(modsDest, path.basename(srcPath));
            if (!fs.existsSync(destPath)) {
                fs.copyFileSync(srcPath, destPath);
            }
        }

        // 5. 打包成 ZIP
        const zipPath = path.join(outputDir, `${name}.zip`);
        await this._zipDirectory(packDir, zipPath);

        console.log(`✅ 整合包已生成: ${zipPath}`);
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
     * 解析 manifest
     */
    async _parseManifest(extractDir) {
        const possibleFiles = ['manifest.json', 'modpack.json', 'pack.json'];
        for (const file of possibleFiles) {
            const manifestPath = path.join(extractDir, file);
            if (fs.existsSync(manifestPath)) {
                const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                // 标准化格式
                return {
                    minecraft: data.minecraft || data.version || '1.20.1',
                    loader: data.loader || data.modLoader || 'forge',
                    mods: data.mods || data.files || [],
                    config: data.config || {}
                };
            }
        }
        return null;
    }

    /**
     * 询问存档选项
     */
    _askWorldOption(existingRl) {
        // existingRl 由调用方（交互菜单）复用同一 readline 接口传入，避免重复挂在同一 stdin 导致输入被读两次。
        const ownRl = !existingRl;
        const rl = existingRl || require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise((resolve) => {
            rl.question('选择存档: (1) 新建 (2) 使用现有存档 (默认: 新建): ', (answer) => {
                if (ownRl) rl.close();
                if (answer.trim() === '2') {
                    resolve('existing');
                } else {
                    resolve('new');
                }
            });
        });
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
    _selectWorld(worlds, existingRl) {
        const ownRl = !existingRl;
        const rl = existingRl || require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise((resolve) => {
            console.log('可用存档:');
            for (let i = 0; i < worlds.length; i++) {
                console.log(`  ${i+1}. ${worlds[i]}`);
            }
            rl.question('请输入编号 (默认: 1): ', (answer) => {
                if (ownRl) rl.close();
                const idx = parseInt(answer) - 1;
                if (idx >= 0 && idx < worlds.length) {
                    resolve(worlds[idx]);
                } else {
                    resolve(worlds[0]);
                }
            });
        });
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
    _askConfirm(prompt, existingRl) {
        const ownRl = !existingRl;
        const rl = existingRl || require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise((resolve) => {
            rl.question(prompt, (answer) => {
                if (ownRl) rl.close();
                resolve(answer);
            });
        });
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