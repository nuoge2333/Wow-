/**
 * M 模式 TUI 核心模块（V3.6.3 / 609 指令）
 * ============================================================
 *
 * 职责边界（刻意做窄）：
 *   1. 判定当前终端能否进 TUI（`canUseTui`）；
 *   2. 接管键盘：唯一一个 readline 实例 + 无回车 `keypress` 监听（`createKeyboard`）；
 *   3. 画框：顶部状态栏 / 分隔线 / 功能区 / 底部导航（`StatusBar` + `draw`）；
 *   4. 暂停 / 恢复键盘（二级菜单让位）；
 *   5. 收集每页功能项的「实时状态」（服务器运行中 / 已装 Java / 当前方案）。
 *
 * **本模块不放任何菜单业务**——七页有哪些项、编号对应哪个功能，全部在
 * `interactive.js` 的 `PAGES` 里。这样「改功能」不用碰 TUI，「调样式」不用碰菜单。
 *
 * 三条硬约束（来自 609 指令）：
 *   ① 整个 TUI 只能有一个 readline 实例。二级菜单不新建 readline，而是
 *      `pause()` 掉 keypress 监听、把 stdin 交回字节流，复用同一个 rl 提问；
 *   ② 二级菜单必须临时卸载 keypress 监听并 `setRawMode(false)`，回车输入时
 *      绝不能让两个监听器抢键盘；
 *   ③ 唯一例外是「进 server start 的 :wow 视图 / 进 L 模式」——这两处必须
 *      彻底关掉 TUI 的 readline 交还 stdin（详见 interactive.js 的 jump 注释）。
 */

const readline = require('readline');
const pkg = require('../package.json');

// ==================== 常量 ====================

/** 界面宽度。
 *
 * 取 70 而不是 60：底部导航是七个 `[键]标签` 拼起来的，
 * `[Q]服务器 [W]方案 … [L]长命令` 加尾巴的 `[0]退出` 实测正好 70 列。
 * 早先用 60 时，分隔线只有 60 列、导航却有 70 列，框线短一截，
 * 80 列终端上看着像画歪了。70 既让框线和导航齐边，又不会在 80 列终端换行。 */
const WIDTH = 70;

/** 底部导航：按键 → 标签。数字键 0 单列，表示退出 */
const NAV_ITEMS = [
    ['Q', '服务器'],
    ['W', '方案'],
    ['E', '内容'],
    ['R', '网络'],
    ['T', '工具'],
    ['Y', '高级'],
    ['L', '长命令']
];

/** 页键与数字键的互斥性：页键只切页，数字键只在当前页执行功能。
 *  注意排除 L —— 它是「进入长命令模式」的模式开关，不是一页。 */
const PAGE_KEYS = new Set(NAV_ITEMS.map(([k]) => k).filter(k => k !== 'L'));

// ==================== 环境判定 ====================

/**
 * 能否使用 TUI 模式（raw 键盘，按键即时到达）。
 *
 * 必须同时满足：stdin 是 TTY 且能进 raw 模式。管道输入（`echo 1 | wow m`）、
 * CI、Docker 无 TTY 场景全部退回「数字 + 回车」的兼容模式，
 * 否则 `setRawMode` 抛错、`keypress` 永远不触发，用户会看到一个卡死的界面。
 */
function canUseTui() {
    const stdin = process.stdin;
    if (!stdin || !stdin.isTTY) return false;
    if (typeof stdin.setRawMode !== 'function') return false;
    if (process.env.WOW_NO_TUI === '1' || process.env.WOW_NO_TUI === 'true') return false;
    // 宽字符（中文）在 Windows 老版 conhost 会把框线顶歪，但仍可用；
    // 只在明确要求时降级（WOW_TUI_ASCII=1 → 反手交给调用方决定用不用框线）
    return true;
}

// ==================== 框线字符 ====================

/**
 * 框线字符集。Windows 传统 cmd（非 Windows Terminal）默认代码页 936 下
 * 能正确显示 ─ │ ═，但某些字体对 ┌ ┐ 支持不佳；这里统一只用横线与竖线，
 * 不用拐角，视觉上是一组分段的横条，兼容性最好。
 */
const CH = {
    heavy: '═',
    light: '─',
    dot: '·'
};

