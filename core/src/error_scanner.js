/**
 * 本地初级错误诊断器（error_scanner）
 * ----------------------------------------------------------------
 * 目的：服务器异常退出时，在**不发网络请求**的前提下，尽可能判断
 *      「崩在哪、是哪个模组干的、下一步该执行什么命令」。
 *
 * 与 `wow logs analyze` 的分工：
 *   - 本模块：纯正则 + 本地模组扫描，覆盖已知高频崩溃类型，毫秒级、离线可用；
 *   - AI 分析：需要联网与 API Key，用于处理本模块覆盖不到或定位不到模组的情况。
 *
 * 设计要点：
 *   1. 错误字典与提示语分离（ERROR_PATTERNS 存 i18n key，MESSAGES 存文案），
 *      便于后续加语言包而不动匹配逻辑；
 *   2. 模组名提取必须「有证据」——只认方括号标签与堆栈包名两路，
 *      且排除原版/API 包名，宁可报「未知」也不猜；
 *   3. 高危建议的命令在此处集中生成，避免提示「安装了不存在的命令」。
 */

const fs = require('fs-extra');
const path = require('path');

// ==================== 终端配色 ====================

/**
 * 极简 ANSI 封装。
 * - 非 TTY（重定向到文件/管道）时自动关闭，避免日志里混入转义字符；
 * - 尊重 NO_COLOR 环境变量（https://no-color.org）。
 */
const COLOR_ENABLED = (() => {
    if (process.env.NO_COLOR) return false;
    if (process.env.FORCE_COLOR) return true;
    return Boolean(process.stdout && process.stdout.isTTY);
})();

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
};

function paint(text, ...styles) {
    if (!COLOR_ENABLED || !styles.length) return String(text);
    const codes = styles.map(s => ANSI[s]).filter(Boolean).join('');
    return `${codes}${text}${ANSI.reset}`;
}

/** 去掉 ANSI，供测试断言纯文本 */
function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

// ==================== i18n ====================
//
// 结构固定为 { zh: {...}, en: {...} }，通过 setLocale() 切换。
// 新增语言只需补一份同 key 的表。

