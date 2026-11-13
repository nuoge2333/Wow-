'use strict';

/**
 * 插件加载器（V3.5.21-26.3c）
 * ----------------------------------------------------------------
 * 扫描 `wow-plugins/<插件名>/plugin.json`，把每个插件声明的命令动态注册到
 * commander 的 program 上，使 `wow <命令名> ...` 可用。
 *
 * 目录约定（插件与主程序物理隔离，插件代码永远不写进 core/）：
 *   wow-plugins/
 *     hello/
 *       plugin.json     清单
 *       index.js        处理函数实现
 *
 * plugin.json：
 *   {
 *     "name": "hello",
 *     "version": "1.0.0",
 *     "author": "someone",
 *     "description": "打招呼",
 *     "commands": [
 *       {
 *         "name": "hello",                    // → wow hello
 *         "description": "打印一句问候",
 *         "options": [ { "flag": "-n, --name <n>", "description": "名字" } ],
 *         "handler": "hello"                  // index.js 导出的函数名
 *       }
 *     ]
 *   }
 *
 * index.js：
 *   module.exports = {
 *     async hello(args, context) { ... }      // args 为 commander 传入的位置参数
 *   };
 *
 * 加载流程（每个插件）：
 *   1. 读 plugin.json → 校验结构（结构不对整插件跳过，不半加载）
 *   2. 算内容指纹 → 对信任表 → new / changed 时要求用户确认（无 TTY 则拒绝）
 *   3. require(index.js) → 失败则「插件 X 崩溃，已跳过」
 *   4. 逐条注册命令 → 名字冲突（保留字 / 已存在 / 其它插件已占）则整插件跳过
 *   5. 每条命令的 action 包在 try-catch 里，运行期崩溃只影响那一次调用
 *
 * ⚠️ 这不是沙箱。插件与主程序同进程同权限（见 plugin_context.js 文件头）。
 */

const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');
const trust = require('./plugin_trust');
const { createContext, CONTEXT_KEYS } = require('./plugin_context');
const policy = require('./command_policy');

/** 插件根目录：<项目根>/wow-plugins（utils 的基准是 core/，故用 ../wow-plugins） */
function getPluginsDir() {
    return utils.resolvePath('../wow-plugins');
}

/** commander 自身占用 / 容易被误当内置的命令名 */
const RESERVED_EXTRA = new Set(['help', 'h', 'l', 'version', 'v']);

/** 不允许用作命令名的 JS 内部标识符（防原型污染） */
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/** 命令名合法字符：小写字母开头，允许 a-z 0-9 - _ */
const NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * 列出插件目录下疑似插件的子目录（含 plugin.json）。
 * @param {string} [pluginsDir]
 * @returns {string[]} 插件名（目录名）数组，按名称排序
 */
function listPluginDirs(pluginsDir) {
    const dir = pluginsDir || getPluginsDir();
    if (!fs.existsSync(dir)) return [];
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return [];
    }
    return entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .filter(e => fs.existsSync(path.join(dir, e.name, 'plugin.json')))
        .map(e => e.name)
        .sort();
}

/**
 * 校验 plugin.json 结构。
 * @param {any} meta
 * @returns {{ok:true, commands:object[]} | {ok:false, reason:string}}
 */
