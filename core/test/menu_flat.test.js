/**
 * TUI 菜单扁平化契约测试（V3.7.4）
 * ============================================================
 *
 * 用户指令原文：「删掉 w1,r1,t1,y1，并将其他原本从旧的二级菜单拆出的选项，
 * 进入后删掉旧二级菜单选择页面」。
 *
 * 这次改造要守住的红线：
 *   1. 菜单只有一层 —— 点任何一项都直接干活，不再打印 `请选择 (0-N)`；
 *   2. 四个聚合入口（原 W1/R1/T1/Y1 对应的「方案管理 / 联机(陶瓦) /
 *      错误日志分析 / 系统设置」）已删除，它们的子项各自成项；
 *   3. 旧编号（legacy / 跨页解析）彻底移除，只认本页顺号；
 *   4. 每页编号严格 1..N 连续，且每一项都有对应的动作函数（没有空壳项）。
 *
 * 本文件只做静态与内存断言，不占用端口、不启服务、不发网络请求。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const itvSrc = fs.readFileSync(path.join(SRC_DIR, 'interactive.js'), 'utf8');
const tuiSrc = fs.readFileSync(path.join(SRC_DIR, 'tui.js'), 'utf8');

const itv = require('../src/interactive');

let passed = 0;
let failed = 0;
function check(title, fn) {
    try {
        fn();
        console.log(`  ✅ ${title}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${title}\n     ${e.message}`);
        failed++;
    }
}

/** 去掉注释行，只留真实代码（避免注释里解释历史行为被误判） */
function codeLines(src) {
    return src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

console.log('\nTUI 菜单扁平化契约（V3.7.4）\n');

// ─────────────────────────────────────────────
console.log('— 一、零子菜单 —');

check('interactive.js 真实代码行里不存在「请选择 (0-N)」', () => {
    const hit = codeLines(itvSrc).filter(l => /请选择 \(0-/.test(l));
    assert.strictEqual(hit.length, 0, `残留：${hit.join(' | ')}`);
});

check('subOf（子菜单读取器）已彻底删除', () => {
    assert.ok(!codeLines(itvSrc).some(l => /subOf/.test(l)), 'subOf 仍存在');
});

check('dispatchMenu 是纯转发表，内部不打印任何编号列表', () => {
    const i = itvSrc.indexOf('async function dispatchMenu(');
    assert.ok(i > 0, '未找到 dispatchMenu');
    const body = itvSrc.slice(i, itvSrc.indexOf('\n}', i) + 2);
    assert.ok(!/请选择/.test(body), 'dispatchMenu 里仍打印选择页');
    assert.ok(!/console\.log\('  \d\. /.test(body), 'dispatchMenu 里仍有「  1. xxx」列表');
});

check('PAGES 里没有任何一项的 label 以聚合入口命名', () => {
    // 这些 label 以前都是「进去后再选一次」的聚合项
    const banned = [
        '方案管理 (新建/切换/列表/删除/信息)',
        '系统设置（Java / 性能 / 信息）',
        '错误日志分析',
        '联机 / 我要当房主 (陶瓦)',
        '管理模组 / 插件',
        '模组 / 插件搜索下载',
        '变更配置 (server.properties)',
        '下载镜像 / 超时 / 重试',
        '安装整合包（新建方案的另一种入口）'
    ];
    const labels = itv.PAGES.flatMap(p => p.items.map(it => it.label));
    for (const b of banned) {
        assert.ok(!labels.includes(b), `聚合入口「${b}」仍在 PAGES 里`);
    }
});

// ─────────────────────────────────────────────
console.log('\n— 二、聚合入口已拆成独立项 —');

check('W 页方案五项都在（新建/切换/列出/删除/信息）', () => {
    const labels = itv.PAGE_MAP.get('W').items.map(it => it.label);
    for (const need of ['新建方案', '切换方案', '删除方案']) {
        assert.ok(labels.includes(need), `W 页缺「${need}」`);
    }
    assert.ok(labels.some(l => l.startsWith('列出全部方案')), 'W 页缺「列出全部方案」');
    assert.ok(labels.some(l => l.startsWith('方案信息')), 'W 页缺「方案信息」');
});

check('R 页陶瓦四项都在（开房/状态/关房/当房客）', () => {
    const labels = itv.PAGE_MAP.get('R').items.map(it => it.label);
    assert.ok(labels.some(l => l.startsWith('开房')), 'R 页缺开房');
    assert.ok(labels.some(l => l.includes('查看房间号')), 'R 页缺房间号状态');
    assert.ok(labels.some(l => l.startsWith('关房')), 'R 页缺关房');
    assert.ok(labels.some(l => l.includes('我要当房客')), 'R 页缺当房客');
});

check('T 页日志三项都在（AI 分析/统计报告/实时跟踪）', () => {
    const labels = itv.PAGE_MAP.get('T').items.map(it => it.label);
    assert.ok(labels.some(l => l.startsWith('AI 分析')), 'T 页缺 AI 分析');
    assert.ok(labels.some(l => l.startsWith('生成统计报告')), 'T 页缺统计报告');
    assert.ok(labels.some(l => l.startsWith('实时日志跟踪')), 'T 页缺实时日志跟踪');
});

check('Y 页系统设置四项都在（Java/JVM/系统信息/重置）', () => {
    const labels = itv.PAGE_MAP.get('Y').items.map(it => it.label);
    assert.ok(labels.some(l => l.startsWith('Java 设置')), 'Y 页缺 Java 设置');
    assert.ok(labels.some(l => l.includes('JVM 参数')), 'Y 页缺 JVM 参数');
    assert.ok(labels.some(l => l.startsWith('查看系统信息')), 'Y 页缺系统信息');
    assert.ok(labels.some(l => l.startsWith('重置全部配置')), 'Y 页缺重置配置');
});

check('E 页模组七项 + server.properties 四项都在', () => {
    const labels = itv.PAGE_MAP.get('E').items.map(it => it.label);
    for (const need of ['列出已安装模组', '卸载模组', '启用 / 禁用模组',
                        '查看模组配置文件', '编辑模组配置文件', '备份模组配置文件']) {
        assert.ok(labels.includes(need), `E 页缺「${need}」`);
    }
    assert.ok(labels.includes('查看服务端属性（全部）'), 'E 页缺「查看服务端属性」');
    assert.ok(labels.includes('修改单个服务端属性'), 'E 页缺「修改单个服务端属性」');
});

check('Q 页也提供 server.properties 与错误日志分析', () => {
    const labels = itv.PAGE_MAP.get('Q').items.map(it => it.label);
    assert.ok(labels.includes('查看服务端属性（全部）'), 'Q 页缺「查看服务端属性」');
    assert.ok(labels.some(l => l.startsWith('错误日志分析')), 'Q 页缺错误日志分析');
});

// ─────────────────────────────────────────────
console.log('\n— 三、零旧编号 —');

check('PAGES 每一项都没有 legacy 字段', () => {
    for (const p of itv.PAGES) {
        for (const it of p.items) {
            assert.ok(!('legacy' in it), `${p.key} 页「${it.label}」仍带 legacy`);
        }
    }
});

check('idsOf 只返回本页顺号', () => {
    const it0 = itv.PAGE_MAP.get('W').items[0];
    assert.deepStrictEqual(itv.idsOf(it0), [String(it0.id)]);
});

check('resolveNumber 不认旧编号（22 / 141 / 144 全部失效）', () => {
    assert.strictEqual(itv.resolveNumber('22', 'W'), null);
    assert.strictEqual(itv.resolveNumber('141', 'R'), null);
    assert.strictEqual(itv.resolveNumber('144', 'R'), null);
    assert.strictEqual(itv.resolveNumber('81', 'Y'), null);
});

check('resolveNumber 不再跨页（Q 页敲 5 是 Q5，不会跳到别页）', () => {
    const hit = itv.resolveNumber('5', 'Q');
    assert.ok(hit, 'Q5 解析失败');
    assert.strictEqual(hit.page, 'Q');
    assert.strictEqual(hit.item.id, '5');
});

check('tui.js 不再渲染「旧 xx」小注', () => {
    assert.ok(!codeLines(tuiSrc).some(l => /legacy/.test(l)), 'tui.js 仍读 legacy');
    assert.ok(!/旧 \$\{/.test(tuiSrc), 'tui.js 仍拼「旧 xx」字样');
});

// ─────────────────────────────────────────────
console.log('\n— 四、编号连续且每项都有实现 —');

check('六页齐全且键为 Q/W/E/R/T/Y', () => {
    assert.deepStrictEqual(itv.PAGES.map(p => p.key), ['Q', 'W', 'E', 'R', 'T', 'Y']);
});

check('每页编号严格 1..N 连续无跳号', () => {
    for (const p of itv.PAGES) {
        const ids = p.items.map(it => String(it.id));
        const expect = ids.map((_, i) => String(i + 1));
        assert.deepStrictEqual(ids, expect, `${p.key} 页编号不是 1..N：${ids.join(',')}`);
    }
});

check('每页每一项都在 ACTION_BY_KEY 里注册了动作', () => {
    for (const p of itv.PAGES) {
        for (const it of p.items) {
            const k = `${p.key}:${it.id}`;
            assert.ok(itv.ACTION_BY_KEY.has(k), `${k}「${it.label}」没有动作实现`);
            assert.strictEqual(typeof itv.ACTION_BY_KEY.get(k), 'function', `${k} 不是函数`);
        }
    }
});

check('ACTION_BY_KEY 里没有游离的孤儿动作（每页 N 项 = N 个动作）', () => {
    const expected = itv.PAGES.reduce((n, p) => n + p.items.length, 0);
    assert.strictEqual(itv.ACTION_BY_KEY.size, expected,
        `动作数 ${itv.ACTION_BY_KEY.size} ≠ 页面项数 ${expected}`);
});

check('每页第一项都是最常用的动作（不是聚合入口）', () => {
    assert.strictEqual(itv.resolveNumber('1', 'Q').item.label, '启动 / 停止服务器');
    assert.strictEqual(itv.resolveNumber('1', 'W').item.label, '新建方案');
    assert.strictEqual(itv.resolveNumber('1', 'E').item.label, '列出已安装模组');
    assert.ok(itv.resolveNumber('1', 'R').item.label.startsWith('开房'));
    assert.ok(itv.resolveNumber('1', 'T').item.label.startsWith('AI 分析'));
    assert.ok(itv.resolveNumber('1', 'Y').item.label.startsWith('Java 设置'));
});

check('dispatchMenuItem 内部不再转调 dispatchMenu（一层派发）', () => {
    const i = itvSrc.indexOf('async function dispatchMenuItem(');
    const end = itvSrc.indexOf('\n}\n', i);
    const body = itvSrc.slice(i, end);
    assert.ok(!/dispatchMenu\(/.test(body), 'dispatchMenuItem 仍在调 dispatchMenu');
    assert.ok(/ACTION_BY_KEY\.get\(/.test(body), 'dispatchMenuItem 未按 ACTION_BY_KEY 派发');
});

check('每页渲染都不超过 70 列（去掉「旧 xx」后列宽更宽松）', () => {
    const tui = require('../src/tui');
    const orig = process.stdout.write.bind(process.stdout);
    for (const p of itv.PAGES) {
        let out = '';
        process.stdout.write = (s) => { out += s; return true; };
        try {
            tui.drawPage({
                page: p.key,
                def: {
                    key: p.key, label: p.label, title: p.title,
                    items: p.items.map(it => ({
                        id: it.id,
                        label: it.label,
                        hint: typeof it.hint === 'function' ? null : it.hint
                    }))
                },
                status: { render() {} },
                notice: null
            });
        } finally {
            process.stdout.write = orig;
        }
        const over = out.split('\n').filter(l => l.length > 70);
        assert.strictEqual(over.length, 0, `${p.key} 页有 ${over.length} 行超过 70 列`);
    }
});

// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(46)}`);
console.log(`✅ 通过 ${passed} 项，失败 ${failed} 项`);
console.log(`${'='.repeat(46)}\n`);

process.exit(failed ? 1 : 0);
