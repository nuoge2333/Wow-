/**
 * 工具函数模块
 * 包含 Java 检测、目录创建、路径解析等
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
// V3.5.3：改用 execFileSync/spawnSync 消除模板字符串插值，避免一旦参数来源可变即产生命令注入
const { execFileSync, spawnSync } = require('child_process');

/**
 * 获取当前操作系统类型
 */
function getOS() {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
}

/**
 * 取命令的完整路径（which）
 */
function _whichJava(cmd) {
    try {
        const whichResult = execFileSync('which', [cmd], { stdio: 'pipe' });
        return whichResult.toString().trim();
    } catch {
        return cmd; // 如果无法获取完整路径，返回命令名
    }
}

/**
 * 当裸 `java` 不可用（典型：mise / rtx 等版本管理器下未设置全局版本，
 * 运行 `java -version` 会报 "No version is set for shim: java"）时，
 * 尝试用版本管理器解析本地已安装的 Java，避免回退到不可用的裸命令或被迫重新下载。
 * @param {string|null} preferredVersion 期望的特征版本（如 '17'），优先匹配，找不到再逐级兜底
 */
function _detectVersionManagerJava(preferredVersion) {
    const candidates = [];
    if (preferredVersion) candidates.push(preferredVersion);
    candidates.push('21', '17', '11', '8'); // Minecraft 1.21+ / 1.17-1.20 / 1.13-1.16 / 1.12.2 及以下
    // 版本管理器二进制（mise 与旧名 rtx 都尝试）
    const vms = ['mise', 'rtx'];
    for (const vm of vms) {
        for (const v of candidates) {
            try {
                const p = spawnSync(vm, ['where', `java@${v}`], { timeout: 3000 });
                const out = p && p.stdout ? p.stdout.toString().trim() : '';
                if (out && fs.existsSync(out)) return out;
            } catch (e) { /* 该版本未安装或无此命令，继续 */ }
        }
    }
    // 兜底：直接扫描版本管理器的 installs 目录
    const homes = [
        process.env.MISE_DATA_DIR,
        process.env.XDG_DATA_HOME,
        path.join(os.homedir(), '.local', 'share')
    ];
    const roots = [];
    for (const h of homes) {
        if (!h) continue;
        roots.push(path.join(h, 'mise', 'installs', 'java'));
        roots.push(path.join(h, 'rtx', 'installs', 'java'));
    }
    const seen = new Set();
    for (const root of roots) {
        if (!root || seen.has(root) || !fs.existsSync(root)) continue;
        seen.add(root);
        try {
            for (const d of fs.readdirSync(root)) {
                const bin = path.join(root, d, 'bin', 'java');
                if (fs.existsSync(bin)) return bin;
            }
        } catch (e) { /* ignore */ }
    }
    return null;
}

/**
 * 读取某个 java 可执行文件的实际主版本号
 * 例：openjdk version "17.0.12" -> 17；java version "1.8.0_442" -> 8
 * @returns {number|null} 主版本号，读取失败返回 null
 */
function _probeJavaMajor(javaPath) {
    try {
        const r = spawnSync(javaPath, ['-version'], { timeout: 5000 });
        const out = (r.stdout ? r.stdout.toString() : '') + (r.stderr ? r.stderr.toString() : '');
        if (!out) return null;
        // 常见形态：
        //   openjdk version "21.0.4" 2024-07-16
        //   java version "1.8.0_442"
        //   openjdk version "1.7.0_80"
        const m = out.match(/version\s+"([^"]+)"/);
        if (!m) return null;
        const raw = m[1]; // 21.0.4 / 1.8.0_442
        const parts = raw.split(/[._+-]/);
        let major = parseInt(parts[0], 10);
        if (isNaN(major)) return null;
        // 1.x 形态换算：1.8 -> 8，1.7 -> 7
        if (major === 1 && parts.length > 1) {
            const second = parseInt(parts[1], 10);
            if (!isNaN(second)) major = second;
        }
        return major;
    } catch (e) {
        return null;
    }
}

