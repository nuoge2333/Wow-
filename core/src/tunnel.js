/**
 * Cloudflare Tunnel 公网穿透（V3.5.16）
 * ----------------------------------------------------------------
 * 目标：一条命令把本机的 Web 面板（或 MC 服务器端口）暴露到公网，
 * 无需端口映射、无需域名，得到一个临时的 https://xxx.trycloudflare.com 地址。
 *
 * 实现方式：官方 cloudflared 的「快速隧道」（Quick Tunnel）：
 *   cloudflared tunnel --url http://127.0.0.1:8080
 * 它会自动分配一个 *.trycloudflare.com 子域名，并把该域名打印在 stderr 里。
 *
 * 设计要点：
 * 1. **首次使用自动下载** cloudflared 二进制到 core/tunnel/，并按平台+架构选资产。
 *    Windows 拿 .exe，Linux/macOS 拿无后缀二进制；macOS 官方只发 .tgz，需解包。
 * 2. **逐行解析输出**抓取 https://*.trycloudflare.com，不做整块正则匹配 ——
 *    输出是流式的，域名可能在任意一次 data 事件里被拆断。
 * 3. **抓不到就直接报错**并回显 cloudflared 原始输出，而不是让用户干等。
 * 4. 退出时杀掉子进程，避免 cloudflared 常驻。
 *
 * 注：V3.5.16 暂未深度使用 Cloudflare named tunnel（需登录账号），仅用到 Quick Tunnel，
 * 它给出的域名每次启动都会变，适合临时分享、不适合长期绑定。
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const logSink = require('./log_sink');

// 二进制与日志落地目录（core/tunnel）
const TUNNEL_DIR = path.join(__dirname, '../tunnel');

/**
 * cloudflared 下载源（V3.5.22 起镜像优先）
 * ----------------------------------------------------------------
 * 为什么镜像优先：
 *   本项目主要用户在国内，而 GitHub Releases 的下载在国内经常「能连通但传不完」——
 *   实测 `curl -L .../cloudflared-linux-amd64`（40MB）多次只拿到 3.8MB 就断流，
 *   表现为下载「成功」但二进制不完整，随后 spawn 报 exec format error 之类的怪错。
 *   镜像站走的是同一份对象存储，速度稳定得多。
 *
 * 镜像只做**传输代理**，不改变内容：本次实测 gh-proxy.com / ghfast.top /
 * ghproxy.net 三家的 cloudflared-linux-amd64 均为 40274445 字节，
 * sha256 与 GitHub API 公布的 digest 完全一致
 * （1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872）。
 * 即便如此，下载后仍会做长度校验（见 downloadFile），换源不等于降低要求。
 *
 * 顺序：国内镜像 → GitHub 官方兜底（海外用户走第一家会多绕一跳，
 * 但三家镜像对海外也都能通，代价可接受；国内用户则显著受益）。
 * 可用 `wow config wow web.tunnel_mirror <url>` 或环境变量
 * WOW_CLOUDFLARED_MIRROR 覆盖，见 resolveMirrors()。
 */
const CF_MIRRORS = [
    { name: 'gh-proxy.com', base: 'https://gh-proxy.com' },
    { name: 'ghfast.top', base: 'https://ghfast.top' },
    { name: 'ghproxy.net', base: 'https://ghproxy.net' }
];

/** GitHub 官方（兜底，也是唯一权威来源） */
const CF_OFFICIAL = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

/**
 * 组装本次要尝试的完整 URL 列表（镜像优先 + 官方兜底）。
 *
 * 覆盖方式（优先级从高到低）：
 *   1. 环境变量 WOW_CLOUDFLARED_MIRROR（完整前缀，如 https://my.mirror/gh）
 *   2. 配置项 web.tunnel_mirror
 *   3. 内置 CF_MIRRORS
 * 用户显式指定的镜像**排在最前**，官方仍保留在最后兜底——
 * 「换源」不应该变成「断掉唯一可用源」。
 *
 * @param {function} [getConfig] 取配置的函数（测试注入用）
 * @returns {string[]} 完整 URL 前缀数组
 */
