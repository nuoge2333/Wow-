/**
 * CurseForge 请求层（V3.5.25）
 * ----------------------------------------------------------------
 * 一句话：**这三层不是备选方案，而是按顺序试，哪层能用就用哪层。**
 *
 *   第一层  公共代理（cfproxy 等）  —— 可配 proxy_url，默认关闭
 *   第二层  BYOK 直连               —— 自己的 api_key 打官方 API
 *   第三层  本地磁盘缓存            —— 过期的也给，只提示可能不新
 *
 * 为什么要做这个层：
 *   CurseForge 的 API 必须带 x-api-key。没有 Key 的用户以前直接就用不了。
 *   社区里有人做了 cfproxy 这种「帮你补 Key 的代理」，但公共实例极不稳定
 *   （bmpm-mc/cfproxy 的公共实例 cfproxy.fly.dev 已于 2022 年后停服，实测 DNS 无法解析），
 *   所以第一层默认关闭，只作为「用户自建后填地址」的入口。
 *
 * 降级判定：
 *   - 超时 / 429 / 5xx / 连接失败  → 降级到下一层
 *   - 401 / 403（Key 无效）/ 404   → **不降级**，这是明确答复，换了也一样
 *
 * 缓存策略：
 *   只缓存「按 projectID+fileID 查直链」与「按 projectID 查项目」这类确定性结果。
 *   搜索是关键词查询，结果随时间变化，缓存 24h 会让用户搜不到新模组，故不缓存。
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const utils = require('./utils');

// 官方 base 不含 /v1：与 cfproxy README 的替换语义保持一致
// （「把 https://api.curseforge.com 换成代理地址，path 原样转发」），
// /v1 由 buildUrl 统一补齐，见其注释。
const CF_OFFICIAL = 'https://api.curseforge.com';
const MINECRAFT_GAME_ID = 432;

// V3.5.22 沿用：请求超时 5 秒（需求指定）。代理/直连都按这个值。
const REQUEST_TIMEOUT = 5000;

// 缓存有效期 24 小时
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_DIR = utils.resolvePath('cache/cf_mods');

// 仅在进程内提示一次，避免刷屏
let warnedNoKey = false;
let warnedStaleCache = false;

// ==================== 配置读取 ====================

/**
 * 代理地址。空字符串 = 不走代理（默认）。
 * 兼容用户填 https://xxx/v1 或 https://xxx 两种写法。
 */
function getProxyUrl() {
    const raw = config.getConfig('curseforge.proxy_url', '');
    const s = raw ? String(raw).trim() : '';
    if (!s) return '';
    return s.replace(/\/+$/, '');
}

/**
 * BYOK 的 Key。兼容历史键名（api_keys.curseforge / download.curseforge_key）。
 */
function getApiKey() {
    const k = config.getConfig('curseforge.api_key', '')
        || config.getConfig('api_keys.curseforge', '')
        || config.getConfig('download.curseforge_key', '');
    return k ? String(k).trim() : '';
}

function proxyEnabled() {
    return !!getProxyUrl();
}

// ==================== 缓存 ====================

function cacheKey(scope, ...parts) {
    // 文件名只保留安全字符，避免 projectID 里混进路径分隔符
    const safe = parts.map(p => String(p).replace(/[^a-zA-Z0-9_.-]/g, '_')).join('_');
    return `${scope}_${safe}.json`;
}

function cachePath(scope, ...parts) {
    return path.join(CACHE_DIR, cacheKey(scope, ...parts));
}

function readCache(scope, parts) {
    const file = cachePath(scope, ...parts);
    try {
        if (!fs.existsSync(file)) return null;
        const raw = fs.readFileSync(file, 'utf8');
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object' || !('data' in obj)) return null;
        const age = Date.now() - (obj.cached_at || 0);
        return {
            data: obj.data,
            cached_at: obj.cached_at || 0,
            age,
            fresh: age < CACHE_TTL_MS
        };
    } catch (e) {
        // 缓存坏了就当没有，不要让缓存问题阻断主流程
        return null;
    }
}

function writeCache(scope, parts, data) {
    try {
        fs.ensureDirSync(CACHE_DIR);
        const file = cachePath(scope, ...parts);
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ cached_at: Date.now(), data }, null, 2), 'utf8');
        fs.renameSync(tmp, file);   // 原子替换，避免写一半被读到
    } catch (e) {
        // 缓存写入失败不影响返回结果
    }
}

/** 清空缓存（供 CLI 与测试使用） */
function clearCache() {
    try {
        if (fs.existsSync(CACHE_DIR)) {
            for (const f of fs.readdirSync(CACHE_DIR)) {
                if (f.endsWith('.json') || f.endsWith('.tmp')) {
                    fs.removeSync(path.join(CACHE_DIR, f));
                }
            }
        }
        return true;
    } catch (e) {
        return false;
    }
}

