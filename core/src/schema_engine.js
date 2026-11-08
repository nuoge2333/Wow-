/**
 * 模组表单引擎（Schema Engine）
 *
 * 定位：只负责「按 schema 读值 → 校验 → 行级写回」。不认识任何具体模组，
 * 所有模组知识都在 core/data/mod_schemas/*.json 里。
 *
 * 三条铁律（608 进阶指令）：
 *   1. 行级正则替换，绝不 parse 后 stringify 全量重写。
 *      schema 里没映射的键、注释、空行、排版全部原样保留。
 *   2. 缩进必须保留。YAML 层级靠缩进，少一个空格插件就读不出配置。
 *   3. 写入前 .bak 备份 + 临时文件 + rename 原子替换。
 *
 * 支持的格式与定位语义：
 *   toml       键的「点到节表」解析：kinetics.contraptions.maxBlocksMoved
 *              会先找 [kinetics.contraptions] 再找该节下的 maxBlocksMoved
 *   yml        缩进栈定位：teleport.delay 按缩进层级逐段下钻
 *   json       点路径 + 字符串感知扫描，只替换值的字符区间
 *   properties 扁平 key=value（Bukkit/Paper 插件常用）
 *   conf       HOCON（BlueMap 等）：支持 key = value 与 { } 嵌套
 *   txt        flat 行 `key value` 或 `key=value`（Carpet 规则）
 *   snbt       只读预览，写入直接拒绝
 */

const fs = require('fs-extra');
const path = require('path');

/** 只允许改这三个目录下的文本配置（608 指令三·隔离与边界） */
const BOUNDARY_DIRS = ['config', 'serverconfig', 'plugins'];

/** 这些扩展名一律拒绝（jar、世界数据、二进制） */
const DENY_EXTS = new Set(['.jar', '.zip', '.dat', '.mca', '.mcr', '.png', '.jpg', '.jpeg', '.gif', '.db', '.sqlite', '.lock', '.class']);

/** 单文件行数上限：超过就不出表单（指令：大文件降级） */
const FORM_MAX_LINES = 200;
/** 表单最多渲染的键数 */
const FORM_MAX_ENTRIES = 100;

/** 可写格式（snbt 只读） */
const WRITABLE_FORMATS = new Set(['toml', 'yml', 'json', 'properties', 'conf', 'txt']);

function serverRoot() {
    if (process.env.WOW_MODCFG_ROOT) return path.resolve(process.env.WOW_MODCFG_ROOT);
    const utils = require('./utils');
    return utils.getServerDir();
}

/**
 * 解析方案内的相对路径，强制落在 BOUNDARY_DIRS 内。
 * 拒绝：绝对路径、.. 穿越、符号链接逃逸、非白名单顶层目录、禁用扩展名。
 * @param {string} relPath
 * @param {{mustExist?:boolean}} [opts]
 * @returns {{ok:boolean, abs?:string, rel?:string, reason?:string}}
 */
function resolveInBoundary(relPath, opts = {}) {
    const raw = String(relPath || '').trim();
    if (!raw) return { ok: false, reason: '路径为空' };
    if (raw.includes('\0')) return { ok: false, reason: '路径含非法字符' };
    const norm = raw.replace(/\\/g, '/');
    if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) {
        return { ok: false, reason: '只允许方案内的相对路径' };
    }
    const segments = norm.split('/').filter(s => s && s !== '.');
    if (segments.includes('..')) {
        return { ok: false, reason: '路径不允许包含 ..' };
    }
    if (!segments.length) return { ok: false, reason: '路径为空' };
    if (!BOUNDARY_DIRS.includes(segments[0])) {
        return { ok: false, reason: `只允许修改 ${BOUNDARY_DIRS.map(d => d + '/').join('、')} 下的配置` };
    }

    const root = serverRoot();
    const abs = path.resolve(root, segments.join('/'));
    const rel = path.relative(root, abs).split(path.sep).join('/');

    // 二次校验：解析后仍在根内（防 ../ 变体）
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { ok: false, reason: '路径越界' };
    }
    const ext = path.extname(abs).toLowerCase();
    if (DENY_EXTS.has(ext)) {
        return { ok: false, reason: `不允许编辑 ${ext} 文件` };
    }
    if (opts.mustExist && !fs.existsSync(abs)) {
        return { ok: false, reason: `文件不存在：${rel}` };
    }
    // 符号链接逃逸检查：真实路径也必须落在根内
    if (fs.existsSync(abs)) {
        try {
            const real = fs.realpathSync(abs);
            const realRoot = fs.realpathSync(root);
            const realRel = path.relative(realRoot, real);
            if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
                return { ok: false, reason: '符号链接指向方案外，已拒绝' };
            }
        } catch (e) {
            return { ok: false, reason: `无法解析文件路径：${e.message}` };
        }
    }
    return { ok: true, abs, rel };
}

