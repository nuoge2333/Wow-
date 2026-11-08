/**
 * server.properties 读写（Web 实例配置页专用）
 *
 * 与 config.js 里的 ServerProperties 相比，本模块多了三件事：
 *   1. 保留注释、空行与原顺序（只改目标键，不做整文件重排）；
 *   2. 批量更新（一次请求保存整张表单，避免逐键写盘）；
 *   3. 输入校验（键名白名单式正则、值去换行 / 限长），Web 端不信任前端。
 *
 * 编码统一 UTF-8，与项目现有 config.js 的读写方式保持一致。
 */

const fs = require('fs-extra');
const path = require('path');

const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_VALUE_LEN = 1024;

/** server.properties 的路径 */
function propsPath(serverDir) {
    return path.join(serverDir, 'server.properties');
}

/**
 * 常用键的展示分组（顺序即页面顺序）。
 * 不在任何分组里的键归入「其他」，照样可编辑。
 */
const GROUPS = [
    {
        title: '🌐 服务器信息',
        keys: ['motd', 'server-port', 'server-ip', 'max-players', 'online-mode',
            'network-compression-threshold', 'enforce-secure-profile']
    },
    {
        title: '🎮 游戏规则',
        keys: ['gamemode', 'force-gamemode', 'difficulty', 'hardcore', 'pvp',
            'allow-flight', 'allow-nether', 'enable-command-block', 'op-permission-level']
    },
    {
        title: '🌍 世界',
        keys: ['level-name', 'level-seed', 'level-type', 'generate-structures',
            'generator-settings', 'spawn-protection', 'max-world-size']
    },
    {
        title: '👥 玩家与白名单',
        keys: ['white-list', 'enforce-whitelist', 'player-idle-timeout',
            'broadcast-console-to-ops', 'broadcast-rcon-to-ops']
    },
    {
        title: '🐾 生物与实体',
        keys: ['spawn-animals', 'spawn-monsters', 'spawn-npcs',
            'entity-broadcast-range-percentage', 'max-entity-cramming']
    },
    {
        title: '📡 远程控制',
        keys: ['enable-rcon', 'rcon.port', 'rcon.password', 'enable-query', 'query.port']
    },
    {
        title: '⚙️ 性能与其它',
        keys: ['view-distance', 'simulation-distance', 'max-tick-time',
            'use-native-transport', 'prevent-proxy-connections', 'snooper-enabled',
            'resource-pack', 'resource-pack-sha1', 'require-resource-pack']
    }
];

/**
 * 解析 server.properties 文本。
 * @param {string} text
 * @returns {{entries: Array<{key:string, value:string, line:number}>, map: Object}}
 */
function parse(text) {
    const entries = [];
    const map = {};
    const lines = String(text || '').split('\n');
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return;
        const eq = trimmed.indexOf('=');
        if (eq === -1) return;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (!key) return;
        entries.push({ key, value, line: idx });
        map[key] = value;
    });
    return { entries, map };
}

/**
 * 读取某个方案（目录）的 server.properties。
 *
 * @param {string} serverDir 方案目录
 * @returns {{exists:boolean, file:string, entries:Array, values:Object, raw:string, groups:Array, others:Array}}
 */
function readProps(serverDir) {
    const file = propsPath(serverDir);
    const exists = fs.existsSync(file);
    const raw = exists ? fs.readFileSync(file, 'utf8') : '';
    const { entries, map } = parse(raw);

    const grouped = [];
    const used = new Set();
    for (const g of GROUPS) {
        const items = [];
        for (const k of g.keys) {
            if (Object.prototype.hasOwnProperty.call(map, k)) {
                items.push({ key: k, value: map[k] });
                used.add(k);
            }
        }
        if (items.length) grouped.push({ title: g.title, items });
    }
    const others = entries
        .filter(e => !used.has(e.key))
        .map(e => ({ key: e.key, value: e.value }));

    return { exists, file, entries, values: map, raw, groups: grouped, others };
}

/** 值清洗：单行、去首尾空白、限长。返回 null 表示非法。 */
function sanitizeValue(value) {
    if (value === null || value === undefined) return '';
    let v = String(value).replace(/[\r\n]+/g, ' ').trim();
    if (v.length > MAX_VALUE_LEN) v = v.slice(0, MAX_VALUE_LEN);
    return v;
}

/**
 * 批量更新 server.properties。
 * - 保留注释 / 空行 / 原有顺序；
 * - 已存在的键就地替换，新键追加到末尾；
 * - 非法键名或超长值直接拒绝（整批不写，避免半改状态）。
 *
 * @param {string} serverDir
 * @param {Object} updates { key: value }
 * @returns {{ok:boolean, reason?:string, changed:number, created:number, file:string}}
 */
function writeProps(serverDir, updates) {
    const file = propsPath(serverDir);
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return { ok: false, reason: 'updates 必须是对象', changed: 0, created: 0, file };
    }

    const prepared = [];
    for (const [rawKey, rawValue] of Object.entries(updates)) {
        const key = String(rawKey).trim();
        if (!KEY_RE.test(key)) {
            return { ok: false, reason: `非法配置项名称：${rawKey}`, changed: 0, created: 0, file };
        }
        const value = sanitizeValue(rawValue);
        prepared.push({ key, value });
    }
    if (!prepared.length) {
        return { ok: true, changed: 0, created: 0, file };
    }

    let lines = [];
    if (fs.existsSync(file)) {
        lines = fs.readFileSync(file, 'utf8').split('\n');
    }

    let changed = 0;
    let created = 0;
    const added = [];
    for (const { key, value } of prepared) {
        let found = false;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
            const eq = trimmed.indexOf('=');
            if (eq === -1) continue;
            if (trimmed.slice(0, eq).trim() !== key) continue;
            const oldValue = trimmed.slice(eq + 1).trim();
            if (oldValue !== value) {
                lines[i] = `${key}=${value}`;
                changed++;
            }
            found = true;
            break;
        }
        if (!found) {
            added.push({ key, value });
            created++;
        }
    }

    if (added.length) {
        // 去掉尾部空行，追加新键后再补一个换行，避免出现连续空行
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        for (const { key, value } of added) lines.push(`${key}=${value}`);
        lines.push('');
    }

    fs.ensureDirSync(path.dirname(file));
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return { ok: true, changed, created, file };
}

/** 判断某个键是否属于常用键（前端标星用，可选） */
function isKnownKey(key) {
    return GROUPS.some(g => g.keys.includes(key));
}

module.exports = {
    propsPath,
    parse,
    readProps,
    writeProps,
    sanitizeValue,
    isKnownKey,
    GROUPS,
    KEY_RE,
    MAX_VALUE_LEN
};