const MESSAGES = {
    zh: {
        // —— 错误类型名称 ——
        'err.unsupported_class_version': 'Java 版本过低',
        'err.out_of_memory': '内存溢出',
        'err.bind_exception': '端口被占用',
        'err.eula': '未同意 EULA',
        'err.no_class_def': '找不到类',
        'err.mixin_failed': 'Mixin 注入失败',
        'err.missing_dependency': '缺少前置模组',
        'err.client_mod': '客户端专属模组被装入服务端',
        'err.mixin_conflict': 'Mixin 冲突',

        // —— 原因说明 ——
        'why.unsupported_class_version': '服务端字节码版本高于当前 Java，常见于用 Java 17 跑 1.20.5+ 核心，或反过来。',
        'why.out_of_memory': '分配给服务端的堆内存不足，或被模组的内存泄漏拖垮。',
        'why.bind_exception': '服务端要监听的端口已被其他进程占用（常见是上一个服务端没退干净，或另一个程序占了 25565）。',
        'why.eula': 'Minecraft 服务端首次启动需要同意 EULA，否则会立即退出。',
        'why.no_class_def': '运行时找不到某个类，通常是模组版本与核心/其他模组不匹配，或前置模组缺失。',
        'why.mixin_failed': 'Mixin 注入失败，通常由两个模组改同一个类、或模组版本与核心不兼容引起。',
        'why.missing_dependency': '有模组声明了强制前置，但 mods 目录里没有对应模组。',
        'why.client_mod': '该模组只在客户端生效（渲染、UI、光影等），放进服务端会在初始化阶段直接抛错。',
        'why.mixin_conflict': '多个模组同时修改同一个类，Mixin 处理器无法决定注入顺序。',

        // —— 建议（{mod} / {missing} 为占位符）——
        'fix.unsupported_class_version': [
            '执行 `wow init` 重新检测并切换 Java 版本；',
            '若使用固定版本，可执行 `wow config set jre.version <版本号>`。'
        ],
        'fix.out_of_memory': [
            '调大内存：`wow config set server.memory 4G`；',
            '若模组较多，建议 4G 起；定位内存泄漏可先移除近期新增的模组。'
        ],
        'fix.bind_exception': [
            '确认没有残留的服务端进程：`wow server status`、`wow server kill`；',
            '或改用其他端口：`wow config set server.port 25566`（修改 server.properties）。'
        ],
        'fix.eula': [
            '执行 `wow server start` 按提示同意，或手动编辑 eula.txt 将 eula=false 改为 eula=true。'
        ],
        'fix.no_class_def': [
            '检查模组版本是否与当前核心匹配；',
            '若近期新增过模组，先移除再试：`wow mod remove {mod}`。'
        ],
        'fix.mixin_failed': [
            '移除报错模组：`wow mod remove {mod}`；',
            '若无法确定是哪个，尝试 `wow mod toggle {mod}` 逐个二分排查。'
        ],
        'fix.missing_dependency': [
            '缺失的前置无法通过命令行一键安装（wow 暂未提供 `mod install`）；',
            '请手动下载 {missing} 放入 mods 目录，或使用 `wow` 菜单中的「模组搜索下载」。'
        ],
        'fix.client_mod': [
            '移除该客户端模组：`wow mod remove {mod}`；',
            '若移除后依然崩溃，请尝试 `wow mod sync` 重新同步服务端环境。'
        ],
        'fix.mixin_conflict': [
            '用 `wow mod toggle {mod}` 逐个禁用，二分定位冲突模组；',
            '确认冲突双方的版本是否都为服务端适配版本。'
        ],

        // —— 通用降级 ——
        'generic.advice': [
            '如果刚刚新增过模组或更换过核心，先回退到上一次可用的配置；',
            '确认 Java 版本与核心匹配：`wow server status`。'
        ],
        'fallback.ai_hint': '未能精准定位报错模组。你可以使用 wow logs analyze 调用 AI 进行深度解析。',
        'no_error_found': '日志中未匹配到已知错误特征，可能不是服务端自身的问题。',
        'no_log': '未找到服务端日志，无法进行诊断。',

        // —— 输出标题 ——
        'title.diagnosing': '正在进行本地初级诊断...',
        'title.error': '【明确报错】',
        'title.accompany': '【疑似冲突】伴随模组',
        'title.advice': '【wow 建议】',
        'label.mod': '模组',
        'label.reason': '原因',
        'label.context': '上下文',
        'label.unknown_mod': '未知'
    },
    en: {
        'err.unsupported_class_version': 'Java version too low',
        'err.out_of_memory': 'Out of memory',
        'err.bind_exception': 'Port already in use',
        'err.eula': 'EULA not accepted',
        'err.no_class_def': 'Class not found',
        'err.mixin_failed': 'Mixin apply failed',
        'err.missing_dependency': 'Missing required dependency',
        'err.client_mod': 'Client-only mod on server',
        'err.mixin_conflict': 'Mixin conflict',

        'why.unsupported_class_version': 'Bytecode version exceeds the current Java runtime.',
        'why.out_of_memory': 'Not enough heap memory, or a mod is leaking.',
        'why.bind_exception': 'The server port is already bound by another process.',
        'why.eula': 'Minecraft requires the EULA to be accepted on first launch.',
        'why.no_class_def': 'A class is missing at runtime, usually a version mismatch.',
        'why.mixin_failed': 'Mixin injection failed, usually two mods patching the same class.',
        'why.missing_dependency': 'A mod requires another mod that is not present in mods/.',
        'why.client_mod': 'This mod is client-only and cannot run on a server.',
        'why.mixin_conflict': 'Multiple mods patch the same class.',

        'fix.unsupported_class_version': [
            'Run `wow init` to detect and switch Java;',
            'Or pin a version: `wow config set jre.version <version>`.'
        ],
        'fix.out_of_memory': [
            'Increase memory: `wow config set server.memory 4G`;',
            'Remove recently added mods if a leak is suspected.'
        ],
        'fix.bind_exception': [
            'Check for a leftover process: `wow server status`, `wow server kill`;',
            'Or change the port in server.properties.'
        ],
        'fix.eula': ['Run `wow server start` and accept, or set eula=true in eula.txt.'],
        'fix.no_class_def': [
            'Verify mod versions match the core;',
            'Remove the offending mod: `wow mod remove {mod}`.'
        ],
        'fix.mixin_failed': [
            'Remove the offending mod: `wow mod remove {mod}`;',
            'Or bisect with `wow mod toggle {mod}`.'
        ],
        'fix.missing_dependency': [
            'wow does not provide `mod install` yet;',
            'Download {missing} manually into mods/, or use the interactive mod search.'
        ],
        'fix.client_mod': [
            'Remove it: `wow mod remove {mod}`;',
            'If it still crashes, run `wow mod sync`.'
        ],
        'fix.mixin_conflict': [
            'Bisect with `wow mod toggle {mod}`;',
            'Make sure both mods support the server side.'
        ],

        'generic.advice': [
            'Roll back the most recent mod/core change;',
            'Verify the Java version matches the core.'
        ],
        'fallback.ai_hint': 'Could not pinpoint the offending mod. Run `wow logs analyze` for AI analysis.',
        'no_error_found': 'No known error signature found in the log.',
        'no_log': 'Server log not found; cannot diagnose.',

        'title.diagnosing': 'Running local diagnosis...',
        'title.error': '[Error]',
        'title.accompany': '[Suspected conflict] Related mods',
        'title.advice': '[wow advice]',
        'label.mod': 'Mod',
        'label.reason': 'Reason',
        'label.context': 'Context',
        'label.unknown_mod': 'unknown'
    }
};

let currentLocale = 'zh';

function setLocale(locale) {
    if (MESSAGES[locale]) currentLocale = locale;
}

/** 取当前语言的文案；缺失时回落到 zh，再缺失返回 key 本身 */
function t(key) {
    const table = MESSAGES[currentLocale] || MESSAGES.zh;
    if (key in table) return table[key];
    if (key in MESSAGES.zh) return MESSAGES.zh[key];
    return key;
}

// ==================== 错误字典 ====================

/**
 * 每个条目：
 *   id      —— 内部标识，同时用于拼 i18n key
 *   test    —— 判定函数（对单行文本）
 *   severity—— high / medium / low
 *   hint    —— 生成建议时需要的特殊参数（可选）
 *
 * 顺序即优先级：越靠前越具体，先命中先返回。
 * 例如 OutOfMemoryError 会先于通用的 NoClassDefFoundError 命中。
 */
const ERROR_PATTERNS = [
    {
        id: 'eula',
        severity: 'high',
        // 与模组无关：属于服务端配置问题，不需要定位模组
        modRelevant: false,
        // EULA 提示行在日志里长这样： "You need to agree to the EULA in order to run the server."
        test: line => /You need to agree to the EULA|agree to the EULA/i.test(line)
    },
    {
        id: 'out_of_memory',
        severity: 'high',
        modRelevant: false,
        test: line => /java\.lang\.OutOfMemoryError|OutOfMemoryError|unable to create new native thread|java heap space/i.test(line)
    },
    {
        id: 'unsupported_class_version',
        severity: 'high',
        modRelevant: false,
        test: line => /UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime|class file version \d+/i.test(line)
    },
    {
        id: 'bind_exception',
        severity: 'high',
        modRelevant: false,
        test: line => /java\.net\.BindException|Address already in use|FAILED TO BIND TO PORT/i.test(line)
    },
    {
        id: 'missing_dependency',
        severity: 'high',
        modRelevant: true,
        // Fabric: "Missing or unsupported mandatory dependencies:" / Forge: "Missing or unsupported mandatory dependencies"
        test: line => /Missing or unsupported mandatory dependencies|which is missing!|requires .* which is missing|Mod .* requires /i.test(line)
    },
    {
        id: 'client_mod',
        severity: 'high',
        modRelevant: true,
        // 客户端类被服务端加载：NoClassDefFoundError: net/minecraft/client/...
        test: line => /net[\/.]minecraft[\/.]client|client\.MinecraftClient|net\.minecraft\.client\./i.test(line)
    },
    {
        id: 'mixin_failed',
        severity: 'medium',
        modRelevant: true,
        test: line => /Mixin apply failed|MixinApplyError|Mixin transformation of .* failed|mixin\.(injection|InvalidMixin)/i.test(line)
    },
    {
        id: 'no_class_def',
        severity: 'medium',
        modRelevant: true,
        test: line => /java\.lang\.NoClassDefFoundError|java\.lang\.ClassNotFoundException|NoClassDefFoundError/i.test(line)
    },
    {
        id: 'mixin_conflict',
        severity: 'medium',
        modRelevant: true,
        test: line => /Mixin conflict|conflicting mixins|Multiple mixins .* same target/i.test(line)
    }
];

