/**
 * 依赖解析器（V3.8.0，P0 下载中心）
 *
 * 给定某个项目，按 (loader, mcVersion) 解析出「最佳版本文件」，并递归拉取其
 * **必需依赖（required）**，生成一份有序的下载清单。
 *
 * 铁律②（依赖下载防死锁）：
 *   - 递归深度上限 MAX_DEPTH = 3，超过即停止下钻（不再递归依赖的依赖）；
 *   - 用 visited 集合防环（同一个 projectId 不解析两次）；
 *   - 每个外部 API 调用都带 15s 超时；超时 / 异常 → 记录降级提示并停止该分支下钻，
 *     绝不向上抛致命错（单条依赖挂了不影响其它依赖与本体下载）。
 *
 * 数据源：
 *   - Modrinth：完整解析 + 递归（默认且优先）；
 *   - CurseForge：尽力而为（取最新文件 + 其 file dependencies 中 required/optional），
 *     结构对齐 Modrinth；任何一步失败则只装单曲（返回仅含本体的清单）。
 */

const ModSearch = require('./mod_search');
const cf = require('./cf_client');

// 铁律②：递归深度上限
const MAX_DEPTH = 3;

// Modrinth dependency_type：「required」才递归；其余（optional/embedded/incompatible）不递归
const REQUIRED_TYPES = new Set(['0', 'required']);

/**
 * 解析一个项目的下载清单（含依赖）。
 * @param {Object} arg
 * @param {string} arg.source       modrinth | curseforge
 * @param {string} arg.projectId    项目 id（Modrinth）/ slug 亦可
 * @param {string} [arg.loader]     加载器（mod 端）或插件加载器
 * @param {string} [arg.mcVersion]  MC 版本
 * @param {string} [arg.versionId]  精确版本 ID（BUG-03）：仅作用于 depth=0 的本体，
 *                                  用户在前端版本下拉选中后传入，杜绝后端自动瞎挑版本；
 *                                  依赖仍按 loader/mcVersion 解析。
 * @param {number} [arg.depth=0]    当前递归深度（内部使用）
 * @param {Set<string>} [arg.visited] 已解析项目集合（防环，内部使用）
 * @returns {Promise<{items:Array, warnings:Array}>}
 *   items: [{ projectId, source, fileUrl, filename, loader, mcVersion, depth }]（按 depth 升序）
 *   warnings: [string] 降级提示（超时 / 解析失败 / 防环跳过等）
 */
async function resolve(arg) {
    const source = (arg.source || 'modrinth').toLowerCase();
    const projectId = String(arg.projectId || '').trim();
    const loader = arg.loader;
    const mcVersion = arg.mcVersion;
    const depth = arg.depth || 0;
    const visited = arg.visited || new Set();
    const warnings = arg.warnings || [];

    if (!projectId) {
        warnings.push('依赖解析：缺少 projectId，跳过');
        return { items: [], warnings };
    }
    if (visited.has(projectId)) {
        warnings.push(`依赖解析：项目 ${projectId} 已解析过，跳过（防环）`);
        return { items: [], warnings };
    }
    visited.add(projectId);

    // BUG-03：depth=0 且指定了 versionId → 先精确解析本体文件（不再自动挑版本），
    // 依赖仍走原有的 loader/mcVersion 递归逻辑。取不到精确版本时降级为原逻辑并给出提示。
    if (depth === 0 && arg.versionId) {
        try {
            const exact = await ModSearch.resolveVersionFile(source, projectId, arg.versionId);
            if (exact && exact.url) {
                const rootItem = {
                    projectId, source,
                    fileUrl: exact.url, filename: exact.filename,
                    loader, mcVersion, versionId: arg.versionId, depth: 0
                };
                // 取该精确版本的必需依赖，复用递归逻辑（依赖项目本身不强制精确版本）
                let deps = [];
                try {
                    const d = await ModSearch.getVersionDependencies(source, projectId, arg.versionId);
                    deps = (d.dependencies || []).filter(x => REQUIRED_TYPES.has(String(x.dependency_type)));
                } catch (e) {
                    warnings.push(`精确版本 ${arg.versionId} 依赖查询失败，仅装本体：${e.message}`);
                }
                const items = [rootItem];
                if (deps.length && depth + 1 <= MAX_DEPTH) {
                    for (const dep of deps) {
                        const depId = String(dep.project_id || '');
                        if (!depId || visited.has(depId)) continue;
                        const sub = await resolve({
                            source, projectId: depId,
                            loader, mcVersion, depth: depth + 1, visited, warnings
                        });
                        items.push(...sub.items);
                    }
                }
                return { items, warnings };
            }
            warnings.push(`精确版本 ${arg.versionId} 未找到可下载文件，已降级为自动选版`);
        } catch (e) {
            warnings.push(`精确版本 ${arg.versionId} 解析失败，已降级为自动选版：${e.message}`);
        }
    }

    if (source === 'curseforge' || source === 'cf') {
        return resolveCurseForge({ projectId, loader, mcVersion, depth, visited, warnings });
    }
    return resolveModrinth({ projectId, loader, mcVersion, depth, visited, warnings });
}

