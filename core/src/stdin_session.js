/**
 * stdin 单一消费者 —— 全项目**唯一**的 readline 管理者
 *
 * ## 为什么需要这个文件
 *
 * Node 的 `readline.createInterface({ input: process.stdin })` 每调用一次，
 * 就给 `process.stdin` 挂一个 `data` 监听器。两个 readline 同时活着时：
 *
 *   - 每个字符被读两遍 → 用户输入 `badapple`，命令收到 `bbaaddaappppllee`；
 *   - 两个消费者各自把整行当成自己的输入 → REPL 把方案名当指令执行，
 *     报「❌ 未知指令: asdf」；
 *   - 谁先读到不可预测，命令行参数、密码、确认框全都可能拿到残缺值。
 *
 * 这类 bug 在终端里表现为「输入重复」「按一次键触发两次」「答非所问」，
 * 极难从代码上看出——因为**创建点分散在十几个文件里，各自都觉得自己
 * 是唯一的那一个**。
 *
 * ## 「无论什么情况下都只有一个」靠三层防线
 *
 * 1. **唯一出口**：全项目只有本文件的 `makeRl()` 会调
 *    `readline.createInterface({ input: process.stdin })`，其余模块一律
 *    「租用」lease。静态守卫（`test/stdin_session.test.js`）会扫描 src/
 *    确认没有第二处。
 * 2. **运行时不变式**：`liveRl` 记录当前真实存活的实例。`makeRl()` 见到
 *    它非 null 就直接抛错；`release()` 与 `acquireSync()` 走同一个幂等的
 *    `teardown()`，保证实例与计数同步归零。
 * 3. **全局创建守卫**：模块加载时把 `readline.createInterface` 包一层。
 *    任何绕过单例、且同样以 `process.stdin` 为输入的调用（第三方库、
 *    动态 require、以后新加的代码）：
 *      - 已有活跃实例 → **抛错拒绝**，第二个 readline 根本造不出来；
 *      - 尚无活跃实例 → 放行，但记进 `violations()` 并告警。
 *
 * 换句话说，不靠调用方自觉：违规代码会立刻失败并留下调用栈。
 * 非 stdin 的 readline（例如逐行读文件）不受约束，它不消费 stdin，
 * 不会造成双读。
 *
 * ## 关于 stdin 上偶尔数到 2 个 `data` 监听器
 *
 * 在真 TTY 下，`terminal: true` 的 readline 会让 Node 调
 * `readline.emitKeypressEvents(stream, rl)`，后者往 stdin 挂一个名为
 * `onData` 的按键解码器。这个监听器是**幂等且常驻**的：
 * `rl.close()` 不会移除它，Node 也不会重复挂第二个。
 * 于是当下一个租约是 `terminal: false`（行读取器，挂 `ondata`）时，
 * stdin 上会同时出现 `onData` + `ondata` 两个 data 监听器。
 *
 * 这不是第二个 readline：`live` 仍为 1，`peak` 仍为 1。残留的 `onData`
 * 只把字节解码成 `keypress` 事件，而 TUI 挂起时已卸载自己的 keypress
 * 监听，所以它不会造成双读 / 按一次触发两次。用 `stats().keypressDecoder`
 * 可以观察它是否存在；关键是它**不会随重建次数累积**（重建 30 轮仍 ≤ 2）。
 * 这也是本项目不去动 Node 私有幂等标记的原因——清掉它换来的「1 个」，
 * 代价是依赖 Node 内部实现、升级后可能让新 readline 收不到输入。
 *
 * ## 租约设计
 *
 * ```js
 * const stdin = require('./stdin_session');
 *
 * // 1) 长期持有（REPL、TUI 键盘、开服控制台）
 * const lease = await stdin.claim('repl', { terminal: true, prompt: 'wow> ' });
 * lease.rl               // 真正干活的 readline
 * lease.enableKeypress() // TUI 专用：挂 keypress 派发器
 * lease.pause()          // 暂不处理输入，但仍是 owner
 * lease.resume()
 * await lease.release()  // 交还，下一位才能拿到
 *
 * // 2) 临时问一行（命令内部的确认框、密码）：自动排队 + 自动归还
 * const answer = await stdin.ask('继续吗？[y/N] ');
 * ```
 *
 * 关键约束：**同一时刻只有一个 lease 处于 active 状态**。后来的 `claim()`
 * 会排队等待前一个 `release()`，而不是抢进来再造一个 readline。
 * 这样即使调用方写错（忘记借用、多层嵌套），也只会「等」，不会「双读」。
 *
 * ## 为什么不直接改调用方
 *
 * 调用方有十几种姿势（有的传 existingRl、有的判 TTY、有的在 TUI 里判 borrowed）。
 * 逐个修补只要漏一处就复现，而且新代码很容易再引入一处。把「唯一性」下沉到
 * 一个地方集中保证，调用方即使写得随意也不会出双读。
 */

