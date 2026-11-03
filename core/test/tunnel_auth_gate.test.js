#!/usr/bin/env node
/**
 * V3.5.24 新增能力测试：公网隧道的认证闸门
 * ----------------------------------------------------------------
 * 规则一句话：**隧道等于暴露，必须配 token。**
 *
 * 背景（这是本条最容易漏的地方）：
 *   已有的 isExposedHost 只看**绑定地址**。而隧道的典型用法恰恰是
 *   `web start --tunnel` —— 面板老老实实绑 127.0.0.1（isExposedHost 返回 false），
 *   然后被 cloudflared 映射成 https://xxx.trycloudflare.com，变成公网服务。
 *   所以「只在绑定地址上检查」会漏掉隧道这条路径，而这才是最危险的暴露：
 *   用户以为自己只开了本地。
 *
 * 覆盖点：
 *   1. checkTunnelAuth 的四种凭据组合
 *   2. startTunnelForLocal 在**下载 cloudflared 之前**就抛错（不能先下几十 MB）
 *   3. startWeb({tunnel:true}) 在缺凭据时：面板照常起来、隧道被跳过、返回 server
 *   4. 有凭据时不会被误拦
 *
 * 全程不联网、不起真隧道：把 tunnel 模块打桩，用假的 startTunnel 计数。
 *
 * 运行：node test/tunnel_auth_gate.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
const config = require(path.join(SRC, 'config'));
const webService = require(path.join(SRC, 'web_service'));

console.log('\n===== V3.5.24 隧道认证闸门（隧道等于暴露）=====\n');

// ---- 用内存里的假配置替换 getConfig，避免读写真实 wow.yaml ----
const realGetConfig = config.getConfig;
let fakeStore = {};
function useFakeConfig(store) {
    fakeStore = store || {};
    config.getConfig = (key, dflt) => (key in fakeStore ? fakeStore[key] : dflt);
}
function restoreConfig() {
    config.getConfig = realGetConfig;
}

// ---- 打桩 tunnel 模块，统计 startTunnel 是否被调用 ----
const tunnelPath = require.resolve(path.join(SRC, 'tunnel.js'));
let startTunnelCalls = 0;
let savedTunnelModule = null;
function stubTunnel() {
    startTunnelCalls = 0;
    savedTunnelModule = require.cache[tunnelPath];
    require.cache[tunnelPath] = {
        id: tunnelPath,
        filename: tunnelPath,
        loaded: true,
        exports: {
            startTunnel: async () => {
                startTunnelCalls++;
                return { url: 'https://fake.trycloudflare.com', pid: 1, stop() {}, logFile: '/dev/null' };
            },
            ensureBinary: async () => '/fake/cloudflared',
            detectAsset: () => ({ asset: 'x', exe: 'x' })
        }
    };
    // web_service 里是 require('./tunnel')，已缓存的引用也一并替换
    delete require.cache[require.resolve(path.join(SRC, 'web_service.js'))];
}
function restoreTunnel() {
    if (savedTunnelModule) require.cache[tunnelPath] = savedTunnelModule;
    else delete require.cache[tunnelPath];
}

// ==================== 1. checkTunnelAuth 凭据组合 ====================
console.log('【checkTunnelAuth 凭据判定】');

check('token 与 password 都为空 → 拒绝', () => {
    useFakeConfig({ web: {} });
    const r = webService.checkTunnelAuth({ quiet: true });
    assert.strictEqual(r.ok, false);
});

check('只有 auth_token → 放行', () => {
    useFakeConfig({ web: { } });
    config.getConfig = (k, d) => (k === 'web.auth_token' ? 'a-very-long-random-token' : d);
    const r = webService.checkTunnelAuth({ quiet: true });
    assert.strictEqual(r.ok, true);
});

check('只有 auth_password → 放行', () => {
    config.getConfig = (k, d) => (k === 'web.auth_password' ? 'my-password' : d);
    const r = webService.checkTunnelAuth({ quiet: true });
    assert.strictEqual(r.ok, true);
});

check('两个都配 → 放行', () => {
    config.getConfig = (k, d) => {
        if (k === 'web.auth_token') return 'tok';
        if (k === 'web.auth_password') return 'pwd';
        return d;
    };
    assert.strictEqual(webService.checkTunnelAuth({ quiet: true }).ok, true);
});

check('只有空白字符视为未配置（防 " " 绕过）', () => {
    config.getConfig = (k, d) => {
        if (k === 'web.auth_token') return '   ';
        if (k === 'web.auth_password') return '\t\n';
        return d;
    };
    assert.strictEqual(webService.checkTunnelAuth({ quiet: true }).ok, false);
});

check('null / undefined 视为未配置', () => {
    config.getConfig = (k, d) => {
        if (k === 'web.auth_token') return null;
        if (k === 'web.auth_password') return undefined;
        return d;
    };
    assert.strictEqual(webService.checkTunnelAuth({ quiet: true }).ok, false);
});

// ==================== 2. startTunnelForLocal 前置拦截 ====================
console.log('\n【startTunnelForLocal：下载 cloudflared 之前就拦下】');

async function runTunnelTests() {
    stubTunnel();
    const ws = require(path.join(SRC, 'web_service.js'));

    await checkAsync('无凭据 → 抛错，且**没有**走到 startTunnel（不会白下几十 MB）', async () => {
        config.getConfig = (k, d) => d;   // 全部返回默认值（token/password 均为 null）
        let err = null;
        try {
            await ws.startTunnelForLocal(8080);
        } catch (e) { err = e; }
        assert.ok(err, '无凭据竟然没抛错');
        assert.ok(/隧道|token|凭据/.test(err.message), `错误信息应说明原因: ${err.message}`);
        assert.strictEqual(startTunnelCalls, 0,
            `startTunnel 被调用了 ${startTunnelCalls} 次——说明闸门在下载之后，白下几十 MB`);
    });

    await checkAsync('抛出的错误信息包含可直接照做的修复命令', async () => {
        config.getConfig = (k, d) => d;
        let err = null;
        try { await ws.startTunnelForLocal(8080); } catch (e) { err = e; }
        assert.ok(err, '应抛错');
        assert.ok(/wow config set web\.auth_token/.test(err.message),
            `错误信息应给出修复命令: ${err.message}`);
    });

    await checkAsync('有 token → 放行，正常调用 startTunnel', async () => {
        config.getConfig = (k, d) => (k === 'web.auth_token' ? 'good-token' : d);
        startTunnelCalls = 0;
        const t = await ws.startTunnelForLocal(8080);
        assert.strictEqual(startTunnelCalls, 1, `startTunnel 应调用 1 次，实际 ${startTunnelCalls}`);
        assert.ok(t && t.url, '应返回隧道句柄');
        // 收尾，避免注册的 exit 钩子越积越多
        try { if (ws && typeof ws.stopWeb === 'function') { /* 不真停，只清句柄 */ } } catch (e) {}
    });

    await checkAsync('有 password → 放行', async () => {
        config.getConfig = (k, d) => (k === 'web.auth_password' ? 'good-pwd' : d);
        startTunnelCalls = 0;
        const t = await ws.startTunnelForLocal(8080);
        assert.strictEqual(startTunnelCalls, 1);
        assert.ok(t && t.url);
    });

    // ==================== 3. startWeb({tunnel:true}) ====================
    console.log('\n【startWeb({tunnel:true})：面板照常起，隧道被跳过】');

    await checkAsync('无凭据 + --tunnel → 仍然返回 server（面板本身不失败）', async () => {
        config.getConfig = (k, d) => d;   // token / password 均为 null
        startTunnelCalls = 0;
        // 端口交给系统分配（0），避免与其它测试抢端口
        const server = ws.startWeb({ port: 0, host: '127.0.0.1', tunnel: true });
        assert.ok(server, 'startWeb 应返回 server 实例，而不是 undefined');
        await new Promise((resolve) => {
            if (server.listening) return resolve();
            server.once('listening', resolve);
        });
        await new Promise(r => setTimeout(r, 250));
        assert.strictEqual(startTunnelCalls, 0,
            `无凭据时隧道仍被启动（startTunnel 调用 ${startTunnelCalls} 次）`);
        // 等 close 真正完成再进入下一项，否则下一项会撞上 isRunning 残留
        await new Promise(r => server.close(r));
    });

    await checkAsync('有凭据 + --tunnel → 隧道会被启动', async () => {
        config.getConfig = (k, d) => {
            if (k === 'web.auth_token') return 'good-token';
            return d;
        };
        // startWeb 的隧道分支是在 listen 回调里触发的，所以必须等 server 真正
        // listening 后再判断。这里用事件等，不用固定 sleep —— 否则机器一慢就假失败。
        const waitListening = (srv) => new Promise((resolve) => {
            if (srv.listening) return resolve();
            srv.once('listening', resolve);
        });
        startTunnelCalls = 0;
        const server = ws.startWeb({ port: 0, host: '127.0.0.1', tunnel: true });
        assert.ok(server, 'startWeb 应返回 server');
        await waitListening(server);
        // 隧道是异步起的（startTunnelForLocal 返回 Promise），再等一拍让它落地
        await new Promise(r => setTimeout(r, 250));
        assert.strictEqual(startTunnelCalls, 1,
            `有凭据时隧道应被启动 1 次，实际 ${startTunnelCalls}`);
        await new Promise(r => server.close(r));
        assert.strictEqual(ws.isRunning(), false,
            '外部直接 close() 后 isRunning 应回到 false，否则下一次 startWeb 会被误判为已在运行');
    });

    await checkAsync('上一轮 close 之后仍能再次 startWeb（isRunning 未残留）', async () => {
        config.getConfig = (k, d) => d;
        startTunnelCalls = 0;
        const server = ws.startWeb({ port: 0, host: '127.0.0.1', tunnel: false });
        assert.ok(server, '二次 startWeb 应返回 server —— 返回 undefined 说明 isRunning 残留了');
        await new Promise(r => server.close(r));
    });

    restoreTunnel();
    delete require.cache[require.resolve(path.join(SRC, 'web_service.js'))];
}

