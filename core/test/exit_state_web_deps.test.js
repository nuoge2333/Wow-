#!/usr/bin/env node
/**
 * P0 三合一回归测试（退出状态机 / Web 依赖 / 手动版本引导）
 * ----------------------------------------------------------------
 * 问题一：退出状态机——只有 stop/kill/控制台 stop 置 intendedShutdown；
 *         退出码 0 不再兜底为正常停止，异常时强制诊断。
 * 问题二：install mod 入池默认走 dep_resolver 递归拉依赖（Web 与 CLI 同一套）。
 * 问题三：手动模式有版本列表 API + 指定版本依赖 API + 前端三选一弹窗。
 *
 * 运行：cd core && node test/exit_state_web_deps.test.js
 */
const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const SRC = path.join(__dirname, '../src');
const WEB = path.join(__dirname, '..', '..', 'web');
const ROOT = path.join(__dirname, '..', '..');
const srvSrc = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
const cliSrc = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');
const wsSrc = fs.readFileSync(path.join(SRC, 'web_service.js'), 'utf8');
const downHtml = fs.readFileSync(path.join(WEB, 'down.html'), 'utf8');

let pass = 0, fail = 0;
async function check(name, fn) {
    try { await fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

async function main() {
    // ==================== 问题一：退出状态机 ====================
    console.log('\n=== 问题一：退出状态机 ===\n');

    await check('构造函数初始化 intendedShutdown = false', () => {
        assert.ok(/this\.intendedShutdown = false;/.test(srvSrc), '未初始化意图标记');
    });

    await check('存在统一意图标记入口 _markIntendedShutdown', () => {
        assert.ok(/_markIntendedShutdown\(\)\s*\{[\s\S]{0,80}this\.intendedShutdown = true;/.test(srvSrc),
            '_markIntendedShutdown 未置 true');
        assert.ok(/this\.intendedShutdown = true;[\s\S]{0,120}_writeManualStopFlag\(\)/.test(srvSrc),
            '意图入口未写跨进程标记');
    });

    await check('stop() / kill() 都调用 _markIntendedShutdown', () => {
        const calls = (srvSrc.match(/this\._markIntendedShutdown\(\);/g) || []).length;
        assert.ok(calls >= 2, `stop/kill 应各置一次，实际 ${calls} 处`);
    });

    await check('控制台 stop / Web 控制台 / sendCommand 三路都标记意图', () => {
        // isMcStopCommand 判定 + 至少 3 处调用
        assert.ok(/function isMcStopCommand\(line\)/.test(srvSrc), '缺 stop 指令识别函数');
        const marks = (srvSrc.match(/if \(isMcStopCommand\([^)]+\)\) this\._markIntendedShutdown\(\);/g) || []).length;
        assert.ok(marks >= 3, `控制台 stop 三路标记不足，实际 ${marks} 处`);
    });

    await check('exit 判定严格以 intendedShutdown 为准（无 code===0 / signal 兜底）', () => {
        assert.ok(!/code === 0 \|\| code === 143/.test(srvSrc), '仍残留退出码兜底');
        assert.ok(!/signalStop/.test(srvSrc), '仍残留信号兜底');
        assert.ok(/const isManualStop = this\.intendedShutdown === true\s*\n?\s*\|\| this\._stopRequested === true \|\| manualFlag/.test(srvSrc),
            '未以意图标记判定');
    });

    await check('异常退出输出「❌ 服务器异常退出」并强制诊断', () => {
        assert.ok(/console\.log\('❌ 服务器异常退出'\)/.test(srvSrc), '缺异常退出提示');
        const abnormalIdx = srvSrc.indexOf('❌ 服务器异常退出');
        const diagnoseIdx = srvSrc.indexOf('this._diagnoseCrash(code)', abnormalIdx);
        assert.ok(abnormalIdx > -1 && diagnoseIdx > abnormalIdx, '异常分支未调用诊断');
    });

    await check('isMcStopCommand 纯函数：只认 stop，不误判 say stop', () => {
        // 从 server.js 抽取函数体执行
        const m = srvSrc.match(/function isMcStopCommand\(line\) \{[\s\S]*?\n\}/);
        assert.ok(m, '未找到函数');
        const fn = new Function('line', m[0].replace(/^function isMcStopCommand\(line\) \{/, '').replace(/\}$/, ''));
        assert.strictEqual(fn('stop'), true);
        assert.strictEqual(fn('/stop'), true);
        assert.strictEqual(fn('  stop  '), true);
        assert.strictEqual(fn('say stop'), false);
        assert.strictEqual(fn('op Steve'), false);
    });

    // ==================== 问题二：Web 装模组递归依赖 ====================
    console.log('\n=== 问题二：install mod 递归拉依赖 ===\n');

    await check('pool_installer.installContent 默认走 dep_resolver（非单文件）', () => {
        const p = fs.readFileSync(path.join(SRC, 'pool_installer.js'), 'utf8');
        assert.ok(/const autoResolve = opts\.autoResolve !== false;/.test(p), '未默认开启自动解析');
        assert.ok(/require\('\.\/dep_resolver'\)[\s\S]{0,80}\.resolve\(/.test(p), '未调用 dep_resolver.resolve');
        assert.ok(/installed\.filter\(i => i\.depth > 0\)\.map\(i => i\.projectId\)/.test(p), '未汇总依赖清单');
    });

    await check('CLI install mod / plugin 支持 --no-auto 且默认递归', () => {
        assert.ok(/\.command\('mod <url_or_search>'\)[\s\S]{0,400}--no-auto/.test(cliSrc), 'mod 缺 --no-auto');
        assert.ok(/autoResolve: options\.auto !== false/.test(cliSrc), 'CLI 未默认开启 autoResolve');
    });

    await check('installContent 递归模式逐项入池并返回 deps（运行时 mock）', async () => {
        const config = require(path.join(SRC, 'config'));
        const origDir = config.getConfig('pool.dir', 'pool');
        const tmpRel = path.join('test', `.tmp_pool_deps_${process.pid}`);
        const tmpAbs = path.join(__dirname, '..', tmpRel);
        fs.emptyDirSync(tmpAbs);
        config.setConfig('pool.dir', tmpRel);
        const dep = require(path.join(SRC, 'dep_resolver'));
        const ci = require(path.join(SRC, 'content_installer'));
        const axios = require('axios');
        const { Readable } = require('stream');
        const origResolve = dep.resolve;
        const origGet = axios.get;
        let resolveCalled = 0;
        try {
            dep.resolve = async () => {
                resolveCalled++;
                return { items: [
                    { projectId: 'jadeaddons', fileUrl: 'https://x/jadeaddons.jar', filename: 'jadeaddons.jar', depth: 0 },
                    { projectId: 'jade', fileUrl: 'https://x/jade.jar', filename: 'jade.jar', depth: 1 }
                ], warnings: [] };
            };
            // installUrl → streamDownload → axios.get：CDN 返回可读流
            axios.get = async (url) => ({
                headers: { 'content-length': '10' },
                data: Readable.from([Buffer.from('JAR-' + path.basename(new URL(url).pathname))])
            });
            const poolInstaller = require(path.join(SRC, 'pool_installer'));
            const r = await poolInstaller.installContent({ input: 'jadeaddons', category: 'mods' });
            assert.strictEqual(resolveCalled, 1, '未走 dep_resolver');
            assert.strictEqual(r.ok, true, `installContent 失败: ${r.error}`);
            assert.strictEqual(r.installed.length, 2, '本体+依赖应各入池一次');
            assert.deepStrictEqual(r.deps, ['jade'], '依赖清单应含 jade');
        } finally {
            dep.resolve = origResolve;
            axios.get = origGet;
            config.setConfig('pool.dir', origDir);
            fs.removeSync(tmpAbs);
        }
    });

    // ==================== 问题三：手动版本引导 ====================
    console.log('\n=== 问题三：手动模式版本与依赖提示 ===\n');

    await check('mod_search 导出 listVersions / getVersionDependencies', () => {
        const ms = require(path.join(SRC, 'mod_search'));
        assert.strictEqual(typeof ms.listVersions, 'function');
        assert.strictEqual(typeof ms.getVersionDependencies, 'function');
    });

    await check('后端注册版本列表 / 指定版本依赖 API', () => {
        assert.ok(/app\.get\('\/api\/mod\/versions'/.test(wsSrc), '缺版本列表 API');
        assert.ok(/app\.get\('\/api\/mod\/version-deps'/.test(wsSrc), '缺版本依赖 API');
    });

    await check('前端有自动解析开关 + 版本下拉 + 依赖展示区', () => {
        for (const id of ['install-auto-resolve', 'install-manual-area', 'install-version-select', 'install-deps-info']) {
            assert.ok(downHtml.includes(`id="${id}"`), `缺节点 ${id}`);
        }
        assert.ok(downHtml.includes("'/api/mod/versions?'"), '未拉版本列表');
        assert.ok(downHtml.includes("'/api/mod/version-deps?'"), '未拉版本依赖');
    });

    await check('前端三选一弹窗：全装 / 仅装本体 / 取消', () => {
        assert.ok(downHtml.includes('id="install-deps-modal"'), '缺三选一弹窗');
        for (const id of ['install-deps-all', 'install-deps-only', 'install-deps-cancel']) {
            assert.ok(downHtml.includes(`id="${id}"`), `缺按钮 ${id}`);
        }
        assert.ok(/该模组需要/.test(downHtml), '缺前置依赖提示文案');
    });

    await check('仅装本体走 --no-auto，全装不加该参数', () => {
        assert.ok(/if \(!withDeps\) args\.push\('--no-auto'\)/.test(downHtml), '仅装本体未加 --no-auto');
        assert.ok(/depsBtnAll\.addEventListener\('click', \(\) => submitInstall\(true\)\)/.test(downHtml), '全装未走 withDeps=true');
    });

    console.log(`\n----------------------------------------`);
    if (fail === 0) console.log(`✅ 全部通过：${pass} 项`);
    else console.log(`❌ ${fail} 项失败 / ${pass} 项通过`);
    process.exitCode = fail === 0 ? 0 : 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
