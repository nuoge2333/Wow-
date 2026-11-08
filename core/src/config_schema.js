/**
 * wow.yaml 配置字段描述表（V3.5.19）
 *
 * 作用：
 *   Web 面板「设置」页不再直接甩一个 JSON 文本框给用户，而是按本表生成标准表单
 *   （布尔 → 开关，枚举 → 下拉框，字符串 → 输入框，数组 → 逐行文本域），
 *   并在每项下方给出中文说明，降低「小白用户把 key 改坏」的概率。
 *
 * 设计约束：
 *   1. 本表只描述「怎么展示、怎么校验」，默认值仍以 config.js 的 DEFAULT_CONFIG 为准，
 *      避免两处各写一份默认值而逐渐分叉；
 *   2. 未在本表登记的键一律视为「未知键」，批量保存时忽略（防止前端塞入垃圾键）；
 *   3. secret 类型仅影响前端展示（password 输入框），后端仍按普通字符串存取。
 *
 * 字段说明：
 *   key       点号分隔的配置路径，与 config.getConfig / setConfig 一致
 *   type      boolean | string | number | select | list | secret
 *   label     表单标题（中文）
 *   desc      表单下方的一行说明（中文，写给不看文档的人）
 *   options   type=select 时的候选值 [{value,label}]
 *   group     分组名，前端按组渲染折叠面板
 *   advanced  true = 默认收在「高级」里，避免小白误改
 *   danger    true = 改动风险高，前端标红并二次确认
 */

