#!/usr/bin/env node
/**
 * view_state 五大视图状态机 + 全仓 readline 租约配对（执行令阶段 0/6）
 * ----------------------------------------------------------------
 * 前半段是状态机运行时行为；后半段是静态红线：所有 `claim` /
 * `acquireSync` 的租约点都必须有配对的 `release()`，且新流转
 * （_detachConsole 等）必须先让出再申请，避免新代码绕过单例。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const vs = require(path.join(SRC, 'view_state'));
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

let pass = 0, fail = 0;
function check(title, fn) {
    try {
        fn();
        console.log(`  ✅ ${title}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${title}  → ${e.message}`);
        fail++;
    }
}

console.log('\n=== view_state 五大视图状态机 ===\n');

check('VIEW 冻结且恰好五个视图', () => {
    assert.ok(Object.isFrozen(vs.VIEW), 'VIEW 应冻结');
    assert.deepStrictEqual(vs.VIEW, {
        SHELL: 'shell', MENU: 'menu', WOW: 'wow', MC: 'mc', WEB: 'web'
    });
});

check('VIEW_LABEL 覆盖五视图且冻结', () => {
    assert.ok(Object.isFrozen(vs.VIEW_LABEL));
    for (const k of Object.values(vs.VIEW)) {
        assert.ok(vs.VIEW_LABEL[k], `缺 ${k} 的标签`);
    }
});

check('SWITCH_ALIASES 不含任何旧 :lan / :terracotta / :3', () => {
    const a = vs.SWITCH_ALIASES;
    assert.ok(Object.isFrozen(a));
    for (const k of Object.keys(a)) {
        assert.ok(!/lan|terracotta|陶瓦/.test(k), `残留旧别名 ${k}`);
    }
    assert.strictEqual(a[':3'], undefined, ':3 应已删除');
});

check('resolve 命中五大视图别名、大小写不敏感', () => {
    assert.strictEqual(vs.resolve(':m'), 'menu');
    assert.strictEqual(vs.resolve(':MENU'), 'menu');
    assert.strictEqual(vs.resolve(':菜单'), 'menu');
    assert.strictEqual(vs.resolve(':wow'), 'wow');
    assert.strictEqual(vs.resolve(':2'), 'wow');
    assert.strictEqual(vs.resolve(':mc'), 'mc');
    assert.strictEqual(vs.resolve(':1'), 'mc');
    assert.strictEqual(vs.resolve(':服务端'), 'mc');
    assert.strictEqual(vs.resolve(':web'), 'web');
});

check('resolve 对 :lan / 未知指令返回 null', () => {
    assert.strictEqual(vs.resolve(':lan'), null);
    assert.strictEqual(vs.resolve(':LAN'), null);
    assert.strictEqual(vs.resolve(':terracotta'), null);
    assert.strictEqual(vs.resolve('server status'), null);
    assert.strictEqual(vs.resolve(''), null);
    assert.strictEqual(vs.resolve(null), null);
});

check('current / set / previous / is / label 基本流转', () => {
    vs._reset();
    assert.strictEqual(vs.current(), 'shell');
    assert.strictEqual(vs.previous(), null);
    assert.strictEqual(vs.set(vs.VIEW.WOW, 'wow L'), 'wow');
    assert.strictEqual(vs.current(), 'wow');
    assert.strictEqual(vs.previous(), 'shell');
    assert.ok(vs.is(vs.VIEW.WOW));
    assert.strictEqual(vs.label(), ':wow 长命令');
    assert.strictEqual(vs.set(vs.VIEW.MENU, 'repl:m'), 'menu');
    assert.strictEqual(vs.previous(), 'wow');
    assert.strictEqual(vs.set(vs.VIEW.MC, 'server:start'), 'mc');
    assert.strictEqual(vs.previous(), 'menu');
});

check('重复 set 同一视图是 no-op，不触发订阅', () => {
    vs._reset();
    let calls = 0;
    vs.onChange(() => calls++);
    vs.set(vs.VIEW.WOW, 'a');
    vs.set(vs.VIEW.WOW, 'b');
    assert.strictEqual(calls, 1, '重复 set 不应触发订阅');
    assert.strictEqual(vs.previous(), 'shell');
});

check('onChange 收到 next/prev/reason，可取消订阅', () => {
    vs._reset();
    const seen = [];
    const off = vs.onChange((next, prev, reason) => seen.push([next, prev, reason]));
    vs.set(vs.VIEW.MC, 'server:start');
    off();
    vs.set(vs.VIEW.MENU, 'mc:detach:m');
    assert.deepStrictEqual(seen, [['mc', 'shell', 'server:start']]);
});

check('订阅者抛异常不影响状态机', () => {
    vs._reset();
    vs.onChange(() => { throw new Error('boom'); });
    assert.strictEqual(vs.set(vs.VIEW.WEB, 'x'), 'web');
    assert.strictEqual(vs.current(), 'web');
});

check('未知视图 set 抛错', () => {
    vs._reset();
    assert.throws(() => vs.set('lan'), /未知视图/);
    assert.strictEqual(vs.current(), 'shell');
});

check('_reset 归零（供其它测试隔离）', () => {
    vs.set(vs.VIEW.MC, 'x');
    vs._reset();
    assert.strictEqual(vs.current(), 'shell');
    assert.strictEqual(vs.previous(), null);
});

check('view_state.js 只存状态，绝不创建 readline', () => {
    const s = read('view_state.js');
    const code = s.split('\n')
        .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    assert.ok(!/createInterface|require\(['"]readline['"]\)|emitKeypressEvents/.test(code),
        '状态模块不得碰 readline');
});

console.log('\n=== 全仓 readline 租约配对（执行令：单例不被新流转打破）===\n');

const cli = read('cli.js');
const srv = read('server.js');
const tui = read('tui.js');
const itv = read('interactive.js');

check('唯一创建出口：src 里 createInterface(stdin) 只在 stdin_session.js', () => {
    const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
    const offenders = files.filter(f => {
        const s = read(f).split('\n')
            .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
        return /createInterface\(\s*\{[^}]*input:\s*process\.stdin/s.test(s)
            && f !== 'stdin_session.js';
    });
    assert.deepStrictEqual(offenders, []);
});

check('cli.js：claim(\'repl\') 与 lease.release() 成对', () => {
    assert.ok(/claim\(['"]repl['"]/.test(cli), 'REPL 未走单例');
    assert.ok(/await lease\.release\(\)/.test(cli), 'REPL 未归还租约');
    assert.ok(/lease\.released/.test(cli), 'REPL 未处理被接管时的静默让出');
});

check('server.js：server.console 租约有 release，且声明预期前任 repl', () => {
    const i = srv.indexOf('_createConsoleRl()');
    const body = srv.slice(i, i + 700);
    assert.ok(/acquireSync\(['"]server\.console['"]/.test(body));
    assert.ok(/expectedOwners:\s*\['repl'\]/.test(body), '未声明设计内交接');
    assert.ok(/async _releaseConsoleRl\(\)/.test(srv), '缺统一释放入口');
    assert.ok(/await lease\.release\(\)/.test(srv), 'console 租约未归还');
});

check('server.js：:wow 长命令视图的 claim(\'server.repl\') 有 release', () => {
    // 必须定位到方法定义，不能撞上更早的调用点 await this._enterReplFromConsole();
    const i = srv.indexOf('async _enterReplFromConsole()');
    const body = srv.slice(i, i + 2600);
    assert.ok(/claim\(['"]server\.repl['"]/.test(body), ':wow 未走单例');
    assert.ok(/await lease\.release\(\)/.test(body), ':wow 租约未归还');
});

check('server.js：_detachConsole 先释放再切视图，绝不 stop()', () => {
    const i = srv.indexOf('_detachConsole(target)');
    const body = srv.slice(i, i + 1200);
    assert.ok(/await this\._releaseConsoleRl\(\)/.test(body), '未先让出 stdin');
    assert.ok(!/this\.stop\(\)/.test(body), '安全退场里绝不能停服');
});

check('tui.js：keyboard 租约在 suspend / close 都有 release', () => {
    assert.ok(/acquireSync\(['"]tui\.keyboard['"]/.test(tui));
    // 精确定位方法定义：文件头注释里也有 ``suspend()`` / ``close()`` 字样，
    // 直接 indexOf('suspend()') 会撞上注释而取到错误窗口。
    const si = tui.indexOf('suspend() {');
    const ci = tui.indexOf('close() {');
    assert.ok(si > 0 && ci > 0, '未找到 suspend / close 方法定义');
    const susp = tui.slice(si, si + 900);
    const close = tui.slice(ci, ci + 900);
    assert.ok(/lease\.release\(\)/.test(susp), 'suspend 未归还 keyboard 租约');
    assert.ok(/lease\.release\(\)/.test(close), 'close 未归还 keyboard 租约');
});

check('tui.js：askLine 租约在 fin() 里归还', () => {
    assert.ok(/acquireSync\(['"]tui\.askLine['"]/.test(tui));
    assert.ok(/lease\.release\(\)/.test(tui), 'askLine 未归还租约');
});

check('interactive.js：菜单 readline 包装 close 自动还租约', () => {
    assert.ok(/acquireSync\(['"]interactive\.menu['"]/.test(itv));
    assert.ok(/release\(\)/.test(itv), '菜单租约未归还');
});

console.log(`\n==================================================`);
console.log(fail ? `❌ 通过 ${pass} 项，失败 ${fail} 项` : `✅ 全部通过：${pass} 项`);
process.exit(fail ? 1 : 0);