// ==================== 4. 源码级断言 ====================
console.log('\n【源码结构：两道闸门都在正确位置】');

const src = fs.readFileSync(path.join(SRC, 'web_service.js'), 'utf8');

check('startTunnelForLocal 内第一件事就是检查（在 require tunnel 之前）', () => {
    const i = src.indexOf('async function startTunnelForLocal');
    assert.ok(i > 0, '未找到 startTunnelForLocal');
    const seg = src.slice(i, i + 900);
    const gate = seg.indexOf('checkTunnelAuth');
    const reqTunnel = seg.indexOf("require('./tunnel')");
    assert.ok(gate > 0, 'startTunnelForLocal 内没有 checkTunnelAuth');
    assert.ok(reqTunnel > gate, '闸门必须在 require(./tunnel) 之前，否则已开始下载');
});

check('startWeb 的 options.tunnel 分支先检查再调 startTunnelForLocal', () => {
    const i = src.indexOf('if (options.tunnel)');
    assert.ok(i > 0, '未找到 options.tunnel 分支');
    const seg = src.slice(i, i + 1200);
    const gate = seg.indexOf('checkTunnelAuth');
    const call = seg.indexOf('startTunnelForLocal(port)');
    assert.ok(gate > 0, 'options.tunnel 分支内没有 checkTunnelAuth');
    assert.ok(call > gate, '必须先检查再调用 startTunnelForLocal');
});

