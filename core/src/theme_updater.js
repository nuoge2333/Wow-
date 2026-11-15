/**
 * 主题包更新器（V3.9.0 主题生态）
 *
 * 职责：解析 theme.json 里的 update_url → 下载新版 zip → 安全解压 → 校验 →
 *      备份 → 原子替换 → 失败自动回滚。全程「事务化」，任何一步失败都保证
 *      当前正在使用的主题包文件与 web/ 面板不受损坏（P0 防炸机红线）。
 *
 * 复用既有基础设施（不重写轮子）：
 *  - Zip Slip 防御：file_manager.extract()（逐条路径校验，返回 skipped 清单）
 *  - 目录名校验：file_manager.validateNameSegment()
 *  - 下载：axios（responseType stream + maxRedirects，等价 curl -L）
 *  - 主题应用：ThemeManager._applyTheme()
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const GIT_HOSTS = ['github.com', 'gitee.com', 'gitlab.com'];
const NETWORK_TIMEOUT_MS = 30000;
const UA = 'wow-theme-updater/1.0 (+https://github.com/)';
const REQUIRED_META_FIELDS = ['author', 'name', 'version', 'compatible', 'description'];

/** 逐段数字比较版本号，可处理 3.8.1-26.49 这类带后缀的版本；返回 1/0/-1 */
function versionParts(v) {
    return String(v == null ? '' : v).trim().replace(/^v/i, '')
        .split(/[.\-_+]/)
        .map(s => {
            const m = s.match(/^\d+/);
            return m ? parseInt(m[0], 10) : 0;
        });
}

