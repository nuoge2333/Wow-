/**
 * 玩家名单管理（V3.8.0，P1 玩家追踪与名单管理）
 *
 * 职责：
 *   - 读取 / 合并 scheme/<方案>/scheme.yaml 里的 known_players（去重 + 保留首次加入时间）；
 *   - 比对 whitelist.json / banned-players.json 给出每个玩家的白/黑名单状态；
 *   - 白名单 / 黑名单的写入分发（**铁律①**）。
 *
 * 铁律①（文件热更新防冲突）：
 *   服务器**运行时**改白名单 / 黑名单，必须走 stdin 发指令（`whitelist add` / `ban`），
 *   由 MC 服务端自己在内存里生效并落盘；只有**停服**才允许直接改 JSON。
 *   运行时直接改 JSON 会被服务端内存状态覆盖，或与之竞争写坏文件 —— 禁止。
 *   stdin 发送失败（如 Windows 跨进程）时**绝不降级改 JSON**，而是明确报错让
 *   用户停服后重试，避免踩中同一坑。
 *
 * 安全：玩家 id 必须是 MC 合法 ID（[a-zA-Z0-9_]{3,16}），否则拒绝；
 * 因为 id 会被拼进 stdin 指令，含换行 / 空格会构成指令注入。
 */

const path = require('path');
const fs = require('fs-extra');
const config = require('./config');

const PLAYER_ID_RE = /^[a-zA-Z0-9_]{3,16}$/;

class PlayerManager {
    /**
     * @param {Object} [opts]
     * @param {Object} [opts.schemeManager] 注入 SchemeManager 实例（测试用；默认自建）
     * @param {Object} [opts.server]        注入 ServerManager 实例（测试用；默认自建）
     */
    constructor(opts = {}) {
        this._sm = opts.schemeManager || null;
        this._server = opts.server || null;
        // 注入了 server（测试）时直接走它的 sendCommand，不碰全局中继文件，
        // 保证测试确定性；真实运行未注入时才启用 relay-aware 分发。
        this._serverInjected = !!opts.server;
    }

    _smInstance() {
        if (!this._sm) {
            const SchemeManager = require('./scheme_manager');
            this._sm = new SchemeManager();
        }
        return this._sm;
    }

    _serverInstance() {
        if (!this._server) {
            const ServerManager = require('./server');
            this._server = new ServerManager();
        }
        return this._server;
    }

    /**
     * 把一条 MC 指令送到正在运行的服务器（铁律①的运行态分支）。
     *
     * 优先走「控制台中继队列」：与 Web 控制台 /api/console/send 同一条链路，
     * 由持有 MC stdin 的进程取走并写入，最可靠。若中继不在线（例如服务端由
     * 旧版本拉起），再兜底用 server.sendCommand()（同进程写 stdin / Linux 写
     * /proc/<pid>/fd/0）。直接写 stdin 在有开服控制台时可能被当成 wow 命令解析，
     * 所以中继优先是必要的，不能反过来。
     */
    _sendToServer(command) {
        if (this._serverInjected) return this._server.sendCommand(command);
        try {
            const ServerManager = require('./server');
            if (typeof ServerManager.isConsoleRelayAlive === 'function' &&
                ServerManager.isConsoleRelayAlive() &&
                typeof ServerManager.enqueueConsoleCommand === 'function' &&
                ServerManager.enqueueConsoleCommand(command)) {
                return true;
            }
        } catch (e) { /* 中继不可用，降级到 sendCommand */ }
        return this._serverInstance().sendCommand(command);
    }

    /** 目标方案名：显式指定优先，否则取当前激活方案 */
    resolveScheme(schemeName) {
        const sm = this._smInstance();
        if (schemeName && String(schemeName).trim()) {
            const name = String(schemeName).trim();
            if (!sm._schemeExists(name)) {
                throw new Error(`方案「${name}」不存在`);
            }
            return name;
        }
        const active = sm.getActiveScheme();
        if (!active) {
            throw new Error('当前没有激活的方案，请用 --scheme 指定方案名');
        }
        return active;
    }

    /** 方案目录（serverDir）：whitelist.json / banned-players.json 与 scheme.yaml 同目录 */
    _schemeDir(schemeName) {
        return this._smInstance()._getSchemePath(schemeName);
    }

    /** 公开入口：取方案目录绝对路径（供 player_tracker 定位 logs/latest.log） */
    getSchemeDir(schemeName) {
        return this._schemeDir(this.resolveScheme(schemeName));
    }

    /** 公开入口：服务器是否在运行（Web 卡片据此提示「运行态走 stdin」） */
    isServerRunning() {
        return this._serverInstance().isRunning();
    }

    /** 校验玩家 id，防 stdin 指令注入 */
    static validateId(id) {
        const s = String(id == null ? '' : id).trim();
        if (!PLAYER_ID_RE.test(s)) {
            throw new Error(`玩家 ID「${s}」不合法（须为 3-16 位字母、数字或下划线）`);
        }
        return s;
    }

    // ==================== known_players ====================

