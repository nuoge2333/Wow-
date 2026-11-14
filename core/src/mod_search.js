/**
 * 模组搜索服务（V3.5.6）
 * - Modrinth：公开 API，无需密钥，开箱可用
 * - CurseForge：V3.5.25 起走 cf_client 的三层降级（代理 → BYOK → 本地缓存），
 *   不再硬性要求先配 Key。
 *
 * 只负责「查询」，下载交由既有 ModManager / down 命令完成。
 */

const path = require('path');
const axios = require('axios');
const cf = require('./cf_client');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const MINECRAFT_GAME_ID = 432;

const UA = 'wow-server-panel/3.5.6 (+https://gitee.com/nuoge233/wow)';

// 加载器名称归一（前端下拉值 → Modrinth loader 名）
const LOADER_ALIAS = {
    vanilla: null,
    paper: null,
    spigot: null,
    bukkit: null,
    fabric: 'fabric',
    forge: 'forge',
    neoforge: 'neoforge',
    quilt: 'quilt',
    mohist: 'forge',
    magma: 'forge',
    arclight: 'forge',
    catserver: 'forge'
};

// 插件端加载器（Minecraft 服务端插件，如 Bukkit/Paper/Purpur/Folia）
// —— 与「模组」概念不同，Modrinth / CurseForge 直接接受同名 loader，无需映射。
const PLUGIN_LOADERS = new Set([
    'bukkit', 'spigot', 'paper', 'purpur', 'folia', 'sponge', 'canvas', 'velocity', 'bungeecord'
]);

// 类别中文 → Modrinth/CurseForge slug（前后端共用，前端据此渲染下拉）
// 科技=technology、魔法=magic、优化=optimization、冒险=adventure、库/API=library
const CATEGORY_ALIAS = {
    '科技': 'technology', 'technology': 'technology',
    '魔法': 'magic', 'magic': 'magic',
    '优化': 'optimization', 'optimization': 'optimization', '性能': 'optimization',
    '冒险': 'adventure', 'adventure': 'adventure',
    '库': 'library', 'api': 'library', 'library': 'library'
};

function normalizeLoader(loader, projectType) {
    if (!loader) return null;
    const key = String(loader).toLowerCase().trim();
    if (key === '' || key === 'all' || key === 'any') return null;
    // 插件端：Modrinth / CF 直接接受同名加载器，原样透传（未知也透传，由 API 判错）
    if (projectType === 'plugin') return key;
    return Object.prototype.hasOwnProperty.call(LOADER_ALIAS, key) ? LOADER_ALIAS[key] : key;
}

function normalizeCategory(category) {
    if (!category) return null;
    const raw = String(category).trim();
    if (raw === '' || raw === 'all' || raw === 'any') return null;
    const key = raw.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CATEGORY_ALIAS, raw)) return CATEGORY_ALIAS[raw];
    if (Object.prototype.hasOwnProperty.call(CATEGORY_ALIAS, key)) return CATEGORY_ALIAS[key];
    return key; // 已经是正确的 slug 则原样透传
}

function httpError(msg, status) {
    const e = new Error(msg);
    e.status = status || 502;
    return e;
}

/**
 * 搜索模组 / 插件
 * @param {string} source   来源：modrinth（默认，优先）| curseforge（次选）
 * @param {string} query    关键词
 * @param {Object} [opts]
 * @param {string} [opts.loader]    加载器（可空）：模组端 fabric/forge/neoforge/quilt；插件端 bukkit/spigot/paper/purpur/folia
 * @param {string} [opts.version]   MC 版本（可空）
 * @param {string} [opts.category]  类别（可空）：科技/魔法/优化/冒险/库，或对应英文 slug
 * @param {string} [opts.projectType]  'mod'（默认）| 'plugin'（Minecraft 服务端插件）
 */
async function search(source, query, opts = {}) {
    const src = (source || 'modrinth').toLowerCase();
    const q = String(query || '').trim();
    const projectType = (opts.projectType === 'plugin') ? 'plugin' : 'mod';
    if (!q) return { source: src, projectType, results: [] };

    if (src === 'curseforge' || src === 'cf') {
        return { source: 'curseforge', projectType, results: await searchCurseForge(q, opts, projectType) };
    }
    return { source: 'modrinth', projectType, results: await searchModrinth(q, opts, projectType) };
}

