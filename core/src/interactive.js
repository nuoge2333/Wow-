/**
 * M 模式（数字菜单）模块
 * ============================================================
 *
 * 入口：
 *   - wow / wow.bat / ./wow.sh（无参数）→ 直接进入本界面
 *   - wow m                              → 同上
 *   - wow L                              → 长命令模式（REPL）
 *   - server start 的控制台里输入 :wow    → 也进入本界面（V3.6.3 起）
 *
 * 结构（V3.6.3 / 609 指令重构）：
 *   ┌ 状态栏     版本 / 服务器状态 / 当前方案 / 已装与当前 Java
 *   ├ 分隔线
 *   ├ 功能区     七页之一的功能列表（数字对应下方 dispatch 里的 case）
 *   └ 导航栏     [Q]服务器 [W]方案 [E]内容 [R]网络 [T]工具 [Y]高级 [L]长命令 [0]退出
 *
 * 七页的**功能编号**刻意保持与原主菜单 1~14 一一对应（见 PAGES 的 id），
 * 这样 `dispatch()` 里的 `case '1'` … `case '14'` 一行都不用改：
 * 改的只是「用户按哪个键能走到这个 case」，不是「case 里做什么」。
 *
 * 按键（TUI 模式）：
 *   - Q/W/E/R/T/Y 切页并重绘（字母键按下即生效）
 *   - 数字         进入编号输入框，**回车**执行当前页对应功能
 *   - Backspace    删掉输错的最后一位编号
 *   - L            进入长命令模式
 *   - 0 + 回车     退出（二次确认）
 *   - 回车         编号为空时重绘当前页（刷新状态）
 *   - Ctrl+C       退出（二次确认）
 *
 * 数字为什么必须回车：编号有 1~3 位（`1` / `14` / `141`），单键触发要么猜、
 * 要么加等待窗口——两者都会让「手快」变成错误。与原来的数字菜单保持一致，
 * 输入完整编号再回车，简单且没有时序问题。
 *
 * 无 TTY（管道 / CI / Docker）时自动降级为「输入一行 + 回车」的兼容模式，
 * 七页与功能完全一致。
 *
 * 单 readline 原则：
 *   整个 M 模式只有 tui.createKeyboard() 创建的那一个 readline。二级菜单
 *   通过 pause() 让出键盘、复用同一个 rl 提问，绝不新建第二个实例——
 *   两个 rl 同时挂在 stdin 上会让每个字符被回显两遍（历史 bug）。
 *   唯一的例外是「跳去 server start / L 模式」，那两处必须彻底 close()
 *   交还 stdin（否则会与那边的 readline 抢键盘），详见 jump 相关注释。
 */

const path = require('path');
const pkg = require('../package.json');
// V3.5.0：事件日志
const { logger } = require('./log');
const tui = require('./tui');

// ==================== 页面定义（数据层） ====================
//
// 只有声明，没有逻辑。id 就是 dispatch() 的 case 编号：
//   1 启动服务器         2 方案管理         3 管理模组/插件     4 模组搜索下载
//   5 server.properties  6 认证设置         7 下载管理器设置    8 系统设置
//   9 安装整合包        10 生成整合包      11 错误日志分析     12 状态监控
//  13 Web 主题          14 陶瓦联机        15 长命令模式
//
// `hint` 是右对齐的实时备注（函数形式，画页时求值一次），
// 拿不到数据就不显示——不会让整行消失，布局稳定。

// 七页的**功能编号**改为「按页顺号」：每页都从 1 开始、依次 1 2 3 4 …，
// 到哪一页都是「第 n 项敲 n 回车」。这样界面上看到的数字就是能敲的数字，
// 不需要记忆「22 属于 W 页」这类跨页编号。
//
// 每个功能除了本页序号，还可能保留**旧编号**（legacy）——原扁平菜单的
// 1~14 与 3.7.x 的 21/22/31/141 等扩展编号。旧编号仍然认，但按「别处才认」
// 处理：本页没有对应项时才跳页/转调，界面上用灰字小注 `旧 22` 提示，不占编号列。
//
// `hint` 是右对齐的实时备注（函数形式，画页时求值一次），
// 拿不到数据就不显示——不会让整行消失，布局稳定。
//
// `legacy` 的两种形态：
//   - 数组：这些旧编号都指向本页这一项（如 Q 页第 3 项既认旧 5）；
//   - 函数：旧编号需要转调别的菜单（由 dispatchMenuItem 的 LEGACY_ROUTES 处理）。
// 注意 **旧编号可以在多页重复**（`4` 在 Q/E/T 都是「模组搜索下载」的不同别名），
// 跨页解析时只用来「找一项能执行的」，执行内容以 dispatchMenuItem 的 case 为准。

/** 备注列宽上限（按最长的一条留位，保证旧编号小注不会把页面撑过 70 列） */
const HINT_MAX = 8;

const PAGES = [
    {
        key: 'Q',
        label: '服务器',
        title: '服务器启停 / 运行状态',
        items: [
            {
                id: '1', legacy: ['1'], label: '启动 / 停止服务器',
                hint: (ctx) => {
                    const s = ctx.status.collect();
                    return s.running ? '运行中' : '已停止';
                }
            },
            {
                id: '2', legacy: ['12'], label: '服务器状态监控',
                hint: (ctx) => (ctx.status.collect().running ? '可看实时日志' : null)
            },
            {
                id: '3', legacy: ['5'], label: '变更配置 (server.properties)',
                hint: () => '端口/人数/难度…'
            },
            { id: '4', legacy: ['11'], label: '错误日志分析', hint: () => '崩溃排查' },
            { id: '5', legacy: ['4'], label: '查看控制台日志（实时跟踪）', hint: () => 'Ctrl+C 停' },
            {
                id: '6', legacy: ['14'], label: '联机 / 我要当房主 (陶瓦)',
                hint: () => '无需公网 IP'
            }
        ]
    },
    {
        key: 'W',
        label: '方案',
        title: '方案管理',
        items: [
            {
                id: '1', legacy: ['2'], label: '方案管理 (新建/切换/列表/删除/信息)',
                hint: (ctx) => {
                    const s = ctx.status.collect().scheme;
                    return s ? `当前: ${s}` : '未指定';
                }
            },
            { id: '2', legacy: ['21'], label: '快速切换方案', hint: () => '输入名称即可' },
            { id: '3', legacy: ['22'], label: '列出全部方案（含状态）', hint: () => 'mark 标记当前' },
            { id: '4', legacy: ['23'], label: '方案信息 / 资源引用', hint: () => '独占统计' },
            { id: '5', legacy: ['24'], label: '新建方案', hint: () => '类型 + 版本' },
            { id: '6', legacy: ['25'], label: '删除方案', hint: () => '需二次确认' },
            { id: '7', legacy: ['9'], label: '安装整合包（新建方案的另一种入口）', hint: () => 'zip / URL' },
            { id: '8', legacy: ['10'], label: '生成客户端整合包', hint: () => '导出给朋友' },
            { id: '9', legacy: ['26'], label: '整理资源池（瘦身）', hint: () => '清未引用文件' }
        ]
    },
    {
        key: 'E',
        label: '内容',
        title: '内容与配置（模组 / 插件 / 配置文件）',
        items: [
            {
                id: '1', legacy: ['3'], label: '管理模组 / 插件',
                hint: (ctx) => {
                    try {
                        const n = ctx.options.modManager ? ctx.options.modManager.listMods().length : null;
                        return n == null ? null : `已装 ${n} 个`;
                    } catch (e) { return null; }
                }
            },
            { id: '2', legacy: ['4'], label: '模组 / 插件搜索下载', hint: () => 'URL / 本地文件' },
            { id: '3', legacy: ['31'], label: '列出已安装模组', hint: () => '启用状态一览' },
            { id: '4', legacy: ['32'], label: '启用 / 禁用模组', hint: () => '不删文件' },
            { id: '5', legacy: ['33'], label: '查看 / 编辑模组配置文件', hint: () => 'GUI 在 Web 端' },
            { id: '6', legacy: ['34'], label: '备份模组配置文件', hint: () => '改坏能回滚' },
            { id: '7', legacy: ['5'], label: '变更配置 (server.properties)', hint: () => '核心玩法参数' }
        ]
    },
    {
        key: 'R',
        label: '网络',
        title: '网络与联机',
        items: [
            {
                id: '1', legacy: ['14'], label: '联机 / 我要当房主 (陶瓦)',
                hint: () => 'PCL/HMCL 内置支持'
            },
            { id: '2', legacy: ['141'], label: '开房（生成房间号）', hint: () => '好友输房间号加入' },
            { id: '3', legacy: ['142'], label: '查看房间号 / 状态', hint: () => '当前联机信息' },
            { id: '4', legacy: ['143'], label: '关房（停止陶瓦）', hint: () => '释放进程' },
            { id: '5', legacy: ['7'], label: '下载镜像 / 超时 / 重试', hint: () => 'BMCLAPI 等' },
            { id: '6', legacy: ['121'], label: '服务器端口与外网可见性', hint: () => 'server-port' },
            { id: '7', legacy: ['122'], label: '查看本机网络信息', hint: () => '内网 IP / 端口' },
            { id: '8', legacy: ['123'], label: 'Web 面板启动 / 停止', hint: () => '浏览器管理' }
        ]
    },
    {
        key: 'T',
        label: '工具',
        title: '工具与日志',
        items: [
            {
                id: '1', legacy: ['11'], label: '错误日志分析',
                hint: () => 'AI 摘要 / 报告'
            },
            { id: '2', legacy: ['111'], label: 'AI 分析最近日志', hint: () => '定位崩溃原因' },
            { id: '3', legacy: ['112'], label: '生成统计报告', hint: () => '保存为文件' },
            { id: '4', legacy: ['4'], label: '实时日志跟踪', hint: () => 'tail -f，Ctrl+C 退出' },
            { id: '5', legacy: ['113'], label: '清理旧日志（保留最近 N 天）', hint: () => '省磁盘' },
            { id: '6', legacy: ['10'], label: '生成客户端整合包', hint: () => '打包发给朋友' },
            { id: '7', legacy: ['9'], label: '安装整合包', hint: () => 'zip / URL' }
        ]
    },
    {
        key: 'Y',
        label: '高级',
        title: '高级与杂项',
        items: [
            {
                id: '1', legacy: ['8'], label: '系统设置（Java / 性能 / 信息）',
                hint: (ctx) => {
                    const s = ctx.status.collect();
                    return s.javaInstalled.length ? `${s.javaInstalled.length} 个 Java` : '未检测到 Java';
                }
            },
            { id: '2', legacy: ['81'], label: 'Java 设置（扫描 / 选择 / 自动安装）', hint: () => '换 JDK 版本' },
            { id: '3', legacy: ['82'], label: '修改 JVM 参数（模板 a/b/c/d + 覆盖）', hint: () => '内存与 GC' },
            { id: '4', legacy: ['83'], label: '查看系统信息', hint: () => 'OS / 内存 / Node' },
            { id: '5', legacy: ['84'], label: '重置全部配置', hint: () => '⚠ 不可撤销' },
            { id: '6', legacy: ['6'], label: '认证设置 (外置登录)', hint: () => 'authlib-injector' },
            { id: '7', legacy: ['13'], label: 'Web 主题更改', hint: () => '第三方主题' }
        ]
    }
];

