/**
 * 下载到方案（Web「自动选择版本并拉取依赖」勾选后的直装）测试
 * ---------------------------------------------------------------
 * 钉死：
 *   1. isSchemeCompatible：模组端只认 forge/neoforge/fabric/quilt，插件端只认 paper/purpur/
 *      spigot/bukkit/catserver/mohist/leaves；vanilla 两者都不兼容；
 *   2. installToSchemes：把已入池的本体安装到兼容方案目录，跳过不兼容/不存在的方案；
 *   3. 幂等：目标已存在同名文件视为 already，不覆盖；
 *   4. CLI install mod/plugin 暴露 --schemes 参数。
 *
 * 隔离：config.pool.dir → core/test/.tmp_its_pool_<pid>；方案 → scheme/_e2e_its_<pid>_*。
 * 运行：cd core && node test/install_to_schemes.test.js
 */
const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const config = require(path.join(SRC, 'config'));
const PI = require(path.join(SRC, 'pool_installer'));
const cliSrc = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');

let pass = 0, fail = 0;
async function check(name, fn) {
    try { await fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const origPoolDir = config.getConfig('pool.dir', 'pool');
const poolRel = path.join('test', `.tmp_its_pool_${process.pid}`);
const poolAbs = path.join(__dirname, '..', poolRel);
const schemeNames = ['_e2e_its_forge_' + process.pid, '_e2e_its_paper_' + process.pid, '_e2e_its_vanilla_' + process.pid];
const schemesRoot = path.join(__dirname, '..', '..', 'scheme');

function makeScheme(name, loader, type) {
    const dir = path.join(schemesRoot, name);
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, 'scheme.yaml'), `name: ${name}\nversion: 1.20.1\nloader: ${loader}\ntype: ${type}\n`);
    return dir;
}

(async () => {
    fs.emptyDirSync(poolAbs);
    config.setConfig('pool.dir', poolRel);
    schemeNames.forEach(n => { try { fs.removeSync(path.join(schemesRoot, n)); } catch (e) {} });

    console.log('\n=== isSchemeCompatible 兼容判断 ===\n');
    await check('模组端 forge 兼容 mods，不兼容 plugins', () => {
        assert.strictEqual(PI.isSchemeCompatible({ loader: 'forge', type: 'vanilla' }, 'mods'), true);
        assert.strictEqual(PI.isSchemeCompatible({ loader: 'forge', type: 'vanilla' }, 'plugins'), false);
    });
    await check('fabric/neoforge/quilt 兼容 mods', () => {
        for (const l of ['fabric', 'neoforge', 'quilt']) {
            assert.strictEqual(PI.isSchemeCompatible({ loader: l, type: 'vanilla' }, 'mods'), true, l);
        }
    });
    await check('插件端 paper/purpur/mohist/catserver 兼容 plugins', () => {
        for (const t of ['paper', 'purpur', 'spigot', 'bukkit', 'mohist', 'catserver', 'leaves']) {
            assert.strictEqual(PI.isSchemeCompatible({ loader: t, type: t }, 'plugins'), true, t);
        }
    });
    await check('vanilla 两类都不兼容', () => {
        assert.strictEqual(PI.isSchemeCompatible({ loader: 'vanilla', type: 'vanilla' }, 'mods'), false);
        assert.strictEqual(PI.isSchemeCompatible({ loader: 'vanilla', type: 'vanilla' }, 'plugins'), false);
    });

    console.log('\n=== installToSchemes 直装 ===\n');
    const forgeDir = makeScheme(schemeNames[0], 'forge', 'vanilla');
    const paperDir = makeScheme(schemeNames[1], 'paper', 'paper');
    makeScheme(schemeNames[2], 'vanilla', 'vanilla');

    // 造一个已入池的模组本体文件
    const rel = 'mods/forge/1.20.1/jei.jar';
    const src = path.join(poolAbs, rel);
    fs.ensureDirSync(path.dirname(src));
    fs.writeFileSync(src, 'JAR');

    let r;
    await check('装到 forge 方案，跳过 paper（不兼容）与不存在方案', () => {
        r = PI.installToSchemes({ ok: true, installed: [{ projectId: 'jei', rel, depth: 0 }], rel }, 'mods',
            [schemeNames[0], schemeNames[1], 'NO_SUCH_SCHEME']);
        assert.ok(r.installed.some(x => x.scheme === schemeNames[0]), JSON.stringify(r));
        assert.ok(r.skipped.some(x => x.scheme === schemeNames[1] && /不支持/.test(x.reason)), JSON.stringify(r.skipped));
        assert.ok(r.skipped.some(x => x.scheme === 'NO_SUCH_SCHEME' && /不存在/.test(x.reason)));
        assert.ok(fs.existsSync(path.join(forgeDir, 'mods', 'jei.jar')));
        assert.ok(!fs.existsSync(path.join(paperDir, 'mods', 'jei.jar')));
    });
    await check('幂等：重复安装标记 already 不覆盖', () => {
        fs.writeFileSync(path.join(forgeDir, 'mods', 'jei.jar'), 'MODIFIED');
        const r2 = PI.installToSchemes({ ok: true, installed: [rel], rel }, 'mods', [schemeNames[0]]);
        assert.strictEqual(r2.installed[0].already, true);
        assert.strictEqual(fs.readFileSync(path.join(forgeDir, 'mods', 'jei.jar'), 'utf8'), 'MODIFIED');
    });
    await check('插件装到 paper 方案 plugins 目录', () => {
        const prel = 'plugins/paper/EssentialsX.jar';
        const psrc = path.join(poolAbs, prel);
        fs.ensureDirSync(path.dirname(psrc));
        fs.writeFileSync(psrc, 'PLUGIN');
        const pr = PI.installToSchemes({ ok: true, installed: [prel], rel: prel }, 'plugins', [schemeNames[1]]);
        assert.ok(pr.installed.some(x => x.scheme === schemeNames[1]), JSON.stringify(pr));
        assert.ok(fs.existsSync(path.join(paperDir, 'plugins', 'EssentialsX.jar')));
    });
    await check('下载失败结果不安装', () => {
        const bad = PI.installToSchemes({ ok: false }, 'mods', [schemeNames[0]]);
        assert.strictEqual(bad.ok, false);
        assert.strictEqual(bad.installed.length, 0);
    });

    console.log('\n=== CLI 参数暴露 ===\n');
    await check('install mod/plugin 暴露 --schemes 参数', () => {
        const matches = cliSrc.match(/--schemes <names>/g) || [];
        assert.ok(matches.length >= 2, `--schemes 参数应出现至少 2 次，实际 ${matches.length}`);
    });

    // 收尾
    config.setConfig('pool.dir', origPoolDir);
    try { fs.removeSync(poolAbs); } catch (e) {}
    schemeNames.forEach(n => { try { fs.removeSync(path.join(schemesRoot, n)); } catch (e) {} });

    console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('测试异常:', e);
    try { config.setConfig('pool.dir', origPoolDir); } catch (_) {}
    try { fs.removeSync(poolAbs); } catch (_) {}
    process.exit(1);
});
