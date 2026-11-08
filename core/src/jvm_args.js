/**
 * JVM 参数构建模块（V3.6.2 · 607 指令）
 * ====================================================================
 * 所有「执行 JVM」的路径（server start / Web 面板预览）必须经过本模块，
 * 禁止任何调用方自己 split(" ") 拼参数。
 *
 * 职责（与 607 指令一一对应）：
 *   1. parseArgs        —— 引号感知的参数解析，绝不用 split(" ")
 *   2. GC 互斥清理      —— G1 与 ZGC 参数绝不允许出现在同一条 java 命令里
 *   3. custom 模板兜底  —— 无 -Xmx 时强行注入 -Xmx2G
 *   4. javaagent 独占   —— auth.enable 时剥离用户手填的 -javaagent，
 *                          外置登录 agent 由 wow 独家托管注入
 *   5. 80% 物理内存红线 —— checkMemLimit()，start 前 OOM 防呆拦截
 *
 * 配置结构（新，无历史包袱）：
 *   server.jvm.template      : 'g1' | 'zgc' | 'custom'
 *   server.jvm.override_args : string[]   （Web 端必须传 JSON 数组）
 */

// ==================== 模板 ====================

/**
 * 内置 JVM 模板（V3.6.2 · 607 指令，模板档位 a/b/c/d）。
 * 模板为完整参数集（含各自的 -Xms / -Xmx）；显式 memory（CLI --memory / 面板）
 * 仍可在最终命令里覆盖堆参数。调优微调交给 override_args，
 * G1 与 ZGC 的互斥由 enforceGcExclusivity 绝对保证。
 */
const TEMPLATES = {
    // a = 低配 / 极致省内存
    a: [
        '-Xms512M', '-Xmx2500M', '-XX:SoftMaxHeapSize=1500M',
        '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
        '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
        '-XX:G1ReservePercent=20', '-XX:G1MixedGCCountTarget=4', '-XX:InitiatingHeapOccupancyPercent=20',
        '-XX:SurvivorRatio=32', '-XX:MaxTenuringThreshold=1', '-XX:+DisableExplicitGC',
        '-XX:+UseStringDeduplication', '-XX:G1PeriodicGCInterval=60000',
        '-XX:MaxHeapFreeRatio=30', '-XX:MinHeapFreeRatio=10', '-XX:-ShrinkHeapInSteps',
        '-XX:+UnlockExperimentalVMOptions'
    ],
    // b = 平衡 / 主力首选 / Aikar's 标准
    b: [
        '-Xms1G', '-Xmx4G', '-XX:SoftMaxHeapSize=3G',
        '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
        '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
        '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
        '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
        '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem',
        '-XX:MaxTenuringThreshold=1', '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true'
    ],
    // c = 性能 / ZGC / 低延迟
    c: [
        '-Xms8G', '-Xmx8G', '-XX:+UseZGC', '-XX:+ZGenerational',
        '-XX:+AlwaysPreTouch', '-XX:+DisableExplicitGC'
    ],
    // d = 自定义：完全由 override_args 决定；为空时由兜底逻辑注入 -Xmx2G
    d: []
};

/** 模板中文名（Web 下拉 / CLI 提示用） */
const TEMPLATE_LABELS = {
    a: '低配 / 极致省内存',
    b: "平衡 / 主力首选 / Aikar's 标准",
    c: '性能 / ZGC / 低延迟',
    d: '自定义'
};

/** 旧档位名 → 新档位（g1/zgc/custom 时代的配置平滑落地） */
const TEMPLATE_ALIASES = {
    g1: 'b',
    zgc: 'c',
    custom: 'd'
};

const TEMPLATE_NAMES = Object.keys(TEMPLATES);
const DEFAULT_TEMPLATE = 'b';
const FALLBACK_XMX = '-Xmx2G';

// ==================== 参数解析 ====================

