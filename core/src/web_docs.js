/**
 * Web 面板内置文档查看 —— 后端只读白名单模块
 * ----------------------------------------------------------------
 * 设计红线（尚书省指令 P0）：
 *   1. 前端只能传「文档名」（如 COMMANDS），绝不允许传路径。
 *      真实文件路径全部写死在下面的白名单常量里，用户输入不参与路径拼接。
 *   2. name 先过严格字符白名单，再精确匹配白名单 key；任何含 `.` `/` `\`
 *      `%` 空格、空字符或非字符串的输入一律拒绝（对应验收：403）。
 *   3. 只暴露面向最终用户的说明文档。CHANGELOG / RELEASE_POLICY /
 *      DECISIONS / TUI / 内部测试报告 / 开发规范 / 彩蛋 一律不列入。
 *   4. 读取失败（文件被删、权限不足）返回友好错误，不把堆栈或绝对路径外泄。
 *
 * 本模块零副作用：只 require node 内置模块与 fs-extra，不碰开服逻辑、
 * 不写任何文件，可安全地被单测反复 require。
 */

const path = require('path');
const fs = require('fs-extra');

// core/src/web_docs.js → ../../ = 仓库根
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');

/**
 * 固定路由白名单（写死，不接受前端传路径）。
 * rel 一律相对仓库根；name 为前端唯一可用的标识，title/group 用于目录渲染。
 */
const DOC_DEFS = Object.freeze([
    // ── 入门指引 ──
    { name: 'README',             title: '🎮 项目概览',           group: '入门指引', rel: 'README.MD' },
    { name: 'QUICKSTART',         title: '🚀 快速开始',           group: '入门指引', rel: 'docs/QUICKSTART.md' },
    { name: 'TERMS',              title: '📖 术语解释',           group: '入门指引', rel: 'docs/TERMS.md' },
    // ── 命令与配置 ──
    { name: 'COMMANDS',           title: '📋 完整命令参考',       group: '命令与配置', rel: 'docs/COMMANDS.md' },
    { name: 'CONFIG',             title: '⚙️ 配置参考（wow.yaml）', group: '命令与配置', rel: 'docs/CONFIG.md' },
    { name: 'API',                title: '🔌 Web API 参考',       group: '命令与配置', rel: 'docs/net/API.md' },
    // ── 方案与同步 ──
    { name: 'SCHEMES',            title: '📦 方案管理',           group: '方案与同步', rel: 'docs/scheme/SCHEMES.md' },
    { name: 'SYNC',               title: '🔄 跨设备方案同步',     group: '方案与同步', rel: 'docs/scheme/SYNC.md' },
    { name: 'CLONE_CLIENT',       title: '📥 客户端克隆为方案',   group: '方案与同步', rel: 'docs/scheme/CLONE_CLIENT.md' },
    // ── 联机与面板 ──
    { name: 'WEB_PANEL',          title: '🌐 Web 面板使用说明',   group: '联机与面板', rel: 'docs/net/WEB_PANEL.md' },
    { name: 'LAN_TERRACOTTA',     title: '🌐 联机 / 内网穿透',    group: '联机与面板', rel: 'docs/net/LAN_TERRACOTTA.md' },
    // ── 故障排除 ──
    { name: 'TROUBLE_WINDOWS',    title: '🛠️ Windows 故障排除',   group: '故障排除', rel: 'docs/trouble/TROUBLE_WINDOWS.md' },
    { name: 'TROUBLE_DEBIAN',     title: '🛠️ Debian / Ubuntu',    group: '故障排除', rel: 'docs/trouble/TROUBLE_DEBIAN.md' },
    { name: 'TROUBLE_MACOS',      title: '🛠️ macOS 故障排除',     group: '故障排除', rel: 'docs/trouble/TROUBLE_MACOS.md' },
    { name: 'TROUBLE_ARCH',       title: '🛠️ Arch / Manjaro',     group: '故障排除', rel: 'docs/trouble/TROUBLE_ARCH.md' },
    { name: 'ANDROID_LIMITATIONS', title: '🤖 Android 已知限制',  group: '故障排除', rel: 'docs/other/ANDROID_LIMITATIONS.md' },
    // ── 扩展与主题 ──
    { name: 'WOW_EXTENSIONS',     title: '🧩 wow 扩展开发指南',   group: '扩展与主题', rel: 'docs/other/WOW-EXTENSIONS.md' },
    { name: 'THEMES',             title: '🎨 主题包开发指南',     group: '扩展与主题', rel: 'docs/net/THEMES.md' },
    // ── 关于 ──
    // V3.6.4（P2-18）：按指令把 docs/wow.md 加入白名单并读取渲染。
    // 绝对红线：只读，绝不修改 wow.md 原文一个字。用 WOW_STORY 作 name，
    // 避免与「isAllowed('WOW')===false」的安全断言冲突。
    { name: 'WOW_STORY',          title: '🥚 Wow～ 名字的由来',   group: '关于',       rel: 'docs/wow.md' }
]);