const ANSI = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    reverse: '\x1b[7m'
};

/**
 * 是否输出颜色。`NO_COLOR` / `WOW_NO_COLOR` 环境变量可关闭；
 * 非 TTY（重定向到文件）也自动关闭，避免日志里塞满转义序列。
 */
function useColor() {
    if (process.env.NO_COLOR || process.env.WOW_NO_COLOR) return false;
    return Boolean(process.stdout.isTTY);
}

/** 按开关着色 */
function paint(text, color) {
    if (!color || !useColor()) return text;
    const code = ANSI[color];
    return code ? `${code}${text}${ANSI.reset}` : text;
}

/**
 * 计算显示宽度：CJK / 全角字符占 2 列。
 * 只用于「左侧标签 + 右侧状态」的对齐，不做完整的 wcwidth 实现。
 */
function dispWidth(str) {
    let w = 0;
    for (const ch of String(str)) {
        const c = ch.codePointAt(0);
        if (
            (c >= 0x1100 && c <= 0x115F) ||
            (c >= 0x2E80 && c <= 0xA4CF) ||
            (c >= 0xAC00 && c <= 0xD7A3) ||
            (c >= 0xF900 && c <= 0xFAFF) ||
            (c >= 0xFE30 && c <= 0xFE6F) ||
            (c >= 0xFF00 && c <= 0xFF60) ||
            (c >= 0xFFE0 && c <= 0xFFE6) ||
            (c >= 0x1F300 && c <= 0x1F64F) ||
            (c >= 0x1F900 && c <= 0x1F9FF)
        ) w += 2;
        else w += 1;
    }
    return w;
}

/** 右侧补齐到指定显示宽度 */
function padRight(str, width) {
    const pad = width - dispWidth(str);
    return pad > 0 ? str + ' '.repeat(pad) : str;
}

/**
 * 按显示宽度截断（超宽时以 `…` 收尾）。
 *
 * 只给「标签 + 旧编号小注 + 备注」这一行用：三者加起来可能超过 70 列，
 * 与其让终端折行把版面弄乱，不如把最长的那个标签截掉尾巴——
 * 编号列永远完整，用户敲的数字始终看得见。
 */
function fit(str, width) {
    const s = String(str);
    if (dispWidth(s) <= width) return s;
    let out = '';
    let w = 0;
    for (const ch of s) {
        const cw = dispWidth(ch);
        if (w + cw > width - 1) break;
        out += ch;
        w += cw;
    }
    return out + '…';
}

// ==================== 输出 ====================

let lastRenderHeight = 0;

/** 清屏（与 interactive.clearScreen 行为一致：整屏 + 归位） */
function clear() {
    process.stdout.write('\x1Bc');
    lastRenderHeight = 0;
}

/**
 * 光标归位重绘（不清屏的局部刷新）。
 *
 * 状态栏要「每次回到 TUI 都刷新一次」，但如果用户刚执行完一个功能、
 * 屏幕上还留着输出，直接清屏会把它抹掉。这里用「上移 N 行 + 逐行擦除」
 * 只重画状态栏那几行，功能区的输出保持不动。
 */
function redrawTop() {
    if (lastRenderHeight <= 0) return;
    let out = '';
    out += `\x1b[${lastRenderHeight}A`;   // 上移到起点
    out += '\x1b[0J';                     // 擦掉从这里到屏幕末尾
    process.stdout.write(out);
}

/** 输出一行 */
function line(text = '') {
    process.stdout.write(text + '\n');
}

/** 输出一条分隔线 */
function rule(char = CH.light) {
    line(paint(char.repeat(WIDTH), 'gray'));
}

// ==================== 状态栏 ====================

/**
 * 状态栏数据采集器。
 *
 * 所有取数都包在 try/catch 里——M 模式是入口，任何一个管理器抛错都不能
 * 让用户看到一个白屏。取不到的字段降级成「(未知)」而不是消失，
 * 这样状态栏的行数永远是固定的 3 行，`redrawTop()` 的光标位移才不会错位。
 */
class StatusBar {
    /**
     * @param {object} options buildMenuOptions() 的结果
     */
    constructor(options = {}) {
        this.options = options;
        this._cache = null;
        this._cacheAt = 0;
    }

