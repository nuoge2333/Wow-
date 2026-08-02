/**
 * terracotta.js — 陶瓦 (Terracotta) 内网穿透 / 联机 管理器 (V3.3.3)
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 版权与许可声明（AGPL 例外条款要求：通过 HTTP API 驱动陶瓦时，              │
 * │ 必须在用户界面显著处标识其版权信息。wow~ 已在 CLI / Web 面板 / 菜单中展示。）│
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 陶瓦 (Terracotta) 是一个基于 EasyTier 的 Minecraft: Java Edition 联机工具，
 * 提供开箱即用的内网 / 局域网穿透能力，并内置了对 PCL / HMCL / BakaXL / FCL
 * 等启动器「加入陶瓦房间」的支持。
 *
 *   项目地址: https://github.com/burningtnt/Terracotta
 *   国内镜像: https://gitee.com/burningtnt/Terracotta/releases
 *
 * 许可证: GNU Affero General Public License v3.0 or later，并附以下例外条款：
 *   「作为特例，如果您的程序通过以下方式利用本作品，则相应的行为不会导致
 *    您的作品被 AGPL 协议涵盖：
 *    1. 您的程序通过打包的方式包含本作品未经修改的二进制形式……；或
 *    2. 您的程序通过本作品提供的进程间通信接口（如 HTTP API）与未经修改的
 *       本作品应用程序进行交互，且在您的程序用户界面明显处标识了本作品的
 *       版权信息。」
 *
 * wow~ 采用第 2 种方式（HTTP API 驱动未经修改的陶瓦二进制），并据此在
 * CLI / Web 面板 / 交互菜单中显著标注陶瓦版权。wow~ 本身仍保持 MIT 许可。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 本地 HTTP API（陶瓦二进制在本地启动的 Web 服务，依据陶瓦源码
 * src/server、src/controller 整理；二进制启动后监听 127.0.0.1:<动态端口>，
 * 端口由操作系统分配，陶瓦在 --hmcl 模式下把端口写入指定文件 {"port": N}。
 * 最终端口以运行时实际读取为准。）
 *
 *   GET  /meta                 -> 版本 / 编译信息（用于健康检查）
 *   GET  /state                -> 当前状态机 {state, room, ...}
 *   GET  /state/ide            -> 复位为空闲 (waiting)
 *   GET  /state/scanning[?room=<code>&player=<p>&public_nodes=...]
 *                              -> 开始「当房主 / 开房」（room 留空=自动生成）
 *   GET  /state/guesting?room=<code>&player=<p>
 *                              -> 加入房间（3.3.0 房主端未实现）
 *   GET  /panic?peaceful=true  -> 优雅退出陶瓦进程
 *   GET  /log                  -> 下载陶瓦日志
 *   /                         -> 陶瓦自带 Web UI
 *
 * 状态机 state 取值：
 *   waiting | host-scanning | host-starting | host-ok |
 *   guest-connecting | guest-starting | guest-ok | exception
 * 开房成功后 GET /state 返回 room.code —— 即好友在 PCL/HMCL/BakaXL/FCL 中
 * 输入以加入联机的「房间号」。
 *
 * 注意：陶瓦通过扫描本机正在运行的 Minecraft 服务端来自动发现 server-port，
 * 因此 HTTP API 没有独立的端口 / 密码参数；房间号本身就是加入凭证。
 * ───────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const axios = require('axios');
const ProgressBar = require('progress');
const config = require('./config');

// 运行时状态文件（端口 / pid / 房间号 / 二进制路径等），跨进程共享
const STATE_FILE = path.join(__dirname, '../.lan.json');
// 陶瓦二进制与临时文件所在目录
const LAN_DIR = path.join(__dirname, '../lan');
// 传给陶瓦 --hmcl 的端口文件（陶瓦会把 {"port": N} 写入此处）
const PORT_FILE = path.join(LAN_DIR, 'wow_terracotta_port.json');

// 默认值
const TERRA_VERSION_DEFAULT = '0.4.2';
const TERRA_MIRROR_DEFAULT = 'https://gitee.com/burningtnt/Terracotta/releases';

// 必须在 UI 显著处展示的陶瓦版权（AGPL 例外条款要求）
const TERRA_COPYRIGHT =
    'Powered by Terracotta | 陶瓦联机 — https://github.com/burningtnt/Terracotta (AGPLv3)';

// 内存缓存的运行时状态
let _state = null;

// ==================== 工具函数 ====================

/**
 * 取得 AGPL 要求的陶瓦版权声明（供 CLI / Web / 菜单展示）
 */
