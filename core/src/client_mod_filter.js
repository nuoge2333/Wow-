/**
 * 客户端专用模组自动隔离（V3.5.25）
 * ----------------------------------------------------------------
 * 规则一句话：**服务端装不上的东西，不该留在 mods/ 里等着崩服。**
 *
 * 背景：
 *   整合包（尤其是从 CurseForge 一键导入的那种）往往把客户端模组和通用模组
 *   混在同一个 mods/ 里。Sodium、Iris、Continuity 这类纯客户端模组被服务端加载时，
 *   轻则 ClassNotFound 刷屏，重则整个服务端起不来，而报错信息通常指向
 *   「某个 mixin 注入失败」，与「你装了个客户端模组」这件事完全看不出关系。
 *
 * 设计取舍：
 *   1. **只移动不删除**。误判的代价必须可逆 —— 全部丢进 mods_client_disabled/，
 *      用户挪回来即可。删文件是不可接受的产品行为。
 *   2. **以 jar 内部元数据为准**。文件名里带 sodium 的可能是服务端兼容版，
 *      文件名看着人畜无害的也可能就是客户端模组。读 jar 里的
 *      fabric.mod.json / mods.toml 才能拿到真正的 modid。
 *   3. **宁可漏杀不可错杀**。判断不出来就放过（并计入 skipped），
 *      只有「元数据明确写了 environment=client」或「modid 命中名单」才动手。
 *   4. **不阻断启动**。整个流程任何一步出错都只是警告，绝不让隔离逻辑本身
 *      成为「服务器起不来」的新理由。
 *
 * 依赖：adm-zip（已是 wow 的既有依赖，只用于读 zip 条目，不解压到磁盘）
 */

const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

/** 隔离目录名（位于方案目录 / 服务端目录下，与 mods/ 同级） */
const QUARANTINE_DIRNAME = 'mods_client_disabled';

/** 单个 jar 元数据读取超时保护：超过这个大小的 jar 只读目录区，不做完整解析 */
const MAX_META_BYTES = 256 * 1024;

/**
 * 内置「已知客户端专用」modid 名单。
 *
 * 收录标准：**该模组在服务端上要么完全无用、要么会直接导致崩溃**。
 * 只是「服务端用不上但不报错」的（比如各类客户端界面美化小模组）尽量也收，
 * 但凡是存在「服务端也需要」的歧义的，一律不收 —— 误杀比漏杀更难被发现。
 *
 * 键为小写 modid，值为一句中文说明（用于日志，让用户知道凭什么动他的文件）。
 */
