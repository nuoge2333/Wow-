/**
 * V3.5.7 菜单改造 + V3.5.8 启动方式调整 + V3.5.9 懒加载重构 静态校验
 *
 * 背景：interactive.js 的菜单分发依赖 readline + 真实网络/文件副作用，难以端到端跑。
 * 这里用源码级断言，确保本次改造（菜单 2 = 新建方案、菜单 13 重编号、
 * cli.js 懒加载与非核心命令隐藏）不会被后续改动无声破坏。
 * 运行：cd core && node test/interactive_menu.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src', 'interactive.js');
const src = fs.readFileSync(SRC, 'utf8');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\n菜单改造校验 (V3.5.7 + V3.5.8 + V3.5.9)\n');

// 提取顶层 case 体，便于精确断言
// 注意：case 体内部有嵌套块，简单用 `^            }` 会在第一个嵌套 } 处提前截断，
// 因此改为「从本体开始、到下一个顶层 case 或文件尾」的区间截取。
const topCaseBodies = {};
{
    const marks = [];
    for (const m of src.matchAll(/^            case '(\d+)': \{/gm)) {
        marks.push({ num: m[1], start: m.index });
    }
    for (let i = 0; i < marks.length; i++) {
        const end = (i + 1 < marks.length) ? marks[i + 1].start : src.length;
        topCaseBodies[marks[i].num] = src.slice(marks[i].start, end);
    }
}

console.log('— 顶层 case 完整性 —');
check('顶层 case 1-15 全部存在', () => {
    for (let i = 1; i <= 15; i++) {
        assert.ok(topCaseBodies[String(i)], `缺少 case '${i}'`);
    }
});

// 菜单 2
const c2 = topCaseBodies['2'] || '';
console.log('\n— 菜单 2：新建方案 —');
check('case 2 不再是「下载/安装实例」标题', () => {
    // 只检测 printHeader 的实参，注释里提到旧名不算
    assert.ok(!/printHeader\('下载\/安装实例'\)/.test(c2), '仍残留旧标题');
});
check('case 2 标题为「新建方案」', () => {
    assert.ok(/printHeader\('新建方案'\)/.test(c2));
});
check('case 2 询问方案名', () => {
    assert.ok(/ask\(rl, '方案名称: '\)/.test(c2));
});
check('case 2 校验方案名合法性', () => {
    assert.ok(/validateNameSegment/.test(c2));
});
check('case 2 检查方案是否已存在', () => {
    assert.ok(/_schemeExists/.test(c2));
});
check('case 2 用对象签名调 create（修复位置参数 bug）', () => {
    assert.ok(/schemeManager\.create\(\s*sName\s*,\s*\{/.test(c2),
        '未使用 create(name, { ... }) 对象签名');
});
check('case 2 传入 type/version/loader/build 四项', () => {
    // 允许 ES6 简写（type,）与全写（type: type）两种形式
    for (const k of ['type', 'version', 'loader', 'build']) {
        assert.ok(new RegExp(`${k}\\s*[:,]`).test(c2), `缺少 ${k}`);
    }
});
check('case 2 不残留 create 三位置参数写法', () => {
    assert.ok(!/create\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)/.test(src),
        '仍存在 create(name, version, loader) 位置参数调用');
});
check('case 2 有 try/catch 包裹创建过程', () => {
    assert.ok(/try\s*\{[\s\S]*schemeManager\.create[\s\S]*catch/.test(c2));
});
check('case 2 引用不存在的 getSchemeDir 已移除', () => {
    assert.ok(!/utils\.getSchemeDir/.test(src));
});
check('case 2 使用 schemesDir 输出真实目录', () => {
    assert.ok(/schemesDir/.test(c2));
});

// 菜单 13
const c13 = topCaseBodies['13'] || '';
console.log('\n— 菜单 13：方案管理重编号 —');
check('case 13 存在', () => assert.ok(c13.length > 0));
check('case 13 已移除「创建方案」子项', () => {
    assert.ok(!/1\. 创建方案/.test(c13), '仍残留「1. 创建方案」');
});
check('case 13 子项编号压缩为 1-4', () => {
    assert.ok(/1\. 切换方案/.test(c13));
    assert.ok(/2\. 列出方案/.test(c13));
    assert.ok(/3\. 删除方案/.test(c13));
    assert.ok(/4\. 方案信息/.test(c13));
});
check('case 13 提示范围改为 (0-4)', () => {
    assert.ok(/请选择 \(0-4\)/.test(c13));
});
check('case 13 不再出现 5 号子项提示', () => {
    assert.ok(!/5\. 方案信息/.test(c13));
});
check('case 13 delete 已 await（异步方法）', () => {
    assert.ok(/await schemeManager\.delete\(/.test(c13));
});

// 主菜单文字
console.log('\n— 主菜单文字 —');
check('主菜单第 2 项显示「新建方案」', () => {
    assert.ok(/\['2', '新建方案'\]/.test(src));
});
check('主菜单第 2 项不再显示「下载/安装实例」', () => {
    assert.ok(!/\['2', '下载\/安装实例'\]/.test(src));
});
check('主菜单第 13 项描述已更新', () => {
    assert.ok(/\['13', '方案管理/.test(src));
});

// ─────────────────────────────────────────────
// V3.5.8：启动方式调整 —— wow(无参数) 进菜单；wow L 长命令模式；wow m 已移除
console.log('\n— V3.5.8 启动方式（cli.js）—');
{
    const CLI = path.join(__dirname, '..', 'src', 'cli.js');
    const cli = fs.readFileSync(CLI, 'utf8');

    check('cli.js 注册了 L（长命令模式）命令', () => {
        assert.ok(/\.command\('L \[cmd\.\.\.\]'\)/.test(cli), '未找到 L 命令注册');
    });
    check('cli.js 不再注册 m 命令', () => {
        assert.ok(!/\.command\('m /.test(cli), 'm 命令应已移除');
    });
    check('cli.js 无参数分支进入数字菜单（showMainMenu）', () => {
        // 从 `if (process.argv.length <= 2) {` 截到 `} else {`，取整个分支体
        const m = cli.match(/if \(process\.argv\.length <= 2\) \{[\s\S]{0,600}?\n\} else \{/);
        assert.ok(m, '未找到无参数分支');
        assert.ok(/showMainMenu\(/.test(m[0]), '无参数分支未调用 showMainMenu');
        assert.ok(!/startRepl\(\)/.test(m[0]), '无参数分支仍在调 startRepl');
        assert.ok(/buildMenuOptions\(\)/.test(m[0]), '无参数分支未使用 buildMenuOptions');
    });
    check('cli.js 的 L 命令 action 调用 startRepl', () => {
        // 从 `.command('L [cmd...]')` 截到该命令链的收尾 `    });`
        const m = cli.match(/\.command\('L \[cmd\.\.\.\]'\)[\s\S]{0,900}?\n    \}\)/);
        assert.ok(m, '未找到 L 的 action 体');
        assert.ok(/startRepl\(\)/.test(m[0]), 'L 无参时应进入 startRepl');
        assert.ok(/program\.parseAsync\(/.test(m[0]), 'L 带参时应执行单条长命令');
    });
    check('cli.js 提供 buildMenuOptions 供菜单使用', () => {
        assert.ok(/function buildMenuOptions\(\)/.test(cli));
    });
}

// ─────────────────────────────────────────────
// V3.5.9：cli.js 懒加载重构 —— 顶部仅 config/utils 静态引用，
// 其余模块 action 内动态 require 并经 load() 降级；非核心命令 _hidden
console.log('\n— V3.5.9 cli.js 懒加载重构 —');
{
    const CLI = path.join(__dirname, '..', 'src', 'cli.js');
    const cli = fs.readFileSync(CLI, 'utf8');

    check('顶层除 config/utils 外无项目模块静态 require', () => {
        // 只匹配列头（顶层语句）的静态 require；函数体内的动态 require 不算
        const staticRequires = cli.match(/^const\s+(?:\w+|\{[^}]*\})\s*=\s*require\('\.\/[^']+'\)/gm) || [];
        for (const line of staticRequires) {
            const mod = line.match(/require\('\.\/([^']+)'\)/)[1];
            assert.ok(mod === 'config' || mod === 'utils', `存在多余的顶层静态引用: ${line.trim()}`);
        }
    });
    check('提供 load() 懒加载辅助函数（try/catch 包裹 require）', () => {
        assert.ok(/function load\(modulePath\)/.test(cli), '未找到 load() 定义');
        assert.ok(
            /try\s*\{\s*return require\(modulePath\);[\s\S]*?catch[\s\S]*?return null;/.test(cli),
            'load() 未按要求包裹 try/catch 并降级返回 null'
        );
    });
    check('log 模块改懒加载（getLog / logger 访问器）', () => {
        assert.ok(/function getLog\(\)/.test(cli), '未找到 getLog()');
        assert.ok(/function logger\(\)/.test(cli), '未找到 logger() 访问器');
    });
    check('7 个非核心命令已 _hidden（set/down/pack/logs/mail/theme/install）', () => {
        const count = (cli.match(/_hidden = true/g) || []).length;
        assert.ok(count >= 7, `_hidden 仅 ${count} 处，预期 ≥ 7`);
    });
    check('mail / theme / pack / logs 定义后即设 _hidden', () => {
        for (const name of ['mail', 'theme', 'pack', 'logs']) {
            assert.ok(
                new RegExp(`const ${name}Cmd = program\\.command\\('${name}'\\)[\\s\\S]{0,120}?${name}Cmd\\._hidden = true`).test(cli),
                `${name} 未隐藏`
            );
        }
    });
    check('核心命令保持注册（init/server/scheme/mod/web/lan/config/L）', () => {
        for (const name of ['init', 'server', 'scheme', 'mod', 'web', 'lan', 'config', 'L']) {
            const re = name === 'L'
                ? /\.command\('L \[cmd\.\.\.\]'\)/
                : new RegExp(`\\.command\\('${name}[ <']`);
            assert.ok(re.test(cli), `核心命令 ${name} 未注册`);
        }
    });
    check('server 全部子命令 action 均经 load() 懒加载', () => {
        const serverBlock = cli.slice(
            cli.indexOf("const serverCmd = program.command('server')"),
            cli.indexOf('// ==================== install')
        );
        const actionCount = (serverBlock.match(/\.action\(/g) || []).length;
        const loadCount = (serverBlock.match(/load\('\.\/server'\)/g) || []).length;
        assert.strictEqual(loadCount, actionCount,
            `server 的 ${actionCount} 个 action 中只有 ${loadCount} 个经 load()`);
    });
    check('buildMenuOptions 各管理器懒加载且失败降级为 null', () => {
        const m = cli.match(/function buildMenuOptions\(\)[\s\S]*?\n\}/);
        assert.ok(m, '未找到 buildMenuOptions 函数体');
        const body = m[0];
        for (const mod of ['server', 'installer', 'mod_manager', 'scheme_manager', 'theme_manager', 'pack_generator', 'log_handler']) {
            assert.ok(body.includes(`load('./${mod}')`), `buildMenuOptions 未懒加载 ${mod}`);
        }
        assert.ok(/: null/.test(body), 'buildMenuOptions 未对加载失败降级为 null');
    });
}

// ─────────────────────────────────────────────
// V3.5.8：server.js 控制台分类对新入口的拦截
console.log('\n— V3.5.8 开服控制台分类（server.js）—');
{
    const SRV = path.join(__dirname, '..', 'src', 'server.js');
    const srv = fs.readFileSync(SRV, 'utf8');

    check('控制台输入 m 给出新指引而非转发给 MC', () => {
        assert.ok(/tokens\[0\] === 'm' \|\| tokens\[0\] === 'M'/.test(srv));
        assert.ok(/菜单命令已调整/.test(srv));
    });
    check('控制台输入 L 被拒绝（REPL 抢占 stdin）', () => {
        assert.ok(/tokens\[0\] === 'L'/.test(srv));
    });
}

// ─────────────────────────────────────────────
// V3.5.8：日志按天单文件（log.js）
console.log('\n— V3.5.8 事件日志按天单文件（log.js）—');
{
    const LOG = path.join(__dirname, '..', 'src', 'log.js');
    const lg = fs.readFileSync(LOG, 'utf8');

    check('日志文件名为 Wow-YYYY-MM-DD.log（无 PID/分钟数）', () => {
        assert.ok(/Wow-\$\{date\}\.log/.test(lg), '未找到按天命名');
        assert.ok(!/\$\{this\.sessionId\}-active/.test(lg), '仍在生成 per-PID active 文件');
    });
    check('按天文件直接追加，退出时不再重命名', () => {
        assert.ok(/appendFileSync\(this\.activePath/.test(lg));
        assert.ok(!/renameSync\(this\.activePath, target\)/.test(lg), '退出重命名逻辑应已移除');
    });
    check('会话开始/结束标记用于区分同日多次运行', () => {
        assert.ok(/===== 会话开始 /.test(lg));
        assert.ok(/===== 会话结束 /.test(lg));
    });
    check('超长行截断保护并发写原子性', () => {
        assert.ok(/MAX_LINE_BYTES/.test(lg));
    });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
