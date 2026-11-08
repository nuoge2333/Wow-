/**
 * 客户端一键克隆为方案（V3）
 * ----------------------------------------------------------------
 * 规则一句话：**产物是方案，不是目录。**
 *
 * 与「把 .minecraft 复制一份」的根本区别：
 *   1. 先建方案骨架（走 scheme create 同一套目录 / scheme.yaml 逻辑），再往里面填内容；
 *   2. 核心走方案的「核心装配流程」（installer 模块），不是调 wow install 命令；
 *   3. 结束时入池登记、状态转 full —— 之后 scheme list / switch / server start 全套可用。
 *
 * 九步流水线（对应需求里的第 0~8 步）：
 *   0. 定位实例      resolveInstance()
 *   1. 建骨架        createSkeleton()
 *   2. 白名单复制    copyWhitelisted()
 *   3. 核心装配      installCore()
 *   4. 存档迁移      migrateWorld()
 *   5. 模组清洗      cleanMods()
 *   6. 平台兜底      fillPlatformDefaults()
 *   7. 入池登记      registerToPool()
 *   8. 报告          buildReport()
 *
 * 三条硬约束（写死在代码里，不是文档里的口头约定）：
 *   - **不出现 wow install 命令**：核心一律走 installer.install()；
 *   - **不自动删除任何文件**：只复制、移动、生成。客户端 jar 用「改名 .client-jar.bak」处理，
 *     源码目录里的任何东西都原样留着；
 *   - **关键步骤失败即回滚**：第 2~3 步出错删除刚建的 scheme/<name>/，不留半残方案。
 *
 * 只依赖 Node 标准库 + 项目已有的 fs-extra / adm-zip / yaml。
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const yaml = require('js-yaml');
const AdmZip = require('adm-zip');

const utils = require('./utils');
const config = require('./config');
const { logger } = require('./log');

// ==================== 常量 ====================

/**
 * 直接剔除的条目（一级判断，命中即整棵子树跳过）。
 * 注意 saves/ 不在这里 —— 它由第 4 步单独处理，需要用户先选存档。
 */
const EXCLUDE_NAMES = new Set([
    // 客户端运行数据
    'assets', 'libraries', 'versions',
    'logs', 'crash-reports', '.cache',
    // 客户端资源
    'resourcepacks', 'shaderpacks', 'texturepacks', 'screenshots',
    // 客户端状态文件
    'options.txt', 'optionsof.txt', 'optionsshaders.txt',
    'usercache.json', 'usernamecache.json', 'servers.dat', 'realms_persistence.json'
]);

/** 必须保留的目录（不在 EXCLUDE_NAMES 里也显式列出，便于阅读与后续扩展） */
const KEEP_DIRS = new Set([
    'mods', 'config', 'defaultconfigs',
    'kubejs', 'scripts', 'datapacks'
]);

/**
 * 复制失败时「必须中止」的关键路径判定。
 * 口径按需求原文：level.dat、mods/*.jar、config/ 下任意文件。
 */
