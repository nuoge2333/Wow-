/**
 * 模组表单包（Schema）仓库
 *
 * 目录约定（V3.6.2 · 608 进阶）：
 *   - 官方内置库：core/data/mod_schemas/<mod_id>.json（随安装包分发，不写盘）
 *   - 用户扩展库：<项目根>/custom-schemas/<mod_id>.json（与 scheme/ 并列）
 *
 * 加载优先级：用户扩展库 > 官方内置库。
 * 用户发现官方翻译有误、或作者更新了配置，丢一个同名 JSON 进 custom-schemas/
 * 即可整体覆盖，不需要改安装目录里的文件（升级时也不会被冲掉）。
 *
 * 本模块只做「读 + 校验 + 索引」，不碰任何配置文件内容；
 * 具体渲染与写回逻辑在 schema_engine.js。
 */

const fs = require('fs-extra');
const path = require('path');

/** 项目根目录 = core/ 的上一级 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 官方内置库 */
const BUILTIN_DIR = path.resolve(__dirname, '..', 'data', 'mod_schemas');

/** 用户扩展库（可被环境变量覆盖，测试用） */
function customDir() {
    return process.env.WOW_CUSTOM_SCHEMAS_DIR || path.join(PROJECT_ROOT, 'custom-schemas');
}

/** mod_id 只允许字母数字与 _ - .，防止路径穿越 */
const MOD_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

const FIELD_TYPES = new Set(['number', 'boolean', 'string', 'select', 'text']);

/** 每个 schema 最多多少字段，防止一次导入把面板拖死 */
const MAX_FIELDS_PER_SCHEMA = 500;
/** JSON 原文上限 */
const MAX_SCHEMA_BYTES = 512 * 1024;

/**
 * 从一份 schema 里收集所有字段（展平，附带所属文件信息）
 * @param {object} schema
 * @returns {Array<{file:object, field:object, name:string}>}
 */
function collectFields(schema) {
    const out = [];
    for (const file of schema.config_files) {
        for (const field of file.fields) {
            out.push({ file, field, name: `${file.path}::${field.key}` });
        }
    }
    return out;
}

/**
 * 校验并规范化一份 schema。
 * 校验失败返回 ok:false + reason（面向用户的中文说明），不做任何「猜测修复」。
 * @param {*} raw 已 JSON.parse 的对象
 * @returns {{ok:boolean, schema?:object, reason?:string, warnings?:string[]}}
 */
