#!/usr/bin/env node
/**
 * 多存档 + 图标画板 Web UI 静态回归：
 * - 原生 Canvas 64x64 + image-rendering:pixelated + 320px 显示
 * - 原生取色器 / 橡皮擦(clearRect) / 清空画板
 * - offsetX/5、offsetY/5 映射 + fillRect(x,y,1,1)
 * - toBlob() 导出 PNG
 * - 新建存档表单（正则校验提示 + level-type 四选项）
 * - 切换存档防呆警告
 * - 素材库双写提示 + 存入素材库勾选
 * 纯静态源码断言，不启动浏览器。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'web', 'scheme.html'), 'utf8');
const THEME = fs.readFileSync(path.join(ROOT, 'themes', 'default', 'scheme.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n多存档 + 图标画板 UI\n');

check('web/ 与 themes/default/ 的 scheme.html 一致', () => {
    assert.strictEqual(HTML, THEME);
});

check('原生 Canvas 64x64 + pixelated + 320px', () => {
    assert.ok(/<canvas id="icon-canvas" width="64" height="64">/.test(HTML), 'canvas 尺寸非 64x64');
    assert.ok(/image-rendering:\s*pixelated/.test(HTML), '未设 pixelated');
    assert.ok(/width:\s*320px;\s*height:\s*320px/.test(HTML), '显示尺寸非 320px');
});

check('无第三方 Canvas 库', () => {
    assert.ok(!/fabric\.js|konva|canvas\.min\.js|plugin.*canvas/i.test(HTML), '引入了第三方 Canvas 库');
});

check('原生取色器 input[type=color]', () => {
    assert.ok(/<input type="color" id="icon-color"/.test(HTML), '缺原生取色器');
});

check('橡皮擦用 clearRect，清空画板用 clearRect(0,0,64,64)', () => {
    assert.ok(/ctx\.clearRect\(x,\s*y,\s*1,\s*1\)/.test(HTML), '橡皮擦未用 clearRect');
    assert.ok(/ctx\.clearRect\(0,\s*0,\s*64,\s*64\)/.test(HTML), '清空画板未用 clearRect');
});

check('offsetX/5、offsetY/5 映射 + fillRect(x,y,1,1)', () => {
    assert.ok(/e\.offsetX\s*\/\s*5/.test(HTML), 'X 未按 /5 映射');
    assert.ok(/e\.offsetY\s*\/\s*5/.test(HTML), 'Y 未按 /5 映射');
    assert.ok(/ctx\.fillRect\(x,\s*y,\s*1,\s*1\)/.test(HTML), '未按 1x1 填充');
});

check('mousedown / mousemove 绘制', () => {
    assert.ok(/addEventListener\('mousedown'/.test(HTML), '未监听 mousedown');
    assert.ok(/addEventListener\('mousemove'/.test(HTML), '未监听 mousemove');
});

check('toBlob() 导出 PNG', () => {
    assert.ok(/canvas\.toBlob\(/.test(HTML), '未用 toBlob');
    assert.ok(/'image\/png'/.test(HTML), '未指定 PNG');
});

check('新建存档表单：名称正则 + 四种 level-type', () => {
    assert.ok(/\^\[a-zA-Z0-9_-\]\+\$/.test(HTML) || /\^\[a-zA-Z0-9_-\]\+\$/.test(HTML), '缺名称正则提示');
    for (const t of ['normal', 'flat', 'large_biomes', 'amplified']) {
        assert.ok(new RegExp(`value="${t}"`).test(HTML), `缺 level-type ${t}`);
    }
});

check('切换存档防呆警告', () => {
    assert.ok(/背包和成就将不会带入新世界/.test(HTML), '缺防呆警告');
});

check('存入素材库勾选 + 双写提示', () => {
    assert.ok(/id="icon-to-pool"[^>]*type="checkbox"|type="checkbox"[^>]*id="icon-to-pool"/.test(HTML), '缺存入素材库勾选');
    assert.ok(/重启服务器即可在列表看到/.test(HTML), '缺双写成功提示');
});

check('调用后端 worlds/icons API', () => {
    for (const p of ['/api/worlds', '/api/worlds/create', '/api/worlds/switch', '/api/icons/save', '/api/icons/pool', '/api/icons/apply']) {
        assert.ok(HTML.includes(p), `未调用 ${p}`);
    }
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