/**
 * 引号感知的参数解析器（607 指令 P0-1：严禁 split(" ")）。
 *
 * 规则：
 *   - 空白（空格 / \t / \n）分隔参数；
 *   - 双引号或单引号包裹的片段是一个参数的组成部分，内部空格不切分；
 *     成对引号在输出中被剥掉（java 本身不认识 shell 引号，路径要的是解完的结果）：
 *       `-Djava.library.path="C:\Program Files\xxx"` → 单元素 `-Djava.library.path=C:\Program Files\xxx`
 *   - 未闭合的引号容错处理：取到字符串末尾。
 *
 * @param {string} input
 * @returns {string[]}
 */
function parseArgs(input) {
    const s = String(input == null ? '' : input);
    const out = [];
    let cur = '';
    let quote = null;   // 当前未闭合的引号字符（'"' 或 "'"）
    let hasCur = false; // cur 是否有内容（含「纯引号空串」的情况）
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
            if (ch === quote) quote = null;
            else cur += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            hasCur = true;
        } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            if (hasCur) { out.push(cur); cur = ''; hasCur = false; }
        } else {
            cur += ch;
            hasCur = true;
        }
    }
    if (hasCur) out.push(cur);
    return out;
}

/**
 * 把 override_args 规整成字符串数组：
 *   - 数组 → 逐项 parseArgs 后摊平（JSON 数组的元素是「一行」：
 *     引号包裹的空格路径被解引号合并成单参数，一行多参数也能正确拆开）；
 *   - 字符串（用户手滑填了一行长串）→ parseArgs；
 *   - 其他 → 空数组。
 * @param {*} override
 * @returns {string[]}
 */
function normalizeOverride(override) {
    if (Array.isArray(override)) {
        return override.flatMap(a => parseArgs(String(a == null ? '' : a))).filter(Boolean);
    }
    if (typeof override === 'string') return parseArgs(override);
    return [];
}

// ==================== GC 互斥 ====================

/** 是否为 G1 专属参数：UseG1GC 或 -XX:G1xxx（如 G1NewSizePercent / G1HeapRegionSize） */
function isG1Flag(arg) {
    return /^-XX:(\+|-)?UseG1GC$/.test(arg) || /^-XX:(\+|-)?G1[A-Za-z0-9]/.test(arg);
}

/** 是否为 ZGC 专属参数：UseZGC 或 -XX:Zxxx（如 ZCollectionInterval / ZGenerational） */
function isZgcFlag(arg) {
    return /^-XX:(\+|-)?UseZGC$/.test(arg) || /^-XX:(\+|-)?Z[A-Za-z0-9]/.test(arg);
}

/** 是否为 javaagent 参数 */
function isJavaagent(arg) {
    return /^-javaagent(:|$)/.test(arg);
}

/**
 * GC 互斥清理（607 指令 P0-2 · 绝对铁律）。
 *
 * 规则：override_args 里显式声明的 GC 赢——
 *   - override 含 UseZGC → 剥掉所有 G1 专属参数；
 *   - override 含 UseG1GC → 剥掉所有 ZGC 专属参数；
 *   - 极端情况（override 同时写了两种）→ 按「含 UseZGC 优先」处理（先剥 G1，
 *     随后互斥复查再剥一次残留），保证任意输入下最终数组只含一种 GC。
 *
 * @param {string[]} args 模板与 override 合并后的数组
 * @param {string[]} overrideArgs 原始 override（判定「谁显式声明了 GC」）
 * @returns {{args: string[], removed: string[]}}
 */
