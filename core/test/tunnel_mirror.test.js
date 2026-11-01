#!/usr/bin/env node
/**
 * V3.5.22 新增能力测试：cloudflared 国内镜像源选择与下载完整性校验
 * ----------------------------------------------------------------
 * 覆盖点：
 *   1. resolveMirrors 的顺序（镜像优先、官方兜底）与去重
 *   2. 环境变量 / 配置项 / 内置列表 三级覆盖优先级
 *   3. 用户自定义镜像排最前，但官方永不丢失
 *   4. downloadFile 的长度校验：Content-Length 与实收字节不符必须抛错
 *      （这是本次修的真实 bug：40MB 的 cloudflared 只收到 3.8MB 就"成功"落盘）
 *   5. 配置项与 schema 已登记，否则 `wow config wow web.tunnel_mirror` 会报未知键
 *
 * 全程不联网：用本地 http server 模拟正常源 / 断流源 / 404 源。
 *
 * 运行：node test/tunnel_mirror.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

async function checkAsync(name, fn) {
    try {
        await fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const SRC = path.join(__dirname, '../src');
const tunnel = require(path.join(SRC, 'tunnel.js'));

console.log('\n===== V3.5.22 cloudflared 国内镜像 / 下载完整性 =====\n');

// ==================== 1. 镜像顺序 ====================
console.log('【镜像源顺序】');

check('内置镜像列表为三家国内代理', () => {
    const bases = tunnel.CF_MIRRORS.map(m => m.base);
    assert.deepStrictEqual(bases, [
        'https://gh-proxy.com',
        'https://ghfast.top',
        'https://ghproxy.net'
    ]);
});

check('官方地址指向 cloudflared releases/latest/download', () => {
    assert.strictEqual(
        tunnel.CF_OFFICIAL,
        'https://github.com/cloudflare/cloudflared/releases/latest/download'
    );
});

check('无自定义源时：顺序为 三家镜像 → 官方', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(() => '');
    assert.strictEqual(list.length, 4, `应为 4 个源，实际 ${list.length}`);
    assert.ok(list[0].startsWith('https://gh-proxy.com/'), list[0]);
    assert.ok(list[1].startsWith('https://ghfast.top/'), list[1]);
    assert.ok(list[2].startsWith('https://ghproxy.net/'), list[2]);
    assert.strictEqual(list[3], tunnel.CF_OFFICIAL, '官方必须排最后兜底');
});

check('每家镜像都拼上完整的 releases 前缀', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(() => '');
    for (const u of list.slice(0, 3)) {
        assert.ok(
            u.endsWith('/cloudflare/cloudflared/releases/latest/download'),
            `镜像 URL 拼接不完整: ${u}`
        );
    }
});

// ==================== 2. 覆盖优先级 ====================
console.log('\n【覆盖优先级：环境变量 > 配置项 > 内置】');

check('配置项生效时排最前，且不丢官方', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(k => (k === 'web.tunnel_mirror' ? 'https://my.mirror' : ''));
    assert.ok(list[0].startsWith('https://my.mirror/'), list[0]);
    assert.ok(list[0].endsWith('/cloudflare/cloudflared/releases/latest/download'));
    assert.strictEqual(list[list.length - 1], tunnel.CF_OFFICIAL, '官方仍需兜底');
    assert.strictEqual(list.length, 5, `自定义 1 + 内置 3 + 官方 1 = 5，实际 ${list.length}`);
});

check('环境变量优先于配置项', () => {
    process.env.WOW_CLOUDFLARED_MIRROR = 'https://env.mirror';
    const list = tunnel.resolveMirrors(k => (k === 'web.tunnel_mirror' ? 'https://cfg.mirror' : ''));
    assert.ok(list[0].startsWith('https://env.mirror/'), `应为 env，实际 ${list[0]}`);
    assert.ok(!list.some(u => u.includes('cfg.mirror')), '配置项此时应被忽略');
    delete process.env.WOW_CLOUDFLARED_MIRROR;
});

check('填完整 releases 前缀时不重复拼接', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const full = 'https://my.mirror/cloudflare/cloudflared/releases/latest/download';
    const list = tunnel.resolveMirrors(() => full);
    assert.strictEqual(list[0], full, `被重复拼接了: ${list[0]}`);
});

check('自定义源与内置重复时去重', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(() => 'https://gh-proxy.com');
    const n = list.filter(u => u.startsWith('https://gh-proxy.com/')).length;
    assert.strictEqual(n, 1, `gh-proxy 应只出现 1 次，实际 ${n}`);
    assert.strictEqual(list.length, 4, `去重后仍应是 4 个源，实际 ${list.length}`);
});
check('配置函数抛异常时回退内置列表，不影响下载', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(() => { throw new Error('config 未就绪'); });
    assert.strictEqual(list.length, 4, '异常时应退回 3 镜像 + 官方');
});

check('镜像根末尾多余的斜杠会被规范化', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(() => 'https://my.mirror///');
    assert.strictEqual(
        list[0],
        'https://my.mirror/https://github.com/cloudflare/cloudflared/releases/latest/download',
        list[0]
    );
    assert.ok(!list[0].includes('mirror///'), `末尾斜杠未清理: ${list[0]}`);
});

check('只填域名时自动补 https 协议', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(() => 'my.mirror.example');
    assert.ok(list[0].startsWith('https://my.mirror.example/'), list[0]);
});

check('内置镜像拼接出的是「镜像/完整目标URL」形态（代理站要求）', () => {
    delete process.env.WOW_CLOUDFLARED_MIRROR;
    const list = tunnel.resolveMirrors(() => '');
    assert.strictEqual(
        list[0],
        'https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download',
        list[0]
    );
});

// ==================== 3. 下载完整性 ====================
console.log('\n【下载完整性校验】');

const { downloadFile } = tunnel._internals;

/** 起一个按需行为的本地服务器，返回 baseUrl 与 close */
function makeServer(handler) {
    return new Promise(resolve => {
        const srv = http.createServer(handler);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            resolve({ srv, base: `http://127.0.0.1:${port}` });
        });
    });
}

