/**
 * Web 端异步任务执行器（V3.5.19）
 *
 * 背景：
 *   此前 Web 面板点「创建方案」走的是 /api/exec —— 同步等待子进程结束才响应。
 *   Forge/NeoForge 安装器动辄跑几分钟，浏览器请求早就超时了，用户看到的是
 *   "请求失败"，但后台其实还在装，最后留下一个「创建了又说失败」的方案。
 *
 * 本模块把这类耗时指令改成异步任务：
 *   1. 立刻返回 task_id（HTTP 响应毫秒级返回）；
 *   2. 子进程输出按行解析，映射成「阶段 + 百分比」，写入 download_queue 供前端展示；
 *   3. 每次进度变化通过 EventEmitter 抛出去，由 web_service 广播给 WebSocket 客户端。
 *
 * 安全约束：
 *   只放行白名单里的指令（scheme create / pull / prune）。Web 端其余操作仍走
 *   /api/exec + command_policy，避免这里成为一个绕过拒绝清单的后门。
 */

const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const Queue = require('./download_queue');

/** 进度事件总线：web_service 订阅后广播给所有 WebSocket 客户端 */
const bus = new EventEmitter();

/** 正在运行的任务：taskId -> child_process */
const children = new Map();

/**
 * 白名单：仅这些指令允许作为异步任务提交。
 *
 * V3.5.19：除方案三兄弟外，补入「下载核心 / 下载模组 / 同步资源池」——
 * 它们同样是分钟级的长任务，走 /api/exec 一样会浏览器超时。
 * 仍然只是枚举，不是一个「任意命令都能异步」的后门。
 */
const ALLOWED_PREFIXES = [
    'scheme create', 'scheme pull', 'scheme prune',
    'install vanilla', 'install fabric', 'install forge', 'install neoforge',
    'install paper', 'install spigot', 'install mohist', 'install purpur',
    'install folia', 'install quilt',
    'down', 'mod download', 'mod sync',
    // V3.8.0 P0 下载中心：模组 / 服务端插件安装到方案（--kind plugins 走插件页）
    'mod install'
];

/**
 * 输出行 → 进度阶段映射。
 * 顺序即优先级：越靠后的规则命中越晚，用 Math.max 保证进度不倒退。
 */
const STAGE_RULES = [
    { re: /📦\s*创建方案/, progress: 5, stage: '初始化方案目录' },
    { re: /正在查询|下载 .*(安装器|核心)|下载 https?:\/\/|下载完成/, progress: 25, stage: '下载服务端核心' },
    { re: /运行安装器|预下载原版核心|原版核心已就绪/, progress: 55, stage: '运行安装器（初始化加载器）' },
    { re: /已生成服务端核心|服务端核心已存在|核心已就绪/, progress: 75, stage: '核心就绪' },
    { re: /fabric[- ]?api/i, progress: 82, stage: '装配前置模组' },
    { re: /📥\s*拉取|🧹\s*瘦身/, progress: 20, stage: '同步资源池' },
    { re: /已共享到|补齐|复制资源/, progress: 65, stage: '从资源池复制文件' },
    // 单文件下载 / 安装器下载进度（形如 "已下载 45% / 12.3 MB"）
    { re: /已下载\s*\d+%|下载中.*\d+%|Progress:\s*\d+%/i, progress: 40, stage: '下载中' },
    { re: /正在安装|解压|Installing|extracting/i, progress: 70, stage: '安装中' },
    { re: /✅\s*方案 .*创建完成|✅\s*完成|全部完成|安装完成|下载完成|✅\s*已安装|已就绪/, progress: 95, stage: '收尾' }
];

/** 把 "scheme create" + ['foo','--version','1.20.1'] 拆成可 spawn 的参数数组 */
function buildArgv(command, args) {
    const head = String(command || '').trim().split(/\s+/).filter(Boolean);
    const tail = (Array.isArray(args) ? args : [])
        .map(a => String(a))
        .filter(a => a.trim() !== '');
    return [...head, ...tail];
}