function getCopyright() {
    return TERRA_COPYRIGHT;
}

/**
 * 读取运行时状态（带内存缓存）
 */
function readState() {
    if (_state) return _state;
    try {
        if (fs.existsSync(STATE_FILE)) {
            _state = fs.readJsonSync(STATE_FILE);
        } else {
            _state = {};
        }
    } catch (e) {
        _state = {};
    }
    return _state;
}

/**
 * 写入运行时状态
 */
function writeState(patch) {
    const s = Object.assign(readState(), patch);
    _state = s;
    try {
        fs.ensureDirSync(path.dirname(STATE_FILE));
        fs.writeJsonSync(STATE_FILE, s, { spaces: 2 });
    } catch (e) {
        // 状态文件写失败不致命
    }
    return s;
}

/**
 * 清空运行时状态（保留场景：仅移除 pid/port/roomCode/binaryPath 等运行时字段）
 */
function clearRuntimeState() {
    _state = {};
    try {
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } catch (e) {}
}

/**
 * 检测当前平台对应的陶瓦候选资产列表（按优先级排序）。
 *
 * 普通平台（Windows / macOS / Linux）：只有一个候选。
 *
 * Android（Termux 下 process.platform === 'android'，并非 'linux'）：
 *   1) 优先尝试 android 的 .so（JNI 共享库，供 FCL / HMCL 等安卓启动器加载）；
 *   2) 若 .so 下载 404 / 网络错误 / 实际作为 CLI 无法 spawn，则回退到
 *      linux/arm64 的 musl 静态二进制（可在 Termux 中直接 spawn 运行）。
 *
 * @returns {Array<{osName:string, archName:string, ext:string}>}
 */
function detectTerraAssets() {
    const p = process.platform; // 'win32' | 'darwin' | 'linux' | 'android' | ...
    const a = process.arch;     // 'x64' | 'arm64' | 'ia32' | 'arm' | ...

    // 单个平台资产构造；archName 为 null 表示当前架构无可用构建
    function build(osName, ext) {
        let archName;
        if (a === 'x64') archName = 'x86_64';
        // 桌面端 arm64 命名为 arm64；Android 端（.so）命名为 arm64v8a
        else if (a === 'arm64') archName = (osName === 'android') ? 'arm64v8a' : 'arm64';
        else if (a === 'ia32') archName = 'x86';
        // 32 位：桌面端无对应构建，Android 端命名为 armv7
        else if (a === 'arm') archName = (osName === 'android') ? 'armv7' : null;
        else archName = null;
        if (!archName) return null;
        return { osName, archName, ext };
    }

    if (p === 'win32') return [build('windows', '.exe')].filter(Boolean);
    if (p === 'darwin') return [build('macos', '')].filter(Boolean);
    if (p === 'linux')  return [build('linux', '')].filter(Boolean);

    if (p === 'android') {
        // 优先：android .so（JNI 共享库）；回退：linux/arm64 musl 静态二进制（Termux 可运行）
        const androidSo = build('android', '.so');
        const linuxArm64 = { osName: 'linux', archName: 'arm64', ext: '' };
        return (androidSo ? [androidSo] : []).concat(linuxArm64);
    }

    return [];
}

/**
 * 解析陶瓦二进制下载地址
 * 默认按 lan.mirror（Gitee 镜像）/ lan.version / 给定资产自动拼装：
 *   <mirror>/download/v<version>/terracotta-<version>-<os>-<arch>[-pkg.tar.gz|.so]
 * 若配置了 lan.binary_url 则直接使用它。
 * @param {{osName:string, archName:string, ext:string}} [asset] 目标资产（缺省取第一个候选）
 */