function isCriticalPath(relPath) {
    const rel = relPath.split(path.sep).join('/');
    if (rel === 'world/level.dat') return true;
    if (rel.startsWith('mods/') && /\.jar$/i.test(rel)) return true;
    // config/ 下的任意文件（含 config/ 直属文件）
    if (/^config\//.test(rel)) return true;
    return false;
}

// ==================== 交互句柄 ====================

/**
 * 交互上下文。默认「非交互」：所有提问都返回预设的默认答案，
 * 这样测试与「全部用默认值」的批处理都能跑，不需要真的挂在 TTY 上。
 */
function makeSilentIO(answers = {}) {
    const asked = [];
    return {
        asked,
        interactive: false,
        async ask(question, defaultValue = '') {
            asked.push({ question, defaultValue });
            return defaultValue;
        },
        async choose(question, options, defaultIndex = 0) {
            asked.push({ question, options, defaultIndex });
            return options[defaultIndex];
        },
        log(msg) { console.log(msg); },
        warn(msg) { console.warn(msg); }
    };
}

/** 真实终端交互（仅在 TTY 且用户没给 --yes 时使用） */
function makeTerminalIO() {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return {
        interactive: true,
        _rl: rl,
        ask(question, defaultValue = '') {
            return new Promise(resolve => {
                rl.question(question, ans => {
                    const v = String(ans || '').trim();
                    resolve(v === '' ? defaultValue : v);
                });
            });
        },
        /** options 为 [{label, value}]，返回选中的 value */
        choose(question, options, defaultIndex = 0) {
            return new Promise(resolve => {
                console.log(question);
                options.forEach((o, i) => {
                    const mark = i === defaultIndex ? '（默认）' : '';
                    console.log(`   ${i + 1}) ${o.label}${mark}`);
                });
                rl.question(`请输入编号 (默认: ${defaultIndex + 1}): `, ans => {
                    const n = parseInt(String(ans).trim(), 10);
                    if (isNaN(n) || n < 1 || n > options.length) return resolve(options[defaultIndex].value);
                    resolve(options[n - 1].value);
                });
            });
        },
        log(msg) { console.log(msg); },
        warn(msg) { console.warn(msg); },
        close() { try { rl.close(); } catch (e) {} }
    };
}

// ==================== 第 0 步：定位实例 ====================

/**
 * 展开用户输入的路径：~、~/、去转义、去引号、去尾部斜杠。
 * 终端拖拽文件常见的两种脏数据：
 *   macOS 会把空格转成 `\ `，Linux 文件管理器有时会带上 `file://`
 */
function expandPath(raw) {
    let p = String(raw == null ? '' : raw).trim();
    if (!p) return '';
    // 去掉包裹的引号
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
        p = p.slice(1, -1);
    }
    // file:// 前缀
    if (/^file:\/\//i.test(p)) {
        try { p = decodeURIComponent(p.replace(/^file:\/\//i, '')); } catch (e) { p = p.replace(/^file:\/\//i, ''); }
    }
    // 终端转义：`\ ` → 空格，`\(` → `(` 等
    p = p.replace(/\\(.)/g, '$1');
    // ~ 展开
    if (p === '~') p = os.homedir();
    else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
    // Windows 盘符路径在 Linux 上没法解析，原样返回让上层报错
    return path.normalize(p);
}

/**
 * 读一个 versions/<实例>/ 目录，识别加载器与 MC 版本。
 * @returns {{ok:boolean, reason?:string, mcVersion:string, loader:string, loaderVersion:string,
 *            type:string, guessed:boolean, versionJsonPath:string|null}}
 */
function detectInstanceMeta(instanceDir) {
    const instName = path.basename(instanceDir);
    const jsonPath = path.join(instanceDir, `${instName}.json`);
    const empty = { mcVersion: '', loader: '', loaderVersion: '', type: '', guessed: false, versionJsonPath: null };

    if (!fs.existsSync(jsonPath)) {
        // 没有版本 json：回退读 mods/ 里第一个 jar 的元数据
        const guess = guessFromMods(path.join(instanceDir, 'mods'));
        if (guess) {
            return { ok: true, ...guess, guessed: true, versionJsonPath: null };
        }
        return { ok: false, reason: `未找到版本描述文件 ${instName}.json，且 mods/ 里没有可识别的模组`, ...empty };
    }

    let json;
    try {
        json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
        const guess = guessFromMods(path.join(instanceDir, 'mods'));
        if (guess) return { ok: true, ...guess, guessed: true, versionJsonPath: jsonPath };
        return { ok: false, reason: `版本描述文件解析失败（${e.message}）`, ...empty };
    }

    const inheritsFrom = json.inheritsFrom || '';
    const mainClass = String(json.mainClass || '');
    const id = String(json.id || instName);

    // ---- 加载器识别 ----
    let loader = '';
    let loaderVersion = '';
    let type = '';

    const lc = mainClass.toLowerCase();
    if (lc.includes('net.fabricmc') || lc.includes('fabricmc')) {
        loader = 'fabric'; type = 'fabric';
    } else if (lc.includes('quiltmc') || lc.includes('org.quiltmc')) {
        loader = 'quilt'; type = 'quilt';
    } else if (lc.includes('neoforge') || lc.includes('net.neoforged')) {
        loader = 'neoforge'; type = 'neoforge';
    } else if (lc.includes('forge') || lc.includes('minecraftforge')) {
        loader = 'forge'; type = 'forge';
    } else if (lc.includes('bukkit') || lc.includes('craftbukkit')) {
        loader = 'paper'; type = 'paper';
    }

    // mainClass 认不出来时，看 libraries 里挂了哪个加载器
    if (!loader && Array.isArray(json.libraries)) {
        for (const lib of json.libraries) {
            const n = String((lib && lib.name) || '');
            if (n.includes('net.fabricmc:fabric-loader')) { loader = 'fabric'; type = 'fabric'; }
            else if (n.includes('org.quiltmc:quilt-loader')) { loader = 'quilt'; type = 'quilt'; }
            else if (n.includes('net.neoforged.fancymodloader') || n.includes('net.neoforged:neoforge')) { loader = 'neoforge'; type = 'neoforge'; }
            else if (n.includes('net.minecraftforge:forge') || n.includes('net.minecraftforge:fmlloader')) { loader = 'forge'; type = 'forge'; }
            if (loader) break;
        }
    }

    // 现代 Forge / NeoForge 的 mainClass 是 cpw.mods.bootstraplauncher.BootstrapLauncher，
    // 名字里不含 "forge"；libraries 里也可能只有 fmlcore/mclanguageproviders 之类的分包。
    // 真正可靠的信号是启动参数里的 launchTarget / fml.forgeVersion。
    if (!loader) {
        const gameArgs = Array.isArray(json.arguments && json.arguments.game) ? json.arguments.game : [];
        const argStr = gameArgs.join(' ');
        if (/--fml\.neoForgeVersion|--launchTarget\s+neoforge/i.test(argStr)) {
            loader = 'neoforge'; type = 'neoforge';
        } else if (/--fml\.forgeVersion|--launchTarget\s+forge/i.test(argStr)) {
            loader = 'forge'; type = 'forge';
        } else if (/net\.minecraftforge|cpw\.mods\.modlauncher/i.test(argStr)) {
            loader = 'forge'; type = 'forge';
        }
    }

    // 最后一道：从实例名里看（1.20.1-forge-47.2.0 / 1.20.1-Forge_47.2.0）
    if (!loader) {
        const n = instName.toLowerCase();
        if (/neoforge/.test(n)) { loader = 'neoforge'; type = 'neoforge'; }
        else if (/[-_]forge[-_ ]?\d/.test(n) || /forge-\d/.test(n)) { loader = 'forge'; type = 'forge'; }
        else if (/fabric/.test(n)) { loader = 'fabric'; type = 'fabric'; }
        else if (/quilt/.test(n)) { loader = 'quilt'; type = 'quilt'; }
    }

    if (!loader) {
        // 加载器未知 → 按「无加载器」处理，第 1 步会要求用户手动指定
        loader = '';
        type = '';
    }

    // ---- 加载器版本号 ----
    // fabric-loader:x.y.z / neoforge:21.1.80 / forge:1.20.1-47.2.0 / quilt-loader:x.y.z
    if (Array.isArray(json.libraries)) {
        for (const lib of json.libraries) {
            const n = String((lib && lib.name) || '');
            const m = n.match(/^(net\.fabricmc:fabric-loader|org\.quiltmc:quilt-loader|net\.neoforged:neoforge|net\.minecraftforge:forge):([^:]+)/);
            if (m) {
                loaderVersion = m[2];
                // forge 的版本形如 1.20.1-47.2.0，取后半段
                if (m[1].includes('minecraftforge') && loaderVersion.includes('-')) {
                    loaderVersion = loaderVersion.split('-').pop();
                }
                break;
            }
        }
    }
    // Forge 的 arguments 里常带 --fml.forgeVersion
    if (!loaderVersion && Array.isArray(json.arguments && json.arguments.game)) {
        const args = json.arguments.game;
        for (let i = 0; i < args.length - 1; i++) {
            if (args[i] === '--fml.forgeVersion' || args[i] === '--fml.neoForgeVersion') {
                loaderVersion = String(args[i + 1]);
                break;
            }
        }
    }
    // 最后兜底：从实例目录名里抠，如 1.20.1-forge-47.2.0 / 1.20.1-Forge_47.2.0
    if (!loaderVersion) {
        const m = instName.match(/(\d+\.\d+(?:\.\d+)?)(?:-|_)?(?:forge|Forge|fabric|Fabric|neoforge|NeoForge|quilt|Quilt)[-_ ]?(\d[\w.\-+]*)/);
        if (m) loaderVersion = m[2];
    }

    // ---- MC 版本 ----
    let mcVersion = inheritsFrom;
    if (!mcVersion) {
        // 没有 inheritsFrom：从 id 或目录名里抠 1.xx.x
        const m = (id + ' ' + instName).match(/\b(1\.\d+(?:\.\d+)?)\b/);
        if (m) mcVersion = m[1];
    }

    if (!mcVersion) {
        return { ok: false, reason: '无法从版本描述文件里识别 Minecraft 版本（缺 inheritsFrom）', ...empty, versionJsonPath: jsonPath };
    }

    return {
        ok: true,
        mcVersion,
        loader,
        loaderVersion,
        type: type || (loader ? loader : 'vanilla'),
        guessed: false,
        versionJsonPath: jsonPath,
        mainClass,
        inheritsFrom
    };
}

/**
 * 兜底：从 mods/ 里第一个能读出元数据的 jar 推测加载器。
 * 只能猜出加载器，猜不出 MC 版本 —— 所以调用方要标注「版本基于模组元数据推测」。
 */
function guessFromMods(modsDir) {
    if (!fs.existsSync(modsDir)) return null;
    let files;
    try {
        files = fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)).sort().slice(0, 5);
    } catch (e) { return null; }

    for (const f of files) {
        try {
            const zip = new AdmZip(path.join(modsDir, f));
            const names = zip.getEntries().map(e => String(e.entryName).toLowerCase());
            if (names.includes('fabric.mod.json')) {
                let mc = '';
                try {
                    const j = JSON.parse(zip.getEntry('fabric.mod.json').getData().toString('utf8'));
                    mc = (j.depends && j.depends.minecraft) || (j.depends && j.depends['minecraft']) || '';
                    if (typeof mc !== 'string') mc = '';
                } catch (e) {}
                return { mcVersion: mc, loader: 'fabric', loaderVersion: '', type: 'fabric' };
            }
            if (names.includes('meta-inf/mods.toml') || names.includes('meta-inf/neoforge.mods.toml')) {
                const isNeo = names.includes('meta-inf/neoforge.mods.toml');
                return { mcVersion: '', loader: isNeo ? 'neoforge' : 'forge', loaderVersion: '', type: isNeo ? 'neoforge' : 'forge' };
            }
            if (names.includes('quilt.mod.json')) {
                return { mcVersion: '', loader: 'quilt', loaderVersion: '', type: 'quilt' };
            }
        } catch (e) { /* 读不了就试下一个 */ }
    }
    return null;
}

/**
 * 第 0 步：把用户给的任意路径解析成「一个具体的实例目录」。
 *
 * 判定顺序（严格按需求）：
 *   含 versions/ 子目录      → 游戏根目录，列实例让用户选
 *   本身是 versions/<实例>   → 实例目录，直接用
 *   含 mods/ 或 config/ 但没有 versions/ → 疑似实例，提示确认
 *   都不是                   → 向上找最多 2 级，重复判断
 *
 * @param {string} rawPath
 * @param {object} io
 * @returns {Promise<{ok:boolean, reason?:string, instanceDir?:string, rootDir?:string, isolated?:boolean}>}
 */
async function resolveInstance(rawPath, io = makeSilentIO()) {
    const p = expandPath(rawPath);
    if (!p) return { ok: false, reason: '路径为空' };
    if (!fs.existsSync(p)) return { ok: false, reason: `路径不存在: ${p}` };
    if (!fs.statSync(p).isDirectory()) return { ok: false, reason: `不是目录: ${p}` };

    // 直接判定一次
    let hit = await judgePath(p, io);
    if (hit) return hit;

    // 向上找最多 2 级
    let cur = p;
    for (let i = 1; i <= 2; i++) {
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
        hit = await judgePath(cur, io);
        if (hit) return hit;
    }

    return { ok: false, reason: '这里不像 Minecraft 实例目录（没找到 versions/、mods/ 或 config/）' };
}

/**
 * 对单个目录做一次判定。
 * @returns {Promise<object|null>} null = 这个目录不是候选，交给上层继续往上找
 */
async function judgePath(dir, io) {
    const base = path.basename(dir);
    const parentBase = path.basename(path.dirname(dir));

    // 形态 1：版本隔离的实例目录 versions/<实例>/
    if (parentBase === 'versions') {
        return { ok: true, instanceDir: dir, rootDir: path.dirname(path.dirname(dir)), isolated: true };
    }

    // 形态 2：游戏根目录（含 versions/）
    const versionsDir = path.join(dir, 'versions');
    if (fs.existsSync(versionsDir) && fs.statSync(versionsDir).isDirectory()) {
        const instances = listInstances(versionsDir);
        if (instances.length === 0) {
            return { ok: false, reason: `${versionsDir} 里没有任何实例` };
        }
        if (instances.length === 1) {
            return { ok: true, instanceDir: instances[0].dir, rootDir: dir, isolated: true };
        }
        const chosen = await io.choose(
            `找到 ${instances.length} 个客户端实例，请选择要克隆的一个：`,
            instances.map(i => ({ label: i.name, value: i.dir })),
            0
        );
        return { ok: true, instanceDir: chosen, rootDir: dir, isolated: true };
    }

    // 形态 3：含 mods/ 或 config/，但没有 versions/ —— 疑似「未开版本隔离」的实例
    const hasMods = fs.existsSync(path.join(dir, 'mods')) && fs.statSync(path.join(dir, 'mods')).isDirectory();
    const hasConfig = fs.existsSync(path.join(dir, 'config')) && fs.statSync(path.join(dir, 'config')).isDirectory();
    if (hasMods || hasConfig) {
        const hasRootMods = hasMods;
        const msg = hasRootMods
            ? `⚠️ 该目录没有 versions/，但如果它就是 .minecraft 根目录，说明未启用版本隔离。\n` +
              `   继续将把根目录下所有模组视为该整合包的一部分。`
            : `⚠️ 该目录没有 versions/，按「未开版本隔离的实例」处理。`;
        io.warn(msg);
        if (io.interactive) {
            const ans = await io.ask('确认继续？(y/N): ', 'n');
            if (!/^y(es)?$/i.test(String(ans).trim())) {
                return { ok: false, reason: '用户取消' };
            }
        }
        return { ok: true, instanceDir: dir, rootDir: dir, isolated: false };
    }

    return null;
}

/** 列出 versions/ 下的所有实例（目录 + 同名 json） */
function listInstances(versionsDir) {
    const out = [];
    let entries = [];
    try { entries = fs.readdirSync(versionsDir); } catch (e) { return out; }
    for (const name of entries.sort()) {
        const dir = path.join(versionsDir, name);
        try {
            if (!fs.statSync(dir).isDirectory()) continue;
        } catch (e) { continue; }
        let size = 0;
        try { size = fs.statSync(path.join(dir, `${name}.json`)).size; } catch (e) { size = 0; }
        out.push({ name, dir, hasJson: size > 0 });
    }
    return out;
}

// ==================== 方案名校验 ====================

/**
 * 校验方案名。规则与 scheme create 一致：
 * 不含路径分隔符、不含 Windows 保留字符、非空、不以点结尾。
 */
function validateSchemeName(name) {
    const n = String(name == null ? '' : name).trim();
    if (!n) return { ok: false, reason: '方案名不能为空' };
    if (n.length > 64) return { ok: false, reason: '方案名过长（最多 64 字符）' };
    if (/[\\/:*?"<>|]/.test(n)) return { ok: false, reason: '方案名不能包含 \\ / : * ? " < > |' };
    if (/[\x00-\x1f]/.test(n)) return { ok: false, reason: '方案名不能包含控制字符' };
    if (n.startsWith('.')) return { ok: false, reason: '方案名不能以点开头' };
    if (/[. ]$/.test(n)) return { ok: false, reason: '方案名不能以点或空格结尾' };
    // Windows 保留名
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) {
        return { ok: false, reason: `「${n}」是 Windows 保留名` };
    }
    return { ok: true, value: n };
}

// ==================== 第 1 步：建方案骨架 ====================

/**
 * 建一个空壳方案：目录 + scheme.yaml（state: partial）+ 基础子目录。
 *
 * 刻意不调用 scheme.create()：那个方法会立刻去下载核心，而本流程的核心装配
 * 在第 3 步单独做（且需要先复制模组、处理存档）。但目录结构、scheme.yaml 字段、
 * 默认文件生成全部复用 SchemeManager 的方法，保证产物与 create() 一致。
 *
 * @param {object} opts
 *   name, mcVersion, loader, type, sourcePath, schemeManager
 * @returns {{ok:boolean, reason?:string, schemePath?:string, meta?:object}}
 */
function createSkeleton(opts = {}) {
    const { name, mcVersion, loader, type, sourcePath } = opts;
    const sm = opts.schemeManager;

    const check = validateSchemeName(name);
    if (!check.ok) return { ok: false, reason: check.reason };

    if (sm._schemeExists(name)) {
        return { ok: false, reason: `方案 ${name} 已存在，请换一个名字（wow scheme list 可查看）` };
    }
    if (fs.existsSync(sm._getSchemePath(name))) {
        return { ok: false, reason: `目录 scheme/${name} 已存在但没有 scheme.yaml，请先手动处理` };
    }

    const schemePath = sm._getSchemePath(name);
    const created = [];
    try {
        fs.ensureDirSync(schemePath);
        created.push(schemePath);
        for (const sub of ['mods', 'config', 'logs', 'world', 'plugins']) {
            fs.ensureDirSync(path.join(schemePath, sub));
        }

        const now = new Date().toISOString();
        const meta = {
            name,
            version: mcVersion,
            loader: loader || type || 'vanilla',
            type: type || loader || 'vanilla',
            build: null,
            state: 'partial',
            source: opts.source || 'clone-client',
            source_path: sourcePath || null,
            created_at: now,
            updated_at: now,
            compatibility: {
                java: sm._getRequiredJava(mcVersion),
                loaders: [loader || type || 'vanilla']
            },
            resources: {
                core: { file: null, hash: null, in_pool: false, pool_path: null },
                mods: [],
                plugins: []
            },
            unique_resources: [],
            world: { exists: false, size: 0 },
            clone_report: null
        };
        sm._saveSchemeMeta(name, meta);
        return { ok: true, schemePath, meta };
    } catch (e) {
        // 建骨架本身失败也要清干净
        try { if (fs.existsSync(schemePath)) fs.removeSync(schemePath); } catch (e2) {}
        return { ok: false, reason: `创建方案目录失败: ${e.message}` };
    }
}

// ==================== 第 2 步：白名单复制 ====================

/**
 * 递归复制，按 EXCLUDE_NAMES 剔除。
 *
 * @param {object} opts
 *   srcDir, destDir, io
 * @returns {{copied:number, skipped:Array, failed:Array, critical:Array, bytes:number}}
 */
function copyWhitelisted(opts = {}) {
    const { srcDir, destDir } = opts;
    const io = opts.io || makeSilentIO();
    // 额外剔除名单（如客户端版本 jar：服务端用不到，常见于只读实例目录）
    const extraExclude = opts.excludeNames instanceof Set ? opts.excludeNames : new Set();
    // 目标根目录：若它在复制源内部（用户把方案库放在客户端目录下），必须跳过，
    // 否则会「复制自己正在写的目录」→ 无限递归直到 ENAMETOOLONG。
    const destRoot = opts.destRoot ? path.resolve(opts.destRoot) : null;
    const result = { copied: 0, skipped: [], failed: [], critical: [], bytes: 0 };

    if (!fs.existsSync(srcDir)) return result;

    let entries = [];
    try {
        entries = fs.readdirSync(srcDir).sort();
    } catch (e) {
        result.failed.push({ path: '.', reason: e.message });
        return result;
    }

    for (const name of entries) {
        const srcPath = path.join(srcDir, name);
        const destPath = path.join(destDir, name);

        // 剔除以「本级名字」判断，因此 mods/assets 这类整棵子树一起跳过
        if (EXCLUDE_NAMES.has(name)) {
            result.skipped.push({ path: name, reason: '按剔除规则跳过' });
            continue;
        }
        if (extraExclude.has(name)) {
            result.skipped.push({ path: name, reason: '客户端版本文件，服务端不需要' });
            continue;
        }
        if (destRoot && path.resolve(srcPath) === destRoot) {
            result.skipped.push({ path: name, reason: '目标目录，跳过以免递归复制' });
            continue;
        }
        // saves/ 留给第 4 步
        if (name === 'saves') continue;

        let stat;
        try { stat = fs.statSync(srcPath); } catch (e) {
            result.failed.push({ path: name, reason: e.message });
            continue;
        }

        if (stat.isDirectory()) {
            fs.ensureDirSync(destPath);
            const sub = copyWhitelisted({ srcDir: srcPath, destDir: destPath, io, excludeNames: extraExclude, destRoot });
            result.copied += sub.copied;
            result.bytes += sub.bytes;
            // 子层路径统一加前缀，便于报告里定位
            const addPrefix = (arr, kind) => {
                for (const item of sub[kind]) {
                    result[kind].push({ ...item, path: path.join(name, item.path) });
                }
            };
            addPrefix(result.skipped, 'skipped');
            addPrefix(result.failed, 'failed');
            addPrefix(result.critical, 'critical');
            continue;
        }

        if (!stat.isFile()) {
            result.skipped.push({ path: name, reason: '不是普通文件（符号链接 / 设备）' });
            continue;
        }

        // 单文件复制
        try {
            fs.ensureDirSync(path.dirname(destPath));
            fs.copySync(srcPath, destPath, { overwrite: false, errorOnExist: false });
            result.copied++;
            result.bytes += stat.size;
        } catch (e) {
            const entry = { path: name, reason: e.message };
            if (isCriticalPath(name) || isCriticalPath(destPath)) {
                result.critical.push(entry);
                result.failed.push(entry);
            } else {
                result.failed.push(entry);
                io.warn(`   ⚠️ 复制失败（继续）: ${entry.path} —— ${entry.reason}`);
            }
        }
    }

    return result;
}

// ==================== 第 3 步：核心装配 ====================

/**
 * 从方案目录里找出「客户端残留的核心」并改名留档。
 *
 * 为什么不删：需求总则「不自动删除任何文件」。客户端塞进来的 <实例名>.jar
 * 如果留在根目录，server._getServerJar() 可能把它误认成服务端核心，
 * 于是改名成 <name>.jar.client-jar.bak 既消除了干扰，又留了后路。
 *
 * @returns {Array<{file:string, renamedTo:string}>}
 */
function renameClientJars(schemePath, instanceName) {
    const out = [];
    if (!instanceName) return out;
    const target = path.join(schemePath, `${instanceName}.jar`);
    if (!fs.existsSync(target)) return out;
    const renamed = path.join(schemePath, `${instanceName}.jar.client-jar.bak`);
    try {
        fs.moveSync(target, renamed, { overwrite: false });
        out.push({ file: `${instanceName}.jar`, renamedTo: path.basename(renamed) });
    } catch (e) {
        /* 改名失败不致命：核心装配成功后 _getServerJar 会优先认新核心 */
    }
    return out;
}

/**
 * 第 3 步：走 installer 模块装配服务端核心（与 scheme create 同一套逻辑）。
 *
 * @param {object} opts
 *   schemePath, type, mcVersion, loaderVersion, instanceName, installer
 * @returns {Promise<{ok:boolean, reason?:string, corePath?:string, coreRel?:string, renamed?:Array}>}
 */
async function installCore(opts = {}) {
    const { schemePath, type, mcVersion, loaderVersion, instanceName } = opts;
    const installer = opts.installer;
    if (!installer) return { ok: false, reason: '内部错误：未提供 installer' };

    const renamed = renameClientJars(schemePath, instanceName);

    // V3.6.2：创建方案统一「优先找 pool」——池里已有同 type/version 的单文件核心
    // 就直接复用，不再下载。安装器型（forge 等）由该方法内部拒绝，仍走安装器。
    if (opts.schemeManager && typeof opts.schemeManager.materializePoolCore === 'function') {
        const pooled = opts.schemeManager.materializePoolCore(type, mcVersion, schemePath);
        if (pooled) {
            console.log(`♻️  复用 pool 中的核心: ${pooled.coreRel}，跳过下载`);
            return { ok: true, corePath: pooled.corePath, coreRel: pooled.coreRel, reused: true, renamed };
        }
    }

    let corePath;
    try {
        // 与 SchemeManager.create() 完全同一条路径：
        //   - vanilla / paper / ... → 直连下载
        //   - forge / neoforge / fabric / quilt → _installModLoader 跑官方安装器
        corePath = await installer.install(type, mcVersion, loaderVersion || null, schemePath);
    } catch (e) {
        return { ok: false, reason: e.message, renamed };
    }

    if (!corePath || !fs.existsSync(corePath)) {
        return { ok: false, reason: '核心装配流程未产出可用的核心文件', renamed };
    }

    const coreRel = path.relative(schemePath, corePath).split(path.sep).join('/');
    return { ok: true, corePath, coreRel, renamed };
}

// ==================== 第 4 步：存档迁移 ====================

/** 列出客户端存档（只认含 level.dat 的目录） */
function listSaves(savesDir) {
    const out = [];
    if (!fs.existsSync(savesDir)) return out;
    let entries = [];
    try { entries = fs.readdirSync(savesDir); } catch (e) { return out; }
    for (const name of entries.sort()) {
        const dir = path.join(savesDir, name);
        try {
            if (!fs.statSync(dir).isDirectory()) continue;
        } catch (e) { continue; }
        const levelDat = path.join(dir, 'level.dat');
        if (!fs.existsSync(levelDat)) continue;
        let size = 0;
        try { size = fs.statSync(levelDat).size; } catch (e) {}
        out.push({ name, dir, hasLevelDat: true, levelDatSize: size });
    }
    return out;
}

/**
 * 第 4 步：把一个存档搬进 world/。
 *
 * @param {object} opts
 *   savesDir, worldDir, saveName('' = 不迁移)
 * @returns {{ok:boolean, reason?:string, migrated:boolean, saveName?:string, copied:number, sessionLockRemoved:boolean}}
 */
function migrateWorld(opts = {}) {
    const { savesDir, worldDir, saveName } = opts;
    const out = { ok: true, migrated: false, copied: 0, sessionLockRemoved: false };

    if (!saveName) return out;

    const src = path.join(savesDir, saveName);
    if (!fs.existsSync(src)) return { ok: false, reason: `存档不存在: ${src}`, migrated: false, copied: 0, sessionLockRemoved: false };

    // world/ 是骨架里建好的空目录；如果已经有内容（比如客户端根目录里自带 world/），
    // 先把它挪到 world.pre-clone.bak 留档，而不是删除或覆盖。
    if (fs.existsSync(worldDir)) {
        let hasContent = false;
        try { hasContent = fs.readdirSync(worldDir).length > 0; } catch (e) {}
        if (hasContent) {
            const bak = path.join(path.dirname(worldDir), `world.pre-clone-${Date.now()}.bak`);
            try { fs.moveSync(worldDir, bak, { overwrite: false }); } catch (e) {
                return { ok: false, reason: `已有 world/ 无法挪开: ${e.message}`, migrated: false, copied: 0, sessionLockRemoved: false };
            }
        }
    }
    fs.ensureDirSync(worldDir);

    let copied = 0;
    try {
        copied = copyTree(src, worldDir);
    } catch (e) {
        return { ok: false, reason: `存档复制失败: ${e.message}`, migrated: false, copied, sessionLockRemoved: false };
    }

    // session.lock 是单机客户端运行时锁，服务端启动会自己重建，
    // 带着它进去会让服务端直接报「世界已被锁定」。
    const lock = path.join(worldDir, 'session.lock');
    let removed = false;
    if (fs.existsSync(lock)) {
        try { fs.removeSync(lock); removed = true; } catch (e) {}
    }

    return { ok: true, migrated: true, saveName, copied, sessionLockRemoved: removed };
}

/** 递归复制整棵树，返回复制的文件数 */
function copyTree(src, dest) {
    let n = 0;
    fs.ensureDirSync(dest);
    for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name);
        const d = path.join(dest, name);
        const st = fs.statSync(s);
        if (st.isDirectory()) {
            n += copyTree(s, d);
        } else if (st.isFile()) {
            fs.copySync(s, d, { overwrite: false, errorOnExist: false });
            n++;
        }
    }
    return n;
}

