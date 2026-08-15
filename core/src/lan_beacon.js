/**
 * lan_beacon.js — Minecraft 局域网发现广播器 (V3.4.0)
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ 为什么需要这个模块（V3.4.0 修复 lan host 永久卡在 host-scanning 的根因）      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * 陶瓦 (Terracotta) 判断「本机 Minecraft 服务端监听在哪个端口」的方式，
 * 既不是扫描进程、也不是扫描端口，而是**监听 Minecraft 的局域网发现多播报文**：
 *
 *   IPv4 多播组 224.0.2.60:4445
 *   IPv6 多播组 [FF75:230::60]:4445
 *   载荷格式    [MOTD]<描述>[/MOTD][AD]<端口>[/AD]
 *
 * （见陶瓦源码 src/mc/scanning.rs：绑定 4445 并 join_multicast，
 *   从报文中取 [AD] 段作为端口；src/controller/api.rs 的 set_scanning 里
 *   `MinecraftScanner::create(|m| m != MOTD)` 只过滤掉陶瓦自己的 MOTD。）
 *
 * 而问题在于：**Minecraft 专用服务端（server.jar / 我们启动的那种）从不发送
 * 这个广播** —— 只有 Minecraft 游戏客户端「对局域网开放存档」时才会广播。
 *
 * 于是陶瓦 host-scanning 阶段的推进条件永远不成立。更糟的是陶瓦那一侧是
 * 一个**没有超时的 200ms 轮询死循环**（api.rs 的 `loop { ... }`），
 * 所以它会一直停在 host-scanning，而 wow 侧只能干等到自己的超时，
 * 报出「等待开房完成超时（最后状态: host-scanning）」。
 * 这是自 V3.3.0 引入陶瓦联机起就存在的设计性缺陷，与操作系统无关。
 *
 * 修复思路：**由 wow 代替专用服务端发出这个局域网广播**（周期 1500ms，
 * 与原版 Minecraft 的广播节奏一致）。陶瓦收到后即可取得端口，
 * 状态机立刻从 host-scanning 推进到 host-starting → host-ok。
 *
 * 附带收益：同一局域网内的 Minecraft 客户端也能在「多人游戏」页面
 * 直接发现本服务器，无需手动添加 IP。
 *
 * 两个必须注意的坑：
 *   1. MOTD 不能等于陶瓦 FakeServer 使用的那个常量字符串，否则会被
 *      scanner 的 filter (`|m| m != MOTD`) 当成「陶瓦自己」直接丢弃。
 *   2. 陶瓦的接收 socket 绑定在本机各网卡地址以及 0.0.0.0 上
 *      （src/lib.rs 的 ADDRESSES 会额外 push UNSPECIFIED），
 *      因此发送端需要逐个网卡设置多播出口接口并各发一份，
 *      同时开启多播回环，才能保证同机进程收得到。
 */

const dgram = require('dgram');
const os = require('os');

// Minecraft 局域网发现多播地址与端口（原版协议，固定值）
const MCAST_ADDR_V4 = '224.0.2.60';
const MCAST_ADDR_V6 = 'ff75:230::60';
const MCAST_PORT = 4445;

// 广播间隔：与原版 Minecraft 保持一致。
// 陶瓦 scanner 对收到的端口有 5 秒过期清理，所以间隔必须明显小于 5s。
const BROADCAST_INTERVAL_MS = 1500;

// 陶瓦 FakeServer 自用的 MOTD（见陶瓦 src/lib.rs 的 `pub const MOTD`）。
// 陶瓦 scanner 的 filter 会把等于该值的广播视为「自己发的」而忽略，
// 因此 wow 的 MOTD 绝不能与之相同。
const TERRACOTTA_FAKESERVER_MOTD = '§6§l双击进入陶瓦联机大厅（请保持陶瓦运行）';

// wow 默认使用的 MOTD（同时也是局域网里 MC 客户端看到的服务器名）
const DEFAULT_MOTD = 'wow~ Minecraft Server';

