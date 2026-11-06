/**
 * 跨设备方案同步 —— Modrinth 补齐
 * ----------------------------------------------------------------
 * 规则一句话：**pool 未命中 → 问 Modrinth → 下载后 SHA-256 校验 → 匹配才复用。**
 *
 * 本模块只做一件事：把「执行端没有、又懒得让控制端上传」的 .jar 从 Modrinth 捞回来。
 * 它**不参与任何写入决策** —— 最终能不能写进方案目录，只由 SHA-256 说了算。
 *
 * 硬边界（对应需求「必须守住的边界」）：
 *   1. SHA-256 是唯一真理：Modrinth 返回的 sha512/sha1 只用于查询，
 *      下载后必须自己算 SHA-256 与清单比对，不匹配就丢弃。
 *   2. 所有失败降级为「需上传」：网络、限流、超时、下载、哈希不匹配，
 *      一律不抛错、不中断同步，交给上层继续处理其它文件。
 *   3. 不信任 Modrinth 的 filename：落盘一律用清单里的 path，杜绝路径注入。
 *   4. 临时目录隔离：core/temp/sync-modrinth/<session_id>/，用完即清。
 *   5. User-Agent 必须带：Modrinth API 会拒绝无标识请求。
 *   6. 不查 CurseForge：查不到就是查不到。
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const sync = require('./sync_common');

const API_BASE = process.env.WOW_MODRINTH_BASE || 'https://api.modrinth.com/v2';
const BATCH_SIZE = 100;          // Modrinth 单次 hash 查询上限
const BATCH_GAP_MS = 200;        // 批间隔，避开 ~300 req/min 限流
const BATCH_TIMEOUT_MS = 30000;  // 单批查询超时
const DOWNLOAD_TIMEOUT_MS = 60000;
const MAX_CONSECUTIVE_FAILURES = 3;  // 连续 3 批失败 → 整体放弃

/**
 * 整个 Modrinth 补齐阶段的总时间预算（默认 90s）。
 *
 * 为什么要预算：check 是一个 HTTP 请求，Modrinth 下载慢时不能把请求挂到
 * 几分钟（Cloudflare Tunnel 大约 100s 就会掐断）。超预算的文件一律降级为
 * 「需上传」——同步照常进行，只是回到老路径。可用 WOW_MODRINTH_BUDGET_MS 覆盖。
 */
const TOTAL_BUDGET_MS = parseInt(process.env.WOW_MODRINTH_BUDGET_MS, 10) || 90000;

const TEMP_DIR = path.join('temp', 'sync-modrinth');

/**
 * 清理上次进程被强杀留下的下载残留。
 * 正常路径走 finally 删除；只有进程被 SIGKILL / 断电才会在这里兜底。
 * 调用时机会话开始前一次，避免残留越积越多。
 */
function cleanupStaleTemp() {
    try {
        const root = path.join(sync.tempRoot(), TEMP_DIR);
        if (fs.existsSync(root)) fs.removeSync(root);
    } catch (_) { /* 清理失败不影响同步 */ }
}

/** wow 版本 + 仓库地址，Modrinth 要求可识别的 UA */
function userAgent() {
    let version = 'unknown';
    try {
        version = require('../package.json').version || 'unknown';
    } catch (_) { /* 取不到就用 unknown */ }
    return `wow/${version} (contact: https://github.com/nuoge2333/Wow-)`;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function newSessionId() {
    return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 批量查询 Modrinth：hash → version 对象。
 *
 * @param {string[]} hashes
 * @param {object} opts  { algorithm: 'sha512'|'sha1', log }
 * @returns {Promise<{hits: Map<string, object>, ok: boolean, reason?: string}>}
 *   永不 reject —— 失败时 ok=false，hits 为空，由上层降级为「需上传」。
 */
async function queryHashes(hashes, opts = {}) {
    const algorithm = opts.algorithm || 'sha512';
    const log = opts.log || (() => {});
    const hits = new Map();
    const list = [...new Set(hashes.filter(Boolean))];
    if (list.length === 0) return { hits, ok: true };

    const batches = [];
    for (let i = 0; i < list.length; i += BATCH_SIZE) batches.push(list.slice(i, i + BATCH_SIZE));

    let consecutiveFailures = 0;
    let successBatches = 0;
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        try {
            const resp = await axios.post(`${API_BASE}/version_files`, {
                hashes: batch,
                algorithm
            }, {
                headers: {
                    'User-Agent': userAgent(),
                    'Content-Type': 'application/json'
                },
                timeout: BATCH_TIMEOUT_MS
            });
            for (const [h, v] of Object.entries(resp.data || {})) hits.set(h, v);
            consecutiveFailures = 0;
            successBatches++;
        } catch (e) {
            const status = e.response && e.response.status;
            if (status === 400 || status === 422) {
                // 算法不支持或格式问题：整批降级到 sha1 重试一次
                if (algorithm !== 'sha1' && opts._retryWithSha1 !== false) {
                    log(`[Modrinth] 第 ${bi + 1} 批 ${algorithm} 被拒（${status}），改用 sha1 重试`);
                    const r = await queryHashes(batch, { ...opts, algorithm: 'sha1', _retryWithSha1: false });
                    if (r.ok) for (const [h, v] of r.hits) hits.set(h, v);
                    continue;
                }
            }
            consecutiveFailures++;
            log(`[Modrinth] 第 ${bi + 1}/${batches.length} 批查询失败: ${e.message}（连续 ${consecutiveFailures} 次）`);
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                return { hits, ok: false, reason: 'Modrinth 不可达，已跳过', aborted: true };
            }
        }
        if (bi < batches.length - 1) await sleep(BATCH_GAP_MS);
    }
    // 一批都没成功 = 整体不可达（哪怕批数少于 MAX_CONSECUTIVE_FAILURES）
    if (successBatches === 0 && batches.length > 0) {
        return { hits, ok: false, reason: 'Modrinth 不可达，已跳过', aborted: true };
    }
    return { hits, ok: true };
}