    /**
     * 采集一次原始数据。
     * @param {boolean} force 忽略缓存（切换方案、启停服务器后必须强刷）
     */
    collect(force = false) {
        const now = Date.now();
        // 300ms 缓存：方向键连按时不会每秒 fork 两次 java -version
        if (!force && this._cache && now - this._cacheAt < 300) return this._cache;

        const { serverManager, schemeManager, config, utils } = this.options;
        const data = {
            version: pkg.version,
            running: false,
            pid: null,
            scheme: null,
            javaInstalled: [],
            javaCurrent: null,
            javaManual: false
        };

        try {
            if (serverManager && typeof serverManager.isRunning === 'function') {
                data.running = Boolean(serverManager.isRunning());
                if (data.running) {
                    const info = serverManager.getInfo ? serverManager.getInfo() : null;
                    data.pid = info && info.pid ? info.pid : null;
                }
            }
        } catch (e) { /* 状态未知按已停止显示 */ }

        try {
            const s = schemeManager && (schemeManager.currentScheme
                || (typeof schemeManager._getCurrentScheme === 'function' ? schemeManager._getCurrentScheme() : null));
            data.scheme = s || null;
            if (!data.scheme && config) data.scheme = config.getConfig('server.scheme', null) || null;
        } catch (e) { /* 忽略 */ }

        try {
            if (utils && typeof utils.scanAllJava === 'function') {
                const all = utils.scanAllJava() || [];
                data.javaInstalled = [...new Set(all.map(j => j.major).filter(m => m != null))].sort((a, b) => a - b);
            }
        } catch (e) { /* 忽略 */ }

        try {
            const configured = config ? config.getConfig('server.java', null) : null;
            data.javaManual = Boolean(configured);
            if (configured) data.javaCurrent = configured;
            else if (utils && typeof utils.detectJava === 'function') data.javaCurrent = utils.detectJava();
        } catch (e) { /* 忽略 */ }

        this._cache = data;
        this._cacheAt = now;
        return data;
    }

    /** 失效缓存（动作执行后调用，保证回到 TUI 时看到的是新状态） */
    invalidate() {
        this._cache = null;
        this._cacheAt = 0;
    }

    /**
     * 渲染状态栏的固定 4 行（含上下两条重线，共 6 个物理行）。
     * 行数与内容长度无关，永远是这么多 —— `redrawTop()` 依赖这个不变量。
     */
    render(page, pageLabel) {
        const d = this.collect();

        // 第 1 行：标题 + 版本 + 当前页
        const title = `wow~ Minecraft 服务器管理器`;
        const right = `V${d.version}　[${page}] ${pageLabel || ''}`.trim();
        const gap = Math.max(2, WIDTH - 2 - dispWidth(title) - dispWidth(right));
        line(paint(CH.heavy.repeat(WIDTH), 'gray'));
        line(`  ${paint(title, 'bold')}${' '.repeat(gap)}${paint(right, 'cyan')}`);

        // 第 2 行：服务器 / 方案
        const state = d.running
            ? paint('🟢 运行中', 'green') + (d.pid ? paint(` (PID ${d.pid})`, 'gray') : '')
            : paint('⚫ 已停止', 'gray');
        const scheme = d.scheme ? paint(d.scheme, 'yellow') : paint('(未指定)', 'gray');
        line(`  服务器: ${state}　　${paint('方案:', 'dim')} ${scheme}`);

        // 第 3 行：Java
        const installed = d.javaInstalled.length
            ? d.javaInstalled.map(m => `Java ${m}`).join(', ')
            : '（未检测到）';
        let cur = d.javaCurrent || '（未匹配）';
        if (d.javaCurrent && d.javaCurrent.length > 34) {
            // 长路径只显示尾部，保证 3 行不变
            cur = '…' + d.javaCurrent.slice(-33);
        }
        line(`  ${paint('已装 Java:', 'dim')} ${installed}`);
        line(`  ${paint('当前 Java:', 'dim')} ${cur}${d.javaManual ? paint('（手动指定）', 'gray') : ''}`);

        line(paint(CH.heavy.repeat(WIDTH), 'gray'));
        // 记下本块行数：上重线 + 标题 + 服务器 + 已装 Java + 当前 Java + 下重线 = 6 行，
        // 供 redrawTop 用。少记一行会让「上移」欠一行，屏幕上残留一条旧状态栏。
        lastRenderHeight = 6;
    }
}