/** 读文本文件；含 NUL 字节视为二进制拒绝 */
function readText(abs) {
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) {
        const err = new Error('这是二进制文件，不能当配置编辑');
        err.code = 'EBINARY';
        throw err;
    }
    return buf.toString('utf8');
}

// ============================================================================
// 值与行文本
// ============================================================================

/**
 * 按原值的书写形态推断类型
 * @returns {{type:'number'|'boolean'|'string'|'raw', value:any}}
 */
function inferValue(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { type: 'string', value: '' };
    if (/^(true|false)$/i.test(s)) return { type: 'boolean', value: s.toLowerCase() === 'true' };
    if (/^-?\d+$/.test(s)) return { type: 'number', value: parseInt(s, 10) };
    if (/^-?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return { type: 'number', value: parseFloat(s) };
    if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return { type: 'string', value: s.slice(1, -1) };
    return { type: 'string', value: s };
}

/**
 * 把一行拆成「值部分」和「行尾注释」。
 * 引号内的 # 不算注释（Create/Ars 的字符串里常见 "a#b"）。
 * @param {string} rest 值 + 可能的注释
 * @returns {{value:string, comment:string}}
 */
function splitInlineComment(rest) {
    let inS = null;
    for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (inS) {
            if (ch === '\\') { i++; continue; }
            if (ch === inS) inS = null;
            continue;
        }
        if (ch === '"' || ch === "'") { inS = ch; continue; }
        // # 前面必须是空白或行首，才当作注释起始
        if (ch === '#' && (i === 0 || /\s/.test(rest[i - 1]))) {
            let cut = i;
            while (cut > 0 && /\s/.test(rest[cut - 1])) cut--;
            return { value: rest.slice(0, cut), comment: rest.slice(cut) };
        }
    }
    return { value: rest.replace(/\s+$/, ''), comment: '' };
}

/**
 * 把新值渲染成文件里的书写形态（类型强转的核心）。
 * @param {string} oldRaw 原值（决定要不要加引号、用单引号还是双引号）
 * @param {*} newValue 用户给的值
 * @param {{type?:string}} [field] schema 字段（type 已知时优先）
 * @returns {{ok:boolean, text?:string, reason?:string}}
 */
function renderValue(oldRaw, newValue, field) {
    const oldInfo = inferValue(oldRaw);
    const wantType = (field && field.type) || oldInfo.type;

    if (wantType === 'number') {
        const n = typeof newValue === 'number' ? newValue : Number(String(newValue).trim());
        if (!Number.isFinite(n)) {
            return { ok: false, reason: `「${newValue}」不是合法数字（原值 ${oldRaw.trim()} 是数字）` };
        }
        if (field && Number.isFinite(field.min) && n < field.min) {
            return { ok: false, reason: `不能小于 ${field.min}` };
        }
        if (field && Number.isFinite(field.max) && n > field.max) {
            return { ok: false, reason: `不能大于 ${field.max}` };
        }
        // 原值是整数就写整数，原值是小数就保留小数形态
        const rawTrim = oldRaw.trim();
        const isFloatOld = /\./.test(rawTrim) || /[eE]/.test(rawTrim);
        const text = isFloatOld ? String(n) : String(Math.trunc(n));
        return { ok: true, text };
    }

    if (wantType === 'boolean') {
        const s = String(newValue).trim().toLowerCase();
        if (/^(true|yes|on|1)$/.test(s)) {
            return { ok: true, text: oldRaw.trim().toLowerCase() === 'TRUE' ? 'TRUE' : 'true' };
        }
        if (/^(false|no|off|0)$/.test(s)) {
            return { ok: true, text: oldRaw.trim().toLowerCase() === 'FALSE' ? 'FALSE' : 'false' };
        }
        return { ok: false, reason: `原值是布尔（${oldRaw.trim()}），新值「${newValue}」必须是 true/false` };
    }

    if (wantType === 'select' && field && Array.isArray(field.options)) {
        const s = String(newValue);
        if (!field.options.some(o => o.value === s)) {
            return { ok: false, reason: `「${s}」不在可选值里（${field.options.map(o => o.value).join(' / ')}）` };
        }
    }

    // 字符串：沿用原值的引号风格
    const s = String(newValue == null ? '' : newValue);
    if (/[\r\n]/.test(s)) return { ok: false, reason: '值里不能有换行' };
    const rawTrim = oldRaw.trim();
    if (/^".*"$/.test(rawTrim)) {
        return { ok: true, text: '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' };
    }
    if (/^'.*'$/.test(rawTrim)) {
        return { ok: true, text: "'" + s.replace(/'/g, "''") + "'" };
    }
    return { ok: true, text: s };
}

// ============================================================================
// 各格式的「定位器」
// 统一返回 { lineNo, valueStart, valueEnd, keyIndent, raw }
// 找不到返回 null
// ============================================================================

/**
 * TOML：点路径 → 节表 + 键
 * 支持 [a.b] 与 [[a.b]] 两种节表；根级键直接用点路径的末段。
 */
function locateToml(lines, keyPath) {
    const parts = keyPath.split('.').filter(Boolean);
    if (!parts.length) return null;
    // 段数不定：既可能整段写成一个键（contraptions.maxBlocksMoved），
    // 也可能被剥掉文件前缀后只剩末段（maxBlocksMoved）。两种都试。
    const candidates = new Set([keyPath, parts[parts.length - 1]]);
    const re = /^\s*([A-Za-z0-9_.\-\u0080-\uffff]+)\s*=\s*/;

    // 候选节表：'' 表示根级
    const sections = [];
    sections.push('');
    if (parts.length > 1) {
        const sec = parts.slice(0, -1).join('.');
        sections.push(sec);
        // 兼容「schema 里带了 serverconfig/ 的父节名」这类前缀差异：
        // 从完整节名开始逐层剥，直到只剩末段
        const segs = sec.split('.');
        for (let i = 1; i < segs.length; i++) sections.push(segs.slice(i).join('.'));
    }

    for (const section of sections) {
        let currentSection = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const secMatch = trimmed.match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/);
            if (secMatch) {
                currentSection = secMatch[1].trim();
                continue;
            }
            if (currentSection !== section) continue;
            for (const key of candidates) {
                const m = matchKeyLine(line, key, re);
                if (m) return m;
            }
        }
    }
    return null;
}