const SCHEMA = [
    // ==================== 基础 ====================
    {
        key: 'language', type: 'select', group: '基础', label: '界面语言',
        desc: 'CLI 与提示信息的语言。改完即时生效，无需重启。',
        options: [{ value: 'zh_CN', label: '简体中文' }, { value: 'en_US', label: 'English' }]
    },
    {
        key: 'auto_scheme', type: 'boolean', group: '基础', label: '自动管理模式',
        desc: '开启后，创建方案会自动切换过去，并自动补齐 / 瘦身资源；关闭后一切由你手动决定（执行 pull / prune 后会自动关闭）。'
    },
    {
        key: 'verbose', type: 'boolean', group: '基础', label: '详细日志',
        desc: '开启后 CLI 会输出更多调试信息，排查问题时有用，平时建议关闭。'
    },

    // ==================== 服务器 ====================
    {
        key: 'server.scheme', type: 'string', group: '服务器', label: '当前激活方案',
        desc: '服务器实际运行的方案目录名。一般用 `wow scheme switch <名称>` 切换，不建议手改。',
        advanced: true
    },
    {
        key: 'server.java', type: 'string', group: '服务器', label: 'Java 路径',
        desc: '留空 = 自动按 MC 版本挑选合适的 Java。填了就固定用这个 java 可执行文件的绝对路径。',
        placeholder: '留空自动选择'
    },
    {
        key: 'server.jar', type: 'string', group: '服务器', label: '核心文件名',
        desc: '留空 = 自动在方案目录里找核心 jar。只有目录里有多个 jar 且自动识别错了才需要填。',
        placeholder: '留空自动识别', advanced: true
    },
    {
        // V3.6.2（607 指令）：JVM 参数改为「模板 + 覆盖」新结构
        key: 'server.jvm.template', type: 'select', group: '服务器', label: 'JVM 模板',
        desc: 'a = 低配 / 极致省内存；b = 平衡 / 主力首选 / Aikar\'s 标准；c = 性能 / ZGC 低延迟；d = 自定义（完全由下方覆盖参数决定，缺 -Xmx 时自动补 -Xmx2G）。G1 与 ZGC 参数互斥，wow 会自动清理冲突项。',
        options: [
            { value: 'a', label: 'a · 低配 / 极致省内存' },
            { value: 'b', label: "b · 平衡 / 主力首选 / Aikar's 标准" },
            { value: 'c', label: 'c · 性能 / ZGC / 低延迟' },
            { value: 'd', label: 'd · 自定义' }
        ]
    },
    {
        key: 'server.jvm.override_args', type: 'list', group: '服务器', label: 'JVM 覆盖参数',
        desc: '每行一个参数，会附加在模板之后（同名参数以这里的为准）。路径含空格时用引号包裹整个参数，例如 -Djava.library.path="C:\\Program Files\\xxx"。若启用外置登录，这里手填的 -javaagent 会被忽略，由 wow 独家托管。',
        placeholder: '-XX:MaxGCPauseMillis=200\n-XX:G1HeapRegionSize=16M'
    },

    // ==================== 下载 ====================
    {
        key: 'download.mirror', type: 'string', group: '下载', label: '下载镜像',
        desc: 'Minecraft 原版文件的下载源。国内建议保持默认的 BMCLAPI 镜像，海外可改成 Mojang 官方地址。',
        placeholder: 'https://bmclapi2.bangbang93.com'
    },
    {
        key: 'download.timeout', type: 'number', group: '下载', label: '超时（秒）',
        desc: '单个文件下载的最长等待时间。网络差可以调大，例如 60。', advanced: true
    },
    {
        key: 'download.retry', type: 'number', group: '下载', label: '重试次数',
        desc: '下载失败后的重试次数。默认 3 次。', advanced: true
    },

    // ==================== 模组 ====================
    {
        key: 'mod.auto_dependencies', type: 'boolean', group: '模组', label: '自动装前置',
        desc: '搜索安装模组时自动把依赖的前置模组一起装上。关掉后需要自己手动补前置。'
    },
    {
        key: 'mod.sources', type: 'list', group: '模组', label: '模组来源',
        desc: '搜索模组时优先查询的来源，每行一个。可选 curseforge / modrinth。',
        placeholder: 'curseforge\nmodrinth'
    },
    // V3.5.25：客户端专用模组自动隔离
    {
        key: 'mod.client_only.enabled', type: 'boolean', group: '模组', label: '启动时隔离客户端模组',
        desc: '开服前扫描 mods/，把钠、Iris 这类服务端装不上的纯客户端模组移到 mods_client_disabled/。只移动不删除，需要时挪回来即可。'
    },
    {
        key: 'mod.client_only.extra', type: 'list', group: '模组', label: '追加 / 剔除的 modid',
        desc: '每行一个 modid。写 `xxx` 表示额外隔离它；写 `-xxx` 表示内置名单里的这个不要隔离（例如你确信某个模组服务端也需要）。',
        placeholder: 'my-client-mod\n-jade', advanced: true
    },
    {
        key: 'mod.client_only.disable_builtin', type: 'boolean', group: '模组', label: '停用内置名单',
        desc: '开启后只按上面「追加 / 剔除」里的名单判断，完全不用自带的客户端模组表。',
        advanced: true, danger: true
    },
    // V3.5.25：CurseForge 请求层
    {
        key: 'curseforge.api_key', type: 'secret', group: '模组', label: 'CurseForge API Key',
        desc: '前往 console.curseforge.com 免费申请。填了之后，公共代理不可用时会自动直连官方 API。不填也能用，但要依赖代理或本地缓存。'
    },
    {
        key: 'curseforge.proxy_url', type: 'string', group: '模组', label: 'CurseForge 代理地址',
        desc: '自建 cfproxy 之类的代理后填在这里，例如 http://127.0.0.1:3000。留空 = 不走代理，直接用 API Key 请求官方接口。',
        placeholder: 'http://127.0.0.1:3000', advanced: true
    },

    // ==================== 备份 ====================
    {
        key: 'backup.auto', type: 'boolean', group: '备份', label: '自动备份',
        desc: '开启后按备份策略自动打包世界。手残党建议开启。'
    },
    {
        key: 'backup.max', type: 'number', group: '备份', label: '最多保留份数',
        desc: '超过这个数量会自动删除最旧的备份。', advanced: true
    },
    {
        key: 'backup.dir', type: 'string', group: '备份', label: '备份目录',
        desc: '相对 core/ 的路径，默认放在 scheme/backups。', advanced: true
    },

    // ==================== Web 面板 ====================
    {
        key: 'web.port', type: 'number', group: 'Web 面板', label: '端口',
        desc: '面板监听端口，默认 8080。被占用时改成 8081 之类即可。'
    },
    {
        key: 'web.host', type: 'select', group: 'Web 面板', label: '监听地址',
        desc: '127.0.0.1 = 只有本机能访问（最安全）；0.0.0.0 = 局域网/公网都能访问，必须配合下方密码使用。',
        options: [
            { value: '127.0.0.1', label: '仅本机（推荐）' },
            { value: '0.0.0.0', label: '所有网卡（对外暴露）' }
        ],
        danger: true
    },
    {
        key: 'web.auth_password', type: 'secret', group: 'Web 面板', label: '面板登录密码',
        desc: '没配 SMTP 邮箱时用它登录面板。首次保存后会被加密存储，之后这里显示为空是正常的（不代表没设置）。',
        placeholder: '留空表示不修改'
    },
    {
        key: 'web.auth_token', type: 'secret', group: 'Web 面板', label: '登录签名密钥',
        desc: '签发登录令牌用的随机字符串。首次启动会自动生成；清空后，面板一旦对外暴露就会拒绝启动。',
        advanced: true, danger: true
    },
    {
        key: 'web.theme', type: 'string', group: 'Web 面板', label: '界面主题',
        desc: '面板使用的主题包名，默认 default。用 `wow theme list` 查看已安装主题。'
    },
    {
        key: 'web.run_startup', type: 'boolean', group: 'Web 面板', label: '开机自启面板',
        desc: '随 wow 启动自动拉起 Web 面板。', advanced: true
    },
    {
        key: 'web.dev_mode', type: 'boolean', group: 'Web 面板', label: '开发模式',
        desc: '未配 SMTP 时把登录验证码直接回显到页面。⚠️ 生产环境务必关闭，否则任何人都能登录。',
        advanced: true, danger: true
    },
    {
        key: 'web.session_timeout', type: 'number', group: 'Web 面板', label: '登录有效期（秒）',
        desc: '登录后多久需要重新登录，默认 86400（一天）。', advanced: true
    },
    {
        key: 'web.allow_scheme_ops', type: 'boolean', group: 'Web 面板', label: '允许面板操作方案',
        desc: '放开面板上的创建 / 切换 / 删除方案等指令。⚠️ 这些操作会改动服务器文件，默认关闭。',
        advanced: true, danger: true
    },
    {
        key: 'web.allow_remote_install', type: 'boolean', group: 'Web 面板', label: '允许远程安装',
        desc: '放开面板的 URL 远程下载安装。⚠️ 等同于把「任意地址下载并执行」的入口开到公网，默认关闭。',
        advanced: true, danger: true
    },
    {
        key: 'web.allow_plugins', type: 'boolean', group: 'Web 面板', label: '允许执行插件命令',
        desc: '放开插件注册的自定义命令经面板执行。⚠️ 插件是第三方代码、与主程序同权限，默认关闭。',
        advanced: true, danger: true
    },
    {
        key: 'web.tunnel_mirror', type: 'string', group: 'Web 面板', label: 'cloudflared 下载镜像',
        desc: '公网穿透用的 cloudflared 二进制的自定义下载源。留空 = 内置国内镜像（gh-proxy.com / ghfast.top / ghproxy.net）+ GitHub 官方兜底。可填镜像根或完整的 releases 前缀。',
        placeholder: '留空使用内置镜像', advanced: true
    },

    // ==================== 邮件 ====================
    {
        key: 'mail.smtp.host', type: 'string', group: '邮件', label: 'SMTP 服务器',
        desc: '例如 smtp.qq.com。配置后才能用邮箱验证码登录面板、接收崩溃通知。'
    },
    {
        key: 'mail.smtp.port', type: 'number', group: '邮件', label: 'SMTP 端口',
        desc: '常见为 587（STARTTLS）或 465（SSL）。', advanced: true
    },
    {
        key: 'mail.smtp.user', type: 'string', group: '邮件', label: 'SMTP 账号',
        desc: '通常是完整邮箱地址。', advanced: true
    },
    {
        key: 'mail.smtp.pass', type: 'secret', group: '邮件', label: 'SMTP 密码 / 授权码',
        desc: 'QQ / 163 邮箱请填「授权码」而不是登录密码。',
        placeholder: '留空表示不修改', advanced: true
    },
    {
        key: 'mail.admin_email', type: 'string', group: '邮件', label: '管理员邮箱',
        desc: '接收崩溃通知、日志报告的收件地址。'
    },
    {
        key: 'mail.whitelist', type: 'list', group: '邮件', label: '登录邮箱白名单',
        desc: '只有名单内的邮箱才能获取验证码并登录面板，每行一个；留空 = 不限制。填 * 表示允许所有邮箱。',
        advanced: true, danger: true
    },
    {
        key: 'mail.send_on_crash', type: 'boolean', group: '邮件', label: '崩溃时发邮件',
        desc: '服务器异常退出时把日志摘要发给管理员邮箱。需要先配好 SMTP。'
    },
    {
        key: 'mail.send_logs_interval', type: 'number', group: '邮件', label: '定期发日志（分钟）',
        desc: '0 = 不发送。大于 0 时按该间隔把日志发到管理员邮箱。', advanced: true
    },

    // ==================== AI ====================
    {
        key: 'ai.api_key', type: 'secret', group: 'AI 日志分析', label: 'API Key',
        desc: '用于 `wow logs analyze` 的在线日志分析。不填就只能用本地初诊（崩溃时的自动诊断仍可用）。',
        placeholder: '留空表示不修改'
    },
    {
        key: 'ai.model', type: 'string', group: 'AI 日志分析', label: '模型名',
        desc: '例如 gpt-4o-mini。留空则使用服务端默认模型。', advanced: true
    },
    {
        key: 'ai.api_url', type: 'string', group: 'AI 日志分析', label: 'API 地址',
        desc: '兼容 OpenAI 协议的服务地址，可填自建中转。留空用官方地址。', advanced: true
    },

    // ==================== 正版验证 ====================
    {
        key: 'auth.enable', type: 'boolean', group: '正版验证', label: '启用正版验证',
        desc: '开启后只允许正版账号进入（需要 authlib-injector）。'
    },
    {
        key: 'auth.server', type: 'string', group: '正版验证', label: '验证服务器',
        desc: '正版验证服务器地址，例如 https://littleskin.cn/api/yggdrasil。留空用 Mojang 官方。', advanced: true
    },
    {
        key: 'auth.javaagent', type: 'string', group: '正版验证', label: 'authlib-injector 路径',
        desc: '留空则由 wow 自动下载。', advanced: true
    },

    // ==================== 联机 ====================
    {
        key: 'lan.auto_room', type: 'boolean', group: '联机（陶瓦）', label: '开服自动开房',
        desc: '服务器启动后自动创建联机房间，适合无人值守场景。'
    },
    {
        key: 'lan.room_code', type: 'string', group: '联机（陶瓦）', label: '固定房间号',
        desc: '留空 = 每次由陶瓦随机生成。填固定值后好友可直接输入该房间号加入。'
    },
    {
        key: 'lan.version', type: 'string', group: '联机（陶瓦）', label: '陶瓦版本',
        desc: '对应陶瓦 release 的 tag（如 0.4.2），升级前请确认与当前服务端兼容。', advanced: true
    },
    {
        key: 'lan.mirror', type: 'string', group: '联机（陶瓦）', label: '陶瓦下载镜像',
        desc: '默认走 Gitee，国内下载更快。', advanced: true
    },

    // ==================== Java 运行时 ====================
    {
        key: 'jre.auto_download', type: 'boolean', group: 'Java 运行时', label: '自动下载 JRE',
        desc: '本机没有合适版本 Java 时自动下载一份到 core/jre。'
    },
    {
        key: 'jre.dir', type: 'string', group: 'Java 运行时', label: 'JRE 存放目录',
        desc: '相对 core/ 的路径，默认 jre。', advanced: true
    },
    {
        key: 'jre.mirror', type: 'string', group: 'Java 运行时', label: 'JRE 镜像',
        desc: '默认清华 TUNA 的 Adoptium 镜像；不可达时会自动回退官方源。', advanced: true
    }
];