function validateManifest(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return { ok: false, reason: 'plugin.json 不是 JSON 对象' };
    }
    if (!meta.name || typeof meta.name !== 'string') {
        return { ok: false, reason: 'plugin.json 缺少 name 字段' };
    }
    if (!Array.isArray(meta.commands) || meta.commands.length === 0) {
        return { ok: false, reason: 'plugin.json 的 commands 必须是非空数组' };
    }
    // config：插件默认配置（可选）。只允许纯 JSON 对象——数组/标量无法成为
    // 「一组默认值」，而函数等非 JSON 值根本没法落盘。
    if (meta.config !== undefined) {
        if (!meta.config || typeof meta.config !== 'object' || Array.isArray(meta.config)) {
            return { ok: false, reason: 'plugin.json 的 config 必须是 JSON 对象' };
        }
    }
    const seen = new Set();
    for (const cmd of meta.commands) {
        if (!cmd || typeof cmd !== 'object') {
            return { ok: false, reason: 'commands 中存在非对象项' };
        }
        // 用原文校验（NAME_RE 只认小写），不能用 toLowerCase 后的串——
        // 否则 "Hello" 会被悄悄改成 hello，与作者声明的命令名不符，
        // 用户在终端敲 `wow Hello` 反而找不到命令。
        const raw = String(cmd.name == null ? '' : cmd.name);
        if (!NAME_RE.test(raw)) {
            return { ok: false, reason: `命令名 "${cmd.name}" 不合法（需小写字母开头，仅含 a-z 0-9 - _）` };
        }
        const name = raw;
        if (FORBIDDEN_NAMES.has(name)) {
            return { ok: false, reason: `命令名 "${name}" 为保留标识符` };
        }
        if (seen.has(name)) {
            return { ok: false, reason: `命令名 "${name}" 在插件内重复` };
        }
        seen.add(name);
        if (!cmd.handler || typeof cmd.handler !== 'string') {
            return { ok: false, reason: `命令 "${name}" 缺少 handler` };
        }
        if (cmd.options !== undefined) {
            if (!Array.isArray(cmd.options)) {
                return { ok: false, reason: `命令 "${name}" 的 options 必须是数组` };
            }
            for (const opt of cmd.options) {
                if (!opt || typeof opt.flag !== 'string' || !opt.flag.trim()) {
                    return { ok: false, reason: `命令 "${name}" 的 options 存在缺少 flag 的项` };
                }
            }
        }
    }
    return { ok: true, commands: meta.commands };
}

/**
 * 交互式确认（只认 TTY）。非 TTY 直接返回 false——绝不替用户做「同意」的决定。
 *
 * 走 stdin_session 而不是自建 readline：插件加载虽然发生在启动早期，
 * 但 `wow plugin trust` 等命令也可能在 REPL 会话中被再次触发，
 * 那时 stdin 已有人持有，自建就会双读。
 *
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function askYesNo(question) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(false);
    const stdinSession = require('./stdin_session');
    return stdinSession.confirm(question);
}

/**
 * 判断某个命令名是否已被占用（保留字 / 已注册 / 其它插件已占）。
 * @param {import('commander').Command} program
 * @param {string} name
 * @returns {string|null} 冲突原因，无冲突返回 null
 */
function findConflict(program, name) {
    const key = String(name).toLowerCase();
    if (FORBIDDEN_NAMES.has(key)) return `"${key}" 为保留标识符`;
    if (RESERVED_EXTRA.has(key)) return `"${key}" 为 commander 内置命令`;
    if (policy.WOW_NAMESPACES.has(key)) return `"${key}" 是 wow 内置命令`;
    const existing = program.commands.find(c =>
        c.name().toLowerCase() === key ||
        (typeof c.aliases === 'function' && c.aliases().map(a => String(a).toLowerCase()).includes(key))
    );
    if (existing) return `"${key}" 已被其它命令占用`;
    return null;
}

/**
 * 加载单个插件（已确认信任之后）。
 * @param {import('commander').Command} program
 * @param {string} pluginsDir
 * @param {string} dirName 目录名
 * @param {object} log 日志回调 { info, warn, error }
 * @returns {object} 加载结果 { dirName, name, ok, commands:[], reason? }
 */