// ==================== 模组名提取 ====================

/** 包名里的泛化段：出现在各级包名中，但不指向任何具体模组 */
const GENERIC_PACKAGE_SEGS = new Set([
    'mods', 'mod', 'lib', 'libs', 'core', 'api', 'client', 'server', 'common',
    'util', 'utils', 'impl', 'internal', 'base', 'main', 'entry', 'entrypoint',
    'loader', 'loaders', 'runtime', 'platform', 'shared', 'mixin', 'mixins',
    'init', 'event', 'events', 'config', 'registry', 'network', 'networking',
    'render', 'rendering', 'world', 'entity', 'entities', 'block', 'item',
    'components', 'compat', 'integration', 'test', 'tests', 'lang', 'data',
    'resources', 'assets', 'version', 'build', 'tools', 'command', 'commands'
]);

/** 组织域前缀 */
const VENDOR_ORGS = new Set(['com', 'org', 'net', 'io', 'dev', 'me', 'gg', 'xyz', 'co']);

/** 两字母国家/地区域名（de.maxhenkel、uk.co.foo）：不具辨识度，需跳过 */
const CC_TLDS = new Set([
    'de', 'uk', 'fr', 'jp', 'cn', 'ru', 'br', 'nl', 'se', 'no', 'fi', 'dk',
    'pl', 'it', 'es', 'pt', 'kr', 'tw', 'hk', 'au', 'ca', 'us', 'ch', 'at',
    'be', 'cz', 'tr', 'in', 'mx', 'ar', 'za', 'sg', 'my', 'th', 'vn', 'id'
]);

/** 文件扩展名：末段是这些时说明整条是文件名而非 Java 包 */
const FILE_EXTS = new Set([
    'json', 'json5', 'yml', 'yaml', 'toml', 'txt', 'log', 'xml', 'cfg',
    'conf', 'properties', 'jar', 'zip', 'gz', 'cfg'
]);

/** 这些段出现在包名第二级时，通常说明「后面还有真名」，不应把本级当 modid */
const ORG_LIKE_SEGS = new Set(['client', 'common', 'core', 'api', 'lib', 'libs', 'impl']);

/** 原版与加载器自身的顶层包名（出现在首段时整条包都可忽略） */
const ORIGINAL_ORGS = new Set(['minecraft', 'mojang', 'fabricmc', 'fabric',
    'forge', 'minecraftforge', 'neoforge', 'quiltmc', 'quilt',
    'sun', 'com.sun', 'jdk', 'jdk.internal', 'java', 'javax',
    'netty', 'spongepowered', 'objectweb', 'apache', 'google']);

/** 官方/自家库的二级段：出现在组织域之后时说明整条包不是第三方模组 */
const VENDOR_LIBS = new Set([
    'mojang', 'google', 'apache', 'authlib', 'jopt',
    'spongepowered', 'netty', 'slf4j', 'log4j', 'objectweb', 'ow2', 'asm'
]);

/** 这些包名属于原版 / 加载器 / 常用 API，不代表具体模组 */
const IGNORED_PACKAGES = new Set([
    'minecraft', 'mojang', 'fabricmc', 'fabric', 'forge', 'minecraftforge',
    'neoforge', 'quiltmc', 'quilt', 'spongepowered', 'mixins', 'mixinextras',
    'java', 'javax', 'jdk', 'sun', 'com', 'org', 'net', 'io', 'kotlin',
    'scala', 'groovy', 'slf4j', 'log4j', 'apache', 'google', 'gson',
    'objectweb', 'asm', 'ow2', 'jetbrains', 'intellij'
]);

/** 方括号里这些不是模组名 */
const IGNORED_BRACKETS = new Set([
    'error', 'warn', 'warning', 'info', 'debug', 'trace', 'fatal', 'main',
    'server', 'client', 'thread', 'netty', 'worker', 'server thread',
    'render thread', 'minecraft', 'modloading', 'modloader', 'mod loading',
    'prelaunch', 'bootstraplauncher', 'launcher', 'minecraft server',
    'text', 'json', 'empty', 'default', 'unknown'
]);

/**
 * 日志前缀判定用的「级别词」集合。
 * 注意：早期版本用 `[A-Z]+` 泛指大写词，在 i 标志下会把任意单词
 * （含 sodium、create 这类模组名）一起匹配掉，因此改为显式白名单。
 */
const LOG_LEVEL_WORDS = new Set([
    'info', 'warn', 'warning', 'error', 'fatal', 'debug', 'trace', 'severe',
    'fine', 'finer', 'finest', 'config', 'note', 'all', 'off', 'stdout', 'stderr'
]);