/**
 * 收集本机可用于发送多播的 IPv4 地址（不含 loopback）。
 * 与陶瓦 src/lib.rs 的 ADDRESSES 取舍保持一致：排除 loopback 与
 * EasyTier 自身虚拟网段 10.144.144.x。
 */
function collectLocalIPv4() {
    const real = [];
    let ifaces = {};
    try {
        ifaces = os.networkInterfaces() || {};
    } catch (e) {
        ifaces = {};
    }
    for (const name of Object.keys(ifaces)) {
        for (const info of ifaces[name] || []) {
            if (!info || info.family !== 'IPv4' || !info.address) continue;
            if (info.internal) continue;
            // 跳过 EasyTier / 陶瓦自身的虚拟网段，避免把广播只投到虚拟网卡上
            if (info.address.startsWith('10.144.144.')) continue;
            real.push(info.address);
        }
    }
    return real;
}

/**
 * 规划发送通道：每个通道对应一个独立 socket 的绑定地址。
 *
 * 必须「一个地址一个 socket」，不能在同一个 socket 上循环
 * setMulticastInterface() 后连续 send()——send 是异步的，多次调用会全部
 * 使用最后一次设置的出口接口，导致报文只从某一个（可能是 loopback）接口发出。
 * 陶瓦的 FakeServer 同样是对每个地址各建一个 socket。
 *
 * 通道包含：
 *   - 每个真实网卡地址（主通路，陶瓦绑在具体网卡或 0.0.0.0 时都能收到）
 *   - 0.0.0.0（走系统默认多播出口，覆盖网卡枚举不全的情况）
 *   - 127.0.0.1（仅在没有真实网卡时兜底；陶瓦以 INADDR_ANY 加入多播组时
 *     通常不会监听 lo，故不作为主通路）
 */
function planChannels() {
    const real = collectLocalIPv4();
    const channels = real.slice();
    channels.push('0.0.0.0');
    if (real.length === 0) channels.push('127.0.0.1');
    return channels;
}

class LanBeacon {
    /**
     * @param {object} opts
     * @param {number} opts.port     Minecraft 服务端实际监听的端口（写入 [AD] 段）
     * @param {string} [opts.motd]   广播的 MOTD（局域网里显示的服务器名）
     * @param {boolean} [opts.verbose] 是否打印首次广播的详细信息
     */
    constructor(opts = {}) {
        this.port = Number(opts.port);
        let motd = String(opts.motd || DEFAULT_MOTD);
        // 兜底：与陶瓦自用 MOTD 冲突时强制改写，否则广播会被陶瓦忽略
        if (motd === TERRACOTTA_FAKESERVER_MOTD) motd = DEFAULT_MOTD;
        this.motd = motd;
        this.verbose = opts.verbose !== false;
        this.message = Buffer.from(`[MOTD]${this.motd}[/MOTD][AD]${this.port}[/AD]`, 'utf8');
        // 每个发送通道一个独立 socket：{ addr, sock }
        this.sockets4 = [];
        this.sock6 = null;
        this.timer = null;
        this.targets = [];
        this.sentCount = 0;
        this.lastError = null;
        this.started = false;
    }

    /** 为单个绑定地址创建 IPv4 多播发送 socket（失败返回 null，不抛错） */
    _createIPv4Socket(addr) {
        return new Promise(resolve => {
            let s;
            try {
                s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            } catch (e) {
                this.lastError = e;
                return resolve(null);
            }
            let settled = false;
            const fail = err => {
                if (settled) return;
                settled = true;
                this.lastError = err;
                try { s.close(); } catch (e) {}
                resolve(null);
            };
            s.once('error', fail);
            try {
                s.bind(0, addr, () => {
                    if (settled) return;
                    settled = true;
                    try {
                        s.setBroadcast(true);
                        s.setMulticastTTL(4);
                        s.setMulticastLoopback(true);
                    } catch (e) {
                        this.lastError = e;
                    }
                    // 绑到具体网卡地址时显式指定多播出口，保证从该网卡发出
                    if (addr && addr !== '0.0.0.0') {
                        try { s.setMulticastInterface(addr); } catch (e) {}
                    }
                    s.removeListener('error', fail);
                    // bind 之后的运行期错误不应让进程崩溃
                    s.on('error', err => { this.lastError = err; });
                    resolve(s);
                });
            } catch (e) {
                fail(e);
            }
        });
    }

