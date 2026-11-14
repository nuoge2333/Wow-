#!/usr/bin/env node
/**
 * V3.8.0：mod_search 扩展测试
 * - 默认源 modrinth（优先）
 * - category / version / loader facet 拼接
 * - mod vs plugin 分支（project_type facet + URL + 返回 projectType）
 * 全程不联网：把 axios.get 打桩，按 URL 前缀返回假数据。
 */

const assert = require('assert');
const path = require('path');
const axios = require('axios');

const SRC = path.join(__dirname, '..', 'src');
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

// ---- 打桩 axios ----
const realGet = axios.get;
let lastSearchParams = null;
function makeVersionHit(name, url, version) {
    return {
        version_number: version,
        files: [{ url, filename: name + '.jar', primary: true }]
    };
}
axios.get = async (url, opts) => {
    if (/\/search$/.test(url)) {
        lastSearchParams = opts.params;
        return { data: { hits: [
            { project_id: 'abc', slug: 'abc-mod', title: 'ABC Mod', author: 'a', downloads: 1234,
              description: 'd', versions: ['1.20.1'], categories: ['fabric', 'technology'] }
        ] } };
    }
    if (/\/project\/[^/]+\/version$/.test(url)) {
        return { data: [ makeVersionHit('abc', 'https://dl/abc.jar', '1.0.0') ] };
    }
    if (/\/project\/[^/]+$/.test(url)) {
        return { data: { id: 'abc', slug: 'abc-mod', title: 'ABC Mod', downloads: 1234,
                         description: 'd', team: 'team1' } };
    }
    if (/\/team\//.test(url)) {
        return { data: [{ role: 'Owner', user: { username: 'owner1' } }] };
    }
    throw new Error('unmocked axios.get: ' + url);
};

// ==================== 纯函数 ====================
console.log('\n归一化函数\n');

check('normalizeLoader：模组端 forge → forge', () => {
    assert.strictEqual(modSearch.normalizeLoader('forge'), 'forge');
});
check('normalizeLoader：模组端 bukkit → null（非模组加载器）', () => {
    assert.strictEqual(modSearch.normalizeLoader('bukkit'), null);
});
check('normalizeLoader：插件端 bukkit 原样透传', () => {
    assert.strictEqual(modSearch.normalizeLoader('bukkit', 'plugin'), 'bukkit');
});
check('normalizeLoader：all / 空 → null', () => {
    assert.strictEqual(modSearch.normalizeLoader('all'), null);
    assert.strictEqual(modSearch.normalizeLoader(''), null);
});

check('normalizeCategory：中文「科技」→ technology', () => {
    assert.strictEqual(modSearch.normalizeCategory('科技'), 'technology');
});
check('normalizeCategory：中文「魔法」→ magic', () => {
    assert.strictEqual(modSearch.normalizeCategory('魔法'), 'magic');
});
check('normalizeCategory：中文「优化」→ optimization', () => {
    assert.strictEqual(modSearch.normalizeCategory('优化'), 'optimization');
});
check('normalizeCategory：中文「库」→ library', () => {
    assert.strictEqual(modSearch.normalizeCategory('库'), 'library');
});
check('normalizeCategory：已是 slug 原样透传', () => {
    assert.strictEqual(modSearch.normalizeCategory('adventure'), 'adventure');
});
check('normalizeCategory：all → null', () => {
    assert.strictEqual(modSearch.normalizeCategory('all'), null);
});

// ==================== search 行为 ====================
console.log('\nsearch（Modrinth，打桩）\n');

checkAsync('缺省 source → modrinth 优先', async () => {
    const r = await modSearch.search(undefined, 'jei');
    assert.strictEqual(r.source, 'modrinth');
});

checkAsync('source=cf 路由到 curseforge', async () => {
    const r = await modSearch.search('cf', 'jei', { projectType: 'mod' });
    assert.strictEqual(r.source, 'curseforge');
});

checkAsync('category 拼进 facets（科技→technology）', async () => {
    lastSearchParams = null;
    await modSearch.search('modrinth', 'storage', { category: '科技', loader: 'forge', version: '1.20.1' });
    const facets = JSON.parse(lastSearchParams.facets);
    const flat = facets.map(g => g[0]);
    assert.ok(flat.includes('categories:technology'), '缺 categories:technology');
    assert.ok(flat.includes('categories:forge'), '缺 categories:forge');
    assert.ok(flat.includes('versions:1.20.1'), '缺 versions:1.20.1');
    assert.ok(flat.includes('project_type:mod'), '缺 project_type:mod');
});

checkAsync('projectType=plugin → project_type:plugin 且结果带 projectType', async () => {
    lastSearchParams = null;
    const r = await modSearch.search('modrinth', 'worldedit', { projectType: 'plugin' });
    const facets = JSON.parse(lastSearchParams.facets);
    const flat = facets.map(g => g[0]);
    assert.ok(flat.includes('project_type:plugin'), '缺 project_type:plugin');
    assert.strictEqual(r.projectType, 'plugin');
    assert.strictEqual(r.results[0].projectType, 'plugin');
    // 插件搜索的详情 URL 用 /plugin/ 而非 /mod/
    assert.ok(r.results[0].url.includes('/plugin/'), '插件 URL 应含 /plugin/');
});

checkAsync('空关键词 → 直接返回空结果，不发起请求', async () => {
    lastSearchParams = 'SHOULD_NOT_BE_SET';
    const r = await modSearch.search('modrinth', '   ', { loader: 'forge' });
    assert.deepStrictEqual(r.results, []);
    assert.strictEqual(lastSearchParams, 'SHOULD_NOT_BE_SET');
});

checkAsync('返回结果含 download_url / filename / loaders 过滤', async () => {
    const r = await modSearch.search('modrinth', 'jei', { loader: 'fabric' });
    const hit = r.results[0];
    assert.strictEqual(hit.download_url, 'https://dl/abc.jar');
    assert.strictEqual(hit.filename, 'abc.jar');
    assert.ok(hit.loaders.includes('fabric'), 'loaders 应含 fabric');
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