async function resolveModrinth({ projectId, loader, mcVersion, depth, visited, warnings }) {
    const items = [];
    let version;
    try {
        version = await ModSearch.pickModrinthVersion(projectId, loader, mcVersion);
    } catch (e) {
        warnings.push(`依赖解析：${projectId} 获取版本失败（已降级，仅跳过该分支）：${e.message}`);
        return { items, warnings };
    }
    if (!version) {
        warnings.push(`依赖解析：${projectId} 在 (${loader || '-'}/${mcVersion || '-'}) 下无可用版本，跳过`);
        return { items, warnings };
    }

    items.push({
        projectId, source: 'modrinth',
        fileUrl: version.url, filename: version.filename,
        loader, mcVersion, depth
    });

    const required = (version.dependencies || []).filter(d => REQUIRED_TYPES.has(d.dependency_type));
    if (required.length && depth + 1 <= MAX_DEPTH) {
        for (const dep of required) {
            if (visited.has(dep.project_id)) {
                warnings.push(`依赖解析：依赖 ${dep.project_id} 已解析，跳过（防环）`);
                continue;
            }
            const sub = await resolve({
                source: 'modrinth', projectId: dep.project_id,
                loader, mcVersion, depth: depth + 1, visited, warnings
            });
            items.push(...sub.items);
        }
    } else if (required.length && depth + 1 > MAX_DEPTH) {
        warnings.push(`依赖解析：已达深度上限 ${MAX_DEPTH}，${projectId} 的 ${required.length} 个依赖不再递归`);
    }

    return { items, warnings };
}

async function resolveCurseForge({ projectId, loader, mcVersion, depth, visited, warnings }) {
    const items = [];
    // CF 依赖解析尽力而为：取项目 + 最新文件 + 其 file dependencies。
    let project, file;
    try {
        const r = await cf.getProject(projectId);
        project = r.data || {};
        file = pickCurseForgeLatestFile(project, mcVersion);
    } catch (e) {
        warnings.push(`依赖解析[CF]：${projectId} 获取失败（已降级，仅跳过该分支）：${e.message}`);
        return { items, warnings };
    }
    if (!file || !file.downloadUrl) {
        warnings.push(`依赖解析[CF]：${projectId} 无可用直链文件，跳过`);
        return { items, warnings };
    }
    items.push({
        projectId, source: 'curseforge',
        fileUrl: file.downloadUrl, filename: file.fileName,
        loader, mcVersion, depth
    });

    const deps = (file.dependencies || []).filter(d => d.relationType === 1 || d.relationType === 2);
    if (deps.length && depth + 1 <= MAX_DEPTH) {
        for (const d of deps) {
            const depId = String(d.modId || d.id || '');
            if (!depId || visited.has(depId)) continue;
            const sub = await resolve({
                source: 'curseforge', projectId: depId,
                loader, mcVersion, depth: depth + 1, visited, warnings
            });
            items.push(...sub.items);
        }
    } else if (deps.length && depth + 1 > MAX_DEPTH) {
        warnings.push(`依赖解析[CF]：已达深度上限 ${MAX_DEPTH}，${projectId} 的依赖不再递归`);
    }

    return { items, warnings };
}

function pickCurseForgeLatestFile(project, mcVersion) {
    const files = project.latestFiles || [];
    if (!files.length) return null;
    if (mcVersion) {
        const hit = files.find(f => (f.gameVersions || []).includes(mcVersion));
        if (hit) return hit;
    }
    return files[0];
}

module.exports = { resolve, MAX_DEPTH };