/** 页键 → 页定义 */
const PAGE_MAP = new Map(PAGES.map(p => [p.key, p]));

/** 取一项的全部编号：本页序号 + 旧编号 */
function idsOf(item) {
    if (!item) return [];
    const legacy = Array.isArray(item.legacy) ? item.legacy : [];
    return [String(item.id), ...legacy.map(String)];
}

/** 某页里编号命中的项（本页序号优先，其次旧编号） */
function itemOfPage(pageKey, id) {
    const p = PAGE_MAP.get(pageKey);
    if (!p) return null;
    const key = String(id);
    const exact = p.items.find(it => String(it.id) === key);
    if (exact) return exact;
    return p.items.find(it => idsOf(it).includes(key)) || null;
}

/**
 * 编号 → 页（跨页查找用）。
 *
 * 顺序：本页序号 → 本页旧编号 → 其他页序号 → 其他页旧编号。
 * 旧编号可以在多页重复（`4` = 模组搜索下载 / 实时日志），取第一次出现的页即可——
 * 真正执行时由 dispatchMenuItem 的 case 决定做什么，这里只负责「找得到」。
 */
function findPageOfItem(id, currentPage) {
    const key = String(id);
    if (currentPage && PAGE_MAP.has(currentPage)) {
        const p = PAGE_MAP.get(currentPage);
        if (p.items.some(it => String(it.id) === key)) return currentPage;
        if (p.items.some(it => idsOf(it).includes(key))) return currentPage;
    }
    for (const p of PAGES) {
        if (p.items.some(it => String(it.id) === key)) return p.key;
    }
    for (const p of PAGES) {
        if (p.items.some(it => idsOf(it).includes(key))) return p.key;
    }
    return null;
}

/**
 * 编号解析（模块级，TUI 与兼容模式共用）。
 *
 * 返回 `{ page, item, functional }`，找不到返回 null。
 *   - `page`       命中项所在页（跨页命中时调用方要把 state.page 改过去）；
 *   - `item`       命中的项（用于取 label 等）；
 *   - `functional` 稳定功能键（该项的旧编号 / 主编号），dispatchMenuItem 认这个。
 *
 * 优先级：本页序号（界面上显示的 1 2 3…）→ 本页旧编号 → 别的页的旧编号。
 * 「到哪一页都是 1,2,3,4,5」靠第一条：同一页里序号唯一，敲几就是本页第几项。
 */
function resolveNumber(id, page) {
    const key = String(id);
    const firstLegacy = (it) => String((Array.isArray(it.legacy) ? it.legacy : [])[0] || it.id);

    let item = itemOfPage(page, key);
    if (item) return { page, item, functional: firstLegacy(item) };

    const owner = findPageOfItem(key, null);
    if (owner) {
        item = itemOfPage(owner, key);
        if (item) return { page: owner, item, functional: firstLegacy(item) };
    }
    return null;
}

// ==================== 旧接口（保持向后兼容） ====================

/**
 * 创建 readline 接口（**仅供外部未接管 stdin 时使用**）。
 *
 * V3.6.3 起 M 模式自身改用 tui.createKeyboard()；本函数保留是因为
 * `dispatchMenu(choice, options)` 的外部调用方（插件、测试脚本）可能
 * 直接调 dispatchMenu 而不传 rl。
 */
function createRL() {
    // 走单例：兼容模式下这是唯一的消费者，但同一个进程里也可能
    // 已经有别人持有 stdin（例如从 REPL 里 `m` 回菜单的瞬间）。
    // 单例负责排队/接管，不再让两处各自 createInterface。
    const stdinSession = require('./stdin_session');
    const lease = stdinSession.acquireSync('interactive.menu');
    const rl = lease.rl;
    // 调用方按老习惯 `rl.close()` 收尾——这里顺手把租约也还回去，
    // 否则单例会一直以为 stdin 还有人占着，后续的提问全部排队卡死。
    const origClose = rl.close.bind(rl);
    // 让 lease.release() 能拿到「真正的 close」，避免它调到我们这层包装
    // 造成 release → close → release 的相互递归。
    rl.__origClose = origClose;
    let handedBack = false;
    rl.close = function () {
        if (!handedBack) {
            handedBack = true;
            // 不 await：close() 的调用点遍布同步 finally，等不起
            lease.release().catch(() => {});
        }
        return origClose();
    };
    return rl;
}

/**
 * 异步提问。
 *
 * 必须兼容两种 rl：
 *   - tui 键盘实例的 rl（已经过 pause()，raw 模式已关）——正常 question；
 *   - createRL() 的普通 rl。
 * 另外给一个 `rl.once('close')` 兜底：如果期间用户 Ctrl+C 关掉了 rl，
 * Promise 也必须 resolve，否则整个 TUI 会永久挂在这个 await 上。
 */
function ask(rl, prompt) {
    return new Promise(resolve => {
        if (!rl || rl.closed) return resolve('');
        let settled = false;
        const done = (v) => {
            if (settled) return;
            settled = true;
            try { rl.removeListener('close', onClose); } catch (e) { /* 忽略 */ }
            resolve(v);
        };
        const onClose = () => done('');
        try { rl.once('close', onClose); } catch (e) { /* 忽略 */ }
        try {
            rl.question(prompt, ans => done(String(ans == null ? '' : ans)));
        } catch (e) {
            done('');
        }
    });
}

/** 清屏（导出给 server.js 复用） */
function clearScreen() {
    tui.clear();
}

/** 打印标题栏（二级菜单内部仍用它区分段落，保持与历史输出风格一致） */
function printHeader(title) {
    console.log('═'.repeat(60));
    console.log(`  ${title}`);
    console.log('═'.repeat(60));
}

// ==================== 主循环 ====================

/**
 * 显示 M 模式界面。
 *
 * @param {object} options buildMenuOptions() 的结果
 * @param {string|object} [directChoice]
 *        直接跳转：数字（'2'）或页键（'W'）。仅供内部/测试/`:wow 3` 这类
 *        直达入口使用，不再对外宣传。
 */
async function showMainMenu(options = {}, directChoice = null) {
    const state = {
        page: 'Q',
        notice: null
    };

    // 直达某项：执行完就返回，不进循环（与历史行为一致）
    if (directChoice) {
        const rl = createRL();
        try {
            const key = String(directChoice).toUpperCase();
            if (PAGE_MAP.has(key)) {
                // 直达某页：进 TUI 并停在该页
                state.page = key;
            } else {
                await dispatchMenu(key, options, rl);
                return;
            }
        } finally {
            rl.close();
        }
    }

    // 选定运行模式：能进 raw 模式就上 TUI，否则退回「输入 + 回车」
    const interactive = tui.canUseTui();

    if (!interactive) {
        return runCompatMode(options, state);
    }
    return runTuiMode(options, state);
}

/**
 * TUI 模式：唯一 readline + 字母键即时、数字回车提交。
 */