function resolveDownloadUrl(asset) {
    const override = config.getConfig('lan.binary_url', '');
    if (override && override.trim()) return override.trim();

    const version = config.getConfig('lan.version', TERRA_VERSION_DEFAULT);
    const mirror = (config.getConfig('lan.mirror', TERRA_MIRROR_DEFAULT) || '').replace(/\/+$/, '');
    if (!asset) asset = detectTerraAssets()[0];
    if (!asset) {
        throw new Error('当前平台不支持自动下载陶瓦二进制（仅支持 Windows / macOS / Linux 的 x64 / arm64，以及 Android 的 arm64v8a / armv7 / x86_64 / x86）');
    }
    // Android 的 .so 直接发布（无 -pkg.tar.gz 包裹）；其余平台为 -pkg.tar.gz 压缩包
    const suffix = (asset.ext === '.so') ? asset.ext : '-pkg.tar.gz';
    const assetName = `terracotta-${version}-${asset.osName}-${asset.archName}${suffix}`;
    return `${mirror}/download/v${version}/${assetName}`;
}

/**
 * 计算陶瓦二进制最终路径（解压并重命名后的稳定文件名）。
 * 使用固定文件名，避免不同扩展名 / 候选资产导致的路径漂移：
 *   - Windows 需要 .exe；
 *   - 其余平台（含 Android 回退的 linux/arm64 静态二进制）无扩展名。
 */
function binaryPath() {
    const winExt = (process.platform === 'win32') ? '.exe' : '';
    return path.join(LAN_DIR, 'terracotta' + winExt);
}

// ==================== 下载与解压 ====================

/**
 * 确保陶瓦二进制存在：若已存在则直接返回路径；否则从镜像下载并解压。
 * @returns {Promise<string>} 二进制绝对路径
 */
/**
 * 流式下载文件并带进度条。
 * 对 HTTP >= 400（含 404）显式 reject 并带上 status，便于上层回退到下一个候选。
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        axios({ method: 'get', url, responseType: 'stream', timeout: 300000 })
            .then(response => {
                if (response.status >= 400) {
                    const err = new Error(`HTTP ${response.status}`);
                    err.response = { status: response.status };
                    return reject(err);
                }
                const total = parseInt(response.headers['content-length'] || '0', 10);
                const bar = new ProgressBar('   下载 [:bar] :percent :etas', {
                    width: 40, complete: '=', incomplete: ' ', total: total || 1
                });
                const writer = fs.createWriteStream(destPath);
                response.data.on('data', chunk => bar.tick(chunk.length));
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            })
            .catch(reject);
    });
}

/**
 * 确保陶瓦二进制存在：若已存在则直接返回路径；否则按候选顺序下载。
 * Android 场景：优先下载 .so，若 404 / 网络错误 / 无法作为 CLI 启动，则回退到
 * linux/arm64 的 musl 静态二进制（Termux 可直接运行）。所有候选耗尽才抛错。
 * @returns {Promise<string>} 二进制绝对路径
 */
