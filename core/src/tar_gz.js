'use strict';
/**
 * 轻量 tar.gz 打包/解包（纯 Node 内置 zlib 实现，零第三方依赖）。
 *
 * 用途：模组端 libraries/ 目录的「整体压缩 / 整体解压」——
 * 这是给「整体压缩 libraries 目录」可选项用的。整体打包成单个 .tar.gz，
 * 切换方案时整包解压还原，绝不逐文件增量解压（增量会让同一版本的不同
 * 方案共享到半套依赖，是模组端最容易翻车的坑）。
 *
 * 只实现本项目需要的子集：普通文件 + 目录，保留相对路径；
 * 不解符号链接、不解硬链接、不解设备文件（遇到即跳过）。
 * 解包有严格的路径穿越防护（拒绝 .. 与绝对路径）。
 */
const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');

const BLOCK = 512;

/** 八进制字段写入（tar 规范：左补 0，末尾 \0） */
function writeOctal(buf, offset, length, value) {
    const str = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0') + '\0';
    buf.write(str, offset, length, 'ascii');
}

/** 读取 tar 八进制字段，容忍前导空格/\0 */
function readOctal(buf, offset, length) {
    let str = buf.toString('ascii', offset, offset + length).replace(/[\0 ]/g, '').trim();
    const parsed = parseInt(str, 8);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** 构建 512 字节 tar 头。type: '0'=文件 '5'=目录 */
function buildHeader(name, size, type, mode = 0o644) {
    const h = Buffer.alloc(BLOCK, 0);
    // name[100]：模组端 libraries 路径不会超过 100 字节，超长时截断到末段（保留文件名）
    let n = String(name).replace(/\\/g, '/').replace(/^\.\//, '');
    if (Buffer.byteLength(n) > 100) n = n.slice(-99);
    h.write(n, 0, 100, 'utf8');
    writeOctal(h, 100, 8, mode);       // mode
    writeOctal(h, 108, 8, 0);          // uid
    writeOctal(h, 116, 8, 0);          // gid
    writeOctal(h, 124, 12, size);      // size
    writeOctal(h, 136, 12, Math.floor(Date.now() / 1000)); // mtime
    h.fill(0x20, 148, 156);            // checksum 先填空格
    h.write(type, 156, 1, 'ascii');    // typeflag
    h.write('ustar\0', 257, 6, 'ascii'); // magic
    h.write('00', 263, 2, 'ascii');    // version
    // checksum：无符号字节和，写成 6 位八进制 + \0 + 空格
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += h[i];
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    return h;
}

/**
 * 收集目录下所有条目（文件 + 目录），返回 [{ rel, abs, isDir, size }]。
 * rel 使用 '/' 分隔，不带前导 ./，目录条目以 '/' 结尾（tar 惯例）。
 */
function collectEntries(rootDir) {
    const out = [];
    function walk(abs, rel) {
        const items = fs.readdirSync(abs).sort();
        for (const item of items) {
            const childAbs = path.join(abs, item);
            const st = fs.lstatSync(childAbs);
            const childRel = rel ? `${rel}/${item}` : item;
            if (st.isSymbolicLink()) continue;   // 模组端 libraries 不应有符号链接；跳过更安全
            if (st.isDirectory()) {
                out.push({ rel: childRel + '/', abs: childAbs, isDir: true, size: 0 });
                walk(childAbs, childRel);
            } else if (st.isFile()) {
                out.push({ rel: childRel, abs: childAbs, isDir: false, size: st.size });
            }
        }
    }
    walk(rootDir, '');
    return out;
}

/**
 * 把目录整体打包为 .tar.gz Buffer。
 * @param {string} dir 要打包的目录（其内容成为归档根，不含目录自身名字）
 * @returns {Buffer} gzip 后的 tar 归档
 */
function packDir(dir) {
    const entries = collectEntries(dir);
    const chunks = [];
    for (const e of entries) {
        chunks.push(buildHeader(e.rel, e.size, e.isDir ? '5' : '0', e.isDir ? 0o755 : 0o644));
        if (!e.isDir && e.size > 0) {
            const data = fs.readFileSync(e.abs);
            chunks.push(data);
            const pad = (512 - (e.size % 512)) % 512;
            if (pad) chunks.push(Buffer.alloc(pad, 0));
        }
    }
    // tar 结束标记：两个 512 空块
    chunks.push(Buffer.alloc(BLOCK * 2, 0));
    return zlib.gzipSync(Buffer.concat(chunks), { level: 6 });
}

/** 便捷：打包目录直接落盘 */
function packDirToFile(dir, outFile) {
    const buf = packDir(dir);
    fs.ensureDirSync(path.dirname(outFile));
    fs.writeFileSync(outFile, buf);
    return buf.length;
}

/**
 * 把 .tar.gz Buffer 整包解压到目标目录（覆盖同名文件，不删除目标目录里归档外的其他内容）。
 * 严格路径穿越防护：拒绝绝对路径、含 '..' 段、以及越出 targetDir 的条目。
 * @param {Buffer} gzBuf
 * @param {string} targetDir
 * @returns {{files:number, dirs:number}}
 */
function unpackTo(gzBuf, targetDir) {
    const tar = zlib.gunzipSync(gzBuf);
    if (tar.length < BLOCK * 2) throw new Error('tar.gz 内容过短，不是有效归档');
    const baseAbs = path.resolve(targetDir);
    fs.ensureDirSync(baseAbs);

    let offset = 0;
    let files = 0, dirs = 0;
    while (offset + BLOCK <= tar.length) {
        const header = tar.subarray(offset, offset + BLOCK);
        offset += BLOCK;
        // 全 0 块 = 结束
        if (header.every((b) => b === 0)) break;

        let name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
        const prefix = header.toString('utf8', 345, 155).replace(/\0.*$/, '');
        if (prefix) name = prefix + '/' + name;
        name = name.replace(/\\/g, '/');
        const size = readOctal(header, 124, 12);
        const type = String.fromCharCode(header[156]);

        // 路径穿越防护
        if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
            throw new Error(`拒绝解压不安全条目（绝对路径）: ${name}`);
        }
        const parts = name.split('/').filter((p) => p && p !== '.');
        if (parts.includes('..')) throw new Error(`拒绝解压不安全条目（..）: ${name}`);
        const destAbs = path.resolve(baseAbs, ...parts);
        if (destAbs !== baseAbs && !destAbs.startsWith(baseAbs + path.sep)) {
            throw new Error(`拒绝解压越界条目: ${name}`);
        }

        if (type === '5' || name.endsWith('/')) {
            fs.ensureDirSync(destAbs);
            dirs++;
            continue;
        }
        if (type !== '0' && type !== '\0') {
            // 非普通文件（链接/设备等）一律跳过
            offset += Math.ceil(size / BLOCK) * BLOCK;
            continue;
        }
        const data = tar.subarray(offset, offset + size);
        offset += Math.ceil(size / BLOCK) * BLOCK;
        fs.ensureDirSync(path.dirname(destAbs));
        fs.writeFileSync(destAbs, data);
        files++;
    }
    return { files, dirs };
}

/** 便捷：从文件整包解压到目录 */
function unpackFileTo(tarFile, targetDir) {
    return unpackTo(fs.readFileSync(tarFile), targetDir);
}

module.exports = { packDir, packDirToFile, unpackTo, unpackFileTo };
