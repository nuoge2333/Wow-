/**
 * wow 插件管理模块（V3.5.21-26.3c 实装）
 * - 安装 / 列出 / 卸载 / 查看插件信息
 * - 插件包格式：ZIP，内含 plugin.json + index.js，解压到 <项目根>/wow-plugins/<名字>/
 *
 * 职责划分：
 *   plugin_manager.js —— 「装 / 卸 / 查」这类**文件操作**
 *   plugin_loader.js  —— 「扫 / 信任 / 注册命令」这类**运行期加载**
 *   plugin_trust.js   —— 内容指纹与信任表
 * 这样 CLI 的 `plugin list` 与 Web 的 /api/plugins 可以只依赖 manager，
 * 不会因为 require 了 loader 而顺带动 program / commander。
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');
const trust = require('./plugin_trust');

class PluginManager {
    constructor() {
        this.pluginsDir = utils.resolvePath('../wow-plugins');
        fs.ensureDirSync(this.pluginsDir);
    }

    /**
     * 安装插件（本地 ZIP 或目录）
     * - 支持 .zip 包（内含 plugin.json 与 index.js）
     * - 支持直接传目录路径（把整个目录拷进来，方便开发调试）
     * @param {string} source 本地文件 / 目录路径
     * @param {object} [options] { force: 覆盖已存在 }
     * @returns {Promise<{name:string, dir:string, version:string}>}
     */
    async install(source, options = {}) {
        if (!source) throw new Error('请提供插件包路径');
        const src = path.resolve(source);
        if (!fs.existsSync(src)) throw new Error(`插件包不存在: ${source}`);

        const stat = fs.statSync(src);
        fs.ensureDirSync(this.pluginsDir);

        if (stat.isDirectory()) {
            // 目录形态：直接校验清单后整体拷贝
            const meta = this._readManifest(path.join(src, 'plugin.json'));
            const target = path.join(this.pluginsDir, meta.name);
            if (fs.existsSync(target)) {
                if (!options.force) throw new Error(`插件 ${meta.name} 已存在（加 --force 覆盖）`);
                fs.removeSync(target);
            }
            fs.copySync(src, target);
            return { name: meta.name, dir: target, version: meta.version || '未知' };
        }

        // ZIP 形态：断言是 zip 而非重命名的 exe（window --force）
        const head = Buffer.alloc(4);
        const fd = fs.openSync(src, 'r');
        try {
            fs.readSync(fd, head, 0, 4, 0);
        } finally {
            fs.closeSync(fd);
        }
        const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"
        if (!isZip) throw new Error('插件包必须是 ZIP 格式（文件头不是 PK）');

        const AdmZip = require('adm-zip');
        const zip = new AdmZip(src);
        const tempDir = path.join(this.pluginsDir, `.temp_${Date.now()}`);
        fs.ensureDirSync(tempDir);
        try {
            zip.extractAllTo(tempDir, true);

            // 兼容「zip 里多套了一层目录」的常见情况
            let root = tempDir;
            if (!fs.existsSync(path.join(root, 'plugin.json'))) {
                const subs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
                const found = subs.find(d => fs.existsSync(path.join(root, d.name, 'plugin.json')));
                if (!found) throw new Error('插件包缺少 plugin.json');
                root = path.join(root, found.name);
            }

            const meta = this._readManifest(path.join(root, 'plugin.json'));
            const target = path.join(this.pluginsDir, meta.name);
            if (fs.existsSync(target)) {
                if (!options.force) throw new Error(`插件 ${meta.name} 已存在（加 --force 覆盖）`);
                fs.removeSync(target);
            }
            fs.moveSync(root, target);
            return { name: meta.name, dir: target, version: meta.version || '未知' };
        } finally {
            if (fs.existsSync(tempDir)) fs.removeSync(tempDir);
        }
    }

    /**
     * 读并粗校验清单（只查命令名不查结构细节，那部分归 plugin_loader）
     * @param {string} manifestPath
     */
    _readManifest(manifestPath) {
        if (!fs.existsSync(manifestPath)) throw new Error('插件包缺少 plugin.json');
        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (e) {
            throw new Error(`plugin.json 不是合法 JSON: ${e.message}`);
        }
        if (!meta || typeof meta !== 'object' || !meta.name) {
            throw new Error('plugin.json 缺少 name 字段');
        }
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(String(meta.name))) {
            throw new Error(`插件名 ${meta.name} 不合法（仅允许字母数字、- 和 _）`);
        }
        if (!Array.isArray(meta.commands) || meta.commands.length === 0) {
            throw new Error('plugin.json 的 commands 必须是非空数组');
        }
        return meta;
    }

    /**
     * 列出插件（含信任状态）
     * @returns {object[]} { name, dirName, version, author, description, commands,
     *                       trusted: 'trusted'|'new'|'changed', active }
     */
    list() {
        if (!fs.existsSync(this.pluginsDir)) return [];
        const folders = fs.readdirSync(this.pluginsDir).filter(f => {
            if (f.startsWith('.')) return false;
            const full = path.join(this.pluginsDir, f);
            return fs.statSync(full).isDirectory() &&
                   fs.existsSync(path.join(full, 'plugin.json'));
        });
        return folders.map(dirName => {
            const full = path.join(this.pluginsDir, dirName);
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(full, 'plugin.json'), 'utf8'));
                const name = meta.name || dirName;
                // 指纹算不出来（目录被占/权限）时按未信任处理，宁可多问一次
                let state = 'new';
                try {
                    state = trust.checkTrust(name, trust.fingerprint(full));
                } catch (e) { /* 保持 new */ }
                return {
                    name,
                    dirName,
                    version: meta.version || '未知',
                    author: meta.author || '未知',
                    description: meta.description || '',
                    commands: Array.isArray(meta.commands) ? meta.commands.map(c => c.name) : [],
                    // 声明了 web 字段的插件才可能在面板里以 iframe 呈现（默认关闭）
                    web: typeof meta.web === 'string' && meta.web.trim() ? meta.web.trim() : null,
                    trusted: state,
                    active: state === 'trusted'
                };
            } catch (e) {
                return {
                    name: dirName, dirName, version: '未知', author: '未知', description: '',
                    commands: [], web: null, trusted: 'new', active: false,
                    error: 'plugin.json 解析失败'
                };
            }
        });
    }

    /**
     * 卸载插件（删目录 + 撤销信任）
     * @param {string} name
     */
    remove(name) {
        const loader = require('./plugin_loader');
        const r = loader.removePlugin(name, { dir: this.pluginsDir });
        if (!r.ok) throw new Error(r.reason);
        console.log(`✅ 插件 ${name} 已卸载`);
    }

    /**
     * 查看插件详情（打印到终端并返回清单）
     * @param {string} name
     */
    info(name) {
        const dirName = this._resolveDir(name);
        const target = path.join(this.pluginsDir, dirName);
        const meta = JSON.parse(fs.readFileSync(path.join(target, 'plugin.json'), 'utf8'));

        let state = 'new';
        try {
            state = trust.checkTrust(meta.name || dirName, trust.fingerprint(target));
        } catch (e) { /* 保持 new */ }
        const stateText = { trusted: '✅ 已信任', new: '⏳ 未信任（首次加载需确认）', changed: '⚠️ 内容已变更（需重新确认）' }[state];

        console.log(`📦 插件: ${meta.name || dirName}  [实验性 / Beta]`);
        console.log(`  作者: ${meta.author || '未知'}`);
        console.log(`  版本: ${meta.version || '未知'}`);
        console.log(`  描述: ${meta.description || '(无)'}`);
        console.log(`  目录: ${dirName}`);
        console.log(`  信任: ${stateText}`);
        console.log(`  命令数: ${meta.commands?.length || 0}`);
        for (const c of (meta.commands || [])) {
            const opts = (c.options || []).map(o => o.flag).join(' ');
            console.log(`    wow ${c.name}${opts ? ' ' + opts : ''}   ${c.description || ''}`);
        }
        return meta;
    }

    /**
     * 把「插件名或目录名」统一解析为实际目录名
     * @param {string} name
     * @returns {string}
     */
    _resolveDir(name) {
        if (!name) throw new Error('请提供插件名');
        if (fs.existsSync(path.join(this.pluginsDir, name, 'plugin.json'))) return name;
        for (const f of fs.readdirSync(this.pluginsDir)) {
            const mp = path.join(this.pluginsDir, f, 'plugin.json');
            if (!fs.existsSync(mp)) continue;
            try {
                const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
                if (String(m.name) === String(name)) return f;
            } catch (e) { /* 跳过坏清单 */ }
        }
        throw new Error(`插件 ${name} 不存在`);
    }
}

module.exports = PluginManager;