async function ensureBinary() {
    const target = binaryPath();
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
        return target;
    }

    const candidates = detectTerraAssets();
    if (!candidates.length) {
        throw new Error('当前平台不支持自动下载陶瓦二进制（仅支持 Windows / macOS / Linux 的 x64 / arm64，以及 Android 的 arm64v8a / armv7 / x86_64 / x86）');
    }
    fs.ensureDirSync(LAN_DIR);

    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
        const asset = candidates[i];
        const isAndroidSo = asset.ext === '.so';
        const url = resolveDownloadUrl(asset);
        // .so 是 JNI 共享库，不可作为 CLI 直接 spawn；下载到临时名，避免污染最终二进制。
        const tmpPath = isAndroidSo
            ? path.join(LAN_DIR, `terracotta-android-${Date.now()}.so`)
            : path.join(LAN_DIR, `terracotta-${Date.now()}.tar.gz`);

        console.log(`\n🌐 [${i + 1}/${candidates.length}] 正在下载陶瓦 (Terracotta) 二进制（首次使用需联网）`);
        console.log(`   来源(${asset.osName}-${asset.archName}): ${url}`);
        console.log(`   ${TERRA_COPYRIGHT}`);

        try {
            await downloadFile(url, tmpPath);

            // .so 下载成功，但它是 JNI 共享库（供 FCL / HMCL 加载），不可作为命令行
            // 进程直接启动。在 Termux（process.platform === 'android'）场景下，回退到
            // 可独立运行的 linux/arm64 二进制。
            if (isAndroidSo) {
                console.log('⚠️ 已下载 android .so（JNI 共享库），不可作为命令行进程直接启动，回退到 linux/arm64 二进制…');
                try { fs.unlinkSync(tmpPath); } catch (e) {}
                lastErr = new Error('android .so 为 JNI 共享库，已回退到可运行二进制');
                continue;
            }

            // 可运行二进制：解压并重命名为稳定文件名
            console.log('   解压中...');
            await extractTar(tmpPath, LAN_DIR);
            const found = locateBinary(LAN_DIR, asset);
            if (!found) {
                throw new Error('解压后未找到陶瓦可执行文件，请联系开发者或手动配置 lan.binary_url');
            }
            fs.copySync(found, target);
            fs.chmodSync(target, 0o755);
            try { fs.unlinkSync(tmpPath); } catch (e) {}
            console.log(`✅ 陶瓦二进制就绪: ${target}`);
            return target;
        } catch (e) {
            try { fs.unlinkSync(tmpPath); } catch (e2) {}
            lastErr = e;
            const status = (e.response && e.response.status) ? ` (HTTP ${e.response.status})` : '';
            console.log(`❌ 候选 ${asset.osName}-${asset.archName} 下载/解压失败${status}，回退到下一个候选…`);
        }
    }

    // 所有候选耗尽
    const msg = (lastErr && lastErr.response && lastErr.response.status)
        ? `下载陶瓦二进制失败（HTTP ${lastErr.response.status}）`
        : `下载 / 解压陶瓦二进制失败: ${lastErr ? lastErr.message : '未知错误'}`;
    throw new Error(`${msg}。请检查网络或镜像地址；也可手动下载后配置 lan.binary_url。`);
}

/**
 * 使用系统 tar 解压 .tar.gz（Windows 10+ 自带 tar.exe，Linux/macOS 自带）
 */
function extractTar(tarPath, destDir) {
    return new Promise((resolve, reject) => {
        const proc = spawn('tar', ['-xzf', tarPath, '-C', destDir], { windowsHide: true });
        let err = '';
        proc.stderr.on('data', d => { err += d.toString(); });
        proc.on('error', reject);
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`解压失败 (tar 退出码 ${code}): ${err || '未知错误'}`));
        });
    });
}

/**
 * 在解压目录中定位陶瓦可执行文件（按版本/平台命名前缀匹配）
 * @param {string} dir 解压目录
 * @param {{osName:string, archName:string, ext:string}} [asset] 目标资产（缺省取第一个候选）
 */
function locateBinary(dir, asset) {
    if (!asset) asset = detectTerraAssets()[0];
    if (!asset) return null;
    const version = config.getConfig('lan.version', TERRA_VERSION_DEFAULT);
    const prefix = `terracotta-${version}-${asset.osName}-${asset.archName}`;
    const candidates = [];
    try {
        for (const f of fs.readdirSync(dir)) {
            if (f === path.basename(binaryPath())) continue;
            // linux/arm64 等解压后的二进制无扩展名；windows 为 .exe
            const isExe = f.endsWith('.exe');
            const isPlain = !f.includes('.');
            if (f.startsWith(prefix) && (isExe || isPlain)) {
                const full = path.join(dir, f);
                try { if (fs.statSync(full).isFile()) candidates.push(full); } catch (e) {}
            }
        }
    } catch (e) {}
    // 优先可执行文件（无扩展名），其次 .exe
    candidates.sort((a, b) => (a.endsWith('.exe') ? 1 : 0) - (b.endsWith('.exe') ? 1 : 0));
    return candidates[0] || null;
}

// ==================== 本地 HTTP API 客户端 ====================

/**
 * 构建指向陶瓦本地 HTTP API 的 axios 实例
 */
