/**
 * V3.5.11 Fabric 方案自动装配 Fabric API 静态校验
 *
 * 背景：Fabric 模组普遍硬依赖 Fabric API，空方案启动即缺依赖。
 * scheme_manager.create() 现在对 fabric 方案自动从 Modrinth（项目 P7dR8mSH）
 * 按 MC 版本解析并装配，失败只警告不阻断（与「自更新失败不阻断启动」同一原则）。
 *
 * 运行：cd core && node test/fabric_api.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SM = path.join(__dirname, '..', 'src', 'scheme_manager.js');
const sm = fs.readFileSync(SM, 'utf8');
const MS = path.join(__dirname, '..', 'src', 'mod_search.js');
const ms = fs.readFileSync(MS, 'utf8');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\nFabric API 自动装配校验 (V3.5.11)\n');

console.log('— create() 挂钩 —');
check('create() 对 fabric 方案触发自动装配（排除整合包导入）', () => {
    assert.ok(
        /!fromPack && String\(loader\)\.toLowerCase\(\) === 'fabric'/.test(sm),
        '未找到 fabric 装配条件（应排除 fromPack）'
    );
    assert.ok(
        /await this\._autoInstallFabricApi\(schemePath, version\)/.test(sm),
        '未调用 _autoInstallFabricApi(schemePath, version)'
    );
});
check('装配结果进入 mods 列表（参与元数据与状态判定）', () => {
    assert.ok(
        /const fabricApi = await this\._autoInstallFabricApi[\s\S]{0,120}?if \(fabricApi\) mods\.push\(fabricApi\)/.test(sm),
        'fabricApi 未 push 进 mods'
    );
});

console.log('\n— _autoInstallFabricApi 方法实现 —');
check('方法存在且按 MC 版本解析', () => {
    assert.ok(/async _autoInstallFabricApi\(schemePath, mcVersion\)/.test(sm));
});
check('使用 Modrinth fabric-api 项目 P7dR8mSH', () => {
    assert.ok(/P7dR8mSH/.test(sm), '未使用 fabric-api 项目 ID');
});
check('经 mod_search.pickModrinthFile 解析（loader=fabric + MC 版本）', () => {
    assert.ok(
        /modSearch\.pickModrinthFile\(FABRIC_API_PROJECT, 'fabric', mcVersion\)/.test(sm),
        '未按项目+loader+版本解析'
    );
});
check('下载到方案 mods/ 目录', () => {
    assert.ok(/path\.join\(schemePath, 'mods'\)/.test(sm), '未装入方案 mods/');
});
check('入资源池共享（切换方案时可补齐/瘦身）', () => {
    assert.ok(
        /_addToPool\(dest, 'mods', `fabric\/\$\{mcVersion\}`, modHash, file\.filename\)/.test(sm),
        '未按 mods/fabric/<版本>/<文件名> 入池'
    );
    assert.ok(/_isResourceInPool\(modHash\)/.test(sm), '入池前未做去重检查');
});
check('失败只警告不阻断（try/catch 返回 null）', () => {
    const m = sm.match(/async _autoInstallFabricApi\(schemePath, mcVersion\) \{[\s\S]*?\n    \}/);
    assert.ok(m, '未找到方法体');
    const body = m[0];
    assert.ok(/try\s*\{/.test(body), '缺少 try');
    assert.ok(/catch \(e\)/.test(body), '缺少 catch');
    assert.ok(/return null;/.test(body), '失败路径未返回 null');
    assert.ok(/不影响方案创建/.test(body), '失败提示未说明不阻断建方案');
});
check('未找到适配版本时安全跳过', () => {
    assert.ok(/未找到适配当前版本的 Fabric API，跳过自动装配/.test(sm));
});
check('文件已存在时不重复下载', () => {
    assert.ok(/Fabric API 已存在/.test(sm));
});

console.log('\n— mod_search 导出 —');
check('mod_search 导出 pickModrinthFile', () => {
    assert.ok(/module\.exports = \{[^}]*pickModrinthFile/.test(ms), '未导出 pickModrinthFile');
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
