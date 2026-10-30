/**
 * EasyTier 虚拟网卡地址探测（V3.5.16）
 * ----------------------------------------------------------------
 * 陶瓦（Terracotta）底层跑的是 EasyTier。开房成功后，本机会多出一块
 * EasyTier 虚拟网卡，其上有一个 10.144.x.x 的地址（EasyTier 默认网段）。
 * 同房间的好友可以直接用这个地址访问本机上的任何服务 ——
 * 包括 Web 面板（http://10.144.x.x:8080）。
 *
 * 本模块只做一件事：把这台机器的 EasyTier 虚拟 IP 找出来。
 * 因为跨平台差异大，采用「多路取证 + 逐个校验」的策略：
 *
 *   1. os.networkInterfaces() 里网卡名/地址命中的（最准，零依赖）
 *   2. 系统路由表里 EasyTier 网卡对应的地址
 *      - Linux:   ip -4 addr show
 *      - macOS:   ifconfig
 *      - Windows: ipconfig
 *   3. 兜底：所有 10.144.0.0/16 且非回环的地址（EasyTier 默认网段）
 *
 * 只要拿到一个候选就返回；拿不到返回 null（调用方降级为只提示、不打印 IP）。
 */

const os = require('os');
const { execFile } = require('child_process');

// EasyTier 默认网段 10.144.0.0/16
const EASYTIER_CIDR_A = 10;
const EASYTIER_CIDR_B = 144;

// 网卡名里出现这些字样就高度怀疑是 EasyTier 的虚拟网卡
const NAME_HINTS = ['easytier', 'terracotta', 'asyncify', 'wow-lan'];

function isEasyTierAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    const m = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    return a === EASYTIER_CIDR_A && b === EASYTIER_CIDR_B;
}

function isUsableIpv4(addr) {
    if (!addr) return false;
    if (addr === '127.0.0.1' || addr === '0.0.0.0') return false;
    return /^\d+\.\d+\.\d+\.\d+$/.test(addr);
}

/**
 * 从 os.networkInterfaces() 推断
 * @returns {{ip:string, iface:string}|null}
 */
function fromNodeInterfaces() {
    let byName = null;
    let byCidr = null;
    let nicMap;
    try {
        nicMap = os.networkInterfaces();
    } catch (e) {
        return null;
    }
    for (const [name, list] of Object.entries(nicMap || {})) {
        for (const info of list || []) {
            // Node 18+ 用 family 字符串，更早版本是数字 4
            const isV4 = info.family === 'IPv4' || info.family === 4;
            if (!isV4 || !isUsableIpv4(info.address)) continue;
            const lower = String(name).toLowerCase();
            if (NAME_HINTS.some(h => lower.includes(h))) {
                if (!byName) byName = { ip: info.address, iface: name };
            }
            if (isEasyTierAddress(info.address)) {
                if (!byCidr) byCidr = { ip: info.address, iface: name };
            }
        }
    }
    return byName || byCidr;
}

/**
 * 跑一个系统命令，拿到 stdout（失败返回空串，永不抛出）
 */
function runCmd(cmd, args, timeoutMs = 3000) {
    return new Promise(resolve => {
        try {
            execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
                resolve(err ? '' : String(stdout || ''));
            });
        } catch (e) {
            resolve('');
        }
    });
}

/**
 * 从系统命令输出里找 10.144.x.x
 * @returns {Promise<{ip:string, iface:string}|null>}
 */
async function fromSystemTools() {
    // Linux: ip -4 addr show
    if (process.platform === 'linux' || process.platform === 'android') {
        const out = await runCmd('ip', ['-4', 'addr', 'show']);
        if (out) {
            // 按接口块解析：// "3: easytier0: <...>" 后跟 "inet 10.144.1.2/24 ..."
            let currentIface = '';
            for (const line of out.split(/\r?\n/)) {
                const ifM = line.match(/^\d+:\s+([^:@\s]+)[:@]/);
                if (ifM) { currentIface = ifM[1]; continue; }
                const ipM = line.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)/);
                if (ipM && isEasyTierAddress(ipM[1])) {
                    return { ip: ipM[1], iface: currentIface };
                }
            }
        }
        return null;
    }

    // macOS: ifconfig
    if (process.platform === 'darwin') {
        const out = await runCmd('ifconfig', []);
        if (out) {
            let currentIface = '';
            for (const line of out.split(/\r?\n/)) {
                const ifM = line.match(/^([a-z0-9]+):\s/);
                if (ifM) { currentIface = ifM[1]; continue; }
                const ipM = line.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)/);
                if (ipM && isEasyTierAddress(ipM[1])) {
                    return { ip: ipM[1], iface: currentIface };
                }
            }
        }
        return null;
    }

    // Windows: ipconfig
    if (process.platform === 'win32') {
        const out = await runCmd('ipconfig', []);
        if (out) {
            let currentIface = '';
            for (const line of out.split(/\r?\n/)) {
                if (/适配器|adapter/i.test(line)) {
                    currentIface = line.replace(/^.*?(适配器|adapter)\s*/i, '').replace(/[:：]\s*$/, '').trim();
                }
                const ipM = line.match(/(\d+\.\d+\.\d+\.\d+)/);
                if (ipM && isEasyTierAddress(ipM[1])) {
                    return { ip: ipM[1], iface: currentIface };
                }
            }
        }
        return null;
    }

    return null;
}

/**
 * 主入口：探测本机 EasyTier 虚拟 IP
 * @param {object} options 预留参数（当前未使用）
 * @returns {Promise<{ip:string, iface:string, source:string}|null>}
 */
async function detectVirtualIp(options = {}) {
    // 1) Node 网卡表（最快且无副作用）
    const nic = fromNodeInterfaces();
    if (nic) return { ...nic, source: 'interfaces' };

    // 2) 系统工具
    const sys = await fromSystemTools();
    if (sys) return { ...sys, source: 'system' };

    return null;
}

/**
 * 已开房时给出访问提示（纯展示层，业务代码只需调用这一个函数）
 * @param {{port:number, host?:string}} opts
 * @returns {Promise<string[]>} 需要打印的行（调用方逐行 console.log）
 */
async function buildLanAccessHint(opts = {}) {
    const port = opts.port || 8080;
    const lines = [];
    lines.push('');
    lines.push('  🌐 检测到联机网络已开启，你可以通过虚拟局域网 IP 访问面板。');
    const vip = await detectVirtualIp();
    if (vip) {
        lines.push(`     虚拟局域网 IP: ${vip.ip}  (网卡 ${vip.iface || '未知'})`);
        lines.push(`     面板地址:      http://${vip.ip}:${port}`);
        lines.push('     把上面这个地址发给同一房间的好友即可打开面板。');
    } else {
        lines.push('     但未能读取到本机的 EasyTier 虚拟 IP（10.144.x.x）。');
        lines.push('     请在终端执行 `ip -4 addr show`（Windows: ipconfig）查看网卡地址。');
    }
    lines.push('');
    return lines;
}

module.exports = {
    detectVirtualIp,
    buildLanAccessHint,
    isEasyTierAddress,
    fromNodeInterfaces,
    fromSystemTools
};
