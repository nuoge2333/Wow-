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
 * 结构（V3.6.3 / 609 指令重构；V3.7.4 扁平化）：
 *   ┌ 状态栏     版本 / 服务器状态 / 当前方案 / 已装与当前 Java
 *   ├ 分隔线
 *   ├ 功能区     六页之一的功能列表，**一层直达**：编号就是最终动作
 *   └ 导航栏     [Q]服务器 [W]方案 [E]内容 [R]网络 [T]工具 [Y]高级 [L]长命令 [0]退出
 *
 * V3.7.4 扁平化：原「方案管理 / 系统设置 / 错误日志分析 / 联机(陶瓦) / 管理模组 /
 * server.properties / 下载管理器 / 安装整合包 / 模组搜索下载 / Web 主题」十个聚合项
 * 进去后会再弹一张 `请选择 (0-N)` 的二级菜单。现在全部拆成页内独立项，
 * 菜单只剩一层：**看到编号 = 最终动作**，不再有「进去还要再选一次」。
 * 编号一律是页内顺号 1..N，旧编号（原扁平菜单的 1~14 / 21~26 / 141 等）兼容已移除。
 *
 * 按键（TUI 模式）：
 *   - Q/W/E/R/T/Y 切页并重绘（字母键按下即生效）
 *   - 数字         **回车**执行当前页对应功能
 *   - Backspace    删掉输错的最后一位编号
 *   - L            进入长命令模式
 *   - 0 + 回车     退出（二次确认）
 *   - 回车         编号为空时重绘当前页（刷新状态）
 *   - Ctrl+C       退出（二次确认）
 *
 * 数字为什么必须回车：编号最多两位（E 页 13 项），单键触发要么猜、
 * 要么加等待窗口——两者都会让「手快」变成错误。与原来的数字菜单保持一致，
 * 输入完整编号再回车，简单且没有时序问题。
 *
 * 无 TTY（管道 / CI / Docker）时自动降级为「输入一行 + 回车」的兼容模式，
 * 六页与功能完全一致。
 *
 * 单 readline 原则：
 *   整个 M 模式只有 tui.createKeyboard() 创建的那一个 readline。动作执行期间
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
// 只有声明，没有逻辑。id 就是本页顺号（1..N），也是 dispatchMenuItem 的分发依据。
//
// V3.7.4 扁平化：菜单只有一层。原先「方案管理 / 系统设置 / 错误日志分析 /
// 联机(陶瓦) / 管理模组 / server.properties / 下载管理器 / 安装整合包 /
// 模组搜索下载 / Web 主题」这十个聚合项点进去还要再选一次（打印
// `请选择 (0-N)`），现已全部拆成页内独立项。看到编号 = 最终动作。
//
// `hint` 是右对齐的实时备注（函数形式，画页时求值一次），
// 拿不到数据就不显示——不会让整行消失，布局稳定。
//
// 旧编号（原扁平菜单 1~14、3.7.x 的 21/22/31/141 等）兼容已整体移除：
// 不再有 `legacy` 字段，输入不存在的号直接提示「没有编号 X」，不再跨页猜测。

/** 备注列宽上限（最长的一条按 8 个字算，保证一行塞进 70 列） */
const HINT_MAX = 8;

const PAGES = [
    {
        key: 'Q',
        label: '服务器',
        title: '服务器启停 / 运行状态',
        items: [
            {
                id: '1', label: '启动 / 停止服务器',
                hint: (ctx) => {
                    const s = ctx.status.collect();
                    return s.running ? '运行中' : '已停止';
                }
            },
            {
                id: '2', label: '服务器状态监控',
                hint: (ctx) => (ctx.status.collect().running ? '可看实时日志' : null)
            },
            { id: '3', label: '查看服务端属性（全部）', hint: () => 'server.properties' },
            { id: '4', label: '修改单个服务端属性', hint: () => '键值直改' },
            { id: '5', label: '服务端属性快速向导', hint: () => '端口/人数/难度' },
            { id: '6', label: '重置服务端属性为默认', hint: () => '单项回滚' },
            { id: '7', label: '错误日志分析（AI）', hint: () => '崩溃排查' },
            { id: '8', label: '查看控制台日志（实时跟踪）', hint: () => 'Ctrl+C 停' },
            {
                id: '9', label: '开房联机（陶瓦，同 R 页 1）',
                hint: () => '无需公网 IP'
            }
        ]
    },
    {
        key: 'W',
        label: '方案',
        title: '方案管理',
        items: [
            { id: '1', label: '新建方案', hint: () => '类型 + 版本' },
            { id: '2', label: '切换方案', hint: () => '输入名称即可' },
            { id: '3', label: '列出全部方案（含状态）', hint: () => 'mark 标记当前' },
            { id: '4', label: '删除方案', hint: () => '需二次确认' },
            { id: '5', label: '方案信息 / 资源引用', hint: () => '独占统计' },
            { id: '6', label: '安装整合包（本地 .zip）', hint: () => '从文件装' },
            { id: '7', label: '安装整合包（远程 URL）', hint: () => '从网址装' },
            { id: '8', label: '生成客户端整合包', hint: () => '导出给朋友' },
            { id: '9', label: '整理资源池（瘦身）', hint: () => '清未引用文件' }
        ]
    },
    {
        key: 'E',
        label: '内容',
        title: '内容与配置（模组 / 插件 [实验性·Beta] / 配置文件）',
        items: [
            {
                id: '1', label: '列出已安装模组',
                hint: (ctx) => {
                    try {
                        const n = ctx.options.modManager ? ctx.options.modManager.listMods().length : null;
                        return n == null ? null : `已装 ${n} 个`;
                    } catch (e) { return null; }
                }
            },
            { id: '2', label: '安装模组（URL 或本地路径）', hint: () => '一条命令装' },
            { id: '3', label: '卸载模组', hint: () => '需选编号' },
            { id: '4', label: '启用 / 禁用模组', hint: () => '不删文件' },
            { id: '5', label: '查看模组配置文件', hint: () => '只读预览' },
            { id: '6', label: '编辑模组配置文件', hint: () => '改前先备份' },
            { id: '7', label: '备份模组配置文件', hint: () => '改坏能回滚' },
            { id: '8', label: '查看服务端属性（全部）', hint: () => 'server.properties' },
            { id: '9', label: '修改单个服务端属性', hint: () => '核心玩法参数' },
            { id: '10', label: '服务端属性快速向导', hint: () => '问答式修改' },
            { id: '11', label: '重置服务端属性为默认', hint: () => '单项回滚' }
        ]
    },
    {
        key: 'R',
        label: '网络',
        title: '网络与联机',
        items: [
            { id: '1', label: '开房（陶瓦，生成房间号）', hint: () => '好友输房间号加入' },
            { id: '2', label: '查看房间号 / 联机状态', hint: () => '当前联机信息' },
            { id: '3', label: '关房（停止陶瓦）', hint: () => '释放进程' },
            { id: '4', label: '我要当房客 Join Room (陶瓦)', hint: () => '输房间号加入' },
            { id: '5', label: '下载镜像地址', hint: () => 'BMCLAPI 等' },
            { id: '6', label: '下载超时时间', hint: () => '秒' },
            { id: '7', label: '下载重试次数', hint: () => '失败重来几次' },
            { id: '8', label: '服务器端口与外网可见性', hint: () => 'server-port' },
            { id: '9', label: '查看本机网络信息', hint: () => '内网 IP / 端口' },
            { id: '10', label: 'Web 面板启动 / 停止', hint: () => '浏览器管理' }
        ]
    },
    {
        key: 'T',
        label: '工具',
        title: '工具与日志',
        items: [
            { id: '1', label: 'AI 分析最近日志', hint: () => '定位崩溃原因' },
            { id: '2', label: '生成统计报告', hint: () => '保存为文件' },
            { id: '3', label: '实时日志跟踪', hint: () => 'tail -f，Ctrl+C 退出' },
            { id: '4', label: '清理旧日志（保留最近 N 天）', hint: () => '省磁盘' },
            { id: '5', label: '生成客户端整合包', hint: () => '打包发给朋友' },
            { id: '6', label: '安装整合包（本地 .zip）', hint: () => '从文件装' },
            { id: '7', label: '安装整合包（远程 URL）', hint: () => '从网址装' }
        ]
    },
    {
        key: 'Y',
        label: '高级',
        title: '高级与杂项',
        items: [
            {
                id: '1', label: 'Java 设置（扫描 / 选择 / 安装）',
                hint: (ctx) => {
                    const s = ctx.status.collect();
                    return s.javaInstalled.length ? `${s.javaInstalled.length} 个 Java` : '未检测到 Java';
                }
            },
            { id: '2', label: '修改 JVM 参数（模板 + 覆盖）', hint: () => '内存与 GC' },
            { id: '3', label: '查看系统信息', hint: () => 'OS / 内存 / Node' },
            { id: '4', label: '重置全部配置', hint: () => '⚠ 不可撤销' },
            { id: '5', label: '认证设置 (外置登录)', hint: () => 'authlib-injector' },
            { id: '6', label: '列出已安装 Web 主题', hint: () => '主题包一览' },
            { id: '7', label: '安装 Web 主题', hint: () => 'ZIP 包' },
            { id: '8', label: '切换 Web 主题', hint: () => '换外观' },
            { id: '9', label: '删除 Web 主题', hint: () => '移除主题包' }
        ]
    }
];