function loadOne(program, pluginsDir, dirName, log) {
    const pluginDir = path.join(pluginsDir, dirName);
    const result = { dirName, name: dirName, ok: false, commands: [], reason: '' };

    // ---- 1. 清单 ----
    let meta;
    try {
        meta = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
    } catch (e) {
        result.reason = `plugin.json 解析失败：${e.message}`;
        log.warn(`⚠️ 插件 ${dirName} 已跳过：${result.reason}`);
        return result;
    }
    result.name = meta && meta.name ? String(meta.name) : dirName;
    const v = validateManifest(meta);
    if (!v.ok) {
        result.reason = v.reason;
        log.warn(`⚠️ 插件 ${result.name} 已跳过：${result.reason}`);
        return result;
    }

    // ---- 2. 命令名冲突预检（整插件跳过，不半加载）----
    const conflicts = [];
    for (const cmd of v.commands) {
        const c = findConflict(program, cmd.name);
        if (c) conflicts.push(c);
    }
    if (conflicts.length) {
        result.reason = `命令名冲突：${conflicts.join('；')}`;
        log.warn(`⚠️ 插件 ${result.name} 已跳过：${result.reason}`);
        return result;
    }

    // ---- 3. 加载实现（崩溃隔离）----
    const entry = path.join(pluginDir, 'index.js');
    if (!fs.existsSync(entry)) {
        result.reason = '缺少 index.js';
        log.warn(`⚠️ 插件 ${result.name} 已跳过：${result.reason}`);
        return result;
    }
    let mod;
    try {
        mod = require(entry);
    } catch (e) {
        result.reason = `index.js 加载失败：${e.message}`;
        log.error(`❌ 插件 ${result.name} 崩溃，已跳过：${e.message}`);
        return result;
    }
    if (!mod || typeof mod !== 'object') {
        result.reason = 'index.js 未导出对象';
        log.error(`❌ 插件 ${result.name} 崩溃，已跳过：${result.reason}`);
        return result;
    }

    // 处理函数缺失同样视为整插件不可用：注册了命令却调不通比不注册更糟
    const missing = v.commands.filter(c => typeof mod[c.handler] !== 'function').map(c => c.handler);
    if (missing.length) {
        result.reason = `index.js 缺少处理函数：${[...new Set(missing)].join(', ')}`;
        log.error(`❌ 插件 ${result.name} 崩溃，已跳过：${result.reason}`);
        return result;
    }

    // ---- 4. 注册 ----
    // 整段注册也包在 try 里：commander 对非法 option / 重复 command 会抛错，
    // 而这些错在插件作者那边根本看不到。一个插件注册失败，最多是它自己不可用。
    try {
        const ctx = createContext({
            pluginName: result.name,
            // plugin.json 里的 config 就是该插件的默认配置
            pluginDefaults: (meta && typeof meta.config === 'object' && !Array.isArray(meta.config))
                ? meta.config
                : {},
            warn: log.warn
        });
        for (const cmd of v.commands) {
            const name = String(cmd.name).toLowerCase();
            const sub = program.command(name);
            sub.description(cmd.description || `${result.name} 插件命令`);
            for (const opt of (cmd.options || [])) {
                try {
                    sub.option(opt.flag, opt.description || '');
                } catch (e) {
                    log.warn(`⚠️ 插件 ${result.name} 的命令 ${name}：选项 ${opt.flag} 无效，已忽略（${e.message}）`);
                }
            }
            // 运行期异常只毁这一次调用，不连带 commander / 主进程。
            // 对外（终端 / Web）统一只说「插件内部错误」：插件抛出的 message
            // 可能包含内部路径、SQL、密钥片段，不该直接呈现在界面上；详细堆栈进日志。
            sub.action(async (...actionArgs) => {
                const args = actionArgs.slice(0, -1); // 末位是 commander 的 options 对象
                try {
                    const fn = mod[cmd.handler];
                    if (typeof fn !== 'function') {
                        throw new Error(`handler ${cmd.handler} 不是函数`);
                    }
                    return await fn(args, ctx);
                } catch (e) {
                    const detail = e && e.message ? e.message : String(e);
                    log.error(`❌ 插件 ${result.name} 的命令 ${name} 执行失败（插件内部错误）：${detail}`);
                    if (e && e.stack) log.error(String(e.stack));
                    console.error(`插件内部错误：wow ${name} 执行失败。请查看日志或联系插件作者。`);
                    process.exitCode = 1;
                    return undefined;
                }
            });
            sub._wowPlugin = { plugin: result.name, dirName };
            try {
                policy.registerPluginCommand(name);
            } catch (e) {
                log.warn(`⚠️ 插件 ${result.name} 的命令 ${name} 登记失败（不影响注册）: ${e.message}`);
            }
            result.commands.push(name);
        }
    } catch (e) {
        result.reason = `注册命令失败：${e.message}`;
        log.error(`❌ 插件 ${result.name} 注册失败，已跳过：${e.message}`);
        return result;
    }

    result.ok = true;
    return result;
}

/**
 * 运行期护栏：吞掉 unhandledRejection。
 *
 * 插件最常见的写法是 fire-and-forget —— `setTimeout(() => { throw x }, 0)`
 * 或一个不 await 的 fetch。那类异常会变成 unhandledRejection，而 Node 15+
 * 的默认行为是**直接终止进程**：用户看到的是「玩着玩着 wow 就没了」。
 *
 * 边界（刻意为之）：
 *   - 只接管 unhandledRejection。不接管 uncaughtException —— 同步未捕获异常
 *     说明调用栈已断，进程状态不可信，继续跑只会得到「一半坏掉」的实例，
 *     比干净退出更难排查。插件命令的同步路径已由 action 内的 try/catch 覆盖。
 *   - 进程级只装一次；`WOW_STRICT_PROMISE=1` 时不装（排查主程序自身 Promise bug）。
 *
 * @param {{warn:Function,error:Function}} log
 */