const BUILTIN_CLIENT_MODS = {
    // ---------- 渲染 / 性能（纯客户端，服务端无渲染管线） ----------
    sodium: '钠（Sodium）—— 客户端渲染优化，服务端没有渲染管线',
    rubidium: '铷（Rubidium）—— Forge 版钠，纯客户端渲染',
    embeddium: 'Embeddium —— 钠的另一个人维护的分支，纯客户端渲染',
    magnesium: 'Magnesium —— 1.16 时代的钠移植版，纯客户端',
    xenon: 'Xenon —— 钠的 Forge 分支，纯客户端',
    irradium: 'Irradium —— 钠分支，纯客户端',
    'sodium-extra': 'Sodium Extra —— 钠的附加设置页，纯客户端',
    'sodiumextras': 'Sodium Extras —— 钠附属，纯客户端',
    'reeses-sodium-options': 'Reese\'s Sodium Options —— 钠的选项界面改版，纯客户端',
    optifine: 'OptiFine —— 高清修复，服务端不加载',
    optifabric: 'OptiFabric —— OptiFine 的 Fabric 兼容层，纯客户端',
    iris: 'Iris Shaders —— 光影，服务端无意义',
    oculus: 'Oculus —— Forge 版 Iris 光影，纯客户端',
    'iris-flywheel-compat': 'Iris × Flywheel 兼容补丁，纯客户端',
    shaders: '光影相关模组，服务端无意义',
    canvas: 'Canvas —— 渲染器替换，纯客户端',
    'canvas-renderer': 'Canvas Renderer —— 渲染器替换，纯客户端',
    nvidium: 'Nvidium —— N 卡专用渲染优化，纯客户端',
    'badoptimizations': 'BadOptimizations —— 客户端优化，服务端无收益',
    'entityculling': 'EntityCulling —— 客户端视锥剔除，服务端无渲染',
    'moreculling': 'MoreCulling —— 客户端剔除优化',
    'cull-less-leaves': 'Cull Less Leaves —— 客户端树叶剔除',
    'cullleaves': 'Cull Leaves —— 客户端树叶剔除',
    'dynamic-fps': 'Dynamic FPS —— 客户端帧率调节',
    'fps-reducer': 'FPS Reducer —— 客户端帧率调节',
    betterfps: 'BetterFPS —— 客户端帧率优化',
    'fast-furnace': 'FastFurnace —— 客户端侧界面加速',
    'smooth-boot': 'Smooth Boot —— 客户端启动优化',

    // ---------- 界面 / HUD / 信息显示 ----------
    'modmenu': 'Mod Menu —— 模组列表界面，服务端无 GUI',
    'better-modlist': 'Better Modlist —— 模组列表界面替代',
    'configured': 'Configured —— 模组配置界面',
    'cloth-config': 'Cloth Config —— 配置界面库，服务端通常无 GUI 需求',
    'yet-another-config-lib': 'YACL —— 配置界面库，纯客户端用途',
    'jade': 'Jade —— 顶部信息 HUD，纯客户端',
    'wthit': 'WTHIT —— 方块信息 HUD，纯客户端',
    'hwyla': 'HWYLA —— 方块信息 HUD，纯客户端',
    'the-one-probe': 'The One Probe —— 方块信息 HUD，纯客户端',
    'journeymap': 'JourneyMap —— 小地图，纯客户端',
    'xaeros-minimap': 'Xaero\'s Minimap —— 小地图，纯客户端',
    'xaeros-world-map': 'Xaero\'s World Map —— 世界地图，纯客户端',
    'xaerominimap': 'Xaero\'s Minimap —— 小地图，纯客户端',
    'xaeroworldmap': 'Xaero\'s World Map —— 世界地图，纯客户端',
    'minimap': '小地图类模组，纯客户端',
    'appleskin': 'AppleSkin —— 饱食度 HUD 提示，纯客户端',
    'detailarmorbar': 'Detail Armor Bar —— 护甲条 HUD',
    'toastcontrol': 'Toast Control —— 成就弹窗控制，纯客户端',
    'betterf3': 'BetterF3 —— F3 调试界面美化，纯客户端',
    'f3+': 'F3 增强类模组，纯客户端',
    'inventory-hud': 'Inventory HUD+ —— 背包 HUD，纯客户端',
    'inventoryhud': 'Inventory HUD+ —— 背包 HUD，纯客户端',
    'mouse-tweaks': 'Mouse Tweaks —— 鼠标拖拽整理，纯客户端',
    'controlling': 'Controlling —— 按键绑定搜索，纯客户端',
    'reeses-sodium-options': '钠选项界面，纯客户端',
    'chat-heads': 'Chat Heads —— 聊天头像，纯客户端',
    'blur': 'Blur —— 菜单背景模糊，纯客户端',
    'smooth-scroll': '平滑滚动，纯客户端',
    'no-recipe-book': 'No Recipe Book —— 隐藏配方书按钮，纯客户端',
    'better-advancements': 'Better Advancements —— 进度界面改版',
    'advancementinfo': 'Advancement Info —— 进度信息，纯客户端',
    'shulkerboxtooltip': 'ShulkerBoxTooltip —— 潜影盒提示，纯客户端',
    'tooltipfix': 'TooltipFix —— 提示框修复，纯客户端',
    'legendary-tooltips': 'Legendary Tooltips —— 提示框美化',
    'item-borders': 'Item Borders —— 物品稀有度边框',
    'enchantment-descriptions': 'Enchantment Descriptions —— 附魔说明，纯客户端',
    'screenshot-to-clipboard': '截图到剪贴板，纯客户端',

    // ---------- 键位 / 输入 / 声音 ----------
    'amecs': 'Amecs —— 键位修饰键支持，纯客户端',
    'auto-sprint': 'Auto Sprint —— 自动疾跑，纯客户端',
    'auto-run': '自动奔跑，纯客户端',
    'controls-custom': '按键自定义，纯客户端',
    'sound-physics-remastered': 'Sound Physics Remastered —— 客户端音效混响',
    'presence-footsteps': 'Presence Footsteps —— 客户端脚步声',
    'music-duration-reducer': '音乐时长控制，纯客户端',
    'no-narrator': 'No Narrator —— 关闭旁白，纯客户端',

    // ---------- 画质 / 光影 / 视觉 ----------
    'panorama': 'Panorama —— 主菜单全景图，纯客户端',
    'fancymenu': 'FancyMenu —— 主菜单定制，纯客户端',
    'drippy-loading-screen': 'Drippy Loading Screen —— 加载界面定制',
    'custommainmenu': 'Custom Main Menu —— 主菜单定制',
    'loadingbackgrounds': '加载背景图，纯客户端',
    'essential': 'Essential —— 客户端社交模组（含服务端无用的功能）',
    'lambdabettergrass': 'LambdaBetterGrass —— 客户端草地渲染',
    'bettergrass': 'Better Grass —— 客户端草地渲染',
    'betterfoliage': 'Better Foliage —— 客户端植被渲染',
    'not-enough-animations': 'Not Enough Animations —— 客户端动画',
    '3d-skin-layers': '3D Skin Layers —— 客户端皮肤渲染',
    'skin-layers': 'Skin Layers 3D —— 客户端皮肤渲染',
    'eating-animation': 'Eating Animation —— 客户端进食动画',
    'waving-banner': 'Waving Banner —— 客户端旗帜飘动',
    'first-person-model': 'First Person Model —— 第一人称模型',
    'shoulder-surfing-reloaded': 'Shoulder Surfing —— 第三人称视角改进',

    // ---------- 连接 / 服务器列表 ----------
    'serverselector': 'Server Selector —— 服务器列表增强，纯客户端',
    'serverlistplus': 'Server List Plus —— 服务器列表美化，纯客户端',
    'multiplayer-server-pinger': '服务器列表 ping 增强，纯客户端',
    'lan-server-properties': '局域网属性编辑，纯客户端'
};