check('跳过隧道时提示面板本身仍然可用（避免误以为 web start 失败）', () => {
    const i = src.indexOf('if (options.tunnel)');
    const seg = src.slice(i, i + 1200);
    assert.ok(/面板本身已正常启动|本地地址/.test(seg),
        '缺凭据跳过隧道时应说明面板仍可用，否则用户以为整个启动失败了');
});

check('checkTunnelAuth 与 TUNNEL_AUTH_ERR 已导出（便于测试与预检）', () => {
    assert.ok(typeof webService.checkTunnelAuth === 'function', '未导出 checkTunnelAuth');
    assert.ok(typeof webService.TUNNEL_AUTH_ERR === 'string', '未导出 TUNNEL_AUTH_ERR');
});

// ==================== 5. 与 isExposedHost 的关系 ====================
console.log('\n【与 isExposedHost 的分工】');

check('回环地址 isExposedHost 为 false，但隧道仍须配 token（这正是补闸的原因）', () => {
    assert.strictEqual(webService.isExposedHost('127.0.0.1'), false,
        '回环地址不应被判为暴露');
    // 没有凭据时，即便绑定回环，隧道闸门也必须拒绝
    config.getConfig = (k, d) => d;
    assert.strictEqual(webService.checkTunnelAuth({ quiet: true }).ok, false,
        '绑回环 + 无凭据时隧道闸门必须拒绝——否则隧道把本地面板映射成公网服务');
});

check('非回环地址两边都会拦（正常情况下 isExposedHost 先拦，走不到隧道）', () => {
    assert.strictEqual(webService.isExposedHost('0.0.0.0'), true);
    assert.strictEqual(webService.isExposedHost('192.168.1.10'), true);
    config.getConfig = (k, d) => d;
    assert.strictEqual(webService.checkTunnelAuth({ quiet: true }).ok, false);
});

// ==================== 汇总 ====================
(async () => {
    await runTunnelTests();
    restoreConfig();

    console.log('\n----------------------------------------');
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail > 0) {
        console.log('\n失败明细：');
        failures.forEach(f => console.log(`  · ${f.name}\n    ${f.err.stack || f.err.message}`));
        process.exit(1);
    }
    console.log('✅ 隧道认证闸门测试全部通过\n');
    process.exit(0);
})();