/**
 * 用给定的正则匹配 key，返回值的字符区间。
 * @param {string} line
 * @param {string} key
 * @param {RegExp} re 需以「键 + 分隔符」开头，最后一个捕获到分隔符后位置
 */
function matchKeyLine(line, key, re) {
    const m = line.match(re);
    if (!m) return null;
    if (m[1] !== key) return null;
    const valueStart = m[0].length;
    const rest = line.slice(valueStart);
    const { value, comment } = splitInlineComment(rest);
    // value 长度是切掉尾随空白后的，comment 里带回来的是原始空白 + 注释
    const valueEnd = valueStart + value.length;
    return {
        valueStart,
        valueEnd,
        keyIndent: line.match(/^\s*/)[0],
        raw: value,
        comment
    };
}

/**
 * YAML：缩进栈逐段下钻。
 * teleport.delay → 找 teleport: 块下的 delay:
 * 数组/列表项（- xxx）不参与定位。
 */
function locateYml(lines, keyPath) {
    const parts = keyPath.split('.').filter(Boolean);
    if (!parts.length) return null;

    let minIndent = -1;
    let i = 0;
    for (let p = 0; p < parts.length; p++) {
        const want = parts[p];
        let found = false;
        let childIndent = -1;
        for (; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim() || /^\s*#/.test(line)) continue;
            const indent = line.match(/^ */)[0].length;
            if (minIndent >= 0 && indent <= minIndent) break;
            const m = line.match(/^(\s*)([^#:\s][^:]*?)\s*:\s*(.*)$/);
            if (!m) continue;
            const key = m[2].trim().replace(/^["']|["']$/g, '');
            if (key !== want) continue;

            const rest = m[3];
            const { value, comment } = splitInlineComment(rest);
            if (p === parts.length - 1) {
                const valueStart = m[1].length + m[2].length + (line.slice(m[1].length + m[2].length).match(/^\s*:\s*/)[0].length);
                return {
                    valueStart,
                    valueEnd: valueStart + value.length,
                    keyIndent: m[1],
                    raw: value,
                    comment
                };
            }
            // 不是最后一段：必须是有内容的块（值为空）
            if (value.trim() !== '') return null;
            minIndent = indent;
            childIndent = indent;
            i++;
            found = true;
            break;
        }
        if (!found) return null;
        void childIndent;
    }
    return null;
}

/**
 * JSON：字符串感知扫描，找到点路径对应值的区间。
 * 不 parse → stringify，只做「定位 + 就地替换」。
 */
function locateJson(text, keyPath) {
    const parts = keyPath.split('.').filter(Boolean);
    if (!parts.length) return null;
    let pos = 0;

    for (let p = 0; p < parts.length; p++) {
        const want = parts[p];
        const hit = findJsonKey(text, pos, want);
        if (!hit) return null;
        // hit.valueStart 指向值的第一个字符
        if (p === parts.length - 1) {
            const end = findJsonValueEnd(text, hit.valueStart);
            if (end < 0) return null;
            const lineNo = text.slice(0, hit.valueStart).split('\n').length;
            return {
                valueStart: hit.valueStart,
                valueEnd: end,
                keyIndent: '',
                raw: text.slice(hit.valueStart, end),
                comment: '',
                lineNo
            };
        }
        // 中间段必须是对象开始；下一层从 { 本身开始扫描，
        // 由 depth 计数把 { 自身消费掉，之后的键才在 depth === 1 出现
        if (text[hit.valueStart] !== '{') return null;
        pos = hit.valueStart;
    }
    return null;
}

/**
 * 从 from 开始扫描一个「当前层级」并向下递归，找 key 对应的值起点。
 * from 指向本层的 { 或第一个字符：
 *   - 若 from 处就是 {，depth 从 0 起，进入后为 1，本层键在 depth === 1；
 *   - 否则（顶层无包裹）depth 从 0 起，本层键在 depth === 0。
 * 为统一两种入口，这里用 baseDepth 记录「本层键所在的深度」。
 * @param {string} text
 * @param {number} from
 * @param {string} want
 * @returns {{valueStart:number}|null}
 */
function findJsonKey(text, from, want) {
    const startsWithBrace = text[from] === '{' || text[from] === '[';
    let depth = 0;
    // 从 { 起扫时，{ 自己把 depth 抬到 1，本层的键就落在 1；
    // 从裸内容起扫（顶层无包裹）时键落在 0。
    const keyDepth = startsWithBrace ? 1 : 0;
    let i = from;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"') {
            const end = skipJsonString(text, i);
            if (end < 0) return null;
            const lit = text.slice(i + 1, end);
            // 看后面是否紧跟冒号（本层的键）
            let j = end + 1;
            while (j < text.length && /\s/.test(text[j])) j++;
            if (end < 0) return null;
            if (depth === keyDepth && text[j] === ':') {
                if (jsonUnescape(lit) === want) {
                    let v = j + 1;
                    while (v < text.length && /\s/.test(text[v])) v++;
                    return { valueStart: v };
                }
            }
            i = end + 1;
            continue;
        }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
            depth--;
            // 本层闭合，后面的键不属于本层，直接停
            if (depth < keyDepth) return null;
        }
        i++;
    }
    return null;
}

/** 跳过一段 JSON 字符串，返回结束引号位置 */
function skipJsonString(text, start) {
    let i = start + 1;
    while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"') return i;
        i++;
    }
    return -1;
}

function jsonUnescape(s) {
    return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, c) => {
        if (c[0] === 'u') return String.fromCharCode(parseInt(c.slice(1), 16));
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
        return map[c] !== undefined ? map[c] : c;
    });
}