/**
 * 判断是否内置名单命中
 * @param {string} modId
 */
function isBuiltinClientMod(modId) {
    const id = String(modId || '').trim().toLowerCase();
    if (!id) return null;
    return Object.prototype.hasOwnProperty.call(BUILTIN_CLIENT_MODS, id)
        ? BUILTIN_CLIENT_MODS[id]
        : null;
}

/**
 * 把用户配置的名单与内置名单合成一份最终名单。
 *
 * 语义（对应「内置名单 + 用户可覆盖」）：
 *   - mod.client_only.extra    追加到内置名单之上（用户发现了新的客户端模组）
 *   - mod.client_only.extra[]  写 `-sodium` 这种带减号的，表示从内置名单里剔除
 *                              （用户确信某个模组服务端确实需要）
 *
 * @param {object} opts { extra: string[], disableBuiltin: boolean }
 * @returns {{ map: Map<string,string>, removed: string[] }}
 */
function buildClientModSet(opts = {}) {
    const disableBuiltin = opts.disableBuiltin === true;
    const map = new Map();

    if (!disableBuiltin) {
        for (const [id, desc] of Object.entries(BUILTIN_CLIENT_MODS)) {
            map.set(id, desc);
        }
    }

    const extra = Array.isArray(opts.extra) ? opts.extra : [];
    const removed = [];
    for (const raw of extra) {
        const item = String(raw == null ? '' : raw).trim();
        if (!item) continue;
        if (item.startsWith('!') || item.startsWith('-')) {
            const id = item.slice(1).trim().toLowerCase();
            if (!id) continue;
            if (map.delete(id)) removed.push(id);
            continue;
        }
        // 支持 `modid` 或 `modid: 说明`
        const idx = item.indexOf(':');
        const id = (idx >= 0 ? item.slice(0, idx) : item).trim().toLowerCase();
        const desc = idx >= 0 ? item.slice(idx + 1).trim() : '';
        if (!id) continue;
        map.set(id, desc || '用户自定义的客户端专用模组');
    }

    return { map, removed };
}

/** 跨平台大小写无关的条目查找（jar 内路径大小写不一定规范） */
function findEntry(zip, name) {
    const target = String(name).toLowerCase();
    try {
        return zip.getEntries().find(e => String(e.entryName).toLowerCase() === target) || null;
    } catch (e) {
        return null;
    }
}