async function runTuiMode(options, state) {
    const status = new tui.StatusBar(options);
    const ctx = { options, status };
    let kb = null;
    // 标记「本页要离开 TUI」：置成 'L' 后主循环 return，由外层决定去哪儿
    let leaving = null;
    let pendingConfirmExit = false;

    /**
     * 编号输入缓冲：敲数字累积、回车提交。
     *
     * 与原生（兼容）模式一致——「选择」永远是「输入编号 + 回车」，
     * 不做「按下即触发」。早先试过按键即触发 + 250ms 拼接窗口，两个毛病：
     *   - 人手连按同键要 120~250ms，`22` 常被拆成两次 `2`，落进方案管理子菜单；
     *   - 等待窗口里的定时器没随切页取消时，旧页编号会在新页执行，
     *     更糟的是泄漏到已经交还 stdin 的 REPL 里抢输入。
     * 回车提交后缓冲只在 onKey 里存活，切页 / 进 L / 退出即清空，两类问题一起消失。
     */
    let numBuf = '';
    const cancelNumber = () => { numBuf = ''; };

    const render = (notice) => {
        const def = PAGE_MAP.get(state.page) || PAGE_MAP.get('Q');
        // 计算一次 hint（每项最多调一次 status.collect()，内部有 300ms 缓存）
        const withHints = {
            key: def.key,
            label: def.label,
            title: def.title,
            items: def.items.map(it => ({
                id: it.id,
                label: it.label,
                legacy: it.legacy,
                // hint 长度也计入排版：旧编号小注 + 备注必须塞进 70 列，
                // 最长的一条按 8 个字算（`旧 141  内网 IP / 端口`）
                hint: typeof it.hint === 'function' ? it.hint(ctx) : it.hint,
                maxHint: HINT_MAX
            }))
        };
        tui.drawPage({
            page: def.key,
            def: withHints,
            status,
            notice,
            // 正在输入的编号回显在提示行，否则敲了 `2` 屏幕上看不见
            input: numBuf || null
        });
        // notice 是「上一个动作的尾巴」，画过一次就作废。
        // 不清的话它会一直挂在页面底部，用户切回来看见一条早就不成立的提示。
        state.notice = null;
    };

    /** 执行一个功能：挂起键盘 → 跑 dispatch → 按回车返回 → 恢复并重绘 */
    const runItem = async (id) => {
        const hit = resolveNumber(id, state.page);
        if (!hit) {
            state.notice = `没有编号 ${id} 的功能（本页 1~${(PAGE_MAP.get(state.page) || { items: [] }).items.length || 1}，Q/W/E/R/T/Y 切页）`;
            return null;
        }
        // 跨页命中：切到那一页再执行，返回时用户停在新页
        if (hit.page !== state.page) state.page = hit.page;
        const functional = hit.functional;

        // 启动服务器：服务端控制台会接管 stdin，必须关掉 TUI 的 readline
        if (functional === '1') {
            const r = await maybeJumpToServer(options, kb, status);
            if (r.handled) return 'SERVER';
            // 服务器已在运行 / 用户拒绝启动 / 启动失败 → 停在原地重绘。
            // 失败原因要带进 notice：重绘会清屏，只 console.error 的话用户根本看不到。
            if (r.message) state.notice = r.message;
            status.invalidate();
            return null;
        }

        // 挂起 TUI 键盘，把 stdin 让给二级菜单
        const io = makeIo(kb);
        if (io) await io.enter();
        let jumpServer = false;
        try {
            jumpServer = await dispatchMenuItem(String(id), options, null, ctx, io, { page: hit.page });
        } catch (e) {
            console.error(`\n❌ 执行出错: ${e.message}`);
            logger.erro(`菜单操作 ${id} 出错: ${e.message}`);
        }
        status.invalidate();
        if (!jumpServer) {
            // 统一收尾：按回车返回 → 收回键盘 → 重绘
            await tui.askLine('\n按回车键返回...');
            // 让终端把「回车 + 最后一次回显」刷干净，再重建 TUI 的 readline，
            // 否则下一帧清屏前会闪一行用户看不出所以然的字符
            await new Promise(r => setImmediate(r));
            if (io) io.leave();
        }
        return jumpServer ? 'SERVER' : null;
    };

    /** 主循环等待的「离开信号」：由任一路径 fulfill */
    let signalLeave = () => {};
    const leave = new Promise(resolve => { signalLeave = resolve; });

    /** 提交编号：执行 → 处理离开 → 重绘。编号由回车触发，见 onKey 的 RETURN 分支 */
    const flushNumber = async (id) => {
        const next = await runItem(id);
        if (next) {
            leaving = next;
            signalLeave();
            return;
        }
        render(state.notice);
    };

    /**
     * 退出确认通过后的收尾。
     *
     * 独立入口（`wow` / `wow m`）：关掉键盘、结束进程，这是对的。
     * 从开服控制台的 `:wow` 进来时：**绝不能 `process.exit`** —— 那会把正在跑的
     * 服务端连同控制台一起弄没。调用方传了 `returnOnExit` 就只离开 TUI 循环，
     * 由 server 的 `_enterMenuFromConsole()` 把画面还给 `:wow` 控制台。
     */
    const finishExit = () => {
        cancelNumber();
        pendingConfirmExit = false;
        if (options.returnOnExit) {
            leaving = 'EXIT';
            signalLeave();
            return;
        }
        kb.close();
        process.exit(0);
    };

    /** 进入退出确认。`0` + 回车，或 Ctrl+C，都走这里 */
    const askExit = () => {
        cancelNumber();
        pendingConfirmExit = true;
        render('确定要退出吗？按 Y 确认，其他任意键取消');
    };

    const onKey = async (k) => {
        // 退出确认：只有 Y 走，其余键取消；若按的是数字，顺手当作新输入的开头
        if (pendingConfirmExit) {
            // 大小写都认：提示写的是「按 Y 确认」，可 CapsLock / Shift 下敲出来的
            // 是大写，早先只比 `'Y'` 会让大写 Y 落到切页上（直接跳到 Y 页）。
            if (String(k).toUpperCase() === 'Y') {
                finishExit();
                return;
            }
            pendingConfirmExit = false;
            state.notice = null;
            numBuf = /^[0-9]$/.test(k) ? k : '';
            render();
            return;
        }

        // 页键 / L：字母键仍然「按下即切」，那是 TUI 的顺手之处，不需要回车
        if (PAGE_MAP.has(k)) {
            cancelNumber();
            state.page = k;
            state.notice = null;
            render();
            return;
        }
        if (k === 'L') {
            cancelNumber();
            leaving = 'L';
            signalLeave();
            return;
        }

        // 回车：提交编号缓冲。空缓冲时只刷新状态（保留旧的行为）
        if (k === 'RETURN') {
            const id = numBuf;
            numBuf = '';
            if (!id) {
                status.invalidate();
                state.notice = null;
                render();
                return;
            }
            // `0` 是退出，不是本页功能
            if (id === '0') {
                askExit();
                return;
            }
            await flushNumber(id);
            return;
        }

        // 退格：删一位
        if (k === 'BACKSPACE') {
            if (numBuf) {
                numBuf = numBuf.slice(0, -1);
                render();
            }
            return;
        }

        // 数字：只入缓冲，等回车。最多 4 位，防止乱按堆出一长串
        if (/^[0-9]$/.test(k)) {
            if (numBuf.length < 4) {
                numBuf += k;
                render();
            }
            return;
        }

        // 兼容旧的「回车 = 刷新」语义（tui.js 已改为发 RETURN，这里留个兜底）
        if (k === 'REFRESH') {
            status.invalidate();
            state.notice = null;
            render();
            return;
        }
        // 其他键：忽略（不刷屏、不响铃）
    };

    kb = tui.createKeyboard({
        onKey: (k) => { onKey(k); },
        onInterrupt: () => {
            // tui.js 已对「keypress 的 ctrl-c」与「rl 的 SIGINT」做过 80ms 去重，
            // 所以这里每次 Ctrl+C 只进来一次：第一次画确认框，第二次才真退出。
            if (pendingConfirmExit) {
                finishExit();
                return;
            }
            askExit();
        },
        onEof: () => {
            cancelNumber();
            if (!leaving) leaving = 'EOF';
            signalLeave();
        }
    });

    // 画面归 TUI 独占：从第一帧起，服务器日志（MC stdout 回显 / L 模式跟踪）
    // 一律不许往终端写——否则会从菜单底下顶出来，把七页界面冲乱。
    tui.markScreenActive(true);
    render();
    await leave;
    kb.close();

    // 画面交还：从这里起日志可以正常回显（开服控制台 / REPL 各有自己的判断）
    tui.markScreenActive(false);

    if (leaving === 'L') {
        // L 模式：彻底交还 stdin，由注入的回调接手。
        //
        // V3.6.3（609 指令约束③）：去处由调用方决定，不是硬编码 startRepl——
        //   - 独立入口（wow / wow m）：回调是 cli 的 startRepl，进长命令 REPL；
        //   - 开服控制台（server start 里敲 :wow）：回调是 server 的
        //     `_backToConsole('wow')`，回到 :wow 视图（那里可再切 :mc / :lan）。
        // 「server start 的三视图」正是 L 模式下 Minecraft 正在运行时的形态，
        // 所以从菜单进 L 必须落回 :wow，而不是另起一个 REPL 与它抢 stdin。
        const enter = options.onEnterLongCommand || options.startRepl;
        if (typeof enter === 'function') {
            await enter('L');
            return;
        }
        console.log('长命令模式入口不可用，请直接运行 wow L。');
        return;
    }
    if (leaving === 'SERVER') {
        // 服务器启动由 dispatch 内部完成（服务端控制台的 readline 已经接管 stdin）
        return;
    }
    if (leaving === 'EXIT') {
        // 从开服控制台进来的菜单：画面交回调用方（server._backToConsole）
        return;
    }
    // EOF / 独立入口的退出已走 process.exit，正常不会到这里
}

/**
 * 兼容模式（无 TTY）：输入一行 + 回车。
 *
 * 与 TUI 模式功能完全一致，只是没有「按下即触发」。
 * 页键与数字键都要支持：输入 `w` 切到方案页，输入 `1` 执行本页第 1 项，
 * 输入 `0` 退出，输入 `L` 进长命令模式。
 */
async function runCompatMode(options, state) {
    const status = new tui.StatusBar(options);
    const ctx = { options, status };
    const rl = createRL();

    try {
        while (true) {
            const def = PAGE_MAP.get(state.page) || PAGE_MAP.get('Q');
            const plain = {
                key: def.key,
                label: def.label,
                title: def.title,
                items: def.items.map(it => ({
                    id: it.id,
                    label: it.label,
                    legacy: it.legacy,
                    hint: typeof it.hint === 'function' ? it.hint(ctx) : it.hint,
                    maxHint: HINT_MAX
                }))
            };
            tui.drawPage({ page: def.key, def: plain, status, notice: state.notice });
            state.notice = null;

            const raw = (await ask(rl, '请选择（数字执行 / QWERTY 切页 / L 长命令 / 0 退出）: ')).trim();
            // EOF（`echo ... | wow m` 的输入用完、cron / 重定向 stdin）：
            // ask() 在 rl 关闭时 resolve('')，此时 `continue` 会立刻再问一次，
            // 而问题同样立刻 resolve('')——死循环重绘同一个页面，CPU 空转。
            if (rl.closed) {
                if (!raw) console.log('\n（输入已结束，退出菜单）');
                return;
            }
            if (!raw) continue;
            const k = raw.toUpperCase();

            if (k === '0' || k === 'EXIT' || k === 'QUIT') {
                const c = (await ask(rl, '确定要退出吗? (y/N): ')).trim().toLowerCase();
                if (c === 'y') {
                    console.log('感谢使用 wow~，再见!');
                    return;
                }
                continue;
            }
            if (PAGE_MAP.has(k)) {
                state.page = k;
                continue;
            }
            if (k === 'L') {
                rl.close();
                const enter = options.onEnterLongCommand || options.startRepl;
                if (typeof enter === 'function') {
                    await enter('L');
                    return;
                }
                console.log('长命令模式入口不可用，请直接运行 wow L。');
                return;
            }
            if (/^[0-9]+$/.test(k)) {
                // 与 TUI 模式同一套解析：本页序号 → 本页旧编号 → 跨页旧编号
                const hit = resolveNumber(k, state.page);
                if (!hit) {
                    state.notice = `没有编号 ${k} 的功能（本页 1~${(PAGE_MAP.get(state.page) || { items: [] }).items.length || 1}，Q/W/E/R/T/Y 切页）`;
                    logger.warn(`无效菜单选择: ${raw}`);
                    continue;
                }
                if (hit.page !== state.page) state.page = hit.page;
                if (hit.functional === '1') {
                    const r = await maybeJumpToServer(options, null, status, rl);
                    if (r.handled) {
                        rl.close();
                        return;
                    }
                    if (r.message) state.notice = r.message;
                    status.invalidate();
                    continue;
                }
                const jump = await dispatchMenuItem(k, options, rl, ctx, null, { page: hit.page });
                if (jump) {
                    rl.close();
                    return;
                }
                status.invalidate();
                continue;
            }
            state.notice = `无法识别「${raw}」：数字执行当前页功能，Q/W/E/R/T/Y 切页，L 长命令，0 退出`;
            logger.warn(`无效菜单选择: ${raw}`);
        }
    } finally {
        try { rl.close(); } catch (e) { /* 忽略 */ }
    }
}