/** 方括号内容是否属于「日志前缀」而非真实标签 */
function isLogPrefix(raw) {
    const s = String(raw || '').trim();
    if (!s) return true;
    // 纯时间：12:00:00 / 12:00:00.123
    if (/^\d{2}:\d{2}(:\d{2})?([.,]\d+)?$/.test(s)) return true;
    // 线程名/级别：main/INFO、Server thread/WARN、Worker-Main-1/ERROR
    if (/^[^\s\/]+\/(INFO|WARN|WARNING|ERROR|FATAL|DEBUG|TRACE|SEVERE|FINE)$/i.test(s)) return true;
    // 纯级别词：[INFO] [ERROR] [WARN]
    if (LOG_LEVEL_WORDS.has(s.toLowerCase())) return true;
    // 路径：交给后续逻辑取文件名，这里不算前缀
    if (s.includes('/') || s.includes('\\')) return false;
    return false;
}

/** 客户端专属 / 渲染类模组的已知 ID，用于「误装」与「疑似冲突」判断 */
const CLIENT_MOD_IDS = new Set([
    'sodium', 'iris', 'optifine', 'optifabric', 'canvas', 'embeddium',
    'rubidium', 'magnesium', 'oculus', 'shaders', 'replaymod', 'litematica',
    'minihud', 'xaeros_minimap', 'xaerominimap', 'xaeroworldmap', 'journeymap',
    'wthit', 'jade', 'modmenu', 'betterf3', 'ctm', 'continuity',
    'entityculling', 'dynamiclights', 'farsight', 'bobby'
]);

/** 同属「渲染/画面层」的模组：同时存在极易底层冲突 */
const RENDER_CLASS_IDS = new Set([
    'sodium', 'iris', 'optifine', 'optifabric', 'canvas', 'embeddium',
    'rubidium', 'magnesium', 'oculus', 'shaders', 'starlight', 'phosphor',
    'lithium', 'ferritecore', 'entityculling', 'dynamiclights'
]);

/**
 * 占位名/无意义名：出现时一律视为「没提取到模组」。
 * 这些词在日志里高频出现，但从不指向真实模组。
 */
const PLACEHOLDER_IDS = new Set([
    'unknown', 'unnamed', 'example', 'mod', 'mods', 'some', 'foo', 'bar',
    'test', 'demo', 'sample', 'yourmod', 'mymod', 'class', 'main', 'null'
]);

/** 判断一个候选 ID 是否可信（不是占位名/泛化词） */
function isPlausibleModId(id) {
    const s = String(id || '').toLowerCase();
    if (!s || s.length < 2) return false;
    if (PLACEHOLDER_IDS.has(s)) return false;
    if (IGNORED_PACKAGES.has(s) || GENERIC_PACKAGE_SEGS.has(s)) return false;
    if (IGNORED_BRACKETS.has(s)) return false;
    // 纯数字或纯符号
    if (!/[a-z]/.test(s)) return false;
    return true;
}

/**
 * 把 `mod`、`mod-1.20.1`、`mod_fabric`、`Sodium-1.2.3.jar` 之类归一成裸 ID。
 * 只做去版本号 / 去加载器标记 + 小写，不猜语义。
 */
function normalizeModId(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/\.(jar|zip)$/i, '');

    // 反复剥离尾部「版本号」与「加载器/平台标记」，直到稳定。
    // 例：sodium-fabric-0.5.8 → sodium-fabric → sodium
    //     iris-mc1.20.1-1.6 → iris-mc1.20.1 → iris-mc → iris
    //     jei-1.20.1-forge-15.2 → jei-1.20.1-forge → jei-1.20.1 → jei
    const NOISE_TAIL = /(?:[-_.])(?:v?\d+(?:[._]\d+)*|mc\d+(?:[._]\d+)*|fabric|forge|neoforge|quilt|common|universal|server|client|api)$/i;
    let prev;
    do {
        prev = s;
        s = s.replace(NOISE_TAIL, '');
    } while (s !== prev && s.length >= 2);

    s = s.toLowerCase().replace(/\s+/g, '');
    return s;
}

/**
 * 从单行中提取模组候选。
 * @returns {Array<{id:string, kind:'bracket'|'package', weight:number}>}
 *   kind=bracket 来自方括号标签（可信度高）
 *   kind=package 来自堆栈包名（可信度取决于深度）
 */