    /**
     * 启动广播。尽力而为：任何一步失败都不抛错（Android / 容器 / 无网卡环境
     * 可能禁用多播），只记录 lastError，由调用方决定如何提示。
     * @returns {Promise<boolean>} 是否至少成功建立了一个发送通道
     */
    async start() {
        if (this.started) return true;
        if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
            this.lastError = new Error(`广播端口非法: ${this.port}`);
            return false;
        }

        // 每个通道一个独立 socket（见 planChannels 的说明：不能共用 socket 切接口）
        const channels = planChannels();
        for (const addr of channels) {
            const sock = await this._createIPv4Socket(addr);
            if (sock) this.sockets4.push({ addr, sock });
        }
        this.targets = this.sockets4.map(x => x.addr);

        // IPv6 发送 socket：可选，失败不影响 IPv4 通路
        this.sock6 = await new Promise(resolve => {
            let s;
            try {
                s = dgram.createSocket({ type: 'udp6', reuseAddr: true });
            } catch (e) {
                return resolve(null);
            }
            s.once('error', () => {
                try { s.close(); } catch (e) {}
                resolve(null);
            });
            s.bind(0, () => {
                try {
                    s.setMulticastTTL(4);
                    s.setMulticastLoopback(true);
                } catch (e) {}
                s.on('error', () => {});
                resolve(s);
            });
        });

        if (this.sockets4.length === 0 && !this.sock6) return false;

        this.started = true;
        this._tick();
        this.timer = setInterval(() => this._tick(), BROADCAST_INTERVAL_MS);
        if (this.timer.unref) this.timer.unref();

        if (this.verbose) {
            console.log(`📡 已启动 Minecraft 局域网广播：端口 ${this.port}，MOTD「${this.motd}」`);
            console.log(`   （陶瓦依靠该广播发现服务端端口；专用服务端自身不会广播，故由 wow 代发）`);
            console.log(`   投递接口: ${this.targets.join(', ')}${this.sock6 ? ' + IPv6' : ''}`);
        }
        return true;
    }

    /**
     * 发送一轮广播：每个通道用自己的 socket 各发一份，
     * 确保无论陶瓦绑在哪个网卡地址（或 0.0.0.0）上都能收到。
     */
    _tick() {
        for (const item of this.sockets4) {
            try {
                item.sock.send(this.message, 0, this.message.length, MCAST_PORT, MCAST_ADDR_V4, err => {
                    if (err) this.lastError = err;
                    else this.sentCount++;
                });
            } catch (e) {
                this.lastError = e;
            }
        }
        if (this.sock6) {
            try {
                this.sock6.send(this.message, 0, this.message.length, MCAST_PORT, MCAST_ADDR_V6, () => {});
            } catch (e) {
                // IPv6 多播不可用时忽略
            }
        }
    }

    /** 是否至少成功投递过一次 */
    hasSent() {
        return this.sentCount > 0;
    }

    /** 停止广播并释放 socket */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        for (const item of this.sockets4) {
            try { item.sock.close(); } catch (e) {}
        }
        this.sockets4 = [];
        if (this.sock6) {
            try { this.sock6.close(); } catch (e) {}
            this.sock6 = null;
        }
        this.started = false;
    }
}

module.exports = {
    LanBeacon,
    collectLocalIPv4,
    planChannels,
    MCAST_ADDR_V4,
    MCAST_ADDR_V6,
    MCAST_PORT,
    BROADCAST_INTERVAL_MS,
    DEFAULT_MOTD,
    TERRACOTTA_FAKESERVER_MOTD
};