/**
 * Modrinth 搜索
 * @param {string} query
 * @param {Object} opts  { loader, version, category }
 * @param {string} projectType  'mod' | 'plugin'
 */
async function searchModrinth(query, opts = {}, projectType = 'mod') {
    const loader = normalizeLoader(opts.loader, projectType);
    const category = normalizeCategory(opts.category);
    const version = opts.version;

    const facets = [[`project_type:${projectType}`]];
    if (loader) facets.push([`categories:${loader}`]);
    if (category) facets.push([`categories:${category}`]);
    if (version) facets.push([`versions:${version}`]);

    let resp;
    try {
        resp = await axios.get(`${MODRINTH_API}/search`, {
            params: {
                query,
                limit: opts.limit || 20,
                index: 'relevance',
                facets: JSON.stringify(facets)
            },
            headers: { 'User-Agent': UA },
            timeout: 15000
        });
    } catch (e) {
        throw httpError(`Modrinth 请求失败: ${describeAxiosError(e)}`);
    }

    const hits = (resp.data && resp.data.hits) || [];
    const results = [];

    for (const hit of hits) {
        // 搜索结果不含 download_url，需再查该项目的版本列表取首个匹配文件
        const file = await pickModrinthFile(hit.project_id, loader, version);
        results.push({
            name: hit.title,
            author: hit.author,
            version: file ? file.version_number : (hit.versions || []).slice(-1)[0] || 'latest',
            downloads: formatNumber(hit.downloads),
            summary: hit.description || '',
            loaders: filterLoaders(hit.categories, projectType),
            project_id: hit.project_id,
            slug: hit.slug,
            projectType,
            url: `https://modrinth.com/${projectType}/${hit.slug}`,
            download_url: file ? file.url : '',
            filename: file ? file.filename : ''
        });
    }
    return results;
}

// 从项目 categories 中挑出「加载器」维度用于前端展示
function filterLoaders(categories, projectType) {
    if (!categories || !categories.length) return [];
    if (projectType === 'plugin') {
        return categories.filter(c => PLUGIN_LOADERS.has(c));
    }
    return categories.filter(c => LOADER_ALIAS[c] !== undefined || ['fabric', 'forge', 'neoforge', 'quilt'].includes(c));
}

/**
 * 取 Modrinth 项目下最合适的一个版本文件
 */
async function pickModrinthFile(projectId, loader, version) {
    if (!projectId) return null;
    const params = {};
    if (loader) params.loaders = JSON.stringify([loader]);
    if (version) params.game_versions = JSON.stringify([version]);

    let resp;
    try {
        resp = await axios.get(`${MODRINTH_API}/project/${projectId}/version`, {
            params,
            headers: { 'User-Agent': UA },
            timeout: 15000
        });
    } catch (e) {
        return null;
    }

    const versions = (resp.data || []).filter(v => v.version_type !== 'alpha');
    const list = versions.length ? versions : (resp.data || []);
    if (!list.length) return null;

    const v = list[0];
    const file = (v.files || []).find(f => f.primary) || (v.files || [])[0];
    if (!file) return null;
    return { url: file.url, filename: file.filename, version_number: v.version_number };
}

/**
 * CurseForge 搜索
 *
 * V3.5.25：不再强制要 Key。走 cf_client 的三层降级：
 *   代理 → BYOK 直连 → 本地缓存（搜索不缓存，见 cf_client 注释）
 *
 * @param {string} query
 * @param {Object} opts  { loader, version, category }
 * @param {string} projectType  'mod' | 'plugin'
 */