/** 缓存统计（供 `wow cf cache` 之类的命令展示） */
function cacheStats() {
    const out = { dir: CACHE_DIR, count: 0, fresh: 0, stale: 0, bytes: 0 };
    try {
        if (!fs.existsSync(CACHE_DIR)) return out;
        for (const f of fs.readdirSync(CACHE_DIR)) {
            if (!f.endsWith('.json')) continue;
            const full = path.join(CACHE_DIR, f);
            try {
                const st = fs.statSync(full);
                out.count++;
                out.bytes += st.size;
                const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
                if (Date.now() - (obj.cached_at || 0) < CACHE_TTL_MS) out.fresh++;
                else out.stale++;
            } catch (e) { /* 单个文件坏了跳过 */ }
        }
    } catch (e) { /* 目录读不了就当空 */ }
    return out;
}

function humanAge(ms) {
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} 分钟`;
    if (h < 24) return `${h} 小时`;
    return `${Math.floor(h / 24)} 天`;
}

// ==================== 错误分类 ====================

/**
 * 判断一次失败是否「值得换下一层再试」。
 *
 * 注意各层语义不同，不能一刀切（这是真正踩过的坑）：
 *
 *   代理层的 403 —— 代理拒了你（代理自己持有 Key，403 说明它不想给你服务）。
 *                   换直连也没用（除非你有 Key），但**仍应尝试缓存**。
 *   直连层的 403 —— 你的 Key 无效或没配。官方 API 对「无 Key」和「错 Key」
 *                   都返回 403 且响应体为空（实测），没法区分，也不需要区分：
 *                   两者都意味着直连这条路走不通，但**缓存仍然应该兜底**。
 *   404       —— 资源确实不存在，任何层都一样，且缓存里也不会有一条「不存在的记录」，
 *                 直接抛。
 *   429/5xx/超时/网络错误 —— 环境问题，换层有意义。
 *
 * 所以区分成三档：
 *   'next-layer'  换下一层
 *   'cache-only'  不换层，但允许读缓存兜底
 *   'fail'        直接失败
 */
function classifyError(e, layer) {
    if (e && e.cfNoFallback) return 'fail';
    const status = e && e.response && e.response.status;

    if (status === 404) return 'fail';          // 资源不存在，换层与缓存都无意义
    if (status === 403 || status === 401) {
        // 直连层：Key 有问题，但仍可用旧缓存
        if (layer === 'byok') return 'cache-only';
        // 代理层：代理拒绝服务，继续试直连；直连不行再落到缓存
        return 'next-layer';
    }
    return 'next-layer';    // 429 / 5xx / 超时 / ENOTFOUND / ECONNREFUSED
}

/** 兼容旧接口：是否可降级（含 cache-only 与 next-layer） */
function isRetryableError(e) {
    return classifyError(e, 'byok') !== 'fail';
}

function cfError(msg, extra) {
    const e = new Error(msg);
    e.cfError = true;
    if (extra) Object.assign(e, extra);
    return e;
}

function describeError(e) {
    const status = e && e.response && e.response.status;
    if (status === 429) return '公共代理限流（429）';
    if (status === 401 || status === 403) return '接口拒绝访问（Key 无效或无权限）';
    if (status === 404) return '资源不存在';
    if (status) return `HTTP ${status}`;
    if (e && (e.code === 'ECONNABORTED' || /timeout/i.test(e.message || ''))) return '请求超时';
    if (e && (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN')) return '无法解析域名';
    if (e && e.code === 'ECONNREFUSED') return '连接被拒绝';
    return (e && e.message) || '未知错误';
}

// ==================== 单层请求 ====================

/**
 * 向某一层发一次 GET。
 *
 * ⚠️ Path 的写法有一个容易踩的坑：
 *   cfproxy 的语义是「把 base URL `https://api.curseforge.com` 换成代理地址，
 *   **path 原样转发**」（见其 README）。所以传进来的 apiPath 必须**自带 /v1**，
 *   即 `/v1/mods/search`。这样：
 *     直连 → https://api.curseforge.com + /v1/mods/search   ✓
 *     代理 → http://127.0.0.1:3000   + /v1/mods/search   ✓（代理原样转发）
 *
 *   如果写成 /mods/search（不含 /v1），直连会 404，代理会把它转发成
 *   /mods/search 同样 404。这里统一由 buildUrl 兜底：无论 base 是官方还是代理，
 *   都把 path 规范成恰好一个 /v1 前缀。
 *
 * @param {string} baseUrl  该层的 base（官方或代理，可能带了 /v1 也可能没带）
 * @param {string} apiPath  形如 /v1/mods/search
 * @param {object} opts     { params, headers, apiKey }
 */
