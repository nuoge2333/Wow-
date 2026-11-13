'use strict';

/**
 * 插件 Web UI 挂载（实验性 / Beta）
 * ----------------------------------------------------------------
 * 插件可以在 plugin.json 里声明：
 *   { "web": "frontend" }      // 相对插件目录的前端资源目录
 *
 * 核心**不**直接拿插件目录当静态根，而是启动时复制到隔离目录：
 *
 *   wow-plugins/<插件>/            ← 插件代码（index.js 也在这，绝不能暴露）
 *     plugin.json
 *     index.js
 *     frontend/                    ← 只有这个子树会对外
 *
 *   core/plugin-web/<插件>/         ← 复制出来的静态资源，Express 只认这里
 *
 * 为什么必须复制：插件目录里同时躺着 index.js 和可能的密钥文件。
 * 直接把插件目录挂成静态根，等于把服务端代码当静态资源发出去。
 *
 * 安全边界（缺一不可）：
 *   1. 默认关闭 —— 只有 web.allow_plugins_web=true 才挂载；
 *   2. 复制时跳过符号链接（否则插件可以链到 /etc/passwd），限制深度与总大小；
 *   3. 响应头强制 CSP：frame-ancestors 'self'; connect-src 'self';
 *      —— 插件页面无法被外站 iframe 嵌套，也无法把 Token 发到第三方；
 *   4. 不新开端口，只挂在主面板同源的 /plugin-web/<插件>/ 下。
 *
 * 注意：这不是沙箱。CSP 只管网络与嵌套，插件前端仍与面板同源，
 * 能读同源 cookie/localStorage。真正隔离要靠 iframe sandbox（见 Web 前端）。
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');

/** 复制出来的静态资源根目录：<项目根>/core/plugin-web */
const DEFAULT_OUT_ROOT = path.join(__dirname, '..', 'plugin-web');

/** 单个插件前端资源的总大小上限（防误拷 node_modules） */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** 单文件上限 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 递归深度上限 */
const MAX_DEPTH = 8;

/** 插件名必须能安全地作为 URL 段与目录名 */
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * 校验 plugin.json 的 web 字段，返回规范化后的相对目录；非法/未声明返回 null。
 * @param {any} web
 * @returns {string|null}
 */
function normalizeWebField(web) {
    if (web === undefined || web === null) return null;
    if (typeof web !== 'string') return null;
    const raw = web.trim().replace(/\\/g, '/');
    if (!raw) return null;
    if (raw.startsWith('/') || raw.startsWith('//')) return null;
    if (/^[a-zA-Z]:/.test(raw)) return null;
    const segs = raw.split('/').filter(Boolean);
    if (!segs.length) return null;
    if (segs.some(s => s === '..' || s === '.')) return null;
    return segs.join('/');
}

/**
 * 递归复制目录，跳过符号链接、超限文件与过深层级。
 * @param {string} src
 * @param {string} dest
 * @param {{bytes:number, skipped:string[]}} state
 * @param {number} depth
 */
function copyTreeSafe(src, dest, state, depth = 0) {
    if (depth > MAX_DEPTH) {
        state.skipped.push(`${src}（层级过深）`);
        return;
    }
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) {
        state.skipped.push(`${src}（符号链接）`);
        return;
    }
    if (stat.isDirectory()) {
        fs.ensureDirSync(dest);
        for (const entry of fs.readdirSync(src)) {
            // 隐藏文件（.git / .env 之类）一律不发出去
            if (entry.startsWith('.')) continue;
            copyTreeSafe(path.join(src, entry), path.join(dest, entry), state, depth + 1);
        }
        return;
    }
    if (!stat.isFile()) {
        state.skipped.push(`${src}（非普通文件）`);
        return;
    }
    if (stat.size > MAX_FILE_BYTES) {
        state.skipped.push(`${src}（单文件超过 5MB）`);
        return;
    }
    state.bytes += stat.size;
    if (state.bytes > MAX_TOTAL_BYTES) {
        throw new Error(`插件前端资源超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB 上限`);
    }
    fs.copyFileSync(src, dest);
}

/**
 * 扫描插件目录，找出声明了 web 的插件。
 * @param {string} pluginsDir
 * @returns {Array<{name:string, dirName:string, srcDir:string, web:string}>}
 */
