/**
 * 主题包管理模块（简化版，无密钥校验）
 * - 安装/列出/切换/删除主题包
 * - 每次切换时弹出警告确认
 * - 主题包格式：ZIP 压缩包，必须包含 theme.json
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');
const config = require('./config');

class ThemeManager {
    constructor() {
        this.themesDir = utils.resolvePath('../themes');
        this.webDir = utils.resolvePath('../web');
        this.config = config;
    }

    /**
     * 安装主题包
     */
    async install(sourcePath, existingRl) {
        const tempDir = path.join(this.themesDir, '.temp_' + Date.now());
        fs.ensureDirSync(tempDir);

        try {
            console.log(`📦 安装主题包: ${sourcePath}`);

            // 解压到临时目录
            await this._extractZip(sourcePath, tempDir);

            // 读取主题元数据
            const metaPath = path.join(tempDir, 'theme.json');
            if (!fs.existsSync(metaPath)) {
                throw new Error('主题包缺少 theme.json 文件');
            }
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

            // 验证必需字段
            this._validateThemeMeta(meta);

            // 安装主题
            const themeName = meta.name || path.basename(sourcePath, '.zip');
            const installPath = path.join(this.themesDir, themeName);
            
            if (fs.existsSync(installPath)) {
                const overwrite = await this._askConfirm(`主题 ${themeName} 已存在，是否覆盖？ (y/N): `, existingRl);
                if (overwrite.toLowerCase() !== 'y') {
                    console.log('安装已取消');
                    fs.removeSync(tempDir);
                    return null;
                }
                fs.removeSync(installPath);
            }

            fs.copySync(tempDir, installPath);
            fs.removeSync(tempDir);

            console.log(`✅ 主题包安装完成: ${themeName}`);
            console.log(`  作者: ${meta.author}`);
            console.log(`  版本: ${meta.version}`);
            console.log(`  兼容: wow ${meta.compatible}`);

            return meta;

        } catch (e) {
            fs.removeSync(tempDir);
            throw e;
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
     * 验证主题元数据
     */
    _validateThemeMeta(meta) {
        const required = ['author', 'name', 'version', 'compatible', 'description'];
        for (const field of required) {
            if (!meta[field]) {
                throw new Error(`主题包缺少必需字段: ${field}`);
            }
        }

        // 检查兼容版本（仅警告，不阻断）
        const currentVersion = '3.0.0';
        if (meta.compatible !== currentVersion) {
            console.warn(`⚠️ 主题包兼容版本 ${meta.compatible}，当前 wow 版本 ${currentVersion}`);
            console.warn('继续安装可能导致问题');
        }
    }

    /**
     * 询问确认
     */
    _askConfirm(prompt, existingRl) {
        // existingRl 由调用方（交互菜单）复用同一 readline 接口传入，
        // 避免与主菜单的 readline 同时挂在同一 process.stdin 导致输入被读两次。
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
     * 列出已安装的主题
     */
    list() {
        if (!fs.existsSync(this.themesDir)) {
            console.log('没有主题包');
            return [];
        }

        const themes = fs.readdirSync(this.themesDir);
        const result = [];
        const currentTheme = config.getConfig('web.theme', 'default');

        for (const name of themes) {
            const themePath = path.join(this.themesDir, name);
            if (fs.statSync(themePath).isDirectory()) {
                const metaPath = path.join(themePath, 'theme.json');
                let meta = null;
                try {
                    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                } catch (e) {
                    // 无元数据
                }
                result.push({
                    name,
                    active: name === currentTheme,
                    author: meta?.author || '未知',
                    version: meta?.version || '未知',
                    description: meta?.description || '无描述',
                    has_meta: !!meta
                });
            }
        }

        return result;
    }

    /**
     * 切换主题（带警告）
     */
    async switch(name, existingRl) {
        const themePath = path.join(this.themesDir, name);
        if (!fs.existsSync(themePath)) {
            throw new Error(`主题 ${name} 不存在`);
        }

        // 每次切换都弹出警告
        console.warn('⚠️ =================== 安全警告 ===================');
        console.warn('⚠️ 您正在切换主题包！');
        console.warn('⚠️ 主题包由第三方提供，可能包含恶意代码。');
        console.warn('⚠️ 请确保您信任此主题包的来源。');
        console.warn('⚠️ =================================================');
        
        const confirm = await this._askConfirm('是否继续切换主题？ (y/N): ', existingRl);
        if (confirm.toLowerCase() !== 'y') {
            console.log('切换已取消');
            return;
        }

        // 验证主题完整性
        const metaPath = path.join(themePath, 'theme.json');
        if (!fs.existsSync(metaPath)) {
            console.warn('警告: 主题缺少 theme.json，可能不完整');
        } else {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            console.log(`切换主题: ${meta.name || name}`);
            console.log(`  作者: ${meta.author || '未知'}`);
            console.log(`  版本: ${meta.version || '未知'}`);
        }

        // 更新配置
        config.setConfig('web.theme', name);
        console.log(`✅ 主题已切换: ${name}`);

        // 复制到 web/ 目录
        this._applyTheme(name);
    }

    /**
     * 应用主题到 web/ 目录
     */
    _applyTheme(name) {
        const themePath = path.join(this.themesDir, name);
        const webPath = this.webDir;

        if (fs.existsSync(webPath)) {
            fs.removeSync(webPath);
        }
        fs.ensureDirSync(webPath);
        fs.copySync(themePath, webPath);
        console.log(`主题 ${name} 已应用到 Web 服务`);
    }

    /**
     * 删除主题
     */
    delete(name) {
        const currentTheme = config.getConfig('web.theme', 'default');
        if (name === currentTheme) {
            console.log(`当前主题 ${name} 正在使用，请先切换`);
            return;
        }

        const themePath = path.join(this.themesDir, name);
        if (!fs.existsSync(themePath)) {
            console.log(`主题 ${name} 不存在`);
            return;
        }

        fs.removeSync(themePath);
        console.log(`主题 ${name} 已删除`);
    }

    /**
     * 获取主题信息
     */
    getInfo(name) {
        const themePath = path.join(this.themesDir, name);
        if (!fs.existsSync(themePath)) {
            throw new Error(`主题 ${name} 不存在`);
        }

        const metaPath = path.join(themePath, 'theme.json');
        let meta = {};
        try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (e) {
            // 无元数据
        }

        return {
            name,
            path: themePath,
            author: meta.author || '未知',
            version: meta.version || '未知',
            compatible: meta.compatible || '未知',
            description: meta.description || '无描述'
        };
    }
}

module.exports = ThemeManager;