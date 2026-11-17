#!/usr/bin/env node
/**
 * install 统一入池（Fetch to Pool）测试 —— V3.9.0
 * ---------------------------------------------------------------
 * 钉死三条 P0 铁律：
 *   1. install core/mod/plugin 把资源下载到 pool/<分类>/，算 SHA-256，
 *      登记 pool/index.yaml（初始引用数 0），绝不写 scheme/；
 *   2. mod install 已废弃：CLI 给出明确提示、无 --scheme 写入副作用；
 *   3. install 成功后打印「下一步 scheme create」防呆提示。
 *
 * 隔离：把 config.pool.dir 临时指向 core/test/.tmp_pool_<pid>，
 *       结束时恢复原值并清理，绝不碰真实 pool / scheme。
 *
 * 运行：cd core && node test/install_pool.test.js
 */
const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const SRC = path.join(__dirname, '../src');
const config = require(path.join(SRC, 'config'));
const utils = require(path.join(SRC, 'utils'));
const poolInstaller = require(path.join(SRC, 'pool_installer'));

let pass = 0, fail = 0;
async function check(name, fn) {
    try { await fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const CLI = path.join(__dirname, '../src/cli.js');
const { spawnSync } = require('child_process');

const origPoolDir = config.getConfig('pool.dir', 'pool');
const tmpRel = path.join('test', `.tmp_pool_${process.pid}`);
const tmpAbs = path.join(__dirname, '..', tmpRel);

async function main() {
    fs.emptyDirSync(tmpAbs);
    config.setConfig('pool.dir', tmpRel);

    console.log('\n=== install 统一入池 pool_installer ===\n');

    await check('poolRoot 指向隔离目录', () => {
        assert.strictEqual(poolInstaller.poolRoot(), tmpAbs);
    });

    await check('registerFile：算 SHA-256、登记 resources、ref_count 初始 0', async () => {
        const file = path.join(tmpAbs, 'mods', 'sample.jar');
        fs.ensureDirSync(path.dirname(file));
        fs.writeFileSync(file, 'HELLO-JAR');
        const reg = await poolInstaller.registerFile(file);
        const crypto = require('crypto');
        const expected = crypto.createHash('sha256').update('HELLO-JAR').digest('hex');
        assert.strictEqual(reg.hash, expected);
        assert.strictEqual(reg.existed, false);
        assert.strictEqual(reg.rel, 'mods/sample.jar');
        const idx = poolInstaller.loadIndex();
        assert.strictEqual(idx.resources[expected], 'mods/sample.jar');
        assert.strictEqual(idx.ref_count[expected], 0, '初始引用数必须为 0');
    });

    await check('registerFile 重复文件：保留已有引用计数，不重置', async () => {
        const file = path.join(tmpAbs, 'mods', 'sample.jar');
        const reg1 = await poolInstaller.registerFile(file);
        const idx1 = poolInstaller.loadIndex();
        idx1.ref_count[reg1.hash] = 3;
        poolInstaller.saveIndex(idx1);
        const reg2 = await poolInstaller.registerFile(file);
        assert.strictEqual(reg2.existed, true);
        assert.strictEqual(poolInstaller.loadIndex().ref_count[reg2.hash], 3, '已引用计数不得被重置');
    });

    await check('registerFile 拒绝 pool 目录外文件', async () => {
        const outside = path.join(os.tmpdir(), `outside_${process.pid}.jar`);
        fs.writeFileSync(outside, 'x');
        await assert.rejects(() => poolInstaller.registerFile(outside, { rel: '../escape.jar' }), /拒绝登记/);
        fs.unlinkSync(outside);
    });

    await check('installUrl：下载落盘到 pool 分类目录并登记', async () => {
        // 用本地 http 服务提供文件
        const http = require('http');
        const body = Buffer.from('URL-JAR-BODY');
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'content-length': body.length });
            res.end(body);
        });
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;
        try {
            const r = await poolInstaller.installUrl(`http://127.0.0.1:${port}/naughty.jar`, { category: 'plugins' });
            assert.strictEqual(r.ok, true, r.error);
            assert.ok(fs.existsSync(path.join(tmpAbs, 'plugins', 'naughty.jar')), '应落到 plugins/');
            const idx = poolInstaller.loadIndex();
            assert.strictEqual(idx.ref_count[r.hash], 0);
        } finally {
            server.close();
        }
    });

    await check('installUrl：远程文件名路径穿越被 basename 净化', async () => {
        const http = require('http');
        const server = http.createServer((req, res) => { res.writeHead(200); res.end('X'); });
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;
        try {
            const r = await poolInstaller.installUrl(`http://127.0.0.1:${port}/x.jar`, {
                category: 'mods', filename: '../../evil.jar'
            });
            assert.strictEqual(r.ok, true, r.error);
            assert.ok(fs.existsSync(path.join(tmpAbs, 'mods', 'evil.jar')), '应被净化成纯文件名 evil.jar');
            assert.ok(!fs.existsSync(path.join(tmpAbs, 'evil.jar')), '不得逃出 mods/ 目录');
        } finally {
            server.close();
        }
    });

    console.log('\n=== 防呆提示 / 废弃指令 ===\n');

    await check('nextStepHint(core) 打印存入路径 + scheme create 引导', () => {
        const lines = poolInstaller.nextStepHint('core', { type: 'paper', version: '1.20.1' });
        const text = lines.join('\n');
        assert.match(text, /paper-1\.20\.1.*pool\/cores\/paper\/1\.20\.1/);
        assert.match(text, /未创建任何服务器实例/);
        assert.match(text, /wow scheme create .* -t paper -v 1\.20\.1/);
        assert.match(text, /自动从池中读取/);
    });

    await check('nextStepHint(mod/plugin) 引导入池后再挂载', () => {
        const m = poolInstaller.nextStepHint('mod', { name: 'sodium.jar' }).join('\n');
        assert.match(m, /pool\/mods/);
        assert.match(m, /mod sync/);
        const p = poolInstaller.nextStepHint('plugin', { name: 'luckperms.jar' }).join('\n');
        assert.match(p, /pool\/plugins/);
    });

    await check('CLI：mod install 旧指令给出废弃提示', () => {
        const r = spawnSync(process.execPath, [CLI, 'mod', 'install', 'sodium'], {
            cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000,
            env: { ...process.env, WOW_CONFIG_FILE: path.join(tmpAbs, 'wow.yaml') }
        });
        assert.match((r.stdout || '') + (r.stderr || ''), /该命令已废弃.*install mod/);
    });

    await check('CLI：install --help 列出 core / mod / plugin', () => {
        const r = spawnSync(process.execPath, [CLI, 'install', '--help'], {
            cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000
        });
        const out = (r.stdout || '') + (r.stderr || '');
        for (const c of ['core', 'mod', 'plugin']) assert.ok(out.includes(c), `缺少 ${c}`);
        assert.match(out, /公共池|资源池/);
    });

    // 还原配置 + 清理
    config.setConfig('pool.dir', origPoolDir);
    fs.removeSync(tmpAbs);

    console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
    config.setConfig('pool.dir', origPoolDir);
    fs.removeSync(tmpAbs);
    console.error(e);
    process.exit(1);
});