function resolveMirrors(getConfig) {
    const list = [];
    // 镜像站要求的是「完整目标 URL」，但不同代理的规范不同：
    //   gh-proxy.com  / ghfast.top  / ghproxy.net  -> <镜像>/<https://github.com/...>
    // 所以这里统一拼「带协议的完整 URL」，不要去掉协议头。
    const officialSuffix = CF_OFFICIAL;

    let custom = '';
    try {
        if (process.env.WOW_CLOUDFLARED_MIRROR) {
            custom = String(process.env.WOW_CLOUDFLARED_MIRROR).trim();
        } else if (typeof getConfig === 'function') {
            const v = getConfig('web.tunnel_mirror', '');
            custom = v ? String(v).trim() : '';
        }
    } catch (e) { /* 配置不可用则用内置列表 */ }

    if (custom) {
        // 允许直接写镜像根（https://x.com），也允许写完整的 releases 前缀。
        // 两种写法都要能拼出干净的 URL：
        //   https://x.com            -> https://x.com/<官方完整URL>
        //   https://x.com///         -> 同上（末尾斜杠先去掉）
        //   https://x.com/gh/        -> https://x.com/gh/<官方完整URL>
        //   .../releases/latest/download -> 原样使用
        // 注意 base 若已是完整 URL，不能再拼一遍，否则得到
        // https://x.com/https://github.com/... 这种坏地址。
        const trimmed = custom.replace(/\/+$/, '');
        const hasScheme = /^https?:\/\//i.test(trimmed);
        const bare = hasScheme ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
        if (trimmed.includes('/cloudflare/cloudflared')) {
            list.push(trimmed);
        } else {
            list.push(`${bare}/${officialSuffix}`);
        }
    }
    for (const m of CF_MIRRORS) {
        list.push(`${m.base}/${officialSuffix}`);
    }
    list.push(CF_OFFICIAL);

    // 去重（用户可能手写了与内置相同的一家）
    return [...new Set(list)];
}


/**
 * 当前平台对应的 cloudflared 资产名与最终可执行文件名
 * @returns {{asset: string, exe: string}}
 */
function detectAsset() {
    const platform = process.platform;
    const arch = process.arch;

    // cloudflared 的资产命名：cloudflared-<os>-<arch>[.exe|.tgz]
    let osName;
    if (platform === 'win32') osName = 'windows';
    else if (platform === 'darwin') osName = 'darwin';
    else if (platform === 'linux') osName = 'linux';
    else if (platform === 'android') osName = 'linux'; // Termux 走 linux 资产
    else throw new Error(`Cloudflare Tunnel 暂不支持当前系统: ${platform}`);

    let archName;
    if (arch === 'x64') archName = 'amd64';
    else if (arch === 'arm64') archName = 'arm64';
    else if (arch === 'ia32') archName = '386';
    else if (arch === 'arm') archName = 'arm';
    else throw new Error(`Cloudflare Tunnel 暂不支持当前架构: ${arch}`);

    // macOS 只发布 tgz（内含 cloudflared 可执行文件）
    if (osName === 'darwin') {
        return { asset: `cloudflared-darwin-${archName}.tgz`, exe: 'cloudflared', packed: 'tgz' };
    }
    // Windows 是裸 .exe
    if (osName === 'windows') {
        return { asset: `cloudflared-windows-${archName}.exe`, exe: 'cloudflared.exe' };
    }
    // Linux 等是裸二进制
    return { asset: `cloudflared-linux-${archName}`, exe: 'cloudflared' };
}

/**
 * 本机上 cloudflared 可执行文件路径
 */
function binaryPath() {
    const { exe } = detectAsset();
    return path.join(TUNNEL_DIR, exe);
}

/**
 * 从 tgz 中提取 cloudflared 可执行文件
 * 不引入 tar 依赖：直接调用系统 tar（Linux/macOS 自带）。
 */
function extractTgz(tgzPath, destDir) {
    const { spawnSync } = require('child_process');
    fs.ensureDirSync(destDir);
    const r = spawnSync('tar', ['-xzf', tgzPath, '-C', destDir], { encoding: 'utf8' });
    if (r.error || r.status !== 0) {
        throw new Error(`解压 cloudflared 失败: ${(r.error && r.error.message) || (r.stderr || '').trim() || 'tar 退出码 ' + r.status}`);
    }
}

/**
 * 下载文件到 dest（跟随重定向，带超时与进度提示）。
 *
 * V3.5.22：新增长度校验。镜像与官方都可能在传输中途断流，
 * 而 axios 的 stream 模式下「断流」和「正常结束」都只是 'finish' 事件，
 * 不校验就会把一个 3.8MB 的半截二进制当成 40MB 的完整文件落盘，
 * 后续 spawn 时抛出难以理解的原生错误。这里以 Content-Length 为准比对，
 * 不足即视为失败并抛错，由调用方换下一个源。
 *
 * @param {string} url
 * @param {string} dest
 * @param {string} label
 * @returns {Promise<number>} 实际写入字节数
 */