// ==================== 第 5 步：模组清洗 ====================

/**
 * 读 Forge 的 side 信息。
 *
 * mods.toml 里**没有**全局 `side = "CLIENT"` 这种字段 —— 那是误解。
 * 真实语义是 `[[dependencies.<modid>]]` 段里的 `side="CLIENT"`，表示
 * 「这条依赖只在客户端需要」，并不代表模组本身不能加载。
 * 所以这里不拿它当判定依据，只在报告里作为附带信息。
 * 旧版 Forge 的 mcmod.info 里倒是有真正可靠的 `clientSideOnly: true`。
 *
 * @returns {{clientSideOnly:boolean, side:'CLIENT'|'BOTH'|'', note:string}}
 */
function readForgeSide(jarPath) {
    let zip;
    try { zip = new AdmZip(jarPath); } catch (e) {
        return { clientSideOnly: false, side: '', note: '无法打开 jar' };
    }

    const find = (n) => {
        const t = n.toLowerCase();
        return zip.getEntries().find(e => String(e.entryName).toLowerCase() === t) || null;
    };

    const readText = (entry) => {
        try {
            const size = entry.header && entry.header.size ? entry.header.size : 0;
            if (size > 256 * 1024) return null;
            return entry.getData().toString('utf8');
        } catch (e) { return null; }
    };

    // 1) 老 Forge / 部分现代模组仍带的 mcmod.info：clientSideOnly 是可靠的
    const infoEntry = find('mcmod.info');
    if (infoEntry) {
        const text = readText(infoEntry);
        if (text) {
            try {
                let json = JSON.parse(text);
                const arr = Array.isArray(json) ? json : (json && Array.isArray(json.modList) ? json.modList : []);
                if (arr.some(m => m && m.clientSideOnly === true)) {
                    return { clientSideOnly: true, side: 'CLIENT', note: 'mcmod.info 标记 clientSideOnly' };
                }
            } catch (e) { /* 1.12 的 mcmod.info 常不是严格 JSON */ }
        }
    }

    // 2) 现代 Forge：看 [[dependencies]] 的 side，仅作附带信息
    const tomlEntry = find('META-INF/mods.toml') || find('META-INF/neoforge.mods.toml');
    if (tomlEntry) {
        const text = readText(tomlEntry);
        if (text && /^\s*side\s*=\s*["']CLIENT["']/m.test(text)) {
            return { clientSideOnly: false, side: 'CLIENT', note: '依赖段声明 side=CLIENT（不代表模组只能客户端加载）' };
        }
    }

    return { clientSideOnly: false, side: '', note: '' };
}

/**
 * 第 5 步：清洗方案 mods/ 里的客户端模组。
 *
 * 判定优先级（需求原文「元数据为主、内置列表为兜底、用户配置为最高」）：
 *   1. force_keep_mods   用户强制保留 —— 最高优先级，后面的判断全部跳过
 *   2. 元数据铁证        fabric/quilt 的 environment=client 或只有 client entrypoints；
 *                        forge 的 mcmod.info clientSideOnly
 *   3. 内置黑名单        extra_client_mods + 内置表
 *
 * 处理方式：移到方案目录下的 mods-disabled/（需求指定这个名字，与 server.js
 * 启动时用的 mods_client_disabled/ 是两个不同的隔离区，互不影响）。
 *
 * @param {object} opts
 *   modsDir, disabledDir, extraClientMods, forceKeepMods
 * @returns {{scanned:number, disabled:Array, kept:Array, errors:Array}}
 */
function cleanMods(opts = {}) {
    const modsDir = opts.modsDir;
    const disabledDir = opts.disabledDir || path.join(path.dirname(modsDir), 'mods-disabled');
    const extra = new Set((opts.extraClientMods || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));
    const keep = new Set((opts.forceKeepMods || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));

    const out = { scanned: 0, disabled: [], kept: [], errors: [] };
    if (!fs.existsSync(modsDir)) return out;

    // 复用 client_mod_filter 的元数据读取与内置名单，避免两套判定标准漂移
    const cmf = require('./client_mod_filter');

    let jars = [];
    try {
        jars = fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)).sort();
    } catch (e) {
        out.errors.push({ file: '', reason: e.message });
        return out;
    }
    out.scanned = jars.length;

    for (const file of jars) {
        const full = path.join(modsDir, file);
        let meta;
        try {
            meta = cmf.readModMeta(full);
        } catch (e) {
            out.errors.push({ file, reason: e.message });
            continue;
        }

        const ids = meta.ok ? meta.mods.map(m => String(m.modId).toLowerCase()).filter(Boolean) : [];
        const displayId = meta.ok && meta.mods[0] ? meta.mods[0].modId : '';

        // 1) 强制保留
        if (ids.some(id => keep.has(id))) {
            out.kept.push({ file, modId: displayId, reason: 'force_keep_mods 强制保留' });
            continue;
        }

        // 2) 元数据
        let verdict = null;
        if (meta.ok && meta.clientOnly) {
            verdict = { reason: '元数据标记 client' };
        }
        if (!verdict && (meta.loader === 'forge' || meta.loader === 'neoforge')) {
            const side = readForgeSide(full);
            if (side.clientSideOnly) {
                verdict = { reason: `元数据标记 client（${side.note}）` };
            }
        }

        // 3) 名单（用户扩展 + 内置）
        if (!verdict) {
            for (const id of ids) {
                if (extra.has(id)) { verdict = { reason: '用户扩展名单' }; break; }
                if (cmf.isBuiltinClientMod(id)) { verdict = { reason: '内置黑名单' }; break; }
            }
        }

        if (!verdict) {
            out.kept.push({ file, modId: displayId, reason: '' });
            continue;
        }

        // 移动
        try {
            fs.ensureDirSync(disabledDir);
            let target = path.join(disabledDir, file);
            if (fs.existsSync(target)) {
                const ext = path.extname(file);
                target = path.join(disabledDir, `${path.basename(file, ext)}.${Date.now()}${ext}`);
            }
            fs.moveSync(full, target, { overwrite: false });
            out.disabled.push({ file, modId: displayId, reason: verdict.reason, target });
        } catch (e) {
            out.errors.push({ file, reason: `移动失败: ${e.message}` });
        }
    }

    return out;
}

