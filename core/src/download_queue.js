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
 * @param {object} patch { status, progress, message }
 */
function update(id, patch = {}) {
    const item = items.find(i => i.id === id);
    if (!item) return null;
    if (patch.status !== undefined) item.status = patch.status;
    if (patch.progress !== undefined) item.progress = patch.progress;
    if (patch.message !== undefined) item.message = patch.message;
    item.updated_at = new Date().toISOString();
    return item;
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
    const running = items.filter(i => i.status === '下载中' || i.status === '等待中').length;
    return { total: items.length, running, finished: items.filter(i => i.status === '完成').length, failed: items.filter(i => i.status === '失败').length };
}

module.exports = { add, update, list, clearFinished, stats };