// ==================== 绘制 ====================

/**
 * 画一页。
 *
 * 布局（从上到下）：
 *   ══════════════════════════════════════════   ← 状态栏顶
 *     wow~ ... V3.7.2-26.45        [Q] 服务器
 *     服务器: ⚫ 已停止    方案: xxx
 *     已装 Java: ...
 *     当前 Java: ...
 *   ══════════════════════════════════════════   ← 状态栏底
 *     ── 本页标题 ──
 *     1. xxx                         状态
 *     ...
 *   ──────────────────────────────────────────
 *    [Q]服务器 [W]方案 ... [0]退出
 *   提示: 输入编号后回车执行 · Q/W/E/R/T/Y 切页 · L 长命令 · 0 退出
 *
 * @param {object} ctx
 * @param {string} ctx.page       当前页键
 * @param {object} ctx.def        页定义 { key, label, title, items }
 * @param {StatusBar} ctx.status  状态栏实例
 * @param {string} [ctx.notice]   一次性提示（上个动作的尾巴，重绘后清空）
 * @param {string} [ctx.input]    正在输入的编号（非空时占据提示行）
 * @param {boolean} [ctx.plain]   true = 不用清屏，直接追加（兼容模式用）
 */
function drawPage(ctx) {
    const { page, def, status, notice, input, plain } = ctx;
    if (!plain) clear();
    status.render(page, def.label);

    line('');
    line(`  ${paint(CH.light.repeat(2) + ' ' + def.title + ' ', 'bold')}`);

    // 功能项：编号 + 标签 + 右对齐的状态备注
    //
    // 编号列宽按**本页最长的编号**取（至少 2 位）。早先固定 padStart(2)，
    // R 页出现 141/142/143 时标签整体右移一格，与其他行对不齐。
    const items = def.items || [];
    const idWidth = Math.max(2, ...items.map(it => String(it.id).length));
    const labelWidth = Math.max(0, ...items.map(it => dispWidth(it.label))) + 2;
    // 旧编号小注：`旧 22`。只在对本页序号有歧义时显示（老用户靠它找旧习惯），
    // 且**不占编号列**——编号列永远只有界面上那套 1 2 3 4 5。
    const legacyTags = items.map(it => {
        const legacy = Array.isArray(it.legacy) ? it.legacy.map(String) : [];
        return legacy.length ? `旧 ${legacy.join('/')}` : '';
    });
    const tagWidth = Math.max(0, ...legacyTags.map(t => dispWidth(t)));
    // 备注列宽：本页实际最长的一条（会被下面的列预算再压一次）。
    // 早先这里还夹了一个「建议上限」，结果 13 字的备注被截成 `PCL/HMC…`，
    // 而 70 列其实放得下——真正需要截断的判断只在列预算里做。
    const hintWidth = Math.max(0, ...items.map(it => (it.hint ? dispWidth(String(it.hint)) : 0)));
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const num = paint(String(it.id).padStart(idWidth), 'cyan');
        // 标签列按「本页最长标签」排；但标签 + 旧编号小注 + 备注加起来
        // 可能超过 70 列（网络页第一项标签就有 18 字），超了就等比压两列：
        // 先压标签（截断加 …），不够再压备注。编号列永远完整。
        //
        // 右边距留 1 格：正好贴到 70 列时有些终端会在最后一列自动换行。
        const tagReserve = tagWidth ? tagWidth + 2 : 0;
        const budget = WIDTH - 1 - 4 - idWidth - 2 - tagReserve;
        let labelCol = Math.min(labelWidth, budget);
        // 标签列不低于 10 格（`变更配置 (se…`），否则名字短到认不出，
        // 剩下的空间让备注去截
        const labelFloor = Math.min(labelWidth, 10);
        let hintCol = hintWidth;
        if (labelCol + hintCol > budget) {
            labelCol = Math.max(labelFloor, budget - hintCol);
            hintCol = Math.max(0, budget - labelCol);
        }
        const label = padRight(fit(it.label, labelCol - 2), labelCol);
        const tag = legacyTags[i]
            ? paint(padRight(legacyTags[i], tagWidth), 'dim') + '  '
            : (tagWidth ? ' '.repeat(tagWidth + 2) : '');
        const hint = it.hint ? paint(fit(String(it.hint), hintCol), 'gray') : '';
        line(`  ${num}. ${label}${tag}${hint}`);
    }

    line('');
    rule();

    // 底部导航：当前页反白，其他页暗色
    const nav = NAV_ITEMS.map(([k, label]) => {
        const text = `[${k}]${label}`;
        return k === page ? paint(text, 'reverse') : paint(text, 'dim');
    }).join(' ');
    line('  ' + nav + '  ' + paint('[0]退出', 'dim'));
    // 提示行：没在输入编号时显示操作提示；正在输入时让位给输入回显，
    // 否则用户敲了 `2` 屏幕上看不见，得靠猜。
    if (input) {
        line('  ' + paint('编号: ', 'gray') + paint(String(input), 'cyan')
            + paint('▏', 'cyan') + paint('　回车执行 · Backspace 删除', 'gray'));
    } else {
        line('  ' + paint('输入编号后回车执行　Q/W/E/R/T/Y 切页　L 长命令　0 退出', 'gray'));
    }

    if (notice) {
        line('');
        for (const l of String(notice).split('\n')) line('  ' + paint(l, 'yellow'));
    }
}

