/**
 * Web 面板便签（聊天室）存储模块
 *
 * 右侧栏从「通知栏」升级为「便签聊天室」：
 * 所有登录用户（以登录邮箱为发言人标识）共用一块便签墙，
 * 谁都可以留言，所有人实时可见。
 *
 * 设计要点：
 * - 持久化到 .web.notes.json（与 .web.pid 同级，重启不丢）；
 * - 单条内容上限 500 字符，最多保留 200 条（旧的被裁掉），
 *   防止便签墙无限膨胀把磁盘当记事本；
 * - 内容清洗：压掉控制字符（保留换行），消息渲染走 textContent，
 *   从根上杜绝 XSS；
 * - 存储路径可用环境变量 WOW_WEB_NOTES_FILE 覆盖（测试注入临时文件用）。
 */

const fs = require('fs-extra');
const path = require('path');

const NOTES_FILE = process.env.WOW_WEB_NOTES_FILE ||
    path.join(__dirname, '../.web.notes.json');
const MAX_NOTES = 200;
const MAX_CONTENT_LEN = 500;

/**
 * 清洗便签正文：
 * - \r 一律丢弃（跨平台粘贴的换行残留）；
 * - 其余控制字符压成空格，保留换行（气泡支持多行便签）；
 * - 连续 3 个以上换行压成 2 个；
 * - 首尾去空白后截断到 500 字符。
 *
 * @param {*} input
 * @returns {string}
 */
function sanitizeContent(input) {
    let text = String(input === null || input === undefined ? '' : input);
    text = text.replace(/\r/g, '');
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
    if (text.length > MAX_CONTENT_LEN) {
        text = text.slice(0, MAX_CONTENT_LEN);
    }
    return text;
}

/** 读取全部便签（旧在前、新在后）。文件缺失或损坏时返回空数组。 */
function loadNotes() {
    try {
        if (!fs.existsSync(NOTES_FILE)) return [];
        const data = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
        if (!Array.isArray(data)) return [];
        // 只保留结构完整的条目，坏行直接跳过
        return data.filter(n => n && typeof n === 'object' &&
            typeof n.content === 'string');
    } catch (e) {
        return [];
    }
}

/** 写盘（失败不抛出——便签丢一条比面板炸一次便宜得多） */
function saveNotes(notes) {
    try {
        fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf8');
    } catch (e) { /* 忽略写盘失败 */ }
}

/**
 * 新增一条便签。
 *
 * @param {object} opts
 * @param {string} opts.email   发言人邮箱（JWT 中带出的登录邮箱）
 * @param {string} opts.content 便签正文
 * @returns {object|null} 成功返回便签对象；正文为空返回 null
 */
function addNote({ email, content }) {
    const text = sanitizeContent(content);
    if (!text) return null;

    const notes = loadNotes();
    const note = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        email: String(email || 'admin@local').trim().toLowerCase(),
        content: text,
        ts: Date.now()
    };
    notes.push(note);

    // 超限裁剪：保留最新的 MAX_NOTES 条
    if (notes.length > MAX_NOTES) {
        notes.splice(0, notes.length - MAX_NOTES);
    }
    saveNotes(notes);
    return note;
}

/** 便签列表（旧在前、新在后，前端按时间正序渲染聊天气泡） */
function listNotes() {
    return loadNotes();
}

/** 便签条数（测试 / 状态展示用） */
function count() {
    return loadNotes().length;
}

module.exports = {
    NOTES_FILE,
    MAX_NOTES,
    MAX_CONTENT_LEN,
    sanitizeContent,
    addNote,
    listNotes,
    count
};
