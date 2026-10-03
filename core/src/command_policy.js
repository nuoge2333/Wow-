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
 */
const DENIED_WEB = new Set([
    'init',                                  // 重新初始化整个运行环境
    // 方案结构变更 / 数据丢失
    'scheme delete', 'scheme create', 'scheme switch', 'scheme edit',
    'scheme pull', 'scheme prune', 'scheme register', 'scheme export', 'scheme import',
    // 模组移除/同步/切换（面板只用 mod install）
    'mod remove', 'mod sync', 'mod toggle',
    // 整合包远程安装（面板只用 pack generate）
    'pack install',
    // 与 Web 常驻进程冲突
    'web start',
    // 长驻抢占终端
    'logs tail'
]);

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

    // Web 端禁止通过 install 下载远程地址（任意远程代码/文件拉取）。
    // 面板仅用 `install <本地文件> -o ./` 做本地上传安装，放行本地路径。
    if (head === 'install' && tokens.length > 1) {
        const arg = tokens[1];
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
            return { allowed: false, reason: 'Web 端禁止通过 install 下载远程地址（仅允许本地文件安装）' };
        }
    }

    if (DENIED_WEB.has(head) || DENIED_WEB.has(two)) {
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

module.exports = { isWebCommandAllowed, WOW_NAMESPACES, DENIED_WEB };