let rejectionGuardInstalled = false;
function installRejectionGuard(log) {
    if (rejectionGuardInstalled) return false;
    if (process.env.WOW_STRICT_PROMISE === '1') return false;
    rejectionGuardInstalled = true;

    process.on('unhandledRejection', (reason) => {
        const detail = reason && reason.message ? reason.message : String(reason);
        log.error(`⚠️ 未处理的 Promise 拒绝（可能来自插件，已拦截以避免进程退出）：${detail}`);
        if (reason && reason.stack) log.error(String(reason.stack));
    });
    return true;
}

/**
 * 扫描并加载全部插件，在 program 上注册命令。
 *
 * 必须在 `program.parse(process.argv)` **之前**调用；无参数进入数字菜单的
 * 分支同样要注册，否则 REPL / 菜单里敲插件命令会得到 unknown command。
 *
 * @param {import('commander').Command} program
 * @param {object} [options]
 * @param {string} [options.dir] 插件根目录（测试用，默认 <项目根>/wow-plugins）
 * @param {string} [options.trustFile] 信任表路径（测试用）
 * @param {boolean} [options.interactive] 是否允许弹确认；默认按 TTY 自动判断
 * @param {(q:string)=>Promise<boolean>} [options.confirm] 自定义确认函数（测试用）
 * @param {boolean} [options.quiet] 不打印成功信息（测试用）
 * @param {object} [options.log] 自定义日志 { info, warn, error }
 * @returns {Promise<{loaded:object[], skipped:object[], pending:object[]}>}
 *   loaded  = 成功加载；skipped = 因结构/崩溃/冲突跳过；
 *   pending = 因未信任而未加载（附原因，供 CLI 提示用户）
 */