const readline = require('readline');

/** 当前持有 stdin 的租约（null = 无人持有） */
let current = null;
/** 等待中的请求队列，按 FIFO 放行 */
const waiters = [];

/** 当前**真实存活**的 readline 实例 —— 运行时不变式的依据 */
let liveRl = null;
let liveOwner = null;
/** 已归还/已被接管的租约（防止 release 被重复调用把计数减穿） */
let retired = new WeakSet();

/** 当前活跃实例数（release 会减一，所以恒为 0 或 1） */
let createdCount = 0;
/** 历史累计创建次数（只增不减，用于诊断「反复重建」） */
let totalCreated = 0;
/** 活跃实例数历史峰值（正常情况下恒为 1） */
let peakCount = 0;

/** 绕过单例的调用栈记录 */
const violationSites = [];
/** 只有 makeRl() 内部才置 true，守卫据此放行 */
let insideFactory = false;

// ==================== 第三层：全局创建守卫 ====================

const nativeCreateInterface = readline.createInterface;

/**
 * 包住 `readline.createInterface`：
 *   - 本模块 makeRl() 内部调用 → 放行；
 *   - 其它代码以 process.stdin 为输入调用 → 已有实例时抛错、否则记录告警。
 *
 * 为什么值得改全局导出：静态扫描只能管住仓库里已有的代码，管不住
 * 第三方依赖、动态 require、以及以后新加的一行。守卫让「第二个」在
 * 运行时直接造不出来，而不是靠大家记得走单例。
 */
readline.createInterface = function guardedCreateInterface(...args) {
    if (!insideFactory) {
        const opts = args[0] || {};
        if (opts.input === process.stdin) {
            const site = (new Error().stack || '')
                .split('\n').slice(2, 5).map(s => s.trim()).join(' ← ');
            violationSites.push(site);
            if (liveRl) {
                throw new Error(
                    `[stdin_session] 拒绝创建第二个 readline：当前「${liveOwner}」正持有 stdin。\n` +
                    `绕过位置：${site}\n` +
                    `请改用 stdinSession.claim() / ask() / acquireSync() 租用。`
                );
            }
            console.warn(
                `⚠️ [stdin_session] 有代码绕过单例直接创建 stdin readline` +
                `（当前无活跃实例，已放行并记录）：${site}`
            );
        }
    }
    return nativeCreateInterface.apply(this, args);
};

/** 让出一个事件循环，等 stdin 真正回到干净状态 */
const yieldLoop = () => new Promise(r => setImmediate(r));

/**
 * 创建 readline 的统一出口（全项目唯一）。
 *
 * 与直接调 `readline.createInterface` 的区别：更新计数、维护 `liveRl`，
 * 并在不变式被破坏时直接抛错而不是静默双开。
 *
 * 注：导出只为测试/诊断，业务代码应通过 claim/ask 租用，不要直接调用。
 *
 * @param {object} options
 * @param {boolean} [options.terminal] 是否启用行编辑（TUI 按键模式要 false）
 * @param {number}  [options.historySize]
 * @param {string}  [options.prompt]
 * @param {string}  [options.__owner] 内部用：持有者名字，便于报错定位
 * @returns {import('readline').Interface}
 */
function makeRl(options = {}) {
    if (liveRl) {
        throw new Error(
            `[stdin_session] 不变式被破坏：创建「${options.__owner || '?'}」时，` +
            `「${liveOwner}」的 readline 仍存活。同一进程只允许一个 readline。`
        );
    }
    let rl;
    insideFactory = true;
    try {
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: options.terminal !== undefined ? options.terminal : Boolean(process.stdin.isTTY),
            historySize: options.historySize !== undefined ? options.historySize : 0,
            completer: options.completer,
            prompt: options.prompt || ''
        });
    } finally {
        insideFactory = false;
    }
    liveRl = rl;
    liveOwner = options.__owner || 'unknown';
    createdCount++;
    totalCreated++;
    if (createdCount > peakCount) peakCount = createdCount;
    return rl;
}