function scan(pluginsDir) {
    const dir = pluginsDir || utils.resolvePath('../wow-plugins');
    if (!fs.existsSync(dir)) return [];

    const out = [];
    for (const dirName of fs.readdirSync(dir)) {
        if (dirName.startsWith('.')) continue;
        const pluginDir = path.join(dir, dirName);
        let st;
        try { st = fs.statSync(pluginDir); } catch (e) { continue; }
        if (!st.isDirectory()) continue;

        const manifestPath = path.join(pluginDir, 'plugin.json');
        if (!fs.existsSync(manifestPath)) continue;

        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (e) {
            continue; // 坏清单交给 loader 报错，这里静默跳过
        }
        const web = normalizeWebField(meta && meta.web);
        if (!web) continue;

        const name = String((meta && meta.name) || dirName);
        if (!PLUGIN_NAME_RE.test(name)) continue; // URL 段不安全，宁可挂不上

        const srcDir = path.join(pluginDir, web.split('/').join(path.sep));
        if (!fs.existsSync(srcDir)) continue;

        out.push({ name, dirName, srcDir, web });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 把插件前端资源同步到隔离目录。
 *
 * 每次启动全量重建：插件被卸载/改名后，旧页面不会残留在 /plugin-web/ 下
 * 继续可访问（这是一个真实的信息泄露面）。
 *
 * @param {object} [options]
 * @param {string} [options.pluginsDir]
 * @param {string} [options.outRoot]
 * @param {(msg:string)=>void} [options.warn]
 * @returns {{mounted:string[], skipped:Array<{name:string,reason:string}>}}
 */
function sync(options = {}) {
    const pluginsDir = options.pluginsDir || utils.resolvePath('../wow-plugins');
    const outRoot = path.resolve(options.outRoot || DEFAULT_OUT_ROOT);
    const warn = typeof options.warn === 'function' ? options.warn : () => {};

    // 全量重建。注意 outRoot 是我们自己的目录，删掉是安全的；
    // 但万一被配成了项目根，这里兜一层。
    if (utils.isSchemesRoot(outRoot)) throw new Error('plugin-web 目录不能是 scheme 根目录');
    try { fs.removeSync(outRoot); } catch (e) { /* 尽力而为 */ }
    fs.ensureDirSync(outRoot);

    const mounted = [];
    const skipped = [];
    for (const item of scan(pluginsDir)) {
        const dest = path.join(outRoot, item.name);
        const state = { bytes: 0, skipped: [] };
        try {
            copyTreeSafe(item.srcDir, dest, state);
            if (state.skipped.length) {
                warn(`⚠️ 插件 ${item.name} 的前端资源有 ${state.skipped.length} 项被跳过（符号链接/超限/隐藏文件）`);
            }
            // 没有入口页也允许挂载：有的插件只提供静态资源，由别处 iframe 引用
            mounted.push(item.name);
        } catch (e) {
            try { fs.removeSync(dest); } catch (e2) { /* ignore */ }
            skipped.push({ name: item.name, reason: e.message });
            warn(`⚠️ 插件 ${item.name} 的 Web UI 已跳过：${e.message}`);
        }
    }
    return { mounted, skipped };
}

/**
 * 在 Express app 上挂载 /plugin-web。
 *
 * @param {import('express').Express} app
 * @param {object} options
 * @param {boolean} options.enabled 是否允许（web.allow_plugins_web）
 * @param {string} [options.pluginsDir]
 * @param {string} [options.outRoot]
 * @param {(msg:string)=>void} [options.warn]
 * @param {(msg:string)=>void} [options.info]
 * @returns {{enabled:boolean, mounted:string[], skipped:object[]}}
 */
function mount(app, options = {}) {
    const log = {
        warn: typeof options.warn === 'function' ? options.warn : (m) => console.warn(m),
        info: typeof options.info === 'function' ? options.info : (m) => console.log(m)
    };

    if (!options.enabled) {
        // 关闭时也要清掉历史产物：上一次开着时复制出去的文件可能含旧逻辑，
        // 关掉开关后继续躺在磁盘上，某天被别的路径当作静态根就会复活。
        try {
            const outRoot = path.resolve(options.outRoot || DEFAULT_OUT_ROOT);
            if (fs.existsSync(outRoot)) fs.removeSync(outRoot);
        } catch (e) { /* ignore */ }
        return { enabled: false, mounted: [], skipped: [] };
    }

    let result;
    try {
        result = sync(options);
    } catch (e) {
        log.warn(`⚠️ 插件 Web UI 初始化失败（已整体关闭）: ${e.message}`);
        return { enabled: false, mounted: [], skipped: [] };
    }

    const outRoot = path.resolve(options.outRoot || DEFAULT_OUT_ROOT);
    const express = require('express');

    // 安全响应头必须在静态中间件之前
    app.use('/plugin-web', (req, res, next) => {
        // 只允许被同源页面嵌套；插件页面自身也不能向第三方发起请求
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; connect-src 'self';");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });

    app.use('/plugin-web', express.static(outRoot, {
        index: 'index.html',
        dotfiles: 'deny',
        fallthrough: true,
        etag: true,
        maxAge: 0
    }));

    if (result.mounted.length) {
        log.info(`🔌 [实验性 / Beta] 插件 Web UI 已挂载 ${result.mounted.length} 个：` +
            result.mounted.map(n => `/plugin-web/${n}/`).join('、'));
    }
    return { enabled: true, ...result };
}

module.exports = {
    DEFAULT_OUT_ROOT,
    normalizeWebField,
    scan,
    sync,
    mount,
    _internals: { copyTreeSafe, PLUGIN_NAME_RE, MAX_TOTAL_BYTES }
};