function extractModsFromLineDetailed(line) {
    const found = [];

    // —— 路径 1：方括号标签，如 [sodium] [/home/mods/iris.jar] [ModernFix] ——
    const bracketRe = /\[([^\[\]]{1,80})\]/g;
    let m;
    while ((m = bracketRe.exec(line)) !== null) {
        const raw = m[1].trim();
        if (!raw) continue;
        // 跳过日志前缀：[12:00:00]、[main/INFO]、[Server thread/WARN]
        if (isLogPrefix(raw)) continue;
        // 纯路径：取文件名
        const base = raw.includes('/') || raw.includes('\\')
            ? raw.split(/[\/\\]/).pop()
            : raw;
        // 形如 "minecraft/MinecraftServer" 的类路径不是模组名
        if (/^[a-z0-9_$]+\/[A-Za-z0-9_$/]+$/.test(base)) continue;
        // "main/INFO" 已在上方过滤，这里再兜一层
        if (/^[^\s\/]+\/[A-Z]+\s*$/.test(base)) continue;
        const lower = base.toLowerCase();
        if (IGNORED_BRACKETS.has(lower)) continue;
        // 含版本号/空格的多词标签，取首个 token 作为候选（如 "Sodium 0.5.8"）
        const firstToken = base.split(/\s+/)[0];
        // mixins.xxx.json / xxx.mixins.json 这类是 Mixin 配置文件，不是模组名
        if (/^mixins?$/i.test(firstToken) || /\.mixins$/i.test(firstToken)) continue;
        if (/^(mixins?\.[\w.-]+|[\w.-]+\.mixins)(\.json)?$/i.test(base)) continue;
        if (/^(unknown|unnamed|example)$/i.test(firstToken)) continue;
        const id = normalizeModId(firstToken);
        if (id && id.length >= 2 && !IGNORED_BRACKETS.has(id)) {
            found.push({ id, kind: 'bracket', weight: 100 });
        }
    }

    // —— 路径 2：Java 包名，如 com.example.modid.SomeClass ——
    // 只抓「3 段及以上」的包路径，避免把单个单词当包名
    const pkgRe = /\b((?:[a-z][a-z0-9_]*\.){2,}[A-Za-z][A-Za-z0-9_$]*)\b/g;
    while ((m = pkgRe.exec(line)) !== null) {
        const segments = m[1].split('.');
        // 末段是类名，不算包
        const pkgSegs = segments.slice(0, -1);
        if (!pkgSegs.length) continue;
        // 排除文件名：mixins.unknown.json / foo.bar.yml —— 末段是文件扩展名
        const last = segments[segments.length - 1].toLowerCase();
        if (FILE_EXTS.has(last)) continue;

        // —— 判定整条包是否属于「原版 / 加载器 / 官方库」——
        const org = (pkgSegs[0] || '').toLowerCase();
        const second = (pkgSegs[1] || '').toLowerCase();

        // 官方/自家库：com.mojang.authlib、org.spongepowered.asm、io.netty.channel
        if (VENDOR_ORGS.has(org) && VENDOR_LIBS.has(second)) continue;
        // 原版与加载器自身
        if (IGNORED_PACKAGES.has(org) && ORIGINAL_ORGS.has(org)) continue;

        // —— 取「最后一个有辨识度的段」——
        // 包结构通常是 组织.作者.modid.子包，modid 靠后；
        // 从后往前找，第一个不是泛化词的段通常就是 modid。
        // 例：net.caffeinemc.mods.sodium.client → client(泛) → sodium ✓
        //     com.example.modid               → modid ✓
        //     vazkii.botania.common            → common(泛) → botania ✓
        let candidate = null;
        for (let i = pkgSegs.length - 1; i >= 0; i--) {
            const seg = pkgSegs[i].toLowerCase();
            if (!seg) continue;
            if (IGNORED_PACKAGES.has(seg) || GENERIC_PACKAGE_SEGS.has(seg)) continue;
            if (CC_TLDS.has(seg)) continue;
            candidate = pkgSegs[i];
            break;
        }
        if (!candidate) continue;

        const lower = candidate.toLowerCase();
        if (lower.length < 2) continue;

        // 若从后往前找到的第一段就是组织域/作者名的位置（索引 0/1），
        // 说明整条包没有可辨识的 modid 段，放弃
        const idx = pkgSegs.findIndex(s => s === candidate);
        if (idx <= 1 && pkgSegs.length > 3) continue;

        found.push({ id: normalizeModId(candidate), kind: 'package', weight: 20 + idx * 5 });
    }

    return found;
}

/**
 * 兼容旧签名：只返回去重后的 ID 列表（按权重降序）。
 */
function extractModIdsFromLine(line) {
    const seen = new Set();
    const out = [];
    for (const item of extractModsFromLineDetailed(line).sort((a, b) => b.weight - a.weight)) {
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item.id);
    }
    return out;
}

/**
 * 从「上下文窗口」里提取模组：离报错行越近权重越高。
 * @param {string[]} lines 全量日志行
 * @param {number} index   报错行下标
 * @param {number} radius  前后各看多少行
 * @returns {Array<{id:string, distance:number, hit:number}>} 按可信度排序
 */
function extractModIdsFromContext(lines, index, radius = 10) {
    const start = Math.max(0, index - radius);
    const end = Math.min(lines.length - 1, index + radius);
    const stats = new Map();

    for (let i = start; i <= end; i++) {
        const distance = Math.abs(i - index);
        const items = extractModsFromLineDetailed(lines[i]);
        for (const item of items) {
            if (!item.id) continue;
            if (!stats.has(item.id)) {
                stats.set(item.id, { id: item.id, distance, hit: 0, weight: 0, kinds: new Set() });
            }
            const rec = stats.get(item.id);
            rec.hit++;
            rec.kinds.add(item.kind);
            // 同一模组在多行出现时取最高权重
            if (item.weight > rec.weight) rec.weight = item.weight;
            // 越近越优先
            if (distance < rec.distance) rec.distance = distance;
        }
    }

    return Array.from(stats.values())
        .map(r => ({ ...r, kinds: Array.from(r.kinds) }))
        .sort((a, b) => {
            // 1) 来源可信度优先：方括号标签（100）始终高于包名（20~35）。
            //    包名里充斥着 lang/mods/loader 这类泛化段，若让距离优先，
            //    报错行自身就会把噪声顶到第一位。
            const bucketA = a.weight >= 100 ? 2 : 1;
            const bucketB = b.weight >= 100 ? 2 : 1;
            if (bucketA !== bucketB) return bucketB - bucketA;
            // 2) 同来源看距离
            if (a.distance !== b.distance) return a.distance - b.distance;
            // 3) 同距离看具体权重
            if (a.weight !== b.weight) return b.weight - a.weight;
            // 4) 再看出现频次
            return b.hit - a.hit;
        });
}

// ==================== 本地模组扫描 ====================

/**
 * 扫描模组目录，拿到「本机实际装了哪些模组」。
 * 只读文件名（不打开 jar），因此很快；代价是拿不到真实 modid，
 * 但用于「缺了什么」「装了哪些渲染类模组」已经够用。
 *
 * @param {string} [modsDir] 默认取当前方案的 mods/
 * @returns {Array<{file:string, id:string, raw:string}>}
 */
function scanLocalMods(modsDir) {
    let dir = modsDir;
    if (!dir) {
        try {
            // 延迟 require，避免测试环境没有 scheme 时抛错
            const utils = require('./utils');
            dir = path.join(utils.getServerDir(), 'mods');
        } catch (e) {
            return [];
        }
    }
    if (!fs.existsSync(dir)) return [];

    let files = [];
    try {
        files = fs.readdirSync(dir).filter(f => /\.(jar|zip)$/i.test(f));
    } catch (e) {
        return [];
    }

    return files.map(file => ({
        file,
        raw: file.replace(/\.(jar|zip)$/i, ''),
        id: normalizeModId(file)
    }));
}

