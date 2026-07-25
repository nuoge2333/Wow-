/**
 * wow 插件管理模块
 * - 安装/列出/卸载/查看插件信息
 * - 插件包格式：ZIP，包含 plugin.json 和 index.js
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');
const config = require('./config');

class PluginManager {
    constructor() {
        this.pluginsDir = utils.resolvePath('../wow-plugins');
        fs.ensureDirSync(this.pluginsDir);
    }

    /**
     * 安装插件
     */
    async install(source) {
        // 类似主题包的 install，解压到 pluginsDir/{plugin_name}/
        console.log(`安装插件: ${source}`);
        // TODO: 实现下载/解压/校验 plugin.json
        console.log('⏳ 功能开发中');
    }

    /**
     * 列出插件
     */
    list() {
        if (!fs.existsSync(this.pluginsDir)) return [];
        const folders = fs.readdirSync(this.pluginsDir).filter(f => {
            const full = path.join(this.pluginsDir, f);
            return fs.statSync(full).isDirectory() &&
                   fs.existsSync(path.join(full, 'plugin.json'));
        });
        return folders.map(name => {
            const metaPath = path.join(this.pluginsDir, name, 'plugin.json');
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                return { name, ...meta, active: true };
            } catch {
                return { name, author: '未知', version: '未知', active: false };
            }
        });
    }

    remove(name) {
        const target = path.join(this.pluginsDir, name);
        if (!fs.existsSync(target)) throw new Error(`插件 ${name} 不存在`);
        fs.removeSync(target);
        console.log(`✅ 插件 ${name} 已卸载`);
    }

    info(name) {
        const target = path.join(this.pluginsDir, name);
        if (!fs.existsSync(target)) throw new Error(`插件 ${name} 不存在`);
        const metaPath = path.join(target, 'plugin.json');
        if (!fs.existsSync(metaPath)) throw new Error('缺少 plugin.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        console.log(`📦 插件: ${name}`);
        console.log(`  作者: ${meta.author}`);
        console.log(`  版本: ${meta.version}`);
        console.log(`  描述: ${meta.description}`);
        console.log(`  命令数: ${meta.commands?.length || 0}`);
        return meta;
    }
}

module.exports = PluginManager;