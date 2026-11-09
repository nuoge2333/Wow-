/**
 * server.properties 配置项的「中文名 / 中文说明」
 *
 * 为什么单独一个文件：server.properties 的键名是英文（`enforce-secure-profile`、
 * `entity-broadcast-range-percentage`），实例配置页如果只显示键名，用户得先去
 * 查 wiki 才知道这项是干什么的。这里给每个常用键配一份中文标题 + 一句中文解释，
 * Web 端直接渲染，用户不必记英文。
 *
 * 约定：
 *   - 键名以本文件的 `DOCS` 为唯一真源；
 *   - 说明只讲「这一项影响什么」，不抄 wiki 的完整规则；
 *   - 标题是给人看的短名词（「服务器端口」），不是键名的音译或直译。
 *
 * @typedef {{ label: string, desc: string, enum?: Record<string, string> }} FieldDoc
 */

const DOCS = {
    // ── 服务器信息 ──
    motd: {
        label: '服务器描述',
        desc: '玩家在多人游戏列表里看到的名称，支持 § 颜色代码。'
    },
    'server-port': {
        label: '服务器端口',
        desc: '客户端连接用的端口，默认 25565。改完要让玩家在地址后加「:端口」。'
    },
    'server-ip': {
        label: '监听地址',
        desc: '留空表示监听所有网卡；只有多网卡机器需要填具体 IP。'
    },
    'max-players': {
        label: '最大玩家数',
        desc: '同时在线人数上限（含 OP）。正版服上限也受账号数限制。'
    },
    'online-mode': {
        label: '正版验证',
        desc: 'true = 必须正版账号登录；局域网 / 离线服需设为 false（此时请配套白名单）。'
    },
    'network-compression-threshold': {
        label: '网络压缩阈值',
        desc: '超过该字节数的封包才压缩。默认 256；设为 -1 关闭压缩，0 全部压缩。'
    },
    'enforce-secure-profile': {
        label: '强制安全签名',
        desc: 'true = 必须带 Mojang 签名公钥才能进服；离线服一般关掉，否则进不来。'
    },

    // ── 游戏规则 ──
    gamemode: {
        label: '默认游戏模式',
        desc: '新玩家进入世界的初始模式（已有存档的玩家不受影响）。',
        enum: {
            survival: '生存',
            creative: '创造',
            adventure: '冒险',
            spectator: '旁观'
        }
    },
    'force-gamemode': {
        label: '强制游戏模式',
        desc: 'true = 每次登录都把玩家拉回上面的默认模式，玩家自己改的会被覆盖。'
    },
    difficulty: {
        label: '难度',
        desc: '和平不刷怪且自动回血；困难难度下怪物伤害最高。',
        enum: {
            peaceful: '和平',
            easy: '简单',
            normal: '普通',
            hard: '困难'
        }
    },
    hardcore: {
        label: '极限模式',
        desc: 'true = 玩家死亡后只能旁观，难度锁定为困难（对已有存档生效需重启）。'
    },
    pvp: {
        label: '玩家互伤',
        desc: 'false = 玩家之间无法直接造成伤害，但仍可用 TNT 等间接方式。'
    },
    'allow-flight': {
        label: '允许飞行',
        desc: '生存模式下默认禁止飞行；装飞行类模组或载具插件时需设 true。'
    },
    'allow-nether': {
        label: '允许下界',
        desc: 'false = 关闭下界传送门，玩家无法进入下界。'
    },
    'enable-command-block': {
        label: '启用命令方块',
        desc: 'false = 命令方块不执行；地图 / 小游戏服一般要打开。'
    },
    'op-permission-level': {
        label: 'OP 权限等级',
        desc: '1 = 绕过出生点保护；2 = 可用命令方块；3 = 可封禁玩家；4 = 全部权限。'
    },

    // ── 世界 ──
    'level-name': {
        label: '世界文件夹名',
        desc: '存档目录名。改成新名字 = 开一个新世界，旧世界仍在原目录里。'
    },
    'level-seed': {
        label: '世界种子',
        desc: '仅在世界首次生成时生效；留空 = 随机。已有存档改这里没有效果。'
    },
    'level-type': {
        label: '世界类型',
        desc: '决定地形生成器。仅对新世界生效，且需与生成器设置配合。',
        enum: {
            'minecraft:normal': '默认',
            'minecraft:flat': '超平坦',
            'minecraft:large_biomes': '巨型生物群系',
            'minecraft:amplified': '放大化',
            'minecraft:single_biome_surface': '单一生物群系'
        }
    },
    'generate-structures': {
        label: '生成结构',
        desc: 'false = 新世界不生成村庄、要塞等结构（仅对新世界生效）。'
    },
    'generator-settings': {
        label: '生成器设置',
        desc: 'JSON 文本，配合「超平坦 / 单一生物群系」使用，例如自定义地层。'
    },
    'spawn-protection': {
        label: '出生点保护半径',
        desc: '以出生点为中心的方块半径，非 OP 不能在此范围内破坏 / 放置。0 = 关闭。'
    },
    'max-world-size': {
        label: '世界边界半径',
        desc: '世界边界的最大半径（方块），超出后玩家无法继续向外走。'
    },

    // ── 玩家与白名单 ──
    'white-list': {
        label: '启用白名单',
        desc: 'true = 只有 whitelist.json 里的玩家能进服。离线服务必打开。'
    },
    'enforce-whitelist': {
        label: '强制执行白名单',
        desc: 'true = 名单变更后立刻踢掉不在名单里的在线玩家。'
    },
    'player-idle-timeout': {
        label: '挂机踢出（分钟）',
        desc: '玩家无操作超过该分钟数就被踢出；0 = 不踢。'
    },
    'broadcast-console-to-ops': {
        label: 'OP 可见控制台',
        desc: 'true = 控制台执行的命令会同步显示给在线 OP。'
    },
    'broadcast-rcon-to-ops': {
        label: 'OP 可见 RCON',
        desc: 'true = 通过 RCON 执行的命令也会显示给在线 OP。'
    },

    // ── 生物与实体 ──
    'spawn-animals': {
        label: '生成动物',
        desc: 'false = 世界不再自然生成动物（已有动物保留）。'
    },
    'spawn-monsters': {
        label: '生成怪物',
        desc: 'false = 不生成敌对生物，难度等于和平但保留饥饿等机制。'
    },
    'spawn-npcs': {
        label: '生成村民',
        desc: 'false = 不生成村民与流浪商人。'
    },
    'entity-broadcast-range-percentage': {
        label: '实体广播范围',
        desc: '实体同步给客户端的距离百分比（100 = 标准）。调低省带宽，但远处实体会「瞬移」。'
    },
    'max-entity-cramming': {
        label: '实体挤压上限',
        desc: '同一格内最多可堆叠的实体数，超出会持续受伤（防刷怪塔滥用）。'
    },

    // ── 远程控制 ──
    'enable-rcon': {
        label: '启用 RCON',
        desc: '开启后可用 RCON 客户端远程执行命令。开启必设密码，且勿直接暴露公网。'
    },
    'rcon.port': {
        label: 'RCON 端口',
        desc: 'RCON 监听端口，默认 25575；与游戏端口分开。'
    },
    'rcon.password': {
        label: 'RCON 密码',
        desc: 'RCON 的登录密码，留空等于关闭 RCON。请用足够长的随机串。'
    },
    'enable-query': {
        label: '启用 Query',
        desc: '允许第三方工具（服务器列表网站）查询在线人数与版本。'
    },
    'query.port': {
        label: 'Query 端口',
        desc: 'Query 监听端口，默认与游戏端口相同（25565）。'
    },

    // ── 性能与其它 ──
    'view-distance': {
        label: '视距（区块）',
        desc: '玩家能看到的区块半径。调大更远更耗内存和 CPU，人多建议 8~10。'
    },
    'simulation-distance': {
        label: '模拟距离（区块）',
        desc: '怪物 / 红石 / 作物实际运算的半径。通常不超过视距。'
    },
    'max-tick-time': {
        label: '单刻超时（毫秒）',
        desc: '单个游戏刻超过该毫秒数会判定卡死并关服；-1 = 不检测（排查卡顿时可临时关）。'
    },
    'use-native-transport': {
        label: '原生传输优化',
        desc: 'Linux 上启用 epoll 加速网络收发；Windows 上无效可关。'
    },
    'prevent-proxy-connections': {
        label: '拦截代理连接',
        desc: 'true = 拒绝通过代理 / VPN 连接的玩家（少数情况会误伤）。'
    },
    'snooper-enabled': {
        label: '匿名统计上报',
        desc: '是否向 Mojang 上报匿名使用数据。关掉不影响服务器运行。'
    },
    'resource-pack': {
        label: '资源包地址',
        desc: '玩家进服时提示下载的资源包直链（http/https）。留空 = 不推送。'
    },
    'resource-pack-sha1': {
        label: '资源包 SHA1',
        desc: '资源包的 SHA-1 校验值，填了才能保证下载完整（推荐填）。'
    },
    'require-resource-pack': {
        label: '强制资源包',
        desc: 'true = 玩家不接受资源包就被踢出。'
    }
};

/**
 * 取某个键的中文说明。
 * 未收录的键返回 null，前端回落到只显示键名。
 *
 * @param {string} key
 */
function docOf(key) {
    const d = DOCS[key];
    if (!d) return null;
    return { key, label: d.label, desc: d.desc, enum: d.enum || null };
}

/** 一次取全部（给接口用，避免前端逐个问） */
function allDocs() {
    const out = {};
    for (const key of Object.keys(DOCS)) {
        out[key] = docOf(key);
    }
    return out;
}

module.exports = { DOCS, docOf, allDocs };
