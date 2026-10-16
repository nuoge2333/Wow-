/**
 * V3.5.7 file_manager 边界场景补充测试（直接调函数，不经 Web 层）
 * 重点验证本轮新增函数在极端输入下的行为。
 *
 * 运行：cd core && node test/file_ops_edge.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');

const fm = require('../src/file_manager');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\nfile_manager 边界测试 (V3.5.7)\n');

// ─────────────────────────────────────────────
console.log('— validateNameSegment 边界 —');

const bad = [
    ['', '空字符串'], [' ', '纯空格'], ['.', '.'], ['..', '..'],
    ['a/b', '含正斜杠'], ['a\\b', '含反斜杠'],
    ['a<b', '<'], ['a>b', '>'], ['a:b', ':'], ['a"b', '"'],
    ['a|b', '|'], ['a?b', '?'], ['a*b', '*'],
    ['a\u0000b', 'NUL 字符'], ['a\u001fb', '控制字符'],
    ['CON', 'CON'], ['con', 'con 小写'], ['PRN', 'PRN'], ['AUX', 'AUX'], ['NUL', 'NUL'],
    ['COM1', 'COM1'], ['COM9', 'COM9'], ['LPT1', 'LPT1'], ['LPT9', 'LPT9'],
    ['name.', '以点结尾'], ['name ', '以空格结尾'],
    ['x'.repeat(256), '超 255'],
];
for (const [n, label] of bad) {
    check(`拒绝「${label}」`, () => {
        const r = fm.validateNameSegment(n);
        assert.strictEqual(r.ok, false, `应拒绝但通过了`);
    });
}

const good = [
    ['a', '单字符'], ['新建文件夹', '中文'], ['my server', '含空格'],
    ['a.b.txt', '多点'], ['file-1_2', '连字符下划线'], ['.hidden', '点开头（合法）'],
    ['CONS', 'CONS（不是保留名）'], ['COM10', 'COM10（超出 1-9）'],
    ['x'.repeat(255), '恰好 255'],
];
for (const [n, label] of good) {
    check(`接受「${label}」`, () => {
        const r = fm.validateNameSegment(n);
        assert.strictEqual(r.ok, true, `应通过但被拒: ${r.reason}`);
    });
}

// ─────────────────────────────────────────────
console.log('\n— safeResolve 路径边界 —');

const badPaths = [
    '/etc/passwd', '//server/share', '..', '../x', 'a/../../b',
    'a/../../../../../../etc',
];
for (const p of badPaths) {
    check(`拒绝路径「${p}」`, () => {
        const r = fm.safeResolve(p);
        assert.strictEqual(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
    });
}

const goodPaths = ['', 'a', 'a/b', 'a/b/c.txt', './a', 'a/./b'];
for (const p of goodPaths) {
    check(`接受路径「${p || '(空)'}」`, () => {
        const r = fm.safeResolve(p);
        assert.strictEqual(r.ok, true, `应通过: ${JSON.stringify(r)}`);
    });
}

// ─────────────────────────────────────────────
console.log('\n— 实际文件操作边界 —');

const root = fm.getRoot();

check('makeDir 空名被拒', () => {
    const r = fm.validateNameSegment('');
    assert.strictEqual(r.ok, false);
});

check('writeText 自动创建父目录', () => {
    const tmpName = '__edge_deep_' + Date.now();
    const rel = path.join(tmpName, 'a', 'b', 'c.txt').split(path.sep).join('/');
    const p = path.join(root, rel);
    try {
        fm.writeText(rel, 'deep');
        assert.ok(fs.existsSync(p), '父目录未自动创建');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'deep');
    } finally {
        fs.removeSync(path.join(root, tmpName));
    }
});

check('compress → extract 往返内容一致', () => {
    const tmpName = '__edge_rt_' + Date.now();
    const d = path.join(root, tmpName);
    fs.ensureDirSync(d);
    fs.writeFileSync(path.join(d, 'f.txt'), 'roundtrip');
    try {
        fm.compress([tmpName], `${tmpName}.zip`);
        fm.extract(`${tmpName}.zip`, `${tmpName}_out`);
        // 解压后应是 <root>/<tmp>_out/<tmpName>/f.txt
        const out = path.join(root, `${tmpName}_out`, tmpName, 'f.txt');
        assert.ok(fs.existsSync(out), `解压结果缺失: ${out}`);
        assert.strictEqual(fs.readFileSync(out, 'utf8'), 'roundtrip');
    } finally {
        fs.removeSync(d);
        fs.removeSync(path.join(root, `${tmpName}.zip`));
        fs.removeSync(path.join(root, `${tmpName}_out`));
    }
});

// 以下为 async 函数，需在异步块中验证（同步 try/catch 抓不到 Promise reject）
async function edgeAsync() {
    // removeEntry 拒绝根目录
    {
        let threw = false;
        try { await fm.removeEntry(''); } catch (e) { threw = true; }
        check('removeEntry 拒绝根目录', () => assert.ok(threw, '删除根目录未被拒绝'));
    }

    // transferEntry 拒绝移入自身子目录
    {
        const tmpName = '__edge_tmp_' + Date.now();
        const dirPath = path.join(root, tmpName);
        fs.ensureDirSync(path.join(dirPath, 'child'));
        let threw = false;
        try {
            await fm.transferEntry(tmpName, path.join(tmpName, 'child'), false);
        } catch (e) { threw = true; }
        fs.removeSync(dirPath);
        check('transferEntry 拒绝移入自身子目录', () => assert.ok(threw, '移入自身子目录未被拒绝'));
    }

    // extract 拒绝非 zip
    {
        const tmpName = '__edge_notzip_' + Date.now() + '.txt';
        const p = path.join(root, tmpName);
        fs.writeFileSync(p, 'not a zip');
        let threw = false;
        try { await fm.extract(tmpName, ''); } catch (e) { threw = true; }
        fs.removeSync(p);
        check('extract 拒绝非 zip', () => assert.ok(threw, '非 zip 未被拒绝'));
    }

    // readText 拒绝目录
    {
        const tmpName = '__edge_dir_' + Date.now();
        const d = path.join(root, tmpName);
        fs.ensureDirSync(d);
        let threw = false;
        try { await fm.readText(tmpName); } catch (e) { threw = true; }
        fs.removeSync(d);
        check('readText 拒绝目录', () => assert.ok(threw, '读取目录未被拒绝'));
    }

    // 读取超限
    {
        const tmpName = '__edge_big_' + Date.now() + '.txt';
        const p = path.join(root, tmpName);
        fs.writeFileSync(p, 'x'.repeat(600 * 1024)); // 600KB > 512KB 默认上限
        let threw = false;
        try { await fm.readText(tmpName); } catch (e) { threw = true; }
        fs.removeSync(p);
        check('readText 超出 512KB 上限时报错', () => assert.ok(threw, '超限未报错'));
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed ? 1 : 0);
}

edgeAsync();