/** 页键 → 页定义 */
const PAGE_MAP = new Map(PAGES.map(p => [p.key, p]));

/** 取一项的全部编号：扁平化后只有本页顺号一个 */
function idsOf(item) {
    if (!item) return [];
    return [String(item.id)];
}

/** 某页里编号命中的项（只认本页顺号，不再回退旧编号） */
function itemOfPage(pageKey, id) {
    const p = PAGE_MAP.get(pageKey);
    if (!p) return null;
    const key = String(id);
    return p.items.find(it => String(it.id) === key) || null;
}

/**
 * 编号 → 页（跨页查找用）。
 *
 * V3.7.4：只按本页顺号匹配。旧编号兼容已移除，`1` 在 Q 页和 W 页都是
 * 「本页第 1 项」，不再有「敲 14 跳到陶瓦」这类猜测。
 */
function findPageOfItem(id, currentPage) {
    const key = String(id);
    if (currentPage && PAGE_MAP.has(currentPage)) {
        const p = PAGE_MAP.get(currentPage);
        if (p.items.some(it => String(it.id) === key)) return currentPage;
    }
    for (const p of PAGES) {
        if (p.items.some(it => String(it.id) === key)) return p.key;
    }
    return null;
}

/**
 * 编号解析（模块级，TUI 与兼容模式共用）。
 *
 * 返回 `{ page, item, functional }`，找不到返回 null。
 *   - `page`       命中项所在页；
 *   - `item`       命中的项（用于取 label 等）；
 *   - `functional` 功能键 —— 扁平化后就是本页顺号本身。
 *
 * V3.7.4：只在本页内解析。编号不在本页 → null（提示「没有编号 X」），
 * 不再跨页猜测，因为菜单现在只有一层，编号就是最终动作。
 */