    /**
     * 读 scheme.yaml 的 known_players，附加白/黑名单状态。
     * @returns {Array<{id, first_join, whitelisted, banned}>}
     */
    listPlayers(schemeName) {
        const name = this.resolveScheme(schemeName);
        const sm = this._smInstance();
        let meta;
        try {
            meta = sm.getMeta(name) || {};
        } catch (e) {
            return [];
        }
        const known = Array.isArray(meta.known_players) ? meta.known_players : [];
        const { whitelist, banned } = this._readNameSets(name);
        return known.map(p => {
            const id = String((p && (p.id || p.name)) || '');
            return {
                id,
                first_join: (p && p.first_join) || '',
                whitelisted: whitelist.has(id.toLowerCase()),
                banned: banned.has(id.toLowerCase())
            };
        }).filter(p => p.id);
    }

    /**
     * 合并玩家 id 进 known_players：按 id 去重，已有条目**保留原 first_join**。
     * @param {string} schemeName
     * @param {string[]} ids
     * @returns {{added:number, total:number}}
     */
    mergePlayers(schemeName, ids) {
        const name = this.resolveScheme(schemeName);
        const sm = this._smInstance();
        let meta;
        try {
            meta = sm.getMeta(name) || {};
        } catch (e) {
            throw new Error(`读取方案「${name}」元数据失败：${e.message}`);
        }
        const known = Array.isArray(meta.known_players) ? meta.known_players.slice() : [];
        const seen = new Set(known.map(p => String((p && (p.id || p.name)) || '').toLowerCase()).filter(Boolean));
        const now = new Date().toISOString();
        let added = 0;
        for (const raw of ids || []) {
            const id = String(raw || '').trim();
            if (!id || seen.has(id.toLowerCase())) continue;
            seen.add(id.toLowerCase());
            known.push({ id, first_join: now });
            added++;
        }
        if (added > 0) {
            meta.known_players = known;
            sm.saveMeta(name, meta);
        }
        return { added, total: known.length };
    }

    // ==================== 名单状态读取 ====================

    _readJsonArray(file) {
        if (!fs.existsSync(file)) return [];
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            return Array.isArray(data) ? data : [];
        } catch (e) {
            return [];
        }
    }

    /** 返回 {whitelist:Set<小写名>, banned:Set<小写名>} */
    _readNameSets(schemeName) {
        const dir = this._schemeDir(schemeName);
        const wl = this._readJsonArray(path.join(dir, 'whitelist.json'));
        const bp = this._readJsonArray(path.join(dir, 'banned-players.json'));
        return {
            whitelist: new Set(wl.map(e => String((e && e.name) || e || '').toLowerCase()).filter(Boolean)),
            banned: new Set(bp.map(e => String((e && e.name) || e || '').toLowerCase()).filter(Boolean))
        };
    }

    // ==================== 铁律①：名单写入分发 ====================

    /**
     * 加入白名单。
     * @returns {{ok:boolean, via:'stdin'|'file'|'failed', message:string}}
     */
    whitelist(schemeName, id) {
        const name = this.resolveScheme(schemeName);
        const player = PlayerManager.validateId(id);
        const server = this._serverInstance();
        if (server.isRunning()) {
            const sent = this._sendToServer(`whitelist add ${player}`);
            if (!sent) {
                return {
                    ok: false, via: 'failed',
                    message: `服务器运行中，但无法向其 stdin 发送指令（跨进程/平台限制）；为避免写坏文件，未直接改 JSON。请停服后重试。`
                };
            }
            return { ok: true, via: 'stdin', message: `已通过服务器指令 whitelist add ${player}（运行中，内存即时生效）` };
        }
        // 停服：直接改 whitelist.json（复用既有 WhitelistManager，含离线 UUID）
        const wl = new config.WhitelistManager(this._schemeDir(name));
        wl.add(player);
        return { ok: true, via: 'file', message: `已写入 whitelist.json（停服态）：${player}` };
    }

    /**
     * 加入黑名单。
     * @returns {{ok:boolean, via:'stdin'|'file'|'failed', message:string}}
     */
    ban(schemeName, id) {
        const name = this.resolveScheme(schemeName);
        const player = PlayerManager.validateId(id);
        const server = this._serverInstance();
        if (server.isRunning()) {
            const sent = this._sendToServer(`ban ${player}`);
            if (!sent) {
                return {
                    ok: false, via: 'failed',
                    message: `服务器运行中，但无法向其 stdin 发送指令（跨进程/平台限制）；为避免写坏文件，未直接改 JSON。请停服后重试。`
                };
            }
            return { ok: true, via: 'stdin', message: `已通过服务器指令 ban ${player}（运行中，内存即时生效）` };
        }
        // 停服：直接改 banned-players.json（标准结构）
        const file = path.join(this._schemeDir(name), 'banned-players.json');
        const list = this._readJsonArray(file);
        const exists = list.some(e => e && String(e.name || '').toLowerCase() === player.toLowerCase());
        if (!exists) {
            const wl = new config.WhitelistManager(this._schemeDir(name));
            list.push({
                uuid: wl._generateOfflineUUID(player),
                name: player,
                created: formatMcTime(new Date()),
                source: 'wow',
                expires: 'forever',
                reason: '由 wow 添加'
            });
            fs.ensureDirSync(path.dirname(file));
            fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
        }
        return { ok: true, via: 'file', message: `已写入 banned-players.json（停服态）：${player}` };
    }
}

/** Minecraft banned-players.json 的 created 字段格式：yyyy-MM-dd HH:mm:ss +0000 */
function formatMcTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} +0000`;
}

module.exports = { PlayerManager, PLAYER_ID_RE, formatMcTime };