/**
 * 判断某个 ID 是否在本地已安装。
 * 匹配策略偏严格：
 *   1. 归一化后完全相同 → 命中；
 *   2. 文件名包含该 ID（sodium → sodium-fabric-0.5.8.jar）→ 命中；
 *   3. 反过来包含（ID 比文件名更长）只在长度接近时才接受，
 *      避免 `sodiumlike` 这类近似名被误判成已安装的 sodium。
 */
function findLocalMod(id, localMods) {
    const target = normalizeModId(id);
    if (!target) return null;

    // 1) 精确相等
    const exact = localMods.find(m => m.id === target);
    if (exact) return exact;

    // 2) 文件名里包含目标 ID（目标至少 3 字符，避免 "jei" 之类过短误伤）
    if (target.length >= 3) {
        const byFile = localMods.find(m => m.file.toLowerCase().includes(target));
        if (byFile) return byFile;
    }

    // 3) 目标包含文件名，且长度差不超过 2 —— 如目标 `sodiumfabric`、文件 `sodium`
    const byPrefix = localMods.find(m =>
        m.id.length >= 3 && target.startsWith(m.id) && target.length - m.id.length <= 2
    );
    return byPrefix || null;
}

// ==================== 前置缺失解析 ====================

/**
 * 解析「Missing or unsupported mandatory dependencies」段落里点名的前置。
 *
 * Fabric 典型输出：
 *   - Mod 'X' (x) 1.0 requires any version of y, which is missing!
 *   - Mod 'X' requires mod 'y' ...
 * Forge 典型输出：
 *   Missing or unsupported mandatory dependencies:
 *     Mod ID: 'y', Requested by: 'x', Expected range: '[1.0,)', Actual version: '[MISSING]'
 *
 * @param {string[]} lines
 * @param {number} index 命中行下标
 * @returns {{missing:string[], requiredBy:string[]}}
 */
function parseMissingDependencies(lines, index) {
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length - 1, index + 12);
    const window = lines.slice(start, end + 1).join('\n');

    const missing = new Set();
    const requiredBy = new Set();

    // 形如：requires any version of yyy, which is missing!
    const fabricRe = /requires\s+(?:any version of\s+)?([a-z0-9_.-]+)[^,\n]*,\s*which is missing/gi;
    let m;
    while ((m = fabricRe.exec(window)) !== null) missing.add(normalizeModId(m[1]));

    // 形如：Mod ID: 'yyy', Requested by: 'xxx'
    const forgeRe = /Mod ID:\s*'([^']+)'\s*,\s*Requested by:\s*'([^']+)'/gi;
    while ((m = forgeRe.exec(window)) !== null) {
        missing.add(normalizeModId(m[1]));
        requiredBy.add(normalizeModId(m[2]));
    }

    // 形如：Mod 'xxx' (xxx) requires ...
    const byRe = /Mod\s+'([^']+)'/gi;
    while ((m = byRe.exec(window)) !== null) requiredBy.add(normalizeModId(m[1]));

    return {
        missing: Array.from(missing).filter(Boolean),
        requiredBy: Array.from(requiredBy).filter(Boolean)
    };
}

// ==================== 主扫描 ====================

/**
 * 扫描日志，返回结构化诊断结果。
 *
 * @param {string|string[]} logContent 日志全文或行数组
 * @param {object} [options]
 * @param {string} [options.modsDir] 指定模组目录（测试用）；不传则用当前方案
 * @param {number} [options.contextRadius=10] 上下文行数
 * @param {number} [options.maxFindings=5] 最多返回多少条独立发现
 * @returns {{
 *   ok: boolean,
 *   findings: Array<object>,
 *   suspects: string[],
 *   localMods: Array<object>,
 *   advice: string[],
 *   fallback: boolean,
 *   aiHint: string|null,
 *   summary: string
 * }}
 */