// ==================== 第 6 步：平台兜底 ====================

/**
 * 生成 server.properties / eula.txt / 空目录。
 * 一律「已存在就不动」—— 克隆进来的 config 可能已经包含用户调好的设置。
 */
function fillPlatformDefaults(opts = {}) {
    const { schemePath, mcVersion, type } = opts;
    const sm = opts.schemeManager;
    const out = { properties: false, eula: false, dirs: [] };

    const propsPath = path.join(schemePath, 'server.properties');
    if (!fs.existsSync(propsPath)) {
        // 复用 SchemeManager 的默认模板，再补上克隆场景需要的两个键
        let text = sm._generateDefaultProperties(mcVersion);
        if (!/^level-name=/m.test(text)) text += '\nlevel-name=world\n';
        if (!/^level-type=/m.test(text)) text += 'level-type=minecraft\\:normal\n';
        fs.writeFileSync(propsPath, text, 'utf8');
        out.properties = true;
    }

    const eulaPath = path.join(schemePath, 'eula.txt');
    if (!fs.existsSync(eulaPath)) {
        fs.writeFileSync(
            eulaPath,
            '# By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n' +
            '# Auto-generated by wow~ (clone-client)\n' +
            'eula=true\n',
            'utf8'
        );
        out.eula = true;
    }

    // 按加载器需要的空目录
    const dirs = ['logs'];
    if (['paper', 'purpur', 'spigot', 'bukkit', 'leaves', 'mohist', 'catserver'].includes(String(type).toLowerCase())) {
        dirs.push('plugins');
    }
    for (const d of dirs) {
        const p = path.join(schemePath, d);
        if (!fs.existsSync(p)) {
            fs.ensureDirSync(p);
            out.dirs.push(d);
        }
    }
    return out;
}

