#!/usr/bin/env node
/**
 * 启动轮换 web.auth_token 回归测试
 * ----------------------------------------------------------------
 * 规则：**每次启动 wow（任意 CLI 入口）都无条件把 web.auth_token
 * 换成一串新的 32 字节十六进制随机串。**
 *
 * 盯三件事：
 *   1. 每次启动写入的是 64 位小写 hex；
 *   2. 连续两次启动，两次的 token 不同（真轮换，不是只写一次）；
 *   3. 即便 yaml 里已有手动配置的值，启动也会被覆盖。
 *
 * 运行：node test/auth_token_rotate.test.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.js');
const CONFIG_FILE = path.join(ROOT, 'wow.yaml');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// 用环境变量固定运行时密钥，避免测试把登录密钥行为牵扯进来；
// 同时测试结束必须把 wow.yaml 还原，绝不污染真实配置。
const backup = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE) : null;
function runCli() {
    return spawnSync(process.execPath, [CLI, 'config', 'get', 'language'], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000,
        env: { ...process.env, NO_COLOR: '1', WOW_WEB_AUTH_TOKEN: 'rotation-test-fixed-secret' }
    });
}
function readToken() {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const m = raw.match(/^\s+auth_token:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
}

try {
    console.log('\n— 每次启动轮换 web.auth_token —');

    let t1, t2;
    check('第 1 次启动：写入 64 位小写 hex', () => {
        runCli();
        t1 = readToken();
        if (!t1 || !/^[0-9a-f]{64}$/.test(t1)) {
            throw new Error(`token 格式异常: ${t1}`);
        }
    });

    check('第 2 次启动：token 变化（每次都换）', () => {
        runCli();
        t2 = readToken();
        if (!t2 || !/^[0-9a-f]{64}$/.test(t2)) {
            throw new Error(`token 格式异常: ${t2}`);
        }
        if (t2 === t1) throw new Error('两次启动 token 相同，未发生轮换');
    });

    check('手动写入的值也会被下次启动覆盖', () => {
        const manual = 'manually-set-token-should-be-replaced';
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(
            /^(\s+auth_token:\s*)\S+\s*$/m, `$1${manual}`);
        fs.writeFileSync(CONFIG_FILE, raw);
        if (readToken() !== manual) throw new Error('预置手动值失败');
        runCli();
        const t3 = readToken();
        if (t3 === manual) throw new Error('手动值未被覆盖');
        if (!/^[0-9a-f]{64}$/.test(t3)) throw new Error(`覆盖后格式异常: ${t3}`);
    });
} finally {
    if (backup !== null) fs.writeFileSync(CONFIG_FILE, backup);
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