/**
 * 二级菜单的统一输入通道。
 *
 * **为什么要包一层**（V3.6.3 实测教训）：
 *   TUI 的 readline 处于 raw 模式时，`rl.question()` 会重复插入触发键
 *   （按 2 进二级菜单，问题里先出现一个 2）。正确做法是先把键盘
 *   `suspend()` 出去（TUI 的 rl 被销毁、raw 模式退出），再用干净的行读取器
 *   提问，问完 `resume()` 重建。
 *
 * 本类把这套「挂起-提问-恢复」封装起来，`dispatchMenu` 只看到统一的
 * `ask()`。外部调用方（未传 kb、直接用 dispatchMenu）拿到的是普通 rl，
 * 走原生 question。
 */
function makeIo(kb) {
    if (!kb) {
        // 无 TUI：调用方从 dispatchMenu 的 rl 参数走原生提问
        return null;
    }
    return {
        interactive: true,
        /** 进入二级菜单：交出键盘 */
        async enter() { await kb.suspend(); },
        /** 离开二级菜单：收回键盘 */
        leave() { kb.resume(); },
        /** 问一行 */
        ask(prompt) {
            return tui.askLine(prompt);
        },
        log(msg) { console.log(msg); },
        close() { /* 由 enter/leave 成对管理，不在这里关 */ }
    };
}

/** 统一的提问入口：有 io 走 io，没有就用传入的 rl */
async function ioAsk(io, rl, prompt) {
    if (io) return io.ask(prompt);
    return ask(rl, prompt);
}


// ==================== 服务器启动的特殊分支 ====================

/**
 * Q 页第 1 项「启动 / 停止服务器」。
 *
 * 为什么单独拎出来：
 *   `server.start()` 在交互模式（TTY）下会**自己接管 stdin**（server.js 的
 *   readline），并把当前进程挂起直到服务端退出。如果此时 TUI 的 readline
 *   还开着，两个 rl 会抢同一个 stdin（按键读两遍）。
 *   所以这里必须先 `kb.suspend()` 把 stdin 还回去，再 start。
 *
 * 用 suspend 而不是 close 的原因：启动**失败**时（Java 路径错、jar 缺失、
 * 端口被占……）服务端根本没接管 stdin。close 是不可逆的，键盘再也回不来，
 * 用户会看到一个「画面正常但按什么都没反应」的死界面；suspend 能 resume，
 * 失败了就退回 TUI 继续操作。
 *
 * 停止服务器则不同：stop 不接管 stdin，原地 await 即可，不值得为此退出 TUI。
 *
 * @param {object} options
 * @param {object|null} kb  TUI 键盘（兼容模式下为 null）
 * @param {object|null} status 状态栏
 * @param {object|null} rl  兼容模式的 readline（TUI 下为 null，必须传，
 *                          否则 ask(null) 会立即返回空串，提问被静默跳过）
 * @returns {Promise<{handled: boolean, message: string|null}>}
 *   handled = true  已把 stdin 交给服务端控制台（调用方须 return）
 *   message 非空    TUI 重绘后要显示在提示区的失败原因（重绘会清屏，
 *                   只 console.error 用户根本看不到）
 */
async function maybeJumpToServer(options, kb, status, rl = null) {
    const { serverManager } = options;
    if (!serverManager) {
        console.log('服务器管理模块未加载');
        return { handled: false, message: '服务器管理模块未加载' };
    }

    let running = false;
    try { running = serverManager.isRunning(); } catch (e) { running = false; }

    if (running) {
        // 已在运行：问是否停止。停止不接管 stdin，原地处理即可。
        const io = makeIo(kb);
        if (io) await io.enter();
        console.log('\n服务器已在运行中。');
        const choice = await ioAsk(io, rl, '是否停止服务器? (y/N): ');
        let stopped = false;
        if (String(choice).trim().toLowerCase() === 'y') {
            try {
                await serverManager.stop();
                stopped = true;
            } catch (e) {
                console.error(`❌ 停止失败: ${e.message}`);
            }
        }
        if (status) status.invalidate();
        // TUI：按回车回到界面；兼容模式：用调用方自己的 rl 提问，
        // 不能再开 askLine（那会和 compat 的 rl 抢同一个 stdin，回显两遍）
        if (io) {
            await tui.askLine('\n按回车键返回...');
            io.leave();
        } else if (rl) {
            await ask(rl, '\n按回车键返回...');
        } else if (stopped) {
            await tui.askLine('\n按回车键返回...');
        }
        return { handled: false, message: null };
    }

    // 未运行：先问内存（回车 = 用 JVM 模板），然后交出 stdin 给服务端控制台
    const io = makeIo(kb);
    if (io) await io.enter();
    const input = await ioAsk(io, rl, '内存分配 (回车 = 使用 JVM 模板中的堆设置): ');
    const memory = String(input).trim() || null;

    logger.impt(`菜单操作: 启动服务器${memory ? `（内存 ${memory}）` : ''}`);

    if (kb) {
        // 关键：把 TUI 的 readline 和 raw 模式都交出去，让 server.js 独占 stdin
        await kb.suspend();
    }
    if (status) status.invalidate();

    /**
     * 启动没成：先停一屏让用户读完原因，再把键盘还给 TUI。
     *
     * 两个来源都走这里：
     *   - `start()` 抛错；
     *   - `start()` 返回 false（方案未就绪 / 核心缺失 / 内存红线 —— 它自己
     *     打印完原因就 return 了，**没有接管 stdin**）。
     * 此时 TUI 的键盘还是挂起状态、stdin 空着，正好用 askLine 停一屏。
     * 若直接重绘，刚打印的失败原因会被清屏擦掉，用户只看到一句「启动失败」。
     */
    const noteAndResume = async (message) => {
        if (kb) {
            if (io) {
                await ioAsk(io, rl, '\n按回车键返回...');
                io.leave();
            } else {
                await tui.askLine('\n按回车键返回...');
                kb.resume();
            }
        } else if (rl) {
            await ask(rl, '\n按回车键返回...');
        }
        if (status) status.invalidate();
        return { handled: false, message };
    };

    let started = false;
    try {
        started = await serverManager.start(memory);
    } catch (e) {
        console.error(`❌ 启动失败: ${e.message}`);
        logger.erro(`启动服务器失败: ${e.message}`);
        return noteAndResume(`❌ 启动失败: ${e.message}`);
    }

    if (started === false) {
        // start() 提前返回：服务端没接管 stdin，TUI 不能按「跑完退出」处理，
        // 否则键盘再也不会回到 TUI（终端停在行模式，按什么键都只是回显）。
        logger.erro('启动服务器失败：start() 提前返回（方案 / 核心 / 内存检查未通过）');
        return noteAndResume('❌ 启动失败（原因见上一屏）');
    }

    // start() 在交互模式下会阻塞到服务端退出；走到这里说明服务端已经停了。
    console.log('');
    console.log('⏹ 服务器已停止。');
    return { handled: true, message: null };
}

// ==================== 功能分发 ====================

/**
 * 分发一个功能编号。
 *
 * 编号有两套：
 *   - **本页序号**（1 2 3 …）：`wow m` 界面上显示、用户实际敲的那套。
 *     同一页里序号唯一，所以「敲 3」到底是「变更配置」还是「列出方案」
 *     取决于当前页——调用方用 `opts.page` 传进来。
 *   - **旧编号**（原扁平菜单 1~14，以及 3.7.x 的 21/22/31/141 等扩展编号）：
 *     仍然认，但只在本页找不到时才生效，界面上以灰字 `旧 22` 标注。
 *
 * 为什么要区分：七页拆分后旧编号散落在各页，用户在 W 页敲 `1` 期望的是
 * 「方案管理」（本页第 1 项），而在 Q 页敲 `1` 期望的是「启动服务器」。
 * 只按旧编号分发的话，这两者无法同时成立。
 *
 * @param {object} opts
 *   - `page` 当前页键（Q/W/E/R/T/Y），用于解析本页序号
 * @returns {Promise<boolean>} true = 调用方必须交出 stdin（服务端接管 / 进日志跟踪）
 */