function enforceGcExclusivity(args, overrideArgs) {
    const ov = overrideArgs || [];
    const ovHasZ = ov.some(isZgcFlag);
    const ovHasG1 = ov.some(isG1Flag);

    let dropG1 = false;
    let dropZ = false;
    if (ovHasZ) dropG1 = true;          // ZGC 声明 → G1 全剥
    else if (ovHasG1) dropZ = true;     // G1 声明 → ZGC 全剥
    else {
        // override 没声明 GC：若模板/合并结果同时存在两种（异常配置），保留先出现的那个
        const firstG1 = args.findIndex(isG1Flag);
        const firstZ = args.findIndex(isZgcFlag);
        if (firstG1 >= 0 && firstZ >= 0) {
            if (firstZ < firstG1) dropG1 = true; else dropZ = true;
        }
    }

    const removed = [];
    const kept = args.filter(a => {
        if (dropG1 && isG1Flag(a)) { removed.push(a); return false; }
        if (dropZ && isZgcFlag(a)) { removed.push(a); return false; }
        return true;
    });

    // 互斥复查：任意输入下都不得两种 GC 并存
    let hasZ = kept.some(isZgcFlag);
    let hasG1 = kept.some(isG1Flag);
    if (hasZ && hasG1) {
        // 默认保 ZGC（与上方「ZGC 优先」一致）
        for (let i = kept.length - 1; i >= 0; i--) {
            if (isG1Flag(kept[i])) { removed.push(kept[i]); kept.splice(i, 1); }
        }
    }
    return { args: kept, removed };
}

// ==================== 内存红线 ====================

/**
 * 「4G」「512M」「1024K」或纯字节数 → 字节。无法解析返回 null。
 * @param {string} text
 * @returns {number|null}
 */
function toBytes(text) {
    const m = /^(\d+(?:\.\d+)?)\s*([kKmMgGtT]?)$/.exec(String(text == null ? '' : text).trim());
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2].toUpperCase();
    const mul = unit === 'T' ? 1024 ** 4 : unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1;
    return Math.floor(n * mul);
}

function formatBytes(bytes) {
    if (bytes == null || !Number.isFinite(bytes)) return '?';
    const g = bytes / (1024 ** 3);
    if (g >= 1) return `${Number(g.toFixed(2))}G`;
    const m = bytes / (1024 ** 2);
    return `${Number(m.toFixed(1))}M`;
}

/**
 * 从参数数组里取 -Xmx（第一个）的字节数。没有 -Xmx 返回 null。
 * @param {string[]} args
 * @returns {number|null}
 */
function parseXmxBytes(args) {
    const hit = (args || []).find(a => /^-Xmx/.test(a));
    if (!hit) return null;
    return toBytes(hit.slice(4));
}

/**
 * 80% 物理内存红线（607 指令 P1-1）。
 * @param {string[]} args 最终 JVM 参数数组
 * @param {number} totalBytes os.totalmem()
 * @param {number} [ratio=0.8]
 * @returns {{ok:boolean, xmxBytes:number|null, limitBytes:number, totalBytes:number,
 *            xmxText:string, totalText:string, message?:string}}
 */
function checkMemLimit(args, totalBytes, ratio = 0.8) {
    const limitBytes = Math.floor(totalBytes * ratio);
    const xmxBytes = parseXmxBytes(args);
    const base = {
        xmxBytes,
        limitBytes,
        totalBytes,
        xmxText: xmxBytes == null ? '(未指定)' : formatBytes(xmxBytes),
        totalText: formatBytes(totalBytes)
    };
    if (xmxBytes == null || xmxBytes <= limitBytes) return { ok: true, ...base };
    return {
        ok: false,
        ...base,
        message: `❌ 内存分配过高：当前系统物理内存 ${formatBytes(totalBytes)}，`
            + `您分配的 -Xmx 为 ${formatBytes(xmxBytes)}。`
            + `请调低 server.jvm.template 或 override_args 中的 -Xmx，否则服务器会因系统 OOM 被杀。`
    };
}

// ==================== 构建主流程 ====================

/**
 * 构建 JVM 参数（607 指令完整链路：模板 → 合并 override → GC 互斥 → 兜底 → agent 过滤）。
 *
 * @param {object} opts
 * @param {string} [opts.template]        g1 | zgc | custom（未知值按 custom 处理并在 warnings 提示）
 * @param {string|string[]} [opts.override] override_args（数组或一行长串）
 * @param {string} [opts.heap]            堆大小，替换模板 {heap}，如 '4G'；默认 2G
 * @param {boolean} [opts.filterJavaagent] true 时剥离所有 -javaagent（auth.enable 时必须传 true）
 * @returns {{args:string[], removed:string[], injected:string[], warnings:string[]}}
 */
