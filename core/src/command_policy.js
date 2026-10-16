'use strict';

/**
 * V3.5.3：Web 面板（/api/exec 与 WebSocket command）执行的命令安全策略。
 *
 * 设计说明：
 *  - 面板是「已认证的 admin 工具」，需要广泛的写权限（mod/theme/plugin 安装、
 *    开服、改下载镜像等），因此不能简单复用开服控制台的 ALLOWED_CONSOLE
 *    （那套会禁掉 `server start`，而面板恰恰要靠它开服），也不能用窄白名单
 *    （会把面板自己的 mod install / theme install 等功能挡掉）。
 *  - 因此采用「拒绝清单」：只拦截【面板用不到】且【灾难性 / 不可逆 / 与运行
 *    进程冲突】的操作。其余 wow 命名空间命令一律放行。
 *  - 经前端审计（web/*.html 的 apiExec(...) 调用），面板合法使用：
 *    server start/stop/restart/kill、scheme list/info/status、
 *    mod list/install、theme list/info/install/switch/delete、
 *    plugin list/info/install/remove、pack list/info/generate、
 *    set download.mirror、install <本地文件> -o ./、config 只读、
 *    logs analyze/report、mail *、lan *、down、pool *、web stop/status。
 *    以下被拒绝项均不在面板用途内。
 */

const WOW_NAMESPACES = new Set([
    'server', 'scheme', 'mod', 'plugin', 'theme', 'pack', 'config',
    'set', 'mail', 'lan', 'down', 'pool', 'logs', 'web', 'install', 'init', 'help'
]);

/**
 * 被 Web 端明确拒绝的子命令（按 head 或 前两 token 匹配）。
 * 选择标准：面板不使用 + 灾难性/不可逆/冲突。
 *
 * V3.5.7：拆分为两档，可由配置开关分别放开（方案 B）：
 *   - SCHEME_OPS：方案结构变更（可通过 web.allow_scheme_ops 放开）
 *   - 其余始终拒绝：真正灾难性 / 无恢复手段
 */
const SCHEME_OPS = new Set([
    'scheme delete', 'scheme create', 'scheme switch', 'scheme edit',
    'scheme pull', 'scheme prune', 'scheme register', 'scheme export', 'scheme import'
]);

/** 无论何种配置都永久拒绝（不可逆 / 与 Web 进程冲突 / 长驻抢占终端） */
const DENIED_WEB_ALWAYS = new Set([
    'init',                                  // 重新初始化整个运行环境
    // 模组移除/同步/切换（面板只用 mod install）
    'mod remove', 'mod sync', 'mod toggle',
    // 整合包远程安装（面板只用 pack generate）
    'pack install',
    // 与 Web 常驻进程冲突
    'web start',
    // 长驻抢占终端
    'logs tail'
]);

/** 兼容导出：完整拒绝清单（两档合并后的静态快照） */
const DENIED_WEB = new Set([...SCHEME_OPS, ...DENIED_WEB_ALWAYS]);

/**
 * 读取开关配置。
 * 注意：每次调用都实时读，便于运行中改配置后立即生效（无需重启）。
 * @returns {{ allowSchemeOps: boolean, allowRemoteInstall: boolean }}
 */
function readSwitches() {
    let allowSchemeOps = false;
    let allowRemoteInstall = false;
    try {
        const config = require('./config');
        allowSchemeOps = config.getConfig('web.allow_scheme_ops', false) === true;
        allowRemoteInstall = config.getConfig('web.allow_remote_install', false) === true;
    } catch (e) {
        // 配置模块不可用时保守收紧
    }
    return { allowSchemeOps, allowRemoteInstall };
}

/**
 * 把用户输入的命令规范化为小写 token 数组（去掉行首可选的 wow）。
 * @param {string} command
 * @returns {string[]}
 */
function normalize(command) {
    const line = (command || '').trim();
    if (!line) return [];
    let tokens = line.split(/\s+/);
    if (tokens[0] && tokens[0].toLowerCase() === 'wow') tokens = tokens.slice(1);
    return tokens.map(t => t.toLowerCase());
}

/**
 * 判断一条命令是否允许经 Web（/api/exec 或 WebSocket）执行。
 * @param {string} command 原始命令字符串
 * @returns {{ allowed: boolean, reason?: string }}
 */