/**
 * 拆掉当前真实存活的 readline。**幂等**：重复调用只会直接返回。
 *
 * 所有「让出 stdin」的路径（正常 release、强制接管、测试重置）都必须
 * 经过这里，否则 `liveRl` 会残留，下一次 makeRl 就会抛错或双开。
 */
function teardown() {
    const old = liveRl;
    if (!old) return;
    liveRl = null;
    liveOwner = null;
    createdCount = Math.max(0, createdCount - 1);
    try {
        // 调用方可能给 rl.close 包了一层（见 interactive.createRL 的
        // 「close 顺手还租约」），那一层会反过来再调 release。
        // 这里直接调原始 close，避开重入。
        if (typeof old.__origClose === 'function') old.__origClose();
        else old.close();
    } catch (e) { /* 已关闭 */ }
}

/**
 * 申请 stdin 的控制权。
 *
 * 若已被别人持有，则**排队等待**，不会并行创建第二个 readline。
 *
 * @param {string} name 谁在申请（只用于诊断，出问题时能看出是谁占着）
 * @param {object} [options] 同 makeRl
 * @returns {Promise<object>} lease
 */
async function claim(name, options = {}) {
    if (current) {
        // 已有持有者：排队，等它 release
        await new Promise(resolve => waiters.push(resolve));
    }
    const lease = buildLease(name, options);
    current = lease;
    return lease;
}

/**
 * 同步申请（仅用于「确定此刻无人持有」的场景，比如进程启动早期）。
 * 被占用时抛错而不是排队——静默排队会让启动流程莫名卡住。
 */
function claimSync(name, options = {}) {
    if (current) {
        throw new Error(
            `stdin 已被「${current.name}」占用，不能在启动期再申请（申请方：${name}）`
        );
    }
    const lease = buildLease(name, options);
    current = lease;
    return lease;
}

/**
 * 同步申请（用于必须同步建好的场景，例如 TUI 键盘）。
 *
 * 若此刻已被别人持有，**不报错、不排队**，而是：
 *   1. 关掉旧持有者的 readline（它已经不该再读了）；
 *   2. 标记旧租约已失效，防止它稍后再 release 把新租约的计数减掉；
 *   3. 打一条告警，把现场写进日志，方便定位是谁忘了 release。
 *
 * 为什么不用排队：TUI 是画面的唯一主宰，进 TUI 时 REPL / 命令的提问
 * 都应当已经结束。如果还有残留持有者，说明调用方漏了 release——
 * 此时排队会直接卡死画面，而接管 + 告警能把问题暴露出来。
 * 接管走的是同一个 teardown()，所以 liveRl 始终 ≤ 1。
 */
function acquireSync(name, options = {}) {
    if (current) {
        const stale = current;
        const owner = stale.name;
        console.warn(`⚠️ stdin 被「${owner}」占用，${name} 强制接管（调用方可能漏了 release）`);
        try {
            if (process.stdin.isRaw) process.stdin.setRawMode(false);
        } catch (e) { /* 忽略 */ }
        retired.add(stale);
        teardown();
        current = null;
    }
    const lease = buildLease(name, options);
    current = lease;
    return lease;
}