// ==================== 第 7 步：入池登记 ====================

/**
 * 把方案目录里的模组与核心登记进 pool，并同步写 scheme.yaml。
 *
 * 语义与 scheme.create() / _materializeScheme() 保持一致：
 *   - 文件复制进 pool，ref_count +1；
 *   - scheme.yaml 里 in_pool = true，表示「池里有备份，瘦身时可以从池里补回」。
 *
 * @returns {Promise<{mods:Array, core:object|null, errors:Array}>}
 */
async function registerToPool(opts = {}) {
    const { schemePath, name, meta, corePath, coreRel, type, mcVersion, loader } = opts;
    const sm = opts.schemeManager;
    const out = { mods: [], core: null, errors: [] };

    // ---- 核心 ----
    if (corePath && fs.existsSync(corePath)) {
        try {
            const hash = sm._computeHash(corePath);
            const rel = coreRel || path.basename(corePath);
            const inPool = sm._isResourceInPool(hash);
            if (!inPool) {
                await sm._addToPool(corePath, 'cores', `${type}/${mcVersion}`, hash, rel);
            } else {
                sm._incrementRefCount(hash);
            }
            meta.resources.core = {
                file: rel,
                hash,
                in_pool: true,
                pool_path: sm._getPoolPathByHash(hash)
            };
            out.core = { file: rel, hash, poolDir: `pool/cores/${type}/${mcVersion}` };
        } catch (e) {
            out.errors.push({ file: path.basename(corePath), reason: `核心入池失败: ${e.message}` });
        }
    }

    // ---- 模组 ----
    const modsDir = path.join(schemePath, 'mods');
    let jars = [];
    try {
        jars = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)).sort() : [];
    } catch (e) {
        out.errors.push({ file: 'mods/', reason: e.message });
    }

    const normLoader = String(loader || type || 'vanilla').toLowerCase();
    for (const file of jars) {
        const full = path.join(modsDir, file);
        try {
            const hash = sm._computeHash(full);
            if (!sm._isResourceInPool(hash)) {
                await sm._addToPool(full, 'mods', `${normLoader}/${mcVersion}`, hash, file);
            } else {
                sm._incrementRefCount(hash);
            }
            const rec = {
                file,
                hash,
                in_pool: true,
                pool_path: sm._getPoolPathByHash(hash),
                mod_name: file.replace(/\.jar$/i, ''),
                version: 'unknown'
            };
            meta.resources.mods.push(rec);
            out.mods.push(rec);
        } catch (e) {
            out.errors.push({ file, reason: `入池失败: ${e.message}` });
        }
    }

    return out;
}

