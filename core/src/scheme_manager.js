/**
 * 方案管理模块 - 模板模式实现
 * - 方案创建（自动判定资源重合状态）
 * - 方案切换（自动补齐/瘦身）
 * - 方案状态管理（minimal/partial/full）
 * - 资源池引用计数
 * - 自动清理未被引用的pool资源
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const utils = require('./utils');
const config = require('./config');
const Installer = require('./installer');
const ModManager = require('./mod_manager');
const ServerManager = require('./server');

// 资源状态常量
const STATE = {
    MINIMAL: 'minimal',   // 所有资源都在pool中
    PARTIAL: 'partial',   // 部分资源在pool中
    FULL: 'full'          // 所有资源都在方案目录中（无pool引用）
};

class SchemeManager {
    constructor() {
        this.schemesDir = utils.resolvePath('../scheme');
        this.poolDir = utils.getPoolPath();
        this.poolIndexPath = path.join(this.poolDir, 'index.yaml');
        this.serverDir = utils.getServerDir();
        this.installer = new Installer();
        this.modManager = new ModManager();
        this.serverManager = new ServerManager();
        this.autoScheme = config.getConfig('auto_scheme', true);

        // 确保目录存在
        fs.ensureDirSync(this.schemesDir);
        fs.ensureDirSync(this.poolDir);
        fs.ensureDirSync(path.join(this.poolDir, 'cores'));
        fs.ensureDirSync(path.join(this.poolDir, 'mods'));
        fs.ensureDirSync(path.join(this.poolDir, 'plugins'));
        fs.ensureDirSync(this.serverDir);

        // 初始化pool索引
        this.poolIndex = this._loadPoolIndex();
        this.currentScheme = this._getCurrentScheme();
    }

    // ==================== 核心方法 ====================

    /**
     * 创建新方案（自动判定资源重合状态）
     */
    async create(name, options = {}) {
        const {
            version = '1.20.1',
            loader = 'forge',
            type = 'vanilla',
            build = null,
            fromPack = null  // 从整合包导入
        } = options;

        if (this._schemeExists(name)) {
            throw new Error(`方案 ${name} 已存在`);
        }

        console.log(`📦 创建方案: ${name}`);
        console.log(`  版本: ${version}`);
        console.log(`  加载器: ${loader}`);
        console.log(`  核心类型: ${type}`);

        // 1. 创建方案目录
        const schemePath = this._getSchemePath(name);
        fs.ensureDirSync(schemePath);
        fs.ensureDirSync(path.join(schemePath, 'world'));
        fs.ensureDirSync(path.join(schemePath, 'config'));
        fs.ensureDirSync(path.join(schemePath, 'logs'));
        fs.ensureDirSync(path.join(schemePath, 'mods'));
        fs.ensureDirSync(path.join(schemePath, 'plugins'));

        // 2. 安装/获取服务端核心
        // V3.5.6：核心安装失败时必须回滚已创建的目录，否则会留下一个没有
        // scheme.yaml、没有核心 jar 的残缺方案，在 scheme list 中显示为「已损坏」。
        let corePath;
        let coreHash;
        // V3.5.8：核心的「方案内相对路径」。现代 Forge/NeoForge 的核心不在方案根目录，
        // 而在 libraries/net/minecraftforge/forge/<mc>-<ver>/ 里，甚至只有 args.txt。
        // 旧实现只存 path.basename(corePath)，瘦身后从 pool 补回会落到根目录，
        // 于是「切换方案后核心路径找错」。这里记录相对安装目录的完整相对路径。
        let coreRel;
        try {
            if (fromPack) {
                // 从整合包复制核心
                corePath = await this._installCoreFromPack(fromPack, schemePath);
                coreRel = path.relative(schemePath, corePath).split(path.sep).join('/');
            } else {
                corePath = await this.installer.install(type, version, build, schemePath);
                coreRel = path.relative(schemePath, corePath).split(path.sep).join('/');
            }
            coreHash = await this._computeHash(corePath);
        } catch (e) {
            try {
                if (fs.existsSync(schemePath)) fs.removeSync(schemePath);
                console.log(`⚠️ 核心安装失败，已回滚方案目录: ${schemePath}`);
            } catch (cleanErr) {
                console.log(`⚠️ 回滚方案目录失败，请手动删除: ${schemePath}（${cleanErr.message}）`);
            }
            throw new Error(`创建方案 ${name} 失败: ${e.message}`);
        }

        // 3. 检查核心是否在pool中
        const coreInPool = this._isResourceInPool(coreHash);

        // 4. 复制核心到pool（如果不在）
        if (!coreInPool) {
            await this._addToPool(corePath, 'cores', `${type}/${version}`, coreHash, coreRel);
        }

        // 5. 收集模组列表（初始为空）
        const mods = [];
        const plugins = [];

        // 5.1 Fabric 方案自动装配 Fabric API（V3.5.11）
        // 绝大多数 Fabric 模组硬依赖 Fabric API，空方案启动即缺依赖。
        // 整合包导入（fromPack）通常自带 Fabric API，不重复装配。
        // 解析/下载失败只警告不阻断建方案（与「自更新失败不阻断启动」同一原则）。
        if (!fromPack && String(loader).toLowerCase() === 'fabric') {
            const fabricApi = await this._autoInstallFabricApi(schemePath, version);
            if (fabricApi) mods.push(fabricApi);
        }

        // 6. 生成默认配置文件
        this._generateDefaultFiles(schemePath, version);

        // 7. 判定方案状态
        const state = this._determineInitialState(mods, plugins);

        // 8. 保存方案元数据
        const meta = {
            name,
            version,
            loader,
            type,
            build: build || null,
            state,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            compatibility: {
                java: this._getRequiredJava(version),
                loaders: [loader]
            },
            resources: {
                core: {
                    // file 记录「相对方案根目录」的完整路径（V3.5.8）。老方案里是纯文件名，
                    // 读取端兼容处理（见 _resolveCoreTarget）。
                    file: coreRel || path.basename(corePath),
                    hash: coreHash,
                    in_pool: coreInPool,
                    pool_path: coreInPool
                        ? `pool/cores/${type}/${version}/${coreRel || path.basename(corePath)}`
                        : null
                },
                mods: [],
                plugins: []
            },
            unique_resources: [],  // 方案独有资源列表
            world: {
                exists: false,
                size: 0
            }
        };

        // 记录模组资源
        for (const mod of mods) {
            const modHash = await this._computeHash(mod.path);
            const inPool = this._isResourceInPool(modHash);
            meta.resources.mods.push({
                file: path.basename(mod.path),
                hash: modHash,
                in_pool: inPool,
                pool_path: inPool ? this._getPoolPathByHash(modHash) : null,
                mod_name: mod.name || path.basename(mod.path),
                version: mod.version || 'unknown'
            });
        }

        // 记录插件资源
        for (const plugin of plugins) {
            const pluginHash = await this._computeHash(plugin.path);
            const inPool = this._isResourceInPool(pluginHash);
            meta.resources.plugins.push({
                file: path.basename(plugin.path),
                hash: pluginHash,
                in_pool: inPool,
                pool_path: inPool ? this._getPoolPathByHash(pluginHash) : null,
                plugin_name: plugin.name || path.basename(plugin.path)
            });
        }

        this._saveSchemeMeta(name, meta);

        console.log(`✅ 方案 ${name} 创建完成`);
        console.log(`  状态: ${state}`);
        console.log(`  核心: ${meta.resources.core.file} (${coreInPool ? '共享' : '独有'})`);
        console.log(`  模组: ${mods.length} 个`);
        console.log(`  插件: ${plugins.length} 个`);

        // 自动切换到新方案（如果auto_scheme启用）
        if (this.autoScheme) {
            await this.switch(name);
        }

        return name;
    }

    /**
     * V3.5.11：Fabric 方案自动装配 Fabric API。
     * 绝大多数 Fabric 模组硬依赖 Fabric API，空方案启动即缺依赖。
     * 这里按 MC 版本从 Modrinth（项目 P7dR8mSH = fabric-api）解析最新兼容版本，
     * 装入方案 mods/ 并同步入资源池（与模组安装路径一致，切换方案时可补齐/瘦身）。
     * 解析或下载失败只警告、返回 null，绝不阻断方案创建。
     *
     * @param {string} schemePath 新方案目录
     * @param {string} mcVersion  Minecraft 版本
     * @returns {Promise<{path:string,name:string,version:string}|null>}
     */
    async _autoInstallFabricApi(schemePath, mcVersion) {
        const FABRIC_API_PROJECT = 'P7dR8mSH'; // Modrinth: fabric-api
        const modsDir = path.join(schemePath, 'mods');
        fs.ensureDirSync(modsDir);
        try {
            const modSearch = require('./mod_search');
            const file = await modSearch.pickModrinthFile(FABRIC_API_PROJECT, 'fabric', mcVersion);
            if (!file || !file.url) {
                console.log('  ⚠️ 未找到适配当前版本的 Fabric API，跳过自动装配');
                return null;
            }
            const dest = path.join(modsDir, file.filename);
            if (fs.existsSync(dest)) {
                console.log(`  Fabric API 已存在: ${file.filename}`);
            } else {
                console.log(`  🧩 正在获取 Fabric API (${file.version_number})...`);
                await this.modManager._downloadMod(file.url, dest);
            }
            // 入池共享，供切换方案时补齐/瘦身（与 create() 中核心入池同一机制；
            // 池内布局与 ModManager.getModStoragePath 一致：mods/<loader>/<版本>/<文件名>）
            const modHash = await this._computeHash(dest);
            if (!this._isResourceInPool(modHash)) {
                await this._addToPool(dest, 'mods', `fabric/${mcVersion}`, modHash, file.filename);
            }
            console.log(`  ✅ Fabric API 已自动装配: ${file.filename}`);
            return { path: dest, name: 'Fabric API', version: file.version_number };
        } catch (e) {
            console.log(`  ⚠️ Fabric API 自动装配失败（不影响方案创建）: ${e.message}`);
            return null;
        }
    }

    /**
     * 切换方案（自动补齐/瘦身）
     */
    async switch(name) {
        if (!this._schemeExists(name)) {
            throw new Error(`方案 ${name} 不存在`);
        }

        if (this.currentScheme === name) {
            console.log(`已是当前方案: ${name}`);
            return;
        }

        console.log(`🔄 切换到方案: ${name}`);

        // 1. 如果auto_scheme启用，先补齐目标方案
        if (this.autoScheme) {
            const meta = this._loadSchemeMeta(name);
            if (meta.state !== STATE.FULL) {
                await this._materializeScheme(name);
            }
        }

        // 2. V3.4.x 起：服务器直接在方案目录内运行（见 utils.getServerDir），
        //    不再把方案复制到 server/ 目录，因此切换方案无需备份/清空/复制 server 目录。
        //    step 1 已确保目标方案补齐为可运行的完整实例（FULL）。

        // 3. 更新当前方案记录
        const oldScheme = this.currentScheme;
        this.currentScheme = name;
        config.setConfig('server.scheme', name);
        config.setConfig('server.version', this._loadSchemeMeta(name).version);

        console.log(`✅ 已切换到方案: ${name}`);

        // 4. 如果auto_scheme启用，瘦身旧方案
        if (this.autoScheme && oldScheme) {
            await this._pruneScheme(oldScheme);
        }

        // 5. 自动清理pool中未被引用的资源
        if (this.autoScheme) {
            await this._cleanPool();
        }
    }

    /**
     * 删除方案（清理pool中未被引用的资源）
     */
    async delete(name) {
        if (!this._schemeExists(name)) {
            throw new Error(`方案 ${name} 不存在`);
        }

        if (this.currentScheme === name) {
            console.log(`当前方案 ${name} 正在使用，请先切换`);
            return;
        }

        console.log(`🗑️ 删除方案: ${name}`);

        // 1. 加载元数据，记录资源列表
        const meta = this._loadSchemeMeta(name);

        // 2. 删除方案目录
        const schemePath = this._getSchemePath(name);
        fs.removeSync(schemePath);

        console.log(`✅ 方案 ${name} 已删除`);

        // 3. 如果auto_scheme启用，清理pool资源
        if (this.autoScheme) {
            await this._cleanPool();
        }
    }

    /**
     * 查看方案详情（完整显示scheme.yaml）
     */
    info(name) {
        const target = name || this.currentScheme;
        if (!target) {
            console.log('未指定方案且无当前方案');
            return;
        }

        if (!this._schemeExists(target)) {
            console.log(`方案 ${target} 不存在`);
            return;
        }

        const meta = this._loadSchemeMeta(target);
        console.log(`📋 方案详情: ${target}`);
        console.log('='.repeat(60));
        console.log(yaml.dump(meta, { indent: 2, lineWidth: -1 }));
        console.log('='.repeat(60));
        return meta;
    }

    /**
     * 查看方案状态
     */
    status(name) {
        const target = name || this.currentScheme;
        if (!target) {
            console.log('未指定方案且无当前方案');
            return;
        }

        if (!this._schemeExists(target)) {
            console.log(`方案 ${target} 不存在`);
            return;
        }

        const meta = this._loadSchemeMeta(target);
        const stats = {
            name: target,
            state: meta.state,
            version: meta.version,
            loader: meta.loader,
            type: meta.type,
            core: {
                file: meta.resources.core.file,
                in_pool: meta.resources.core.in_pool
            },
            mods: {
                count: meta.resources.mods.length,
                shared: meta.resources.mods.filter(m => m.in_pool).length,
                unique: meta.resources.mods.filter(m => !m.in_pool).length
            },
            plugins: {
                count: meta.resources.plugins.length,
                shared: meta.resources.plugins.filter(p => p.in_pool).length,
                unique: meta.resources.plugins.filter(p => !p.in_pool).length
            },
            unique_resources: meta.unique_resources || [],
            world: meta.world || { exists: false }
        };

        console.log(`📊 方案状态: ${target}`);
        console.log('='.repeat(60));
        console.log(`  状态: ${stats.state}`);
        console.log(`  版本: ${stats.version}`);
        console.log(`  加载器: ${stats.loader}`);
        console.log(`  核心: ${stats.core.file} (${stats.core.in_pool ? '🔄 共享' : '🔒 独有'})`);
        console.log(`  模组: ${stats.mods.count} 个 (共享: ${stats.mods.shared}, 独有: ${stats.mods.unique})`);
        console.log(`  插件: ${stats.plugins.count} 个 (共享: ${stats.plugins.shared}, 独有: ${stats.plugins.unique})`);
        console.log(`  世界: ${stats.world.exists ? '✅ 存在' : '❌ 不存在'}`);
        if (stats.unique_resources.length > 0) {
            console.log(`  独有资源: ${stats.unique_resources.length} 个`);
            for (const ur of stats.unique_resources) {
                console.log(`    - ${ur}`);
            }
        }
        console.log('='.repeat(60));

        return stats;
    }

    /**
     * 强制补齐方案（pull模式）
     */
    async pull(name) {
        if (!this._schemeExists(name)) {
            throw new Error(`方案 ${name} 不存在`);
        }

        console.log(`📥 拉取资源补齐方案: ${name}`);
        await this._materializeScheme(name);

        // 禁用auto_scheme（手动控制）
        if (this.autoScheme) {
            this.autoScheme = false;
            config.setConfig('auto_scheme', false);
            console.log('⚠️ auto_scheme 已自动设为 false（手动管理模式）');
        }
    }

    /**
     * 强制瘦身方案
     */
    async prune(name) {
        if (!this._schemeExists(name)) {
            throw new Error(`方案 ${name} 不存在`);
        }

        console.log(`🧹 瘦身方案: ${name}`);
        await this._pruneScheme(name);

        // 禁用auto_scheme（手动控制）
        if (this.autoScheme) {
            this.autoScheme = false;
            config.setConfig('auto_scheme', false);
            console.log('⚠️ auto_scheme 已自动设为 false（手动管理模式）');
        }
    }

    /**
     * 修改方案元数据
     */
    async edit(name, key, value) {
        if (!this._schemeExists(name)) {
            throw new Error(`方案 ${name} 不存在`);
        }

        const meta = this._loadSchemeMeta(name);

        // 检查是否正在修改核心相关字段
        const coreFields = ['type', 'version', 'loader'];
        const isCoreChange = coreFields.includes(key);

        // 记录旧值
        const oldValue = meta[key];

        // 更新值
        if (key === 'name') {
            // 重命名方案
            const oldPath = this._getSchemePath(name);
            const newPath = this._getSchemePath(value);
            if (fs.existsSync(newPath)) {
                throw new Error(`方案 ${value} 已存在`);
            }
            fs.renameSync(oldPath, newPath);
            meta.name = value;
        } else if (key === 'state') {
            console.warn('⚠️ 状态由系统自动管理，不建议手动修改');
            meta.state = value;
        } else if (key === 'engine') {
            meta.type = value;
            // 检查是否兼容
            if (isCoreChange && this._isEcoIncompatible(meta)) {
                console.warn(`⚠️ 核心类型从 ${oldValue} 变为 ${value}，生态可能不兼容`);
                console.warn('已清空 mods 和 plugins 列表，请重新安装');
                meta.resources.mods = [];
                meta.resources.plugins = [];
                meta.unique_resources = [];
            }
        } else if (key === 'version') {
            meta.version = value;
            if (isCoreChange && this._isEcoIncompatible(meta)) {
                console.warn(`⚠️ 核心版本从 ${oldValue} 变为 ${value}，模组可能不兼容`);
                console.warn('已清空 mods 和 plugins 列表，请重新安装');
                meta.resources.mods = [];
                meta.resources.plugins = [];
                meta.unique_resources = [];
            }
        } else {
            // 其他字段直接设置
            meta[key] = value;
        }

        meta.updated_at = new Date().toISOString();
        this._saveSchemeMeta(name, meta);

        console.log(`✅ 方案 ${name} 已更新: ${key} = ${value}`);
        return meta;
    }

    /**
     * 注册未知来源核心（other字段）
     */
    register(otherType, ecoList) {
        // 存储到配置中，供后续创建方案使用
        const registered = config.getConfig('registered_engines', {});
        registered[otherType] = {
            eco: ecoList.split(',').map(e => e.trim()),
            registered_at: new Date().toISOString()
        };
        config.setConfig('registered_engines', registered);
        console.log(`✅ 已注册自定义核心: ${otherType}`);
        console.log(`  兼容生态: ${ecoList}`);
        console.log('  现在可以使用: scheme create --engine other --other-type ' + otherType);
    }

    // ==================== 列表方法 ====================

    /**
     * 列出所有方案
     */
    list() {
        if (!fs.existsSync(this.schemesDir)) {
            console.log('没有方案');
            return [];
        }

        const schemes = fs.readdirSync(this.schemesDir);
        const result = [];
        for (const name of schemes) {
            const schemePath = path.join(this.schemesDir, name);
            if (fs.statSync(schemePath).isDirectory()) {
                try {
                    const meta = this._loadSchemeMeta(name);
                    const isActive = this.currentScheme === name;
                    result.push({
                        name,
                        version: meta.version,
                        loader: meta.loader,
                        type: meta.type,
                        state: meta.state,
                        active: isActive,
                        created_at: meta.created_at
                    });
                } catch (e) {
                    result.push({
                        name,
                        version: 'unknown',
                        loader: 'unknown',
                        type: 'unknown',
                        state: 'unknown',
                        active: this.currentScheme === name,
                        created_at: null
                    });
                }
            }
        }
        return result;
    }

    // ==================== 内部方法 ====================

    _getSchemePath(name) {
        return path.join(this.schemesDir, name);
    }

    /**
     * 解析一个方案内核心资源对应的落盘位置。
     * V3.5.8：Forge/NeoForge 的核心位于 libraries/ 深层，必须按记录里的相对路径还原，
     * 否则会平铺到方案根目录，导致 server._getServerJar 找不到（「核心路径找错」）。
     * 兼容三种历史数据形态：
     *   1. 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/forge-...-server.jar'（新格式）
     *   2. 'forge-1.16.5-36.2.39.jar'（老格式，纯文件名 → 根目录）
     *   3. Windows 上误存的反斜杠相对路径
     */
    _resolveCoreTarget(schemePath, coreMeta) {
        const raw = (coreMeta && coreMeta.file) || '';
        const norm = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
        return path.join(schemePath, norm.split('/').filter(Boolean).join(path.sep));
    }

    _schemeExists(name) {
        const schemePath = this._getSchemePath(name);
        return fs.existsSync(schemePath) && fs.existsSync(path.join(schemePath, 'scheme.yaml'));
    }

    _getCurrentScheme() {
        const current = config.getConfig('server.scheme', null);
        if (current && this._schemeExists(current)) {
            return current;
        }
        return null;
    }

    _loadSchemeMeta(name) {
        const metaPath = path.join(this._getSchemePath(name), 'scheme.yaml');
        if (!fs.existsSync(metaPath)) {
            throw new Error(`方案 ${name} 的元数据文件不存在`);
        }
        const content = fs.readFileSync(metaPath, 'utf8');
        return yaml.load(content);
    }

    _saveSchemeMeta(name, meta) {
        const metaPath = path.join(this._getSchemePath(name), 'scheme.yaml');
        fs.writeFileSync(metaPath, yaml.dump(meta, { indent: 2, lineWidth: -1 }), 'utf8');
    }

    // ==================== Pool 管理 ====================

    _loadPoolIndex() {
        if (fs.existsSync(this.poolIndexPath)) {
            try {
                const content = fs.readFileSync(this.poolIndexPath, 'utf8');
                return yaml.load(content) || { resources: {}, ref_count: {} };
            } catch (e) {
                return { resources: {}, ref_count: {} };
            }
        }
        return { resources: {}, ref_count: {} };
    }

    _savePoolIndex() {
        fs.writeFileSync(this.poolIndexPath, yaml.dump(this.poolIndex, { indent: 2, lineWidth: -1 }), 'utf8');
    }

    _computeHash(filePath) {
        const data = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    _isResourceInPool(hash) {
        return !!this.poolIndex.resources[hash];
    }

    _getPoolPathByHash(hash) {
        return this.poolIndex.resources[hash] || null;
    }

    /**
     * 把文件加入资源池。
     * V3.5.8：新增 relPath 参数——Forge/NeoForge 的核心位于 libraries/ 深层，
     * 若池内只按 basename 平铺存放，补回方案时就会落到方案根目录（路径找错）。
     * 这里按原始相对路径落盘，pool_path 记录该相对路径，_materializeScheme 原样还原。
     */
    async _addToPool(filePath, category, subPath, hash, relPath = null) {
        // 复制文件到pool
        const poolSubDir = path.join(this.poolDir, category, subPath);
        fs.ensureDirSync(poolSubDir);
        const rel = relPath && typeof relPath === 'string' && relPath.length
            ? relPath.split('/').filter(Boolean).join(path.sep)
            : path.basename(filePath);
        const poolFilePath = path.join(poolSubDir, rel);
        fs.ensureDirSync(path.dirname(poolFilePath));

        if (!fs.existsSync(poolFilePath)) {
            fs.copyFileSync(filePath, poolFilePath);
        }

        // 更新索引（存相对 pool 根的路径，便于回溯）
        this.poolIndex.resources[hash] = path.join(category, subPath, rel);
        this.poolIndex.ref_count[hash] = (this.poolIndex.ref_count[hash] || 0) + 1;
        this._savePoolIndex();

        return poolFilePath;
    }

    _incrementRefCount(hash) {
        if (this.poolIndex.ref_count[hash]) {
            this.poolIndex.ref_count[hash]++;
        } else {
            this.poolIndex.ref_count[hash] = 1;
        }
        this._savePoolIndex();
    }

    _decrementRefCount(hash) {
        if (this.poolIndex.ref_count[hash]) {
            this.poolIndex.ref_count[hash]--;
            if (this.poolIndex.ref_count[hash] <= 0) {
                delete this.poolIndex.ref_count[hash];
                // 标记为可清理
            }
        }
        this._savePoolIndex();
    }

    async _cleanPool() {
        console.log('🧹 清理 pool 中未被引用的资源...');

        // 收集所有方案引用的哈希
        const usedHashes = new Set();
        const schemes = fs.readdirSync(this.schemesDir);
        for (const name of schemes) {
            const schemePath = path.join(this.schemesDir, name);
            if (fs.statSync(schemePath).isDirectory()) {
                try {
                    const meta = this._loadSchemeMeta(name);
                    // 核心
                    if (meta.resources?.core?.hash) {
                        usedHashes.add(meta.resources.core.hash);
                    }
                    // 模组
                    if (meta.resources?.mods) {
                        for (const mod of meta.resources.mods) {
                            if (mod.hash) usedHashes.add(mod.hash);
                        }
                    }
                    // 插件
                    if (meta.resources?.plugins) {
                        for (const plugin of meta.resources.plugins) {
                            if (plugin.hash) usedHashes.add(plugin.hash);
                        }
                    }
                } catch (e) {
                    // 跳过损坏的方案
                }
            }
        }

        // 删除未被引用的资源
        let removed = 0;
        for (const [hash, pathStr] of Object.entries(this.poolIndex.resources)) {
            if (!usedHashes.has(hash)) {
                const fullPath = path.join(this.poolDir, pathStr);
                if (fs.existsSync(fullPath)) {
                    fs.removeSync(fullPath);
                    removed++;
                }
                delete this.poolIndex.resources[hash];
                delete this.poolIndex.ref_count[hash];
            }
        }

        this._savePoolIndex();
        if (removed > 0) {
            console.log(`✅ 已清理 ${removed} 个未被引用的资源`);
        } else {
            console.log('✅ 没有需要清理的资源');
        }
    }

    // ==================== 状态管理 ====================

    _determineInitialState(mods, plugins) {
        // 新方案初始状态由资源的共享情况决定
        let sharedCount = 0;
        let totalCount = 1; // 核心

        // 检查模组
        for (const mod of mods) {
            totalCount++;
            if (mod.in_pool) sharedCount++;
        }

        // 检查插件
        for (const plugin of plugins) {
            totalCount++;
            if (plugin.in_pool) sharedCount++;
        }

        if (sharedCount === totalCount) {
            return STATE.MINIMAL;
        } else if (sharedCount === 0) {
            return STATE.FULL;
        } else {
            return STATE.PARTIAL;
        }
    }

    async _materializeScheme(name) {
        const meta = this._loadSchemeMeta(name);
        const schemePath = this._getSchemePath(name);

        console.log(`  补齐方案: ${name} (当前状态: ${meta.state})`);

        let copied = 0;

        // 检查核心
        if (meta.resources.core.in_pool && meta.resources.core.hash) {
            // 从索引获取实际路径（poolIndex 里存的是相对 pool 根的路径）
            const relInPool = this.poolIndex.resources[meta.resources.core.hash];
            const poolFullPath = relInPool ? path.join(this.poolDir, relInPool) : null;
            if (poolFullPath && fs.existsSync(poolFullPath)) {
                // V3.5.8：按记录的相对路径还原（Forge 核心在 libraries/ 深层）
                const targetPath = this._resolveCoreTarget(schemePath, meta.resources.core);
                if (!fs.existsSync(targetPath)) {
                    fs.ensureDirSync(path.dirname(targetPath));
                    fs.copyFileSync(poolFullPath, targetPath);
                    copied++;
                }
                meta.resources.core.in_pool = false;
                // 增加引用计数
                this._incrementRefCount(meta.resources.core.hash);
            } else {
                // V3.5.8：pool 里找不到核心（被手动删除 / 索引漂移）。不要静默跳过——
                // 跳过会让状态被强行标成 FULL，而实际缺核心，启动时才报「找不到核心」。
                console.warn(`  ⚠️ 方案 ${name} 的核心在资源池中缺失（hash=${String(meta.resources.core.hash).slice(0, 12)}…），方案可能无法启动`);
            }
        }

        // 检查模组
        for (const mod of meta.resources.mods) {
            if (mod.in_pool && mod.hash) {
                const poolFullPath = path.join(this.poolDir, this.poolIndex.resources[mod.hash]);
                if (fs.existsSync(poolFullPath)) {
                    const targetPath = path.join(schemePath, 'mods', mod.file);
                    if (!fs.existsSync(targetPath)) {
                        fs.copyFileSync(poolFullPath, targetPath);
                        copied++;
                    }
                    mod.in_pool = false;
                    this._incrementRefCount(mod.hash);
                }
            }
        }

        // 检查插件
        for (const plugin of meta.resources.plugins) {
            if (plugin.in_pool && plugin.hash) {
                const poolFullPath = path.join(this.poolDir, this.poolIndex.resources[plugin.hash]);
                if (fs.existsSync(poolFullPath)) {
                    const targetPath = path.join(schemePath, 'plugins', plugin.file);
                    if (!fs.existsSync(targetPath)) {
                        fs.copyFileSync(poolFullPath, targetPath);
                        copied++;
                    }
                    plugin.in_pool = false;
                    this._incrementRefCount(plugin.hash);
                }
            }
        }

        meta.state = STATE.FULL;
        meta.updated_at = new Date().toISOString();
        this._saveSchemeMeta(name, meta);

        console.log(`  已从 pool 复制 ${copied} 个资源到方案目录`);
        console.log(`  方案 ${name} 已转为完整实例 (FULL)`);
    }

    async _pruneScheme(name) {
        const meta = this._loadSchemeMeta(name);
        const schemePath = this._getSchemePath(name);

        if (meta.state === STATE.MINIMAL) {
            console.log(`  方案 ${name} 已是最小实例 (MINIMAL)`);
            return;
        }

        console.log(`  瘦身方案: ${name} (当前状态: ${meta.state})`);

        let removed = 0;

        // 检查核心
        if (meta.resources.core.hash && this._isResourceInPool(meta.resources.core.hash)) {
            // V3.5.8：按记录的相对路径删除（Forge 核心在 libraries/ 深层，不能只看方案根目录）
            const corePath = this._resolveCoreTarget(schemePath, meta.resources.core);
            if (fs.existsSync(corePath)) {
                fs.removeSync(corePath);
                removed++;
                meta.resources.core.in_pool = true;
                this._decrementRefCount(meta.resources.core.hash);
            }
        }

        // 检查模组
        for (const mod of meta.resources.mods) {
            if (mod.hash && this._isResourceInPool(mod.hash)) {
                const modPath = path.join(schemePath, 'mods', mod.file);
                if (fs.existsSync(modPath)) {
                    fs.removeSync(modPath);
                    removed++;
                    mod.in_pool = true;
                    this._decrementRefCount(mod.hash);
                }
            }
        }

        // 检查插件
        for (const plugin of meta.resources.plugins) {
            if (plugin.hash && this._isResourceInPool(plugin.hash)) {
                const pluginPath = path.join(schemePath, 'plugins', plugin.file);
                if (fs.existsSync(pluginPath)) {
                    fs.removeSync(pluginPath);
                    removed++;
                    plugin.in_pool = true;
                    this._decrementRefCount(plugin.hash);
                }
            }
        }

        // 重新判定状态
        let allShared = true;
        let allUnique = true;

        if (!meta.resources.core.in_pool) allUnique = false;
        if (meta.resources.core.in_pool) allShared = allShared && true;

        for (const mod of meta.resources.mods) {
            if (mod.in_pool) {
                allUnique = false;
            } else {
                allShared = false;
            }
        }
        for (const plugin of meta.resources.plugins) {
            if (plugin.in_pool) {
                allUnique = false;
            } else {
                allShared = false;
            }
        }

        if (allShared) {
            meta.state = STATE.MINIMAL;
        } else if (allUnique) {
            meta.state = STATE.FULL;
        } else {
            meta.state = STATE.PARTIAL;
        }

        meta.updated_at = new Date().toISOString();
        this._saveSchemeMeta(name, meta);

        console.log(`  已从方案目录移除 ${removed} 个可共享资源`);
        console.log(`  方案 ${name} 已转为 ${meta.state} 状态`);
    }

    // ==================== 辅助方法 ====================

    _getRequiredJava(version) {
        // V3.5.7：改为复用 JreManager 的映射。旧实现用 parseFloat 比较，
        // parseFloat('1.8.9')=1.8 被当成 1.80 > 1.16，导致 1.8/1.9 等版本
        // 被误判为需要 Java 21，写进 scheme.yaml 的 compatibility.java 也是错的。
        try {
            if (!this._jreManagerForJava) {
                const JreManager = require('./jre_manager');
                this._jreManagerForJava = new JreManager();
            }
            return this._jreManagerForJava.getRequiredJavaVersion(version);
        } catch (e) {
            // 兜底：即使 JreManager 不可用也不能再退回 parseFloat 的老逻辑
            return '17';
        }
    }

    _isEcoIncompatible(meta) {
        // 检查核心类型/版本变更是否导致生态不兼容
        // 简单实现：核心类型或版本变更视为不兼容
        return true;
    }

    _generateDefaultFiles(schemePath, version) {
        // server.properties
        const propsPath = path.join(schemePath, 'server.properties');
        if (!fs.existsSync(propsPath)) {
            const props = this._generateDefaultProperties(version);
            fs.writeFileSync(propsPath, props, 'utf8');
        }

        // eula.txt
        const eulaPath = path.join(schemePath, 'eula.txt');
        if (!fs.existsSync(eulaPath)) {
            fs.writeFileSync(eulaPath, this._generateEula(), 'utf8');
        }

        // bukkit.yml (默认模板)
        const bukkitPath = path.join(schemePath, 'bukkit.yml');
        if (!fs.existsSync(bukkitPath)) {
            fs.writeFileSync(bukkitPath, this._generateBukkitYml(), 'utf8');
        }

        // spigot.yml (默认模板)
        const spigotPath = path.join(schemePath, 'spigot.yml');
        if (!fs.existsSync(spigotPath)) {
            fs.writeFileSync(spigotPath, this._generateSpigotYml(), 'utf8');
        }
    }

    _generateDefaultProperties(version) {
        const port = 25565;
        return `# Minecraft server properties
# Generated by wow
# Version: ${version}
# Date: ${new Date().toISOString()}

server-port=${port}
motd=A Minecraft Server
gamemode=survival
difficulty=easy
max-players=20
online-mode=true
view-distance=10
allow-flight=false
spawn-protection=16
pvp=true
enable-command-block=false
`;
    }

    _generateEula() {
        return `# By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).
# Auto-generated by wow~ (agreed by default)
eula=true
`;
    }

    _generateBukkitYml() {
        return `# Bukkit configuration
# Generated by wow
settings:
  allow-end: true
  warn-on-overload: true
  permissions-file: permissions.yml
  update-folder: update
  plugin-profiling: false
  connection-throttle: 4000
  query-plugins: true
  deprecated-verbose: default
  shutdown-message: Server closed
spawn-limits:
  monsters: 70
  animals: 10
  water-animals: 5
  water-ambient: 20
  water-underground-creature: 5
  axolotls: 5
  ambient: 15
`;
    }

    _generateSpigotYml() {
        return `# Spigot configuration
# Generated by wow
config-version: 12
settings:
  debug: false
  save-user-cache-on-stop-only: false
  bungeecord: false
  late-bind: false
  sample-count: 12
  player-shuffle: 0
  user-cache-size: 1000
  moved-wrongly-threshold: 0.0625
  moved-too-quickly-multiplier: 10.0
  timeout-time: 60
  restart-on-crash: true
  restart-script: ./wow.sh
  netty-threads: 4
  attribute:
    maxHealth:
      max: 2048.0
    movementSpeed:
      max: 2048.0
    attackDamage:
      max: 2048.0
messages:
  whitelist: You are not whitelisted on this server!
  unknown-command: Unknown command. Type "/help" for help.
  server-full: The server is full!
  outdated-client: Outdated client! Please use {0}
  outdated-server: Outdated server! I\'m still on {0}
  restart: Server is restarting
commands:
  silent-commandblock-console: false
  replace-commands:
    - setblock
    - summon
    - testforblock
    - tellraw
  tab-complete: 0
  send-namespaced: true
  log: true
  spam-exclusions:
    - /skill
`;
    }

    _installCoreFromPack(fromPack, targetDir) {
        // TODO: 从整合包安装核心
        console.log('从整合包安装核心功能待实现');
        return null;
    }
}

module.exports = SchemeManager;