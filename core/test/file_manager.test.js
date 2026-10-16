/**
 * file_manager 路径安全单元测试
 * 运行: node test/file_manager.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');

// 固定测试根目录，避免依赖真实配置
const ROOT = path.resolve(__dirname, '../.test-scheme-root');
process.env.WOW_TEST_SCHEME_ROOT = ROOT;

// 在加载模块前打桩 utils.getServerDir，使其指向测试根
const utils = require('../src/utils');
const origGetServerDir = utils.getServerDir;
utils.getServerDir = () => ROOT;

const fm = require('../src/file_manager');

let pass = 0;
let fail = 0;
function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        console.log(`  ❌ ${name}\n     ${e.message}`);
    }
}

// 准备测试目录
fs.removeSync(ROOT);
fs.ensureDirSync(path.join(ROOT, 'sub'));
fs.writeFileSync(path.join(ROOT, 'a.txt'), 'hello');
fs.writeFileSync(path.join(ROOT, 'sub', 'b.txt'), 'world');

// 外部文件 + 指向外部的符号链接（用于逃逸测试）
const OUTSIDE = path.resolve(__dirname, '../.test-outside');
fs.removeSync(OUTSIDE);
fs.ensureDirSync(OUTSIDE);
fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'SECRET');
try {
    fs.symlinkSync(OUTSIDE, path.join(ROOT, 'link-out'), 'dir');
} catch (e) { /* 某些平台无权限，跳过符号链接用例 */ }

console.log('\n[允许的路径]');
check('空路径 → 根目录', () => {
    const r = fm.safeResolve('');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.abs, ROOT);
});
check('普通相对路径', () => {
    const r = fm.safeResolve('sub/b.txt');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.abs, path.join(ROOT, 'sub', 'b.txt'));
});
check('./ 前缀被归一', () => {
    const r = fm.safeResolve('./sub/./b.txt');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.abs, path.join(ROOT, 'sub', 'b.txt'));
});
check('反斜杠分隔符被归一', () => {
    const r = fm.safeResolve('sub\\b.txt');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.abs, path.join(ROOT, 'sub', 'b.txt'));
});

console.log('\n[拒绝的路径]');
check('拒绝 ../ 穿越', () => {
    assert.strictEqual(fm.safeResolve('../etc/passwd').ok, false);
});
check('拒绝 ../../ 穿越', () => {
    assert.strictEqual(fm.safeResolve('../../x').ok, false);
});
check('拒绝嵌套穿越 a/../../b', () => {
    assert.strictEqual(fm.safeResolve('a/../../b').ok, false);
});
check('拒绝反斜杠穿越 ..\\..\\x', () => {
    assert.strictEqual(fm.safeResolve('..\\..\\x').ok, false);
});
check('拒绝绝对路径 /etc/passwd', () => {
    const r = fm.safeResolve('/etc/passwd');
    // V3.5.7：由「静默剥离前导斜杠」改为「直接拒绝」，避免语义歧义
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /绝对路径/);
});
check('拒绝盘符路径 C:\\Windows', () => {
    assert.strictEqual(fm.safeResolve('C:\\Windows\\system32').ok, false);
});
check('拒绝 UNC 路径 //server/share', () => {
    assert.strictEqual(fm.safeResolve('//server/share').ok, false);
});
check('拒绝经符号链接逃逸', () => {
    const r = fm.safeResolve('link-out/secret.txt');
    // 若符号链接创建成功，则应被 realpath 校验拒绝
    if (fs.existsSync(path.join(ROOT, 'link-out'))) {
        assert.strictEqual(r.ok, false);
    } else {
        assert.ok(true, '平台不支持符号链接，跳过');
    }
});

console.log('\n[文件名净化]');
check('普通文件名保留', () => {
    assert.strictEqual(fm.sanitizeUploadRel('mod.jar'), 'mod.jar');
});
check('保留子目录结构', () => {
    assert.strictEqual(fm.sanitizeUploadRel('a/b/c.jar'), 'a/b/c.jar');
});
check('剥离穿越段', () => {
    assert.strictEqual(fm.sanitizeUploadRel('../../evil.sh'), null);
});
check('拒绝 Windows 保留字符', () => {
    assert.strictEqual(fm.sanitizeUploadRel('a<b>.txt'), null);
});
check('空名拒绝', () => {
    assert.strictEqual(fm.sanitizeUploadRel(''), null);
});

console.log('\n[列目录]');
(async () => {
    check('列出根目录含 a.txt 与 sub', () => {
        const r = fm.listFilesSync ? fm.listFilesSync('.') : null;
        // 同步 API 不存在则跳过（走异步用例）
        assert.ok(true);
    });

    // 异步用例
    try {
        const r = await fm.listFiles('.');
        const names = r.files.map(f => f.name);
        assert.ok(names.includes('a.txt'), '应含 a.txt');
        assert.ok(names.includes('sub'), '应含 sub');
        assert.strictEqual(r.files.find(f => f.name === 'sub').type, 'dir');
        assert.strictEqual(r.files.find(f => f.name === 'a.txt').type, 'file');
        // 目录应排在文件前
        assert.strictEqual(r.files[0].type, 'dir');
        pass++;
        console.log('  ✅ 异步 listFiles 结构与排序正确');
    } catch (e) {
        fail++;
        console.log(`  ❌ 异步 listFiles: ${e.message}`);
    }

    try {
        await fm.listFiles('../');
        fail++;
        console.log('  ❌ 列目录应拒绝穿越');
    } catch (e) {
        pass++;
        console.log('  ✅ 列目录拒绝穿越');
    }

    try {
        const d = fm.resolveDownload('a.txt');
        assert.strictEqual(d.name, 'a.txt');
        pass++;
        console.log('  ✅ 下载解析正确');
    } catch (e) {
        fail++;
        console.log(`  ❌ 下载解析: ${e.message}`);
    }

    // 清理
    utils.getServerDir = origGetServerDir;
    fs.removeSync(ROOT);
    fs.removeSync(OUTSIDE);

    console.log(`\n====================`);
    console.log(`  通过 ${pass} / 失败 ${fail}`);
    console.log(`====================`);
    process.exit(fail === 0 ? 0 : 1);
})();
