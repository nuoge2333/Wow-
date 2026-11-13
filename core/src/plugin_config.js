'use strict';

/**
 * 插件配置持久化（plugin-config）
 * ----------------------------------------------------------------
 * 物理布局（与插件代码物理隔离，插件目录被整体删除也不丢配置）：
 *
 *   core/plugin-config/
 *     <插件名>/
 *       config.json          当前配置（默认值 + 用户改动合并后的结果）
 *       config.json.tmp-*    写入中间态（rename 成功后即消失）
 *
 * 三条硬约束：
 *
 *  1. **路径不许穿越**。插件名是外部输入（plugin.json 的 name / 目录名），
 *     `../../src/cli` 这种值若直接拼进路径，就能让「写配置」变成「改主程序源码」。
 *     这里用 safeResolve 双层校验：名字必须单段，解析结果必须仍在根目录内。
 *
 *  2. **写入必须原子**。先写同目录临时文件、fsync、再 rename 覆盖。
 *     rename 在同一文件系统内是原子的：要么是旧内容，要么是新内容，
 *     不会出现「写了一半的 JSON」——断电时尤其重要。
 *
 *  3. **坏文件不许拖垮插件**。config.json 被手改成非法 JSON 时，
 *     备份成 config.json.corrupt-<时间戳> 并退回默认值，
 *     而不是让插件在启动时直接抛异常。
 *
 * 注意：插件与主程序同进程同权限，本模块防的是**误用与路径穿越**，
 * 不是恶意代码（恶意代码可以直接 require('fs') 删库，见 plugin_context.js）。
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');

/** 默认根目录：<项目根>/core/plugin-config */
const DEFAULT_ROOT = path.join(__dirname, '..', 'plugin-config');

/** 配置文件名 */
const CONFIG_FILENAME = 'config.json';

/** 不允许出现在配置键里的段（原型污染 / 越界） */
const FORBIDDEN_KEY_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * 把一个外部输入的名字转成安全单段。
 * 与方案名规则一致：非空、非 . / ..、无分隔符、无盘符、无首尾空白。
 * @param {string} name
 * @returns {string}
 */
function assertSafeName(name) {
    const raw = String(name == null ? '' : name);
    if (!utils.isSafeSchemeName(raw)) {
        throw new Error(`插件名「${raw}」不合法：必须是不含路径分隔符的单段名称`);
    }
    return raw.trim();
}

/**
 * 安全拼接：确保结果严格位于 root 之内。
 * @param {string} root 绝对根目录
 * @param {string} rel 相对路径
 * @returns {string} 绝对路径
 */
function safeResolve(root, rel) {
    const base = path.resolve(root);
    const abs = path.resolve(base, String(rel));
    const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (abs !== base && !abs.startsWith(baseWithSep)) {
        throw new Error(`路径越界：${rel} 不在 ${base} 之内`);
    }
    return abs;
}

/**
 * 把 'a.b.c' 拆成安全段数组。
 * @param {string} key
 * @returns {string[]}
 */
function splitKey(key) {
    const parts = String(key == null ? '' : key).split('.');
    for (const p of parts) {
        if (!p) throw new Error(`配置键「${key}」含空段`);
        if (FORBIDDEN_KEY_SEGMENTS.has(p)) {
            throw new Error(`配置键「${key}」含保留标识符 ${p}`);
        }
    }
    return parts;
}

/** 深合并：对象递归，数组/标量直接覆盖 */
function deepMerge(base, override) {
    if (Array.isArray(base) || Array.isArray(override)) return override;
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObj(base) || !isObj(override)) return override;
    const out = { ...base };
    for (const [k, v] of Object.entries(override)) {
        if (FORBIDDEN_KEY_SEGMENTS.has(k)) continue;
        out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
}

/** 只保留可 JSON 序列化的值，顺便剥掉 __proto__ */
function sanitize(value, depth = 0) {
    if (depth > 20) return null;
    if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (FORBIDDEN_KEY_SEGMENTS.has(k)) continue;
            out[k] = sanitize(v, depth + 1);
        }
        return out;
    }
    return undefined; // function / symbol / undefined 落不下来
}

class PluginConfig {
    /**
     * @param {object} options
     * @param {string} options.pluginName 插件名（必须与 manifest 的 name 一致）
     * @param {object} [options.defaults] plugin.json 里声明的 config 默认值
     * @param {string} [options.root] 配置根目录（测试用）
     */
    constructor(options = {}) {
        this.pluginName = assertSafeName(options.pluginName);
        this.root = path.resolve(options.root || DEFAULT_ROOT);
        this.defaults = sanitize(options.defaults) || {};

        // 目录与文件路径在这里就定死并校验，后续任何读写都不会再碰外部输入
        this.dir = safeResolve(this.root, this.pluginName);
        this.file = safeResolve(this.root, path.join(this.pluginName, CONFIG_FILENAME));

        // 同进程内串行化写入，避免两次 set 交叉导致后写覆盖先写
        this._writeChain = Promise.resolve();
    }

    /** 配置是否已落盘 */
    exists() {
        return fs.existsSync(this.file);
    }