/** 指令是否在白名单内 */
function isAllowed(command, args) {
    const argv = buildArgv(command, args);
    if (argv.length === 0) return false;
    // 精确匹配整个 argv 前缀：先试两段（scheme create），再试一段（down）
    const two = argv.length >= 2 ? `${argv[0]} ${argv[1]}` : null;
    if (two && ALLOWED_PREFIXES.includes(two)) return true;
    return ALLOWED_PREFIXES.includes(argv[0]);
}

/**
 * 提交一个异步任务
 * @param {object} opts
 * @param {string} opts.command 指令主体，如 "scheme create"
 * @param {string[]} [opts.args] 追加参数
 * @param {string} [opts.name] 任务显示名
 * @param {string} [opts.type] 任务分类
 * @returns {{ok:true, task:object} | {ok:false, reason:string}}
 */
function runTask(opts = {}) {
    const { command, args = [], name, type } = opts;

    if (!isAllowed(command, args)) {
        return { ok: false, reason: `不允许的异步指令: ${command}` };
    }

    const argv = buildArgv(command, args);
    const fullCmd = `wow ${argv.join(' ')}`;

    // 同一条指令已在跑就不再重复提交，避免并发写同一个方案目录
    const dup = Queue.list().find(i => i.command === fullCmd && i.status === '运行中');
    if (dup) {
        return { ok: true, task: dup, reused: true };
    }

    const label = name || argv.slice(2).join(' ') || argv[1];
    const task = Queue.add({
        name: label,
        type: type || '方案',
        status: '运行中',
        progress: 2,
        stage: '已受理',
        command: fullCmd
    });

    const cliPath = path.join(__dirname, 'cli.js');
    let child;
    try {
        child = spawn(process.execPath, [cliPath, ...argv], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, FORCE_COLOR: '0' }
        });
    } catch (e) {
        const failed = Queue.update(task.id, { status: '失败', progress: 100, message: `启动失败: ${e.message}`, stage: '启动失败' });
        bus.emit('update', failed);
        return { ok: false, reason: `启动失败: ${e.message}` };
    }

    children.set(task.id, child);
    bus.emit('update', task);

    let buf = '';
    let maxProgress = task.progress;
    let lastError = '';

    const handleLine = (line) => {
        const text = line.replace(/\r$/, '');
        if (!text.trim()) return;

        // 记录尾部日志（前端「查看日志」用）
        const patch = { log: text };
        for (const rule of STAGE_RULES) {
            if (rule.re.test(text) && rule.progress > maxProgress) {
                maxProgress = rule.progress;
                patch.progress = maxProgress;
                patch.stage = rule.stage;
            }
        }
        if (/❌|失败|error|Exception/i.test(text)) lastError = text;
        const updated = Queue.update(task.id, patch);
        if (updated) bus.emit('update', updated);
    };

    const onData = (chunk) => {
        buf += chunk.toString();
        // 安装器输出偶有超长无换行行，避免 buffer 无限增长
        if (buf.length > 64 * 1024 && !buf.includes('\n')) {
            handleLine(buf);
            buf = '';
            return;
        }
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            handleLine(line);
        }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
        children.delete(task.id);
        const failed = Queue.update(task.id, {
            status: '失败',
            progress: 100,
            stage: '启动失败',
            message: err.message
        });
        if (failed) bus.emit('update', failed);
    });

    child.on('close', (code) => {
        children.delete(task.id);
        if (buf.trim()) handleLine(buf);
        const ok = code === 0;
        const done = Queue.update(task.id, ok
            ? { status: '完成', progress: 100, stage: '完成', message: '执行完成' }
            : {
                status: '失败',
                progress: 100,
                stage: '失败',
                message: lastError || `退出码 ${code}`
            });
        if (done) bus.emit('update', done);
    });

    return { ok: true, task };
}

/** 当前正在跑的任务数（用于状态展示 / 测试） */
function runningCount() {
    return children.size;
}

module.exports = {
    bus,
    runTask,
    isAllowed,
    buildArgv,
    runningCount,
    ALLOWED_PREFIXES,
    STAGE_RULES
};