function validate(raw) {
    const warnings = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'Schema 必须是一个 JSON 对象' };
    }
    const modId = String(raw.mod_id || '').trim();
    if (!modId) return { ok: false, reason: '缺少 mod_id' };
    if (!MOD_ID_RE.test(modId)) {
        return { ok: false, reason: `mod_id「${modId}」非法：只允许字母、数字、下划线、点、短横线` };
    }

    const displayName = String(raw.display_name || modId).trim();
    let platforms = Array.isArray(raw.platforms)
        ? raw.platforms.map(p => String(p).trim().toLowerCase()).filter(Boolean)
        : [];
    if (!platforms.length) platforms = ['forge', 'fabric', 'neoforge', 'paper', 'spigot'];

    if (!Array.isArray(raw.config_files) || !raw.config_files.length) {
        return { ok: false, reason: 'config_files 必须是非空数组' };
    }

    const files = [];
    let totalFields = 0;
    const seenFilePaths = new Set();

    for (const f of raw.config_files) {
        if (!f || typeof f !== 'object') {
            return { ok: false, reason: 'config_files 里存在非对象条目' };
        }
        const filePath = String(f.path || '').trim().replace(/\\/g, '/');
        if (!filePath) return { ok: false, reason: 'config_files 里有条目缺少 path' };
        if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath) || filePath.split('/').includes('..')) {
            return { ok: false, reason: `配置文件路径「${filePath}」必须是方案内的相对路径，且不能含 ..` };
        }
        if (seenFilePaths.has(filePath)) {
            return { ok: false, reason: `配置文件「${filePath}」重复出现` };
        }
        seenFilePaths.add(filePath);

        const format = String(f.format || guessFormat(filePath)).trim().toLowerCase();
        if (!Array.isArray(f.fields)) {
            return { ok: false, reason: `「${filePath}」缺少 fields 数组` };
        }
        if (!f.fields.length) {
            // 空字段的文件没有意义，跳过但提醒
            warnings.push(`「${filePath}」没有任何字段，已忽略`);
            continue;
        }

        const fields = [];
        const seenKeys = new Set();
        for (const fd of f.fields) {
            if (!fd || typeof fd !== 'object') {
                return { ok: false, reason: `「${filePath}」里存在非对象的字段定义` };
            }
            const key = String(fd.key || '').trim();
            if (!key) return { ok: false, reason: `「${filePath}」里有字段缺少 key` };
            if (seenKeys.has(key)) {
                return { ok: false, reason: `「${filePath}」里字段「${key}」重复定义` };
            }
            seenKeys.add(key);

            let type = String(fd.type || 'string').trim().toLowerCase();
            if (!FIELD_TYPES.has(type)) {
                warnings.push(`字段「${key}」的 type「${type}」不认识，按 string 处理`);
                type = 'string';
            }
            const item = {
                key,
                // label 缺失时退回 key 本身（指令要求：绝不瞎翻译，键名原样）
                label: String(fd.label || key),
                description: String(fd.description || ''),
                type
            };
            if (type === 'number') {
                if (Number.isFinite(fd.min)) item.min = fd.min;
                if (Number.isFinite(fd.max)) item.max = fd.max;
            }
            if (type === 'select' && Array.isArray(fd.options)) {
                item.options = fd.options
                    .map(o => (typeof o === 'string' ? { value: o, label: o } : {
                        value: String(o && o.value != null ? o.value : ''),
                        label: String((o && o.label) || (o && o.value) || '')
                    }))
                    .filter(o => o.value !== '');
                if (!item.options.length) {
                    warnings.push(`字段「${key}」是 select 但没有 options，按 string 处理`);
                    item.type = 'string';
                }
            }
            if (fd.default !== undefined) item.default = fd.default;
            if (fd.danger === true) item.danger = true;
            if (fd.advanced === true) item.advanced = true;
            if (typeof fd.placeholder === 'string') item.placeholder = fd.placeholder;

            fields.push(item);
            totalFields++;
            if (totalFields > MAX_FIELDS_PER_SCHEMA) {
                return { ok: false, reason: `字段总数超过 ${MAX_FIELDS_PER_SCHEMA}，请拆分 Schema` };
            }
        }

        files.push({ path: filePath, format, fields });
    }

    if (!files.length) return { ok: false, reason: '没有任何有效的 config_files' };

    const schema = {
        mod_id: modId,
        display_name: displayName,
        platforms,
        config_files: files
    };
    if (typeof raw.author === 'string' && raw.author.trim()) schema.author = raw.author.trim();
    if (typeof raw.version === 'string' && raw.version.trim()) schema.version = raw.version.trim();
    if (typeof raw.homepage === 'string' && raw.homepage.trim()) schema.homepage = raw.homepage.trim();

    return { ok: true, schema, warnings };
}

/** 按扩展名猜格式（Schema 里没写 format 时兜底） */
function guessFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.toml': 'toml',
        '.yml': 'yml',
        '.yaml': 'yml',
        '.json': 'json',
        '.json5': 'json',
        '.conf': 'conf',
        '.hocon': 'conf',
        '.properties': 'properties',
        '.txt': 'txt',
        '.cfg': 'txt',
        '.snbt': 'snbt'
    };
    return map[ext] || 'txt';
}

/** 列出某个目录下的 *.json（不存在返回空数组） */
function listJsonFiles(dir) {
    try {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter(n => n.toLowerCase().endsWith('.json'))
            .map(n => path.join(dir, n));
    } catch (e) {
        return [];
    }
}

/**
 * 加载单个 JSON 文件为 schema。
 * @param {string} file
 * @returns {{ok:boolean, schema?:object, reason?:string, warnings?:string[]}}
 */
function loadFile(file) {
    try {
        const stat = fs.statSync(file);
        if (stat.size > MAX_SCHEMA_BYTES) {
            return { ok: false, reason: `${path.basename(file)} 超过 ${Math.round(MAX_SCHEMA_BYTES / 1024)}KB` };
        }
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const r = validate(raw);
        if (!r.ok) return { ok: false, reason: `${path.basename(file)}：${r.reason}` };
        r.schema._source = file;
        r.schema._origin = file.startsWith(BUILTIN_DIR + path.sep) ? 'builtin' : 'custom';
        r.schema._originLabel = r.schema._origin === 'builtin' ? '官方' : '用户';
        return r;
    } catch (e) {
        return { ok: false, reason: `${path.basename(file)}：${e.message}` };
    }
}

/**
 * 加载全部 schema（用户库覆盖官方库）。
 * @returns {{ok:boolean, schemas:object[], errors:string[]}}
 */