async function searchCurseForge(query, opts = {}, projectType = 'mod') {
    const loader = normalizeLoader(opts.loader, projectType);
    const version = opts.version;
    const params = {
        gameId: MINECRAFT_GAME_ID,
        searchFilter: query,
        pageSize: opts.limit || 20,
        sortField: 2 // Popularity
    };
    // 项目类型 → CF classId：模组=6（Mods），服务端插件=4559（Bukkit）
    params.classId = (projectType === 'plugin') ? 4559 : 6;
    if (version) params.gameVersion = version;
    const modLoaderType = curseForgeLoaderId(loader);
    if (modLoaderType) params.modLoaderType = modLoaderType;

    let respData;
    try {
        // 搜索是关键词查询，结果随时间变化，不缓存
        const r = await cf.cfSearch('/mods/search', params);
        respData = r.data;
    } catch (e) {
        // cf_client 的报错已经是完整可读的中文说明，别再套一层「请求失败:」
        if (e && e.cfError) throw httpError(e.message, 502);
        throw httpError(`CurseForge 请求失败: ${describeAxiosError(e)}`, 502);
    }

    const data = (respData && respData.data) || [];
    return data.map(m => {
        const file = pickCurseForgeFile(m, version);
        return {
            name: m.name,
            author: (m.authors && m.authors[0] && m.authors[0].name) || '未知作者',
            version: file ? file.displayName : 'latest',
            downloads: formatNumber(m.downloadCount),
            summary: m.summary || '',
            loaders: projectType === 'plugin' ? [loader].filter(Boolean) : [],
            project_id: String(m.id),
            slug: m.slug,
            projectType,
            url: m.links && m.links.websiteUrl,
            download_url: file ? (file.downloadUrl || '') : '',
            filename: file ? file.fileName : ''
        };
    }).filter(r => r.download_url); // 无直链的结果前端无法一键下载，直接剔除
}

function pickCurseForgeFile(mod, version) {
    const files = mod.latestFiles || [];
    if (!files.length) return null;
    if (version) {
        const hit = files.find(f => (f.gameVersions || []).includes(version));
        if (hit) return hit;
    }
    return files[0];
}

// V3.5.25：Key 的读取已统一到 cf_client.getApiKey()（兼容旧键名），此处不再重复实现。

function curseForgeLoaderId(loader) {
    const ld = normalizeLoader(loader);
    // CurseForge ModLoaderType: 1=Forge 4=Fabric 5=Quilt 6=NeoForge
    switch (ld) {
        case 'forge': return 1;
        case 'fabric': return 4;
        case 'quilt': return 5;
        case 'neoforge': return 6;
        default: return 0;
    }
}

/**
 * 项目详情
 * @param {string} source   modrinth | curseforge
 * @param {string} project  项目 id 或 slug
 */
async function getInfo(source, project) {
    const src = (source || 'modrinth').toLowerCase();
    const id = String(project || '').trim();
    if (!id) throw httpError('缺少 project 参数', 400);

    if (src === 'curseforge' || src === 'cf') {
        return getCurseForgeInfo(id);
    }
    return getModrinthInfo(id);
}

async function getModrinthInfo(id) {
    let resp;
    try {
        resp = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(id)}`, {
            headers: { 'User-Agent': UA },
            timeout: 15000
        });
    } catch (e) {
        throw httpError(`Modrinth 项目查询失败: ${describeAxiosError(e)}`, e.response && e.response.status === 404 ? 404 : 502);
    }
    const p = resp.data || {};
    let file = null;
    try {
        file = await pickModrinthFile(p.id, null, null);
    } catch (e) { /* 详情缺失不影响主流程 */ }

    return {
        name: p.title,
        author: await getModrinthAuthor(p),
        version: file ? file.version_number : 'latest',
        downloads: formatNumber(p.downloads),
        description: p.description || '',
        url: `https://modrinth.com/mod/${p.slug}`,
        download_url: file ? file.url : '',
        dependencies: await getModrinthDependencies(p.id)
    };
}

/**
 * 获取 Modrinth 项目作者（/project 接口不返回，需查团队成员）
 */
async function getModrinthAuthor(project) {
    const teamId = project && project.team;
    if (!teamId) return '';
    try {
        const resp = await axios.get(`${MODRINTH_API}/team/${teamId}/members`, {
            headers: { 'User-Agent': UA },
            timeout: 10000
        });
        const members = resp.data || [];
        // 优先取 Owner，其次第一位成员
        const owner = members.find(m => m.role === 'Owner') || members[0];
        return (owner && owner.user && owner.user.username) || '';
    } catch (e) {
        return '';
    }
}