// ==================== 键盘 ====================

/**
 * 创建 TUI 键盘接管器。
 *
 * **单 readline 的实现方式（V3.6.3 实测修正）**
 * ------------------------------------------------------------
 * 最初的设计是「一个 rl 全程复用，二级菜单只 `pause()` 它」——实测不行：
 *   - `rl.pause()` 之后 `rl.question()` 收不到任何输入（stdin 仍在 raw 模式，
 *     字符被 keypress 派发而不是组装成行）；
 *   - 反过来只卸 `keypress` 监听、不 pause，`question()` 能读到行，但**触发键
 *     会被 readline 的内部缓冲重复插入**（按 `2` 进二级菜单，问题里先出现一个
 *     多余的 `2`，用户再打字就成了 `2create`）。
 *
 * 所以我们采用「同一时刻只有一个消费者」而不是「同一个对象反复复用」：
 *   - TUI 态：本函数创建的 `rl` 是唯一消费者，负责 raw 模式与 keypress；
 *   - 二级菜单态：`suspend()` 彻底 `close()` 掉它 + `setRawMode(false)`，
 *     再把 stdin 交给调用方临时建的行读取器；
 *   - 回到 TUI：`reactivate()` 用完全相同的参数重建 `rl`。
 *
 * 关键是**任一时刻 stdin 上只有一个 readline / 一个 keypress 监听**，
 * 这正是约束②（绝不能两个监听器抢键盘）要求的，只是实现手段比「挂着不动」
 * 更彻底——顺便解决了上面两个 readline 内部状态的坑。
 *
 * @param {object} handlers
 * @param {(key: string) => void} handlers.onKey 收到一个按键（已大写）
 * @param {() => void} [handlers.onInterrupt]     Ctrl+C（TUI 态）
 * @param {() => void} [handlers.onEof]           stdin 关闭
 */
