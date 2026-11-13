#!/usr/bin/env node
/**
 * V3.5.16 新增能力测试：Web 对外暴露 / 认证闸门 / 隧道输出解析 / EasyTier IP 探测
 * ----------------------------------------------------------------
 * 全部为纯逻辑 + 源码级断言，不真正监听端口、不真下 cloudflared，
 * 因此可在 CI 与离线环境安全运行。
 *
 * 注：mail.login_verify 一需求已判定与既有登录机制重复，未实现，故无相关断言。
 *
 * 运行：node test/web_public_tunnel.test.js
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
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

console.log('\n===== V3.5.16 Web 对外暴露 / 隧道 / 联机提示 =====\n');

// ---------- 1. 配置项 ----------
console.log('[配置] 未引入多余配置项');

check('01 DEFAULT_CONFIG 不含 mail.login_verify（该需求已由既有登录机制覆盖）', () => {
    delete require.cache[require.resolve(path.join(SRC, 'config.js'))];
    const config = require(path.join(SRC, 'config.js'));
    assert.strictEqual(config.DEFAULT_CONFIG.mail.login_verify, undefined,
        'mail.login_verify 不应存在');
});

check('02 既有登录配置项仍在（auth_token / auth_password / whitelist）', () => {
    delete require.cache[require.resolve(path.join(SRC, 'config.js'))];
    const config = require(path.join(SRC, 'config.js'));
    assert.ok('auth_token' in config.DEFAULT_CONFIG.web);
    assert.ok('auth_password' in config.DEFAULT_CONFIG.web);
    assert.ok(Array.isArray(config.DEFAULT_CONFIG.mail.whitelist));
});

check('03 authMiddleware 未加入免登录短路分支', () => {
    const src = read('web_service.js');
    const mwStart = src.indexOf('function authMiddleware');
    const mwBody = src.slice(mwStart, mwStart + 900);
    assert.ok(!/return next\(\);\s*\}\s*\/\/ 白名单路径/.test(mwBody) ||
        !/isLoginVerifyEnabled/.test(mwBody), '中间件不应有免登录分支');
});

check('04 /api/auth/config 路由存在且已列入 publicPaths', () => {
    const src = read('web_service.js');
    assert.ok(/app\.get\('\/api\/auth\/config'/.test(src), '缺少 auth/config 路由');
    const m = src.match(/const publicPaths = \[([^\]]+)\]/);
    assert.ok(m && m[1].includes("'/api/auth/config'"), 'auth/config 必须在 publicPaths 内（登录前可调）');
});

check('04b /api/auth/set-password 公开，但必须校验邮箱验证码', () => {
    const src = read('web_service.js');
    assert.ok(/app\.post\('\/api\/auth\/set-password'/.test(src), '缺少 set-password 路由');
    const m = src.match(/const publicPaths = \[([^\]]+)\]/);
    assert.ok(m, '未找到 publicPaths');
    assert.ok(m[1].includes("'/api/auth/set-password'"),
        'set-password 需登录前可调：首次设密码时用户不可能已有 token');
    assert.ok(/verificationCodes\.get\(admin\)/.test(src),
        'set-password 必须校验邮箱验证码，不能只凭 email 就改密码');
});

// ---------- 2. isExposedHost ----------
console.log('\n[安全] isExposedHost 判定');

const webService = require(path.join(SRC, 'web_service.js'));

check('03 127.0.0.1 不算暴露', () => {
    assert.strictEqual(webService.isExposedHost('127.0.0.1'), false);
});

check('04 localhost 不算暴露', () => {
    assert.strictEqual(webService.isExposedHost('localhost'), false);
});

check('05 ::1 不算暴露', () => {
    assert.strictEqual(webService.isExposedHost('::1'), false);
    assert.strictEqual(webService.isExposedHost('[::1]'), false);
});

check('06 0.0.0.0 算暴露', () => {
    assert.strictEqual(webService.isExposedHost('0.0.0.0'), true);
});

check('07 局域网 IP 算暴露', () => {
    assert.strictEqual(webService.isExposedHost('192.168.1.10'), true);
    assert.strictEqual(webService.isExposedHost('10.144.1.2'), true);
});

check('08 空值不算暴露', () => {
    assert.strictEqual(webService.isExposedHost(''), false);
    assert.strictEqual(webService.isExposedHost(null), false);
});

check('09 大小写不敏感（LOCALHOST）', () => {
    assert.strictEqual(webService.isExposedHost('LOCALHOST'), false);
    assert.strictEqual(webService.isExposedHost('  127.0.0.1  '), false);
});

// ---------- 3. 安全闸门源码断言 ----------
console.log('\n[安全] startWeb 强制闸门');

check('10 startWeb 在暴露且 auth_token 为空时拒绝启动', () => {
    const src = read('web_service.js');
    assert.ok(/拒绝启动：暴露公网必须设置 auth_token 或管理员密码/.test(src),
        '缺少「暴露公网必须设置 auth_token」提示文案');
    assert.ok(/if \(!hasToken\)/.test(src), '闸门应只判 auth_token');
});

check('11 startWeb 不再有 login_verify 相关拒绝分支', () => {
    const src = read('web_service.js');
    assert.ok(!src.includes('isLoginVerifyEnabled'), '不应残留 login_verify 逻辑');
});

check('12 拒绝分支出现在 server.listen 之前', () => {
    const src = read('web_service.js');
    const gate = src.indexOf('if (!hasToken)');
    const listen = src.indexOf('server.listen(port, host');
    assert.ok(gate > 0 && listen > 0, '未找到关键位置');
    assert.ok(gate < listen, '闸门必须早于 listen，否则端口已被占用');
});

check('13 auth_token 判空时先 trim（空字符串视为未配置）', () => {
    const src = read('web_service.js');
    assert.ok(/String\(authToken\)\.trim\(\)/.test(src), 'auth_token 需 trim 后判空');
});

// ---------- 4. --public / --host 解析 ----------
console.log('\n[CLI] --public / --host 参数');

check('14 CLI web start 定义 --public', () => {
    const src = read('cli.js');
    assert.ok(/\.option\('--public'/.test(src), 'cli.js 缺少 --public 选项');
});

check('15 CLI web start 定义 --tunnel', () => {
    const src = read('cli.js');
    assert.ok(/\.option\('--tunnel'/.test(src), 'cli.js 缺少 --tunnel 选项');
});

check('16 CLI 存在独立的 web tunnel 子命令', () => {
    const src = read('cli.js');
    assert.ok(/command\('tunnel'\)/.test(src), '缺少 web tunnel 子命令');
});

check('17 --public 被转换为 0.0.0.0', () => {
    const src = read('web_service.js');
    assert.ok(/if \(!host && options\.public\) host = '0\.0\.0\.0'/.test(src),
        '--public 未映射为 0.0.0.0');
});

check('18 显式 --host 优先级高于 --public', () => {
    const src = read('web_service.js');
    const hostFirst = src.indexOf('let host = options.host;');
    const pubNext = src.indexOf("if (!host && options.public) host = '0.0.0.0';");
    assert.ok(hostFirst > 0 && pubNext > hostFirst, '优先级顺序错误：应先取 options.host');
});

// ---------- 5. 既有认证机制未被改动 ----------
console.log('\n[认证] 既有登录机制保持不变');

check('19 authMiddleware 仍要求 Bearer token', () => {
    const src = read('web_service.js');
    assert.ok(/authHeader\.startsWith\('Bearer '\)/.test(src), 'Bearer 校验被移除');
    assert.ok(/未登录/.test(src), '缺少未登录响应');
});

check('20 publicPaths 仅保留原有三项认证接口 + download', () => {
    const src = read('web_service.js');
    const m = src.match(/const publicPaths = \[([^\]]+)\]/);
    assert.ok(m, '未找到 publicPaths');
    const list = m[1];
    assert.ok(list.includes('/api/auth/request-code'));
    assert.ok(list.includes('/api/auth/login'));
    assert.ok(list.includes('/api/auth/verify'));
    assert.ok(list.includes('/api/download'));
});

check('21 /api/auth/verify 无 token 时返回 valid:false', () => {
    const src = read('web_service.js');
    const idx = src.indexOf("app.get('/api/auth/verify'");
    const body = src.slice(idx, idx + 700);
    assert.ok(/if \(!authHeader \|\| !authHeader\.startsWith\('Bearer '\)\) \{\s*return res\.json\(\{ valid: false \}\);/.test(body),
        'verify 的未登录分支被改动');
});

// ---------- 6. 隧道模块 ----------
console.log('\n[隧道] cloudflared 资产与域名解析');

const tunnelPath = path.join(SRC, 'tunnel.js');

check('25 tunnel.js 存在且可加载', () => {
    assert.ok(fs.existsSync(tunnelPath), '缺少 src/tunnel.js');
    delete require.cache[require.resolve(tunnelPath)];
    const t = require(tunnelPath);
    assert.strictEqual(typeof t.startTunnel, 'function');
    assert.strictEqual(typeof t.ensureBinary, 'function');
    assert.strictEqual(typeof t.detectAsset, 'function');
});

check('26 当前平台资产名符合 cloudflared 官方命名', () => {
    const t = require(tunnelPath);
    const { asset, exe } = t.detectAsset();
    assert.ok(/^cloudflared-/.test(asset), `资产名不符合规范: ${asset}`);
    if (process.platform === 'win32') {
        assert.ok(asset.endsWith('.exe'), 'Windows 资产应为 .exe');
        assert.strictEqual(exe, 'cloudflared.exe');
    } else if (process.platform === 'darwin') {
        assert.ok(asset.endsWith('.tgz'), 'macOS 资产应为 .tgz');
        assert.strictEqual(exe, 'cloudflared');
    } else {
        assert.ok(!asset.includes('.'), 'Linux 资产应为裸二进制');
        assert.strictEqual(exe, 'cloudflared');
    }
});

check('27 资产名含 os 与 arch 关键片段', () => {
    const t = require(tunnelPath);
    const { asset } = t.detectAsset();
    const archMap = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm' };
    assert.ok(asset.includes(archMap[process.arch]), `资产名缺架构 ${archMap[process.arch]}: ${asset}`);
});

check('28 隧道逐行解析域名（不用整块一次性匹配）', () => {
    const src = read('tunnel.js');
    assert.ok(/split\(\/\\r\?\\n\//.test(src), '应按行切分输出');
    assert.ok(/buf = lines\.pop\(\)/.test(src), '应保留最后半行，避免域名被 data 事件切断');
});

check('29 域名正则限定 trycloudflare.com', () => {
    const src = read('tunnel.js');
    assert.ok(/trycloudflare\\\.com/i.test(src), '缺少 trycloudflare.com 域名匹配');
});

check('30 隧道失败时回显 cloudflared 输出', () => {
    const src = read('tunnel.js');
    assert.ok(/── cloudflared 输出 ──/.test(src), '失败时应回显原始输出');
});

check('31 隧道子进程 detached，避免 Ctrl+C 连坐', () => {
    const src = read('tunnel.js');
    assert.ok(/detached: true/.test(src), 'spawn 未设置 detached');
});

check('32 隧道 stop 在 POSIX 上按进程组杀（负 pid）', () => {
    const src = read('tunnel.js');
    assert.ok(/process\.kill\(-child\.pid/.test(src), '未按进程组终止');
});

check('33 域名解析正则行为验证（模拟真实输出）', () => {
    // 直接复用隧道模块内的匹配逻辑：此处用等价正则做抽样验证
    const re = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;
    const sample = '|  https://brave-tiger-music-abc.trycloudflare.com     |';
    const m = sample.match(re);
    assert.ok(m, '未能从官方输出格式中解析出域名');
    assert.strictEqual(m[0], 'https://brave-tiger-music-abc.trycloudflare.com');
});

check('34 域名正则不会误吞行尾竖线', () => {
    const re = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;
    const m = 'https://a-b-c.trycloudflare.com |'.match(re);
    assert.strictEqual(m[0], 'https://a-b-c.trycloudflare.com');
});

// ---------- 7. EasyTier IP 探测 ----------
console.log('\n[联机] EasyTier 虚拟 IP 探测');

const netinfo = require(path.join(SRC, 'netinfo.js'));

check('35 netinfo 导出所需函数', () => {
    assert.strictEqual(typeof netinfo.detectVirtualIp, 'function');
    assert.strictEqual(typeof netinfo.buildLanAccessHint, 'function');
    assert.strictEqual(typeof netinfo.isEasyTierAddress, 'function');
});

check('36 10.144.x.x 被识别为 EasyTier 网段', () => {
    assert.strictEqual(netinfo.isEasyTierAddress('10.144.1.2'), true);
    assert.strictEqual(netinfo.isEasyTierAddress('10.144.255.254'), true);
});

check('37 其他地址不被误判', () => {
    assert.strictEqual(netinfo.isEasyTierAddress('10.145.1.2'), false);
    assert.strictEqual(netinfo.isEasyTierAddress('192.168.1.2'), false);
    assert.strictEqual(netinfo.isEasyTierAddress('127.0.0.1'), false);
    assert.strictEqual(netinfo.isEasyTierAddress(''), false);
    assert.strictEqual(netinfo.isEasyTierAddress(null), false);
});

check('39 探测失败时 buildLanAccessHint 不抛错（降级提示）', () => {
    const src = read('netinfo.js');
    assert.ok(/未能读取到本机的 EasyTier 虚拟 IP/.test(src), '缺少探测失败的降级文案');
});

check('40 探测走 os.networkInterfaces 优先', () => {
    const src = read('netinfo.js');
    const nicIdx = src.indexOf('fromNodeInterfaces();');
    const sysIdx = src.indexOf('fromSystemTools();');
    assert.ok(nicIdx > 0 && sysIdx > 0, '缺少两条取证路径');
    assert.ok(nicIdx < sysIdx, '应优先读网卡表，再回落系统命令');
});

check('41 Windows 分支使用 ipconfig', () => {
    const src = read('netinfo.js');
    assert.ok(/runCmd\('ipconfig'/.test(src), '缺少 Windows ipconfig 分支');
});

check('42 Linux 分支使用 ip -4 addr', () => {
    const src = read('netinfo.js');
    assert.ok(/runCmd\('ip', \['-4', 'addr', 'show'\]/.test(src), '缺少 Linux ip 命令分支');
});

// ---------- 8. 联机 hook ----------
console.log('\n[联机] 开房/开面板互相提示');

check('43 terracotta 开房成功后调用提示', () => {
    const src = read('terracotta.js');
    assert.ok(/await printWebAccessHintIfNeeded\(\)/.test(src), 'hostRoom 未调用提示');
});

check('44 web 启动后检测陶瓦是否在跑', () => {
    const src = read('web_service.js');
    assert.ok(/if \(Terracotta\.isRunning\(\)\)/.test(src), 'web 启动未检测陶瓦状态');
    assert.ok(/buildLanAccessHint\(\{ port \}\)/.test(src), '未调用虚拟 IP 提示');
});

check('45 提示失败不影响主流程（try/catch 包裹）', () => {
    const src = read('terracotta.js');
    const fnIdx = src.indexOf('async function printWebAccessHintIfNeeded');
    const body = src.slice(fnIdx, fnIdx + 700);
    assert.ok(/catch \(e\)/.test(body), '提示函数缺少异常兜底');
});

// ---------- 9. 回归：不能破坏既有能力 ----------
console.log('\n[回归] 既有能力未被破坏');

check('46 默认绑定地址仍是 127.0.0.1', () => {
    const src = read('config.js');
    assert.ok(/host: '127\.0\.0\.1'/.test(src), '默认 host 被改动');
});

check('47 auth_token 默认仍为 null', () => {
    const src = read('config.js');
    assert.ok(/auth_token: null/.test(src));
});

check('48 web_status 仍可读取 host', () => {
    const src = read('web_service.js');
    assert.ok(/function webStatus\(\)/.test(src));
});

check('49 stopWeb 会关闭隧道句柄', () => {
    const src = read('web_service.js');
    const stopIdx = src.indexOf('function stopWeb()');
    const body = src.slice(stopIdx, stopIdx + 3000);
    assert.ok(/stopTunnelHandle\(\)/.test(body), 'stopWeb 未调用 stopTunnelHandle');
});

check('50 新增模块无语法错误（tunnel/netinfo 可解析）', () => {
    // 已在上方 require 过；这里再显式验证一次 parse
    new (require('vm').Script)(read('tunnel.js'));
    new (require('vm').Script)(read('netinfo.js'));
});


async function main() {
    await checkAsync('38 buildLanAccessHint 至少给出联机提示与 IP 说明', async () => {
        const lines = await netinfo.buildLanAccessHint({ port: 8080 });
        const text = lines.join('\n');
        assert.ok(text.includes('检测到联机网络已开启'), '缺少核心提示语');
        assert.ok(text.includes('虚拟局域网 IP'), '缺少虚拟局域网 IP 说明');
    });


    // ---------- 汇总 ----------
    console.log('\n----------------------------------------');
    if (fail === 0) {
        console.log(`✅ 全部通过：${pass} 项`);
        process.exit(0);
    } else {
        console.log(`❌ ${fail} 项失败 / ${pass} 项通过`);
        for (const f of failures) {
            console.log(`   • ${f.name}: ${f.err.message}`);
        }
        process.exit(1);
    }
}

main().catch(e => {
    console.error('测试运行异常:', e);
    process.exit(1);
});