    /**
     * 读磁盘上的原始对象；文件不存在 / 损坏时返回 null 或默认值。
     * 损坏文件会被备份，不会静默丢弃用户数据。
     * @private
     */
    _readDisk() {
        if (!fs.existsSync(this.file)) return null;
        let text;
        try {
            text = fs.readFileSync(this.file, 'utf8');
        } catch (e) {
            return null;
        }
        if (!text.trim()) return null;
        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('顶层不是 JSON 对象');
            }
            return sanitize(parsed);
        } catch (e) {
            // 备份坏文件：用户可能手改过，直接覆盖等于毁掉线索
            const backup = `${this.file}.corrupt-${Date.now()}`;
            try { fs.copyFileSync(this.file, backup); } catch (e2) { /* 备份失败不影响主流程 */ }
            return null;
        }
    }

    /**
     * 当前生效配置（默认值 ← 磁盘值）。
     * @returns {object}
     */
    all() {
        const disk = this._readDisk();
        return disk ? deepMerge(this.defaults, disk) : { ...this.defaults };
    }

    /**
     * 读取单个键，支持 'a.b.c'。
     * @param {string} key
     * @param {*} [fallback]
     */
    get(key, fallback = undefined) {
        const parts = splitKey(key);
        let cur = this.all();
        for (const p of parts) {
            if (cur == null || typeof cur !== 'object') return fallback;
            cur = cur[p];
        }
        return cur === undefined ? fallback : cur;
    }

    /**
     * 初始化：把默认值落盘（不覆盖已有用户值）。
     * @returns {object} 生效配置
     */
    ensure() {
        const current = this.all();
        if (!this.exists()) this._writeSync(current);
        return current;
    }

    /**
     * 写单个键（支持 'a.b.c'）。
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        const parts = splitKey(key);
        const next = this.all();
        let cur = next;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!cur[p] || typeof cur[p] !== 'object' || Array.isArray(cur[p])) cur[p] = {};
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = sanitize(value);
        return this._enqueueWrite(next);
    }

    /**
     * 整体替换（仍然会保留默认值里的键，避免插件升级后丢默认项）。
     * @param {object} patch
     */
    merge(patch) {
        const safePatch = sanitize(patch);
        if (!safePatch || typeof safePatch !== 'object') {
            throw new Error('merge 需要 JSON 对象');
        }
        return this._enqueueWrite(deepMerge(this.all(), safePatch));
    }

    /** 恢复默认值（删除磁盘文件） */
    reset() {
        return this._enqueueWrite(sanitize(this.defaults) || {}, true);
    }

    /**
     * 串行写队列：同一插件的多次写按调用顺序落地。
     * @private
     */
    _enqueueWrite(data, removeFirst = false) {
        this._writeChain = this._writeChain
            .catch(() => {}) // 上一次失败不阻塞下一次
            .then(() => {
                if (removeFirst && fs.existsSync(this.file)) fs.removeSync(this.file);
                this._writeSync(data);
                return this.all();
            });
        return this._writeChain;
    }

    /**
     * 原子写：临时文件 → fsync → rename。
     * @private
     */
    _writeSync(data) {
        fs.ensureDirSync(this.dir);

        // 最后一道防线：即便调用方传进来的对象里塞了 __proto__，也不会落盘
        const json = JSON.stringify(sanitize(data) || {}, null, 2) + '\n';
        const tmp = safeResolve(this.root, path.join(
            this.pluginName,
            `${CONFIG_FILENAME}.tmp-${process.pid}-${Date.now()}`
        ));

        let fd;
        try {
            fd = fs.openSync(tmp, 'w');
            fs.writeFileSync(fd, json, 'utf8');
            // fsync：确保 rename 之前内容已经落到磁盘，断电不会留下空文件
            try { fs.fsyncSync(fd); } catch (e) { /* 某些文件系统不支持，忽略 */ }
            fs.closeSync(fd);
            fd = null;
            fs.renameSync(tmp, this.file);
        } catch (e) {
            if (fd !== null && fd !== undefined) {
                try { fs.closeSync(fd); } catch (e2) { /* ignore */ }
            }
            try { if (fs.existsSync(tmp)) fs.removeSync(tmp); } catch (e2) { /* ignore */ }
            throw new Error(`写入插件配置失败（${this.pluginName}）：${e.message}`);
        }
    }

    /**
     * 列出所有已有配置的插件名。
     * @returns {string[]}
     */
    static list(root) {
        const base = path.resolve(root || DEFAULT_ROOT);
        if (!fs.existsSync(base)) return [];
        return fs.readdirSync(base, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'))
            .filter(d => fs.existsSync(path.join(base, d.name, CONFIG_FILENAME)))
            .map(d => d.name)
            .sort();
    }
}

module.exports = PluginConfig;
module.exports.PluginConfig = PluginConfig;
module.exports.DEFAULT_ROOT = DEFAULT_ROOT;
module.exports.CONFIG_FILENAME = CONFIG_FILENAME;
module.exports._internals = { safeResolve, splitKey, deepMerge, sanitize, assertSafeName };