// ==================== 第 8 步：报告 ====================

/**
 * 生成迁移报告（中文，可直接打印）。
 * 需求明确要求：必须列出被禁用的模组名和原因，不能只报数量。
 */
function buildReport(r) {
    const L = [];
    const sep = '─'.repeat(52);
    L.push('');
    L.push('✅ 客户端克隆为方案完成');
    L.push(sep);
    L.push(`   方案名：${r.name}（scheme/${r.name}）`);
    L.push(`   源实例：${r.instanceDir}`);
    if (r.mcVersion || r.loader) {
        const lv = r.loaderVersion ? ` ${r.loaderVersion}` : '';
        L.push(`   加载器：${(r.loader || r.type || 'vanilla')}${lv}（MC ${r.mcVersion || '未知'}）`);
    }
    if (r.guessed) {
        L.push('   ⚠️ 版本信息基于模组元数据推测，可能与实际不符');
    }
    if (r.core) {
        L.push(`   核心：${r.core.file}（已入池，pool/cores/${r.type}/${r.mcVersion}/）`);
    }
    if (r.modStats) {
        const d = r.modStats.disabled.length;
        L.push(`   模组：${r.modStats.copied || r.modStats.scanned} 个已复制并入池` + (d > 0 ? `，${d} 个已禁用（见 mods-disabled/）` : ''));
    }
    if (r.world && r.world.migrated) {
        L.push(`   存档：已迁移「${r.world.saveName}」→ world/` + (r.world.sessionLockRemoved ? '（session.lock 已删除）' : ''));
    } else if (r.world && r.world.skipped) {
        L.push('   存档：未迁移（按你的选择跳过）');
    }
    L.push(`   配置：config/ ${r.configCopied ? '已复制' : '（未找到）'}`);
    L.push(`   方案状态：${r.state || 'full'}`);

    // ---- 被禁用的模组，逐个列出 ----
    if (r.modStats && r.modStats.disabled.length > 0) {
        L.push('');
        L.push(`🧹 已禁用 ${r.modStats.disabled.length} 个仅供客户端使用的模组：`);
        for (const m of r.modStats.disabled) {
            const id = m.modId || m.file.replace(/\.jar$/i, '');
            L.push(`   - ${id}（${m.reason}）`);
        }
        L.push('   已移至 mods-disabled/，如需恢复请手动移回 mods/。');
    }

    // ---- 被强制保留的（让用户知道名单确实生效了） ----
    if (r.modStats && r.modStats.forceKept && r.modStats.forceKept.length > 0) {
        L.push('');
        L.push(`📌 按 force_keep_mods 保留 ${r.modStats.forceKept.length} 个：`);
        for (const m of r.modStats.forceKept) {
            L.push(`   - ${m.modId || m.file}`);
        }
    }

    // ---- 跳过的文件汇总 ----
    if (r.copyStats && r.copyStats.skipped.length > 0) {
        L.push('');
        L.push(`⏭️  按白名单跳过 ${r.copyStats.skipped.length} 项（客户端资源 / 缓存 / 存档等）`);
        const shown = r.copyStats.skipped.slice(0, 8);
        for (const s of shown) L.push(`   - ${s.path}`);
        if (r.copyStats.skipped.length > 8) L.push(`   …… 其余 ${r.copyStats.skipped.length - 8} 项见 docs/CLONE_CLIENT.md`);
    }
    if (r.copyStats && r.copyStats.failed.length > 0) {
        L.push('');
        L.push(`⚠️  复制失败 ${r.copyStats.failed.length} 个文件（已跳过，不影响启动）：`);
        for (const f of r.copyStats.failed.slice(0, 10)) {
            L.push(`   - ${f.path}：${f.reason}`);
        }
        if (r.copyStats.failed.length > 10) L.push(`   …… 其余 ${r.copyStats.failed.length - 10} 个`);
    }
    if (r.poolErrors && r.poolErrors.length > 0) {
        L.push('');
        L.push(`⚠️  入池失败 ${r.poolErrors.length} 个（文件仍在方案目录，不影响启动）：`);
        for (const e of r.poolErrors.slice(0, 10)) L.push(`   - ${e.file}：${e.reason}`);
    }

    // ---- 注意事项 ----
    L.push('');
    L.push('   ⚠️ 注意：');
    L.push('      - 单机玩家数据不会自动转换，首次进服状态可能与单机不同');
    L.push('      - 部分 config/ 可能是客户端专用，如遇异常请检查');
    if (r.modStats && r.modStats.disabled.length > 0) {
        L.push(`      - ${r.modStats.disabled.length} 个模组被禁用，如确认服务端需要请手动移回`);
    }
    L.push('');
    L.push(`   下一步：wow scheme switch ${r.name} && wow server start --memory 4G`);
    L.push(sep);
    return L.join('\n');
}