function createKeyboard(handlers = {}) {
    const stdin = process.stdin;
    const stdout = process.stdout;

    let rl = null;
    let suspended = false;    // true = 键盘交给了二级菜单
    let closed = false;       // true = 整个 TUI 结束，不再重建

    /**
     * 一次 Ctrl+C 会被**两条路径**各报告一次：
     *   1. 我们挂在 stdin 上的 `keypress`（本文件）；
     *   2. readline 内部把 ctrl-c 转成 rl 的 `SIGINT` 事件（activate 里监听了）。
     *
     * 两条都调 onInterrupt 的话，第二次会看到 `pendingConfirmExit === true`
     * 而直接 `process.exit(0)`——用户按一下 Ctrl+C，确认框刚画出来程序就没了。
     * 这里做 80ms 去重：人手不可能在 80ms 内按两次 Ctrl+C，
     * 而两条路径的先后顺序不确定，用时间窗比用标志位更稳。
     */
    let lastInterruptAt = 0;
    const fireInterrupt = () => {
        const now = Date.now();
        if (now - lastInterruptAt < 80) return;
        lastInterruptAt = now;
        if (typeof handlers.onInterrupt === 'function') handlers.onInterrupt();
    };

    // 判断 stdin 是否真的连着终端。管道 / cron / Docker 里 resume() 后
    // 不能再建「terminal: true」的 readline——那会把流水线输入当行编辑处理，
    // 行为与兼容模式不一致。
    const stdinIsTty = () => {
        try { return Boolean(stdin.isTTY); } catch (e) { return false; }
    };

    const mkRl = () => readline.createInterface({
        input: stdin,
        output: stdout,
        terminal: stdinIsTty(),
        // 不让 readline 自己缓存历史行——TUI 的输入是一键一动作
        historySize: 0,
        // TUI 不要「行编辑器」的自动补全 / 历史兜底
        completer: undefined
    });

    const onKeypress = (str, key) => {
        if (suspended || closed) return;
        const k = key || {};

        // Ctrl+C / Ctrl+D：交给上层决定（TUI 里是「确认退出」）
        if (k.ctrl && (k.name === 'c' || k.name === 'd')) {
            fireInterrupt();
            return;
        }
        // 退格：交给上层删一位（编号输入用）。其余方向键 / 功能键 TUI 不用，
        // 直接吞掉，避免转义序列污染屏幕。
        if (k.name && /^backspace$/i.test(k.name)) {
            if (typeof handlers.onKey === 'function') handlers.onKey('BACKSPACE');
            return;
        }
        if (k.name && /^(up|down|left|right|home|end|pageup|pagedown|delete|insert|tab|escape)$/i.test(k.name)) {
            return;
        }
        if (!k.sequence && !str) return;
        // 回车：上层用它提交编号输入（空缓冲时等同刷新）
        if (k.name && /^(return|enter)$/i.test(k.name)) {
            if (typeof handlers.onKey === 'function') handlers.onKey('RETURN');
            return;
        }
        const raw = str || '';
        if (!raw) return;
        // 多字节（中文输入法上屏）：TUI 只认单键
        if ([...raw].length !== 1) return;
        const ch = raw.toUpperCase();
        if (typeof handlers.onKey === 'function') handlers.onKey(ch);
    };

    /** 建立（或重建）TUI 态的 readline 与监听 */
    const activate = () => {
        if (closed) return null;
        rl = mkRl();
        rl.setPrompt('');
        readline.emitKeypressEvents(stdin, rl);
        const tty = stdinIsTty();
        // 只有真终端才有 raw 模式。非 TTY 下强行 setRawMode 会抛错（已吞），
        // 但更重要的是：**必须把流重新 resume 起来**，否则经过 askLine
        // （它建了临时 readline、关掉后把 stdin 停在 paused）之后，
        // keypress 再也收不到字节——表现为「回到界面后要按两次回车」。
        if (tty) {
            try { stdin.setRawMode(true); } catch (e) { /* 非 TTY */ }
        }
        stdin.on('keypress', onKeypress);
        try { rl.resume(); } catch (e) { /* 忽略 */ }
        // 非 TTY（或是 raw 模式没生效的情况）：readline 自己不会去读流，
        // 这里显式开流，保证按键能到达 keypress
        if (!tty) {
            try { stdin.resume(); } catch (e) { /* 忽略 */ }
        }
        rl.on('SIGINT', () => {
            fireInterrupt();
        });
        rl.on('close', () => {
            // 只有「非我方主动关闭」才算 EOF（suspend 时是我们自己 close 的）
            if (closed || suspended) return;
            closed = true;
            stdin.removeListener('keypress', onKeypress);
            try { stdin.setRawMode(false); } catch (e) { /* 忽略 */ }
            if (typeof handlers.onEof === 'function') handlers.onEof();
        });
        return rl;
    };

    activate();

    return {
        /** 当前 TUI 态的 rl（suspend 期间为 null） */
        get rl() { return rl; },

        /** 是否处于暂停（二级菜单接管键盘中） */
        get suspended() { return suspended; },
        get closed() { return closed; },

        /**
         * 交出键盘：销毁 TUI 的 readline，退出 raw 模式。
         *
         * **顺序很关键**（实测）：必须**先 close rl、再卸 keypress 监听**。
         * 反过来的话，rl.close() 那一刻 stdin 还在 raw 模式，终端会把之后
         * 用户敲的第一个字符再回显一次，二级菜单的输入就变成 `11` / `33`。
         *
         * **异步等待也关键**：`setRawMode(false)` 是同步改 termios 的，但
         * **当前正在处理的那次 read 已经把字节读进事件循环**了。如果紧接着
         * 同步建新 readline，那个字节会先被终端的行模式回显一次、再被新
         * readline 收一次。所以这里返回一个 Promise，调用方 `await` 它，
         * 让出一轮事件循环再提问。
         */
        suspend() {
            if (suspended || closed) return Promise.resolve();
            suspended = true;
            const old = rl;
            rl = null;
            if (old) {
                try { old.close(); } catch (e) { /* 已关闭 */ }
            }
            stdin.removeListener('keypress', onKeypress);

            // **排空 stdin 的残留字节**。
            //
            // raw 模式下按键即时到达，用户在回车之后很可能又敲了一两个键，
            // 字节还留在内核缓冲里没被读走。如果不管它，二级菜单的第一次
            // question 会先把它吃掉（表现为「要切换到的方案名: 2」）。
            //
            // 这里把已到达的字节读干净：用户敲的是「当前这一屏的动作」，
            // 二级菜单的输入应该从用户看到新画面之后的按键算起。
            try {
                while (stdin.readableLength > 0) {
                    const drained = stdin.read();
                    if (!drained) break;
                }
            } catch (e) { /* 忽略 */ }

            try { if (stdin.isRaw) stdin.setRawMode(false); } catch (e) { /* 非 TTY */ }
            // raw 模式下终端已经把触发键回显在屏幕上了（内核 tty 层行为，
            // 应用层拦不住）。清一次屏把它擦掉，二级菜单从干净画面开始。
            clear();
            return new Promise(r => setImmediate(r));
        },

        /** 收回键盘：重建 readline，重进 raw 模式 */
        resume() {
            if (closed || !suspended) return;
            suspended = false;
            // 排空残留（用户连按回车 / 打字时的余键），避免一回到 TUI 就
            // 触发下一个功能，让人以为「自己乱跳页」
            try {
                while (stdin.readableLength > 0) {
                    const drained = stdin.read();
                    if (!drained) break;
                }
            } catch (e) { /* 忽略 */ }
            // 顺序说明：activate() 内部负责在 TTY 下进 raw 模式、
            // 重新挂 keypress 监听。这里不要提前改终端模式。
            activate();
            // readline 在 resume 时会打一次提示符，TUI 不需要，擦掉这一行
            try {
                readline.clearLine(stdout, 0);
                readline.cursorTo(stdout, 0);
            } catch (e) { /* 忽略 */ }
        },

        /** 彻底关闭：恢复终端模式，卸载监听（交给下一步的 console 用） */
        close() {
            if (closed) return;
            closed = true;
            suspended = false;
            stdin.removeListener('keypress', onKeypress);
            try { stdin.setRawMode(false); } catch (e) { /* 忽略 */ }
            const old = rl;
            rl = null;
            if (old) {
                try { old.close(); } catch (e) { /* 已关闭 */ }
            }
            try {
                readline.clearLine(stdout, 0);
                readline.cursorTo(stdout, 0);
            } catch (e) { /* 忽略 */ }
        }
    };
}