/**
 * 枚举候选 Java 可执行文件的完整路径（跨平台，去重）
 * 覆盖：PATH、系统包管理器、IDE 捆绑、版本管理器（mise/rtx/sdkman/asdf/jabba）
 */
function _javaCandidatePaths() {
    const osType = getOS();
    const raw = [];
    const HOME = os.homedir();

    // 1) PATH 中的 java / java.exe
    try {
        const whichCmd = osType === 'windows' ? 'where' : 'which';
        for (const name of ['java', 'java.exe']) {
            const r = spawnSync(whichCmd, [name], { timeout: 3000 });
            if (r.status === 0 && r.stdout) {
                r.stdout.toString().split(/\r?\n/).forEach(l => {
                    const p = l.trim();
                    if (p) raw.push(p);
                });
            }
        }
    } catch (e) { /* ignore */ }

    // 2) 常见安装根目录下的固定布局
    if (osType === 'linux') {
        raw.push(..._expandJvmDir('/usr/lib/jvm'));
        raw.push(..._expandJvmDir('/usr/java'));
        raw.push(..._expandJvmDir('/opt/java'));
        raw.push(..._expandJvmDir('/opt/jdk'));
        raw.push(..._expandJvmDir(path.join(HOME, '.jdks')));
        // sdkman
        raw.push(..._expandJvmDir(path.join(HOME, '.sdkman', 'candidates', 'java')));
        // asdf / jabba
        raw.push(..._expandJvmDir(path.join(HOME, '.asdf', 'installs', 'java')));
        raw.push(..._expandJvmDir(path.join(HOME, '.jabba', 'jdk')));
        // mise / rtx
        for (const h of [process.env.MISE_DATA_DIR, process.env.XDG_DATA_HOME, path.join(HOME, '.local', 'share')]) {
            if (!h) continue;
            raw.push(..._expandJvmDir(path.join(h, 'mise', 'installs', 'java')));
            raw.push(..._expandJvmDir(path.join(h, 'rtx', 'installs', 'java')));
        }
    } else if (osType === 'macos') {
        // Homebrew（Intel 与 Apple Silicon）
        raw.push(..._expandJvmDir('/usr/local/opt/openjdk'));
        raw.push(..._expandJvmDir('/opt/homebrew/opt/openjdk'));
        raw.push(..._expandJvmDir('/Library/Java/JavaVirtualMachines'));
        raw.push(..._expandJvmDir(path.join(HOME, 'Library', 'Java', 'JavaVirtualMachines')));
        raw.push(..._expandJvmDir('/usr/lib/jvm'));
        // Homebrew 的版本化 formula：openjdk@17 等
        for (const base of ['/usr/local/opt', '/opt/homebrew/opt']) {
            for (const v of ['8', '11', '17', '21', '22', '23']) {
                raw.push(..._expandJvmDir(path.join(base, `openjdk@${v}`)));
            }
        }
    } else if (osType === 'windows') {
        const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
        const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localApp = process.env['LOCALAPPDATA'] || path.join(HOME, 'AppData', 'Local');
        for (const base of [
            path.join(pf, 'Java'),
            path.join(pf, 'Eclipse Adoptium'),
            path.join(pf, 'Eclipse Foundation'),
            path.join(pf, 'Microsoft'),
            path.join(pf, 'Amazon Corretto'),
            path.join(pf, 'Zulu'),
            path.join(pf, 'BellSoft'),
            path.join(pf, 'Semeru'),
            path.join(pf, 'AdoptOpenJDK'),
            path.join(pf86, 'Java'),
            path.join(localApp, 'Programs', 'Eclipse Adoptium'),
            path.join(localApp, 'Programs', 'Microsoft')
        ]) {
            raw.push(..._expandJvmDir(base));
        }
        // 版本管理器（Windows 下也有 mise / sdkman-wsl 等）
        raw.push(..._expandJvmDir(path.join(HOME, '.jdks')));
        raw.push(..._expandJvmDir(path.join(HOME, '.sdkman', 'candidates', 'java')));
        const miseData = process.env.MISE_DATA_DIR || path.join(localApp, 'mise');
        raw.push(..._expandJvmDir(path.join(miseData, 'installs', 'java')));
    }

    // 3) 用户显式配置的路径（最高优先，但仍在去重后统一探测）
    try {
        const config = require('./config');
        const cfgJava = config.getConfig('server.java', null);
        if (cfgJava) raw.unshift(cfgJava);
    } catch (e) { /* ignore */ }

    // 4) JAVA_HOME
    if (process.env.JAVA_HOME) {
        raw.unshift(path.join(process.env.JAVA_HOME, 'bin',
            osType === 'windows' ? 'java.exe' : 'java'));
    }

    // 去重 + 过滤不存在的
    const seen = new Set();
    const out = [];
    for (const p of raw) {
        if (!p) continue;
        const norm = path.normalize(p);
        if (seen.has(norm)) continue;
        seen.add(norm);
        try { if (fs.existsSync(norm)) out.push(norm); } catch (e) { /* ignore */ }
    }
    return out;
}

