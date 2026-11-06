/**
 * 跨设备方案同步 —— 控制端（V3.5.25）
 * ----------------------------------------------------------------
 * 控制端是手里有完整方案的那台机器。流程：
 *
 *   1. buildManifest()   扫描方案目录，生成清单（哈希先行）
 *   2. POST /check       执行端预检 → 拿到 missing 列表
 *   3. 差量上传          大文件分块（8MB/块，断点续传），小文件 JSON 束
 *   4. POST /finalize    执行端组装 → 返回报告
 *
 * 断点续传的实现：
 *   - 执行端按 sha256 追加写 staging 文件，GET /upload/status 返回已收字节数；
 *   - 控制端每传一块前查一次（或沿用上一响应里的 received），从断点继续；
 *   - 进度记在 core/temp/sync_progress.json，进程重启也能续。
 *
 * 认证：`wow sync login <url>` 走 Web 面板已有的 /api/auth/login（离线密码），
 * 拿到 JWT 存进 config 的 sync.servers。<url> → token 一对一，push 时自动携带。
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const config = require('./config');
const utils = require('./utils');
const sync = require('./sync_common');
const { logger } = require('./log');

const UA = 'wow-sync/1.0';

/** 执行端返回的「为什么还要我上传」→ 人话 */
const REASON_TEXT = {
    not_in_pool_not_in_modrinth: 'Modrinth 未收录',
    modrinth_hash_mismatch: 'Modrinth 哈希不匹配',
    modrinth_download_failed: 'Modrinth 下载失败',
    modrinth_unreachable: 'Modrinth 不可达',
    modrinth_no_file: 'Modrinth 无可用文件',
    modrinth_budget_exceeded: 'Modrinth 下载超时预算',
    no_modrinth_hashes: '清单无 Modrinth 哈希',
    path_not_allowed: '路径不在白名单'
};

// ==================== 凭据 ====================

/** 取某执行端的 token（无则 null） */
function getToken(baseUrl) {
    const servers = config.getConfig('sync.servers', {}) || {};
    const rec = servers[normalizeUrl(baseUrl)];
    return rec ? rec.token : null;
}

/** 保存 token */
function saveToken(baseUrl, token) {
    const servers = config.getConfig('sync.servers', {}) || {};
    servers[normalizeUrl(baseUrl)] = { token, saved_at: new Date().toISOString() };
    config.setConfig('sync.servers', servers);
}

function normalizeUrl(u) {
    return String(u || '').trim().replace(/\/+$/, '');
}

/** 带认证的请求封装：401 时给出明确提示 */
async function apiCall(method, url, token, opts = {}) {
    try {
        return await axios({
            method,
            url,
            timeout: opts.timeout || 120000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            ...opts.axios,
            // 放在展开之后：multipart 场景由 form.getHeaders 提供 Content-Type/边界，
            // 这里保证 Authorization 始终注入且不会被覆盖丢失
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA, ...(opts.axios && opts.axios.headers) }
        });
    } catch (e) {
        if (e.response && e.response.status === 401) {
            throw new Error(`认证失败（401）：token 无效或已过期，请重新执行 wow sync login ${normalizeUrl(url).replace(/\/api.*/, '')}`);
        }
        throw e;
    }
}

// ==================== 断点进度 ====================

function progressFile() {
    return utils.resolvePath(path.join('temp', 'sync_progress.json'));
}

function loadProgress() {
    try {
        return fs.readJsonSync(progressFile());
    } catch (e) {
        return {};
    }
}

function saveProgress(p) {
    try {
        fs.ensureDirSync(path.dirname(progressFile()));
        fs.writeJsonSync(progressFile(), p);
    } catch (e) { /* 进度丢了不影响正确性，只是不能续传 */ }
}

// ==================== 上传 ====================

/**
 * 上传一个大文件（分块 + 断点续传）。
 * @returns {Promise<{ok:boolean, reason?:string, bytes:number}>}
 */