function loadAll() {
    const errors = [];
    const byId = new Map();

    // 先官方，后用户：用户库同名直接覆盖
    for (const file of listJsonFiles(BUILTIN_DIR)) {
        const r = loadFile(file);
        if (!r.ok) { errors.push(r.reason); continue; }
        byId.set(r.schema.mod_id, r.schema);
    }
    for (const file of listJsonFiles(customDir())) {
        const r = loadFile(file);
        if (!r.ok) { errors.push(r.reason); continue; }
        byId.set(r.schema.mod_id, r.schema);
    }

    const schemas = [...byId.values()].sort((a, b) =>
        a.display_name.localeCompare(b.display_name, 'zh-CN'));
    return { ok: true, schemas, errors };
}

/**
 * 按 mod_id 取一个 schema；同时也支持按「显示名/别名」模糊匹配（CLI 友好）。
 * @param {string} idOrName
 */
function get(idOrName) {
    const q = String(idOrName || '').trim();
    if (!q) return null;
    const { schemas } = loadAll();
    const lower = q.toLowerCase();
    // 1. mod_id 精确
    let hit = schemas.find(s => s.mod_id.toLowerCase() === lower);
    if (hit) return hit;
    // 2. 文件名（不含扩展名）精确
    hit = schemas.find(s => path.basename(s._source || '', '.json').toLowerCase() === lower);
    if (hit) return hit;
    // 3. 显示名包含（display_name / mod_id）
    hit = schemas.find(s => s.display_name.toLowerCase().includes(lower));
    if (hit) return hit;
    return null;
}

/**
 * 按配置文件相对路径反查 schema。
 * 用于 Web 端「打开某个配置文件时是否有对应表单」。
 * @param {string} relPath 方案内相对路径，如 serverconfig/create-server.toml
 * @returns {{schema:object, file:object}|null}
 */
function findByPath(relPath) {
    const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!norm) return null;
    const { schemas } = loadAll();
    for (const schema of schemas) {
        // 先精确匹配
        const exact = schema.config_files.find(f => f.path === norm);
        if (exact) return { schema, file: exact };
    }
    for (const schema of schemas) {
        // 再按文件名匹配（不同整合包可能把 serverconfig 改成 config/xxx-server.toml）
        const base = path.posix.basename(norm);
        const loose = schema.config_files.find(f => path.posix.basename(f.path) === base);
        if (loose) return { schema, file: loose };
    }
    return null;
}

/**
 * 把一份 JSON 文本解析 + 校验成 schema（导入用，还没落盘）。
 * @param {string|object} input
 */
function parseImport(input) {
    let raw = input;
    if (typeof input === 'string') {
        const text = input.trim();
        if (!text) return { ok: false, reason: '内容为空' };
        if (Buffer.byteLength(text, 'utf8') > MAX_SCHEMA_BYTES) {
            return { ok: false, reason: `内容超过 ${Math.round(MAX_SCHEMA_BYTES / 1024)}KB` };
        }
        try {
            raw = JSON.parse(text);
        } catch (e) {
            return { ok: false, reason: `不是合法 JSON：${e.message}` };
        }
    }
    return validate(raw);
}

/**
 * 保存到用户扩展库（覆盖同名文件）。
 * @param {object} schema 已经过 validate 的对象
 */
function saveCustom(schema) {
    const dir = customDir();
    fs.ensureDirSync(dir);
    const file = path.join(dir, `${schema.mod_id}.json`);
    const { _source, _origin, _originLabel, warnings, ...clean } = schema;
    const tmp = path.join(dir, `.${schema.mod_id}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, file, origin: 'custom' };
}

/**
 * 删除用户扩展库里的某个 schema。
 * 官方内置的不允许删（只能「用同名用户包覆盖」）。
 * @param {string} modId
 */
function removeCustom(modId) {
    if (!MOD_ID_RE.test(String(modId || ''))) return { ok: false, reason: 'mod_id 非法' };
    const file = path.join(customDir(), `${modId}.json`);
    if (!fs.existsSync(file)) {
        return { ok: false, reason: `用户扩展库里没有「${modId}」` };
    }
    fs.removeSync(file);
    return { ok: true, file };
}

module.exports = {
    PROJECT_ROOT,
    BUILTIN_DIR,
    customDir,
    MOD_ID_RE,
    FIELD_TYPES,
    MAX_FIELDS_PER_SCHEMA,
    MAX_SCHEMA_BYTES,
    guessFormat,
    collectFields,
    validate,
    loadFile,
    loadAll,
    get,
    findByPath,
    parseImport,
    saveCustom,
    removeCustom
};