/**
 * 展开某个 JDK 根目录下的所有 java 可执行文件
 * 兼容两种布局：<root>/bin/java（root 本身是 JDK）与 <root>/<name>/bin/java（root 是容器目录）
 */
function _expandJvmDir(root) {
    const out = [];
    if (!root) return out;
    let rootExists = false;
    try { rootExists = fs.existsSync(root); } catch (e) { return out; }
    if (!rootExists) return out;

    const exe = getOS() === 'windows' ? 'java.exe' : 'java';
    const directBin = path.join(root, 'bin', exe);
    try { if (fs.existsSync(directBin)) out.push(directBin); } catch (e) { /* ignore */ }

    try {
        for (const d of fs.readdirSync(root)) {
            const p = path.join(root, d, 'bin', exe);
            try { if (fs.existsSync(p)) out.push(p); } catch (e) { /* ignore */ }
            // macOS 的 JavaVirtualMachines/<name>/Contents/Home/bin/java
            const macP = path.join(root, d, 'Contents', 'Home', 'bin', exe);
            try { if (fs.existsSync(macP)) out.push(macP); } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }
    return out;
}

/**
 * 扫描本机所有可用的 Java，返回带主版本号的列表
 * V3.5.7 新增：旧版 detectJava 只返回第一个能跑的 java，不校验版本，
 * 也不扫描系统包管理器/IDE 安装路径，导致「装了 17 但服务器要 21」时静默用错版本。
 *
 * @returns {Array<{path:string, major:number|null, version:string|null, source:string}>}
 */
function scanAllJava() {
    const found = [];
    const seenReal = new Set();

    for (const p of _javaCandidatePaths()) {
        // 用 realpath 去重，避免 /usr/bin/java -> /etc/alternatives/java -> 真实 jdk 的符号链接链被算三次
        let real = p;
        try { real = fs.realpathSync(p); } catch (e) { /* 保留原路径 */ }
        if (seenReal.has(real)) continue;
        seenReal.add(real);

        const major = _probeJavaMajor(p);
        found.push({
            path: p,
            major,
            version: major != null ? String(major) : null,
            source: _classifyJavaSource(p)
        });
    }

    // 按主版本升序，版本未知者排最后
    found.sort((a, b) => {
        if (a.major == null && b.major == null) return 0;
        if (a.major == null) return 1;
        if (b.major == null) return -1;
        return a.major - b.major;
    });
    return found;
}

/**
 * 给 Java 路径打一个来源标签（用于菜单展示，便于用户识别该用哪个）
 */
function _classifyJavaSource(p) {
    const s = String(p).toLowerCase();
    if (s.includes('sdkman')) return 'sdkman';
    if (s.includes(`${path.sep}mise${path.sep}`) || s.includes('/mise/')) return 'mise';
    if (s.includes('rtx')) return 'rtx';
    if (s.includes('asdf')) return 'asdf';
    if (s.includes('jabba')) return 'jabba';
    if (s.includes('.jdks')) return 'IDE 下载';
    if (s.includes('jvm')) return '系统包';
    if (s.includes('adoptium') || s.includes('temurin')) return 'Adoptium';
    if (s.includes('corretto')) return 'Corretto';
    if (s.includes('zulu')) return 'Zulu';
    if (s.includes('microsoft') || s.includes('microsoft-jdk')) return 'Microsoft';
    if (s.includes('bellsoft') || s.includes('liberica')) return 'Liberica';
    if (s.includes('semeru')) return 'Semeru';
    if (s.includes('program files')) return '系统安装';
    return 'PATH';
}

/**
 * 挑出与期望主版本匹配的 Java 路径
 * @param {number|string} wanted 期望主版本（如 17）
 * @param {Array} [list] 可选，复用已扫描结果
 * @returns {string|null}
 */
function findJavaByMajor(wanted, list = null) {
    const want = parseInt(wanted, 10);
    if (isNaN(want)) return null;
    const all = list || scanAllJava();
    // 精确匹配优先
    const exact = all.find(j => j.major === want);
    if (exact) return exact.path;

    // 无精确匹配时允许「LTS 向上兼容」：高版本 JVM 可以运行低版本字节码，
    // 但必须限定在 LTS 之间，且不能跨越太远。
    //   - 需要 17 时可用 21（MC 1.17-1.20 在 Java 21 上普遍正常）
    //   - 需要 21 时不能退回 17（1.21 的字节码需要 21+）
    //   - 需要 8  时绝不向上（Java 9+ 移除了大量 API，1.12.2 服务端在 17 上会崩）
    const LTS = [8, 11, 17, 21, 25];
    if (LTS.includes(want) && want >= 11) {
        const higher = all
            .filter(j => j.major != null && j.major > want && LTS.includes(j.major))
            .sort((a, b) => a.major - b.major)[0];
        if (higher) return higher.path;
    }
    return null;
}

/**
 * 检测 Java 是否可用，返回可执行文件路径或 null
 * @param {string|null} [preferredVersion] 期望的特征版本（如 '17'），用于优先匹配
 * @param {object} [opts]
 * @param {boolean} [opts.allowMismatch] 匹配不到期望版本时，是否允许返回版本不符的 Java。
 *        默认 false —— V3.5.7 起默认「宁缺毋滥」：需要 17 却返回 20 会让服务器启动即崩，
 *        不如返回 null 让上层触发自动下载。仅在明确要「随便给个能跑的」时才置 true。
 */
function detectJava(preferredVersion = null, opts = {}) {
    const allowMismatch = opts.allowMismatch === true;

    // V3.5.7：优先走全量扫描 + 版本匹配，确保返回的 java 真的符合期望版本。
    // 旧实现只判断「能不能跑」，装了 17 但需要 21 时会返回 17，服务器启动即崩。
    if (preferredVersion) {
        const matched = findJavaByMajor(preferredVersion);
        if (matched) return matched;
        // 匹配不到：默认不再退回「任意可跑的 java」，交由调用方决定是否下载
        if (!allowMismatch) return null;
    }
    return _detectAnyJava();
}

/**
 * 不校验版本，返回任意一个可用的 Java（旧 detectJava 的行为）
 */
function _detectAnyJava() {
    const javaCmds = ['java', 'java.exe'];
    for (const cmd of javaCmds) {
        try {
            // java -version 把版本信息写到 stderr，用 spawnSync 合并 stdout/stderr 读取
            const r = spawnSync(cmd, ['-version'], { timeout: 3000 });
            const output = (r.stdout ? r.stdout.toString() : '') + (r.stderr ? r.stderr.toString() : '');
            if (output.includes('version')) {
                return _whichJava(cmd);
            }
        } catch (e) {
            // 继续尝试下一个
        }
    }
    // 裸 java 不可用（mise/rtx 未设置全局版本等），尝试版本管理器
    const vmJava = _detectVersionManagerJava(null);
    if (vmJava) return vmJava;
    // 最后：全量扫描里任意一个
    const any = scanAllJava().find(j => j.major != null);
    return any ? any.path : null;
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
    fs.ensureDirSync(dirPath);
    return dirPath;
}

/**
 * 获取绝对路径（相对于 core/ 目录）
 */
function resolvePath(relativePath) {
    return path.resolve(__dirname, '..', relativePath);
}

/**
 * 获取 pool 目录下的子路径
 */
function getPoolPath(subPath = '') {
    const config = require('./config');
    const poolDir = config.getConfig('pool.dir', 'pool');
    return resolvePath(path.join(poolDir, subPath));
}

/**
 * 获取模组存储路径: pool/mods/{loader}/{version}/
 */
function getModStoragePath(loader, version) {
    const modsBase = getPoolPath('mods');
    return path.join(modsBase, loader, version);
}

/**
 * 获取插件存储路径: pool/plugins/{loader}/
 */
function getPluginStoragePath(loader) {
    const pluginsBase = getPoolPath('plugins');
    return path.join(pluginsBase, loader);
}

/**
 * 获取核心存储路径: pool/cores/{type}/{version}/
 */
function getCoreStoragePath(type, version) {
    const coresBase = getPoolPath('cores');
    return path.join(coresBase, type, version);
}

/**
 * 获取加载器安装包路径: pool/loader/{loader}/{version}/
 */
function getLoaderStoragePath(loader, version) {
    const loaderBase = getPoolPath('loader');
    return path.join(loaderBase, loader, version);
}

/**
 * 获取 JRE 存储路径
 */
function getJrePath() {
    const config = require('./config');
    const jreDir = config.getConfig('jre.dir', 'jre');
    return resolvePath(jreDir);
}

/**
 * 获取当前激活的服务器目录
 *
 * V3.4.x 起改为「直接在方案目录内运行」：若当前激活了方案（server.scheme 配置指向
 * 某个已存在的方案），则服务器直接以 <项目根>/scheme/<方案名> 为根目录启动，不再把
 * 方案复制到 server/ 目录再跑。这样可以彻底避免「复制方案到 server 目录」带来的问题：
 *   - 世界数据在 scheme 与 server 两套目录间来回复制、重复、易丢；
 *   - 切换方案时 server/ 被 _backup_ 目录堆积、且原 server/ 内容被整体清空；
 *   - 在方案目录里改了东西（配置/存档），因为实际跑的是 server/ 副本而不生效。
 * 仅当未激活任何方案时，才回退到默认 server.dir（../scheme）。
 *
 * V3.5.2 起方案目录由 core/schemes/ 迁移到项目根 scheme/，
 * 这里必须与 SchemeManager.schemesDir 保持同一路径，否则切换方案后仍会回退到根目录，
 * 导致「切了方案但 server start 找不到核心」。
 */
function getServerDir() {
    const config = require('./config');
    const scheme = config.getConfig('server.scheme', null);
    if (scheme) {
        // 与 SchemeManager.schemesDir 保持同一路径（根 scheme/）。
        // 这里不用 SchemeManager，避免 scheme_manager -> utils -> scheme_manager 循环依赖；
        // 该相对路径与 scheme_manager.js 的 resolvePath('../scheme') 等价。
        const schemePath = resolvePath(path.join('../scheme', scheme));
        if (fs.existsSync(schemePath)) {
            return schemePath;
        }
        // 配置指向的方案目录已不存在，回退到根 scheme 目录
    }
    const serverDir = config.getConfig('server.dir', '../scheme');
    return resolvePath(serverDir);
}

/**
 * 检查某个命令是否存在
 */
function commandExists(cmd) {
    try {
        const result = execFileSync('which', [cmd], { stdio: 'pipe' });
        return result.toString().trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * 获取文件大小（人性化格式）
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 安全地删除目录（先检查是否存在）
 */
function removeDirIfExists(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.removeSync(dirPath);
    }
}

module.exports = {
    getOS,
    detectJava,
    scanAllJava,
    findJavaByMajor,
    ensureDir,
    resolvePath,
    getPoolPath,
    getModStoragePath,
    getPluginStoragePath,
    getCoreStoragePath,
    getLoaderStoragePath,
    getJrePath,
    getServerDir,
    commandExists,
    formatFileSize,
    removeDirIfExists
};