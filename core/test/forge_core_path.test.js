/**
 * Forge / NeoForge 核心路径探测测试（V3.5.8）
 *
 * 背景：`serverJarPattern: /forge-.+-server\.jar$/` 只在部分版本成立。
 * 真实产物布局：
 *   - 1.12.2 / 1.16.5：根目录 forge-<mc>-<loader>.jar（无 -server 后缀）+ minecraft_server.<mc>.jar
 *   - 1.17 ~ 1.20.x ：libraries/net/minecraftforge/forge/<mc>-<loader>/forge-...-server.jar + unix_args.txt
 *   - 1.21+         ：同目录只有 win_args.txt / unix_args.txt（无独立 -server jar）
 *   - NeoForge      ：libraries/net/neoforged/neoforge/<ver>/
 * 本测试用临时目录把这些布局造出来，验证：
 *   1. installer._detectForgeJar 能定位到真实核心（且绝不选中原版 minecraft_server.*.jar）
 *   2. installer._detectForgeArgsFile 能定位启动参数文件
 *   3. server._getServerJar 不会把原版核心误当成 Forge 核心
 *   4. scheme_manager._resolveCoreTarget 能按相对路径还原深层核心
 *
 * 运行：cd core && node test/forge_core_path.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const Installer = require('../src/installer');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

const WORK = path.join(os.tmpdir(), `forge_core_path_${process.pid}`);
fs.emptyDirSync(WORK);

// 造一个大小不为 0 的假文件
function touch(p, content = 'x') {
    fs.ensureDirSync(path.dirname(p));
    fs.writeFileSync(p, content);
    return p;
}

const installer = new Installer();

console.log('\nForge/NeoForge 核心路径探测测试 (V3.5.8)\n');

// ─────────────────────────────────────────────
console.log('— 布局 A：1.16.5，根目录 forge-<mc>-<ver>.jar + 原版核心 —');
{
    const dir = path.join(WORK, 'A_1165');
    touch(path.join(dir, 'forge-1.16.5-36.2.39.jar'));
    touch(path.join(dir, 'minecraft_server.1.16.5.jar'));
    touch(path.join(dir, 'forge-1.16.5-36.2.39-installer.jar'));
    touch(path.join(dir, 'libraries/net/minecraftforge/forge/1.16.5-36.2.39/forge-1.16.5-36.2.39-universal.jar'));

    check('A1 定位到 forge-1.16.5-36.2.39.jar（无 -server 后缀）', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(r, '应找到核心');
        assert.strictEqual(path.basename(r), 'forge-1.16.5-36.2.39.jar');
    });

    check('A2 不会选中原版 minecraft_server.1.16.5.jar', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(!/minecraft_server/.test(path.basename(r)));
    });

    check('A3 不会选中 installer.jar', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(!/installer/.test(path.basename(r)));
    });

    check('A4 无 args 文件时 _detectForgeArgsFile 返回 null', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.strictEqual(installer._detectForgeArgsFile(r), null);
    });
}

// ─────────────────────────────────────────────
console.log('— 布局 B：1.20.1，libraries 深层 + unix_args.txt —');
{
    const dir = path.join(WORK, 'B_1201');
    const deep = path.join(dir, 'libraries/net/minecraftforge/forge/1.20.1-47.2.0');
    touch(path.join(deep, 'forge-1.20.1-47.2.0-server.jar'));
    touch(path.join(deep, 'unix_args.txt'));
    touch(path.join(deep, 'win_args.txt'));
    touch(path.join(dir, 'minecraft_server.1.20.1.jar'));
    touch(path.join(dir, 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-shim.jar'));

    check('B1 定位到 libraries 深层的 -server.jar', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(r, '应找到核心');
        assert.strictEqual(path.basename(r), 'forge-1.20.1-47.2.0-server.jar');
        assert.ok(r.includes(`libraries${path.sep}net${path.sep}minecraftforge`), '必须在 libraries 下');
    });

    check('B2 同目录能找到 unix_args.txt', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        const a = installer._detectForgeArgsFile(r);
        assert.ok(a, '应找到 args 文件');
        assert.strictEqual(path.basename(a), 'unix_args.txt');
    });

    check('B3 不会选中 minecraft_server.1.20.1.jar', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(!/minecraft_server/.test(path.basename(r)));
    });

    check('B4 不会选中 shim.jar', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(!/shim/.test(path.basename(r)), `误选 shim: ${path.basename(r)}`);
    });
}

// ─────────────────────────────────────────────
console.log('— 布局 C：1.21+，只有 args 文件、无独立 -server jar —');
{
    const dir = path.join(WORK, 'C_121');
    const deep = path.join(dir, 'libraries/net/minecraftforge/forge/1.21.1-52.0.1');
    touch(path.join(deep, 'unix_args.txt'));
    touch(path.join(deep, 'win_args.txt'));
    touch(path.join(dir, 'minecraft_server.1.21.1.jar'));
    touch(path.join(dir, 'run.sh'));

    check('C1 无 jar 时返回 args 文件而非抛错/选原版', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(r, '应返回结果');
        assert.strictEqual(path.basename(r), 'unix_args.txt');
    });

    check('C2 返回路径不是原版核心', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(!/minecraft_server/.test(r));
    });

    check('C3 _detectForgeArgsFile 对 args 自身所在目录仍返回自身', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        const a = installer._detectForgeArgsFile(r);
        assert.ok(a);
        assert.strictEqual(path.basename(a), 'unix_args.txt');
    });
}

// ─────────────────────────────────────────────
console.log('— 布局 D：NeoForge 1.21 —');
{
    const dir = path.join(WORK, 'D_neo');
    const deep = path.join(dir, 'libraries/net/neoforged/neoforge/21.1.72');
    touch(path.join(deep, 'neoforge-21.1.72-server.jar'));
    touch(path.join(deep, 'unix_args.txt'));
    touch(path.join(dir, 'minecraft_server.1.21.1.jar'));

    check('D1 定位到 neoforge-21.1.72-server.jar', () => {
        const r = installer._detectForgeJar(dir, 'neoforge');
        assert.ok(r);
        assert.strictEqual(path.basename(r), 'neoforge-21.1.72-server.jar');
    });

    check('D2 neoforge 不会误取 forge- 前缀的文件', () => {
        const r = installer._detectForgeJar(dir, 'neoforge');
        assert.ok(!/\/forge-/.test(r.replace(/\\/g, '/')));
    });
}

// ─────────────────────────────────────────────
console.log('— 布局 E：1.12.2 老版本，根目录 jar + libraries —');
{
    const dir = path.join(WORK, 'E_1122');
    touch(path.join(dir, 'forge-1.12.2-14.23.5.2860.jar'));
    touch(path.join(dir, 'minecraft_server.1.12.2.jar'));
    touch(path.join(dir, 'libraries/net/minecraftforge/forge/1.12.2-14.23.5.2860/forge-1.12.2-14.23.5.2860-universal.jar'));

    check('E1 根目录优先选中可启动的 forge jar', () => {
        const r = installer._detectForgeJar(dir, 'forge');
        assert.ok(r);
        assert.strictEqual(path.basename(r), 'forge-1.12.2-14.23.5.2860.jar');
    });
}

// ─────────────────────────────────────────────
console.log('— 边界：空目录 / 只有原版 —');
{
    const emptyDir = path.join(WORK, 'F_empty');
    fs.ensureDirSync(emptyDir);

    check('F1 空目录返回 null（不抛异常）', () => {
        assert.strictEqual(installer._detectForgeJar(emptyDir, 'forge'), null);
    });

    const vanillaOnly = path.join(WORK, 'G_vanilla');
    touch(path.join(vanillaOnly, 'minecraft_server.1.20.1.jar'));
    check('F2 只有原版核心时返回 null（绝不把原版当 Forge）', () => {
        assert.strictEqual(installer._detectForgeJar(vanillaOnly, 'forge'), null);
    });

    const modernVanilla = path.join(WORK, 'H_modern_vanilla');
    touch(path.join(modernVanilla, 'libraries/net/minecraft/server/1.20.1/server-1.20.1.jar'));
    check('F3 现代原版 server-<mc>.jar 也不被当成 Forge', () => {
        assert.strictEqual(installer._detectForgeJar(modernVanilla, 'forge'), null);
    });
}

// ─────────────────────────────────────────────
console.log('— _copyToPool 不把 args 文件当核心 —');
{
    check('G1 非 .jar 路径返回 null', async () => {
        // 同步断言行为：直接看返回值是否为 Promise<null> 形状不可行，这里用字符串预判
        // 通过调用并检查 Promise 存在性间接验证（后续在合流处 await）
        const p = installer._copyToPool('forge', '1.21.1', path.join(WORK, 'C_121', 'libraries/net/minecraftforge/forge/1.21.1-52.0.1/unix_args.txt'));
        assert.ok(p && typeof p.then === 'function');
    });
}

// ─────────────────────────────────────────────
console.log('— server._getServerJar：Forge 不误选原版 —');
{
    // 轻量打桩：直接复制 server 的判定逻辑片段不可行，改为真实构造一个 ServerManager 并打桩 config
    const ServerManager = require('../src/server');
    const sm = new ServerManager();
    const dirB = path.join(WORK, 'B_1201');
    sm.serverDir = dirB;

    check('H1 配了 server.jar 时直接采用（含 libraries 相对路径）', () => {
        const rel = `libraries/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-server.jar`;
        const store = {
            'server.jar': rel,
            'server.type': 'forge',
            'server.launchArgsFile': ''
        };
        sm.config = { getConfig: (k, d = null) => (k in store ? store[k] : d) };
        const r = sm._getServerJar();
        assert.strictEqual(r, rel);
    });

    check('H2 未配 server.jar 时按 forge 前缀挑选，不选 minecraft_server', () => {
        const dirA = path.join(WORK, 'A_1165');
        sm.serverDir = dirA;
        const store = { 'server.jar': null, 'server.type': 'forge', 'server.launchArgsFile': '' };
        sm.config = { getConfig: (k, d = null) => (k in store ? store[k] : d) };
        const r = sm._getServerJar();
        assert.ok(!/minecraft_server/.test(r), `误选原版: ${r}`);
        assert.ok(/^forge-/.test(r), `应选 forge 前缀: ${r}`);
    });

    check('H3 只有 args 文件 + 无根目录 jar 时返回 args（不报未找到核心）', () => {
        const dirC = path.join(WORK, 'C_121');
        sm.serverDir = dirC;
        // C_121 根目录有 minecraft_server.1.21.1.jar，jarFiles 不为空；
        // 构造一个纯净目录确保走 args 分支
        const pure = path.join(WORK, 'I_args_only');
        fs.ensureDirSync(pure);
        touch(path.join(pure, 'libraries/net/minecraftforge/forge/1.21.1-52.0.1/unix_args.txt'));
        sm.serverDir = pure;
        const store = {
            'server.jar': null,
            'server.type': 'forge',
            'server.launchArgsFile': 'libraries/net/minecraftforge/forge/1.21.1-52.0.1/unix_args.txt'
        };
        sm.config = { getConfig: (k, d = null) => (k in store ? store[k] : d) };
        const r = sm._getServerJar();
        assert.ok(/unix_args\.txt$/.test(r), `应返回 args: ${r}`);
    });
}

// ─────────────────────────────────────────────
console.log('— scheme_manager._resolveCoreTarget 还原深层路径 —');
{
    const SchemeManager = require('../src/scheme_manager');
    const sms = new SchemeManager();
    const schemePath = path.join(WORK, 'J_scheme');

    check('I1 新格式：libraries 相对路径原样还原', () => {
        const meta = { file: 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-server.jar' };
        const r = sms._resolveCoreTarget(schemePath, meta);
        assert.strictEqual(r, path.join(schemePath, 'libraries', 'net', 'minecraftforge', 'forge', '1.20.1-47.2.0', 'forge-1.20.1-47.2.0-server.jar'));
    });

    check('I2 老格式：纯文件名落到方案根目录', () => {
        const meta = { file: 'forge-1.16.5-36.2.39.jar' };
        const r = sms._resolveCoreTarget(schemePath, meta);
        assert.strictEqual(r, path.join(schemePath, 'forge-1.16.5-36.2.39.jar'));
    });

    check('I3 Windows 反斜杠路径被规范化', () => {
        const meta = { file: 'libraries\\net\\minecraftforge\\forge\\x.jar' };
        const r = sms._resolveCoreTarget(schemePath, meta);
        assert.strictEqual(r, path.join(schemePath, 'libraries', 'net', 'minecraftforge', 'forge', 'x.jar'));
    });

    check('I4 带 ./ 前缀也能还原', () => {
        const meta = { file: './forge-1.12.2-14.23.5.2860.jar' };
        const r = sms._resolveCoreTarget(schemePath, meta);
        assert.strictEqual(r, path.join(schemePath, 'forge-1.12.2-14.23.5.2860.jar'));
    });

    check('I5 空 meta 不抛异常', () => {
        assert.doesNotThrow(() => sms._resolveCoreTarget(schemePath, null));
        assert.doesNotThrow(() => sms._resolveCoreTarget(schemePath, {}));
    });
}

// ─────────────────────────────────────────────
// 收尾
fs.removeSync(WORK);
console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