async function loadPlugins(program, options = {}) {
    const pluginsDir = options.dir || getPluginsDir();
    const trustFile = options.trustFile || trust.TRUST_FILE;
    const quiet = options.quiet === true;
    const log = options.log || {
        info: (m) => console.log(m),
        warn: (m) => console.warn(m),
        error: (m) => console.error(m)
    };

    const out = { loaded: [], skipped: [], pending: [] };

    const dirNames = listPluginDirs(pluginsDir);
    if (dirNames.length === 0) return out;

    const canAsk = options.interactive !== undefined
        ? options.interactive === true
        : (process.stdin.isTTY && process.stdout.isTTY);
    const confirm = typeof options.confirm === 'function'
        ? options.confirm
        : askYesNo;

    for (const dirName of dirNames) {
        const pluginDir = path.join(pluginsDir, dirName);

        // 单个插件的**任何**失败都只能影响它自己。
        // 这里兜住整段流程（读清单、指纹、信任、加载、注册），包括我们没预料到的
        // 第三方异常（比如指纹计算时目录权限被改）。一个坏插件换来一次跳过 +
        // 一条日志，而不是 wow 启动失败。
        try {
            // ---- 先读清单拿到展示名（信任确认要显示给人看）----
            let meta = {};
            try {
                meta = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8')) || {};
            } catch (e) {
                out.skipped.push({ dirName, name: dirName, reason: `plugin.json 解析失败：${e.message}` });
                log.warn(`⚠️ 插件 ${dirName} 已跳过：plugin.json 解析失败`);
                continue;
            }
            const displayName = meta.name ? String(meta.name) : dirName;

            // ---- 信任闸 ----
            const fp = trust.fingerprint(pluginDir);
            const state = trust.checkTrust(displayName, fp, trustFile);

            if (state !== 'trusted') {
                const what = state === 'new' ? '首次加载' : '内容已变更';
                const cmdNames = Array.isArray(meta.commands)
                    ? meta.commands.map(c => `wow ${c && c.name}`).filter(s => s !== 'wow undefined')
                    : [];

                if (!canAsk) {
                    out.pending.push({
                        dirName, name: displayName, fingerprint: fp, state,
                        reason: `插件 ${displayName} ${what}，当前非交互环境无法确认，已跳过`
                    });
                    log.warn(
                        `⚠️ 插件 ${displayName}（${what}）未信任，非交互环境已跳过。` +
                        `请在终端执行 \`wow plugin trust ${displayName}\`。`
                    );
                    continue;
                }

                const lines = [
                    '',
                    `📦 插件 ${displayName}${meta.version ? ` v${meta.version}` : ''} ${what}`,
                    '   [实验性 / Beta] 插件系统仍在公测，接口可能变动，请勿用于生产环境。',
                    meta.author ? `   作者：${meta.author}` : null,
                    meta.description ? `   说明：${meta.description}` : null,
                    cmdNames.length ? `   将新增命令：${cmdNames.join('、')}` : null,
                    '   ⚠️ 插件代码与 wow 主程序同权限，可读写任意文件、发起网络请求。',
                    '      请只启用你信任来源的插件。',
                    `   指纹：${fp.slice(0, 23)}…`
                ].filter(Boolean).join('\n');
                log.info(lines);

                const yes = await confirm('   启用该插件？[y/N] ');
                if (!yes) {
                    out.pending.push({
                        dirName, name: displayName, fingerprint: fp, state,
                        reason: `插件 ${displayName} 未被信任（用户拒绝）`
                    });
                    log.info(`   已跳过插件 ${displayName}。`);
                    continue;
                }
                trust.grantTrust(displayName, fp, trustFile);
                log.info(`   ✅ 已信任 ${displayName}。`);
            }

            // ---- 真正加载 ----
            const r = loadOne(program, pluginsDir, dirName, log);
            if (r.ok) {
                out.loaded.push(r);
                if (!quiet) {
                    log.info(`🔌 [实验性 / Beta] 插件 ${r.name} 已加载：${r.commands.map(c => `wow ${c}`).join('、')}`);
                }
            } else {
                out.skipped.push({ dirName, name: r.name, reason: r.reason });
            }
        } catch (e) {
            const detail = e && e.message ? e.message : String(e);
            out.skipped.push({ dirName, name: dirName, reason: `加载过程异常：${detail}` });
            log.error(`❌ 插件 ${dirName} 加载异常，已跳过（不影响主程序）：${detail}`);
            if (e && e.stack) log.error(String(e.stack));
        }
    }

    // 有插件真正跑起来了，才装运行期护栏：
    // 插件常见写法是 fire-and-forget（setTimeout / 不 await 的 fetch），
    // 那类异常会变成 unhandledRejection，Node 默认直接终止进程。
    if (out.loaded.length) installRejectionGuard(log);

    return out;
}

/**
 * 卸载插件：删目录 + 撤销信任记录。
 * @param {string} name 插件名（plugin.json 的 name，或目录名）
 * @param {object} [options] { dir, trustFile }
 * @returns {{ok:boolean, reason?:string}}
 */
function removePlugin(name, options = {}) {
    const pluginsDir = options.dir || getPluginsDir();
    const trustFile = options.trustFile || trust.TRUST_FILE;
    const key = String(name || '').trim();
    if (!key) return { ok: false, reason: '插件名不能为空' };

    // 目录名与清单名可能不同，两种都试
    let target = path.join(pluginsDir, key);
    let manifestName = key;
    if (!fs.existsSync(target)) {
        for (const d of listPluginDirs(pluginsDir)) {
            try {
                const m = JSON.parse(fs.readFileSync(path.join(pluginsDir, d, 'plugin.json'), 'utf8'));
                if (m && String(m.name) === key) {
                    target = path.join(pluginsDir, d);
                    manifestName = String(m.name);
                    break;
                }
            } catch (e) { /* 跳过坏清单 */ }
        }
    }
    if (!fs.existsSync(target)) return { ok: false, reason: `插件 ${key} 不存在` };

    fs.removeSync(target);
    trust.revokeTrust(manifestName, trustFile);
    return { ok: true };
}

module.exports = {
    loadPlugins,
    removePlugin,
    listPluginDirs,
    validateManifest,
    findConflict,
    getPluginsDir,
    installRejectionGuard,
    CONTEXT_KEYS,
    RESERVED_EXTRA,
    FORBIDDEN_NAMES,
    _internals: { loadOne, askYesNo }
};