/** 从 version 对象里挑主文件：primary 优先，没有就取第一个 */
function pickPrimaryFile(version) {
    const files = (version && Array.isArray(version.files)) ? version.files : [];
    if (!files.length) return null;
    return files.find(f => f.primary) || files[0];
}

/** 下载到临时目录，返回本地路径；失败返回 null（不抛错） */
async function downloadToTemp(url, destPath, log, expectedSize = 0, maxOverallMs = 0) {
    // 两道时限：
    //   - socket 空闲超时（DOWNLOAD_TIMEOUT_MS）：卡住不动就放弃；
    //   - 整体时限：按最低可接受速率估算，慢到离谱也不无限等（否则同步像卡死）。
    //     下限 1MB/s + 30s 启动余量，且不低于 DOWNLOAD_TIMEOUT_MS。
    let overallMs = Math.max(
        DOWNLOAD_TIMEOUT_MS,
        30000 + Math.ceil((expectedSize || 0) / (1024 * 1024)) * 1000
    );
    // 调用方给了上限（剩余预算）就取小者，避免单个慢文件吃掉全部预算
    if (maxOverallMs > 0) overallMs = Math.min(overallMs, maxOverallMs);
    try {
        await fs.ensureDir(path.dirname(destPath));
        const resp = await axios.get(url, {
            responseType: 'stream',
            timeout: DOWNLOAD_TIMEOUT_MS,
            maxContentLength: sync.MAX_FILE_BYTES,
            maxBodyLength: Infinity,
            headers: { 'User-Agent': userAgent() }
        });
        await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(destPath);
            const timer = setTimeout(() => {
                try { resp.data.destroy(); } catch (_) { /* 忽略 */ }
                try { ws.destroy(); } catch (_) { /* 忽略 */ }
                reject(new Error(`整体下载超过 ${Math.round(overallMs / 1000)}s`));
            }, overallMs);
            if (timer.unref) timer.unref();
            const done = (fn, arg) => { clearTimeout(timer); fn(arg); };
            resp.data.on('error', e => done(reject, e));
            ws.on('error', e => done(reject, e));
            ws.on('finish', () => done(resolve));
            resp.data.pipe(ws);
        });
        return destPath;
    } catch (e) {
        log(`[Modrinth] 下载失败 ${e.message}`);
        try { await fs.remove(destPath); } catch (_) { /* 忽略 */ }
        return null;
    }
}

/**
 * 对一批「pool 未命中」的模组尝试 Modrinth 补齐。
 *
 * @param {object} opts
 *   entries     [{ path, sha256, sha512, sha1, size }]  清单里 pool 未命中的条目
 *   protocol    清单协议版本；<2 时直接跳过（旧清单无 sha512/sha1）
 *   schemePath  执行端方案目录（下载校验通过后写这里）
 *   log         日志函数
 * @returns {Promise<{resolved: string[], needUpload: Array<{path,reason}>, skipped?: string}>}
 *   resolved   已由 Modrinth 补齐并写入方案目录的相对路径
 *   needUpload 仍需控制端上传的条目（带 reason）
 *   skipped    整体跳过的原因（旧清单 / Modrinth 不可达）
 */