function buildUrl(baseUrl, apiPath) {
    const base = String(baseUrl).replace(/\/+$/, '');
    // 去掉 base 末尾已有的 /v1，避免拼成 /v1/v1/...
    const bareBase = base.replace(/\/v1$/i, '');
    // path 保证以 /v1/ 开头
    const p = String(apiPath || '');
    const withV1 = /^\/v1(\/|$)/i.test(p) ? p : `/v1${p.startsWith('/') ? '' : '/'}${p}`;
    return bareBase + withV1;
}

async function rawGet(baseUrl, apiPath, opts = {}) {
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (opts.apiKey) headers['x-api-key'] = opts.apiKey;

    const resp = await axios.get(buildUrl(baseUrl, apiPath), {
        params: opts.params || {},
        headers,
        timeout: REQUEST_TIMEOUT,
        validateStatus: null,     // 自己判断状态码，不让 axios 提前抛
        maxRedirects: 3
    });

    if (resp.status >= 200 && resp.status < 300) return resp.data;

    // 非 2xx 构造带状态码的错误，交给上层判断是否降级
    const err = cfError(`HTTP ${resp.status}`, { response: { status: resp.status, data: resp.data } });
    throw err;
}

// ==================== 三层矩阵核心 ====================

/**
 * 按「代理 → BYOK → 缓存」顺序取数据。
 *
 * @param {string} apiPath        形如 '/mods/search'（buildUrl 会补 /v1）
 * @param {object} opts
 *   - params    查询参数
 *   - cacheScope  缓存作用域（如 'file' / 'project'），不传则不缓存
 *   - cacheParts  缓存键组成部分（如 [projectId, fileId]）
 *   - noCache     强制跳过缓存读取
 *   - silent      不打印降级提示（供批量场景自行汇总）
 * @returns {{ data:any, via:'proxy'|'byok'|'cache'|'cache-stale', stale:boolean }}
 */
async function cfGet(apiPath, opts = {}) {
    const params = opts.params || {};
    const scope = opts.cacheScope || null;
    const parts = opts.cacheParts || [];
    const silent = !!opts.silent;

    // ---- 先看缓存（新鲜命中 ⇒ 0 次网络请求） ----
    if (scope && !opts.noCache) {
        const c = readCache(scope, parts);
        if (c && c.fresh) {
            return { data: c.data, via: 'cache', stale: false };
        }
    }

    const errors = [];

    // ---- 第一层：公共代理 ----
    const proxy = getProxyUrl();
    if (proxy) {
        try {
            const data = await rawGet(proxy, apiPath, { params });
            if (scope) writeCache(scope, parts, data);
            return { data, via: 'proxy', stale: false };
        } catch (e) {
            errors.push(`代理: ${describeError(e)}`);
            const verdict = classifyError(e, 'proxy');
            if (verdict === 'fail') {
                throw cfError(`CurseForge ${describeError(e)}`, { cfNoFallback: true });
            }
            if (!silent) {
                console.log(`  ⚠️  [CF] 公共代理不可用（${describeError(e)}），尝试直连…`);
            }
        }
    }

    // ---- 第二层：BYOK 直连 ----
    const key = getApiKey();
    if (key) {
        try {
            const data = await rawGet(CF_OFFICIAL, apiPath, { params, apiKey: key });
            if (scope) writeCache(scope, parts, data);
            return { data, via: 'byok', stale: false };
        } catch (e) {
            errors.push(`直连: ${describeError(e)}`);
            // 直连层 403/401 = Key 有问题，不再换层，但允许缓存兜底
            if (classifyError(e, 'byok') === 'fail') {
                throw cfError(`CurseForge ${describeError(e)}`, { cfNoFallback: true });
            }
            if (!silent) {
                console.log(`  ⚠️  [CF] 直连失败（${describeError(e)}），尝试读取本地缓存…`);
            }
        }
    } else if (!proxy) {
        // 既没配代理也没配 Key：这是最常见的首次使用场景，给出明确指引
        if (!silent && !warnedNoKey) {
            warnedNoKey = true;
            printNoKeyHint();
        }
    }

    // ---- 第三层：本地缓存（允许过期） ----
    if (scope) {
        const c = readCache(scope, parts);
        if (c) {
            if (!silent && !warnedStaleCache) {
                warnedStaleCache = true;
                console.log('');
                console.log(`  ⚠️  [CF] 正在使用 ${humanAge(c.age)}前的缓存数据，部分新模组可能无法解析。`);
                console.log('      网络恢复后会自动刷新。');
                console.log('');
            }
            return { data: c.data, via: 'cache-stale', stale: true };
        }
    }

    // ---- 全部失败 ----
    throw cfError(buildFailureMessage(errors));
}