function resolveNumber(id, page) {
    const key = String(id);
    const item = itemOfPage(page, key);
    if (!item) return null;
    return { page, item, functional: String(item.id) };
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

/** 打印标题栏（各动作函数用它区分段落，保持与历史输出风格一致） */
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

    // 直达某页（'W' / 'Q' …）：进 TUI 并停在该页。
    // V3.7.4：数字直达随旧编号一起移除 —— 数字在不同页含义不同，
    // 没有页键就无法确定要执行什么。传数字进来直接告知用法。
    if (directChoice) {
        const key = String(directChoice).toUpperCase();
        if (PAGE_MAP.has(key)) {
            state.page = key;
        } else {
            console.log(`直接跳转只支持页键（Q/W/E/R/T/Y），收到「${directChoice}」。`);
            console.log('请进入菜单后用数字选择本页功能。');
            return;
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

        // 启动服务器（Q 页 1）：服务端控制台会接管 stdin，必须关掉 TUI 的 readline。
        // V3.7.4 扁平化后按「页键 + 顺号」判定，不再依赖旧编号。
        if (hit.page === 'Q' && String(hit.item.id) === '1') {
            const r = await maybeJumpToServer(options, kb, status);
            if (r.handled) return 'SERVER';
            // 服务器已在运行 / 用户拒绝启动 / 启动失败 → 停在原地重绘。
            // 失败原因要带进 notice：重绘会清屏，只 console.error 的话用户根本看不到。
            if (r.message) state.notice = r.message;
            status.invalidate();
            return null;
        }

        // 挂起 TUI 键盘，把 stdin 让给当前动作的交互提问（同一个 rl，不新建）
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
    const finishExit = async () => {
        cancelNumber();
        pendingConfirmExit = false;
        if (options.returnOnExit) {
            leaving = 'EXIT';
            signalLeave();
            return;
        }
        kb.close();
        // 执行令：任意视图主动退出前，本进程持有的 MC 必须优雅退出，
        // 不能靠 exit 钩子直接 SIGKILL 抢跑、更不能把服务端留成孤儿。
        // hasOwnedChild() 为假（纯菜单 / 服务端由别的进程托管）时是 no-op。
        try {
            const shutdown = require('./shutdown');
            if (shutdown.hasOwnedChild()) await shutdown.requestStop('tui:exit');
        } catch (e) { /* 兜底模块不可用时不影响退出 */ }
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

    // 执行令流转矩阵 2：Web 面板在别处触发启动服务端时，:m 视图**不切换**，
    // 只把顶部状态栏刷新成「🟢 已启动」。StatusBar.collect() 本来就采集
    // 运行中状态，这里只在「已停止 → 已启动」跳变时失效缓存并重绘一次。
    // 用户正在输编号时不打断，避免把半截编号吞掉。
    let webWatch = null;
    let wasRunning = null;
    const watchSm = options.serverManager;
    if (watchSm && typeof watchSm.isRunning === 'function') {
        webWatch = setInterval(() => {
            let running = false;
            try { running = Boolean(watchSm.isRunning()); } catch (e) { return; }
            if (wasRunning === false && running && !numBuf) {
                status.invalidate();
                render('🟢 已启动（Web 面板触发；:m 视图保持不变）');
            }
            wasRunning = running;
        }, 1500);
        if (webWatch.unref) webWatch.unref();
    }

    await leave;
    kb.close();
    if (webWatch) { clearInterval(webWatch); webWatch = null; }

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
                // 只认本页顺号（V3.7.4 起旧编号兼容已移除）
                const hit = resolveNumber(k, state.page);
                if (!hit) {
                    state.notice = `没有编号 ${k} 的功能（本页 1~${(PAGE_MAP.get(state.page) || { items: [] }).items.length || 1}，Q/W/E/R/T/Y 切页）`;
                    logger.warn(`无效菜单选择: ${raw}`);
                    continue;
                }
                if (hit.page === 'Q' && String(hit.item.id) === '1') {
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
 * 动作执行期间的统一输入通道。
 *
 * **为什么要包一层**（V3.6.3 实测教训）：
 *   TUI 的 readline 处于 raw 模式时，`rl.question()` 会重复插入触发键
 *   （按 2 执行某项，问题里先出现一个 2）。正确做法是先把键盘
 *   `suspend()` 出去（TUI 的 rl 被销毁、raw 模式退出），再用干净的行读取器
 *   提问，问完 `resume()` 重建。
 *
 * 本类把这套「挂起-提问-恢复」封装起来，各动作函数只看到统一的
 * `ask()`。外部调用方（未传 kb）拿到的是普通 rl，走原生 question。
 */
function makeIo(kb) {
    if (!kb) {
        // 无 TUI：调用方从 dispatchMenu 的 rl 参数走原生提问
        return null;
    }
    return {
        interactive: true,
        /** 动作开始：交出键盘 */
        async enter() { await kb.suspend(); },
        /** 动作结束：收回键盘 */
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
        // 服务端已在运行：Q 页 1 = 附加回 :mc 实时日志（执行令流转矩阵 3），
        // 不再弹旧的停止询问把用户困在菜单里，也绝不误杀服务端。
        console.log('\n🟢 服务端已在运行，正在切到 :mc 实时日志…');
        // 交出 TUI 键盘：:mc 控制台要独占 stdin（suspend 可逆，close 不可逆）
        if (kb) await kb.suspend();

        if (serverManager.process) {
            // 本进程持有 MC（从开服控制台的 :m 进来）：返回 handled 让 TUI
            // 主循环退出，由 server.js 的 _backToConsole() 重建 console 租约
            // 回到 :mc。绝不能在这里调 stop()。
            if (status) status.invalidate();
            return { handled: true, message: null };
        }

        // 本进程不持有 MC（独立菜单 / Web 面板启动）：不能抢占别人的 stdin，
        // 也不该造第二个 readline。原地提示后留在菜单，服务继续跑。
        console.log('   该服务端由其它进程托管，本终端无法接管它的 stdin。');
        console.log('   请使用 Web 面板 / 原终端的 :mc 视图，或 `wow logs tail` 查看实时日志。');
        if (kb) {
            await tui.askLine('\n按回车键返回...');
            await kb.resume();
        } else if (rl) {
            await ask(rl, '\n按回车键返回...');
        }
        if (status) status.invalidate();
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
    const page = opts.page || null;
    const key = String(id);

    // V3.7.4：菜单只有一层，id 就是本页顺号，直接映射到具名动作函数。
    // 不再有「本页序号 → 旧编号 functional → dispatchMenu 大 switch」的中转。
    const fn = page ? ACTION_BY_KEY.get(`${page}:${key}`) : null;
    if (!fn) {
        console.log(`未知菜单项: ${page || '?'} 页 ${key}`);
        return false;
    }
    return fn({ options, io, rl, ctx, page });
}

/** 页键 + 顺号 → 动作函数（与 PAGES 一一对应，模块加载时校验） */
const ACTION_BY_KEY = new Map();

/** 注册一个动作；签名 (env) => Promise<boolean> */
function action(pageKey, itemId, fn) {
    ACTION_BY_KEY.set(`${pageKey}:${String(itemId)}`, fn);
    return fn;
}

// ==================== Q 页：服务器 ====================

/**
 * Q1 启动 / 停止服务器。
 *
 * 走 maybeJumpToServer —— 它会处理「已在运行 → 切 :mc」「未运行 → 交出 stdin
 * 给服务端控制台」两种分支。TUI / 兼容模式各自的收尾逻辑都在那边。
 */
async function actionStartStop(env) {
    const r = await maybeJumpToServer(env.options, null, env.ctx ? env.ctx.status : null, env.rl || null);
    return r.handled;
}

action('Q', 1, (env) => actionStartStop(env));

async function serverStatus(env) {
    printHeader('服务器状态监控');
    const { serverManager, logHandler } = env.options;
    if (!serverManager) { console.log('服务器管理模块未加载'); return false; }
    serverManager.status();
    if (serverManager.isRunning() && logHandler) {
        console.log('\n  服务端运行中：可在 T 页 3 查看实时日志，或在开服控制台按 :mc 进入。');
    }
    return false;
}

action('Q', 2, (env) => serverStatus(env));

// ── server.properties 四个动作（Q 页与 E 页共用）──

async function propsCtx() {
    const ServerProperties = require('./config').ServerProperties;
    let utils = null;
    try { utils = require('./utils'); } catch (e) { utils = null; }
    const serverDir = utils ? utils.getServerDir() : '../scheme';
    return { props: new ServerProperties(serverDir), utils };
}

async function propsListAll() {
    printHeader('服务端属性 (server.properties)');
    const { props } = await propsCtx();
    props.listAll();
    return false;
}

async function propsSetOne(env, hintText) {
    printHeader(hintText || '修改服务端属性');
    const { props } = await propsCtx();
    const key = await ioAsk(env.io, env.rl, '属性名: ');
    if (!key) { console.log('未输入属性名，已取消。'); return false; }
    const current = props.get(key);
    console.log(`当前值: ${current !== null ? current : '(未设置)'}`);
    const value = await ioAsk(env.io, env.rl, '新值: ');
    if (value) {
        props.set(key, value);
        console.log(`✅ ${key} = ${value}`);
    }
    return false;
}

async function propsWizard(env, hintText) {
    printHeader(hintText || '服务端属性快速向导');
    const { props } = await propsCtx();
    // TUI 模式下 io 存在但 rl 为 null：quickSet 内部自建临时 readline
    // 是安全的（此时 stdin 已被 TUI suspend 让出）。绝不能传 TUI 的 rl。
    await props.quickSet(undefined, env.io ? undefined : env.rl);
    return false;
}

async function propsResetOne(env, hintText) {
    printHeader(hintText || '重置服务端属性');
    const { props } = await propsCtx();
    const key = await ioAsk(env.io, env.rl, '要重置的属性名: ');
    if (!key) { console.log('未输入属性名，已取消。'); return false; }
    const result = props.reset(key);
    console.log(`✅ ${result.key} 已重置为 ${result.value}`);
    return false;
}

action('Q', 3, () => propsListAll());
action('Q', 4, (env) => propsSetOne(env, '修改服务端属性'));
action('Q', 5, (env) => propsWizard(env, '服务端属性快速向导'));
action('Q', 6, (env) => propsResetOne(env, '重置服务端属性'));

async function logAnalyze(env) {
    printHeader('AI 分析最近日志');
    const { logHandler } = env.options;
    if (!logHandler) { console.log('日志处理模块未加载'); return false; }
    await logHandler.analyze();
    return false;
}

action('Q', 7, (env) => logAnalyze(env));

action('Q', 8, ({ options }) => tailLogs(options));

// Q9「联机 / 我要当房主 (陶瓦)」= R1 开房，两个入口指向同一动作
action('Q', 9, (env) => terracottaHost(env));

// ==================== W 页：方案 ====================

async function schemeCreate(env) {
    printHeader('新建方案');
    const schemeManager = env.options.schemeManager;
    if (!schemeManager) { console.log('方案管理模块未加载'); return false; }

    // 1) 方案名
    const sName = (await ioAsk(env.io, env.rl, '方案名称: ')).trim();
    if (!sName) { console.log('未输入方案名，已取消。'); return false; }

    // 名称校验：复用 file_manager 的跨平台校验段（拒绝路径分隔符、
    // Windows 保留字符/保留设备名、以点或空格结尾等）
    let fm;
    try { fm = require('./file_manager'); } catch (e) { fm = null; }
    if (fm && typeof fm.validateNameSegment === 'function') {
        const check = fm.validateNameSegment(sName);
        if (!check.ok) {
            console.log(`❌ 方案名不合法: ${check.reason}`);
            return false;
        }
    }

    // 目录已存在则直接拒绝（避免 create 抛错后留下残缺目录）
    if (typeof schemeManager._schemeExists === 'function' && schemeManager._schemeExists(sName)) {
        console.log(`❌ 方案「${sName}」已存在。可用 W 页 3 查看全部方案。`);
        return false;
    }

    // 2) 核心类型（V3.5.11：补充 neoforge——安装器层早已支持，此处补齐入口）
    const sTypes = ['vanilla', 'forge', 'fabric', 'neoforge', 'paper', 'purpur', 'spigot', 'bukkit', 'mohist', 'leaves'];
    console.log('\n支持的服务器类型:');
    sTypes.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    const stChoice = (await ioAsk(env.io, env.rl, '\n选择类型 (默认 1 vanilla): ')).trim();
    let type = 'vanilla';
    if (stChoice) {
        const stIdx = parseInt(stChoice, 10) - 1;
        if (!(stIdx >= 0 && stIdx < sTypes.length)) {
            console.log('类型选择无效，已取消。');
            return false;
        }
        type = sTypes[stIdx];
    }

    // 3) 版本 / 构建号
    // V3.5.11：不再单独询问模组加载器——加载器随核心类型自动确定
    // （选 fabric 即 fabric 核心 + fabric 加载器，与 CLI -t 行为一致）
    const sVersion = (await ioAsk(env.io, env.rl, 'Minecraft 版本 (默认 1.20.1): ')).trim() || '1.20.1';
    const sBuild = (await ioAsk(env.io, env.rl, '构建号 (留空自动选择最新): ')).trim() || null;

    // 4) 创建（务必用对象签名——旧实现曾用三个位置参数调用，
    //    导致用户输入的版本/加载器被静默忽略，这里已修正）
    console.log('');
    try {
        await schemeManager.create(sName, { type, version: sVersion, loader: type, build: sBuild });
        console.log(`\n✅ 方案「${sName}」创建完成。`);
        const sDir = (schemeManager.schemesDir)
            ? path.join(schemeManager.schemesDir, sName)
            : `scheme/${sName}`;
        console.log(`   目录: ${sDir}`);
        console.log('   可在 W 页 2 切换到此方案后启动服务器。');
    } catch (e) {
        console.log(`\n❌ 创建失败: ${e.message}`);
    }
    return false;
}

async function schemeSwitch(env) {
    printHeader('切换方案');
    const schemeManager = env.options.schemeManager;
    if (!schemeManager) { console.log('方案管理模块未加载'); return false; }
    schemeManager.list();
    const name = (await ioAsk(env.io, env.rl, '要切换到的方案名: ')).trim();
    if (!name) { console.log('未输入，已取消。'); return false; }
    try {
        await schemeManager.switch(name);
        if (env.ctx && env.ctx.status) env.ctx.status.invalidate();
    } catch (e) {
        console.log(`❌ 切换失败: ${e.message}`);
    }
    return false;
}

async function schemeList() {
    printHeader('全部方案');
    return false;
}

async function schemeDelete(env) {
    printHeader('删除方案');
    const schemeManager = env.options.schemeManager;
    if (!schemeManager) { console.log('方案管理模块未加载'); return false; }
    schemeManager.list();
    const name = (await ioAsk(env.io, env.rl, '要删除的方案名: ')).trim();
    if (!name) { console.log('未输入，已取消。'); return false; }
    const confirm = (await ioAsk(env.io, env.rl, `确定删除方案 "${name}"? (y/N): `)).trim().toLowerCase();
    if (confirm !== 'y') { console.log('已取消。'); return false; }
    try {
        await schemeManager.delete(name);
        if (env.ctx && env.ctx.status) env.ctx.status.invalidate();
    } catch (e) {
        console.log(`❌ 删除失败: ${e.message}`);
    }
    return false;
}

async function schemeInfo(env) {
    printHeader('方案信息');
    const schemeManager = env.options.schemeManager;
    if (!schemeManager) { console.log('方案管理模块未加载'); return false; }
    schemeManager.list();
    const name = (await ioAsk(env.io, env.rl, '方案名 (回车 = 当前方案): ')).trim();
    try {
        schemeManager.status(name || undefined);
    } catch (e) {
        console.log(`❌ 获取失败: ${e.message}`);
    }
    return false;
}

async function schemePrune(env) {
    printHeader('整理资源池（瘦身）');
    const schemeManager = env.options.schemeManager;
    if (!schemeManager) { console.log('方案管理模块未加载'); return false; }
    const name = (await ioAsk(env.io, env.rl, '方案名 (回车 = 当前方案): ')).trim();
    const confirm = (await ioAsk(env.io, env.rl, '将删除未引用的资源，确定继续? (y/N): ')).trim().toLowerCase();
    if (confirm !== 'y') { console.log('已取消。'); return false; }
    try {
        await schemeManager.prune(name || undefined);
        console.log('✅ 瘦身完成');
    } catch (e) {
        console.log(`❌ 瘦身失败: ${e.message}`);
    }
    return false;
}

/** 安装整合包：source = 'local' | 'url' */
async function packInstall(env, source) {
    printHeader(source === 'url' ? '安装整合包（远程 URL）' : '安装整合包（本地 .zip）');
    const { packGenerator } = env.options;
    if (!packGenerator) { console.log('整合包模块未加载'); return false; }
    const target = source === 'url'
        ? await ioAsk(env.io, env.rl, '整合包 URL: ')
        : await ioAsk(env.io, env.rl, '整合包文件路径: ');
    if (!target) { console.log('未输入，已取消。'); return false; }
    // TUI 模式 rl 为 null → 传 undefined，让 packGenerator 自建临时 readline
    // （此时 stdin 已被 TUI suspend 让出，安全）。绝不能传 TUI 的 rl。
    await packGenerator.install(target, env.io ? undefined : env.rl);
    return false;
}

async function packGenerate(env) {
    printHeader('生成客户端整合包');
    const { packGenerator } = env.options;
    if (!packGenerator) { console.log('整合包模块未加载'); return false; }
    const name = await ioAsk(env.io, env.rl, '整合包名称: ') || 'client-pack';
    const version = await ioAsk(env.io, env.rl, 'Minecraft 版本 (默认 1.20.1): ') || '1.20.1';
    await packGenerator.generate({ name, version });
    return false;
}

action('W', 1, (env) => schemeCreate(env));
action('W', 2, (env) => schemeSwitch(env));
action('W', 3, async (env) => {
    const r = await schemeList();
    const sm = env.options.schemeManager;
    if (sm) sm.list();
    return r;
});
action('W', 4, (env) => schemeDelete(env));
action('W', 5, (env) => schemeInfo(env));
action('W', 6, (env) => packInstall(env, 'local'));
action('W', 7, (env) => packInstall(env, 'url'));
action('W', 8, (env) => packGenerate(env));
action('W', 9, (env) => schemePrune(env));

// ==================== E 页：模组 / 配置 ====================

async function modList(env) {
    printHeader('已安装模组');
    const { modManager } = env.options;
    if (!modManager) { console.log('模组管理模块未加载'); return false; }
    const mods = modManager.listMods();
    console.log(`\n已安装模组 (${mods.length}):`);
    for (const mod of mods) {
        const status = mod.enabled ? '✅' : '❌';
        const sizeKB = (mod.size / 1024).toFixed(1);
        console.log(`  ${status} ${mod.name} (${sizeKB} KB) [${mod.loader}/${mod.version}]`);
    }
    return false;
}

async function modInstall(env) {
    printHeader('安装模组');
    const { modManager } = env.options;
    if (!modManager) { console.log('模组管理模块未加载'); return false; }
    const target = (await ioAsk(env.io, env.rl, '模组 URL 或本地路径: ')).trim();
    if (!target) { console.log('未输入，已取消。'); return false; }
    await modManager.install(target);
    return false;
}

async function modRemove(env) {
    printHeader('卸载模组');
    const { modManager } = env.options;
    if (!modManager) { console.log('模组管理模块未加载'); return false; }
    const mods = modManager.listMods();
    if (!mods.length) { console.log('当前没有已安装的模组。'); return false; }
    mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.name}`));
    const idx = parseInt(await ioAsk(env.io, env.rl, '选择要卸载的模组编号: '), 10) - 1;
    if (idx >= 0 && idx < mods.length) {
        modManager.remove(mods[idx].name);
    } else {
        console.log('编号无效，已取消。');
    }
    return false;
}

async function modToggle(env) {
    printHeader('启用 / 禁用模组');
    const { modManager } = env.options;
    if (!modManager) { console.log('模组管理模块未加载'); return false; }
    const mods = modManager.listMods();
    if (!mods.length) { console.log('当前没有已安装的模组。'); return false; }
    mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.status || (m.enabled ? '✅' : '❌')} ${m.name}`));
    const idx = parseInt(await ioAsk(env.io, env.rl, '选择要切换的模组编号: '), 10) - 1;
    if (idx >= 0 && idx < mods.length) {
        modManager.toggleMod(mods[idx].name);
    } else {
        console.log('编号无效，已取消。');
    }
    return false;
}

/** 模组配置文件上下文：serverDir + configEditor */
function modConfigCtx() {
    let utils = null;
    try { utils = require('./utils'); } catch (e) { utils = null; }
    const serverDir = utils ? utils.getServerDir() : '../scheme';
    const configEditor = require('./config_editor');
    return { utils, serverDir, configEditor };
}

async function modViewConfig(env) {
    printHeader('查看模组配置文件');
    const { serverDir, configEditor, utils } = modConfigCtx();
    const files = configEditor.getConfigFiles(serverDir);
    if (files.length === 0) { console.log('config 目录下没有配置文件'); return false; }
    console.log(`\n配置文件 (${files.length}):`);
    files.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext}, ${utils ? utils.formatFileSize(f.size) : f.size} B)`));
    const idx = parseInt(await ioAsk(env.io, env.rl, '\n选择要查看的文件编号: '), 10) - 1;
    if (!(idx >= 0 && idx < files.length)) { console.log('编号无效，已取消。'); return false; }
    const result = configEditor.readConfig(files[idx].fullPath);
    if (!result.success) { console.log(`读取失败: ${result.error}`); return false; }
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`文件: ${files[idx].relPath}`);
    if (result.warning) console.log(`⚠ ${result.warning}`);
    console.log('═'.repeat(60));
    if (typeof result.data === 'object') {
        console.log(JSON.stringify(result.data, null, 2));
    } else {
        console.log(result.data);
    }
    return false;
}

async function modEditConfig(env) {
    printHeader('编辑模组配置文件');
    const { serverDir, configEditor } = modConfigCtx();
    const files = configEditor.getConfigFiles(serverDir);
    const editable = files.filter(f => ['.json', '.toml', '.yml', '.yaml', '.properties', '.cfg', '.conf', '.ini'].includes(f.ext));
    if (editable.length === 0) { console.log('没有可编辑的结构化配置文件'); return false; }
    console.log('\n可编辑的配置文件 (JSON/TOML/YAML):');
    editable.forEach((f, i) => console.log(`  ${i + 1}. ${f.relPath} (${f.ext})`));
    const idx = parseInt(await ioAsk(env.io, env.rl, '\n选择要编辑的文件编号: '), 10) - 1;
    if (!(idx >= 0 && idx < editable.length)) { console.log('编号无效，已取消。'); return false; }

    const file = editable[idx];
    const listResult = configEditor.listConfig(file.fullPath);
    if (listResult.success) {
        console.log(`\n当前键值 (${file.relPath}):`);
        listResult.entries.forEach(e => console.log(`  ${e.key} = ${JSON.stringify(e.value)}`));
    }
    const key = (await ioAsk(env.io, env.rl, '\n输入要修改的键 (点号分隔, 如 general.enable): ')).trim();
    const value = await ioAsk(env.io, env.rl, '输入新值: ');
    if (!key || value === undefined) { console.log('未输入，已取消。'); return false; }
    const setResult = configEditor.setConfigValue(file.fullPath, key, value);
    if (setResult.success) {
        console.log(`✅ 已设置 ${key} = ${value}`);
        if (setResult.backupPath) console.log(`   备份已保存: ${setResult.backupPath}`);
    } else {
        console.log(`❌ 设置失败: ${setResult.error}`);
    }
    return false;
}

async function modBackupConfig() {
    printHeader('备份模组配置文件');
    const { serverDir, configEditor } = modConfigCtx();
    const backupResult = configEditor.backupConfigs(serverDir);
    if (backupResult.success) {
        console.log(`✅ 已备份 ${backupResult.count} 个配置文件`);
        console.log(`   备份目录: ${backupResult.backupDir}`);
    } else {
        console.log(`❌ 备份失败: ${backupResult.error}`);
    }
    return false;
}

action('E', 1, (env) => modList(env));
action('E', 2, (env) => modInstall(env));
action('E', 3, (env) => modRemove(env));
action('E', 4, (env) => modToggle(env));
action('E', 5, (env) => modViewConfig(env));
action('E', 6, (env) => modEditConfig(env));
action('E', 7, (env) => modBackupConfig());
action('E', 8, () => propsListAll());
action('E', 9, (env) => propsSetOne(env, '修改服务端属性（核心玩法）'));
action('E', 10, (env) => propsWizard(env, '服务端属性快速向导'));
action('E', 11, (env) => propsResetOne(env, '重置服务端属性'));

// ==================== R 页：网络 / 联机 ====================

async function terracottaHost(env) {
    printHeader('开房（陶瓦联机）');
    const Terracotta = require('./terracotta');
    console.log('\n   powered by Terracotta | 陶瓦联机 (AGPLv3)');
    console.log('   基于 EasyTier 的内网穿透，好友无需公网 IP 即可加入你的 Minecraft 服务端。');
    console.log('   加入端由 PCL / HMCL / BakaXL / FCL 等启动器内置支持。\n');
    console.log('提示：开房前请先启动 Minecraft 服务端（Q 页 1），陶瓦会自动扫描本机服务端端口。');
    try {
        await Terracotta.hostRoom({ promptPort: (msg) => ioAsk(env.io, env.rl, msg) });
    } catch (e) {
        console.error(`❌ 开房失败: ${e.message}`);
    }
    return false;
}

async function terracottaStatus() {
    printHeader('陶瓦联机状态');
    const Terracotta = require('./terracotta');
    try {
        const s = await Terracotta.getStatus();
        if (!s.running) {
            console.log('当前未开房（陶瓦未运行）。R 页 1 开房。');
            return false;
        }
        console.log(`运行状态:  🟢 运行中`);
        console.log(`角色:      ${s.mode === 'guest' ? '房客（Join Room）' : '房主（开房）'}`);
        console.log(`本地 API:  127.0.0.1:${s.port}`);
        console.log(`房间号:    ${s.roomCode || '(生成中)'}`);
        if (s.player) console.log(`玩家名:    ${s.player}`);
        console.log(`状态机:    ${s.state || '未知'}`);
        if (s.roomCode) {
            console.log('\n把房间号发给好友，对方在 PCL / HMCL / BakaXL / FCL 中选择「加入陶瓦房间」并输入该房间号即可联机。');
        }
    } catch (e) {
        console.error(`❌ 查询失败: ${e.message}`);
    }
    return false;
}

async function terracottaStop() {
    printHeader('关房（停止陶瓦）');
    const Terracotta = require('./terracotta');
    try {
        await Terracotta.stopHost();
    } catch (e) {
        console.error(`❌ 关房失败: ${e.message}`);
    }
    return false;
}

async function terracottaJoin(env) {
    printHeader('我要当房客 Join Room (陶瓦)');
    const Terracotta = require('./terracotta');
    // 房间号 + 玩家名都通过 ioAsk（TUI 下走挂起键盘的安全提问通道），
    // 绝不另开 readline，避免 stdin 双消费者。
    const roomCode = String(await ioAsk(env.io, env.rl, '请输入房间号 (由房主提供): ') || '').trim();
    if (!roomCode) { console.log('未输入房间号，已取消。'); return false; }
    const playerName = String(await ioAsk(env.io, env.rl, '请输入你的玩家名 (Minecraft ID): ') || '').trim();
    if (!playerName) { console.log('未输入玩家名，已取消。'); return false; }
    try {
        await Terracotta.joinRoom({ roomCode, player: playerName });
    } catch (e) {
        console.error(`❌ 加入失败: ${e.message}`);
    }
    return false;
}

/** 下载管理器三项设置：field = 'mirror' | 'timeout' | 'retry' */
async function downloadSetting(env, field) {
    const { config } = env.options;
    if (!config) { console.log('配置模块未加载'); return false; }

    if (field === 'mirror') {
        printHeader('下载镜像地址');
        const cur = config.getConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
        console.log(`\n  当前镜像: ${cur}\n`);
        console.log('  1. BMCLAPI2 (推荐) - https://bmclapi2.bangbang93.com');
        console.log('  2. 官方源 - https://launcher.mojang.com');
        console.log('  3. 自定义');
        const m = (await ioAsk(env.io, env.rl, '选择: ')).trim();
        if (m === '1') {
            config.setConfig('download.mirror', 'https://bmclapi2.bangbang93.com');
            console.log('✅ 镜像地址已更新');
        } else if (m === '2') {
            config.setConfig('download.mirror', 'https://launcher.mojang.com');
            console.log('✅ 镜像地址已更新');
        } else if (m === '3') {
            const custom = (await ioAsk(env.io, env.rl, '自定义地址: ')).trim();
            if (custom) {
                config.setConfig('download.mirror', custom);
                console.log('✅ 镜像地址已更新');
            } else {
                console.log('未输入，已取消。');
            }
        } else {
            console.log('选择无效，已取消。');
        }
        return false;
    }

    const isTimeout = field === 'timeout';
    printHeader(isTimeout ? '下载超时时间' : '下载重试次数');
    const cur = isTimeout
        ? config.getConfig('download.timeout', 30)
        : config.getConfig('download.retry', 3);
    console.log(`\n  当前值: ${isTimeout ? cur + 's' : cur}\n`);
    const raw = (await ioAsk(env.io, env.rl, isTimeout ? '超时时间(秒): ' : '重试次数: ')).trim();
    if (!raw) { console.log('未输入，已取消。'); return false; }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) { console.log('请输入非负整数。'); return false; }
    config.setConfig(isTimeout ? 'download.timeout' : 'download.retry', n);
    console.log(isTimeout ? '✅ 超时时间已更新' : '✅ 重试次数已更新');
    return false;
}

action('R', 1, (env) => terracottaHost(env));
action('R', 2, () => terracottaStatus());
action('R', 3, () => terracottaStop());
action('R', 4, (env) => terracottaJoin(env));
action('R', 5, (env) => downloadSetting(env, 'mirror'));
action('R', 6, (env) => downloadSetting(env, 'timeout'));
action('R', 7, (env) => downloadSetting(env, 'retry'));

action('R', 8, async ({ options }) => {
    printHeader('服务器端口与外网可见性');
    const { config } = options;
    if (!config) { console.log('配置模块未加载'); return false; }
    const { props } = await propsCtx();
    const port = props.get('server-port');
    const online = props.get('online-mode');
    const players = props.get('max-players');
    const bindIp = props.get('server-ip');
    console.log('\n  服务器端口:   ' + (port == null ? '(未设置，默认 25565)' : port));
    console.log('  绑定地址:     ' + (bindIp == null || bindIp === '' ? '(未设置 = 监听所有网卡)' : bindIp));
    console.log('  正版验证:     ' + (online == null ? '(默认 true)' : online));
    console.log('  最大玩家数:   ' + (players == null ? '(默认 20)' : players));

    // 真正判定「这台机器上的 MC 监听在哪」：未设 server-ip = 全网卡，设了回环才只本机
    const loopback = (v) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(v || '').trim().toLowerCase());
    const scope = (bindIp == null || bindIp === '')
        ? '所有网卡（本机 + 局域网 + 路由器映射后可达公网）'
        : (loopback(bindIp) ? '仅本机（外部无法连接）' : `仅指定网卡 ${bindIp}`);
    console.log('  监听范围:     ' + scope);

    console.log('\n  外网可见性取决于：路由器端口转发 / 云服务器安全组 / 运营商是否封端口。');
    console.log('  Web 面板的绑定地址不是服务器端口，别把两者搞混（面板见本页 10）。');
    console.log('  想跳过这些限制可直接用陶瓦联机（R 页 1 开房）。');
    return false;
});

action('R', 9, async (env) => lanNetInfo(env.io, env.rl));

/**
 * R10 Web 面板启动 / 停止。
 *
 * 历史 bug：这个动作原本写成 `async ({ options }) => { ... ioAsk(env.io, ...) }`，
 * 解构里没有 `env`，一按停止就 ReferenceError，被 runItem 的 catch 吞成
 * 「执行出错: env is not defined」，看起来像「点了没反应」。
 * 现在统一用 `async (env) =>`。
 *
 * 另外两个坑一并修掉：
 *   - `isRunning()` 只反映**本进程内存**里的状态（PID 文件那条路不查），
 *     所以面板是 `wow web start` 单独起的进程时会被误判为「未运行」，
 *     再点一次就撞 EADDRINUSE。改为用 webStatus() 先查 PID 文件。
 *   - `startWeb()` 是回调式启动：listen 成功后才把 isRunning 置 true，
 *     函数本身立即返回 undefined，原来那句 `info.url` 永远是 fallback。
 *     改为启动后读 webStatus() 拿真实 host / port。
 */
action('R', 10, async (env) => {
    printHeader('Web 面板启动 / 停止');
    const Web = require('./web_service');

    // 1) 状态判定：先查 PID 文件（跨进程），再回退内存标记
    let status = { running: false };
    try { status = Web.webStatus() || { running: false }; } catch (e) { status = { running: false }; }

    if (status.running) {
        const url = status.host && status.port ? `http://${status.host}:${status.port}` : '';
        if (url) console.log(`\n  当前地址: ${url}${status.pid ? `  (PID: ${status.pid})` : ''}`);
        const c = (await ioAsk(env.io, env.rl, '面板正在运行，是否停止? (y/N): ')).trim().toLowerCase();
        if (c === 'y') {
            try {
                await Web.stopWeb();
                console.log('✅ 面板已停止');
            } catch (e) {
                console.log(`❌ 停止失败: ${e.message}`);
            }
        } else {
            console.log('已取消。');
        }
        return false;
    }

    // 2) 启动：startWeb 是同步函数，返回 http.Server（失败时返回 undefined 并已自行打印原因）
    let server = null;
    try {
        server = Web.startWeb();
    } catch (e) {
        console.log(`❌ 启动失败: ${e.message}`);
        return false;
    }
    if (!server) {
        // EADDRINUSE / 未设 auth_token 等，startWeb 内部已给出人话提示，这里不重复刷屏
        console.log('面板未启动，请查看上方提示。');
        return false;
    }

    // 3) 等 listening 事件拿真实地址（server.listen 是异步的，返回时 address() 可能还是 null）
    const addr = await new Promise((resolve) => {
        const done = () => {
            try { resolve(server.address()); } catch (e) { resolve(null); }
        };
        if (typeof server.listening === 'boolean' && server.listening) return done();
        let settled = false;
        const once = () => { if (!settled) { settled = true; done(); } };
        server.once('listening', once);
        // 兜底：极端情况下 listening 已错过事件，1.5s 后直接读 address()
        setTimeout(once, 1500);
    });

    if (addr && addr.port) {
        const rawHost = addr.address === '::' ? '0.0.0.0' : addr.address;
        const showHost = (rawHost === '0.0.0.0') ? '127.0.0.1' : rawHost;
        console.log(`✅ 面板已启动: http://${showHost}:${addr.port}`);
        if (rawHost === '0.0.0.0') {
            console.log('   绑定所有网卡：局域网 / 公网可直接访问（务必确认已设 auth_token）');
        }
    } else {
        console.log('✅ 面板已启动（未取到监听地址，可用 `wow web status` 查看）');
    }
    return false;
});