async function fillFromModrinth(opts = {}) {
    const { entries = [], protocol = 0, schemePath } = opts;
    const log = opts.log || (() => {});
    const resolved = [];
    const needUpload = [];

    if (!entries.length) return { resolved, needUpload };

    // 旧清单：没有 sha512/sha1，查不了
    if (protocol < 2) {
        for (const e of entries) needUpload.push({ path: e.path, reason: 'no_modrinth_hashes' });
        return { resolved, needUpload, skipped: '旧清单无 sha512/sha1，跳过 Modrinth 查询' };
    }

    // 只查带 sha512 的
    const candidates = entries.filter(e => e.sha512 || e.sha1);
    const noHash = entries.filter(e => !e.sha512 && !e.sha1);
    for (const e of noHash) needUpload.push({ path: e.path, reason: 'no_modrinth_hashes' });

    if (!candidates.length) return { resolved, needUpload };

    const t0 = Date.now();
    // 预算可被调用方覆盖（测试 / 自定义策略用），默认 TOTAL_BUDGET_MS
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : TOTAL_BUDGET_MS;
    const withSha512 = candidates.filter(e => e.sha512);
    const onlySha1 = candidates.filter(e => !e.sha512 && e.sha1);

    const hits = new Map();
    let aborted = null;

    if (withSha512.length) {
        const r = await queryHashes(withSha512.map(e => e.sha512), { algorithm: 'sha512', log });
        for (const [h, v] of r.hits) hits.set(h, v);
        if (r.aborted) aborted = r.reason;
    }
    if (!aborted && onlySha1.length) {
        const r = await queryHashes(onlySha1.map(e => e.sha1), { algorithm: 'sha1', log });
        for (const [h, v] of r.hits) hits.set(h, v);
        if (r.aborted) aborted = r.reason;
    }

    // 命中统计（按条目计，不按哈希计）
    const matchOf = (e) => (e.sha512 && hits.get(e.sha512)) || (e.sha1 && hits.get(e.sha1)) || null;
    const hitCount = candidates.filter(e => matchOf(e)).length;

    if (!aborted) {
        log(`[Modrinth] 查询 ${candidates.length} 个哈希，命中 ${hitCount} 个，未命中 ${candidates.length - hitCount} 个，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else {
        log(`[Modrinth] ${aborted}（已查 ${candidates.length} 个，命中 ${hitCount} 个），剩余标记需上传`);
    }

    cleanupStaleTemp();
    const sessionDir = path.join(sync.tempRoot(), TEMP_DIR, newSessionId());

    try {
        for (const e of candidates) {
            const v = matchOf(e);
            if (!v) {
                needUpload.push({ path: e.path, reason: aborted ? 'modrinth_unreachable' : 'not_in_pool_not_in_modrinth' });
                continue;
            }
            // 总预算用尽：剩下的不再下载，直接降级（同步不中断）
            if (Date.now() - t0 > budgetMs) {
                needUpload.push({ path: e.path, reason: 'modrinth_budget_exceeded' });
                continue;
            }
            const file = pickPrimaryFile(v);
            if (!file || !file.url) {
                needUpload.push({ path: e.path, reason: 'modrinth_no_file' });
                continue;
            }

            // 临时文件名用 sha256，避免用 Modrinth 的 filename（不信任）
            const tmpPath = path.join(sessionDir, `${e.sha256}.jar`);
            const remaining = Math.max(5000, budgetMs - (Date.now() - t0));
            const got = await downloadToTemp(file.url, tmpPath, log, e.size || (file.size || 0), remaining);
            if (!got) {
                needUpload.push({ path: e.path, reason: 'modrinth_download_failed' });
                continue;
            }

            const actual = await sync.sha256File(tmpPath);
            if (actual !== e.sha256) {
                log(`[Modrinth] 哈希不匹配 ${e.path}（期望 ${e.sha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…），丢弃`);
                await fs.remove(tmpPath);
                needUpload.push({ path: e.path, reason: 'modrinth_hash_mismatch' });
                continue;
            }

            // 通过校验才落盘；落盘路径一律用清单 path，不用 Modrinth 的 filename
            if (!sync.isPathAllowed(e.path)) {
                await fs.remove(tmpPath);
                needUpload.push({ path: e.path, reason: 'path_not_allowed' });
                continue;
            }
            const target = path.join(schemePath, ...e.path.split('/'));
            await fs.ensureDir(path.dirname(target));
            await fs.move(tmpPath, target, { overwrite: true });
            resolved.push(e.path);
        }
    } finally {
        try { await fs.remove(sessionDir); } catch (_) { /* 忽略 */ }
    }

    return { resolved, needUpload, skipped: aborted || undefined };
}

module.exports = {
    fillFromModrinth,
    cleanupStaleTemp,
    queryHashes,
    pickPrimaryFile,
    userAgent,
    API_BASE,
    BATCH_SIZE,
    BATCH_GAP_MS,
    MAX_CONSECUTIVE_FAILURES,
    TOTAL_BUDGET_MS
};
