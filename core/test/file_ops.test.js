/**
 * 文件操作单元测试（V3.5.7）
 * 覆盖 mkdir / rename / move / copy / remove / compress / extract / readText / writeText
 * 及跨平台名称校验、zip slip 防御。
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// 打桩：让 file_manager 的根指向测试目录
const utils = require('../src/utils');
const ROOT = path.join(os.tmpdir(), `wow-fops-${Date.now()}`);
fs.ensureDirSync(ROOT);
utils.getServerDir = () => ROOT;

const FM = require('../src/file_manager');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${extra ? ' → ' + extra : ''}`); }
}
async function expectThrow(name, fn, codeWanted) {
    try {
        await fn();
        check(name, false, '未抛错');
    } catch (e) {
        check(name, codeWanted ? e.code === codeWanted : true, `code=${e.code} msg=${e.message}`);
    }
}

(async () => {
    console.log('\n[名称校验 · 跨平台]');
    check('普通名通过', FM.validateNameSegment('mods').ok);
    check('拒绝 ../', !FM.validateNameSegment('..').ok);
    check('拒绝 .', !FM.validateNameSegment('.').ok);
    check('拒绝含 /', !FM.validateNameSegment('a/b').ok);
    check('拒绝含 \\', !FM.validateNameSegment('a\\b').ok);
    check('拒绝 Windows 保留字符 :', !FM.validateNameSegment('a:b').ok);
    check('拒绝 Windows 保留字符 *', !FM.validateNameSegment('a*b').ok);
    check('拒绝 CON', !FM.validateNameSegment('CON').ok);
    check('拒绝 COM1', !FM.validateNameSegment('COM1').ok);
    check('拒绝 LPT1.txt', !FM.validateNameSegment('LPT1.txt').ok);
    check('拒绝以点结尾', !FM.validateNameSegment('abc.').ok);
    check('拒绝以空格结尾', !FM.validateNameSegment('abc ').ok);
    check('拒绝空串', !FM.validateNameSegment('').ok);
    check('中文名通过', FM.validateNameSegment('模组').ok);
    check('含空格通过', FM.validateNameSegment('my mod').ok);

    console.log('\n[新建文件夹]');
    const mk = await FM.makeDir('', 'mods');
    check('创建成功', fs.existsSync(path.join(ROOT, 'mods')));
    check('返回相对路径', mk.path === 'mods', mk.path);
    const mk2 = await FM.makeDir('mods', 'sub');
    check('嵌套创建成功', fs.existsSync(path.join(ROOT, 'mods', 'sub')));
    await expectThrow('重复创建报 EEXIST', () => FM.makeDir('', 'mods'), 'EEXIST');
    await expectThrow('非法名被拒', () => FM.makeDir('', 'a/b'), 'EPATH');
    await expectThrow('父目录穿越被拒', () => FM.makeDir('../..', 'x'), 'EPATH');
    await expectThrow('父目录不存在', () => FM.makeDir('nope', 'x'), 'ENOENT');

    console.log('\n[重命名]');
    fs.writeFileSync(path.join(ROOT, 'mods', 'a.jar'), 'A');
    await FM.renameEntry('mods/a.jar', 'b.jar');
    check('重命名生效', fs.existsSync(path.join(ROOT, 'mods', 'b.jar')) && !fs.existsSync(path.join(ROOT, 'mods', 'a.jar')));
    await expectThrow('重命名根目录被拒', () => FM.renameEntry('', 'x'), 'EPATH');
    await expectThrow('新名非法被拒', () => FM.renameEntry('mods/b.jar', 'c/d'), 'EPATH');
    fs.writeFileSync(path.join(ROOT, 'mods', 'c.jar'), 'C');
    await expectThrow('目标已存在报 EEXIST', () => FM.renameEntry('mods/b.jar', 'c.jar'), 'EEXIST');

    console.log('\n[复制 / 移动]');
    const cp = await FM.transferEntry('mods/b.jar', '', true);
    check('复制到根', fs.existsSync(path.join(ROOT, 'b.jar')) && fs.existsSync(path.join(ROOT, 'mods', 'b.jar')));
    check('复制返回路径', cp.to === 'b.jar', cp.to);
    // 先把副本改名，避免与源同名冲突，再验证移动
    await FM.renameEntry('b.jar', 'b-moved.jar');
    const mv = await FM.transferEntry('b-moved.jar', 'mods', false);
    check('移动回 mods', !fs.existsSync(path.join(ROOT, 'b-moved.jar')) && fs.existsSync(path.join(ROOT, 'mods', 'b-moved.jar')));
    check('移动返回路径', mv.to === 'mods/b-moved.jar', mv.to);
    await expectThrow('移入自身子目录被拒', () => FM.transferEntry('mods', 'mods/sub', false), 'EPATH');
    await expectThrow('源不存在', () => FM.transferEntry('nope.jar', '', false), 'ENOENT');
    await expectThrow('目标目录不存在', () => FM.transferEntry('mods/b.jar', 'nodir', false), 'ENOENT');
    await expectThrow('复制到同名冲突报 EEXIST', () => FM.transferEntry('mods/b.jar', 'mods', true), 'EEXIST');

    console.log('\n[删除]');
    fs.writeFileSync(path.join(ROOT, 'del.txt'), 'D');
    await FM.removeEntry('del.txt');
    check('删除文件生效', !fs.existsSync(path.join(ROOT, 'del.txt')));
    fs.ensureDirSync(path.join(ROOT, 'deldir', 'deep'));
    fs.writeFileSync(path.join(ROOT, 'deldir', 'deep', 'x.txt'), 'X');
    await FM.removeEntry('deldir');
    check('递归删除目录生效', !fs.existsSync(path.join(ROOT, 'deldir')));
    await expectThrow('删除根目录被拒', () => FM.removeEntry(''), 'EPATH');
    await expectThrow('删除不存在报 ENOENT', () => FM.removeEntry('nope'), 'ENOENT');

    console.log('\n[压缩 / 解压]');
    fs.ensureDirSync(path.join(ROOT, 'zipme'));
    fs.writeFileSync(path.join(ROOT, 'zipme', 'f1.txt'), 'F1');
    fs.writeFileSync(path.join(ROOT, 'zipme', 'f2.txt'), 'F2');
    const z = await FM.compress(['zipme'], 'out.zip');
    check('压缩生成文件', fs.existsSync(path.join(ROOT, 'out.zip')));
    check('压缩返回大小', z.size > 0, String(z.size));
    const ex = await FM.extract('out.zip', 'unzipped');
    check('解压成功', fs.existsSync(path.join(ROOT, 'unzipped', 'zipme', 'f1.txt')));
    check('解压计数', ex.extracted >= 2, String(ex.extracted));
    await expectThrow('解压非 zip 被拒', () => FM.extract('zipme/f1.txt', ''), 'EPATH');

    console.log('\n[zip slip 防御]');
    // adm-zip 的 addFile 会自行规范化条目名，无法用它构造恶意 zip。
    // 这里手工拼一个最小 zip：本地文件头 + 数据 + 中央目录，条目名保留 "../../evil.txt"。
    function buildRawZip(entryName, content) {
        const nameBuf = Buffer.from(entryName, 'utf8');
        const dataBuf = Buffer.from(content, 'utf8');
        const crc = require('zlib').crc32 ? require('zlib').crc32(dataBuf) : crc32(dataBuf);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);   // 本地文件头签名
        local.writeUInt16LE(20, 4);           // 解压所需版本
        local.writeUInt16LE(0, 6);            // 标志
        local.writeUInt16LE(0, 8);            // 压缩方法 = stored
        local.writeUInt16LE(0, 10);           // 修改时间
        local.writeUInt16LE(0, 12);           // 修改日期
        local.writeUInt32LE(crc >>> 0, 14);
        local.writeUInt32LE(dataBuf.length, 18);
        local.writeUInt32LE(dataBuf.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);           // 扩展字段长度

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(crc >>> 0, 16);
        central.writeUInt32LE(dataBuf.length, 20);
        central.writeUInt32LE(dataBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(0, 42);         // 本地头偏移 = 0

        const localFull = Buffer.concat([local, nameBuf, dataBuf]);
        const centralFull = Buffer.concat([central, nameBuf]);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);             // 条目数
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(centralFull.length, 12);
        eocd.writeUInt32LE(localFull.length, 16);
        eocd.writeUInt16LE(0, 20);

        return Buffer.concat([localFull, centralFull, eocd]);
    }
    function crc32(buf) {
        let c, crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            c = (crc ^ buf[i]) & 0xFF;
            for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
            crc = (crc >>> 8) ^ c;
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    fs.writeFileSync(path.join(ROOT, 'evil.zip'), buildRawZip('../../evil.txt', 'PWNED'));
    const ev = await FM.extract('evil.zip', 'safe');
    check('逃逸条目被跳过', ev.skipped.length >= 1, `skipped=${JSON.stringify(ev.skipped)} extracted=${ev.extracted}`);
    check('未写出任何文件', ev.extracted === 0, String(ev.extracted));
    check('未污染根之外', !fs.existsSync(path.join(path.dirname(path.dirname(ROOT)), 'evil.txt')));
    check('未污染目标目录', !fs.existsSync(path.join(ROOT, 'safe', 'evil.txt')));

    console.log('\n[文本读写]');
    await FM.writeText('note.txt', 'hello 世界');
    const rd = await FM.readText('note.txt');
    check('读写一致', rd.content === 'hello 世界', rd.content);
    await expectThrow('读取目录报 EISDIR', () => FM.readText('mods'), 'EISDIR');
    await expectThrow('读取不存在报 ENOENT', () => FM.readText('nope.txt'), 'ENOENT');

    console.log('\n[路径穿越总检]');
    for (const bad of ['../etc/passwd', '..\\..\\win.ini', '/etc/passwd', 'C:\\Windows', '//server/share', 'mods/../../x']) {
        const r = FM.safeResolve(bad);
        check(`拒绝 ${bad}`, !r.ok, r.ok ? '被放行' : '');
    }

    console.log('\n====================');
    console.log(`  通过 ${pass} / 失败 ${fail}`);
    console.log('====================\n');
    fs.removeSync(ROOT);
    process.exit(fail === 0 ? 0 : 1);
})();
