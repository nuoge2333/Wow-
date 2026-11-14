#!/usr/bin/env node
/**
 * V3.8.0：dep_resolver 测试
 * - 递归深度上限 MAX_DEPTH=3 截断
 * - 环路防护（visited）
 * - API 超时 / 异常 → 降级提示，不抛致命错
 * - Modrinth 主路径 + CurseForge 尽力而为
 * 全程不联网：打桩 axios.get（Modrinth 版本接口）。
 */

const assert = require('assert');
const path = require('path');
const axios = require('axios');

const SRC = path.join(__dirname, '..', 'src');
const dep = require(path.join(SRC, 'dep_resolver'));
const modSearch = require(path.join(SRC, 'mod_search'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
async function checkAsync(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ---- 打桩 Modrinth 版本接口 ----
const realGet = axios.get;
// projectId → version 定义
function ver(url, filename, deps) {
    return { version_number: '1.0', files: [{ url, filename, primary: true }], dependencies: deps || [] };
}
const VERSIONS = {
    A: ver('https://dl/A.jar', 'A.jar', [{ project_id: 'B', dependency_type: '0' }]),
    B: ver('https://dl/B.jar', 'B.jar', [{ project_id: 'C', dependency_type: '0' }]),
    C: ver('https://dl/C.jar', 'C.jar', [{ project_id: 'D', dependency_type: '0' }]),
    D: ver('https://dl/D.jar', 'D.jar', [{ project_id: 'E', dependency_type: '0' }]),
    LOOP1: ver('https://dl/L1.jar', 'L1.jar', [{ project_id: 'LOOP2', dependency_type: '0' }]),
    LOOP2: ver('https://dl/L2.jar', 'L2.jar', [{ project_id: 'LOOP1', dependency_type: '0' }]),
    E: ver('https://dl/E.jar', 'E.jar', []),
    SLOW: null, // 模拟「无可用版本」
    TIMEOUT: 'TIMEOUT' // 模拟请求超时
};
axios.get = async (url) => {
    const m = url.match(/\/project\/([^/?]+)\/version/);
    if (m) {
        const id = m[1];
        const v = VERSIONS[id];
        if (v === 'TIMEOUT') {
            const e = new Error('timeout');
            e.code = 'ECONNABORTED';
            throw e;
        }
        if (v === null) return { data: [] };
        return { data: [v] };
    }
    throw new Error('unmocked: ' + url);
};

console.log('\ndep_resolver\n');

const tasks = [];
function run(name, fn) { tasks.push(checkAsync(name, fn)); }

run('MAX_DEPTH 导出为 3', async () => {
    assert.strictEqual(dep.MAX_DEPTH, 3);
});

run('单项目无依赖 → 仅 1 条', async () => {
    const r = await dep.resolve({ source: 'modrinth', projectId: 'E', loader: 'fabric', mcVersion: '1.20.1' });
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].projectId, 'E');
    assert.deepStrictEqual(r.warnings, []);
});

run('依赖递归：A→B→C→D，深度=3 截断 D 的依赖', async () => {
    const r = await dep.resolve({ source: 'modrinth', projectId: 'A', loader: 'fabric', mcVersion: '1.20.1' });
    const ids = r.items.map(i => i.projectId);
    assert.deepStrictEqual(ids, ['A', 'B', 'C', 'D']);
    // D 有依赖但不递归（已到深度 3）
    assert.ok(r.warnings.some(w => w.includes('深度上限')), '应有深度上限降级提示');
});

run('环路防护：LOOP1↔LOOP2 不无限递归', async () => {
    const r = await dep.resolve({ source: 'modrinth', projectId: 'LOOP1', loader: 'fabric', mcVersion: '1.20.1' });
    const ids = r.items.map(i => i.projectId);
    assert.deepStrictEqual(ids, ['LOOP1', 'LOOP2']);
    assert.ok(r.warnings.some(w => w.includes('防环')), '应有防环提示');
});

run('API 超时 → 降级提示且不抛错', async () => {
    const r = await dep.resolve({ source: 'modrinth', projectId: 'TIMEOUT', loader: 'fabric', mcVersion: '1.20.1' });
    assert.deepStrictEqual(r.items, []);
    assert.ok(r.warnings.length > 0, '应有降级提示');
    assert.ok(r.warnings[0].includes('降级') || r.warnings[0].includes('失败'), '提示应说明降级/失败');
});

run('无可用版本 → 跳过并记录', async () => {
    const r = await dep.resolve({ source: 'modrinth', projectId: 'SLOW', loader: 'fabric', mcVersion: '1.20.1' });
    assert.deepStrictEqual(r.items, []);
    assert.ok(r.warnings.some(w => w.includes('无可用版本')), '应提示无可用版本');
});

run('depth 字段随递归递增', async () => {
    const r = await dep.resolve({ source: 'modrinth', projectId: 'A', loader: 'fabric', mcVersion: '1.20.1' });
    const byId = Object.fromEntries(r.items.map(i => [i.projectId, i.depth]));
    assert.strictEqual(byId.A, 0);
    assert.strictEqual(byId.B, 1);
    assert.strictEqual(byId.C, 2);
    assert.strictEqual(byId.D, 3);
});

run('CurseForge 路由可用（无 Key 时降级，不抛致命错）', async () => {
    // cf_client 无 Key 会走降级并可能抛错，resolve 应捕获并降级
    const r = await dep.resolve({ source: 'curseforge', projectId: '123', loader: 'bukkit', mcVersion: '1.20.1' });
    // 不论 CF 是否可用，都不应抛出（已 catch 降级）；结果可能为 0 条或含条目
    assert.ok(Array.isArray(r.items));
    assert.ok(Array.isArray(r.warnings));
});

(async () => {
    await Promise.all(tasks);
    console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
})();