// ==================== T 页：工具 ====================

action('T', 1, async ({ options }) => {
    printHeader('AI 分析最近日志');
    const { logHandler } = options;
    if (!logHandler) { console.log('日志处理模块未加载'); return false; }
    await logHandler.analyze();
    return false;
});

action('T', 2, async ({ options }) => {
    printHeader('生成统计报告');
    const { logHandler } = options;
    if (!logHandler) { console.log('日志处理模块未加载'); return false; }
    await logHandler.report();
    return false;
});

action('T', 3, ({ options }) => tailLogs(options));
action('T', 4, (env) => cleanLogs(env.io, env.rl));
action('T', 5, (env) => packGenerate(env));
action('T', 6, (env) => packInstall(env, 'local'));
action('T', 7, (env) => packInstall(env, 'url'));

// ==================== Y 页：高级 ====================

async function javaSettingsEntry(env) {
    printHeader('Java 设置');
    const { config, utils } = env.options;
    if (!config || !utils) { console.log('配置模块未加载'); return false; }
    // V3.5.7：由「手填 Java 路径」升级为「扫描本机全部 Java 并列出选择」
    // javaSettingsFlow 自己打印列表并用全角冒号问「请选择:」——那是「从列表
    // 挑一个 Java」，不是菜单层级，保留原样。
    await javaSettingsFlow(env.rl, config, utils);
    return false;
}