// ==================== 兼容模式（无 TTY） ====================

/**
 * 用「临时行读取器」问一行。
 *
 * 两个反直觉的点（都是实测踩出来的）：
 *
 * 1. **`terminal: false`**：TUI 的 rl 处于 raw 模式时，终端（内核 tty 层）
 *    已经把按键回显在屏幕上了；再让新 readline 也做一遍行编辑回显，用户
 *    就会看到 `11` / `33` 这种双字符。置 `terminal: false` 后 readline
 *    不自己回显、也不做光标移动，只负责把整行读出来——回显交给终端的
 *    行模式，正好一次。
 *
 * 2. **不能用 `rl.question()` 复用 TUI 的 rl**：raw 模式下 question 收不到
 *    输入，而且触发键会残留在内部缓冲里被重复插入（按 2 进菜单，问题里
 *    先出现一个 2）。所以这里始终新建一个干净的行读取器，问完立刻关掉。
 *
 * @param {string} prompt 提示符
 * @param {object} [handlers] { onInterrupt }
 */
function askLine(prompt = '', handlers = {}) {
    return new Promise(resolve => {
        const stdin = process.stdin;
        const stdout = process.stdout;

        // 防御：如果 stdin 还在 raw 模式，先退出来，否则读不到整行
        try { if (stdin.isRaw && stdin.setRawMode) stdin.setRawMode(false); } catch (e) { /* 忽略 */ }

        // **必须显式 resume**。
        //
        // 走到这里时 stdin 经常是 paused 的：调用方在离开上一个 readline
        // 之后（或我们自己在上一次 askLine 收尾时）会把流停住。paused 的
        // 流不会触发 data，新建的 readline 也就永远等不到那一行——
        // 现象是「按回车没反应，得再按一次」，因为第二次按的时候流已经
        // 被上一次的残留事件顺带唤醒。
        try { stdin.resume(); } catch (e) { /* 忽略 */ }

        let rl = null;
        try {
            rl = readline.createInterface({
                input: stdin,
                output: stdout,
                terminal: false
            });
        } catch (e) {
            return resolve('');
        }

        let settled = false;
        // stdin 被关掉（Ctrl+D / 终端断开 / 父进程收走管道）时，`rl.question`
        // 的回调永远不会来，Promise 就永久挂着——整个 TUI 卡死在「按回车键返回...」。
        // 用函数声明（提升）避免与 fin 的相互引用踩到 TDZ。
        function onEnd() { fin(''); }
        const fin = (v) => {
            if (settled) return;
            settled = true;
            try { stdin.removeListener('end', onEnd); } catch (e) { /* 忽略 */ }
            // 回显交给终端行模式（terminal:false 下 readline 不自己回显），
            // 用户按的那一下回车没有换行，这里补一个，后续输出才不接到提示符后面。
            try { stdout.write('\n'); } catch (e) { /* 忽略 */ }
            try { rl.close(); } catch (e) { /* 忽略 */ }
            resolve(String(v == null ? '' : v));
        };
        try { stdin.once('end', onEnd); } catch (e) { /* 忽略 */ }

        const onSigint = () => {
            if (typeof handlers.onInterrupt === 'function') handlers.onInterrupt();
            fin('');
        };
        try { rl.on('SIGINT', onSigint); } catch (e) { /* 忽略 */ }

        try {
            stdout.write(prompt);
        } catch (e) { /* 忽略 */ }

        try {
            rl.question('', ans => fin(ans));
        } catch (e) {
            fin('');
        }
    });
}