async function downloadFile(url, dest, label) {
    const resp = await axios.get(url, {
        responseType: 'stream',
        timeout: 60000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'wow-launcher' },
        validateStatus: s => s >= 200 && s < 300
    });

    const total = parseInt(resp.headers['content-length'] || '0', 10);
    let got = 0;
    let lastPrint = 0;

    fs.ensureDirSync(path.dirname(dest));
    const tmp = dest + '.part';
    // 上一次中断可能留下 .part，先清掉，避免与本次写入交错
    try { fs.unlinkSync(tmp); } catch (e) { /* 不存在即正常 */ }
    const writer = fs.createWriteStream(tmp);

    try {
        await new Promise((resolve, reject) => {
            resp.data.on('data', chunk => {
                got += chunk.length;
                const now = Date.now();
                if (total && now - lastPrint > 500) {
                    lastPrint = now;
                    const pct = ((got / total) * 100).toFixed(0);
                    process.stdout.write(`\r  ${label} 下载中... ${pct}%`);
                }
            });
            resp.data.on('error', reject);
            writer.on('error', reject);
            writer.on('finish', resolve);
            resp.data.pipe(writer);
        });
    } catch (e) {
        // 连接中断 / 写盘失败：务必清掉半截临时文件，
        // 否则下次调用会把它当成残留物，也占着几十 MB 空间。
        writer.destroy();
        try { fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
        throw e;
    }
    if (total) process.stdout.write('\r' + ' '.repeat(50) + '\r');

    // 长度校验：服务器给了 Content-Length 就必须一分不少。
    // 少数镜像用 chunked 编码不给 Content-Length，此时 total=0，跳过校验
    // （由后续的「可执行文件是否存在 / 能否 spawn」兜底）。
    if (total && got !== total) {
        try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
        throw new Error(`下载不完整（${got}/${total} 字节），疑似连接中断`);
    }

    try {
        fs.moveSync(tmp, dest, { overwrite: true });
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
        throw new Error(`写入失败: ${e.message}`);
    }
    return got;
}

/**
 * 确保 cloudflared 可用：已存在且可执行则跳过，否则下载。
 * @returns {Promise<string>} 可执行文件绝对路径
 */
async function ensureBinary(options = {}) {
    const quiet = options.quiet === true;
    const { asset, packed } = detectAsset();
    const binPath = binaryPath();

    if (fs.existsSync(binPath)) {
        // 已存在，给可执行权限后直接返回
        try { fs.chmodSync(binPath, 0o755); } catch (e) {}
        return binPath;
    }

    fs.ensureDirSync(TUNNEL_DIR);
    if (!quiet) {
        console.log('');
        console.log('  首次使用 Cloudflare Tunnel，需要下载 cloudflared（约 20~55MB）。');
        console.log(`  平台资产: ${asset}`);
        console.log('');
    }

    // 镜像优先，官方兜底（顺序见文件头 CF_MIRRORS 处的说明）
    let getConfig = null;
    try { getConfig = require('./config').getConfig; } catch (e) { /* 无配置则用内置 */ }
    const sources = resolveMirrors(getConfig);

    let lastErr = null;
    for (const base of sources) {
        const url = `${base}/${asset}`;
        let host = url;
        try { host = new URL(url).host; } catch (e) { /* 保持原串 */ }
        try {
            if (!quiet) console.log(`  从 ${host} 下载...`);
            const target = packed === 'tgz' ? path.join(TUNNEL_DIR, asset) : binPath;
            await downloadFile(url, target, 'cloudflared');

            if (packed === 'tgz') {
                extractTgz(target, TUNNEL_DIR);
                try { fs.unlinkSync(target); } catch (e) {}
            }
            if (!fs.existsSync(binPath)) {
                throw new Error('下载完成但未找到可执行文件（压缩包结构异常）');
            }
            try { fs.chmodSync(binPath, 0o755); } catch (e) {}
            if (!quiet) console.log(`  ✅ cloudflared 就绪: ${binPath}`);
            return binPath;
        } catch (e) {
            lastErr = e;
            if (!quiet) console.log(`  ⚠️ ${host} 失败: ${e.message}`);
            // 清掉可能的半截文件，否则下一轮会命中「已存在则跳过」
            try { if (fs.existsSync(binPath + '.part')) fs.unlinkSync(binPath + '.part'); } catch (e2) {}
            // 已落盘但不可用（例如解包失败留下的坏文件）也要清，避免污染下一次启动
            if (packed !== 'tgz' && fs.existsSync(binPath)) {
                try { fs.unlinkSync(binPath); } catch (e3) { /* 忽略 */ }
            }
        }
    }

    const err = new Error(
        `cloudflared 下载失败：${lastErr ? lastErr.message : '所有源均不可用'}\n` +
        `已尝试 ${sources.length} 个源（国内镜像优先，GitHub 官方兜底）。\n` +
        `可手动下载 ${asset} 放到 ${TUNNEL_DIR} 后重试；\n` +
        `或用环境变量 WOW_CLOUDFLARED_MIRROR 指定镜像前缀。`
    );
    err.code = 'ECFDL';
    throw err;
}

