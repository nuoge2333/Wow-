#!/usr/bin/env node
/**
 * 便签聊天室测试（右侧栏「通知栏」→「便签」改造）
 * ----------------------------------------------------------------
 * 覆盖点：
 *   1. web_notes 存储：清洗、上限、持久化、坏文件容错
 *   2. web_service 路由接线：/api/notes GET/POST、socket.io 广播
 *   3. right.html 前端：拉历史、发言、实时通道、textContent 防注入
 *   4. 主题副本一致性（themes/default 必须与 web 同步）
 *
 * 存储通过 WOW_WEB_NOTES_FILE 注入临时文件，不污染真实 .web.notes.json。
 *
 * 运行：node test/web_notes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

// ===== 注入临时存储文件后加载被测模块 =====
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-notes-test-'));
const notesFile = path.join(tmpDir, '.web.notes.json');
process.env.WOW_WEB_NOTES_FILE = notesFile;

const SRC = path.join(__dirname, '../src');
const WebNotes = require(path.join(SRC, 'web_notes'));
const ROOT = path.join(__dirname, '../..');

console.log('\n📋 便签内容清洗（sanitizeContent）\n');

check('丢弃 \\r（跨平台粘贴残留，\\r\\n 归一为 \\n）', () => {
    assert.strictEqual(WebNotes.sanitizeContent('a\r\nb\rc'), 'a\nbc');
});

check('控制字符压成空格（保留换行与制表符）', () => {
    assert.strictEqual(WebNotes.sanitizeContent('a\u0000b\u000Bc'), 'a b c');
    assert.strictEqual(WebNotes.sanitizeContent('x\u0007\ty'), 'x \ty');
    assert.strictEqual(WebNotes.sanitizeContent('p\u001Fq\u007Fr'), 'p q r');
});

check('3 个以上连续换行压成 2 个', () => {
    assert.strictEqual(WebNotes.sanitizeContent('a\n\n\n\nb'), 'a\n\nb');
});

check('首尾空白被去除', () => {
    assert.strictEqual(WebNotes.sanitizeContent('  hello \n '), 'hello');
});

check('超过 500 字符被截断', () => {
    const long = '啊'.repeat(600);
    const out = WebNotes.sanitizeContent(long);
    assert.strictEqual(out.length, 500);
});

check('null / undefined / 空串 => 空串', () => {
    assert.strictEqual(WebNotes.sanitizeContent(null), '');
    assert.strictEqual(WebNotes.sanitizeContent(undefined), '');
    assert.strictEqual(WebNotes.sanitizeContent(''), '');
});

console.log('\n📋 addNote / listNotes（存储行为）\n');

check('正文为空或纯空白 => 返回 null 且不落盘', () => {
    assert.strictEqual(WebNotes.addNote({ email: 'a@x.com', content: '' }), null);
    assert.strictEqual(WebNotes.addNote({ email: 'a@x.com', content: '   \n\t ' }), null);
    assert.strictEqual(WebNotes.addNote({ email: 'a@x.com' }), null);
    assert.strictEqual(WebNotes.count(), 0);
});

check('新增便签字段完整，邮箱小写化', () => {
    const n = WebNotes.addNote({ email: 'User@Example.COM', content: '记得备份' });
    assert.ok(n.id, '应有 id');
    assert.strictEqual(n.email, 'user@example.com');
    assert.strictEqual(n.content, '记得备份');
    assert.ok(typeof n.ts === 'number' && n.ts > 0, '应有毫秒时间戳');
    // id 唯一
    const n2 = WebNotes.addNote({ email: 'user@example.com', content: '第二条' });
    assert.notStrictEqual(n.id, n2.id);
});

check('缺邮箱时回退 admin@local', () => {
    const n = WebNotes.addNote({ content: '匿名' });
    assert.strictEqual(n.email, 'admin@local');
});

check('便签持久化：listNotes 能读回', () => {
    WebNotes.addNote({ email: 'a@x.com', content: '持久化检查' });
    const list = WebNotes.listNotes();
    assert.ok(list.some(n => n.content === '持久化检查'));
    assert.ok(fs.existsSync(notesFile), '存储文件应存在');
});

check('超过 200 条裁剪，保留最新', () => {
    for (let i = 0; i < WebNotes.MAX_NOTES + 20; i++) {
        WebNotes.addNote({ email: 'flood@x.com', content: 'msg-' + i });
    }
    const list = WebNotes.listNotes();
    assert.strictEqual(list.length, WebNotes.MAX_NOTES);
    // 最新的 msg-219 应保留，最早的 msg-0 应被裁掉
    assert.ok(list.some(n => n.content === 'msg-' + (WebNotes.MAX_NOTES + 19)));
    assert.ok(!list.some(n => n.content === 'msg-0'));
});

check('存储文件损坏（非法 JSON）=> 容错返回空数组', () => {
    fs.writeFileSync(notesFile, '{not-json!!!', 'utf8');
    assert.deepStrictEqual(WebNotes.listNotes(), []);
    // 且能从空状态恢复正常读写
    const n = WebNotes.addNote({ email: 'r@x.com', content: '坏文件后恢复' });
    assert.ok(n);
    assert.strictEqual(WebNotes.count(), 1);
});

check('存储文件是合法 JSON 但非数组 => 空数组', () => {
    fs.writeFileSync(notesFile, '{"oops":true}', 'utf8');
    assert.deepStrictEqual(WebNotes.listNotes(), []);
});

check('结构残缺的条目被过滤，完整条目保留', () => {
    fs.writeFileSync(notesFile, JSON.stringify([
        { id: 'a', email: 'a@x.com', content: '好条目', ts: 1 },
        null,
        { id: 'b', email: 'b@x.com', ts: 2 },           // 缺 content
        { id: 'c', email: 'c@x.com', content: 123 },   // content 非字符串
    ]), 'utf8');
    const list = WebNotes.listNotes();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].content, '好条目');
});

console.log('\n📋 web_service 路由接线（静态断言）\n');

const webServiceSrc = fs.readFileSync(path.join(SRC, 'web_service.js'), 'utf8');

check('注册 GET /api/notes（拉便签墙）', () => {
    assert.ok(/app\.get\('\/api\/notes'/.test(webServiceSrc));
});

check('注册 POST /api/notes（发言）', () => {
    assert.ok(/app\.post\('\/api\/notes'/.test(webServiceSrc));
});

check('发言人取 JWT 中的登录邮箱', () => {
    assert.ok(/req\.user && req\.user\.email/.test(webServiceSrc));
});

check('发言后通过 socket.io 广播 note 事件', () => {
    assert.ok(/ioServer\.emit\('note', note\)/.test(webServiceSrc));
});

check('引入 web_notes 存储模块', () => {
    assert.ok(/require\('\.\/web_notes'\)/.test(webServiceSrc));
});

check('空正文返回 400', () => {
    assert.ok(/便签内容不能为空/.test(webServiceSrc));
});

check('断开清理调用 stopLogTail（回归防护：曾笔误为不存在的 stopBroadcastTail，最后一个客户端断开即崩掉面板进程）', () => {
    const code = webServiceSrc.split('\n')
        .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
    assert.ok(!/stopBroadcastTail/.test(code), '不得再引用不存在的 stopBroadcastTail');
    assert.ok(/wsClients\.length === 0\) stopLogTail\(\)/.test(code));
});

console.log('\n📋 right.html 前端（静态断言）\n');

const rightSrc = fs.readFileSync(path.join(ROOT, 'web/right.html'), 'utf8');

check('拉取历史：GET /api/notes', () => {
    assert.ok(/\/api\/notes/.test(rightSrc));
});

check('发言：POST /api/notes', () => {
    assert.ok(/api\('\/api\/notes', 'POST'/.test(rightSrc));
});

check('实时通道：socket.io 接收 note 广播', () => {
    assert.ok(/socket\.io\/socket\.io\.js/.test(rightSrc));
    assert.ok(/sock\.on\('note'/.test(rightSrc));
});

check('轮询兜底存在（socket 断线也能同步）', () => {
    assert.ok(/setInterval\(loadHistory/.test(rightSrc));
});

check('自己的便签右侧、他人左侧（聊天室布局）', () => {
    assert.ok(/msg-row\.mine|className = 'msg-row' \+ \(mine \? ' mine'/.test(rightSrc));
    assert.ok(/flex-direction: row-reverse/.test(rightSrc));
});

check('发言人以邮箱展示', () => {
    assert.ok(/note\.email/.test(rightSrc));
    assert.ok(/avatarColor/.test(rightSrc), '应有按邮箱着色的头像');
});

check('消息用 textContent 渲染（防 XSS）', () => {
    assert.ok(/bubble\.textContent = note\.content/.test(rightSrc));
    assert.ok(!/innerHTML[^=]*=\s*[^;]*note\.content/.test(rightSrc),
        '不得用 innerHTML 拼接便签正文');
});

check('输入框限长 500、回车发送', () => {
    assert.ok(/maxlength="500"/.test(rightSrc));
    assert.ok(/key === 'Enter'/.test(rightSrc));
});

check('保留折叠交互与 localStorage 记忆', () => {
    assert.ok(/notifyCollapsed/.test(rightSrc));
    assert.ok(/toggle-btn/.test(rightSrc));
});

check('兼容旧通知通道（postMessage notify 本地展示）', () => {
    assert.ok(/data\.type === 'notify'/.test(rightSrc));
});

check('未登录时隐藏输入框并给出提示', () => {
    assert.ok(/login-hint/.test(rightSrc));
});

console.log('\n📋 主题副本一致性\n');

check('themes/default/right.html 与 web/right.html 一致', () => {
    const a = fs.readFileSync(path.join(ROOT, 'web/right.html'), 'utf8');
    const b = fs.readFileSync(path.join(ROOT, 'themes/default/right.html'), 'utf8');
    assert.strictEqual(a, b);
});

check('themes/default/index.html 与 web/index.html 一致', () => {
    const a = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
    const b = fs.readFileSync(path.join(ROOT, 'themes/default/index.html'), 'utf8');
    assert.strictEqual(a, b);
});

console.log(`\n📊 结果: ${pass} 通过, ${fail} 失败\n`);
if (fail) {
    console.log('失败项:');
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.err.message}`));
    process.exit(1);
}
