#!/usr/bin/env node
/**
 * V3.8.0 改名兼容：旧配置键回退读取
 * ----------------------------------------------------------------
 * 「wow插件 → wow扩展」把 web.allow_plugins / plugins.enabled_loader 等键
 * 改成了 allow_extensions / extensions.*。旧用户的 wow.yaml 里仍是旧键，
 * 直接换名会让安全开关被静默重置。
 *
 * 本测试钉死：
 *   - 用户只写旧键时，新键能读到旧值；
 *   - 用户显式写了新键时，新键优先（不被旧键覆盖）；
 *   - 必须在 mergeDeep(DEFAULT_CONFIG, ...) 之前迁移，否则默认值会挡住回退。
 *
 * 运行：cd core && node test/config_legacy_alias.test.js
 */
const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CORE = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

/** 在独立子进程里用指定 wow.yaml 读取若干配置键（避免 require 缓存 / CONFIG_FILE 常量） */
function probe(yamlText, keys) {
    const cfg = path.join(os.tmpdir(), `wow_legacy_alias_${process.pid}_${Math.random().toString(16).slice(2)}.yaml`);
    fs.writeFileSync(cfg, yamlText, 'utf8');
    const script = `
        const c = require('./src/config');
        const keys = ${JSON.stringify(keys)};
        const out = {};
        for (const k of keys) out[k] = c.getConfig(k, '__MISSING__');
        console.log(JSON.stringify(out));
    `;
    const r = spawnSync(process.execPath, ['-e', script], {
        cwd: CORE, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, WOW_CONFIG_FILE: cfg }
    });
    fs.removeSync(cfg);
    if (r.status !== 0) throw new Error(`子进程失败: ${r.stderr || r.stdout}`);
    return JSON.parse((r.stdout || '').trim().split('\n').pop());
}

console.log('\n=== 旧配置键回退（V3.8.0 改名兼容） ===\n');

check('只写旧键：三个新键都读到旧值', () => {
    const out = probe(
        'web:\n  allow_plugins: true\n  allow_plugins_web: true\n' +
        'plugins:\n  enabled_loader: false\n  quiet: true\n',
        ['web.allow_extensions', 'web.allow_extensions_web',
            'extensions.enabled_loader', 'extensions.quiet']
    );
    assert.strictEqual(out['web.allow_extensions'], true);
    assert.strictEqual(out['web.allow_extensions_web'], true);
    assert.strictEqual(out['extensions.enabled_loader'], false);
    assert.strictEqual(out['extensions.quiet'], true);
});

check('新旧键并存：新键优先，旧键被忽略', () => {
    const out = probe(
        'web:\n  allow_plugins: true\n  allow_extensions: false\n',
        ['web.allow_extensions']
    );
    assert.strictEqual(out['web.allow_extensions'], false);
});

check('都没写：返回默认值，不因回退逻辑报错', () => {
    const out = probe('web:\n  port: 8080\n', ['web.allow_extensions']);
    assert.strictEqual(out['web.allow_extensions'], false);
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