function scanLog(logContent, options = {}) {
    const radius = Number.isInteger(options.contextRadius) ? options.contextRadius : 10;
    const maxFindings = Number.isInteger(options.maxFindings) ? options.maxFindings : 5;

    const lines = Array.isArray(logContent)
        ? logContent
        : String(logContent == null ? '' : logContent).split(/\r?\n/);

    const localMods = scanLocalMods(options.modsDir);

    if (!lines.length || (lines.length === 1 && !lines[0].trim())) {
        return {
            ok: false,
            findings: [],
            suspects: [],
            localMods,
            advice: [],
            fallback: true,
            aiHint: t('no_log'),
            summary: t('no_log')
        };
    }

    const findings = [];
    const claimed = new Set(); // 同一条错误只报一次

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;

        for (const pattern of ERROR_PATTERNS) {
            if (!pattern.test(line)) continue;

            // 同类型 + 同一模组只记一次
            const key = pattern.id;
            const rawCtx = extractModIdsFromContext(lines, i, radius);
            // 过滤掉占位名/泛化词，只保留可信候选
            const ctxMods = rawCtx.filter(c => isPlausibleModId(c.id));
            // 优先选用「本机确实装了」的模组，它更可能是真凶
            const installed = ctxMods.filter(c => findLocalMod(c.id, localMods));
            const primary = (installed[0] || ctxMods[0] || {}).id || null;
            const dedupeKey = `${key}::${primary || ''}`;
            if (claimed.has(dedupeKey)) break;
            claimed.add(dedupeKey);

            const finding = {
                type: pattern.id,
                severity: pattern.severity,
                modRelevant: pattern.modRelevant !== false,
                title: t(`err.${pattern.id}`),
                reason: t(`why.${pattern.id}`),
                line: i,
                rawLine: line.trim().slice(0, 300),
                context: buildContext(lines, i, 2),
                mod: primary,
                modKnown: Boolean(primary),
                modCandidates: ctxMods.slice(0, 5).map(c => c.id),
                extra: {}
            };

            // 前置缺失：找具体缺了什么
            if (pattern.id === 'missing_dependency') {
                const dep = parseMissingDependencies(lines, i);
                finding.extra.missing = dep.missing;
                finding.extra.requiredBy = dep.requiredBy;
                // 该场景下「谁缺前置」比上下文猜出来的名字更可靠，
                // 上下文里常出现的 missing / dependencies 等词并非模组名
                if (dep.requiredBy.length) {
                    finding.mod = dep.requiredBy[0];
                    finding.modKnown = true;
                    finding.modCandidates = dep.requiredBy.slice(0, 5);
                }
            }

            // 客户端模组误装：若上下文里没抓到名字，看本地是否装了已知客户端模组
            if (pattern.id === 'client_mod' && !finding.mod) {
                const clientInstalled = localMods
                    .filter(m => CLIENT_MOD_IDS.has(m.id))
                    .map(m => m.id);
                if (clientInstalled.length) {
                    finding.mod = clientInstalled[0];
                    finding.modKnown = true;
                    finding.modCandidates = clientInstalled;
                    finding.extra.guessedFromLocal = true;
                }
            }

            findings.push(finding);
            if (findings.length >= maxFindings) break;
            break; // 一行只归一类错误
        }
        if (findings.length >= maxFindings) break;
    }

    // —— 嫌疑人汇总 ——
    const suspects = [];
    for (const f of findings) {
        for (const id of f.modCandidates || []) {
            if (!suspects.includes(id)) suspects.push(id);
        }
        if (f.mod && !suspects.includes(f.mod)) suspects.unshift(f.mod);
    }

    // —— 渲染类模组冲突检测（独立于报错，按本地实际安装情况判断）——
    const renderInstalled = localMods
        .map(m => m.id)
        .filter(id => RENDER_CLASS_IDS.has(id));
    const uniqueRender = Array.from(new Set(renderInstalled)).sort();
    let renderWarning = null;
    if (uniqueRender.length >= 2) {
        renderWarning = {
            mods: uniqueRender,
            message: '多个渲染/优化类模组同时存在，极易导致底层冲突。'
        };
    }

    // —— 生成建议 ——
    const advice = buildAdvice(findings, localMods);
    const generic = t('generic.advice');

    // 「定位不到模组」只对「本来该有模组」的错误类型成立。
    // EULA / 内存 / Java 版本 / 端口占用这类与服务端环境配置有关，
    // 强行提示「未能定位模组」只会误导用户去乱删模组。
    const modRelevantFindings = findings.filter(f => {
        const pattern = ERROR_PATTERNS.find(p => p.id === f.type);
        return pattern && pattern.modRelevant !== false;
    });
    const hasPreciseMod = modRelevantFindings.some(f => f.modKnown);

    if (!findings.length) {
        advice.push(...generic);
    }

    // 仅当「存在模组相关的错误」且「没能定位到任何模组」时才降级提示 AI
    const fallback = modRelevantFindings.length > 0 && !hasPreciseMod;
    if (fallback) {
        advice.push(...generic);
    }

    return {
        ok: findings.length > 0,
        findings,
        suspects,
        localMods,
        advice,
        renderWarning,
        fallback,
        aiHint: fallback ? t('fallback.ai_hint') : null,
        summary: buildSummary(findings)
    };
}

/** 取报错行前后若干行做上下文摘要（跳过空白） */
function buildContext(lines, index, span = 2) {
    const start = Math.max(0, index - span);
    const end = Math.min(lines.length - 1, index + span);
    const out = [];
    for (let i = start; i <= end; i++) {
        const text = String(lines[i] || '').trim();
        if (!text) continue;
        out.push({
            line: i,
            text: text.slice(0, 240),
            current: i === index
        });
    }
    return out;
}

/** 根据发现生成可执行建议（命令必须真实存在） */
function buildAdvice(findings, localMods) {
    const out = [];
    const seen = new Set();

    for (const f of findings) {
        const key = `fix.${f.type}`;
        const template = t(key);
        if (!Array.isArray(template)) continue;

        const lines = template.map(text => {
            let s = text;
            // {mod} 替换：优先真实模组名，其次「该模组」
            const modName = f.mod || '该模组';
            s = s.replace(/\{mod\}/g, modName);

            // {missing} 替换：前置缺失场景
            if (s.includes('{missing}')) {
                const missing = (f.extra && f.extra.missing) || [];
                if (missing.length) {
                    s = s.replace(/\{missing\}/g, missing.join('、'));
                } else {
                    // 没解析出具体前置 → 这条建议没意义，丢弃
                    return null;
                }
            }
            return s;
        }).filter(Boolean);

        for (const s of lines) {
            if (seen.has(s)) continue;
            seen.add(s);

            // 模组未知时，命令里的「该模组」不能真的敲进终端，
            // 统一换成 <模组名> 占位符，并提示先确认名字
            if (!f.mod && /该模组/.test(s)) {
                out.push(s.replace(/该模组/g, '<模组名>'));
                continue;
            }
            out.push(s);
        }
    }

    return out;
}

/** 一句话摘要 */
function buildSummary(findings) {
    if (!findings.length) return t('no_error_found');
    const primary = findings[0];
    const mods = findings.filter(f => f.mod).map(f => f.mod);
    const modText = mods.length ? `，疑似模组：${mods.slice(0, 3).join('、')}` : '';
    return `${primary.title}${modText}`;
}

// ==================== 终端渲染 ====================

/**
 * 把 scanLog 的结果渲染成终端文本行数组。
 * 不直接 console.log，便于调用方决定输出位置、也便于测试断言。
 *
 * @param {object} result scanLog 的返回值
 * @param {object} [opts]
 * @param {number|null} [opts.exitCode] 服务器退出码，null 表示不打印首行
 * @returns {string[]}
 */