/** 安全地读一个条目为文本，超过 MAX_META_BYTES 直接放弃（防 zip 炸弹） */
function readEntryText(entry) {
    if (!entry) return null;
    try {
        const size = typeof entry.header && entry.header.size ? entry.header.size : 0;
        if (size > MAX_META_BYTES) return null;
        const data = entry.getData();
        if (!data || data.length > MAX_META_BYTES) return null;
        return data.toString('utf8');
    } catch (e) {
        return null;
    }
}

/**
 * 从 mods.toml 里解析所有 modId。
 * 不引入 TOML 解析库 —— 这里只需要 `[[mods]]` 段里的 `modId = "xxx"`，
 * 手写正则足够，而且不会因为某个模组写了奇怪的 TOML 而整个抛异常。
 * @param {string} text
 * @returns {Array<{modId:string, displayName:string}>}
 */
function parseModsToml(text) {
    const out = [];
    if (!text) return out;
    // 按 [[mods]] 分段；每段内取第一个 modId / displayName
    const blocks = String(text).split(/^\s*\[\[mods\]\]\s*$/m);
    // blocks[0] 是 [[mods]] 之前的内容，跳过
    for (let i = 1; i < blocks.length; i++) {
        const blk = blocks[i];
        const idm = blk.match(/^\s*modId\s*=\s*["']([^"']+)["']/m);
        if (!idm) continue;
        const nm = blk.match(/^\s*displayName\s*=\s*["']([^"']*)["']/m);
        out.push({ modId: idm[1].trim(), displayName: nm ? nm[1] : '' });
    }
    // 兼容一种写法：mods.toml 里没有 [[mods]] 但有顶层 modId
    if (out.length === 0) {
        const idm = String(text).match(/^\s*modId\s*=\s*["']([^"']+)["']/m);
        if (idm) out.push({ modId: idm[1].trim(), displayName: '' });
    }
    return out;
}

/**
 * 读取一个 jar 的模组元数据。
 *
 * 返回结构：
 * {
 *   ok: boolean,            // false = 这个 jar 不是能识别的模组（可能是插件/资源包/损坏）
 *   reason: string,         // ok=false 时的原因
 *   loader: 'fabric'|'forge'|'neoforge'|'quilt'|'unknown',
 *   mods: [{ modId, displayName, environment }],
 *   clientOnly: boolean     // 元数据里是否明确声明了「纯客户端」
 * }
 *
 * @param {string} jarPath
 */