// ==================== 编排 ====================

/**
 * 完整克隆流程。
 *
 * @param {object} opts
 *   clientPath      用户给的路径
 *   name            方案名（可选，空则交互询问）
 *   typeOverride    手动指定核心类型（识别失败时用）
 *   versionOverride 手动指定 MC 版本
 *   io              交互句柄
 *   dryRun          true = 只做第 0 步与检查，不创建任何东西
 *   extraClientMods / forceKeepMods
 *   saveName        '' = 不迁移存档；undefined = 交互询问
 *   skipCore        true = 不装配核心（仅测试用）
 * @returns {Promise<object>} { ok, reason?, report?, result? }
 */
async function cloneClient(opts = {}) {
    const io = opts.io || makeSilentIO();
    // schemeManager 可注入：测试用临时目录，生产走默认单例。
    // 有了它，测试不必去改 require.cache 那种脏手法。
    const SchemeManager = require('./scheme_manager');
    const injectedSM = opts.schemeManager || null;

    // ---- 第 0 步 ----
    io.log('\n📂 第 0 步：定位客户端实例');
    const resolved = await resolveInstance(opts.clientPath, io);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const instanceDir = resolved.instanceDir;
    io.log(`   实例目录：${instanceDir}`);

    // V3.6.2 修复：版本隔离的客户端，versions/<实例>/ 里只有版本 json 与客户端 jar，
    // 真正的 mods / config / saves 在「游戏根目录」（.minecraft 根）下。
    // 旧实现把复制源固定成 instanceDir，导致「已复制 1 个文件」、模组一个没进方案、
    // 存档也找不到（用户报告：检查文件时根本没有模组）。这里把两者拆开：
    //   instanceDir —— 版本元数据 / 客户端 jar（识别版本、留档用）
    //   gameDir     —— 游戏数据（mods / config / saves 的真实来源）
    const hasGameData = (dir) => {
        if (!dir || !fs.existsSync(dir)) return false;
        return ['mods', 'config', 'saves', 'defaultconfigs', 'kubejs']
            .some(n => fs.existsSync(path.join(dir, n)));
    };
    const gameDir = (resolved.rootDir && resolved.rootDir !== instanceDir &&
        hasGameData(resolved.rootDir)) ? resolved.rootDir : instanceDir;
    if (gameDir !== instanceDir) {
        io.log(`   游戏数据目录：${gameDir}（版本隔离：模组/配置/存档取自游戏根目录）`);
    }

    const det = detectInstanceMeta(instanceDir);
    let mcVersion = opts.versionOverride || det.mcVersion;
    let type = opts.typeOverride || det.type || det.loader;
    let loaderVersion = det.loaderVersion;

    if (!mcVersion && !opts.versionOverride) {
        return {
            ok: false,
            reason: `无法识别 Minecraft 版本，请用 --version 手动指定（例如 --version 1.20.1）`
        };
    }
    if (!type) {
        return {
            ok: false,
            reason: '无法识别加载器，请用 --type 手动指定（vanilla/forge/fabric/neoforge/quilt/paper…）'
        };
    }
    if (det.guessed) {
        io.warn('   ⚠️ 版本信息基于模组元数据推测，可能与实际不符');
    }
    io.log(`   MC ${mcVersion} / ${type}${loaderVersion ? ' ' + loaderVersion : ''}`);

    // ---- 方案名 ----
    let schemeName = opts.name;
    if (!schemeName) {
        const base = path.basename(instanceDir).replace(/[\\/:*?"<>|]/g, '_');
        schemeName = await io.ask(`   方案名 (默认: ${base}): `, base);
    }
    const nameCheck = validateSchemeName(schemeName);
    if (!nameCheck.ok) return { ok: false, reason: `方案名不合法：${nameCheck.reason}` };
    schemeName = nameCheck.value;

    if (opts.dryRun) {
        return {
            ok: true,
            dryRun: true,
            plan: { instanceDir, mcVersion, type, loaderVersion, schemeName, guessed: det.guessed }
        };
    }

    // ---- 第 1 步：建骨架 ----
    io.log('\n📦 第 1 步：创建方案骨架');
    const sm = injectedSM || new SchemeManager();
    const skel = createSkeleton({
        name: schemeName,
        mcVersion,
        loader: det.loader || type,
        type,
        sourcePath: instanceDir,
        schemeManager: sm
    });
    if (!skel.ok) return { ok: false, reason: skel.reason };
    const schemePath = skel.schemePath;
    const meta = skel.meta;
    io.log(`   已创建：scheme/${schemeName}（state: partial）`);

    /** 回滚：删掉刚建的方案目录。所有关键失败都走这里。 */
    const rollback = (why) => {
        try {
            if (fs.existsSync(schemePath)) fs.removeSync(schemePath);
            io.warn(`   ↩️ 已回滚：删除 scheme/${schemeName}`);
        } catch (e) {
            io.warn(`   ⚠️ 回滚失败，请手动删除 scheme/${schemeName}：${e.message}`);
        }
        return { ok: false, reason: why, rolledBack: true };
    };

    try {
        // ---- 第 2 步：白名单复制 ----
        io.log('\n📋 第 2 步：复制客户端内容（白名单）');
        // 客户端版本 jar（<实例名>.jar）是客户端启动用的，服务端不需要；
        // 而且它常常属于另一个用户 / 只读（EACCES），无谓复制只会制造失败噪声。
        const versionJarName = `${path.basename(instanceDir)}.jar`;
        const copyStats = copyWhitelisted({
            srcDir: gameDir,
            destDir: schemePath,
            io,
            destRoot: schemePath,
            excludeNames: new Set([versionJarName, 'launcher_profiles.json', 'launcher_accounts.json',
                'launcher_log.txt', 'launcher_settings.json', 'TLauncherLogs'])
        });
        io.log(`   复制源：${gameDir}`);
        io.log(`   已复制 ${copyStats.copied} 个文件（${(copyStats.bytes / 1024 / 1024).toFixed(1)} MB），跳过 ${copyStats.skipped.length} 项`);
        if (copyStats.copied === 0) {
            io.warn('   ⚠️ 没有复制到任何文件——请确认该目录确实是客户端实例（含 mods / config）。');
        }
        if (copyStats.critical.length > 0) {
            return rollback(
                `关键文件复制失败，已中止：` +
                copyStats.critical.map(c => `${c.path}（${c.reason}）`).join('；')
            );
        }

        // ---- 第 3 步：核心装配 ----
        if (!opts.skipCore) {
            io.log('\n⚙️  第 3 步：装配服务端核心');
            const Installer = require('./installer');
            const inst = new Installer();
            const core = await installCore({
                schemePath,
                type,
                mcVersion,
                loaderVersion,
                instanceName: path.basename(instanceDir),
                installer: inst,
                schemeManager: sm
            });
            if (!core.ok) return rollback(`核心装配失败：${core.reason}`);
            io.log(`   核心：${core.coreRel}`);
            if (core.renamed && core.renamed.length) {
                io.log(`   客户端核心已改名留档：${core.renamed.map(r => r.renamedTo).join(', ')}`);
            }

            // Java 检查（只提示，不自动下载 —— 下载动作交给 server start）
            try {
                const JreManager = require('./jre_manager');
                const jre = new JreManager();
                const need = jre.getRequiredJavaVersion(mcVersion);
                const scanned = utils.scanAllJava();
                const matched = utils.findJavaByMajor(need, scanned);
                if (!matched) {
                    const any = scanned.find(j => j.major != null);
                    io.warn(`   ⚠️ 需要 Java ${need}，当前为 ${any ? 'Java ' + any.major : '未检测到 Java'}`);
                    io.warn(`      可执行 wow jre install ${need} 自动下载，或首次 server start 时自动补齐`);
                } else {
                    io.log(`   Java ${need} 已就绪`);
                }
            } catch (e) { /* Java 检查失败不影响克隆 */ }

            meta._corePath = core.corePath;
            meta._coreRel = core.coreRel;
        }

        // ---- 第 4 步：存档迁移 ----
        io.log('\n🌍 第 4 步：迁移存档');
        // 同样要用游戏数据目录：版本隔离时 saves/ 在 .minecraft 根，不在 versions/<实例>/
        const savesDir = path.join(gameDir, 'saves');
        const saves = listSaves(savesDir);
        let saveName = opts.saveName;
        if (saveName === undefined) {
            if (saves.length === 0) {
                io.log('   客户端没有存档，跳过');
                saveName = '';
            } else if (saves.length === 1) {
                const ans = await io.choose(
                    `   找到 1 个存档「${saves[0].name}」，是否迁移？`,
                    [{ label: '迁移到 world/', value: saves[0].name }, { label: '不迁移存档', value: '' }],
                    0
                );
                saveName = ans;
            } else {
                const choices = saves.map(s => ({ label: s.name, value: s.name }));
                choices.push({ label: '不迁移存档', value: '' });
                saveName = await io.choose('   请选择要迁移的存档：', choices, 0);
            }
        }
        const world = migrateWorld({ savesDir, worldDir: path.join(schemePath, 'world'), saveName });
        if (!world.ok) return rollback(`存档迁移失败：${world.reason}`);
        if (world.migrated) {
            io.log(`   已迁移「${world.saveName}」→ world/（${world.copied} 个文件${world.sessionLockRemoved ? '，session.lock 已删除' : ''}）`);
            meta.world = { exists: true, size: 0 };
        } else {
            io.log('   未迁移存档');
            world.skipped = true;
        }

        // ---- 第 5 步：模组清洗 ----
        io.log('\n🧹 第 5 步：清洗客户端模组');
        const clean = cleanMods({
            modsDir: path.join(schemePath, 'mods'),
            disabledDir: path.join(schemePath, 'mods-disabled'),
            extraClientMods: opts.extraClientMods || [],
            forceKeepMods: opts.forceKeepMods || []
        });
        io.log(`   扫描 ${clean.scanned} 个，禁用 ${clean.disabled.length} 个`);
        for (const m of clean.disabled) {
            io.log(`      - ${m.modId || m.file}（${m.reason}）`);
        }
        for (const e of clean.errors) {
            io.warn(`   ⚠️ ${e.file}：${e.reason}`);
        }

        // ---- 第 6 步：平台兜底 ----
        io.log('\n🔧 第 6 步：生成平台文件');
        const plat = fillPlatformDefaults({ schemePath, mcVersion, type, schemeManager: sm });
        const platBits = [];
        if (plat.properties) platBits.push('server.properties');
        if (plat.eula) platBits.push('eula.txt');
        if (plat.dirs.length) platBits.push(...plat.dirs.map(d => d + '/'));
        io.log(platBits.length ? `   已生成：${platBits.join(', ')}` : '   已存在，无需生成');
        if (plat.eula) {
            io.log('   已写入 eula=true。如不同意 Minecraft EULA，请修改为 false 并删除服务器。');
        }

        // ---- 第 7 步：入池登记 ----
        io.log('\n🗄️  第 7 步：入池登记');
        const pool = await registerToPool({
            schemePath,
            name: schemeName,
            meta,
            corePath: meta._corePath,
            coreRel: meta._coreRel,
            type,
            mcVersion,
            loader: det.loader || type,
            schemeManager: sm
        });
        delete meta._corePath;
        delete meta._coreRel;
        io.log(`   模组入池 ${pool.mods.length} 个${pool.core ? '，核心已入池' : ''}`);

        // ---- 状态更新 ----
        // 需求写的是「state 从 partial 改为 full」。这里沿用项目已有的状态语义：
        // 入池后 in_pool=true 表示「池里有备份」，而 state 描述的是「方案目录里资源是否齐全」。
        // 克隆结束时目录内容齐全（核心、模组、配置都在位），所以是 full；
        // 池中存在备份用 in_pool 字段表达，两者不冲突。
        meta.state = 'full';
        meta.updated_at = new Date().toISOString();
        const disabledCount = clean.disabled.length;
        meta.clone_report = {
            source_path: instanceDir,
            cloned_at: meta.updated_at,
            mc_version: mcVersion,
            loader: det.loader || type,
            loader_version: loaderVersion || null,
            guessed: det.guessed,
            mods_total: pool.mods.length,
            mods_disabled: disabledCount,
            disabled_list: clean.disabled.map(m => ({ file: m.file, modId: m.modId, reason: m.reason })),
            world: world.migrated ? world.saveName : null,
            copy_failed: copyStats.failed.length
        };
        sm._saveSchemeMeta(schemeName, meta);

        // ---- 第 8 步：报告 ----
        const report = buildReport({
            name: schemeName,
            instanceDir,
            mcVersion,
            type,
            loader: det.loader || type,
            loaderVersion,
            guessed: det.guessed,
            core: pool.core,
            modStats: {
                scanned: clean.scanned,
                copied: clean.scanned - disabledCount,
                disabled: clean.disabled,
                forceKept: clean.kept.filter(k => k.reason)
            },
            world,
            configCopied: fs.existsSync(path.join(schemePath, 'config')),
            copyStats,
            poolErrors: pool.errors,
            state: 'full'
        });

        try {
            logger.info(`客户端克隆为方案 ${schemeName}：${pool.mods.length} 模组，禁用 ${disabledCount} 个，源 ${instanceDir}`);
        } catch (e) {}

        return { ok: true, report, result: { schemeName, schemePath, meta, clean, pool, copyStats, world } };
    } catch (e) {
        return rollback(`克隆过程异常：${e.message}`);
    }
}

module.exports = {
    // 常量
    EXCLUDE_NAMES,
    KEEP_DIRS,
    // 工具
    expandPath,
    isCriticalPath,
    validateSchemeName,
    makeSilentIO,
    makeTerminalIO,
    // 各步骤（可单独测试）
    listInstances,
    detectInstanceMeta,
    guessFromMods,
    resolveInstance,
    createSkeleton,
    copyWhitelisted,
    installCore,
    renameClientJars,
    listSaves,
    migrateWorld,
    readForgeSide,
    cleanMods,
    fillPlatformDefaults,
    registerToPool,
    buildReport,
    // 编排
    cloneClient
};
