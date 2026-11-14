#!/usr/bin/env node
/**
 * config 子命令回归测试
 * ----------------------------------------------------------------
 * 待测规则一句话：**文档和错误提示里写的命令，必须真能跑。**
 *
 * 起因：`wow config set web.auth_token xxx` 在文档、隧道闸门提示、AI 日志建议里
 * 出现了几十处，但 CLI 里从来没有 `set` 子命令（真正的子命令名是 `wow`）。
 * 用户照着提示敲，得到 `error: unknown command 'set'` —— 等于把人引到死胡同。
 *
 * 本测试盯四件事：
 *   1. `config set` / `get` / `unset` 三个子命令真实存在且可用；
 *   2. 凭据类键（auth_token / auth_password / api_key …）不回显明文；
 *   3. `unset` 写入的是 null 而不是字符串 "null"（后者会让「未设置」判定失效）；
 *   4. 旧写法 `config wow <key> [value]` 仍然可用（不破坏老脚本）。
 *
 * 运行：node test/config_cli.test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.js');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

/**
 * 在隔离的临时工作目录里跑 CLI，避免污染真实 wow.yaml。
 * core/src/config.js 按 __dirname 定位配置文件，所以要复制一份 core 到临时目录
 * 并不现实（node_modules 太大），改为：跑完把改动整体撤销。
 */
function runCli(args) {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000,
        env: { ...process.env, NO_COLOR: '1' }
    });
    return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

const CONFIG_FILE = path.join(ROOT, 'wow.yaml');
const backup = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE) : null;
const TEST_KEY = 'test.__cfg_cli_probe';
const TEST_SECRET = 'test.web.auth_token';

function restore() {
    if (backup !== null) fs.writeFileSync(CONFIG_FILE, backup);
}

try {
    console.log('\n— config set / get / unset —');

    check('config --help 列出 set / get / unset', () => {
        const { out } = runCli(['config', '--help']);
        for (const sub of ['set <key> <value>', 'get <key>', 'unset <key>']) {
            if (!out.includes(sub)) throw new Error(`帮助里缺少 ${sub}`);
        }
    });

    check('config set 写入普通键并回显', () => {
        const { out } = runCli(['config', 'set', TEST_KEY, 'hello']);
        if (!/✅/.test(out) || !out.includes(TEST_KEY)) throw new Error(`输出异常: ${out.slice(0, 200)}`);
        const { out: g } = runCli(['config', 'get', TEST_KEY]);
        if (!g.includes('hello')) throw new Error(`get 未取到值: ${g.slice(0, 200)}`);
    });

    check('config set 凭据类不回显明文', () => {
        const { out } = runCli(['config', 'set', TEST_SECRET, 'super-secret-value-123']);
        if (out.includes('super-secret-value-123')) throw new Error('终端输出里出现了明文密码');
        if (!/已设置/.test(out)) throw new Error('未提示已设置');
    });

    check('config get 凭据类打码 + 显示长度', () => {
        const { out } = runCli(['config', 'get', TEST_SECRET]);
        if (out.includes('super-secret-value-123')) throw new Error('get 回显了明文');
        if (!/长度 22/.test(out)) throw new Error(`未显示长度: ${out.trim()}`);
    });

    check('config unset 后 get 返回 null（不是字符串 "null"）', () => {
        const { out: u } = runCli(['config', 'unset', TEST_SECRET]);
        if (!/已清除/.test(u)) throw new Error(`unset 输出异常: ${u.slice(0, 120)}`);
        const { out } = runCli(['config', 'get', TEST_SECRET]);
        if (!/=\s*null\s*$/.test(out.trim())) throw new Error(`unset 后应显示 null，实际: ${out.trim()}`);
        if (/长度/.test(out)) throw new Error('unset 后仍被当作「已设置」');
    });

    check('unset 写进 yaml 的是真正的 null', () => {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        // 容忍缩进，匹配 `auth_token: null`
        if (!/auth_token:\s*null/.test(raw)) throw new Error('yaml 里未写成 null');
        if (/auth_token:\s*['"]null['"]/.test(raw)) throw new Error('写成了字符串 "null"');
    });

    check('旧写法 config wow <key> [value] 仍可用', () => {
        const { out: s } = runCli(['config', 'wow', TEST_KEY, 'legacy']);
        if (!/✅/.test(s)) throw new Error(`旧写法设置失败: ${s.slice(0, 200)}`);
        const { out: g } = runCli(['config', 'wow', TEST_KEY]);
        if (!g.includes('legacy')) throw new Error(`旧写法读取失败: ${g.slice(0, 200)}`);
    });

    check('旧写法保持明文回显（不破坏依赖输出的脚本）', () => {
        const { out } = runCli(['config', 'wow', 'test.web.auth_token', 'legacy-secret']);
        if (!out.includes('legacy-secret')) throw new Error('旧写法应保持原样回显');
    });

    console.log('\n— 文档与提示一致性 —');

    check('文档里出现的 wow config set 语法都能被 CLI 识别', () => {
        // 只校验语法形态：`wow config set <key> <value>` —— key 不能是子命令名
        const docs = ['docs/net/WEB_PANEL.md', 'docs/other/CF_PROXY.md', 'docs/COMMANDS.md'];
        for (const rel of docs) {
            const p = path.join(ROOT, '..', rel);
            if (!fs.existsSync(p)) continue;
            const text = fs.readFileSync(p, 'utf8');
            const bad = text.match(/wow config set\s+(?!<)(\S+)/g) || [];
            for (const line of bad) {
                const key = line.split(/\s+/).pop();
                if (!/^[A-Za-z_][\w.-]*$/.test(key) && key !== '你的Key') {
                    throw new Error(`${rel} 里的用法可疑: ${line}`);
                }
            }
        }
    });

    check('CLI 已注册 config set（防止再次退化）', () => {
        const src = fs.readFileSync(CLI, 'utf8');
        if (!/\.command\('set <key> <value>'\)/.test(src)) throw new Error('cli.js 缺少 set 子命令');
        if (!/\.command\('unset <key>'\)/.test(src)) throw new Error('cli.js 缺少 unset 子命令');
        if (!/\.command\('get <key>'\)/.test(src)) throw new Error('cli.js 缺少 get 子命令');
    });
} finally {
    restore();
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