function isWebCommandAllowed(command) {
    const tokens = normalize(command);
    if (tokens.length === 0) {
        return { allowed: false, reason: '空指令' };
    }

    const head = tokens[0];
    const two = tokens.slice(0, 2).join(' ');
    const { allowSchemeOps, allowRemoteInstall } = readSwitches();

    // 远程 URL 下载：默认禁止（任意远程代码/文件拉取），可由 web.allow_remote_install 放开。
    // 面板仅用 `install <本地文件> -o ./` 做本地上传安装，本地路径始终放行。
    if (head === 'install' && tokens.length > 1) {
        const arg = tokens[1];
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
            if (!allowRemoteInstall) {
                return {
                    allowed: false,
                    reason: 'Web 端禁止通过 install 下载远程地址（如需放开，请在配置中设置 web.allow_remote_install: true）'
                };
            }
        }
    }

    // 方案结构变更：默认禁止，可由 web.allow_scheme_ops 放开
    if (!allowSchemeOps && (SCHEME_OPS.has(head) || SCHEME_OPS.has(two))) {
        return {
            allowed: false,
            reason: `该指令被 Web 端禁止执行：${two}（如需放开，请在配置中设置 web.allow_scheme_ops: true）`
        };
    }

    // 永久拒绝项：不受任何开关影响
    if (DENIED_WEB_ALWAYS.has(head) || DENIED_WEB_ALWAYS.has(two)) {
        return { allowed: false, reason: `该指令被 Web 端禁止执行：${two}` };
    }

    // config 写入形态拦截（只读放行）。
    if (head === 'config') {
        if ((tokens[1] === 'wow' || tokens[1] === 'server') && tokens.length >= 4) {
            return { allowed: false, reason: 'Web 端禁止修改 wow.yaml / server.properties（请在终端执行）' };
        }
        if (two === 'config white' && tokens.length >= 4 &&
            (tokens[2] === 'add' || tokens[2] === 'remove')) {
            return { allowed: false, reason: 'Web 端禁止修改白名单文件（请在终端执行）' };
        }
    }

    // 非 wow 命名空间的输入（如 MC 指令）交回 execCommand，由其自然报错，不在此拦截。
    return { allowed: true };
}

/**
 * 危险配置自检（V3.5.7）
 * 当危险开关被打开、同时又存在「面板暴露面过大」的配置时，返回警告信息数组。
 * 仅用于启动时打印提示，不阻断启动。
 * @returns {string[]}
 */
function auditDangerousConfig() {
    const warnings = [];
    const { allowSchemeOps, allowRemoteInstall } = readSwitches();

    // 是否有任何危险开关被打开
    const opened = [];
    if (allowSchemeOps) opened.push('web.allow_scheme_ops');
    if (allowRemoteInstall) opened.push('web.allow_remote_install');
    if (opened.length === 0) return warnings;

    let host = '127.0.0.1';
    let devMode = false;
    try {
        const config = require('./config');
        host = String(config.getConfig('web.host', '127.0.0.1'));
        devMode = config.getConfig('web.dev_mode', false) === true;
    } catch (e) { /* 忽略 */ }

    warnings.push(`已放开 Web 端危险指令：${opened.join('、')}`);

    if (host === '0.0.0.0' || host === '::') {
        warnings.push(
            `面板正在监听 ${host}（全网可达）。危险指令 + 公网监听 = 极高风险，` +
            `请务必置于反向代理与 HTTPS 之后，并设置强离线密码或启用 SMTP 验证码。`
        );
    }

    if (devMode) {
        warnings.push(
            'web.dev_mode 为 true（未配 SMTP 时会回显登录验证码）。' +
            '这与危险指令同时开启等于「无认证的任意命令执行」，请立即关闭 dev_mode。'
        );
    }

    if (allowRemoteInstall) {
        warnings.push(
            'web.allow_remote_install 已开启：面板可下载任意远程文件到服务器目录，' +
            '这等同任意代码执行入口，请确认面板访问权限可完全信任。'
        );
    }

    return warnings;
}

module.exports = {
    isWebCommandAllowed,
    auditDangerousConfig,
    WOW_NAMESPACES,
    DENIED_WEB,
    DENIED_WEB_ALWAYS,
    SCHEME_OPS
};