function readModMeta(jarPath) {
    let zip;
    try {
        zip = new AdmZip(jarPath);
    } catch (e) {
        return { ok: false, reason: `无法作为 zip 打开（${e.message}）`, loader: 'unknown', mods: [], clientOnly: false };
    }

    const mods = [];
    let loader = 'unknown';
    let clientOnly = false;

    // ---------- Fabric / Quilt：fabric.mod.json ----------
    const fabricEntry = findEntry(zip, 'fabric.mod.json') || findEntry(zip, 'quilt.mod.json');
    if (fabricEntry) {
        loader = findEntry(zip, 'quilt.mod.json') ? 'quilt' : 'fabric';
        const text = readEntryText(fabricEntry);
        if (text) {
            try {
                const json = JSON.parse(text);
                const isQuilt = loader === 'quilt';
                // quilt.mod.json 的结构是 { quilt_loader: { id, ... } }
                const root = isQuilt && json.quilt_loader ? json.quilt_loader : json;
                const id = root.id || root.modid || '';
                if (id) {
                    mods.push({
                        modId: String(id),
                        displayName: String(root.name || root.displayName || ''),
                        environment: root.environment || ''
                    });
                }
                // 块级 entrypoints：只要 client 有内容而 main / server 都没有，
                // 基本可以判定这是一个只在客户端跑的模组。
                const ep = root.entrypoints || {};
                const hasClient = Array.isArray(ep.client) ? ep.client.length > 0 : !!ep.client;
                const hasMain = Array.isArray(ep.main) ? ep.main.length > 0 : !!ep.main;
                const hasServer = Array.isArray(ep.server) ? ep.server.length > 0 : !!ep.server;
                const env = String(root.environment || '').toLowerCase();
                if (env === 'client' || env === 'client_only' || env === 'clientside') {
                    clientOnly = true;
                } else if (hasClient && !hasMain && !hasServer) {
                    clientOnly = true;
                }
            } catch (e) {
                return { ok: false, reason: `fabric.mod.json 解析失败（${e.message}）`, loader, mods, clientOnly };
            }
        }
    }

    // ---------- Forge / NeoForge：META-INF/mods.toml 或 META-INF/neoforge.mods.toml ----------
    if (mods.length === 0) {
        const tomlEntry = findEntry(zip, 'META-INF/mods.toml') || findEntry(zip, 'META-INF/neoforge.mods.toml');
        if (tomlEntry) {
            loader = findEntry(zip, 'META-INF/neoforge.mods.toml') ? 'neoforge' : 'forge';
            const parsed = parseModsToml(readEntryText(tomlEntry));
            for (const m of parsed) {
                mods.push({ modId: m.modId, displayName: m.displayName, environment: '' });
            }
            // Forge 的 clientSideOnly 在 mods.toml 里以 displayTest 或
            // [[dependencies]] side="CLIENT" 出现，但不代表模组本身只能客户端加载，
            // 不能据此判定，故这里不做 clientOnly 推断。
        }
    }

    // ---------- 老版本 Forge：mcmod.info ----------
    if (mods.length === 0) {
        const infoEntry = findEntry(zip, 'mcmod.info');
        if (infoEntry) {
            loader = 'forge';
            const text = readEntryText(infoEntry);
            if (text) {
                try {
                    let json = JSON.parse(text);
                    if (json && !Array.isArray(json) && Array.isArray(json.modList)) json = json.modList;
                    if (Array.isArray(json)) {
                        for (const m of json) {
                            if (m && m.modid) {
                                mods.push({ modId: String(m.modid), displayName: String(m.name || ''), environment: '' });
                            }
                        }
                    }
                } catch (e) {
                    // 1.12 的 mcmod.info 经常不是严格 JSON，解析失败就当没有元数据
                }
            }
        }
    }

    if (mods.length === 0) {
        return {
            ok: false,
            reason: 'jar 内没有找到可识别的模组元数据（可能是插件 / 资源包 / 已损坏）',
            loader,
            mods,
            clientOnly
        };
    }

    return { ok: true, reason: '', loader, mods, clientOnly };
}

/**
 * 判定单个 jar 是否应被隔离。
 *
 * @param {string} jarPath
 * @param {Map<string,string>} clientSet 合成后的名单
 * @returns {{ action:'skip'|'quarantine', by:'meta'|'modid'|'', modId:string, desc:string, meta:object }}
 */
function judgeJar(jarPath, clientSet) {
    const meta = readModMeta(jarPath);

    if (!meta.ok) {
        return { action: 'skip', by: '', modId: '', desc: meta.reason, meta };
    }

    // 1) 元数据明确说「纯客户端」—— 最强证据，优先于名单
    if (meta.clientOnly) {
        const first = meta.mods[0];
        return {
            action: 'quarantine',
            by: 'meta',
            modId: first ? first.modId : '',
            desc: '元数据声明为纯客户端模组（entrypoints 只有 client / environment=client）',
            meta
        };
    }

    // 2) modid 命中名单
    for (const m of meta.mods) {
        const hit = clientSet.get(String(m.modId).toLowerCase());
        if (hit) {
            return { action: 'quarantine', by: 'modid', modId: m.modId, desc: hit, meta };
        }
    }

    return { action: 'skip', by: '', modId: meta.mods[0] ? meta.mods[0].modId : '', desc: '', meta };
}

/**
 * 判断当前服务端是否根本不需要 mods/ 目录。
 * 原版 / 纯插件端（Paper、Purpur、Spigot、Bukkit、Leaves）都不加载 mods/，
 * 那里的 jar 就算有也不该被动。
 *
 * @param {string} loader 方案里的 loader 字段，或 server.type
 */
function loaderSupportsMods(loader) {
    const l = String(loader || '').trim().toLowerCase();
    if (!l) return true;               // 不知道就别拦
    if (l === 'vanilla') return false;
    if (['paper', 'purpur', 'spigot', 'bukkit', 'leaves'].includes(l)) return false;
    // mohist / catserver 是混合端，mods/ 有效
    return true;
}