/** 构造一个租约对象 */
function buildLease(name, options) {
    let rl = makeRl({
        terminal: options.terminal,
        historySize: options.historySize,
        prompt: options.prompt,
        __owner: name
    });
    let pausedByLease = false;

    // raw 模式：TUI 才需要
    if (options.raw) {
        try {
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
                process.stdin.setRawMode(true);
            }
        } catch (e) { /* 非 TTY */ }
    }
    try { process.stdin.resume(); } catch (e) { /* 忽略 */ }

    const lease = {
        name,
        get rl() { return rl; },
        get released() { return retired.has(lease); },

        /** 暂停处理输入，但**保留所有权**（别的 claim 仍会排队） */
        pause() {
            if (retired.has(lease) || !rl) return;
            pausedByLease = true;
            try { rl.pause(); } catch (e) { /* 忽略 */ }
            try { process.stdin.pause(); } catch (e) { /* 忽略 */ }
        },

        /** 从暂停中恢复 */
        resume() {
            if (retired.has(lease) || !rl) return;
            pausedByLease = false;
            try { process.stdin.resume(); } catch (e) { /* 忽略 */ }
            try { rl.resume(); } catch (e) { /* 忽略 */ }
        },

        /**
         * 挂 keypress 派发器（TUI 按键模式专用）。
         *
         * `readline.emitKeypressEvents` 会往 stdin 挂内部派发器，属于
         * readline 生命周期的一部分，也统一由本模块代管，避免调用方
         * 自己碰 readline 内部。幂等：对同一 stream 重复调用不会叠加。
         */
        enableKeypress() {
            if (retired.has(lease) || !rl) return;
            try { readline.emitKeypressEvents(process.stdin, rl); } catch (e) { /* 忽略 */ }
        },

        /** 问一行（复用本租约的 readline，不新建） */
        question(prompt) {
            return new Promise(resolve => {
                if (retired.has(lease) || !rl) return resolve('');
                let settled = false;
                const done = v => {
                    if (settled) return;
                    settled = true;
                    resolve(String(v == null ? '' : v).trim());
                };
                try { rl.question(prompt, done); } catch (e) { done(''); }
            });
        },

        /**
         * 交还控制权。
         *
         * 必须先 `setRawMode(false)` 再 close：顺序反了的话，rl.close() 那一刻
         * stdin 还在 raw 模式，终端会把之后用户敲的第一个字符再回显一次，
         * 下一个消费者的输入就变成 `11` / `33`。
         *
         * 同步前段（setRawMode、rl=null、teardown、current=null）在第一个
         * await 之前完成，所以 TUI 的同步 close() 调用它也能立刻让出所有权。
         */
        async release() {
            if (retired.has(lease)) return;
            retired.add(lease);
            try { if (process.stdin.isRaw) process.stdin.setRawMode(false); } catch (e) { /* 忽略 */ }
            rl = null;
            teardown();
            if (current === lease) current = null;
            pausedByLease = false;
            // 让出一轮事件循环，避免下一个 readline 抢到内核缓冲里的残留字节
            await yieldLoop();
            // 放行队列里的下一个
            const next = waiters.shift();
            if (next) next();
        }
    };
    void pausedByLease; // 保留字段位，供将来诊断「是谁暂停了 stdin」
    return lease;
}

/**
 * 临时问一行，用完自动归还。
 *
 * 这是给「命令内部的确认框 / 密码输入」用的便捷入口：
 * 内部会 claim → question → release，调用方不需要管生命周期。
 * 若此刻别的租约正在占用（例如 REPL），会**排队等待**，不会造成双读。
 */
async function ask(prompt, options = {}) {
    const lease = await claim('ask', Object.assign({ terminal: Boolean(process.stdin.isTTY) }, options));
    try {
        return await lease.question(prompt);
    } finally {
        await lease.release();
    }
}

/** 临时问一行 y/N 确认 */
async function confirm(prompt, options = {}) {
    const a = String(await ask(prompt, options)).trim().toLowerCase();
    return a === 'y' || a === 'yes' || a === '是';
}

/** 当前是否有人持有 stdin（诊断用） */
function isBusy() {
    return Boolean(current);
}

/** 当前持有者的名字（诊断用，无人时为 null） */
function ownerName() {
    return current ? current.name : null;
}

/**
 * 与旧代码兼容：返回当前持有的 readline，没有则 null。
 * 迁移期的桥梁——老的 `borrowRl()` 可以改成调用它。
 */
function currentRl() {
    return current ? current.rl : null;
}

/** 诊断快照（测试断言用） */
function stats() {
    return {
        active: Boolean(current),
        owner: ownerName(),
        waiters: waiters.length,
        created: createdCount,          // 兼容旧断言：当前活跃实例数
        live: liveRl ? 1 : 0,           // 真实存活实例数，恒为 0 或 1
        totalCreated,
        peak: peakCount,
        violations: violationSites.length,
        stdinDataListeners: process.stdin.listenerCount('data'),
        // Node emitKeypressEvents 常驻的按键解码器（见文件头说明）。
        // 它不算第二个 readline，但让诊断能一眼看出「多出来的那个是谁」。
        keypressDecoder: process.stdin.listeners('data')
            .some(f => Boolean(f) && f.name === 'onData')
    };
}

/** 绕过单例的调用栈列表（诊断用，返回副本） */
function violations() {
    return violationSites.slice();
}

module.exports = {
    claim,
    claimSync,
    acquireSync,
    ask,
    confirm,
    isBusy,
    ownerName,
    currentRl,
    stats,
    violations,
    makeRl,
    // 供测试重置：连可能残留的实例一起关掉
    _reset() {
        try { if (liveRl) liveRl.close(); } catch (e) { /* 忽略 */ }
        current = null;
        waiters.length = 0;
        retired = new WeakSet();
        liveRl = null;
        liveOwner = null;
        createdCount = 0;
        totalCreated = 0;
        peakCount = 0;
        violationSites.length = 0;
        insideFactory = false;
    }
};