function buildFailureMessage(errors) {
    const hasKey = !!getApiKey();
    const hasProxy = proxyEnabled();
    const detail = errors.length ? `（${errors.join('；')}）` : '';

    if (!hasKey && !hasProxy) {
        return 'CurseForge 不可用：未配置 API Key，也没有可用的代理，本地无缓存。'
            + '请前往 console.curseforge.com 申请免费 Key 后填入 wow.yaml 的 curseforge.api_key。';
    }
    return `CurseForge 请求失败${detail}，且本地无可用缓存。稍后重试，或检查 wow.yaml 中的 curseforge.api_key / curseforge.proxy_url。`;
}

function printNoKeyHint() {
    console.log('');
    console.log('  ⚠️  [CF] 公共代理未启用，且未配置 API Key。');
    console.log('      请前往 console.curseforge.com 申请免费 Key，填入 wow.yaml 的');
    console.log('      curseforge.api_key，或稍后重试。');
    console.log('      （也可自建 cfproxy 代理后填写 curseforge.proxy_url，见 docs/other/CF_PROXY.md）');
    console.log('');
}

// ==================== 领域方法：按 projectID + fileID 取直链 ====================

/**
 * 取单个文件的下载直链。
 * 这是需求里「projectID + fileID」的主场景，也最容易吃到缓存。
 *
 * @returns {{ url:string, fileName:string, fileDate:string, fileLength:number, via:string, stale:boolean }}
 * @throws 当文件被作者禁用 API 下载时，抛出 code='CF_FILE_FORBIDDEN' 的错误
 */
async function getFileDownload(projectId, fileId, options = {}) {
    const pid = String(projectId);
    const fid = String(fileId);

    const r = await cfGet(`/mods/${encodeURIComponent(pid)}/files/${encodeURIComponent(fid)}`, {
        cacheScope: 'file',
        cacheParts: [pid, fid],
        silent: options.silent,
        noCache: options.noCache
    });

    const f = (r.data && r.data.data) || null;
    if (!f) {
        throw cfError(`未找到文件 ${pid}/${fid}`, { cfNoFallback: true });
    }

    // downloadUrl 为 null 表示作者关闭了第三方分发（CurseForge 的规则）
    if (!f.downloadUrl) {
        const e = cfError(
            `文件 ${f.fileName || fid} 的作者已禁用 API 下载`,
            { cfNoFallback: true }
        );
        e.code = 'CF_FILE_FORBIDDEN';
        e.projectId = pid;
        e.fileId = fid;
        e.fileName = f.fileName || '';
        throw e;
    }

    return {
        url: f.downloadUrl,
        fileName: f.fileName || '',
        fileDate: f.fileDate || '',
        fileLength: f.fileLength || 0,
        hashes: f.hashes || [],
        via: r.via,
        stale: r.stale
    };
}

/**
 * 取项目详情（供模组详情页使用）。
 */
async function getProject(projectId, options = {}) {
    const pid = String(projectId);
    const r = await cfGet(`/mods/${encodeURIComponent(pid)}`, {
        cacheScope: 'project',
        cacheParts: [pid],
        silent: options.silent,
        noCache: options.noCache
    });
    return { data: (r.data && r.data.data) || null, via: r.via, stale: r.stale };
}

/**
 * 搜索 / 其他一次性查询：不缓存，直接走矩阵。
 */
async function cfSearch(apiPath, params, options = {}) {
    const r = await cfGet(apiPath, { params, silent: options.silent });
    return { data: r.data, via: r.via, stale: r.stale };
}

// ==================== 状态自检 ====================

/**
 * 供 CLI 展示当前三层配置状态（不联网）。
 */
function status() {
    const proxy = getProxyUrl();
    const key = getApiKey();
    const cs = cacheStats();
    return {
        proxy: proxy || null,
        hasKey: !!key,
        // Key 只回显长度，不泄露内容
        keyLength: key ? key.length : 0,
        cache: cs,
        layers: [
            { name: '公共代理', enabled: !!proxy, detail: proxy || '未配置（第一层跳过）' },
            { name: 'BYOK 直连', enabled: !!key, detail: key ? `已配置（${key.length} 字符）` : '未配置' },
            { name: '本地缓存', enabled: cs.count > 0, detail: `${cs.count} 条（新鲜 ${cs.fresh} / 过期 ${cs.stale}）` }
        ]
    };
}

module.exports = {
    cfGet,
    getFileDownload,
    getProject,
    cfSearch,
    clearCache,
    cacheStats,
    status,
    // 供测试
    describeError,
    classifyError,
    isRetryableError,
    buildUrl,
    getProxyUrl,
    getApiKey,
    CACHE_DIR,
    CACHE_TTL_MS,
    REQUEST_TIMEOUT,
    CF_OFFICIAL
};