async function dispatchMenuItem(id, options, rl, ctx, io, opts = {}) {
    const key = String(id);
    const page = opts.page || null;
    // 提问统一走 io（有 TUI 时是「挂起键盘再问」的安全通道）
    const ask2 = (prompt) => ioAsk(io, rl, prompt);

    // 本页序号先解析成「稳定的功能键」（旧编号），再走原来的 case。
    // 这样新增页 / 调整页内顺序时，下面的业务代码一行都不用动。
    const item = page ? itemOfPage(page, key) : null;
    const isPageNumber = !!(item && String(item.id) === key);
    const functional = isPageNumber
        ? String((Array.isArray(item.legacy) ? item.legacy : [])[0] || item.id)
        : key;

    switch (functional) {
        // ── 方案页的快捷入口（不新写业务，转调已有管理器方法）──
        case '21': {   // 快速切换方案
            printHeader('快速切换方案');
            if (!options.schemeManager) { console.log('方案管理模块未加载'); return false; }
            options.schemeManager.list();
            const name = (await ask2( '要切换到的方案名: ')).trim();
            if (!name) { console.log('未输入，已取消。'); return false; }
            try {
                await options.schemeManager.switch(name);
                if (ctx && ctx.status) ctx.status.invalidate();
            } catch (e) {
                console.log(`❌ 切换失败: ${e.message}`);
            }
            return false;
        }
        case '22': {   // 列出全部方案
            printHeader('全部方案');
            if (!options.schemeManager) { console.log('方案管理模块未加载'); return false; }
            options.schemeManager.list();
            return false;
        }
        case '23': {   // 方案信息
            printHeader('方案信息');
            if (!options.schemeManager) { console.log('方案管理模块未加载'); return false; }
            options.schemeManager.list();
            const name = (await ask2( '方案名 (回车 = 当前方案): ')).trim();
            try {
                options.schemeManager.status(name || undefined);
            } catch (e) {
                console.log(`❌ 获取失败: ${e.message}`);
            }
            return false;
        }
        case '24': return dispatchMenu('2', options, rl, { sub: '1' }, io);   // 新建方案
        case '25': return dispatchMenu('2', options, rl, { sub: '4' }, io);   // 删除方案
        case '26': {   // 整理资源池
            printHeader('整理资源池（瘦身）');
            if (!options.schemeManager) { console.log('方案管理模块未加载'); return false; }
            const name = (await ask2( '方案名 (回车 = 当前方案): ')).trim();
            const confirm = (await ask2( `将删除未引用的资源，确定继续? (y/N): `)).trim().toLowerCase();
            if (confirm !== 'y') { console.log('已取消。'); return false; }
            try {
                await options.schemeManager.prune(name || undefined);
                console.log('✅ 瘦身完成');
            } catch (e) {
                console.log(`❌ 瘦身失败: ${e.message}`);
            }
            return false;
        }

        // ── 内容页的模组快捷入口 ──
        case '31': return dispatchMenu('3', options, rl, { sub: '1' }, io);
        case '32': return dispatchMenu('3', options, rl, { sub: '4' }, io);
        case '33': return dispatchMenu('3', options, rl, { sub: '6' }, io);
        case '34': return dispatchMenu('3', options, rl, { sub: '7' }, io);

        // ── 网络页的联机快捷入口 ──
        case '141': return dispatchMenu('14', options, rl, { sub: '1' }, io);
        case '142': return dispatchMenu('14', options, rl, { sub: '2' }, io);
        case '143': return dispatchMenu('14', options, rl, { sub: '3' }, io);
        case '121': return dispatchMenu('5', options, rl, { sub: '2' }, io);
        case '122': return lanNetInfo(io, rl);
        case '123': return dispatchMenu('5', options, rl, { sub: '1' }, io);

        // ── 工具页的日志快捷入口 ──
        case '111': return dispatchMenu('11', options, rl, { sub: '1' }, io);
        case '112': return dispatchMenu('11', options, rl, { sub: '2' }, io);
        case '113': return cleanLogs(io, rl);

        // ── 高级页的系统设置快捷入口 ──
        case '81': return dispatchMenu('8', options, rl, { sub: '1' }, io);
        case '82': return dispatchMenu('8', options, rl, { sub: '2' }, io);
        case '83': return dispatchMenu('8', options, rl, { sub: '3' }, io);
        case '84': return dispatchMenu('8', options, rl, { sub: '4' }, io);

        // 实时日志跟踪：只从「工具页第 4 项」这一处进入。
        // 旧编号 `4` 在别的页表示「模组搜索下载」，若在这里截住会误伤——
        // 所以要求要么是工具页的本页序号，要么显式写了旧编号 4 且当前不在内容页。
        case '4':
            if (page === 'T' ? isPageNumber : page !== 'E') return tailLogs(options);
            break;

        default:
            break;
    }

    // 落到原主菜单的 1~14
    return dispatchMenu(functional, options, rl, null, io);
}

/**
 * R 页 122：本机网络信息（纯读，不联网）。
 */
async function lanNetInfo(io, rl) {
    printHeader('本机网络信息');
    const os = require('os');
    const nets = os.networkInterfaces();
    console.log('\n  网卡地址（非回环）：');
    let found = false;
    for (const [name, addrs] of Object.entries(nets)) {
        for (const a of addrs || []) {
            if (a.internal) continue;
            if (a.family !== 'IPv4' && a.family !== 4) continue;
            found = true;
            console.log(`   ${name.padEnd(14)} ${a.address}`);
        }
    }
    if (!found) console.log('   （未找到可用的 IPv4 地址）');

    // 服务器端口：优先读当前方案的 server.properties
    try {
        const ServerProperties = require('./config').ServerProperties;
        const utils = require('./utils');
        const props = new ServerProperties(utils.getServerDir());
        const port = props.get('server-port');
        const online = props.get('online-mode');
        const players = props.get('max-players');
        console.log('\n  服务器端口:   ' + (port == null ? '(未设置，默认 25565)' : port));
        console.log('  正版验证:     ' + (online == null ? '(默认 true)' : online));
        console.log('  最大玩家数:   ' + (players == null ? '(默认 20)' : players));
    } catch (e) {
        console.log(`\n  （读取 server.properties 失败: ${e.message}）`);
    }

    // 陶瓦房间号（如果开着）
    try {
        const Terracotta = require('./terracotta');
        const s = await Terracotta.getStatus();
        if (s && s.running) {
            console.log(`\n  陶瓦联机:     🟢 运行中，房间号 ${s.roomCode || '(生成中)'}`);
            console.log(`  本地 API:     127.0.0.1:${s.port}`);
        } else {
            console.log('\n  陶瓦联机:     ⚫ 未开房（R 页 1 开房）');
        }
    } catch (e) { /* 忽略 */ }

    console.log('');
    // 这里**不再**自己问「按回车返回」：TUI 的 runItem 会统一收尾，
    // 兼容模式则是主循环直接重绘。两边都不需要、也不该在这里多占一次输入。
    return false;
}

/**
 * T 页 / Q 页的「实时日志跟踪」。
 *
 * 旧实现直接调 `logHandler.tail()`，那是个「spawn 完就返回」的函数，而且它的
 * SIGINT 处理器会 `process.exit(0)`。放进 TUI 后有两个硬伤：
 *   1. spawn 立刻返回 → 本函数也立刻返回 → TUI 马上清屏重绘，
 *      把 tail 刚打出来的日志擦掉；而 `tail -f` 还在后台往同一个屏幕写；
 *   2. 在开服控制台的 `:wow` 菜单里按 Ctrl+C 退出跟踪，会把**整个进程**
 *      连同正在运行的服务器一起 exit 掉。
 *
 * 所以这里自己管进程：等用户 Ctrl+C（或 tail 自己退出）才返回，
 * 只 kill 子进程，不退出 wow。Windows 没有 tail，退回 fs.watch 增量读取。
 */
async function tailLogs(options) {
    printHeader('实时日志跟踪');
    const { logHandler } = options;
    if (!logHandler) { console.log('日志处理模块未加载'); return false; }

    const fs = require('fs');
    const file = logHandler.logFile;
    if (!file || !fs.existsSync(file)) {
        console.log(`日志文件不存在: ${file || '(未配置)'}`);
        console.log('   先启动一次服务器，或确认当前方案下存在 logs/latest.log');
        return false;
    }

    console.log(`   正在跟踪 ${file}`);
    console.log('   按 Ctrl+C 退出跟踪并回到菜单。\n');

    await new Promise(resolve => {
        let done = false;
        let child = null;
        let watcher = null;
        let readPos = 0;

        /** 收尾：卸监听、杀掉 tail、关 watcher、补换行、resolve */
        const finish = () => {
            if (done) return;
            done = true;
            process.removeListener('SIGINT', onSigint);
            try { if (child) child.kill(); } catch (e) { /* 已退出 */ }
            try { if (watcher) watcher.close(); } catch (e) { /* 忽略 */ }
            // 终端在 raw 模式下不会给 ^C 补换行，这里补一个，收尾语才不粘在日志末尾
            process.stdout.write('\n');
            console.log('⏹ 已退出日志跟踪。');
            resolve();
        };

        const onSigint = () => {
            // 有子进程时等它真的退出再收尾（否则 tail 还会往屏幕上补几行）
            if (child) {
                try { child.kill(); } catch (e) { /* 忽略 */ }
                return;
            }
            finish();
        };

        process.on('SIGINT', onSigint);

        if (process.platform === 'win32') {
            // Windows 没有 tail：先打印尾部 20 行，再用 fs.watch 追加
            try {
                const buf = fs.readFileSync(file, 'utf8').split('\n');
                buf.slice(Math.max(0, buf.length - 21), -1).forEach(l => console.log(l));
                readPos = fs.statSync(file).size;
                watcher = fs.watch(file, () => {
                    try {
                        const st = fs.statSync(file);
                        if (st.size < readPos) readPos = 0;   // 日志轮转
                        if (st.size === readPos) return;
                        const len = st.size - readPos;
                        const chunk = Buffer.alloc(len);
                        const fd = fs.openSync(file, 'r');
                        fs.readSync(fd, chunk, 0, len, readPos);
                        fs.closeSync(fd);
                        readPos = st.size;
                        process.stdout.write(chunk.toString('utf8'));
                    } catch (e) { /* 忽略单次读失败 */ }
                });
                watcher.on('error', finish);
            } catch (e) {
                console.log(`❌ 跟踪失败: ${e.message}`);
                finish();
            }
        } else {
            const { spawn } = require('child_process');
            child = spawn('tail', ['-n', '20', '-f', file], { stdio: 'inherit' });
            // 子进程退出（Ctrl+C kill 掉了 / 文件被删 / 平台没有 tail）都算结束
            child.on('error', (e) => {
                console.log(`❌ 跟踪失败: ${e.message}`);
                child = null;
                finish();
            });
            child.on('exit', () => { child = null; finish(); });
        }
    });

    return false;
}

/**
 * T 页 113：清理旧日志。
 */
async function cleanLogs(io, rl) {
    printHeader('清理旧日志');
    const fs = require('fs');
    let utils;
    try { utils = require('./utils'); } catch (e) { utils = null; }
    if (!utils) { console.log('工具模块未加载'); return false; }

    const logDir = path.join(utils.getServerDir(), 'logs');
    if (!fs.existsSync(logDir)) {
        console.log(`日志目录不存在: ${logDir}`);
        return false;
    }

    const keep = parseInt((await ioAsk(io, rl, '保留最近几天的日志? (默认 7): ')).trim(), 10) || 7;
    const cutoff = Date.now() - keep * 24 * 3600 * 1000;

    let files = [];
    try { files = fs.readdirSync(logDir); } catch (e) { files = []; }

    const victims = [];
    let totalBytes = 0;
    for (const f of files) {
        if (!/\.(log|log\.gz|txt|gz)$/i.test(f)) continue;
        const full = path.join(logDir, f);
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (!st.isFile()) continue;
        if (st.mtimeMs >= cutoff) continue;
        victims.push(full);
        totalBytes += st.size;
    }

    if (!victims.length) {
        console.log(`没有超过 ${keep} 天的日志需要清理。`);
        return false;
    }

    console.log(`\n将删除 ${victims.length} 个文件，共 ${(totalBytes / 1024).toFixed(1)} KB：`);
    victims.slice(0, 10).forEach(f => console.log(`   ${path.basename(f)}`));
    if (victims.length > 10) console.log(`   … 还有 ${victims.length - 10} 个`);

    const confirm = (await ioAsk(io, rl, '\n确定删除? (y/N): ')).trim().toLowerCase();
    if (confirm !== 'y') { console.log('已取消。'); return false; }

    let deleted = 0;
    for (const f of victims) {
        try { fs.unlinkSync(f); deleted++; } catch (e) { /* 单个失败不影响整体 */ }
    }
    console.log(`✅ 已删除 ${deleted} 个文件`);
    logger.impt(`清理旧日志：删除 ${deleted} 个文件（保留 ${keep} 天）`);
    return false;
}