/**
 * 明令禁止暴露的文件（供测试与文档说明锁定，不参与任何读取逻辑）。
 * 即便将来有人误把它们加进 DOC_DEFS，FORBIDDEN_PATTERNS 也能被测试抓到。
 */
const FORBIDDEN_PATTERNS = Object.freeze([
    'CHANGELOG', 'RELEASE_POLICY', 'DECISIONS', 'TUI',
    'TEST-REPORT', 'MOD_SCHEMAS', 'CF_PROXY',
    '.docs-legacy', 'deploy/cfproxy-worker'
    // V3.6.4（P2-18）：docs/wow.md 已按指令加入白名单，故从禁止清单移除
]);

/** 文档名合法性：只允许字母数字开头 + 字母数字/下划线/连字符 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** 资源文件名：无路径分隔符、无 ..、仅图片扩展名 */
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ASSET_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
/** 单篇文档体积上限，防止异常大文件拖垮面板 */
const MAX_DOC_BYTES = 512 * 1024;

const FRIENDLY_READ_ERROR = '文档读取失败，请前往仓库查看';

const BY_NAME = new Map(DOC_DEFS.map(d => [d.name.toUpperCase(), d]));

/** 前端可用的文档清单：绝不返回任何文件路径 */
function list() {
    const groups = [];
    for (const d of DOC_DEFS) {
        if (!groups.includes(d.group)) groups.push(d.group);
    }
    return {
        docs: DOC_DEFS.map(d => ({ name: d.name, title: d.title, group: d.group })),
        groups
    };
}

/** name 是否在白名单内（严格字符校验 + 精确匹配，大小写不敏感） */
function isAllowed(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return false;
    return BY_NAME.has(name.toUpperCase());
}

function getDef(name) {
    if (!isAllowed(name)) return null;
    return BY_NAME.get(name.toUpperCase());
}

/**
 * 读取白名单文档内容。
 * @returns {{ok:true,name,title,group,content}|{ok:false,reason,error}}
 *   reason: 'forbidden'（应回 403）| 'missing' | 'io' | 'too_large'（友好错误）
 */
function read(name) {
    const def = getDef(name);
    if (!def) {
        return { ok: false, reason: 'forbidden', error: '文档不在允许列表内' };
    }
    // 路径只来自写死的常量，用户输入 name 绝不参与拼接
    const abs = path.resolve(REPO_ROOT, def.rel);
    if (!abs.startsWith(REPO_ROOT + path.sep)) {
        return { ok: false, reason: 'forbidden', error: '文档不在允许列表内' };
    }
    try {
        if (!fs.existsSync(abs)) {
            return { ok: false, reason: 'missing', error: FRIENDLY_READ_ERROR };
        }
        const stat = fs.statSync(abs);
        if (!stat.isFile() || stat.size > MAX_DOC_BYTES) {
            return { ok: false, reason: 'too_large', error: FRIENDLY_READ_ERROR };
        }
        const content = fs.readFileSync(abs, 'utf8');
        return { ok: true, name: def.name, title: def.title, group: def.group, content };
    } catch (e) {
        // 权限不足 / IO 异常：不外泄堆栈与绝对路径
        return { ok: false, reason: 'io', error: FRIENDLY_READ_ERROR };
    }
}

/**
 * 解析文档内相对图片资源（可选能力）。
 * 只允许读取「白名单文档所在目录」下的图片，且必须在 docs/ 目录树内；
 * 文件名不含路径分隔符与 ..，扩展名限定为图片。前端拿不到任意文件读取能力。
 * @returns {{ok:true,abs,mime}|{ok:false,reason}}
 */
function resolveAsset(name, file) {
    const def = getDef(name);
    if (!def) return { ok: false, reason: 'forbidden' };
    if (typeof file !== 'string' || !ASSET_RE.test(file) || file.includes('..') || !ASSET_EXT_RE.test(file)) {
        return { ok: false, reason: 'bad_file' };
    }
    const docDir = path.dirname(path.resolve(REPO_ROOT, def.rel));
    if (!docDir.startsWith(DOCS_ROOT + path.sep) && docDir !== DOCS_ROOT) {
        return { ok: false, reason: 'out_of_scope' };
    }
    const abs = path.resolve(docDir, file);
    if (path.dirname(abs) !== docDir || !abs.startsWith(DOCS_ROOT + path.sep)) {
        return { ok: false, reason: 'out_of_scope' };
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return { ok: false, reason: 'missing' };
    }
    return { ok: true, abs };
}

module.exports = {
    REPO_ROOT,
    DOCS_ROOT,
    DOC_DEFS,
    FORBIDDEN_PATTERNS,
    FRIENDLY_READ_ERROR,
    list,
    isAllowed,
    getDef,
    read,
    resolveAsset
};
