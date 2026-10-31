/**
 * 下载任务队列（V3.5.6）
 * - 内存态，供 Web 面板「下载队列」展示
 * - 记录通过 Web 面板或 CLI 触发的下载任务及其状态
 */

const MAX_ITEMS = 50;

const items = [];

/**
 * 新增一条任务
 * @param {object} task { name, type, status }
 * @returns {object} 任务对象（含 id）
 */
function add(task) {
    const item = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: task.name || '未命名任务',
        type: task.type || '其他',
        status: task.status || '等待中',
        progress: typeof task.progress === 'number' ? task.progress : 0,
        // V3.5.19：异步任务进度细化（当前阶段文案 + 尾部日志）
        stage: task.stage || '',
        logs: Array.isArray(task.logs) ? task.logs.slice(-60) : [],
        // V3.5.19：记录触发该任务的完整 CLI 指令，前端「任务队列」可原样展示
        command: task.command || '',
        message: task.message || '',
        created_at: new Date().toISOString()
    };
    items.unshift(item);
    if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
    return item;
}

/**
 * 更新任务状态
 * @param {string} id
 * @param {object} patch { status, progress, message, stage, log }
 */
function update(id, patch = {}) {
    const item = items.find(i => i.id === id);
    if (!item) return null;
    if (patch.status !== undefined) item.status = patch.status;
    if (patch.progress !== undefined) item.progress = patch.progress;
    if (patch.message !== undefined) item.message = patch.message;
    if (patch.stage !== undefined) item.stage = patch.stage;
    if (patch.log) {
        item.logs.push(String(patch.log).slice(0, 500));
        // 只留尾部，避免长任务把内存吃穿
        if (item.logs.length > 60) item.logs.splice(0, item.logs.length - 60);
    }
    item.updated_at = new Date().toISOString();
    return item;
}

/** 取单个任务 */
function get(id) {
    return items.find(i => i.id === id) || null;
}

/** 取最近的任务列表（按时间倒序） */
function list() {
    return items.slice();
}

/** 清空已完成/失败的任务 */
function clearFinished() {
    const before = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].status === '完成' || items[i].status === '失败') items.splice(i, 1);
    }
    return before - items.length;
}

/** 统计信息 */
function stats() {
    // V3.5.19：异步任务用「运行中」，与旧的「下载中 / 等待中」一并计为进行中
    const running = items.filter(i =>
        i.status === '下载中' || i.status === '等待中' || i.status === '运行中'
    ).length;
    return {
        total: items.length,
        running,
        finished: items.filter(i => i.status === '完成').length,
        failed: items.filter(i => i.status === '失败').length
    };
}

module.exports = { add, update, get, list, clearFinished, stats };