/**
 * 启动快速隧道，返回 { url, stop } 。
 * @param {string} targetUrl 形如 http://127.0.0.1:8080
 * @param {{quiet?:boolean, timeoutMs?:number}} options
 * @returns {Promise<{url:string, pid:number, stop:()=>void, logFile:string}>}
 */
async function startTunnel(targetUrl, options = {}) {
    const quiet = options.quiet === true;
    const timeoutMs = options.timeoutMs || 90000;
    const binPath = await ensureBinary({ quiet });

    const logFile = path.join(TUNNEL_DIR, 'cloudflared.log');
    // log.disabled=true 时 openStream 返回内存垫片，绝不产生 cloudflared.log；
    // 仍保留 logFile 字段作为返回契约（调用方只用于展示）。
    let logStream = null;
    try {
        logStream = logSink.openStream(logFile, 'tunnel');
    } catch (e) { /* 日志写不了不致命 */ }
    const logHint = logSink.shouldPersist()
        ? `日志: ${logFile}`
        : '日志: 未落盘（log.disabled=true，输出见上方回显）';

    const args = ['tunnel', '--no-autoupdate', '--url', targetUrl];

    const child = spawn(binPath, args, {
        cwd: TUNNEL_DIR,
        windowsHide: true,
        // 与陶瓦同理：隧道是长驻进程，脱离 wow 进程组，避免 Ctrl+C 连坐
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let tunnelUrl = null;
    let spawnError = null;
    let exitInfo = null;

    // 逐行消费，避免域名被 data 事件切断
    let buf = '';
    const pump = chunk => {
        const text = chunk.toString();
        output += text;
        if (output.length > 40000) output = output.slice(-40000);
        if (logStream) { try { logStream.write(text); } catch (e) {} }

        buf += text;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop(); // 保留最后半行
        for (const line of lines) {
            if (tunnelUrl) continue;
            // 官方输出形如：|  https://xxxx-yyyy.trycloudflare.com  |
            const m = line.match(/https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i);
            if (m) tunnelUrl = m[0];
        }
        // 兜底：半行里也可能已经出现完整域名（无换行输出）
        if (!tunnelUrl) {
            const m2 = buf.match(/https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i);
            if (m2) tunnelUrl = m2[0];
        }
    };

    if (child.stdout) child.stdout.on('data', pump);
    if (child.stderr) child.stderr.on('data', pump);
    child.on('error', e => { spawnError = e; });
    child.on('exit', (code, signal) => { exitInfo = { code, signal }; });
    if (typeof child.unref === 'function') child.unref();

    // 轮询等待域名出现
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (tunnelUrl) break;
        if (spawnError || exitInfo) break;
        await new Promise(r => setTimeout(r, 200));
    }

    const stop = () => {
        try {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
            } else {
                // detached 后自成进程组，用负 pid 杀整组
                process.kill(-child.pid, 'SIGTERM');
            }
        } catch (e) {
            try { child.kill('SIGTERM'); } catch (e2) {}
        }
        if (logStream) { try { logStream.end(); } catch (e) {} }
    };

    if (spawnError) {
        stop();
        if (spawnError.code === 'EACCES') {
            throw new Error(`cloudflared 无执行权限（${binPath}）。若 core 位于 noexec 分区，请把它移到普通目录后重试。`);
        }
        if (spawnError.code === 'ENOENT') {
            throw new Error(`找不到 cloudflared 可执行文件（${binPath}）。请删除 core/tunnel 目录后重试。`);
        }
        throw new Error(`启动 cloudflared 失败: ${spawnError.message}`);
    }

    if (exitInfo) {
        stop();
        const tail = output.trim().split(/\r?\n/).slice(-12).join('\n');
        throw new Error(
            `cloudflared 启动后立即退出（退出码 ${exitInfo.code}${exitInfo.signal ? '，信号 ' + exitInfo.signal : ''}）。\n` +
            `── cloudflared 输出 ──\n${tail || '(无输出)'}\n` +
            `${logHint}`
        );
    }

    if (!tunnelUrl) {
        const tail = output.trim().split(/\r?\n/).slice(-12).join('\n');
        stop();
        throw new Error(
            `等待 Cloudflare 分配域名超时（${Math.round(timeoutMs / 1000)}s）。\n` +
            `常见原因：网络无法访问 Cloudflare 边缘节点 / 被防火墙拦截。\n` +
            `── cloudflared 输出 ──\n${tail || '(无输出)'}\n` +
            `${logHint}`
        );
    }

    return { url: tunnelUrl, pid: child.pid, stop, logFile };
}

module.exports = {
    detectAsset,
    binaryPath,
    ensureBinary,
    startTunnel,
    resolveMirrors,
    CF_MIRRORS,
    CF_OFFICIAL,
    TUNNEL_DIR,
    _internals: { downloadFile }
};