async function getModrinthDependencies(projectId) {
    if (!projectId) return [];
    let file;
    try {
        file = await pickModrinthFile(projectId, null, null);
    } catch (e) {
        return [];
    }
    if (!file) return [];

    // pickModrinthFile 未暴露 dependencies，这里再取一次完整版本对象
    try {
        const resp = await axios.get(`${MODRINTH_API}/project/${projectId}/version`, {
            headers: { 'User-Agent': UA },
            timeout: 15000
        });
        const target = (resp.data || []).find(v => (v.files || []).some(f => f.url === file.url));
        const deps = (target && target.dependencies) || [];
        const out = [];
        for (const d of deps) {
            if (!d.project_id) continue;
            out.push({ project_id: d.project_id, dependency_type: d.dependency_type || 'required' });
        }
        return out;
    } catch (e) {
        return [];
    }
}

/**
 * 取 Modrinth 项目在 (loader, mcVersion) 下的最佳版本文件，并附带其依赖。
 * 供依赖解析器（dep_resolver）复用：返回 { url, filename, version_number, dependencies }。
 * 依赖为 [{ project_id, dependency_type }]，dependency_type 见 Modrinth：
 *   required(0) / optional(1) / incompatible(2) / embedded(3)。
 * 任意一步失败 → 返回 null（由调用方决定是否降级）。
 */
async function pickModrinthVersion(projectId, loader, mcVersion) {
    if (!projectId) return null;
    const params = {};
    if (loader) params.loaders = JSON.stringify([loader]);
    if (mcVersion) params.game_versions = JSON.stringify([mcVersion]);

    let resp;
    try {
        resp = await axios.get(`${MODRINTH_API}/project/${projectId}/version`, {
            params,
            headers: { 'User-Agent': UA },
            timeout: 15000
        });
    } catch (e) {
        // 向上抛出，由 dep_resolver 捕获并降级（铁律②：超时 / 异常记录提示，不致命）
        throw e;
    }

    const versions = (resp.data || []).filter(v => v.version_type !== 'alpha');
    const list = versions.length ? versions : (resp.data || []);
    if (!list.length) return null;

    const v = list[0];
    const file = (v.files || []).find(f => f.primary) || (v.files || [])[0];
    if (!file) return null;
    const deps = (v.dependencies || []).map(d => ({
        project_id: d.project_id,
        dependency_type: d.dependency_type == null ? 'required' : String(d.dependency_type)
    }));
    return {
        url: file.url,
        filename: file.filename,
        version_number: v.version_number,
        dependencies: deps
    };
}

async function getCurseForgeInfo(id) {    // V3.5.25：走三层降级并缓存项目详情（24h）
    let m;
    try {
        const r = await cf.getProject(id);
        m = r.data || {};
    } catch (e) {
        if (e && e.cfError) throw httpError(e.message, 502);
        throw httpError(`CurseForge 项目查询失败: ${describeAxiosError(e)}`,
            e.response && e.response.status === 404 ? 404 : 502);
    }
    const file = pickCurseForgeFile(m, null);
    return {
        name: m.name,
        author: (m.authors && m.authors[0] && m.authors[0].name) || '未知作者',
        version: file ? file.displayName : 'latest',
        downloads: formatNumber(m.downloadCount),
        description: m.summary || '',
        url: m.links && m.links.websiteUrl,
        download_url: file ? (file.downloadUrl || '') : '',
        dependencies: []
    };
}

// ==================== 工具 ====================

function formatNumber(n) {
    const num = Number(n) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
}

function describeAxiosError(e) {
    if (e.response) {
        const status = e.response.status;
        if (status === 403 || status === 401) return '接口拒绝访问（密钥无效或已过期）';
        if (status === 404) return '资源不存在';
        if (status === 429) return '请求过于频繁，请稍后再试';
        return `HTTP ${status}`;
    }
    if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '')) return '连接超时，请检查网络';
    if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return '无法解析域名，请检查网络或代理';
    return e.message || '未知错误';
}

// pickModrinthFile 同时供「模组搜索」与「建方案时自动装配 Fabric API」使用——
// 按 projectId + loader + MC 版本解析出可下载的文件直链。
module.exports = {
    search, getInfo, normalizeLoader, normalizeCategory, formatNumber, pickModrinthFile,
    pickModrinthVersion, LOADER_ALIAS, PLUGIN_LOADERS, CATEGORY_ALIAS, filterLoaders
};