/**
 * 扫描 mods 目录并执行隔离。
 *
 * @param {object} opts
 *   modsDir       {string}  mods 目录绝对路径
 *   quarantineDir {string}  隔离目录绝对路径（默认 modsDir 同级的 mods_client_disabled）
 *   clientSet     {Map}     合成后的名单（见 buildClientModSet）
 *   dryRun        {boolean} 只报告不改动
 *   log           {(level:string, msg:string)=>void}
 * @returns {{ scanned, quarantined:[], skipped:[], errors:[], movedCount }}
 */
function scanAndQuarantine(opts = {}) {
    const modsDir = opts.modsDir;
    const quarantineDir = opts.quarantineDir || path.join(path.dirname(modsDir), QUARANTINE_DIRNAME);
    const clientSet = opts.clientSet instanceof Map ? opts.clientSet : new Map();
    const dryRun = opts.dryRun === true;
    const log = typeof opts.log === 'function' ? opts.log : () => {};

    const result = { scanned: 0, quarantined: [], skipped: [], errors: [], movedCount: 0 };

    let entries;
    try {
        entries = fs.readdirSync(modsDir);
    } catch (e) {
        // 目录不存在是正常情况（原版端 / 未装模组），静默返回
        return result;
    }

    const jars = entries
        .filter(f => /\.jar$/i.test(f))
        .sort();

    result.scanned = jars.length;
    if (jars.length === 0) return result;

    for (const file of jars) {
        const full = path.join(modsDir, file);
        let stat;
        try {
            stat = fs.statSync(full);
        } catch (e) {
            result.errors.push({ file, reason: e.message });
            continue;
        }
        if (!stat.isFile()) continue;

        let verdict;
        try {
            verdict = judgeJar(full, clientSet);
        } catch (e) {
            result.errors.push({ file, reason: e.message });
            continue;
        }

        if (verdict.action !== 'quarantine') {
            result.skipped.push({ file, modId: verdict.modId, reason: verdict.desc });
            continue;
        }

        const target = path.join(quarantineDir, file);
        const record = {
            file,
            modId: verdict.modId,
            by: verdict.by,
            desc: verdict.desc,
            loader: verdict.meta.loader,
            target
        };

        if (dryRun) {
            result.quarantined.push(record);
            result.movedCount++;
            continue;
        }

        try {
            fs.ensureDirSync(quarantineDir);
            // 目标已存在时加时间戳后缀，绝不覆盖用户已有的隔离文件
            let finalTarget = target;
            if (fs.existsSync(finalTarget)) {
                const ext = path.extname(file);
                const base = path.basename(file, ext);
                finalTarget = path.join(quarantineDir, `${base}.${Date.now()}${ext}`);
                record.target = finalTarget;
            }
            fs.moveSync(full, finalTarget, { overwrite: false });
            result.quarantined.push(record);
            result.movedCount++;
            log('info', `已隔离客户端专用模组: ${file}（${verdict.modId || '?'}，${verdict.desc}）`);
        } catch (e) {
            result.errors.push({ file, reason: `移动失败：${e.message}` });
            log('warn', `隔离 ${file} 失败: ${e.message}`);
        }
    }

    return result;
}

/**
 * 组装一份可直接打印的中文摘要（供 CLI / 启动日志复用）。
 * @param {object} result scanAndQuarantine 的返回值
 * @param {boolean} dryRun
 */
function formatSummary(result, dryRun = false) {
    const lines = [];
    if (!result || result.movedCount === 0) return lines;
    const verb = dryRun ? '将会隔离' : '已隔离';
    lines.push(`🧹 ${verb} ${result.movedCount} 个客户端专用模组（原文件保留在 ${QUARANTINE_DIRNAME}/）`);
    for (const q of result.quarantined) {
        const id = q.modId ? `[${q.modId}] ` : '';
        lines.push(`   - ${id}${q.file}`);
        if (q.desc) lines.push(`     ${q.desc}`);
    }
    if (!dryRun) {
        lines.push(`   如需恢复，直接把这些 jar 从 ${QUARANTINE_DIRNAME}/ 挪回 mods/ 即可。`);
    }
    return lines;
}

module.exports = {
    QUARANTINE_DIRNAME,
    MAX_META_BYTES,
    BUILTIN_CLIENT_MODS,
    isBuiltinClientMod,
    buildClientModSet,
    parseModsToml,
    readModMeta,
    judgeJar,
    loaderSupportsMods,
    scanAndQuarantine,
    formatSummary
};