action('Y', 1, (env) => javaSettingsEntry(env));

action('Y', 2, async (env) => {
    // V3.6.2（607 指令）：新结构 server.jvm，参数经引号感知解析器，禁用 split
    printHeader('修改 JVM 参数');
    const { config } = env.options;
    if (!config) { console.log('配置模块未加载'); return false; }
    const Jvm = require('./jvm_args');
    const curTemplate = config.getConfig('server.jvm.template', Jvm.DEFAULT_TEMPLATE);
    const curOverride = config.getConfig('server.jvm.override_args', []);
    console.log(`当前模板: ${curTemplate}（可选 ${Jvm.TEMPLATE_NAMES.join(' / ')}）`);
    console.log(`当前覆盖参数: ${curOverride.join(' ')}`);
    const newTemplate = (await ioAsk(env.io, env.rl, `新模板 (回车保持 ${curTemplate}): `)).trim();
    const newArgs = await ioAsk(env.io, env.rl, '新覆盖参数 (空格分隔，路径含空格用引号包裹；回车保持不变): ');
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
    return false;
});

action('Y', 3, async () => {
    printHeader('系统信息');
    const os = require('os');
    console.log(`\n  操作系统: ${os.type()} ${os.release()}`);
    console.log(`  架构:     ${os.arch()}`);
    console.log(`  内存:     ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`);
    console.log(`  CPU:      ${os.cpus()[0]?.model || 'Unknown'}`);
    console.log(`  Node.js:  ${process.version}`);
    return false;
});