async function uploadLargeFile(baseUrl, token, schemeName, entry, onProgress, schemePath) {
    // 清单里的 path 相对「方案目录」，不是 scheme 根 —— 必须显式传方案路径，
    // 否则未激活方案时 getServerDir() 回退到 scheme 根，所有文件都找不到。
    const local = path.join(schemePath, entry.path);
    if (!fs.existsSync(local)) return { ok: false, reason: `本地文件不存在: ${entry.path}`, bytes: 0 };

    const totalSize = fs.statSync(local).size;
    const url = `${normalizeUrl(baseUrl)}/api/sync/upload`;

    // 从执行端断点续传
    let offset = 0;
    try {
        const st = await apiCall('get',
            `${url}/status?name=${encodeURIComponent(schemeName)}&sha256=${entry.sha256}`,
            token, { timeout: 30000 });
        if (st.data && st.data.success) offset = st.data.received || 0;
    } catch (e) { /* 查不到就从 0 开始 */ }

    if (offset > totalSize) offset = 0;

    const fh = fs.openSync(local, 'r');
    try {
        while (offset < totalSize) {
            const len = Math.min(sync.CHUNK_SIZE, totalSize - offset);
            const buf = Buffer.alloc(len);
            fs.readSync(fh, buf, 0, len, offset);

            const form = new (require('form-data'))();
            form.append('scheme', schemeName);
            form.append('path', entry.path);
            form.append('sha256', entry.sha256);
            form.append('offset', String(offset));
            form.append('total_size', String(totalSize));
            form.append('chunk', buf, { filename: 'chunk.bin', contentType: 'application/octet-stream' });

            let resp;
            try {
                resp = await apiCall('post', url, token, {
                    timeout: 300000,
                    // 注意：这里只给 multipart 的 Content-Type/边界，Authorization 由 apiCall 统一注入
                    axios: { headers: form.getHeaders({ 'User-Agent': UA }), data: form }
                });
            } catch (e) {
                if (e.response && e.response.status === 409) {
                    // 偏移不连续：从执行端说的位置重试
                    offset = e.response.data.expected_offset || 0;
                    continue;
                }
                if (e.response && e.response.status === 422) {
                    // 哈希不匹配，执行端已清掉 staging，从头重传
                    offset = 0;
                    continue;
                }
                throw e;
            }

            const d = resp.data || {};
            if (!d.success) throw new Error(d.error || '上传失败');
            offset = d.received;
            if (onProgress) onProgress(offset, totalSize);
            if (d.complete) break;
        }
        return { ok: true, bytes: totalSize };
    } finally {
        fs.closeSync(fh);
    }
}

/**
 * 上传一批小文件（JSON 束，一个请求带全部内容）。
 * @returns {Promise<{accepted:string[], rejected:Array}>}
 */
async function uploadBundle(baseUrl, token, schemeName, files, schemePath) {
    const payload = [];
    for (const f of files) {
        const abs = path.join(schemePath, f.path);
        if (!fs.existsSync(abs)) continue;
        const buf = fs.readFileSync(abs);
        if (buf.length > sync.MAX_BUNDLE_FILE_BYTES) continue; // 超限的走分块
        payload.push({
            path: f.path,
            sha256: f.sha256,
            size: buf.length,
            content_base64: buf.toString('base64')
        });
    }
    if (!payload.length) return { accepted: [], rejected: [] };

    const resp = await apiCall('post', `${normalizeUrl(baseUrl)}/api/sync/upload`, token, {
        timeout: 300000,
        axios: { data: { scheme: schemeName, files: payload } }
    });
    const d = resp.data || {};
    if (!d.success) throw new Error(d.error || '束上传失败');
    return { accepted: d.accepted || [], rejected: d.rejected || [] };
}

// ==================== 主流程 ====================

/**
 * 推送方案。
 *
 * @param {object} opts
 *   baseUrl       执行端地址（http(s)://…）
 *   schemeName    要推的方案名（当前方案则省略）
 *   remoteName    执行端方案名（默认同 schemeName）
 *   withWorld / withConfig
 *   log / warn    输出回调
 * @returns {Promise<object>} { ok, reason?, report? }
 */
