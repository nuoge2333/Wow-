/**
 * 内容安装器（V3.8.0，P0 下载中心）
 *
 * 把「模组 / Minecraft 服务端插件」安装进**指定方案**的目录：
 *   - kind = 'mods'    → scheme/<scheme>/mods/
 *   - kind = 'plugins' → scheme/<scheme>/plugins/
 *
 * 与旧的 `down -o pool/mods`（落共享池、无选方案、依赖按钮形同虚设）不同：
 *   - 必须显式指定 targetScheme（铁律：不得默认塞当前方案）；
 *   - 可选 autoResolve：走 dep_resolver 递归拉「必需依赖」（Modrinth 完整、CF 尽力而为）；
 *   - 每个文件都走 **stream 下载**（复用 ModManager 的 axios stream 写法），带进度回调。
 *
 * 数据源：
 *   - Modrinth（默认）：解析 + 递归依赖完整；
 *   - CurseForge：作为次选，尽力而为。
 */

const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

const SchemeManager = require('./scheme_manager');
const depResolver = require('./dep_resolver');
const ModSearch = require('./mod_search');
const cf = require('./cf_client');

/**
 * 安装到方案
 * @param {Object} arg
 * @param {string} arg.source       modrinth | curseforge（默认 modrinth）
 * @param {string} arg.project      项目 id 或 slug
 * @param {string} arg.targetScheme 目标方案名（必填）
 * @param {string} arg.kind         'mods' | 'plugins'
 * @param {boolean} [arg.autoResolve=false] 是否自动解析依赖
 * @param {string} [arg.loader]     加载器 / 插件加载器
 * @param {string} [arg.mcVersion]  MC 版本
 * @param {function} [arg.onProgress] 进度回调 ({ url, received, total })
 * @param {Object} [arg.schemeManager] 可注入的 SchemeManager 实例（测试用；默认自建）
 * @returns {Promise<{ok, installed, skipped, warnings}>}
 */
async function installToScheme(arg) {
    const source = (arg.source || 'modrinth').toLowerCase();
    const project = String(arg.project || '').trim();
    const targetScheme = String(arg.targetScheme || '').trim();
    const kind = arg.kind;
    const autoResolve = arg.autoResolve === true;
    const loader = arg.loader;
    const mcVersion = arg.mcVersion;
    const onProgress = arg.onProgress;

    if (!targetScheme) {
        throw new Error('必须指定目标方案（targetScheme）——下载中心禁止默认塞入当前方案');
    }
    if (kind !== 'mods' && kind !== 'plugins') {
        throw new Error(`kind 只能是 mods 或 plugins，收到：${kind}`);
    }
    if (!project) {
        throw new Error('缺少 project（项目 id 或 slug）');
    }

    const sm = arg.schemeManager || new SchemeManager();
    if (!sm._schemeExists(targetScheme)) {
        throw new Error(`方案「${targetScheme}」不存在，无法安装内容`);
    }
    const schemePath = sm._getSchemePath(targetScheme);
    const destDir = path.join(schemePath, kind);
    fs.ensureDirSync(destDir);

    // 构建下载清单
    let items = [];
    let warnings = [];
    if (autoResolve) {
        const r = await depResolver.resolve({ source, projectId: project, loader, mcVersion });
        items = r.items || [];
        warnings = r.warnings || [];
    } else {
        const f = await resolveSingleFile({ source, project, loader, mcVersion });
        if (!f || !f.fileUrl) {
            throw new Error(`在 (${loader || '-'}/${mcVersion || '-'}) 下未找到 ${project} 的可下载文件`);
        }
        items = [{ projectId: project, source, fileUrl: f.fileUrl, filename: f.filename, loader, mcVersion, depth: 0 }];
    }

    const installed = [];
    const skipped = [];
    for (const it of items) {
        const fname = it.filename || path.basename(new URL(it.fileUrl).pathname);
        const dest = path.join(destDir, fname);
        try {
            await streamDownload(it.fileUrl, dest, onProgress);
            installed.push({ projectId: it.projectId, filename: fname, depth: it.depth });
        } catch (e) {
            skipped.push({ projectId: it.projectId, error: e.message });
            warnings.push(`下载失败 ${it.projectId}（${fname}）：${e.message}`);
        }
    }

    return {
        ok: skipped.length === 0,
        installed,
        skipped,
        warnings
    };
}

/**
 * 单文件模式：仅取项目在 (loader, mcVersion) 下的最新兼容文件。
 */
async function resolveSingleFile({ source, project, loader, mcVersion }) {
    if (source === 'curseforge' || source === 'cf') {
        try {
            const r = await cf.getProject(project);
            const m = r.data || {};
            const files = m.latestFiles || [];
            const file = mcVersion
                ? (files.find(f => (f.gameVersions || []).includes(mcVersion)) || files[0])
                : files[0];
            if (!file || !file.downloadUrl) return null;
            return { fileUrl: file.downloadUrl, filename: file.fileName };
        } catch (e) {
            return null;
        }
    }
    // Modrinth
    let v;
    try {
        v = await ModSearch.pickModrinthVersion(project, loader, mcVersion);
    } catch (e) {
        return null;
    }
    if (!v || !v.url) return null;
    return { fileUrl: v.url, filename: v.filename };
}

/**
 * stream 下载到本地（铁律③精神：流式落盘，不整文件读内存）
 */
function streamDownload(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        fs.ensureDirSync(path.dirname(destPath));
        axios.get(url, {
            responseType: 'stream',
            timeout: 120000,
            maxRedirects: 5
        }).then(resp => {
            const total = parseInt((resp.headers && resp.headers['content-length']) || '0', 10);
            const writer = fs.createWriteStream(destPath);
            if (onProgress && total > 0) {
                let got = 0;
                resp.data.on('data', chunk => {
                    got += chunk.length;
                    onProgress({ url, received: got, total });
                });
            }
            resp.data.pipe(writer);
            writer.on('finish', () => resolve(destPath));
            writer.on('error', e => reject(e));
            resp.data.on('error', e => reject(e));
        }).catch(e => reject(e));
    });
}

module.exports = { installToScheme, resolveSingleFile, streamDownload };