action('Y', 4, async (env) => {
    printHeader('重置全部配置');
    const { config } = env.options;
    if (!config) { console.log('配置模块未加载'); return false; }
    const confirm = (await ioAsk(env.io, env.rl, '⚠ 确定重置所有配置? 此操作不可撤销 (y/N): ')).trim().toLowerCase();
    if (confirm !== 'y') { console.log('已取消。'); return false; }
    config.saveConfig(config.DEFAULT_CONFIG);
    console.log('✅ 配置已重置为默认值');
    return false;
});

async function authSettings(env) {
    printHeader('认证设置 (外置登录)');
    const { config } = env.options;
    if (!config) { console.log('配置模块未加载'); return false; }
    const authConfig = config.getConfig('auth', {});
    console.log(`\n  外置登录: ${authConfig.enable ? '✅ 已启用' : '❌ 未启用'}`);
    console.log(`  认证服务器: ${authConfig.server || '(未设置)'}`);
    console.log(`  javaagent: ${authConfig.javaagent || '(自动)'}`);
    const enable = (await ioAsk(env.io, env.rl, '\n启用外置登录? (y/N): ')).trim();
    if (enable.toLowerCase() === 'y') {
        config.setConfig('auth.enable', true);
        const server = (await ioAsk(env.io, env.rl, '认证服务器地址 (默认 https://authlib-injector.yushi.moe): ')).trim();
        if (server) config.setConfig('auth.server', server);
        console.log('✅ 外置登录已启用，下次启动服务器时生效');
    } else if (enable !== '') {
        config.setConfig('auth.enable', false);
        console.log('外置登录已禁用');
    }
    return false;
}