async function push(opts = {}) {
    const log = opts.log || console.log;
    const warn = opts.warn || console.warn;
    const baseUrl = normalizeUrl(opts.baseUrl);

    if (!baseUrl) return { ok: false, reason: '缺少执行端地址' };

    const token = getToken(baseUrl);
    if (!token) {
        return { ok: false, reason: `尚未登录该执行端，请先执行：wow sync login ${baseUrl}` };
    }

    const SchemeManager = require('./scheme_manager');
    const sm = new SchemeManager();
    const schemeName = opts.schemeName || sm.currentScheme;
    if (!schemeName) return { ok: false, reason: '未指定方案且当前无激活方案' };
    if (!sm._schemeExists(schemeName)) return { ok: false, reason: `方案 ${schemeName} 不存在` };
    const meta = sm._loadSchemeMeta(schemeName);
    const schemePath = sm._getSchemePath(schemeName);
    const remoteName = opts.remoteName || schemeName;

    // ---- 1. 清单 ----
    log('📋 生成同步清单...');
    const manifest = await sync.buildManifest({
        schemePath,
        meta: { ...meta, name: remoteName },
        withWorld: opts.withWorld === true,
        withConfig: opts.withConfig === true
    });
    const nMods = manifest.mods.length;
    const nFiles = manifest.files.length;
    log(`   方案 ${schemeName} → ${remoteName}：核心 ${manifest.core ? '1' : '0'}，模组 ${nMods}，其它文件 ${nFiles}（共 ${(manifest.total_bytes / 1024 / 1024).toFixed(1)} MB）`);
    if (opts.withWorld) log('   ⚠️ 包含存档，同步耗时较长');
    manifest.sync_source = `${config.getConfig('server.scheme', 'wow')}@${require('os').hostname()}`;

    // ---- 2. 预检 ----
    log('🔎 执行端预检...');
    let check;
    try {
        check = (await apiCall('post', `${baseUrl}/api/sync/check`, token, {
            // 执行端预检里可能带 Modrinth 补齐（默认 90s 预算），这里留足余量
            timeout: 180000,
            axios: { data: manifest }
        })).data;
    } catch (e) {
        if (e.response && e.response.status === 409) {
            const msg = (e.response.data.conflicts || []).map(c => c.message).join('；');
            return { ok: false, reason: msg || '方案名冲突' };
        }
        if (e.response) return { ok: false, reason: `预检失败（${e.response.status}）: ${JSON.stringify(e.response.data)}` };
        return { ok: false, reason: `连不上执行端: ${e.message}` };
    }
    if (!check.success) return { ok: false, reason: check.error || '预检失败' };

    log(`   已就位 ${check.already_present.length} 个，需上传 ${check.missing.length} 个（${(check.total_missing_bytes / 1024 / 1024).toFixed(1)} MB）`);
    const ms = check.mod_stats || null;
    if (ms && ms.total_mods > 0) {
        const parts = [`pool 命中 ${ms.resolved_by_pool || 0}`, `Modrinth 补齐 ${ms.resolved_by_modrinth || 0}`, `需上传 ${ms.need_upload || 0}`];
        log(`   模组：${parts.join(' / ')}（共 ${ms.total_mods}）`);
    }
    log(`   核心：执行端将自行装配（${check.core_plan && check.core_plan.action}）`);

    // 需要上传的条目带 reason（Modrinth 未收录 / 哈希不匹配 / 下载失败 / 不可达），
    // 一并带到报告里，用户才知道「为什么这个文件还得我自己传」。
    const missingReasons = {};
    for (const f of check.missing || []) if (f.reason) missingReasons[f.path] = f.reason;

    // ---- 3. 差量上传 ----
    const missing = check.missing || [];
    const small = missing.filter(f => f.size <= sync.CHUNK_THRESHOLD);
    const large = missing.filter(f => f.size > sync.CHUNK_THRESHOLD);

    // 小文件束
    if (small.length > 0) {
        log(`📦 上传 ${small.length} 个小文件（束）...`);
        // 束体大小控制在 16MB 内，超出就拆
        const batches = [];
        let cur = [], curBytes = 0;
        for (const f of small) {
            if (curBytes + f.size > 16 * 1024 * 1024 && cur.length) { batches.push(cur); cur = []; curBytes = 0; }
            cur.push(f); curBytes += f.size;
        }
        if (cur.length) batches.push(cur);

        let bi = 0;
        for (const b of batches) {
            bi++;
            try {
                const r = await uploadBundle(baseUrl, token, remoteName, b, schemePath);
                log(`   束 ${bi}/${batches.length}：接受 ${r.accepted.length}，拒绝 ${r.rejected.length}`);
                for (const rej of r.rejected) warn(`   ⚠️ ${rej.path}: ${rej.reason}`);
            } catch (e) {
                warn(`   ⚠️ 束 ${bi} 上传失败（大文件不受影响）: ${e.message}`);
            }
        }
    }

    // 大文件分块
    if (large.length > 0) {
        log(`📦 上传 ${large.length} 个大文件（分块，${sync.CHUNK_SIZE / 1024 / 1024}MB/块）...`);
        const prog = loadProgress();
        const key = `${baseUrl}|${remoteName}`;
        prog[key] = prog[key] || {};

        for (const f of large) {
            // 本地进度只做展示参考，是否续传一律以执行端 status 为准
            // （执行端 staging 可能被清理，本地「已传完」不可信）
            process.stdout.write(`   ↑ ${f.path} `);
            const r = await uploadLargeFile(baseUrl, token, remoteName, f, (bytes, total) => {
                process.stdout.write(`\r   ↑ ${f.path} ${Math.round(bytes / total * 100)}%   `);
                prog[key][f.sha256] = bytes;
                saveProgress(prog);
            }, schemePath);
            process.stdout.write('\n');
            if (!r.ok) warn(`   ⚠️ ${f.path}: ${r.reason}`);
            else { prog[key][f.sha256] = f.size; saveProgress(prog); }
        }
    }

    // ---- 4. 组装 ----
    log('🔧 通知执行端组装方案...');
    let fin;
    try {
        fin = (await apiCall('post', `${baseUrl}/api/sync/finalize`, token, {
            timeout: 1800000,   // 核心装配可能要十几分钟
            axios: { data: manifest }
        })).data;
    } catch (e) {
        if (e.response) return { ok: false, reason: `组装失败（${e.response.status}）: ${JSON.stringify(e.response.data).slice(0, 400)}` };
        return { ok: false, reason: `组装请求失败: ${e.message}` };
    }
    if (!fin.success) return { ok: false, reason: fin.error || '组装失败', report: fin.report };

    // ---- 报告 ----
    const rep = fin.report || {};
    const lines = [];
    lines.push('');
    lines.push('✅ 方案同步完成');
    lines.push('─'.repeat(52));
    lines.push(`   执行端方案：scheme/${rep.schemeName}（state: ${rep.state}）`);
    lines.push(`   文件：写入 ${rep.written ? rep.written.length : 0} 个，失败 ${rep.failed ? rep.failed.length : 0} 个`);
    if (ms && ms.total_mods > 0) {
        // 模组来源分布：说清楚「省了多少上传」
        const mrCount = ms.resolved_by_modrinth || 0;
        const needCount = ms.need_upload || 0;
        const reasonCount = {};
        for (const r of Object.values(missingReasons)) reasonCount[r] = (reasonCount[r] || 0) + 1;
        const reasonText = Object.entries(reasonCount)
            .map(([k, v]) => `${v} 个 ${REASON_TEXT[k] || k}`)
            .join('，');
        lines.push('   📦 模组来源分布：');
        lines.push(`      - pool 命中：${ms.resolved_by_pool || 0} 个`);
        lines.push(`      - Modrinth 补齐：${mrCount} 个（下载后 SHA-256 校验通过）`);
        lines.push(`      - 需控制端上传：${needCount} 个${reasonText ? `（其中 ${reasonText}）` : ''}`);
    }
    if (rep.core) {
        if (rep.core.action === 'installed') {
            lines.push(`   核心：${rep.core.file}${rep.core.matches_control === false ? '（与控制端构建不同，属正常 —— 不同平台构建）' : ''}`);
        } else if (rep.core.action === 'failed') {
            lines.push(`   核心：装配失败（${rep.core.reason}）`);
        }
    }
    if (rep.config && rep.config.length) {
        for (const c of rep.config) {
            lines.push(`   配置：${c.file} → ${c.action === 'overwritten_with_backup' ? '已覆盖（原文件备份为 .bak）' : '已创建'}`);
        }
    }
    if (rep.failed && rep.failed.length) {
        lines.push('');
        lines.push('⚠️ 失败 / 跳过的文件：');
        for (const f of rep.failed) lines.push(`   - ${f.path}：${f.reason}`);
    }
    lines.push('');
    lines.push(`   下一步（在执行端）：wow scheme switch ${rep.schemeName} && wow server start --memory 4G`);
    lines.push('─'.repeat(52));

    try { logger.info(`方案同步完成：${schemeName} → ${baseUrl} (${remoteName})`); } catch (e) {}
    return { ok: true, report: lines.join('\n') };
}