function compareVersions(a, b) {
    const pa = versionParts(a), pb = versionParts(b);
    const len = Math.max(pa.length, pb.length, 3);
    for (let i = 0; i < len; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
}

/**
 * 兼容判断：compatible 视为「最低要求的 wow 版本」，当前版本 >= 它即兼容。
 * 兼容 >= / ^ / ~ / > 前缀；解析不出数字的按不兼容处理（保守拒绝，防白屏）。
 */
function isCompatible(compatible, currentVersion) {
    if (!compatible) return true; // 未声明则宽松放行
    const min = String(compatible).trim().replace(/^(>=|\^|~|>|=)\s*/, '').trim();
    if (!/\d/.test(min)) return false;
    return compareVersions(currentVersion, min) >= 0;
}

/**
 * 源类型智能识别（纯函数，不发网络请求，便于单测）：
 *  - 含 github/gitee/gitlab 主机 且 非 .zip 直链 → git 仓库（需后续转 API）
 *  - 其余 → 通用直链（含网盘 / 静态博客 / 直接 .zip）
 */
function parseSource(rawUrl) {
    const url = String(rawUrl == null ? '' : rawUrl).trim();
    if (!url) throw new Error('更新源为空');
    let u;
    try { u = new URL(url); } catch (e) { throw new Error(`更新源不是合法 URL: ${url}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('更新源仅支持 http/https');
    }
    const host = u.hostname.toLowerCase();
    const isZipDirect = /\.zip(\?|#|$)/i.test(url);
    const isGit = GIT_HOSTS.some(h => host === h || host.endsWith('.' + h));
    if (isGit && !isZipDirect) {
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length < 2) throw new Error(`无法从仓库地址解析 owner/repo: ${url}`);
        return {
            kind: 'git',
            host: GIT_HOSTS.find(h => host === h || host.endsWith('.' + h)),
            owner: segs[0],
            repo: segs[1].replace(/\.git$/i, ''),
            downloadUrl: null
        };
    }
    return { kind: 'direct', downloadUrl: url };
}

class ThemeUpdater {
    /**
     * @param {ThemeManager} themeManager 已构造的主题管理器（复用其 themesDir/webDir）
     * @param {object} [options] 可注入 axios（测试用）与超时
     */
    constructor(themeManager, options = {}) {
        this.tm = themeManager;
        this.themesDir = themeManager.themesDir;
        this.webDir = themeManager.webDir;
        this.axios = options.axios || require('axios');
        this.fileManager = options.fileManager || require('./file_manager');
        this.currentVersion = options.currentVersion || require('../package.json').version;
        this.timeoutMs = options.timeoutMs || NETWORK_TIMEOUT_MS;
    }

    // ───────────────────────── 网络层 ─────────────────────────

    _httpGet(url, opts = {}) {
        return this.axios.get(url, {
            timeout: this.timeoutMs,
            maxRedirects: 5,
            headers: Object.assign({
                'User-Agent': UA,
                'Accept': opts.json ? 'application/json' : '*/*'
            }, opts.headers || {}),
            responseType: opts.stream ? 'stream' : 'json',
            validateStatus: s => s >= 200 && s < 300
        });
    }

    _networkError(e) {
        const timeout = e && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message || ''));
        return new Error(timeout
            ? `请求超时（${Math.round(this.timeoutMs / 1000)}s），请检查网络或稍后重试`
            : `下载失败，请检查网络或稍后重试（${e && e.message ? e.message : e}）`);
    }

    /** 拉取 Git API 的 JSON（失败向上抛，由 _resolveGitDownloadUrl 逐个候选兜底） */
    async _getJson(url) {
        try {
            const resp = await this._httpGet(url, { json: true });
            return resp.data;
        } catch (e) {
            throw this._networkError(e);
        }
    }

    /**
     * 把 Git 仓库主页转换成「最终 zip 直链」。
     * 依次尝试：latest release（assets 里的 .zip > zipball_url）→ tags → 仓库归档直链。
     * 只产出 .zip，不用 tarball（跨平台，adm-zip 只吃 zip）。
     */
    async _resolveGitDownloadUrl(info) {
        const { host, owner, repo } = info;
        const slug = `${owner}/${repo}`;
        const candidates = [];

        // 优先取作者在 release 里放出的「打包好的主题 zip」，其次才是源码归档
        const pickZipFrom = (data) => {
            if (!data || typeof data !== 'object') return null;
            const assets = Array.isArray(data.assets) ? data.assets : [];
            const assetZip = assets.find(a => a && /\.zip(\?|$)/i.test(String(a.browser_download_url || a.url || '')));
            if (assetZip) return assetZip.browser_download_url || assetZip.url;
            if (data.zipball_url) return data.zipball_url;
            return null;
        };

        if (host === 'github.com') {
            candidates.push(async () => pickZipFrom(await this._getJson(`https://api.github.com/repos/${slug}/releases/latest`)));
            candidates.push(async () => {
                const tags = await this._getJson(`https://api.github.com/repos/${slug}/tags?per_page=5`);
                return pickZipFrom(Array.isArray(tags) ? tags[0] : null);
            });
        } else if (host === 'gitee.com') {
            candidates.push(async () => {
                const d = await this._getJson(`https://gitee.com/api/v5/repos/${slug}/releases/latest`);
                const zip = pickZipFrom(d);
                if (zip) return zip;
                const tag = d && (d.tag_name || d.tag);
                return tag ? `https://gitee.com/${slug}/repository/archive/${encodeURIComponent(tag)}.zip` : null;
            });
        } else if (host === 'gitlab.com') {
            const proj = encodeURIComponent(slug);
            candidates.push(async () => {
                const d = await this._getJson(`https://gitlab.com/api/v4/projects/${proj}/releases`);
                const latest = Array.isArray(d) ? d[0] : null;
                const tag = latest && (latest.tag_name || latest.name);
                return tag
                    ? `https://gitlab.com/${slug}/-/archive/${encodeURIComponent(tag)}/${repo}-${encodeURIComponent(tag)}.zip`
                    : `https://gitlab.com/api/v4/projects/${proj}/repository/archive.zip`;
            });
        }

        for (const attempt of candidates) {
            try {
                const url = await attempt();
                if (url) return url;
            } catch (e) {
                // 单个候选失败（404 / 限流 / 网络）继续试下一个
            }
        }

        // 最终兜底：仓库默认分支的归档 zip 直链（无需 API，跟随重定向交给 download）
        if (host === 'github.com') return `https://github.com/${slug}/archive/refs/heads/main.zip`;
        if (host === 'gitee.com') return `https://gitee.com/${slug}/repository/archive/master.zip`;
        return `https://gitlab.com/${slug}/-/archive/HEAD/${repo}-HEAD.zip`;
    }

    /** 解析 update_url → 最终可下载的 zip 直链 */
    async resolveDownloadUrl(rawUrl) {
        const info = parseSource(rawUrl);
        if (info.kind === 'direct') return info.downloadUrl;
        return this._resolveGitDownloadUrl(info);
    }

    /** 下载到 dest：stream + maxRedirects(=curl -L) + 超时；校验 PK 文件头，挡住伪装成 zip 的 HTML */
    async download(url, dest) {
        let resp;
        try {
            resp = await this._httpGet(url, { stream: true });
        } catch (e) {
            throw this._networkError(e);
        }
        fs.ensureDirSync(path.dirname(dest));
        try {
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(dest);
                resp.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
                resp.data.on('error', reject);
            });
        } catch (e) {
            fs.removeSync(dest);
            throw this._networkError(e);
        }
        const fd = fs.openSync(dest, 'r');
        const head = Buffer.alloc(2);
        try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
        if (head[0] !== 0x50 || head[1] !== 0x4b) {
            fs.removeSync(dest);
            throw new Error('下载内容不是有效的 ZIP 主题包，已保留旧版');
        }
        return dest;
    }

    // ───────────────────────── 解压 / 校验 ─────────────────────────

    /**
     * 安全解压：复用 file_manager.extract 的 Zip Slip 四道防线。
     * 它把非法条目放进 skipped（静默跳过），更新场景要求更严格——
     * 只要出现一个被跳过的条目，就整体判定为恶意包并中止。
     */
    async _safeExtract(zipAbs, destAbs, workRoot) {
        const relZip = path.relative(workRoot, zipAbs);
        const relDest = path.relative(workRoot, destAbs);
        const r = await this.fileManager.extract(relZip, relDest, workRoot);
        if (r.skipped && r.skipped.length > 0) {
            throw new Error(`主题包含非法路径条目（疑似 Zip Slip 攻击），已中止更新并保留旧版: ${r.skipped.slice(0, 3).join(', ')}`);
        }
        return destAbs;
    }

    /** 定位新包里 theme.json 所在的根（兼容「包内套一层目录」） */
    _locateRoot(unpackedDir) {
        if (fs.existsSync(path.join(unpackedDir, 'theme.json'))) return unpackedDir;
        const entries = fs.readdirSync(unpackedDir).filter(n => !n.startsWith('.'));
        for (const n of entries) {
            const sub = path.join(unpackedDir, n);
            if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, 'theme.json'))) {
                return sub;
            }
        }
        throw new Error('主题包内未找到 theme.json，已中止更新并保留旧版');
    }

    _readMeta(dir) {
        const metaPath = path.join(dir, 'theme.json');
        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (e) {
            throw new Error(`主题包 theme.json 无法解析: ${e.message}`);
        }
        for (const f of REQUIRED_META_FIELDS) {
            if (!meta[f]) throw new Error(`新版主题包缺少必需字段: ${f}`);
        }
        return meta;
    }

    // ───────────────────────── 准备阶段（只读，不碰现有主题） ─────────────────────────

    /**
     * 公共准备流程：读旧 meta → 解析源 → 下载 → 解压 → 读新 meta。
     * 此阶段绝不修改 themes/<name>/，失败可安全丢弃临时目录。
     * @returns {{oldMeta, newMeta, newRoot, workRoot, themeDir, isCurrent}}
     */
    async _prepare(name) {
        const check = this.fileManager.validateNameSegment(name);
        if (!check.ok) throw new Error(`主题名非法: ${check.reason}`);
        const themeDir = path.join(this.themesDir, name);
        const bakDir = path.join(this.themesDir, `${name}_bak`);

        // 崩溃自愈：只剩 _bak（正式目录没了）→ 上次崩在替换前，先还原旧版再让用户重跑。
        // 必须放在读取 theme.json 之前，否则会先报「主题不存在」而永远走不到自愈。
        if (!fs.existsSync(themeDir) && fs.existsSync(bakDir)) {
            fs.moveSync(bakDir, themeDir, { overwrite: true });
            throw new Error('检测到上次更新残留，已自动还原旧版；请重新执行更新');
        }
        if (!fs.existsSync(themeDir)) throw new Error(`主题 ${name} 不存在`);
        const oldMeta = this._readMeta(themeDir);
        if (!oldMeta.update_url) {
            throw new Error(`主题 ${name} 未在 theme.json 声明 update_url，无法检查更新`);
        }

        const currentTheme = this.tm.config.getConfig('web.theme', 'default');
        const isCurrent = name === currentTheme;

        // 临时工作目录放系统临时区，避免更新过程中被 theme list / Web 列表扫到
        const workRoot = path.join(os.tmpdir(), `wow_theme_update_${process.pid}_${Date.now()}`);
        fs.ensureDirSync(workRoot);
        try {
            const downloadUrl = await this.resolveDownloadUrl(oldMeta.update_url);
            const zipAbs = path.join(workRoot, 'theme.zip');
            await this.download(downloadUrl, zipAbs);
            const unpacked = path.join(workRoot, 'unpacked');
            await this._safeExtract(zipAbs, unpacked, workRoot);
            const newRoot = this._locateRoot(unpacked);
            const newMeta = this._readMeta(newRoot);
            return { oldMeta, newMeta, newRoot, workRoot, themeDir, isCurrent };
        } catch (e) {
            fs.removeSync(workRoot);
            throw e;
        }
    }

    /** 校验（身份 / 兼容 / 版本），全部在替换之前完成 */
    _verify(prepared, opts) {
        const { oldMeta, newMeta } = prepared;
        if (newMeta.name !== oldMeta.name) {
            throw new Error(`更新包身份不符：期望「${oldMeta.name}」，实际「${newMeta.name}」，已中止更新并保留旧版`);
        }
        if (!isCompatible(newMeta.compatible, this.currentVersion)) {
            throw new Error('新版主题与当前 wow 版本不兼容，已保留旧版');
        }
        if (!opts.force && compareVersions(newMeta.version, oldMeta.version) <= 0) {
            return { hasUpdate: false };
        }
        return { hasUpdate: true };
    }

    // ───────────────────────── 事务 / 回滚 ─────────────────────────

    /**
     * 事务开始：自愈上次崩溃残留 → 备份 themes/<name>/ 到 <name>_bak/
     * 同时备份 web/（当前主题时）到临时区，保证 _applyTheme 失败也能还原面板。
     */
    _beginTransaction(name, prepared) {
        const themeDir = prepared.themeDir;
        const bakDir = path.join(this.themesDir, `${name}_bak`);
        const workRoot = prepared.workRoot;

        // 残留的 _bak（正式目录也在）→ 上次成功更新的旧备份，清理即可；
        // 「只有 _bak 没有正式目录」的崩溃自愈已在 _prepare 开头处理。
        if (fs.existsSync(bakDir)) fs.removeSync(bakDir);

        if (prepared.isCurrent && fs.existsSync(this.webDir)) {
            fs.copySync(this.webDir, path.join(workRoot, 'web_bak'));
        }
        fs.moveSync(themeDir, bakDir, { overwrite: true });
        return { bakDir };
    }

    /** 失败回滚：删除新建目录 → 还原 _bak → 必要时用旧版重刷 web/ */
    _rollback(name, prepared, state) {
        const themeDir = prepared.themeDir;
        try {
            if (fs.existsSync(themeDir)) fs.removeSync(themeDir);
            if (state.bakDir && fs.existsSync(state.bakDir)) {
                fs.moveSync(state.bakDir, themeDir, { overwrite: true });
            }
            const webBak = path.join(prepared.workRoot, 'web_bak');
            if (state.applied && fs.existsSync(webBak) && fs.existsSync(themeDir)) {
                if (fs.existsSync(this.webDir)) fs.removeSync(this.webDir);
                fs.copySync(webBak, this.webDir);
            }
        } catch (e) {
            console.error(`⚠️ 回滚过程出现异常: ${e.message}（旧版备份可能位于 ${state.bakDir || '—'}）`);
        }
    }

    _cleanup(workRoot, bakDir) {
        if (bakDir) fs.removeSync(bakDir);
        fs.removeSync(workRoot);
    }

    // ───────────────────────── 对外 API ─────────────────────────

    /**
     * 仅检查：返回是否有新版本，不落盘、不修改任何主题文件。
     */
    async checkUpdate(name) {
        const prepared = await this._prepare(name);
        try {
            const v = this._verify(prepared, { force: true });
            return {
                name,
                localVersion: prepared.oldMeta.version,
                remoteVersion: prepared.newMeta.version,
                hasUpdate: compareVersions(prepared.newMeta.version, prepared.oldMeta.version) > 0,
                compatibleOk: isCompatible(prepared.newMeta.compatible, this.currentVersion),
                _verified: v
            };
        } finally {
            fs.removeSync(prepared.workRoot);
        }
    }

    /**
     * 检查并更新单个主题（事务化，失败必回滚）。
     * @returns {{name, updated:boolean, reason?:string, from?:string, to?:string}}
     */
    async update(name, opts = {}) {
        // 阶段 1：准备 + 校验（此处失败不碰任何现有文件）
        const prepared = await this._prepare(name);
        try {
            const v = this._verify(prepared, opts);
            if (!v.hasUpdate) {
                return { name, updated: false, reason: `已是最新版本（v${prepared.oldMeta.version}）` };
            }

            // 阶段 2：事务替换
            const state = { bakDir: null, applied: false };
            try {
                const begun = this._beginTransaction(name, prepared);
                state.bakDir = begun.bakDir;

                fs.moveSync(prepared.newRoot, prepared.themeDir, { overwrite: true });
                if (prepared.isCurrent) {
                    this.tm._applyTheme(name);
                    state.applied = true;
                }
            } catch (e) {
                this._rollback(name, prepared, state);
                throw e;
            }

            // 阶段 3：提交（清理备份与临时目录；清理失败不影响已成功的更新）
            try {
                this._cleanup(prepared.workRoot, state.bakDir);
            } catch (e) {
                console.warn(`⚠️ 更新已完成，但临时文件清理失败: ${e.message}`);
            }
            return {
                name,
                updated: true,
                from: prepared.oldMeta.version,
                to: prepared.newMeta.version
            };
        } finally {
            // 兜底清理（回滚 / 中止路径）
            if (fs.existsSync(prepared.workRoot)) fs.removeSync(prepared.workRoot);
        }
    }
}

module.exports = ThemeUpdater;
module.exports.parseSource = parseSource;
module.exports.compareVersions = compareVersions;
module.exports.isCompatible = isCompatible;
module.exports.NETWORK_TIMEOUT_MS = NETWORK_TIMEOUT_MS;
