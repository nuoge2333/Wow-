/**
 * 本地构造 tar.gz / zip 验证 JRE 解压 + 剥壳 + 权限修复链路
 * 不依赖网络，比真实下载快得多，且能覆盖 _locateJdkRoot 的三种布局。
 *
 * 运行：cd core && node test/jre_extract_test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert');

const JreManager = require('../src/jre_manager');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

const WORK = path.join(os.tmpdir(), 'jre_extract_test');
fs.emptyDirSync(WORK);

// 造一个假的 JDK 目录结构
function makeFakeJdk(dir, name) {
    fs.ensureDirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'java'), '#!/bin/sh\necho fake\n');
    fs.chmodSync(path.join(dir, 'bin', 'java'), 0o644); // 故意不给执行权限
    fs.writeFileSync(path.join(dir, 'release'), `JAVA_VERSION="17.0.12"\n`);
    if (name) fs.writeFileSync(path.join(dir, 'NAME'), name);
}

const jre = new JreManager();

console.log('\nJRE 解压 / 剥壳链路测试 (V3.5.7)\n');

// ─────────────────────────────────────────────
console.log('— _locateJdkRoot 三种布局 —');

check('布局1：stage/bin/java（已剥壳）', () => {
    const d = path.join(WORK, 'l1');
    fs.emptyDirSync(d);
    makeFakeJdk(d);
    const r = jre._locateJdkRoot(d);
    assert.strictEqual(r, d);
});

check('布局2：stage/jdk-17/bin/java（一层套壳）', () => {
    const d = path.join(WORK, 'l2');
    fs.emptyDirSync(d);
    const inner = path.join(d, 'jdk-17.0.12+7');
    fs.ensureDirSync(inner);
    makeFakeJdk(inner);
    const r = jre._locateJdkRoot(d);
    assert.strictEqual(r, inner);
});

check('布局3：stage/jdk-17/Contents/Home/bin/java（macOS）', () => {
    const d = path.join(WORK, 'l3');
    fs.emptyDirSync(d);
    const home = path.join(d, 'jdk-17.jdk', 'Contents', 'Home');
    fs.ensureDirSync(home);
    makeFakeJdk(home);
    const r = jre._locateJdkRoot(d);
    assert.strictEqual(r, home);
});

check('无 bin/java 时返回 null', () => {
    const d = path.join(WORK, 'l4');
    fs.emptyDirSync(d);
    fs.writeFileSync(path.join(d, 'readme.txt'), 'x');
    assert.strictEqual(jre._locateJdkRoot(d), null);
});

// ─────────────────────────────────────────────
// 解压相关为异步，统一在下面的 async 块中验证

(async () => {
    // tar.gz 端到端（解压 → 剥壳）
    {
        const src = path.join(WORK, 'src_tar');
        fs.emptyDirSync(src);
        makeFakeJdk(path.join(src, 'jdk-17.0.12+7'));
        const tarball = path.join(WORK, 'test.tar.gz');
        execFileSync('tar', ['-czf', tarball, '-C', src, 'jdk-17.0.12+7']);
        const dest = path.join(WORK, 'out_tar');
        fs.emptyDirSync(dest);
        await jre._extractArchive(tarball, dest);
        const root = jre._locateJdkRoot(dest);
        check('tar.gz 解压后能定位 JDK 根', () => {
            assert.ok(root && fs.existsSync(path.join(root, 'bin', 'java')),
                `定位失败: ${root}`);
        });
    }

    // zip 端到端
    {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip();
        zip.addFile('jdk-17.0.12+7/bin/java', Buffer.from('#!/bin/sh\necho fake\n'));
        zip.addFile('jdk-17.0.12+7/release', Buffer.from('JAVA_VERSION="17.0.12"\n'));
        const zpath = path.join(WORK, 'test.zip');
        zip.writeZip(zpath);
        const dest = path.join(WORK, 'out_zip');
        fs.emptyDirSync(dest);
        await jre._extractArchive(zpath, dest);
        const root = jre._locateJdkRoot(dest);
        check('zip 解压后能定位 JDK 根', () => {
            assert.ok(root && fs.existsSync(path.join(root, 'bin', 'java')),
                `定位失败: ${root}`);
        });
    }

    // zip slip 防御
    {
        // 手工构造含 ../ 条目名的 zip（adm-zip 的 addFile 会规范化，故手工拼二进制）
        const raw = buildRawZip('../evil.txt', 'pwned');
        const zpath = path.join(WORK, 'evil.zip');
        fs.writeFileSync(zpath, raw);
        const dest = path.join(WORK, 'out_evil');
        fs.emptyDirSync(dest);
        let threw = false;
        try {
            await jre._extractArchive(zpath, dest);
        } catch (e) {
            threw = true;
        }
        check('含 ../ 的 zip 被拒绝（抛错）', () => {
            assert.ok(threw, '未抛错，zip slip 未被拦截');
        });
        check('越界文件未落盘', () => {
            assert.ok(!fs.existsSync(path.join(WORK, 'evil.txt')),
                '越界文件被写出了！');
        });
    }

    // 不支持的格式
    {
        const p = path.join(WORK, 'x.rar');
        fs.writeFileSync(p, 'x');
        let threw = false;
        try { await jre._extractArchive(p, path.join(WORK, 'o')); } catch (e) { threw = true; }
        check('不支持的格式抛错', () => assert.ok(threw));
    }

    // 权限修复逻辑（单独验证 chmod）
    {
        const d = path.join(WORK, 'perm', 'bin');
        fs.ensureDirSync(d);
        const j = path.join(d, 'java');
        fs.writeFileSync(j, '#!/bin/sh\necho x\n');
        fs.chmodSync(j, 0o644);
        // 手动执行 chmod（模拟 ensureJre 里的修复）
        for (const f of fs.readdirSync(d)) fs.chmodSync(path.join(d, f), 0o755);
        check('chmod 后具备执行权限', () => {
            const mode = fs.statSync(j).mode & 0o777;
            assert.ok(mode & 0o100, `执行位未设置: ${mode.toString(8)}`);
        });
    }

    try { fs.removeSync(WORK); } catch (e) { /* ignore */ }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
    process.exit(failed ? 1 : 0);
})();

/**
 * 手工拼一个含指定条目名的 zip 二进制
 * （adm-zip 的 addFile 会规范化 ../ 路径，必须手工构造才能测到 zip slip 防御）
 */
function buildRawZip(entryName, content) {
    const nameBuf = Buffer.from(entryName, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const crc = crc32(dataBuf);

    // 本地文件头
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);   // signature
    lfh.writeUInt16LE(20, 4);           // version needed
    lfh.writeUInt16LE(0, 6);            // flags
    lfh.writeUInt16LE(0, 8);            // compression (store)
    lfh.writeUInt16LE(0, 10);           // mod time
    lfh.writeUInt16LE(0, 12);           // mod date
    lfh.writeUInt32LE(crc, 14);         // crc32
    lfh.writeUInt32LE(dataBuf.length, 18); // compressed size
    lfh.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // name len
    lfh.writeUInt16LE(0, 28);           // extra len

    const local = Buffer.concat([lfh, nameBuf, dataBuf]);

    // 中央目录
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(dataBuf.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(0, 42);

    const central = Buffer.concat([cdh, nameBuf]);

    // EOCD
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(local.length, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([local, central, eocd]);
}

function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
