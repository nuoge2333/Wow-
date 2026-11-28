/**
 * 下载流程三项回归（静态源码断言，不联网）：
 *   1. 搜索结果「依赖」按钮回滚旧版：与详情按钮职责区分，一键下载本体+依赖到池；
 *   2. 下载弹窗：勾选自动解析后展示兼容方案多选，确认后 --schemes 直装方案目录；
 *   3. 无兼容方案：一律取消勾选并禁用自动解析，给出提示；
 *   4. 后端：/api/schemes/compatible 端点 + pool_installer.installToSchemes。
 * 运行：cd core && node test/download_flow.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOWN = fs.readFileSync(path.join(ROOT, 'web', 'down.html'), 'utf8');
const WS = fs.readFileSync(path.join(ROOT, 'core', 'src', 'web_service.js'), 'utf8');
const PI = fs.readFileSync(path.join(ROOT, 'core', 'src', 'pool_installer.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n下载流程三项回归\n');

// ── 需求 3：依赖按钮回滚旧版 ──
check('依赖按钮与详情按钮事件绑定已拆分', () => {
    assert.ok(/\.btn-sm\.info'\)/.test(DOWN), '详情按钮应独立绑定');
    assert.ok(/\.btn-sm\.deps'\)/.test(DOWN), '依赖按钮应独立绑定');
    assert.ok(!/\.btn-sm\.info,\s*\.result-item \.btn-sm\.deps/.test(DOWN), '依赖按钮不应再与详情共用一个绑定');
});
check('依赖按钮调用 downloadWithDeps 一键下载含依赖', () => {
    assert.ok(/function downloadWithDeps\(/.test(DOWN), '缺 downloadWithDeps');
    assert.ok(/\.btn-sm\.deps'\)[\s\S]{0,200}downloadWithDeps\(/.test(DOWN), '依赖按钮未绑定 downloadWithDeps');
    assert.ok(/downloadWithDeps[\s\S]{0,500}--source/.test(DOWN), 'downloadWithDeps 未走 install --source');
    assert.ok(!/downloadWithDeps[\s\S]{0,600}--schemes/.test(DOWN), '依赖按钮不应带 --schemes（只下载到池）');
});

// ── 需求 2：下载弹窗方案多选 + 直装 ──
check('弹窗含兼容方案多选区与无方案警示区', () => {
    for (const id of ['install-schemes-area', 'install-schemes-list', 'install-schemes-hint', 'install-no-scheme-warn']) {
        assert.ok(DOWN.includes(`id="${id}"`), `缺少 ${id}`);
    }
});
check('打开弹窗拉取兼容方案列表', () => {
    assert.ok(DOWN.includes("'/api/schemes/compatible?kind='"), '未调用兼容方案 API');
});
check('无兼容方案：一律取消勾选并禁用自动解析', () => {
    assert.ok(/compatibleSchemes\.length[\s\S]{0,300}installAutoResolve\.checked = false/.test(DOWN)
        || /!compatibleSchemes\.length[\s\S]{0,200}installAutoResolve\.checked = false/.test(DOWN),
        '无兼容方案时未取消勾选');
    assert.ok(/installAutoResolve\.disabled = true/.test(DOWN), '未禁用自动解析复选框');
});
check('勾选自动解析时展示方案多选，取消时切回手动版本区', () => {
    assert.ok(/installSchemesArea\.style\.display = \(on && compatibleSchemes\.length\)/.test(DOWN), 'change 未联动方案区');
    assert.ok(/function selectedInstallSchemes\(/.test(DOWN), '缺读取勾选方案函数');
});
check('确认时把选中方案作为 --schemes 传给后端', () => {
    assert.ok(/args\.push\('--schemes', targets\.join\(','\)\)/.test(DOWN), '未传 --schemes');
    assert.ok(/submitInstall\(true, targets\)/.test(DOWN), '自动解析确认未带方案');
});
check('后端提供 /api/schemes/compatible 端点', () => {
    assert.ok(WS.includes("app.get('/api/schemes/compatible'"), '缺兼容方案端点');
    assert.ok(WS.includes('hasCompatible'), '端点未返回 hasCompatible');
});
check('后端 installToSchemes 直装兼容方案', () => {
    assert.ok(PI.includes('function installToSchemes('), '缺 installToSchemes');
    assert.ok(PI.includes('function isSchemeCompatible('), '缺 isSchemeCompatible');
    assert.ok(/--schemes <names>/.test(fs.readFileSync(path.join(ROOT, 'core', 'src', 'cli.js'), 'utf8')), 'CLI 未暴露 --schemes');
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