/** key -> 字段定义 */
const BY_KEY = new Map(SCHEMA.map(f => [f.key, f]));

/**
 * 取字段定义
 * @param {string} key
 */
function getField(key) {
    return BY_KEY.get(key) || null;
}

/** 全部字段（返回副本，避免调用方改到内部表） */
function listFields() {
    return SCHEMA.map(f => ({ ...f }));
}

/**
 * 按类型把前端传来的原始值规整成可写入 yaml 的值。
 * @param {object} field
 * @param {*} raw
 * @returns {{ok:true, value:*} | {ok:false, reason:string}}
 */
function coerce(field, raw) {
    const type = field.type;

    if (type === 'boolean') {
        if (typeof raw === 'boolean') return { ok: true, value: raw };
        if (raw === 'true' || raw === 1 || raw === '1') return { ok: true, value: true };
        if (raw === 'false' || raw === 0 || raw === '0' || raw === '' || raw === null) {
            return { ok: true, value: false };
        }
        return { ok: false, reason: '应为布尔值' };
    }

    if (type === 'number') {
        const n = Number(raw);
        if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
            return { ok: false, reason: '应为数字' };
        }
        if (n < 0) return { ok: false, reason: '不能为负数' };
        return { ok: true, value: n };
    }

    if (type === 'select') {
        const v = String(raw == null ? '' : raw).trim();
        const values = (field.options || []).map(o => o.value);
        if (!values.includes(v)) return { ok: false, reason: `只能是 ${values.join(' / ')}` };
        return { ok: true, value: v };
    }

    if (type === 'list') {
        let arr;
        if (Array.isArray(raw)) arr = raw;
        else arr = String(raw == null ? '' : raw).split(/\r?\n/);
        arr = arr.map(s => String(s).trim()).filter(Boolean);
        return { ok: true, value: arr };
    }

    // string / secret
    if (raw === null || raw === undefined) return { ok: true, value: null };
    if (typeof raw === 'object') return { ok: false, reason: '应为字符串' };
    const s = String(raw);
    // 留空统一存 null，与 DEFAULT_CONFIG 的「未配置」语义保持一致
    return { ok: true, value: s.trim() === '' ? null : s };
}

/**
 * 校验并整理一批「点号键 → 值」的改动。
 * 未知键直接丢弃（不报错），类型不符则整体失败并指出是哪个键。
 * @param {object} patch
 * @returns {{ok:true, values:object, skipped:string[]} | {ok:false, key:string, reason:string}}
 */
function validatePatch(patch) {
    const values = {};
    const skipped = [];
    for (const [key, raw] of Object.entries(patch || {})) {
        const field = BY_KEY.get(key);
        if (!field) { skipped.push(key); continue; }
        const r = coerce(field, raw);
        if (!r.ok) return { ok: false, key, reason: r.reason };
        values[key] = r.value;
    }
    return { ok: true, values, skipped };
}

module.exports = {
    SCHEMA,
    listFields,
    getField,
    coerce,
    validatePatch
};