/**
 * 分发菜单选择（原始 14 个 case 的主体，V3.6.3 起编号含义不变）。
 *
 * @param {string} choice 编号 1~14
 * @param {object} options
 * @param {object} rl 调用方的 readline（复用，不自建）
 * @param {object} [preset] 预设子菜单选择，如 { sub: '1' } 直接进「新建方案」
 * @returns {Promise<boolean>} true = 调用方必须 close rl（目前只有启动服务器）
 */
async function dispatchMenu(choice, options, rl, preset = null, io = null) {
    // 三种调用姿势，必须分清「谁负责关 rl」：
    //   1) TUI（io 非空、rl 为 null）：二级菜单期间 TUI 的 readline 已 suspend，
    //      这里不能自建——新建一个会让 stdin 出现两个消费者（输入回显两遍）。
    //      子管理器里那几个「借 rl 提问」的参数改为传 null（它们会自建临时 rl，
    //      此时 stdin 是干净的，自建是安全的）；
    //   2) 兼容模式 / 外部直接调：调用方的 rl 复用，ownRl=false；
    //   3) 完全裸调（无 rl 无 io）：自建并负责关闭。
    const borrowed = Boolean(io) && !rl;
    const ownRl = !rl && !borrowed;
    if (!rl && !borrowed) rl = createRL();
    // 交给子管理器 / quickSet 用的「可借用 rl」：TUI 模式下没有可用实例
    const shareRl = borrowed ? undefined : rl;
    const {
        serverManager,
        installer,
        modManager,
        schemeManager,
        themeManager,
        packGenerator,
        logHandler,
        config,
        utils,
        mailer
    } = options;

    /**
     * 子菜单读取：有 preset 就直接用它，否则问用户。
     * preset 让「W 页 新建方案」这类快捷入口能复用同一段业务代码。
     */
    const subOf = async (promptText) => {
        if (preset && preset.sub != null) return String(preset.sub);
        return (await ioAsk(io, rl, promptText)).trim();
    };

    try {
        switch (choice) {
            case '1': {
                // 启动服务器
                printHeader('启动服务器');
                if (!serverManager) {
                    console.log('服务器管理模块未加载');
                    break;
                }
                if (serverManager.isRunning()) {
                    console.log('服务器已在运行中');
                    const subChoice = await ioAsk(io, rl, '是否停止服务器? (y/N): ');
                    if (subChoice.toLowerCase() === 'y') {
                        await serverManager.stop();
                    }
                } else {
                    // V3.6.2（607 指令）：回车 = 不显式指定，堆大小由 JVM 模板 / 覆盖参数决定
                    // （override_args 里的 -Xmx 优先生效，80% 物理内存红线负责拦截）
                    const memory = await ioAsk(io, rl, '内存分配 (回车 = 使用 JVM 模板中的堆设置): ') || null;
                    // 启动期间让出 readline，使服务器能直接读取终端输入（指令 / Ctrl+C）
                    rl.pause();
                    await serverManager.start(memory);
                    rl.resume();
                }
                break;
            }

            case '2': {
                // 方案管理（V3.5.x：原主菜单「新建方案」与「方案管理」合并为单一入口）
                // 子菜单：1. 新建方案  2. 切换方案  3. 列出方案  4. 删除方案  5. 方案信息
                printHeader('方案管理');
                if (!schemeManager) {
                    console.log('方案管理模块未加载');
                    break;
                }
                console.log('\n  1. 新建方案');
                console.log('  2. 切换方案');
                console.log('  3. 列出方案');
                console.log('  4. 删除方案');
                console.log('  5. 方案信息');
                console.log('  0. 返回');
                const sub = await subOf('\n请选择 (0-5): ');
                switch (sub) {
                    case '1': {
                        // 新建方案
                        printHeader('新建方案');
                        // 1) 方案名
                        const sName = (await ioAsk(io, rl, '方案名称: ')).trim();
                        if (!sName) {
                            console.log('未输入方案名，已取消。');
                            break;
                        }

                        // 名称校验：复用 file_manager 的跨平台校验段（拒绝路径分隔符、
                        // Windows 保留字符/保留设备名、以点或空格结尾等）
                        let fm;
                        try {
                            fm = require('./file_manager');
                        } catch (e) { fm = null; }
                        if (fm && typeof fm.validateNameSegment === 'function') {
                            const check = fm.validateNameSegment(sName);
                            if (!check.ok) {
                                console.log(`❌ 方案名不合法: ${check.reason}`);
                                break;
                            }
                        }

                        // 目录已存在则直接拒绝（避免 create 抛错后留下残缺目录）
                        if (typeof schemeManager._schemeExists === 'function'
                            && schemeManager._schemeExists(sName)) {
                            console.log(`❌ 方案「${sName}」已存在。可用菜单 2 → 3 查看全部方案。`);
                            break;
                        }

                        // 2) 核心类型（V3.5.11：补充 neoforge——安装器层早已支持，此处补齐入口）
                        const sTypes = ['vanilla', 'forge', 'fabric', 'neoforge', 'paper', 'purpur', 'spigot', 'bukkit', 'mohist', 'leaves'];
                        console.log('\n支持的服务器类型:');
                        sTypes.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
                        const stChoice = (await ioAsk(io, rl, '\n选择类型 (默认 1 vanilla): ')).trim();
                        let type = 'vanilla';
                        if (stChoice) {
                            const stIdx = parseInt(stChoice, 10) - 1;
                            if (!(stIdx >= 0 && stIdx < sTypes.length)) {
                                console.log('类型选择无效，已取消。');
                                break;
                            }
                            type = sTypes[stIdx];
                        }

                        // 3) 版本 / 构建号
                        // V3.5.11：不再单独询问模组加载器——加载器随核心类型自动确定
                        // （选 fabric 即 fabric 核心 + fabric 加载器，与 CLI -t 行为一致）
                        const sVersion = (await ioAsk(io, rl, 'Minecraft 版本 (默认 1.20.1): ')).trim() || '1.20.1';
                        const sBuild = (await ioAsk(io, rl, '构建号 (留空自动选择最新): ')).trim() || null;

                        // 4) 创建（务必用对象签名——旧实现曾用三个位置参数调用，
                        //    导致用户输入的版本/加载器被静默忽略，这里已修正）
                        console.log('');
                        try {
                            await schemeManager.create(sName, {
                                type,
                                version: sVersion,
                                loader: type,
                                build: sBuild
                            });
                            console.log(`\n✅ 方案「${sName}」创建完成。`);
                            const sDir = (schemeManager.schemesDir)
                                ? require('path').join(schemeManager.schemesDir, sName)
                                : `scheme/${sName}`;
                            console.log(`   目录: ${sDir}`);
                            console.log('   可在菜单 2 → 2 切换到此方案后启动服务器。');
                        } catch (e) {
                            console.log(`\n❌ 创建失败: ${e.message}`);
                        }
                        break;
                    }
                    case '2': {
                        // 切换方案
                        schemeManager.list();
                        const name = await ioAsk(io, rl, '要切换到的方案名: ');
                        if (name) {
                            await schemeManager.switch(name);
                        }
                        break;
                    }
                    case '3':
                        // 列出方案
                        schemeManager.list();
                        break;
                    case '4': {
                        // 删除方案
                        schemeManager.list();
                        const name = await ioAsk(io, rl, '要删除的方案名: ');
                        if (name) {
                            const confirm = await ioAsk(io, rl, `确定删除方案 "${name}"? (y/N): `);
                            if (confirm.toLowerCase() === 'y') {
                                await schemeManager.delete(name);
                            }
                        }
                        break;
                    }
                    case '5': {
                        // 方案信息
                        schemeManager.list();
                        const name = await ioAsk(io, rl, '方案名: ');
                        if (name) {
                            schemeManager.info(name);
                        }
                        break;
                    }
                }
                break;
            }

            case '3': {
                // 管理模组/插件
                printHeader('管理模组/插件');
                if (!modManager) {
                    console.log('模组管理模块未加载');
                    break;
                }
                console.log('\n  1. 列出已安装模组');
                console.log('  2. 安装模组');
                console.log('  3. 卸载模组');
                console.log('  4. 启用/禁用模组');
                console.log('  5. 查看模组配置');
                console.log('  6. 编辑模组配置');
                console.log('  7. 备份模组配置');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-7): ');

                const serverDir = utils ? utils.getServerDir() : '../scheme';
                const configEditor = require('./config_editor');

                switch (subChoice) {
                    case '1': {
                        const mods = modManager.listMods();
                        console.log(`\n已安装模组 (${mods.length}):`);
                        for (const mod of mods) {
                            const status = mod.enabled ? '✅' : '❌';
                            const sizeKB = (mod.size / 1024).toFixed(1);
                            console.log(`  ${status} ${mod.name} (${sizeKB} KB) [${mod.loader}/${mod.version}]`);
                        }
                        break;
                    }
                    case '2': {
                        const target = await ioAsk(io, rl, '模组 URL 或本地路径: ');
                        if (target) {
                            await modManager.install(target);
                        }
                        break;
                    }
                    case '3': {
                        const mods = modManager.listMods();
                        mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.name}`));
                        const idx = parseInt(await ioAsk(io, rl, '选择要卸载的模组编号: ')) - 1;
                        if (idx >= 0 && idx < mods.length) {
                            modManager.remove(mods[idx].name);
                        }
                        break;
                    }
                    case '4': {
                        const mods = modManager.listMods();
                        mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.status || (m.enabled ? '✅' : '❌')} ${m.name}`));
                        const idx = parseInt(await ioAsk(io, rl, '选择要切换的模组编号: ')) - 1;
                        if (idx >= 0 && idx < mods.length) {
                            modManager.toggleMod(mods[idx].name);
                        }
                        break;
                    }
                    case '5': {
                        const files = configEditor.getConfigFiles(serverDir);
                        if (files.length === 0) {
                            console.log('config 目录下没有配置文件');
                        } else {
                            console.log(`\n配置文件 (${files.length}):`);
                            files.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext}, ${utils ? utils.formatFileSize(f.size) : f.size} B)`));
                            const idx = parseInt(await ioAsk(io, rl, '\n选择要查看的文件编号: ')) - 1;
                            if (idx >= 0 && idx < files.length) {
                                const result = configEditor.readConfig(files[idx].fullPath);
                                if (result.success) {
                                    console.log(`\n${'═'.repeat(60)}`);
                                    console.log(`文件: ${files[idx].relPath}`);
                                    if (result.warning) console.log(`⚠ ${result.warning}`);
                                    console.log('═'.repeat(60));
                                    if (typeof result.data === 'object') {
                                        console.log(JSON.stringify(result.data, null, 2));
                                    } else {
                                        console.log(result.data);
                                    }
                                } else {
                                    console.log(`读取失败: ${result.error}`);
                                }
                            }
                        }
                        break;
                    }
                    case '6': {
                        const files = configEditor.getConfigFiles(serverDir);
                        if (files.length === 0) {
                            console.log('config 目录下没有配置文件');
                        } else {
                            console.log(`\n可编辑的配置文件 (JSON/TOML/YAML):`);
                            const editable = files.filter(f => ['.json', '.toml', '.yml', '.yaml', '.properties', '.cfg', '.conf', '.ini'].includes(f.ext));
                            editable.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext})`));
                            if (editable.length === 0) {
                                console.log('  没有可编辑的结构化配置文件');
                                break;
                            }
                            const idx = parseInt(await ioAsk(io, rl, '\n选择要编辑的文件编号: ')) - 1;
                            if (idx >= 0 && idx < editable.length) {
                                const file = editable[idx];
                                // 先显示当前键值
                                const listResult = configEditor.listConfig(file.fullPath);
                                if (listResult.success) {
                                    console.log(`\n当前键值 (${file.relPath}):`);
                                    listResult.entries.forEach(e => console.log(`  ${e.key} = ${JSON.stringify(e.value)}`));
                                }
                                const key = await ioAsk(io, rl, '\n输入要修改的键 (点号分隔, 如 general.enable): ');
                                const value = await ioAsk(io, rl, '输入新值: ');
                                if (key && value !== undefined) {
                                    const setResult = configEditor.setConfigValue(file.fullPath, key, value);
                                    if (setResult.success) {
                                        console.log(`✅ 已设置 ${key} = ${value}`);
                                        if (setResult.backupPath) console.log(`   备份已保存: ${setResult.backupPath}`);
                                    } else {
                                        console.log(`❌ 设置失败: ${setResult.error}`);
                                    }
                                }
                            }
                        }
                        break;
                    }
                    case '7': {
                        const backupResult = configEditor.backupConfigs(serverDir);
                        if (backupResult.success) {
                            console.log(`✅ 已备份 ${backupResult.count} 个配置文件`);
                            console.log(`   备份目录: ${backupResult.backupDir}`);
                        } else {
                            console.log(`❌ 备份失败: ${backupResult.error}`);
                        }
                        break;
                    }
                }
                break;
            }

            case '5': {
                // 修改服务器配置 (server.properties)
                printHeader('修改服务器配置 (server.properties)');
                const ServerProperties = require('./config').ServerProperties;
                const serverDir = utils ? utils.getServerDir() : '../scheme';
                const props = new ServerProperties(serverDir);

                console.log('\n  1. 查看所有属性');
                console.log('  2. 设置/修改单个属性');
                console.log('  3. 快速设置向导');
                console.log('  4. 重置属性为默认值');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-4): ');

                switch (subChoice) {
                    case '1':
                        props.listAll();
                        break;
                    case '2': {
                        const key = await ioAsk(io, rl, '属性名: ');
                        const current = props.get(key);
                        console.log(`当前值: ${current !== null ? current : '(未设置)'}`);
                        const value = await ioAsk(io, rl, '新值: ');
                        if (value) {
                            props.set(key, value);
                            console.log(`✅ ${key} = ${value}`);
                        }
                        break;
                    }
                    case '3':
                        await props.quickSet(undefined, shareRl);
                        break;
                    case '4': {
                        const key = await ioAsk(io, rl, '要重置的属性名: ');
                        const result = props.reset(key);
                        console.log(`✅ ${result.key} 已重置为 ${result.value}`);
                        break;
                    }
                }
                break;
            }

            case '11': {
                // 错误日志分析
                printHeader('错误日志分析');
                if (!logHandler) {
                    console.log('日志处理模块未加载');
                    break;
                }
                console.log('\n  1. AI 分析最近日志');
                console.log('  2. 生成统计报告');
                console.log('  3. 实时日志跟踪');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-3): ');
                switch (subChoice) {
                    case '1':
                        await logHandler.analyze();
                        break;
                    case '2':
                        await logHandler.report();
                        break;
                    case '3':
                        console.log('正在跟踪日志 (Ctrl+C 退出)...');
                        logHandler.tail();
                        break;
                }
                break;
            }

            case '6': {
                // 认证设置
                printHeader('认证设置 (外置登录)');
                if (!config) {
                    console.log('配置模块未加载');
                    break;
                }
                const authConfig = config.getConfig('auth', {});
                console.log(`\n  外置登录: ${authConfig.enable ? '✅ 已启用' : '❌ 未启用'}`);
                console.log(`  认证服务器: ${authConfig.server || '(未设置)'}`);
                console.log(`  javaagent: ${authConfig.javaagent || '(自动)'}`);
                const enable = await ioAsk(io, rl, '\n启用外置登录? (y/N): ');
                if (enable.toLowerCase() === 'y') {
                    config.setConfig('auth.enable', true);
                    const server = await ioAsk(io, rl, '认证服务器地址 (默认 https://authlib-injector.yushi.moe): ');
                    if (server) config.setConfig('auth.server', server);
                    console.log('✅ 外置登录已启用，下次启动服务器时生效');
                } else if (enable !== '') {
                    config.setConfig('auth.enable', false);
                    console.log('外置登录已禁用');
                }
                break;
            }

            case '7': {
                // 下载管理器设置
                printHeader('下载管理器设置');
                if (!config) {
                    console.log('配置模块未加载');
                    break;
                }
                const mirror = config.getConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
                const timeout = config.getConfig('download.timeout', 30);
                const retry = config.getConfig('download.retry', 3);
                console.log(`\n  镜像地址: ${mirror}`);
                console.log(`  超时时间: ${timeout}s`);
                console.log(`  重试次数: ${retry}`);
                console.log('\n  1. 修改镜像地址');
                console.log('  2. 修改超时时间');
                console.log('  3. 修改重试次数');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-3): ');
                switch (subChoice) {
                    case '1': {
                        console.log('\n  1. BMCLAPI2 (推荐) - https://bmclapi2.bangbang93.com');
                        console.log('  2. 官方源 - https://launcher.mojang.com');
                        console.log('  3. 自定义');
                        const m = await ioAsk(io, rl, '选择: ');
                        if (m === '1') config.setConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
                        else if (m === '2') config.setConfig('download.mirror', 'https://launcher.mojang.com');
                        else if (m === '3') {
                            const custom = await ioAsk(io, rl, '自定义地址: ');
                            if (custom) config.setConfig('download.mirror', custom);
                        }
                        console.log('✅ 镜像地址已更新');
                        break;
                    }
                    case '2': {
                        const t = await ioAsk(io, rl, '超时时间(秒): ');
                        if (t) config.setConfig('download.timeout', parseInt(t));
                        console.log('✅ 超时时间已更新');
                        break;
                    }
                    case '3': {
                        const r = await ioAsk(io, rl, '重试次数: ');
                        if (r) config.setConfig('download.retry', parseInt(r));
                        console.log('✅ 重试次数已更新');
                        break;
                    }
                }
                break;
            }

            case '9': {
                // 安装整合包
                printHeader('安装整合包');
                if (!packGenerator) {
                    console.log('整合包模块未加载');
                    break;
                }
                console.log('\n  1. 从本地文件安装 (.zip)');
                console.log('  2. 从 URL 下载安装');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-2): ');
                if (subChoice === '1') {
                    const filePath = await ioAsk(io, rl, '整合包文件路径: ');
                    if (filePath) {
                        await packGenerator.install(filePath, shareRl);
                    }
                } else if (subChoice === '2') {
                    const url = await ioAsk(io, rl, '整合包 URL: ');
                    if (url) {
                        await packGenerator.install(url, shareRl);
                    }
                }
                break;
            }

            case '10': {
                // 生成客户端整合包
                printHeader('生成客户端整合包');
                if (!packGenerator) {
                    console.log('整合包模块未加载');
                    break;
                }
                const name = await ioAsk(io, rl, '整合包名称: ') || 'client-pack';
                const version = await ioAsk(io, rl, 'Minecraft 版本 (默认 1.20.1): ') || '1.20.1';
                await packGenerator.generate({ name, version });
                break;
            }

            case '4': {
                // 模组/插件搜索下载
                printHeader('模组/插件搜索下载');
                if (!modManager) {
                    console.log('模组管理模块未加载');
                    break;
                }
                console.log('\n  1. 从 URL 下载模组');
                console.log('  2. 从本地安装模组');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-2): ');
                if (subChoice === '1') {
                    const url = await ioAsk(io, rl, '模组下载 URL: ');
                    if (url) {
                        await modManager.install(url);
                    }
                } else if (subChoice === '2') {
                    const filePath = await ioAsk(io, rl, '模组文件路径: ');
                    if (filePath) {
                        await modManager.install(filePath);
                    }
                }
                break;
            }

            case '8': {
                // 系统设置
                printHeader('系统设置');
                if (!config || !utils) {
                    console.log('配置模块未加载');
                    break;
                }
                console.log('\n  1. Java 设置（扫描/选择/自动安装）');
                console.log('  2. 修改 JVM 参数');
                console.log('  3. 查看系统信息');
                console.log('  4. 重置配置');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-4): ');
                switch (subChoice) {
                    case '1': {
                        // V3.5.7：由「手填 Java 路径」升级为「扫描本机全部 Java 并列出选择」
                        await javaSettingsFlow(rl, config, utils);
                        break;
                    }
                    case '2': {
                        // V3.6.2（607 指令）：新结构 server.jvm，参数经引号感知解析器，禁用 split
                        const Jvm = require('./jvm_args');
                        const curTemplate = config.getConfig('server.jvm.template', Jvm.DEFAULT_TEMPLATE);
                        const curOverride = config.getConfig('server.jvm.override_args', []);
                        console.log(`当前模板: ${curTemplate}（可选 ${Jvm.TEMPLATE_NAMES.join(' / ')}）`);
                        console.log(`当前覆盖参数: ${curOverride.join(' ')}`);
                        const newTemplate = (await ioAsk(io, rl, `新模板 (回车保持 ${curTemplate}): `)).trim();
                        const newArgs = await ioAsk(io, rl, '新覆盖参数 (空格分隔，路径含空格用引号包裹；回车保持不变): ');
                        if (newTemplate) {
                            if (!Jvm.TEMPLATE_NAMES.includes(newTemplate)) {
                                console.log(`⚠️ 未知模板「${newTemplate}」，可用：${Jvm.TEMPLATE_NAMES.join(' / ')}`);
                            } else {
                                config.setConfig('server.jvm.template', newTemplate);
                                console.log(`✅ 模板已切换为 ${newTemplate}`);
                            }
                        }
                        if (newArgs) {
                            config.setConfig('server.jvm.override_args', Jvm.parseArgs(newArgs));
                            console.log('✅ JVM 覆盖参数已更新');
                        }
                        break;
                    }
                    case '3': {
                        const os = require('os');
                        console.log(`\n  操作系统: ${os.type()} ${os.release()}`);
                        console.log(`  架构: ${os.arch()}`);
                        console.log(`  内存: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`);
                        console.log(`  CPU: ${os.cpus()[0]?.model || 'Unknown'}`);
                        console.log(`  Node.js: ${process.version}`);
                        break;
                    }
                    case '4': {
                        const confirm = await ioAsk(io, rl, '确定重置所有配置? (y/N): ');
                        if (confirm.toLowerCase() === 'y') {
                            config.saveConfig(config.DEFAULT_CONFIG);
                            console.log('✅ 配置已重置为默认值');
                        }
                        break;
                    }
                }
                break;
            }

            case '12': {
                // 服务器状态监控
                printHeader('服务器状态监控');
                if (!serverManager) {
                    console.log('服务器管理模块未加载');
                    break;
                }
                serverManager.status();
                if (serverManager.isRunning()) {
                    const tailChoice = await ioAsk(io, rl, '\n是否查看实时日志? (y/N): ');
                    if (tailChoice.toLowerCase() === 'y' && logHandler) {
                        logHandler.tail();
                    }
                }
                break;
            }

            case '13': {
                // Web 主题更改
                printHeader('Web 主题更改');
                if (!themeManager) {
                    console.log('主题管理模块未加载');
                    break;
                }
                console.log('\n  1. 列出已安装主题');
                console.log('  2. 安装主题');
                console.log('  3. 切换主题');
                console.log('  4. 删除主题');
                console.log('  0. 返回');
                const subChoice = await subOf('\n请选择 (0-4): ');
                switch (subChoice) {
                    case '1':
                        themeManager.list();
                        break;
                    case '2': {
                        const filePath = await ioAsk(io, rl, '主题 ZIP 文件路径: ');
                        if (filePath) {
                            await themeManager.install(filePath, shareRl);
                        }
                        break;
                    }
                    case '3': {
                        themeManager.list();
                        const name = await ioAsk(io, rl, '要切换的主题名: ');
                        if (name) {
                            await themeManager.switch(name, shareRl);
                        }
                        break;
                    }
                    case '4': {
                        themeManager.list();
                        const name = await ioAsk(io, rl, '要删除的主题名: ');
                        if (name) {
                            themeManager.delete(name);
                        }
                        break;
                    }
                }
                break;
            }

            case '14': {
                // 联机 / 我要当房主（陶瓦 Terracotta）
                printHeader('联机 / 我要当房主 (陶瓦)');
                const Terracotta = require('./terracotta');
                console.log('\n   powered by Terracotta | 陶瓦联机 (AGPLv3)');
                console.log('   基于 EasyTier 的内网穿透，好友无需公网 IP 即可加入你的 Minecraft 服务端。');
                console.log('   加入端由 PCL / HMCL / BakaXL / FCL 等启动器内置支持。\n');
                console.log('  1. 我要当房主（开房）');
                console.log('  2. 查看房间号 / 状态');
                console.log('  3. 关房（停止陶瓦）');
                console.log('  0. 返回');
                const sub = await subOf('\n请选择 (0-3): ');
                try {
                    if (sub === '1') {
                        console.log('提示：开房前请先启动 Minecraft 服务端（菜单 1），陶瓦会自动扫描本机服务端端口。');
                        await Terracotta.hostRoom({ promptPort: (msg) => ioAsk(io, rl, msg) });
                    } else if (sub === '2') {
                        const s = await Terracotta.getStatus();
                        if (!s.running) {
                            console.log('当前未开房（陶瓦未运行）。选择 1 开房。');
                        } else {
                            console.log(`运行状态:  🟢 运行中`);
                            console.log(`本地 API:  127.0.0.1:${s.port}`);
                            console.log(`房间号:    ${s.roomCode || '(生成中)'}`);
                            console.log(`状态机:    ${s.state || '未知'}`);
                            if (s.roomCode) {
                                console.log(`\n把房间号发给好友，对方在 PCL / HMCL / BakaXL / FCL 中选择「加入陶瓦房间」并输入该房间号即可联机。`);
                            }
                        }
                    } else if (sub === '3') {
                        await Terracotta.stopHost();
                    }
                } catch (e) {
                    console.error(`❌ 操作失败: ${e.message}`);
                }
                break;
            }

            default:
                console.log(`未知菜单选项: ${choice}`);
        }
    } catch (e) {
        console.error(`执行菜单操作时出错: ${e.message}`);
    } finally {
        if (ownRl) rl.close();
    }
    return false;
}