action('Y', 5, (env) => authSettings(env));

/** Web 主题四项：kind = 'list' | 'install' | 'switch' | 'delete' */
async function themeAction(env, kind) {
    const { themeManager } = env.options;
    const titles = { list: '列出已安装 Web 主题', install: '安装 Web 主题', switch: '切换 Web 主题', delete: '删除 Web 主题' };
    printHeader(titles[kind] || 'Web 主题');
    if (!themeManager) { console.log('主题管理模块未加载'); return false; }

    // 注意 shareRl：TUI 模式下没有可借用的 rl（键盘已 suspend），必须传 undefined
    // 让 themeManager 自建临时 readline，否则会与 TUI 的 rl 抢 stdin。
    const shareRl = env.io ? undefined : env.rl;

    if (kind === 'list') {
        themeManager.list();
        return false;
    }
    if (kind === 'install') {
        const filePath = (await ioAsk(env.io, env.rl, '主题 ZIP 文件路径: ')).trim();
        if (filePath) await themeManager.install(filePath, shareRl);
        else console.log('未输入，已取消。');
        return false;
    }
    themeManager.list();
    if (kind === 'switch') {
        const name = (await ioAsk(env.io, env.rl, '要切换的主题名: ')).trim();
        if (name) await themeManager.switch(name, shareRl);
        else console.log('未输入，已取消。');
        return false;
    }
    const name = (await ioAsk(env.io, env.rl, '要删除的主题名: ')).trim();
    if (name) themeManager.delete(name);
    else console.log('未输入，已取消。');
    return false;
}