/** 从值的第一个字符找到值的结束位置（不含） */
function findJsonValueEnd(text, start) {
    const ch = text[start];
    if (ch === '"') {
        const e = skipJsonString(text, start);
        return e < 0 ? -1 : e + 1;
    }
    if (ch === '{' || ch === '[') {
        let depth = 0;
        let i = start;
        while (i < text.length) {
            if (text[i] === '"') {
                const e = skipJsonString(text, i);
                if (e < 0) return -1;
                i = e + 1;
                continue;
            }
            if (text[i] === '{' || text[i] === '[') depth++;
            else if (text[i] === '}' || text[i] === ']') {
                depth--;
                if (depth === 0) return i + 1;
            }
            i++;
        }
        return -1;
    }
    // 字面量 true / false / 数字 / null
    let i = start;
    while (i < text.length && !/[,\}\]\s]/.test(text[i])) i++;
    return i;
}

/** properties / txt：扁平 key=value 或 key value，接受「最后一段」或完整键名 */
function locateFlat(lines, keyPath) {
    const parts = keyPath.split('.').filter(Boolean);
    if (!parts.length) return null;
    const leaf = parts[parts.length - 1];
    const candidates = [keyPath, leaf];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!') || trimmed.startsWith('//')) continue;
        for (const key of candidates) {
            const m = matchKeyLine(line, key, /^\s*([^\s=:#]+)\s*[=:]\s*/);
            if (m) return m;
            // Carpet 风格 `key value`（空格分隔）
            const m2 = matchKeyLine(line, key, /^\s*([^\s=:#]+)\s+/) ;
            if (m2) return m2;
        }
    }
    return null;
}

/**
 * HOCON（BlueMap 的 .conf）：支持 key = value 与 a { b = 1 } 嵌套。
 * 用「花括号深度 + 当前路径前缀」定位，比纯正则稳。
 */
function locateHocon(lines, keyPath) {
    const parts = keyPath.split('.').filter(Boolean);
    if (!parts.length) return null;
    const stack = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const code = line.replace(/^\s*#.*$/, '');
        if (!code.trim()) continue;

        // 关闭的括号
        const closes = (code.match(/\}/g) || []).length;
        // 处理本行之前的关闭
        let scan = code.trim();
        const openMatch = scan.match(/^([A-Za-z0-9_.\-\u0080-\uffff]+)\s*\{/);
        if (openMatch) {
            const keyFull = [...stack, openMatch[1]].join('.');
            // 本行可能还有内容？HOCON 一般一个 key { 单独一行
            for (let c = closes; c > 0; c--) { /* no-op */ }
            const afterOpen = scan.slice(openMatch[0].length);
            const closeAfter = (afterOpen.match(/\}/g) || []).length;
            if (closeAfter === 0) {
                if (keyFull === parts.join('.')) {
                    // 目标是个对象，不是可编辑标量
                    return null;
                }
                stack.push(openMatch[1]);
                continue;
            }
        }

        // 标量行 key = value / key : value
        const m = scan.match(/^([A-Za-z0-9_.\-\u0080-\uffff]+)\s*[=:]\s*/);
        if (m) {
            const keyFull = [...stack, m[1]].join('.');
            if (keyFull === keyPath || (!stack.length && m[1] === keyPath)) {
                const indentLen = line.match(/^\s*/)[0].length;
                const valueStart = indentLen + line.slice(indentLen).indexOf(scan) + m[0].length;
                const rest = line.slice(valueStart);
                const { value, comment } = splitInlineComment(rest);
                return {
                    valueStart,
                    valueEnd: valueStart + value.length,
                    keyIndent: line.match(/^\s*/)[0],
                    raw: value,
                    comment
                };
            }
        }

        // 行尾关闭括号
        for (let c = closes; c > 0; c--) stack.pop();
    }
    return null;
}

/**
 * 按格式定位一个键
 * @returns {{lineNo:number, valueStart:number, valueEnd:number, keyIndent:string, raw:string, comment:string}|null}
 */
function locate(lines, keyPath, format) {
    switch (format) {
        case 'toml': return locateToml(lines, keyPath);
        case 'yml':
        case 'yaml': return locateYml(lines, keyPath);
        case 'properties':
        case 'txt': return locateFlat(lines, keyPath);
        case 'conf':
        case 'hocon': return locateHocon(lines, keyPath);
        default: {
            // 未知格式：先 toml 再扁平，最后 yml，尽量能读到
            return locateToml(lines, keyPath) || locateFlat(lines, keyPath) || locateYml(lines, keyPath);
        }
    }
}

/** 给 locate 的结果补上行号 */
function locateWithLine(text, keyPath, format) {
    if (format === 'json') {
        const hit = locateJson(text, keyPath);
        if (!hit) return null;
        const lineNo = text.slice(0, hit.valueStart).split('\n').length;
        return { ...hit, lineNo };
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const one = locate([lines[i]], keyPath, format);
        if (one) return { ...one, lineNo: i + 1 };
    }
    // yml/conf 需要上下文，走整体定位再反推行号
    const hit = locate(lines, keyPath, format);
    if (!hit) return null;
    // 用值片段反查行号
    const needle = hit.raw;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(needle) && lines[i].length >= hit.valueEnd) {
            // 粗略但足够：逐行重算偏移
            if (lines[i].slice(hit.valueStart, hit.valueEnd) === needle || lines[i].indexOf(needle) === hit.valueStart) {
                return { ...hit, lineNo: i + 1 };
            }
        }
    }
    return { ...hit, lineNo: 0 };
}

// ============================================================================
// 对外：读
// ============================================================================

/**
 * 按 schema 读一个配置文件的字段值。
 * @param {string} relPath
 * @param {object} fileSchema schema.config_files[i]
 * @returns {{ok:boolean, reason?:string, entries?:object[], text?:string, lineCount?:number}}
 */
function readFile(relPath, fileSchema) {
    const r = resolveInBoundary(relPath, { mustExist: true });
    if (!r.ok) return { ok: false, reason: r.reason };
    let text;
    try {
        text = readText(r.abs);
    } catch (e) {
        return { ok: false, reason: e.code === 'EBINARY' ? e.message : `读取失败：${e.message}` };
    }
    const lineCount = text.split('\n').length;
    const entries = [];
    for (const field of fileSchema.fields) {
        const hit = locateWithLine(text, field.key, fileSchema.format);
        if (hit) {
            const info = inferValue(hit.raw);
            entries.push({
                key: field.key,
                label: field.label,
                description: field.description,
                type: field.type,
                min: field.min,
                max: field.max,
                options: field.options,
                danger: field.danger,
                advanced: field.advanced,
                placeholder: field.placeholder,
                present: true,
                value: info.value,
                valueType: info.type,
                lineNo: hit.lineNo
            });
        } else {
            entries.push({
                key: field.key,
                label: field.label,
                description: field.description,
                type: field.type,
                min: field.min,
                max: field.max,
                options: field.options,
                danger: field.danger,
                advanced: field.advanced,
                placeholder: field.placeholder,
                present: false,
                value: field.default !== undefined ? field.default : null,
                valueType: field.type === 'number' ? 'number' : (field.type === 'boolean' ? 'boolean' : 'string'),
                lineNo: 0
            });
        }
    }
    return {
        ok: true,
        rel: r.rel,
        text,
        lineCount,
        entries,
        missing: entries.filter(e => !e.present).map(e => e.key)
    };
}

/**
 * 按 schema 读取单个键（CLI get 用）。
 * @param {string} relPath
 * @param {string} keyPath
 * @param {string} format
 */
function readKey(relPath, keyPath, format) {
    const r = resolveInBoundary(relPath, { mustExist: true });
    if (!r.ok) return { ok: false, reason: r.reason };
    let text;
    try {
        text = readText(r.abs);
    } catch (e) {
        return { ok: false, reason: e.code === 'EBINARY' ? e.message : `读取失败：${e.message}` };
    }
    const hit = locateWithLine(text, keyPath, format);
    if (!hit) return { ok: false, reason: `配置项未找到：${keyPath}` };
    const info = inferValue(hit.raw);
    return {
        ok: true,
        rel: r.rel,
        key: keyPath,
        lineNo: hit.lineNo,
        raw: hit.raw,
        value: info.value,
        type: info.type,
        comment: (hit.comment || '').trim()
    };
}

// ============================================================================
// 对外：写（行级替换 + 原子写）
// ============================================================================

/**
 * 在一份文本里按 key 替换值，返回新文本。
 * 找不到键时原样返回并在 results 里标记 missing。
 * @param {string} text
 * @param {string} keyPath
 * @param {*} newValue
 * @param {string} format
 * @param {object} [field] schema 字段（类型/范围）
 * @param {string} [origRaw] 该键最初的原始值（重复提交同一键时用于类型判断）
 * @returns {{ok:boolean, text:string, changed:boolean, reason?:string, oldValue?:any}}
 */
function replaceInText(text, keyPath, newValue, format, field, origRaw) {
    if (format === 'snbt') {
        return { ok: false, text, changed: false, reason: 'SNBT（FTB 任务数据）暂不支持写入，请用源码模式' };
    }
    const hit = locateWithLine(text, keyPath, format);
    if (!hit) {
        return { ok: false, text, changed: false, reason: `配置项未找到：${keyPath}` };
    }
    const oldInfo = inferValue(hit.raw);
    // 类型判断的基准值：优先用最初的原值（重复提交时 hit.raw 已是新值）
    const baseRaw = origRaw !== undefined && origRaw !== null ? origRaw : hit.raw;
    const rendered = renderValue(baseRaw, newValue, field || (format === 'json' ? jsonFieldType(baseRaw) : undefined));
    if (!rendered.ok) {
        return { ok: false, text, changed: false, reason: rendered.reason, oldValue: oldInfo.value };
    }

    let newText;
    if (format === 'json') {
        newText = text.slice(0, hit.valueStart) + rendered.text + text.slice(hit.valueEnd);
    } else {
        const lines = text.split('\n');
        const idx = hit.lineNo - 1;
        if (idx < 0 || idx >= lines.length) {
            return { ok: false, text, changed: false, reason: '定位失败（行号越界）' };
        }
        const line = lines[idx];
        // 保留原缩进与注释：只换 [valueStart, valueEnd)
        const rebuilt = line.slice(0, hit.valueStart) + rendered.text + line.slice(hit.valueEnd);
        // 二次确认：键没被破坏
        if (!rebuilt.includes(keyPath.split('.').pop())) {
            return { ok: false, text, changed: false, reason: '定位校验失败，已放弃写入以免改坏文件' };
        }
        lines[idx] = rebuilt;
        newText = lines.join('\n');
    }

    const changed = newText !== text;
    return { ok: true, text: newText, changed, oldValue: oldInfo.value };
}

/** JSON 里值本身是数字/布尔时，让 renderValue 走对应分支 */
function jsonFieldType(raw) {
    const info = inferValue(raw);
    if (info.type === 'number') return { type: 'number' };
    if (info.type === 'boolean') return { type: 'boolean' };
    return { type: 'string' };
}

/**
 * 备份 + 临时文件 + rename 原子替换。
 * @param {string} abs
 * @param {string} content
 */
function atomicWrite(abs, content) {
    const dir = path.dirname(abs);
    fs.ensureDirSync(dir);
    const backup = `${abs}.bak`;
    try {
        fs.copySync(abs, backup);
    } catch (e) {
        // 原文件不存在时无需备份
        if (e.code !== 'ENOENT') throw e;
    }
    const tmp = path.join(dir, `.${path.basename(abs)}.wow-tmp`);
    fs.writeFileSync(tmp, content, 'utf8');
    try {
        fs.renameSync(tmp, abs);
    } catch (e) {
        try { fs.removeSync(tmp); } catch (_) { /* ignore */ }
        throw e;
    }
    return backup;
}

/**
 * 把一批改动写回文件。
 * @param {string} relPath
 * @param {object} fileSchema schema.config_files[i]
 * @param {Array<{key:string, value:any}>|object} changes 数组或 {key: value}
 * @returns {{ok:boolean, reason?:string, applied?:object[], missing?:string[], text?:string, backup?:string, changed?:number}}
 */
function writeChanges(relPath, fileSchema, changes) {
    if (!WRITABLE_FORMATS.has(fileSchema.format)) {
        return { ok: false, reason: `format「${fileSchema.format}」不支持写入` };
    }
    const r = resolveInBoundary(relPath, { mustExist: true });
    if (!r.ok) return { ok: false, reason: r.reason };

    let text;
    try {
        text = readText(r.abs);
    } catch (e) {
        return { ok: false, reason: e.code === 'EBINARY' ? e.message : `读取失败：${e.message}` };
    }

    const pairs = Array.isArray(changes)
        ? changes.map(c => ({ key: String(c.key || ''), value: c.value }))
        : Object.keys(changes || {}).map(k => ({ key: k, value: changes[k] }));

    if (!pairs.length) return { ok: false, reason: '没有要修改的项' };

    const fieldByKey = new Map(fileSchema.fields.map(f => [f.key, f]));
    const applied = [];
    const missing = [];
    const failed = [];
    let working = text;
    // 先拍下每个键的「原始值」：同一个键若被重复提交，第二次比对
    // 应拿最初的值做类型判断，而不是上一轮刚写进去的值。
    const originalRaw = new Map();
    for (const { key } of pairs) {
        if (originalRaw.has(key)) continue;
        const hit = locateWithLine(text, key, fileSchema.format);
        originalRaw.set(key, hit ? hit.raw : null);
    }

    for (const { key, value } of pairs) {
        const field = fieldByKey.get(key);
        if (!field) {
            failed.push({ key, reason: 'Schema 里没有这个键，拒绝写入（防止误改未映射配置）' });
            continue;
        }
        const origRaw = originalRaw.get(key);
        if (origRaw === null) {
            missing.push(key);
            continue;
        }
        const res = replaceInText(working, key, value, fileSchema.format, field, origRaw);
        if (!res.ok) {
            if (/配置项未找到/.test(res.reason)) missing.push(key);
            else failed.push({ key, reason: res.reason });
            continue;
        }
        if (res.changed) {
            working = res.text;
            applied.push({ key, label: field.label, oldValue: res.oldValue, value });
        } else {
            applied.push({ key, label: field.label, oldValue: res.oldValue, value, unchanged: true });
        }
    }

    if (failed.length) {
        return { ok: false, reason: failed.map(f => `${f.key}：${f.reason}`).join('；'), missing, failed };
    }
    if (!applied.some(a => !a.unchanged)) {
        return { ok: true, applied, missing, changed: 0, text, backup: null };
    }

    let backup;
    try {
        backup = atomicWrite(r.abs, working);
    } catch (e) {
        return { ok: false, reason: `写入失败：${e.message}` };
    }
    return {
        ok: true,
        rel: r.rel,
        applied,
        missing,
        changed: applied.filter(a => !a.unchanged).length,
        text: working,
        backup
    };
}

// ============================================================================
// 对外：方案内文件清单（懒加载 + 大文件降级）
// ============================================================================

/**
 * 列出根层或某个子目录下的条目（懒加载：只扫一层）。
 * @param {string} dirRel '' 或 config / plugins/xxx
 */
function listDir(dirRel) {
    const root = serverRoot();
    const clean = String(dirRel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (clean && (clean.includes('..') || path.isAbsolute(clean))) {
        return { ok: false, reason: '路径非法' };
    }
    const abs = clean ? path.resolve(root, clean) : root;
    if (!fs.existsSync(abs)) {
        if (!clean) return { ok: true, path: '', dirs: BOUNDARY_DIRS.filter(d => fs.existsSync(path.join(root, d))), files: [] };
        return { ok: false, reason: `目录不存在：${clean}` };
    }

    // 根层只暴露三个边界目录
    let names;
    if (!clean) {
        names = BOUNDARY_DIRS.filter(d => {
            try { return fs.statSync(path.join(root, d)).isDirectory(); } catch (e) { return false; }
        });
        return { ok: true, path: '', dirs: names.slice().sort(), files: [] };
    }

    let dirents;
    try {
        dirents = fs.readdirSync(abs, { withFileTypes: true });
    } catch (e) {
        return { ok: false, reason: `读取目录失败：${e.message}` };
    }
    const dirs = [];
    const files = [];
    for (const d of dirents) {
        if (d.name.startsWith('.')) continue;
        const childRel = clean ? `${clean}/${d.name}` : d.name;
        if (d.isDirectory()) {
            dirs.push(d.name);
            continue;
        }
        const ext = path.extname(d.name).toLowerCase();
        if (DENY_EXTS.has(ext)) continue;
        // 跳过我们自己的备份与临时文件，别让它们出现在文件树里
        if (/\.bak\d*$/.test(d.name) || d.name.includes('.wow-tmp')) continue;
        let size = 0;
        try { size = fs.statSync(path.join(abs, d.name)).size; } catch (e) { /* ignore */ }
        if (size > 2 * 1024 * 1024) continue; // 2MB 以上不给编辑
        const hit = require('./schema_store').findByPath(childRel);
        files.push({
            name: d.name,
            path: childRel,
            size,
            schema: hit ? { mod_id: hit.schema.mod_id, display_name: hit.schema.display_name } : null
        });
    }
    dirs.sort();
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return { ok: true, path: clean, dirs, files };
}

/**
 * 读取一个文件，决定「表单模式 / 源码模式」。
 * @param {string} relPath
 */
function readFileForEdit(relPath) {
    const r = resolveInBoundary(relPath, { mustExist: true });
    if (!r.ok) return { ok: false, reason: r.reason };
    let text;
    try {
        text = readText(r.abs);
    } catch (e) {
        return { ok: false, reason: e.code === 'EBINARY' ? e.message : `读取失败：${e.message}` };
    }
    const lineCount = text.split('\n').length;
    const Store = require('./schema_store');
    const hit = Store.findByPath(r.rel);

    const base = {
        ok: true,
        path: r.rel,
        text,
        line_count: lineCount,
        // 指令：>200 行一律源码模式
        too_big: lineCount > FORM_MAX_LINES,
        schema: hit ? { mod_id: hit.schema.mod_id, display_name: hit.schema.display_name } : null,
        config_file: hit ? hit.file : null
    };

    if (!hit) {
        const why = lineCount > FORM_MAX_LINES
            ? `该文件 ${lineCount} 行，超过 ${FORM_MAX_LINES} 行，请使用源码模式编辑`
            : '没有匹配的表单包，使用源码模式编辑';
        return { ...base, form_mode: false, reason: why };
    }
    if (lineCount > FORM_MAX_LINES) {
        // 指令：大文件强制降级纯文本，绝不无脑渲染几千个控件
        return {
            ...base,
            form_mode: false,
            reason: `该文件 ${lineCount} 行，超过 ${FORM_MAX_LINES} 行，请使用源码模式编辑`
        };
    }
    const read = readFile(r.rel, hit.file);
    if (!read.ok) {
        return { ...base, form_mode: false, reason: read.reason };
    }
    const entries = read.entries.slice(0, FORM_MAX_ENTRIES);
    return {
        ...base,
        form_mode: entries.length > 0,
        format: hit.file.format,
        entries,
        missing: read.missing,
        truncated: read.entries.length > FORM_MAX_ENTRIES,
        reason: read.missing.length
            ? `有 ${read.missing.length} 项在当前文件里找不到，可能与模组版本不匹配`
            : ''
    };
}

/** 源码模式整体保存 */
function saveRaw(relPath, content) {
    if (typeof content !== 'string') return { ok: false, reason: '内容必须是字符串' };
    const r = resolveInBoundary(relPath, { mustExist: true });
    if (!r.ok) return { ok: false, reason: r.reason };
    try {
        atomicWrite(r.abs, content);
        return { ok: true, path: r.rel };
    } catch (e) {
        return { ok: false, reason: `写入失败：${e.message}` };
    }
}

module.exports = {
    BOUNDARY_DIRS,
    DENY_EXTS,
    FORM_MAX_LINES,
    FORM_MAX_ENTRIES,
    WRITABLE_FORMATS,
    serverRoot,
    resolveInBoundary,
    readText,
    inferValue,
    splitInlineComment,
    renderValue,
    locate,
    locateWithLine,
    replaceInText,
    atomicWrite,
    readFile,
    readKey,
    writeChanges,
    listDir,
    readFileForEdit,
    saveRaw
};