/**
 * Java 设置流程（V3.5.7 新增）
 * 1) 扫描本机所有 Java（PATH / 系统包 / IDE / 版本管理器）
 * 2) 列出并标注主版本与来源，供用户选择
 * 3) 支持「自动检测」与「手动输入路径」
 * 4) 支持按 MC 版本自动安装缺失的 Java（Temurin）
 */
async function javaSettingsFlow(rl, config, utils) {
    let JreManager;
    try {
        JreManager = require('./jre_manager');
    } catch (e) {
        console.log(`Java 管理模块加载失败: ${e.message}`);
        return;
    }
    const jre = new JreManager();

    for (;;) {
        const current = config.getConfig('server.java', null);
        console.log('\n' + '─'.repeat(52));
        console.log(`当前配置: ${current ? current : '(自动检测)'}`);

        let list = [];
        try { list = utils.scanAllJava(); } catch (e) { list = []; }

        if (list.length === 0) {
            console.log('\n本机未扫描到任何可用的 Java。');
        } else {
            console.log(`\n本机扫描到 ${list.length} 个 Java：`);
            list.forEach((j, i) => {
                const ver = j.major != null ? `Java ${j.major}` : '版本未知';
                console.log(`  ${String(i + 1).padStart(2)}. ${ver.padEnd(9)} [${j.source}]  ${j.path}`);
            });
        }

        const bundled = jre.listBundled ? jre.listBundled() : [];
        if (bundled.length) {
            console.log(`\n内置 JRE（core/jre）: Java ${bundled.join(', Java ')}`);
        }

        console.log('\n  a. 自动检测（清除手动配置）');
        console.log('  m. 手动输入 Java 路径');
        console.log('  i. 自动安装缺失的 Java（按 MC 版本）');
        console.log('  0. 返回');
        console.log('─'.repeat(52));

        const c = (await ask(rl, '\n请选择: ')).trim().toLowerCase();

        if (c === '0' || c === '') break;

        if (c === 'a') {
            config.setConfig('server.java', null);
            console.log('✅ 已切换为自动检测模式。');
            continue;
        }

        if (c === 'm') {
            const p = (await ask(rl, 'Java 可执行文件完整路径: ')).trim();
            if (!p) { console.log('未输入，已取消。'); continue; }
            const fs = require('fs');
            if (!fs.existsSync(p)) {
                console.log(`❌ 路径不存在: ${p}`);
                continue;
            }
            // 探测该路径的真实版本，避免用户误填
            const hit = (utils.scanAllJava() || [])
                .find(j => require('path').normalize(j.path) === require('path').normalize(p));
            if (hit && hit.major != null) {
                console.log(`   该 Java 主版本: ${hit.major}`);
            } else {
                console.log('⚠️  无法确认该路径可执行（不在扫描结果中），仍将写入配置。');
            }
            config.setConfig('server.java', p);
            console.log('✅ Java 路径已更新。');
            continue;
        }

        if (c === 'i') {
            const mc = (await ask(rl, '目标 Minecraft 版本 (如 1.20.1): ')).trim();
            if (!mc) { console.log('未输入，已取消。'); continue; }
            const need = jre.getRequiredJavaVersion(mc);
            console.log(`\nMinecraft ${mc} 需要 Java ${need}。`);
            try {
                const p = await jre.resolveJavaFor(mc, true);
                console.log(`\n✅ 可用 Java: ${p}`);
                const setIt = await ask(rl, '是否写入配置 server.java? (y/N): ');
                if (setIt.toLowerCase() === 'y') {
                    config.setConfig('server.java', p);
                    console.log('✅ 已写入配置。');
                }
            } catch (e) {
                console.log(`\n❌ 处理失败: ${e.message}`);
            }
            continue;
        }

        // 数字：选择列出的某个 Java
        const idx = parseInt(c, 10);
        if (!isNaN(idx) && idx >= 1 && idx <= list.length) {
            const picked = list[idx - 1];
            config.setConfig('server.java', picked.path);
            console.log(`✅ 已选择 ${picked.major != null ? 'Java ' + picked.major : '该 Java'}: ${picked.path}`);
            continue;
        }

        console.log('无效选择。');
    }
}

module.exports = {
    // 主入口
    showMainMenu,
    dispatchMenu,
    // 页面表（测试与外部工具可读）
    PAGES,
    PAGE_MAP,
    findPageOfItem,
    itemOfPage,
    idsOf,
    resolveNumber,
    // 兼容旧接口
    createRL,
    ask,
    clearScreen,
    printHeader,
    javaSettingsFlow
};