action('Y', 6, (env) => themeAction(env, 'list'));
action('Y', 7, (env) => themeAction(env, 'install'));
action('Y', 8, (env) => themeAction(env, 'switch'));
action('Y', 9, (env) => themeAction(env, 'delete'));


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

    // log.disabled=true：执行令要求方案 logs/ 只保留最新 latest.log，
    // 忽略「保留 N 天」，删掉其余所有条目（含子目录）。MC 自己写的
    // latest.log 保留，关服时的 _cleanLogsOnStop() 也是同一套语义。
    let logSink = null;
    try { logSink = require('./log_sink'); } catch (e) { /* 兜底：按原按天清理 */ }
    if (logSink && !logSink.shouldPersist()) {
        let entries = [];
        try { entries = fs.readdirSync(logDir); } catch (e) { entries = []; }
        const victims = entries.filter(f => f !== 'latest.log');
        if (!victims.length) {
            console.log('✅ logs/ 已经只剩 latest.log，无需清理。');
            return false;
        }
        console.log(`\n[log.disabled] 将删除 ${victims.length} 个条目，只保留 latest.log：`);
        victims.slice(0, 10).forEach(f => console.log(`   ${f}`));
        if (victims.length > 10) console.log(`   … 还有 ${victims.length - 10} 个`);
        const ok = (await ioAsk(io, rl, '\n确定删除? (y/N): ')).trim().toLowerCase();
        if (ok !== 'y') { console.log('已取消。'); return false; }
        const removed = logSink.keepLatestOnly(logDir);
        console.log(`✅ 已删除 ${removed} 个条目，logs/ 现只保留 latest.log`);
        logger.impt(`清理旧日志：log.disabled 模式删除 ${removed} 个条目`);
        return false;
    }

    const keep = parseInt((await ioAsk(io, rl, '保留最近几天的日志? (默认 7): ')).trim(), 10) || 7;
    const cutoff = Date.now() - keep * 24 * 3600 * 1000;

    let files = [];
    try { files = fs.readdirSync(logDir); } catch (e) { files = []; }

    const victims = [];
    let totalBytes = 0;
    for (const f of files) {
        if (f === 'latest.log') continue;   // MC 当前日志，绝不当旧日志清掉
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
 * 按功能键执行一个动作（**仅供外部 / 测试脚本直接调用**）。
 *
 * V3.7.4 扁平化后，TUI 与兼容模式都走 `dispatchMenuItem(id, …, {page})`，
 * 直接按「页键 + 顺号」查 `ACTION_BY_KEY`。本函数保留 `dispatchMenu(choice)`
 * 的旧调用姿势，把 `choice` 解释成**旧扁平菜单的语义键**，转调对应的具名动作，
 * 不再弹任何 `请选择 (0-N)` 子菜单（子菜单已全部拆除）。
 *
 * 认的键（兼容老脚本 / 老文档）：
 *   '1' 启动停止   '2' 新建方案   '3' 列出模组   '4' 模组搜索下载
 *   '5' 服务端属性 '6' 认证设置   '7' 下载镜像   '8' Java 设置
 *   '9' 安装整合包(本地) '10' 生成整合包 '11' AI 分析日志 '12' 状态监控
 *   '13' 列出主题  '14' 开房(陶瓦)
 *
 * @returns {Promise<boolean>} true = 调用方必须交出 stdin
 */
async function dispatchMenu(choice, options, rl, io = null) {
    const key = String(choice);
    const env = { options, io, rl: rl || null, ctx: null, page: '?' };

    switch (key) {
        case '1':  return actionStartStop(env);
        case '2':  return schemeCreate(env);
        case '3':  return modList(env);
        case '4':  return modInstall(env);
        case '5':  return propsListAll();
        case '6':  return authSettings(env);
        case '7':  return downloadSetting(env, 'mirror');
        case '8':  return javaSettingsEntry(env);
        case '9':  return packInstall(env, 'local');
        case '10': return packGenerate(env);
        case '11': return logAnalyze(env);
        case '12': return serverStatus(env);
        case '13': return themeAction(env, 'list');
        case '14': return terracottaHost(env);
        default:
            console.log(`未知菜单选项: ${choice}`);
            return false;
    }
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
    dispatchMenuItem,
    // 页面表（测试与外部工具可读）
    PAGES,
    PAGE_MAP,
    findPageOfItem,
    itemOfPage,
    idsOf,
    resolveNumber,
    // 页键 + 顺号 → 动作函数（测试用来验证「每项都有实现」）
    ACTION_BY_KEY,
    // 兼容旧接口
    createRL,
    ask,
    clearScreen,
    printHeader,
    javaSettingsFlow
};