// ==================== 屏幕占用闸门 ====================

/**
 * TUI 是否正占着终端画面。
 *
 * 为什么需要它：服务器日志有两条会自己往终端写的路——
 *   1. `server.js` 的 MC stdout 回显（原本按 `_mode === 'mc'` 挡）；
 *   2. L 模式 REPL 的日志跟踪定时器（每 500ms 打一批）。
 * 两者都是「按控制台视图」判断的，一旦有别的入口把 TUI 叫起来（比如
 * `server start` 的控制台里敲 `:wow`），判断就和画面脱节——日志会从
 * 菜单底下往外顶，把七页界面冲得没法看。
 *
 * 所以再加一道与业务无关的闸门：**TUI 画出第一帧到退出为止，任何外部
 * 日志都不许写终端**。调用方只在两处问它：server.js 的回显、cli.js 的
 * 跟踪打印。它们被挡住不影响日志落盘，退出后 `:mc` / 菜单 5 照样能看。
 */
let screenActive = false;

/** 进 / 出 TUI 时调用（runTuiMode 负责置位与复位） */
function markScreenActive(on) {
    screenActive = Boolean(on);
}

/** 供日志生产者判断：true = 别往终端写，会把菜单冲掉 */
function isScreenActive() {
    return screenActive;
}

module.exports = {
    WIDTH,
    NAV_ITEMS,
    PAGE_KEYS,
    CH,
    ANSI,
    canUseTui,
    useColor,
    paint,
    dispWidth,
    padRight,
    clear,
    redrawTop,
    line,
    rule,
    StatusBar,
    drawPage,
    createKeyboard,
    askLine,
    markScreenActive,
    isScreenActive,
    getLastRenderHeight: () => lastRenderHeight
};
