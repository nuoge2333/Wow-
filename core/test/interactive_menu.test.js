/**
 * V3.5.7 菜单改造静态校验
 *
 * 背景：interactive.js 的菜单分发依赖 readline + 真实网络/文件副作用，难以端到端跑。
 * 这里用源码级断言，确保本次改造（菜单 2 = 新建方案、菜单 13 重编号）不会被后续改动无声破坏。
 * 运行：cd core && node test/interactive_menu.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src', 'interactive.js');
const src = fs.readFileSync(SRC, 'utf8');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\n菜单改造校验 (V3.5.7)\n');

// 提取顶层 case 体，便于精确断言
// 注意：case 体内部有嵌套块，简单用 `^            }` 会在第一个嵌套 } 处提前截断，
// 因此改为「从本体开始、到下一个顶层 case 或文件尾」的区间截取。
const topCaseBodies = {};
{
    const marks = [];
    for (const m of src.matchAll(/^            case '(\d+)': \{/gm)) {
        marks.push({ num: m[1], start: m.index });
    }
    for (let i = 0; i < marks.length; i++) {
        const end = (i + 1 < marks.length) ? marks[i + 1].start : src.length;
        topCaseBodies[marks[i].num] = src.slice(marks[i].start, end);
    }
}

console.log('— 顶层 case 完整性 —');
check('顶层 case 1-15 全部存在', () => {
    for (let i = 1; i <= 15; i++) {
        assert.ok(topCaseBodies[String(i)], `缺少 case '${i}'`);
    }
});

// 菜单 2
const c2 = topCaseBodies['2'] || '';
console.log('\n— 菜单 2：新建方案 —');
check('case 2 不再是「下载/安装实例」标题', () => {
    // 只检测 printHeader 的实参，注释里提到旧名不算
    assert.ok(!/printHeader\('下载\/安装实例'\)/.test(c2), '仍残留旧标题');
});
check('case 2 标题为「新建方案」', () => {
    assert.ok(/printHeader\('新建方案'\)/.test(c2));
});
check('case 2 询问方案名', () => {
    assert.ok(/ask\(rl, '方案名称: '\)/.test(c2));
});
check('case 2 校验方案名合法性', () => {
    assert.ok(/validateNameSegment/.test(c2));
});
check('case 2 检查方案是否已存在', () => {
    assert.ok(/_schemeExists/.test(c2));
});
check('case 2 用对象签名调 create（修复位置参数 bug）', () => {
    assert.ok(/schemeManager\.create\(\s*sName\s*,\s*\{/.test(c2),
        '未使用 create(name, { ... }) 对象签名');
});
check('case 2 传入 type/version/loader/build 四项', () => {
    // 允许 ES6 简写（type,）与全写（type: type）两种形式
    for (const k of ['type', 'version', 'loader', 'build']) {
        assert.ok(new RegExp(`${k}\\s*[:,]`).test(c2), `缺少 ${k}`);
    }
});
check('case 2 不残留 create 三位置参数写法', () => {
    assert.ok(!/create\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)/.test(src),
        '仍存在 create(name, version, loader) 位置参数调用');
});
check('case 2 有 try/catch 包裹创建过程', () => {
    assert.ok(/try\s*\{[\s\S]*schemeManager\.create[\s\S]*catch/.test(c2));
});
check('case 2 引用不存在的 getSchemeDir 已移除', () => {
    assert.ok(!/utils\.getSchemeDir/.test(src));
});
check('case 2 使用 schemesDir 输出真实目录', () => {
    assert.ok(/schemesDir/.test(c2));
});

// 菜单 13
const c13 = topCaseBodies['13'] || '';
console.log('\n— 菜单 13：方案管理重编号 —');
check('case 13 存在', () => assert.ok(c13.length > 0));
check('case 13 已移除「创建方案」子项', () => {
    assert.ok(!/1\. 创建方案/.test(c13), '仍残留「1. 创建方案」');
});
check('case 13 子项编号压缩为 1-4', () => {
    assert.ok(/1\. 切换方案/.test(c13));
    assert.ok(/2\. 列出方案/.test(c13));
    assert.ok(/3\. 删除方案/.test(c13));
    assert.ok(/4\. 方案信息/.test(c13));
});
check('case 13 提示范围改为 (0-4)', () => {
    assert.ok(/请选择 \(0-4\)/.test(c13));
});
check('case 13 不再出现 5 号子项提示', () => {
    assert.ok(!/5\. 方案信息/.test(c13));
});
check('case 13 delete 已 await（异步方法）', () => {
    assert.ok(/await schemeManager\.delete\(/.test(c13));
});

// 主菜单文字
console.log('\n— 主菜单文字 —');
check('主菜单第 2 项显示「新建方案」', () => {
    assert.ok(/\['2', '新建方案'\]/.test(src));
});
check('主菜单第 2 项不再显示「下载/安装实例」', () => {
    assert.ok(!/\['2', '下载\/安装实例'\]/.test(src));
});
check('主菜单第 13 项描述已更新', () => {
    assert.ok(/\['13', '方案管理/.test(src));
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
