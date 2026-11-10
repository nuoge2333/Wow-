/**
 * V3.5.7 菜单改造 + V3.5.8 启动方式调整 + V3.5.9 懒加载重构 + V3.5.x 主菜单分类重排
 * + V3.5.11 加载器自动确定（不再单独询问）/ 引导菜单补充 neoforge 静态校验
 *
 * 背景：interactive.js 的菜单分发依赖 readline + 真实网络/文件副作用，难以端到端跑。
 * 这里用源码级断言，确保本次改造（菜单 2 = 方案管理（合并原新建方案+方案管理）、
 * 主菜单按功能分类重排为 1-14、cli.js 懒加载与非核心命令隐藏、
 * 建方案不再询问模组加载器——加载器随核心类型自动确定）不会被后续改动无声破坏。
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
check('顶层 case 1-14 全部存在', () => {
    for (let i = 1; i <= 14; i++) {
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
    // V3.6.3：TUI 模式下提问走 ioAsk（挂起键盘后的安全通道），
    // 兼容模式与外部裸调仍走 ask(rl, ...)，两种都应存在
    assert.ok(/ioAsk\(io, rl, '方案名称: '\)/.test(c2) || /ask\(rl, '方案名称: '\)/.test(c2),
        'case 2 未询问方案名');
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

// 菜单 2：方案管理（V3.5.x 合并「新建方案」+「方案管理」为单一入口）
const c2full = topCaseBodies['2'] || '';
console.log('\n— 菜单 2：方案管理（合并原 13）—');
check('case 2 标题为「方案管理」', () => {
    assert.ok(/printHeader\('方案管理'\)/.test(c2full));
});
check('case 2 含方案管理子菜单 1-5（新建/切换/列出/删除/信息）', () => {
    assert.ok(/1\. 新建方案/.test(c2full));
    assert.ok(/2\. 切换方案/.test(c2full));
    assert.ok(/3\. 列出方案/.test(c2full));
    assert.ok(/4\. 删除方案/.test(c2full));
    assert.ok(/5\. 方案信息/.test(c2full));
});
check('case 2 子菜单提示范围改为 (0-5)', () => {
    assert.ok(/请选择 \(0-5\)/.test(c2full));
});
check('case 2 仍保留新建方案逻辑（方案名/校验/create 对象签名）', () => {
    assert.ok(/ioAsk\(io, rl, '方案名称: '\)|ask\(rl, '方案名称: '\)/.test(c2full));
    assert.ok(/validateNameSegment/.test(c2full));
    assert.ok(/schemeManager\.create\(\s*sName\s*,\s*\{/.test(c2full));
});
check('case 2 切换方案已 await switch（异步方法）', () => {
    assert.ok(/await schemeManager\.switch\(/.test(c2full));
});
check('case 2 delete 已 await（异步方法）', () => {
    assert.ok(/await schemeManager\.delete\(/.test(c2full));
});
check('case 2 含 schemeManager\.info（方案信息）', () => {
    assert.ok(/schemeManager\.info\(/.test(c2full));
});
check('case 2 已移除原「备份/恢复」标题', () => {
    assert.ok(!/printHeader\('备份\/恢复/.test(c2full));
});

// 主菜单文字
console.log('\n— 主菜单文字 —');
check('主菜单（W 页）含「方案管理」且旧编号 2 仍指向它', () => {
    // V3.6.3：主菜单的硬编码数组改成 PAGES 声明式表格
    // V3.7.2：页内序号改为 1,2,3…，「方案管理」在 W 页是第 1 项、旧编号 2
    assert.ok(/id: '1', legacy: \['2'\], label: '方案管理/.test(src),
        'W 页的「方案管理」不再认旧编号 2');
});
check('主菜单第 2 项不再显示「下载/安装实例」', () => {
    assert.ok(!/\['2', '下载\/安装实例'\]/.test(src));
});
check('主菜单（Y 页）末尾仍是「Web 主题更改」（旧编号 13）', () => {
    assert.ok(/id: '7', legacy: \['13'\], label: 'Web 主题更改'/.test(src),
        'Y 页的「Web 主题更改」不再认旧编号 13');
});
check('主菜单不再存在「方案管理 (切换/列表/删除)」旧第 13 项', () => {
    assert.ok(!/\['13', '方案管理 \(切换\/列表\/删除\)'\]/.test(src));
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
    // V3.6.1：m 命令已恢复（双击走的也是这个入口），断言反转为「必须存在」
    check('cli.js 恢复了 m 命令（M 模式）', () => {
        assert.ok(/\.command\('m'\)/.test(cli), '未找到 m 命令注册');
        assert.ok(/\.alias\('M'\)/.test(cli), 'm 命令应有 M 别名');
    });
    check('cli.js 无参数分支进入数字菜单（showMainMenu）', () => {
        // 从 `if (process.argv.length <= 2) {` 截到 `} else {`，取整个分支体。
        // V3.5.21：该分支被整体缩进进了 `(async () => { ... })()` 内
        // （插件加载需要 await，而顶层 await 要 ESM），因此不能再用
        // `\n} else {` 这种行首零缩进的锚点，改为允许任意缩进。
        const m = cli.match(/if \(process\.argv\.length <= 2\) \{[\s\S]{0,900}?\n\s*\} else \{/);
        assert.ok(m, '未找到无参数分支');
        // V3.6.1：菜单入口抽成 enterMainMenu（无参数与 wow m 共用），
        // 因此不再直接要求分支里出现 showMainMenu/buildMenuOptions
        assert.ok(/enterMainMenu\(/.test(m[0]), '无参数分支未调用 enterMainMenu');
        assert.ok(!/startRepl\(\)/.test(m[0]), '无参数分支仍在调 startRepl');
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

    // ── V3.6.1：M ↔ L 互跳 ──
    check('cli.js 抽出 enterMainMenu 供无参数与 wow m 共用', () => {
        assert.ok(/async function enterMainMenu\(/.test(cli), '未找到 enterMainMenu');
    });
    check('wow m 的 action 调用 enterMainMenu', () => {
        const m = cli.match(/\.command\('m'\)[\s\S]{0,600}?\n    \}\);/);
        assert.ok(m, '未找到 m 的 action 体');
        assert.ok(/enterMainMenu\(/.test(m[0]), 'm 应进入菜单');
    });
    check('L 模式输入 m 回菜单（toMenu 分支）', () => {
        assert.ok(/let toMenu = false/.test(cli), '缺少 toMenu 标志');
        assert.ok(/if \(toMenu\)/.test(cli), 'close 回调未处理回菜单');
        // 回菜单时不能顺手关掉 Web 面板，也不能打印再见
        const m = cli.match(/if \(toMenu\) \{[\s\S]{0,800}?\n        \}/);
        assert.ok(m && /enterMainMenu\(/.test(m[0]), 'toMenu 分支未调用 enterMainMenu');
        assert.ok(m && !/onExit/.test(m[0]), 'toMenu 分支不应触发 onExit（会关掉面板）');
    });
    check('REPL 关闭后忽略残留 line 事件（closed 标志）', () => {
        assert.ok(/if \(closed\) return;/.test(cli), 'line 回调未做 closed 检查');
    });
    check('菜单有 L 入口且分发到注入的回调（V3.6.3 起不是 15 号）', () => {
        const itv = fs.readFileSync(path.join(__dirname, '..', 'src', 'interactive.js'), 'utf8');
        // V3.6.3：底部导航的 [L] 取代了原主菜单的 15 号项
        assert.ok(/\[\[\s*'L',\s*'长命令'\s*\]|\['L', '长命令'\]/.test(
            fs.readFileSync(path.join(__dirname, '..', 'src', 'tui.js'), 'utf8')),
            '导航栏缺少 L');
        assert.ok(/k === 'L'/.test(itv), '菜单未处理 L 键');
        assert.ok(/options\.onEnterLongCommand \|\| options\.startRepl/.test(itv),
            'L 未走注入的回调');
        // 只看真实代码行：注释里提到 require('./cli') 是解释「为什么不这么做」
        const codeLines = itv.split('\n').filter(l => !/^\s*\//.test(l));
        assert.ok(!codeLines.some(l => /require\(['"]\.\/cli['"]\)/.test(l)),
            'interactive 不应 require cli（循环依赖）');
    });
    check('buildMenuOptions 注入 startRepl 回调', () => {
        assert.ok(/startRepl: \(\) => startRepl\(\)/.test(cli), '未注入 startRepl 回调');
    });

    // ── V3.6.2：面板启动服务器 → REPL 同步进入日志跟踪 ──
    check('REPL 含日志跟踪：心跳跳变检测（isConsoleRelayAlive）', () => {
        assert.ok(/isConsoleRelayAlive\(\)/.test(cli), '未使用控制台中继心跳判断服务器启动');
        assert.ok(/wasRelayAlive === false && alive/.test(cli), '缺少「死 → 活」跳变判定');
    });
    check('日志跟踪增量 tail（半行留到下一轮）', () => {
        assert.ok(/stdoutLogFile/.test(cli), '未指向 wow-stdout 日志');
        assert.ok(/lastIndexOf\('\\n'\)/.test(cli), '未按完整行推进 offset');
        assert.ok(/st\.size < followOffset/.test(cli), '日志被重写（重启）时未重置 offset');
    });
    check('跟踪不干扰 REPL 输入（清行 + 重绘提示符）', () => {
        const m = cli.match(/const printLine = \(line\) => \{[\s\S]{0,900}?\n    \};/);
        assert.ok(m, '未抽出 printLine');
        assert.ok(/clearLine/.test(m[0]) && /rl\.prompt\(true\)/.test(m[0]), '打印未重绘提示符');
        // echoSink 与日志跟踪共用同一打印通道
        assert.ok(/setEchoSink\(printLine\)/.test(cli), 'echoSink 未复用 printLine');
    });
    check('本终端敲 server start 不触发跟踪（交给开服控制台）', () => {
        assert.ok(/ownServerOp = true/.test(cli), '未标记 ownServerOp');
        assert.ok(/!ownServerOp\) \{\n            startFollow/.test(cli), 'startFollow 未检查 ownServerOp');
    });
    check('服务器停止后自动退出跟踪，REPL 退出时清理定时器', () => {
        assert.ok(/服务器已停止，已退出日志跟踪/.test(cli), '缺少退出跟踪提示');
        // V3.7.4：close 回调里多了「归还 stdin 租约」那几行，
        // 窗口从 400 放宽到 900，断言本身（两个定时器都要清）不变。
        const m = cli.match(/rl\.on\('close', async \(\) => \{[\s\S]{0,900}?following = false;/);
        assert.ok(m && /clearInterval\(followTimer\)/.test(m[0]) && /clearInterval\(detectTimer\)/.test(m[0]),
            'close 回调未清理跟踪定时器');
    });
    check('进入 REPL 时服务器已在运行也直接跟进', () => {
        assert.ok(/服务器正在运行（由 Web 面板或其它进程启动）/.test(cli), '缺少已运行场景提示');
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

// ─────────────────────────────────────────────
// V3.5.11：不再单独询问模组加载器（引导界面 / CLI -help / web 表单）+ neoforge 入口
console.log('\n— V3.5.11 加载器随类型自动确定（interactive.js）—');
check('引导菜单类型列表包含 neoforge', () => {
    assert.ok(/sTypes = \[[^\]]*'neoforge'/.test(src), 'sTypes 缺少 neoforge');
});
check('新建方案不再询问「加载器 (默认 ...)」', () => {
    assert.ok(!/ask\(rl, [`']加载器/.test(src), '仍存在加载器提问');
});
check('loader 随核心类型自动确定（create 传入 loader: type）', () => {
    assert.ok(/loader: type/.test(c2full), 'create 未传 loader: type');
});

console.log('\n— V3.5.11 scheme create 帮助文案（cli.js）—');
{
    const CLI = path.join(__dirname, '..', 'src', 'cli.js');
    const cli = fs.readFileSync(CLI, 'utf8');

    check('-t 帮助不再宣称「核心类型/加载器 … 同时决定加载器」', () => {
        assert.ok(!/同时决定加载器/.test(cli), '仍存在「同时决定加载器」表述');
        assert.ok(!/核心类型\/加载器/.test(cli), '仍存在「核心类型/加载器」表述');
    });
    check('-t 帮助说明加载器随类型自动确定', () => {
        assert.ok(/核心类型 \(vanilla\/forge\/fabric\/neoforge\/quilt\/mohist\/catserver\/paper\)/.test(cli),
            '-t 帮助缺少核心类型枚举');
        assert.ok(/模组加载器随类型自动确定/.test(cli), '-t 帮助未说明自动确定');
    });
    check('-b 帮助不再枚举加载器版本', () => {
        assert.ok(!/加载器版本（forge\/fabric\/neoforge\/quilt）/.test(cli),
            '-b 帮助仍枚举加载器版本');
    });
}

console.log('\n— V3.5.11 web 方案创建表单（web/ + themes/default）—');
for (const p of [
    path.join(__dirname, '..', '..', 'web', 'scheme.html'),
    path.join(__dirname, '..', '..', 'themes', 'default', 'scheme.html')
]) {
    const where = p.includes('themes') ? 'themes/default' : 'web';
    const html = fs.readFileSync(p, 'utf8');
    check(`${where}/scheme.html 已移除「模组加载器」下拉`, () => {
        assert.ok(!/id="new-loader"/.test(html), '仍存在 new-loader 下拉');
        assert.ok(!/newLoader/.test(html), '仍存在 newLoader JS 引用');
        assert.ok(!/>模组加载器</.test(html), '仍存在「模组加载器」标签');
    });
    check(`${where}/scheme.html 创建命令仅传 --type（加载器不再单传）`, () => {
        // V3.5.19：web 版改成 argv 数组 + 异步任务，不再拼一整条字符串，
        // 但语义必须仍然是「--version / --type」，且不得再单传 loader。
        const oldForm = /scheme create \$\{name\} --version \$\{version\} --type \$\{type\}/.test(html);
        const argvForm = /const argv = \[[^\]]*name[^\]]*--version[^\]]*version[^\]]*--type[^\]]*type/s.test(html);
        assert.ok(oldForm || argvForm, '创建命令构造被改坏');
        assert.ok(!/--loader/.test(html), '仍在创建命令里单传 --loader');
        // 拼字符串时必须用单空格分隔，禁止出现 `${a}  ${b}` 这类双空格（会被拆出空参数）
        assert.ok(!/scheme create \$\{name\}  /.test(html), '创建命令出现双空格');
    });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
