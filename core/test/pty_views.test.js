#!/usr/bin/env node
/**
 * 五大视图流转 pty 回归（执行令阶段 6）
 * ----------------------------------------------------------------
 * 静态断言（不依赖 TTY）+ 真 TTY 端到端（委托 test/pty_views.py）。
 *
 * 为什么 wrapper 必须有 timeout：
 *   core/test/run.js 用 spawnSync 顺序执行各测试文件且**自身没有 timeout**。
 *   pty 测试一旦挂住就会把整个 npm test 拖死。这里对内层的 python
 *   spawnSync 显式给 timeout + SIGKILL，python 脚本内再叠一层
 *   signal.alarm，双保险保证本测试文件必然退出。
 *
 * 环境缺失策略：
 *   非 Linux / 无 python3 → 打印 [SKIP] 并 exit 0（不制造假失败）；
 *   WOW_PTY_STRICT=1 时缺 python3 直接判失败（CI 严格模式）。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const coreDir = path.resolve(__dirname, '..');
const srcDir = path.join(coreDir, 'src');
const pyScript = path.join(__dirname, 'pty_views.py');

let passed = 0;
let failed = 0;

function check(title, fn) {
    try {
        fn();
        console.log(`  ✅ ${title}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${title}  → ${e.message}`);
        failed++;
    }
}

console.log('\n=== pty 视图流转回归（执行令阶段 6）===\n');

const read = (f) => fs.readFileSync(path.join(srcDir, f), 'utf8');
const srv = read('server.js');
const cli = read('cli.js');
const itv = read('interactive.js');
const stdinSession = read('stdin_session.js');
const viewState = read('view_state.js');

// ---------------- 静态断言：底座契约 ----------------

check('pty_views.py 存在且是 python3 脚本', () => {
    if (!fs.existsSync(pyScript)) throw new Error('缺 test/pty_views.py');
    const head = fs.readFileSync(pyScript, 'utf8').slice(0, 200);
    if (!/pty\.fork/.test(fs.readFileSync(pyScript, 'utf8'))) {
        throw new Error('pty_views.py 未使用 pty.fork()');
    }
    if (!/^#!.*python3/.test(head)) throw new Error('缺 python3 shebang');
});

check('stdin_session.js 提供 WOW_STDIN_ASSERT 运行时探针', () => {
    if (!/WOW_STDIN_ASSERT/.test(stdinSession)) throw new Error('缺探针开关');
    if (!/\[WOW_PROBE\]/.test(stdinSession)) throw new Error('缺探针输出前缀');
    if (!/installProbeExit\(\)/.test(stdinSession)) throw new Error('缺 EXIT 汇总钩子');
});

check('view_state.js 定义五大视图且不含 :lan', () => {
    if (!/SHELL:\s*'shell'/.test(viewState)) throw new Error('缺 shell');
    if (!/MENU:\s*'menu'/.test(viewState)) throw new Error('缺 menu');
    if (!/WOW:\s*'wow'/.test(viewState)) throw new Error('缺 wow');
    if (!/MC:\s*'mc'/.test(viewState)) throw new Error('缺 mc');
    if (!/WEB:\s*'web'/.test(viewState)) throw new Error('缺 web');
    if (/':lan'/.test(viewState)) throw new Error('状态机里还残留 :lan');
});

check('全仓只有 stdin_session.js 创建 stdin readline', () => {
    // 与 stdin_session.test.js 同口径：先滤掉注释行，否则 cli.js 的 JSDoc
    // 里那句「不要在 REPL 里 createInterface({ input: process.stdin })」
    // 反例会被当成真实创建点。
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
    const offenders = files.filter(f => {
        const s = fs.readFileSync(path.join(srcDir, f), 'utf8')
            .split('\n')
            .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l))
            .join('\n');
        return /createInterface\(\s*\{[^}]*input:\s*process\.stdin/s.test(s)
            && f !== 'stdin_session.js';
    });
    if (offenders.length) throw new Error('违规文件: ' + offenders.join(', '));
});

check('server.js 两处 spawn 都登记了 shutdown', () => {
    const n = (srv.match(/this\.process\s*=\s*spawn\(/g) || []).length;
    const r = (srv.match(/_registerShutdown\(\)/g) || []).length;
    if (n < 2 || r < 3) { // 2 处调用 + 1 处方法定义
        throw new Error(`spawn=${n} _registerShutdown=${r}`);
    }
});

check('单次 Ctrl+C 只 detach，不停服', () => {
    const m = srv.match(/_sigintHandler\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,400}?\};/);
    if (!m) throw new Error('未找到 _sigintHandler');
    if (/this\.stop\(/.test(m[0])) throw new Error('SIGINT 回调里调用了 stop()');
    if (!/_detachConsole/.test(m[0])) throw new Error('未走安全退场');
});

check('Web 触发启服：:wow 自动切 :mc，:m 不切页只刷状态栏', () => {
    if (!/VIEW\.MENU/.test(cli)) throw new Error('cli.js 缺 MENU 分支');
    if (!/setView\('MC',\s*'web:started:from-wow'\)/.test(cli)) {
        throw new Error('缺 :wow 自动切 :mc');
    }
    if (!/视图保持不变，状态栏已更新/.test(cli)) {
        throw new Error('缺 :m 不切页提示');
    }
    if (!/webWatch/.test(itv)) throw new Error('interactive.js 缺状态栏监听');
});

// ---------------- 真 TTY 端到端 ----------------

const pyCheck = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const hasPython = pyCheck.status === 0 && !pyCheck.error;
const isLinux = process.platform === 'linux';
const strict = process.env.WOW_PTY_STRICT === '1';

if (!hasPython || !isLinux) {
    const why = !isLinux ? `平台 ${process.platform} 非 Linux` : '未找到 python3';
    if (strict) {
        check(`pty 严格模式：${why}`, () => { throw new Error('环境不满足'); });
    } else {
        console.log(`  ⏭  [SKIP] pty 端到端（${why}；WOW_PTY_STRICT=1 可强制失败）`);
    }
} else {
    const r = spawnSync('python3', [pyScript], {
        encoding: 'utf8',
        timeout: 120000,
        killSignal: 'SIGKILL',
        cwd: coreDir,
        env: Object.assign({}, process.env, { WOW_STDIN_ASSERT: '1' })
    });

    const out = (r.stdout || '') + '\n' + (r.stderr || '');
    // 原样回显 python 的场景细节，便于定位
    out.split('\n').filter(l => /\[SCENARIO|\[PTY_RESULT\]|Traceback|Error/.test(l))
        .forEach(l => console.log('     ' + l.trim()));

    check('pty 脚本未被超时强杀且自身退出码为 0', () => {
        if (r.error && r.error.code === 'ETIMEDOUT') {
            throw new Error('python 脚本超过 120s 被 SIGKILL（可能挂住）');
        }
        if (r.status !== 0) throw new Error(`exit=${r.status} signal=${r.signal}`);
    });

    for (const name of ['A', 'B', 'C', 'D']) {
        check(`pty 场景 ${name} 通过`, () => {
            const line = out.split('\n').find(l => l.includes(`[SCENARIO ${name}]`));
            if (!line) throw new Error(`没有场景 ${name} 的结果行`);
            if (!line.includes('PASS')) throw new Error(line.trim());
        });
    }

    check('[PTY_RESULT] 汇总 ok=4 fail=0', () => {
        const m = out.match(/\[PTY_RESULT\]\s*ok=(\d+)\s+fail=(\d+)/);
        if (!m) throw new Error('缺汇总行');
        if (m[1] !== '4' || m[2] !== '0') {
            throw new Error(`ok=${m[1]} fail=${m[2]}`);
        }
    });
}

console.log(`\n==================================================`);
console.log(failed ? `❌ 失败 ${failed} 项 / 通过 ${passed} 项` : `✅ 全部通过：${passed} 项`);
process.exit(failed ? 1 : 0);