function buildJvmArgs(opts = {}) {
    const warnings = [];
    let template = String(opts.template || DEFAULT_TEMPLATE).trim();
    // 旧档位名平滑映射（g1→b / zgc→c / custom→d）
    if (TEMPLATE_ALIASES[template]) template = TEMPLATE_ALIASES[template];
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, template)) {
        warnings.push(`未知模板「${template}」，已按 d（自定义）处理（可用：${TEMPLATE_NAMES.join(' / ')}）`);
        template = 'd';
    }

    // 模板为完整参数集，heap 不再进模板；仅当显式指定 memory 时由调用方覆盖堆参数
    const tplArgs = [...TEMPLATES[template]];

    // 2. 合并 override（模板在前，override 在后——后者是用户意图，互斥时赢）
    const ovArgs = normalizeOverride(opts.override);
    let merged = [...tplArgs, ...ovArgs];
    let removed = [];
    let injected = [];

    // 2.5 override 显式给出 -Xmx / -Xms 时，压掉模板层的同类项：
    //     JVM 只认第一个同名参数，不去重的话用户的堆设置会被模板顶掉。
    const ovXmx = ovArgs.find(a => /^-Xmx/.test(a));
    const ovXms = ovArgs.find(a => /^-Xms/.test(a));
    if (ovXmx || ovXms) {
        merged = merged.filter((a, idx) => {
            if (idx >= tplArgs.length) return true;   // 只压模板层
            if (ovXmx && /^-Xmx/.test(a)) { removed.push(a); return false; }
            if (ovXms && /^-Xms/.test(a)) { removed.push(a); return false; }
            return true;
        });
    }

    // 3. GC 互斥（绝对铁律）
    const gc = enforceGcExclusivity(merged, ovArgs);
    merged = gc.args;
    removed.push(...gc.removed);

    // 4. d（自定义）兜底：没有任何 -Xmx 时强行注入，防止 JVM 默认堆过小直接起不来
    if (template === 'd' && !merged.some(a => /^-Xmx/.test(a))) {
        merged.push(FALLBACK_XMX);
        injected.push(FALLBACK_XMX);
    }

    // 5. javaagent 独占：外置登录 agent 由 wow 独家托管，用户手填的一律剥掉
    if (opts.filterJavaagent) {
        for (let i = merged.length - 1; i >= 0; i--) {
            if (isJavaagent(merged[i])) {
                removed.push(merged[i]);
                merged.splice(i, 1);
            }
        }
    }

    return { args: merged, removed, injected, warnings };
}

/**
 * 显式 memory（CLI --memory / 面板指定）覆盖最终参数里的 -Xmx / -Xms。
 * 模板自带堆参数时被替换、没有时补齐；仅用于「显式指定」的场景——
 * start() 的默认值不算（否则 override_args 里的 -Xmx 会被静默顶掉）。
 * @param {string[]} args
 * @param {string} memory 如 '4G'
 * @returns {{args:string[], changed:boolean}}
 */
function applyMemoryOverride(args, memory) {
    const m = String(memory == null ? '' : memory).trim();
    if (!m || !/^(\d+(?:\.\d+)?)[kKmMgGtT]?$/.test(m)) return { args: [...args], changed: false };
    let hadXmx = false;
    const out = args.map(a => {
        if (/^-Xmx/.test(a)) { hadXmx = true; return '-Xmx' + m; }
        if (/^-Xms/.test(a)) return '-Xms' + m;
        return a;
    });
    if (!hadXmx) {
        out.unshift('-Xmx' + m);
        out.push('-Xms' + m);
    }
    return { args: out, changed: true };
}

module.exports = {
    TEMPLATES,
    TEMPLATE_LABELS,
    TEMPLATE_ALIASES,
    TEMPLATE_NAMES,
    DEFAULT_TEMPLATE,
    FALLBACK_XMX,
    parseArgs,
    normalizeOverride,
    isG1Flag,
    isZgcFlag,
    isJavaagent,
    enforceGcExclusivity,
    toBytes,
    formatBytes,
    parseXmxBytes,
    checkMemLimit,
    buildJvmArgs,
    applyMemoryOverride
};