/**
 * 登录执行端：拿 JWT 存本地。
 * @param {string} baseUrl
 * @param {string} password  离线密码（交互模式下由 CLI 层先问好传入）
 */
async function login(baseUrl, password) {
    const url = normalizeUrl(baseUrl);
    if (!url) return { ok: false, reason: '缺少执行端地址' };

    let resp;
    try {
        resp = await axios.post(`${url}/api/auth/login`, { password }, {
            timeout: 30000,
            headers: { 'User-Agent': UA }
        });
    } catch (e) {
        if (e.response) {
            const d = e.response.data || {};
            return { ok: false, reason: d.error || `登录失败（${e.response.status}）` };
        }
        return { ok: false, reason: `连不上执行端: ${e.message}` };
    }

    const d = resp.data || {};
    if (!d.success || !d.token) return { ok: false, reason: d.error || '登录响应缺少 token' };

    saveToken(url, d.token);
    return { ok: true, url };
}

/** 查看已保存的执行端（token 打码） */
function listServers() {
    const servers = config.getConfig('sync.servers', {}) || {};
    return Object.entries(servers).map(([url, rec]) => ({
        url,
        saved_at: rec.saved_at,
        token_preview: String(rec.token || '').slice(0, 12) + '…'
    }));
}

module.exports = {
    normalizeUrl,
    getToken,
    saveToken,
    apiCall,
    push,
    login,
    listServers,
    uploadBundle,
    uploadLargeFile
};