function renderReport(result, opts = {}) {
    const lines = [];
    const W = 60;

    lines.push(paint('='.repeat(W), 'cyan'));
    lines.push(paint(`🔍 ${t('title.diagnosing')}`, 'bold', 'cyan'));
    lines.push(paint('-'.repeat(W), 'gray'));

    if (!result || !result.findings || !result.findings.length) {
        lines.push(paint(`ℹ️  ${t('no_error_found')}`, 'yellow'));
        lines.push('');
        lines.push(paint(`💡 ${t('title.advice')}`, 'bold', 'green'));
        (result && result.advice ? result.advice : t('generic.advice')).forEach((a, i) => {
            lines.push(`   ${i + 1}. ${a}`);
        });
        if (result && result.aiHint) {
            lines.push('');
            lines.push(paint(`   ${result.aiHint}`, 'gray'));
        }
        lines.push(paint('='.repeat(W), 'cyan'));
        return lines;
    }

    for (const f of result.findings) {
        const icon = f.severity === 'high' ? '🚨' : '⚠️ ';
        const color = f.severity === 'high' ? 'red' : 'yellow';
        const modLabel = f.mod
            ? paint(f.mod, 'bold', color)
            : paint(t('label.unknown_mod'), 'gray');

        lines.push('');
        lines.push(`${icon} ${paint(t('title.error'), 'bold', color)}${paint(t('label.mod'), 'gray')}: ${modLabel}`);
        lines.push(`   ${paint(t('label.reason') + ':', 'gray')} ${f.reason}`);

        // 前置缺失：把「缺了什么」摊开
        if (f.type === 'missing_dependency' && f.extra && f.extra.missing && f.extra.missing.length) {
            const by = (f.extra.requiredBy || []).join('、') || '（未识别）';
            lines.push(`   ${paint('缺失前置:', 'gray')} ${paint(f.extra.missing.join('、'), 'bold', 'red')}`);
            lines.push(`   ${paint('声明方:', 'gray')} ${by}`);
        }

        if (f.context && f.context.length) {
            lines.push(`   ${paint(t('label.context') + ':', 'gray')}`);
            for (const c of f.context) {
                const text = `     ${c.current ? '>' : ' '} ${c.text}`;
                lines.push(paint(text, c.current ? 'white' : 'gray'));
            }
        }
    }

    // 伴随模组 / 渲染类冲突
    if (result.renderWarning) {
        lines.push('');
        lines.push(`🕵️  ${paint(t('title.accompany'), 'bold', 'magenta')}: ${result.renderWarning.mods.join(', ')}`);
        lines.push(`   👉 ${paint('警告:', 'bold', 'yellow')} ${result.renderWarning.message}`);
    } else if (result.suspects && result.suspects.length > 1) {
        lines.push('');
        lines.push(`🕵️  ${paint(t('title.accompany'), 'bold', 'magenta')}: ${result.suspects.slice(1).join(', ')}`);
    }

    lines.push('');
    lines.push(paint(`💡 ${t('title.advice')}`, 'bold', 'green'));
    const advice = result.advice && result.advice.length ? result.advice : t('generic.advice');
    advice.forEach((a, i) => lines.push(`   ${paint(String(i + 1) + '.', 'green')} ${a}`));

    if (result.fallback && result.aiHint) {
        lines.push('');
        lines.push(paint(`   ${result.aiHint}`, 'gray'));
    }

    lines.push(paint('='.repeat(W), 'cyan'));
    return lines;
}

/**
 * 一站式：读日志 → 扫描 → 打印。
 * 供 server.js 在异常退出时调用，所有异常都在内部吞掉，绝不影响主流程。
 *
 * @param {object} [opts]
 * @param {string} [opts.logFile] 日志路径，默认当前方案 logs/latest.log
 * @param {string} [opts.modsDir] 模组目录，测试用
 * @param {number|null} [opts.exitCode]
 * @param {boolean} [opts.print=true] 是否直接打印
 * @returns {object|null} scanLog 的结果；读取失败返回 null
 */
function diagnoseOnCrash(opts = {}) {
    const print = opts.print !== false;
    try {
        let logFile = opts.logFile;
        if (!logFile) {
            const utils = require('./utils');
            logFile = path.join(utils.getServerDir(), 'logs', 'latest.log');
        }

        if (opts.exitCode !== undefined && opts.exitCode !== null && print) {
            console.log('');
            console.log(paint(`❌ 服务器异常退出，退出码: ${opts.exitCode}`, 'bold', 'red'));
        }

        if (!logFile || !fs.existsSync(logFile)) {
            const result = {
                ok: false, findings: [], suspects: [], localMods: [],
                advice: [], fallback: true, aiHint: t('no_log'), summary: t('no_log')
            };
            if (print) renderReport(result).forEach(l => console.log(l));
            return result;
        }

        const content = fs.readFileSync(logFile, 'utf8');
        const result = scanLog(content, { modsDir: opts.modsDir });
        if (print) renderReport(result, { exitCode: opts.exitCode }).forEach(l => console.log(l));
        return result;
    } catch (e) {
        // 诊断器自身出错绝不能影响服务器退出流程
        if (print) console.log(paint(`[诊断器] 本地诊断跳过：${e.message}`, 'gray'));
        return null;
    }
}

module.exports = {
    // 主入口
    scanLog,
    diagnoseOnCrash,

    // 渲染
    renderReport,

    // 可单独复用的部件（测试与后续扩展用）
    ERROR_PATTERNS,
    MESSAGES,
    extractModIdsFromLine,
    extractModIdsFromContext,
    normalizeModId,
    scanLocalMods,
    findLocalMod,
    parseMissingDependencies,
    buildAdvice,

    // i18n / 颜色
    setLocale,
    getLocale: () => currentLocale,
    t,
    paint,
    stripAnsi,
    COLOR_ENABLED,

    // 常量
    CLIENT_MOD_IDS,
    RENDER_CLASS_IDS,
    IGNORED_PACKAGES
};