async function runDownloadTests() {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-tunnel-test-'));
    const PAYLOAD = Buffer.alloc(200 * 1024, 0x41); // 200KB 假二进制

    // 正常源：Content-Length 与内容一致
    const ok = await makeServer((req, res) => {
        res.writeHead(200, { 'Content-Length': String(PAYLOAD.length) });
        res.end(PAYLOAD);
    });

    await checkAsync('完整下载：写入字节数与 Content-Length 一致', async () => {
        const dest = path.join(TMP, 'ok.bin');
        const n = await downloadFile(`${ok.base}/cloudflared`, dest, '测试源');
        assert.strictEqual(n, PAYLOAD.length, `返回字节数不对: ${n}`);
        assert.ok(fs.existsSync(dest), '目标文件未生成');
        assert.strictEqual(fs.statSync(dest).size, PAYLOAD.length);
        assert.ok(!fs.existsSync(dest + '.part'), '.part 临时文件应已改名');
    });
    ok.srv.close();

    // 断流源：声明 200KB，只发 20KB 就断开
    const trunc = await makeServer((req, res) => {
        res.writeHead(200, { 'Content-Length': String(PAYLOAD.length) });
        res.write(PAYLOAD.slice(0, 20 * 1024));
        setTimeout(() => res.destroy(), 50);
    });

    await checkAsync('断流下载：必须抛错，不能把半截文件当成功', async () => {
        const dest = path.join(TMP, 'trunc.bin');
        let err = null;
        try {
            await downloadFile(`${trunc.base}/cloudflared`, dest, '断流源');
        } catch (e) {
            err = e;
        }
        assert.ok(err, '断流竟然没有报错——正是这次要修的 bug');
        assert.ok(/不完整|中断|aborted|socket/i.test(err.message), `错误信息应说明原因: ${err.message}`);
    });

    await checkAsync('断流后不残留 .part 临时文件', async () => {
        const dest = path.join(TMP, 'trunc2.bin');
        try { await downloadFile(`${trunc.base}/cloudflared`, dest, '断流源'); } catch (e) { /* 预期 */ }
        assert.ok(!fs.existsSync(dest + '.part'), '.part 未清理，会污染下次下载');
        assert.ok(!fs.existsSync(dest), '坏文件不应落在正式路径上');
    });
    trunc.srv.close();

    // 404 源
    const nf = await makeServer((req, res) => {
        res.writeHead(404, { 'Content-Length': '0' });
        res.end();
    });

    await checkAsync('404 源：抛错（validateStatus 只放行 2xx）', async () => {
        let err = null;
        try {
            await downloadFile(`${nf.base}/cloudflared`, path.join(TMP, 'nf.bin'), '404源');
        } catch (e) { err = e; }
        assert.ok(err, '404 未抛错');
        assert.ok(/404/.test(err.message), `错误信息应含状态码: ${err.message}`);
    });
    nf.srv.close();

    fs.rmSync(TMP, { recursive: true, force: true });
}

// ==================== 4. 配置项登记 ====================
console.log('\n【配置项登记】');

check('config.js 默认值含 web.tunnel_mirror', () => {
    const src = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
    assert.ok(/tunnel_mirror\s*:\s*''/.test(src), 'config.js 未声明 tunnel_mirror 默认值');
});

check('config_schema.js 登记了 web.tunnel_mirror（否则 config 命令报未知键）', () => {
    const src = fs.readFileSync(path.join(SRC, 'config_schema.js'), 'utf8');
    assert.ok(src.includes("key: 'web.tunnel_mirror'"), 'schema 缺少 web.tunnel_mirror');
    assert.ok(/type:\s*'string'/.test(src), '应为 string 类型');
});

check('ensureBinary 会遍历全部源并在最后附带手动兜底提示', () => {
    const src = fs.readFileSync(path.join(SRC, 'tunnel.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function ensureBinary'));
    const body = fn.slice(0, fn.indexOf('\nfunction ', 10) > 0 ? fn.indexOf('\nfunction ', 10) : fn.length);
    assert.ok(/resolveMirrors\(/.test(body), 'ensureBinary 应使用 resolveMirrors 而不是写死地址');
    assert.ok(/已尝试/.test(body) || /全部失败/.test(body), '失败时应告知尝试过几个源');
    assert.ok(/WOW_CLOUDFLARED_MIRROR/.test(body), '失败提示里应给出环境变量覆盖办法');
});

// ==================== 汇总 ====================
(async () => {
    await runDownloadTests();

    console.log('\n----------------------------------------');
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail > 0) {
        console.log('\n失败明细：');
        failures.forEach(f => console.log(`  · ${f.name}\n    ${f.err.stack || f.err.message}`));
        process.exit(1);
    }
    console.log('✅ tunnel 镜像与下载完整性测试全部通过\n');
    process.exit(0);
})();