function apiClient(port) {
    return axios.create({
        baseURL: `http://127.0.0.1:${port}`,
        timeout: 5000,
        // 陶瓦返回的是紧凑 JSON，axios 默认即可解析
    });
}

/**
 * 健康检查：GET /meta
 */
async function apiMeta(port) {
    const r = await apiClient(port).get('/meta');
    return r.data;
}

/**
 * 读取状态机：GET /state
 */
async function apiState(port) {
    const r = await apiClient(port).get('/state');
    return r.data;
}

/**
 * 开始开房：GET /state/scanning（room 留空则陶瓦自动生成房间号）
 */
async function apiScanning(port, roomCode) {
    const params = {};
    if (roomCode && roomCode.trim()) params.room = roomCode.trim();
    const r = await apiClient(port).get('/state/scanning', { params });
    return r.data;
}

/**
 * 优雅退出陶瓦：GET /panic?peaceful=true
 */
async function apiPanic(port) {
    try {
        await apiClient(port).get('/panic', { params: { peaceful: true } });
    } catch (e) {
        // 进程退出后连接会断开，忽略错误
    }
}

// ==================== 进程生命周期 ====================

/**
 * 启动陶瓦守护进程（--hmcl 模式，便于读取动态端口），并等待端口就绪。
 * 若已在运行则直接返回当前端口。
 * @returns {Promise<number>} 本地 HTTP API 端口
 */
async function startDaemon() {
    const st = readState();
    if (st.pid && st.port) {
        // 校验是否仍然存活
        if (isAlive(st.pid)) {
            try { await apiMeta(st.port); return st.port; }
            catch (e) { /* 端口失效，重建 */ }
        }
        // 进程已死，清理后重启
        clearRuntimeState();
    }

    const bin = await ensureBinary();
    // 注：Android 场景下 ensureBinary() 已优先尝试 .so，并在其不可作为 CLI 启动
    // （JNI 共享库）时自动回退到 linux/arm64 的 musl 静态二进制，因此此处无需再拦截。
    fs.ensureDirSync(LAN_DIR);
    // 清空旧的端口文件，避免读到上一次的端口
    try { if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE); } catch (e) {}

    const child = spawn(bin, ['--hmcl', PORT_FILE], {
        cwd: LAN_DIR,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore']
    });
    child.on('error', e => {
        console.error(`[lan] 启动陶瓦失败: ${e.message}`);
    });

    // 轮询端口文件，等待陶瓦写入 {"port": N}
    const deadline = Date.now() + 20000;
    let port = 0;
    while (Date.now() < deadline) {
        try {
            if (fs.existsSync(PORT_FILE)) {
                const txt = fs.readFileSync(PORT_FILE, 'utf8').trim();
                const obj = JSON.parse(txt);
                if (obj && obj.port && Number.isInteger(obj.port)) {
                    port = obj.port;
                    break;
                }
            }
        } catch (e) { /* 文件尚未写好，继续等 */ }
        await sleep(200);
    }

    if (!port) {
        try { child.kill(); } catch (e) {}
        throw new Error('启动陶瓦超时：未能读取本地 API 端口。请检查网络 / 防火墙，或查看陶瓦日志。');
    }

    writeState({ pid: child.pid, port, binaryPath: bin, portFile: PORT_FILE, running: true });

    // 等待 /meta 就绪（服务真正可响应）
    const metaDeadline = Date.now() + 10000;
    while (Date.now() < metaDeadline) {
        try {
            await apiMeta(port);
            break;
        } catch (e) {
            await sleep(200);
        }
    }
    return port;
}

/**
 * 停止陶瓦守护进程
 */
async function stopDaemon() {
    const st = readState();
    if (st && st.port) {
        await apiPanic(st.port);
    }
    if (st && st.pid && isAlive(st.pid)) {
        try { process.kill(st.pid, 'SIGTERM'); } catch (e) {}
        // 给一点时间优雅退出
        await sleep(500);
        if (isAlive(st.pid)) {
            try { process.kill(st.pid, 'SIGKILL'); } catch (e2) {}
        }
    }
    // 清理端口文件
    try { if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE); } catch (e) {}
    clearRuntimeState();
}

/**
 * 判断进程是否存活
 */
function isAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (e) { return false; }
}

/**
 * 轮询状态机直到开房成功 (host-ok)，返回房间号 room.code
 */
async function waitHostOk(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const s = await apiState(port);
            last = s;
            if (s && s.state === 'host-ok' && s.room && s.room.code) {
                return s.room.code;
            }
            if (s && s.state === 'exception') {
                const typeMap = {
                    0: 'PingHostFail', 1: 'PingHostRst', 2: 'GuestEasytierCrash',
                    3: 'HostEasytierCrash', 4: 'PingServerRst', 5: 'ScaffoldingInvalidResponse'
                };
                throw new Error(`开房失败（陶瓦异常 type=${s.type} ${typeMap[s.type] || ''}）。请确认本地 Minecraft 服务端已启动并监听配置端口，且网络可访问陶瓦公共节点。`);
            }
        } catch (e) {
            if (e.message && e.message.startsWith('开房失败')) throw e;
        }
        await sleep(500);
    }
    throw new Error(`等待开房完成超时（最后状态: ${last ? last.state : '未知'}）。请确认本地 Minecraft 服务端已启动并监听 ${config.getConfig('lan.server_port', 25565)} 端口。`);
}

// ==================== 对外业务接口 ====================

/**
 * 开房（我要当房主）。确保二进制、启动守护、发起开房、等待房间号。
 * @param {object} opts
 * @param {string} [opts.roomCode] 固定房间号（留空自动生成）
 * @returns {Promise<{roomCode:string, port:number}>}
 */
async function hostRoom(opts = {}) {
    const port = await startDaemon();
    console.log('\n🏠 正在开房（陶瓦正在扫描本机 Minecraft 服务端并连接公共节点）...');
    await apiScanning(port, opts.roomCode || config.getConfig('lan.room_code', ''));
    const roomCode = await waitHostOk(port);
    writeState({ roomCode, running: true });
    console.log(`\n✅ 开房成功！房间号: ${roomCode}`);
    console.log(`   把房间号发给好友，对方在 PCL / HMCL / BakaXL / FCL 中选择「加入陶瓦房间」并输入该房间号即可联机。`);
    console.log(`   ${TERRA_COPYRIGHT}`);
    return { roomCode, port };
}

/**
 * 服务器启动时自动开房（非阻塞、尽力而为，用于 auto_room 钩子）
 */
async function autoHost() {
    try {
        const { roomCode } = await hostRoom({});
        console.log(`\n[lan] 自动开房完成，房间号: ${roomCode}`);
    } catch (e) {
        console.warn(`\n[lan] 自动开房失败: ${e.message}`);
    }
}

/**
 * 关房（停止陶瓦守护）
 */
async function stopHost() {
    await stopDaemon();
    console.log('✅ 已关闭陶瓦联机房间');
}

/**
 * 查询状态（合并运行时状态与陶瓦实时状态）
 */
async function getStatus() {
    const st = readState();
    if (!st || !st.running || !st.port || !isAlive(st.pid)) {
        return { running: false, roomCode: null, port: null, state: null, meta: null };
    }
    let state = null, meta = null;
    try { state = await apiState(st.port); } catch (e) {}
    try { meta = await apiMeta(st.port); } catch (e) {}
    return {
        running: true,
        roomCode: st.roomCode || (state && state.room && state.room.code) || null,
        port: st.port,
        pid: st.pid,
        state: state ? state.state : null,
        meta
    };
}

/**
 * 取得当前房间号（若已开房）
 */
function getRoomCode() {
    const st = readState();
    return (st && st.roomCode) || null;
}

/**
 * 当前是否有陶瓦守护在运行
 */
function isRunning() {
    const st = readState();
    return !!(st && st.running && st.pid && isAlive(st.pid));
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = {
    getCopyright,
    detectTerraAssets,
    resolveDownloadUrl,
    ensureBinary,
    binaryPath,
    startDaemon,
    stopDaemon,
    hostRoom,
    autoHost,
    stopHost,
    getStatus,
    getRoomCode,
    isRunning,
    TERRA_VERSION_DEFAULT,
    TERRA_MIRROR_DEFAULT
};
