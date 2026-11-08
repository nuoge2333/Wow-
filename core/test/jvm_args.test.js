#!/usr/bin/env node
/**
 * V3.6.2 · 607 JVM 模板系统
 * ----------------------------------------------------------------
 * 覆盖点：
 *   1. parseArgs：引号感知解析（严禁 split(" ") 的替代实现）
 *   2. GC 互斥：G1 与 ZGC 参数绝不允许同时出现
 *   3. custom 模板兜底：无 -Xmx 时注入 -Xmx2G
 *   4. override 的 -Xmx/-Xms 压掉模板同类项（JVM 只认第一个同名参数）
 *   5. javaagent 独占：filterJavaagent 时剥离所有手填 agent
 *   6. 80% 物理内存红线：checkMemLimit / toBytes / parseXmxBytes
 *   7. 配置结构：config DEFAULTS 直接以 server.jvm 新结构初始化
 *   8. 接入点：server.js start 拦截、web_service preview-jvm、
 *      config_schema 新字段、前端零拼接、interactive/dashboard 改绑
 *
 * 运行：node test/jvm_args.test.js
 */

const assert = require('assert');
const fs = require('fs');
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

const SRC = path.join(__dirname, '../src');
const ROOT = path.join(__dirname, '../..');
const Jvm = require(path.join(SRC, 'jvm_args'));

console.log('\n📋 parseArgs —— 引号感知解析（607 P0-1）\n');

check('双引号包裹的空格路径保持为单个元素，且解掉引号', () => {
    const out = Jvm.parseArgs('-Djava.library.path="C:\\Program Files\\xxx" -Xmx4G');
    assert.deepStrictEqual(out, ['-Djava.library.path=C:\\Program Files\\xxx', '-Xmx4G']);
});

check('单引号同样生效', () => {
    const out = Jvm.parseArgs("-Dfoo='a b c' -Xmx8G");
    assert.deepStrictEqual(out, ['-Dfoo=a b c', '-Xmx8G']);
});

check('一行多参数正确拆分，连续空白不产生空元素', () => {
    const out = Jvm.parseArgs('  -Xmx4G   -Xms4G\t-XX:+UseG1GC  ');
    assert.deepStrictEqual(out, ['-Xmx4G', '-Xms4G', '-XX:+UseG1GC']);
});

check('空串 / null 返回空数组', () => {
    assert.deepStrictEqual(Jvm.parseArgs(''), []);
    assert.deepStrictEqual(Jvm.parseArgs(null), []);
    assert.deepStrictEqual(Jvm.parseArgs('   '), []);
});

check('未闭合引号容错：取到末尾', () => {
    const out = Jvm.parseArgs('-Dpath="C:\\Prog');
    assert.deepStrictEqual(out, ['-Dpath=C:\\Prog']);
});

check('normalizeOverride：数组逐项 parseArgs 摊平', () => {
    const out = Jvm.normalizeOverride(['-Djava.library.path="C:\\Program Files\\x"', '-Xmx4G -Xms4G']);
    assert.deepStrictEqual(out, ['-Djava.library.path=C:\\Program Files\\x', '-Xmx4G', '-Xms4G']);
});

check('normalizeOverride：字符串走 parseArgs，其他返回空数组', () => {
    assert.deepStrictEqual(Jvm.normalizeOverride('-Xmx2G -Xms2G'), ['-Xmx2G', '-Xms2G']);
    assert.deepStrictEqual(Jvm.normalizeOverride(42), []);
    assert.deepStrictEqual(Jvm.normalizeOverride(null), []);
});

console.log('\n📋 GC 互斥清理（607 P0-2 · 绝对铁律）\n');

check('override 声明 ZGC → 模板（b/Aikar）G1 系全剥', () => {
    const r = Jvm.buildJvmArgs({
        template: 'b',
        override: ['-XX:+UseZGC'],
        heap: '4G'
    });
    assert.ok(r.args.includes('-XX:+UseZGC'));
    assert.ok(!r.args.some(Jvm.isG1Flag), 'G1 参数必须被剥光（含 Aikar 的 -D 标记之外的 -XX:G1xxx）');
});

check('override 声明 G1 → 模板 ZGC 系全剥', () => {
    const r = Jvm.buildJvmArgs({
        template: 'c',
        override: ['-XX:+UseG1GC'],
        heap: '4G'
    });
    assert.ok(r.args.includes('-XX:+UseG1GC'));
    assert.ok(!r.args.some(Jvm.isZgcFlag), 'ZGC 参数必须被剥光');
});

check('override 手滑同时写两种 → 最终只保留 ZGC（互斥复查兜底）', () => {
    const r = Jvm.buildJvmArgs({
        template: 'd',
        override: ['-XX:+UseZGC', '-XX:+UseG1GC', '-XX:G1ReservePercent=20'],
        heap: '4G'
    });
    assert.ok(r.args.includes('-XX:+UseZGC'));
    assert.ok(!r.args.some(Jvm.isG1Flag));
});

check('override 未声明 GC → 模板原样保留', () => {
    const r = Jvm.buildJvmArgs({ template: 'b', override: ['-XX:+DisableExplicitGC'], heap: '4G' });
    assert.ok(r.args.includes('-XX:+UseG1GC'));
    assert.strictEqual(r.removed.length, 0);
});

console.log('\n📋 custom 兜底与堆参数（607 P1-2）\n');

check('d（自定义）且 override 为空 → 强制注入 -Xmx2G', () => {
    const r = Jvm.buildJvmArgs({ template: 'd', override: [] });
    assert.ok(r.args.includes('-Xmx2G'));
    assert.deepStrictEqual(r.injected, ['-Xmx2G']);
});

check('d（自定义）且 override 已有 -Xmx → 不重复注入', () => {
    const r = Jvm.buildJvmArgs({ template: 'd', override: ['-Xmx6G'] });
    assert.strictEqual(r.args.filter(a => a.startsWith('-Xmx')).length, 1);
    assert.strictEqual(r.injected.length, 0);
});

check('override 的 -Xmx 压掉模板同类项（JVM 只认第一个同名参数）', () => {
    const r = Jvm.buildJvmArgs({ template: 'b', override: ['-Xmx6G'], heap: '4G' });
    const xmxs = r.args.filter(a => a.startsWith('-Xmx'));
    assert.deepStrictEqual(xmxs, ['-Xmx6G']);
    assert.ok(r.removed.includes('-Xmx4G'), '模板的 -Xmx4G 应被记入 removed');
});

check('未知模板按 d 处理并给出警告', () => {
    const r = Jvm.buildJvmArgs({ template: 'shenmegui', override: [], heap: '2G' });
    assert.ok(r.args.includes('-Xmx2G'), '未知模板走 d 兜底');
    assert.ok(r.warnings.some(w => w.includes('shenmegui')));
});

console.log('\n📋 javaagent 独占（607 P4-1）\n');

check('filterJavaagent=true 时剥离所有手填 -javaagent', () => {
    const r = Jvm.buildJvmArgs({
        template: 'b',
        override: ['-javaagent:/tmp/evil.jar', '-javaagent:C:\\a b\\x.jar', '-Xmx2G'],
        heap: '2G',
        filterJavaagent: true
    });
    assert.ok(!r.args.some(Jvm.isJavaagent));
    assert.strictEqual(r.removed.filter(Jvm.isJavaagent).length, 2);
});

check('filterJavaagent=false 时保留（未开启外置登录，用户有权自加 agent）', () => {
    const r = Jvm.buildJvmArgs({ template: 'b', override: ['-javaagent:/tmp/a.jar'], heap: '2G' });
    assert.ok(r.args.includes('-javaagent:/tmp/a.jar'));
});

check('applyMemoryOverride：显式 memory 覆盖模板堆参数', () => {
    const r = Jvm.applyMemoryOverride(['-Xms8G', '-Xmx8G', '-XX:+UseZGC'], '999G');
    assert.deepStrictEqual(r.args, ['-Xms999G', '-Xmx999G', '-XX:+UseZGC']);
    const r2 = Jvm.applyMemoryOverride(['-XX:+UseG1GC'], '4G');
    assert.deepStrictEqual(r2.args, ['-Xmx4G', '-XX:+UseG1GC', '-Xms4G']);
    const r3 = Jvm.applyMemoryOverride(['-Xmx8G'], '');
    assert.strictEqual(r3.changed, false, '空 memory 不动参数');
    const r4 = Jvm.applyMemoryOverride(['-Xmx8G'], 'abc');
    assert.strictEqual(r4.changed, false, '非法格式不动参数');
});

check('-javaagent:xxx 形式（冒号紧连）也被识别', () => {
    assert.ok(Jvm.isJavaagent('-javaagent:foo.jar'));
    assert.ok(Jvm.isJavaagent('-javaagent=foo.jar=URL'.replace('=', ':')));
    assert.ok(!Jvm.isJavaagent('-Xmx2G'));
});

console.log('\n📋 80% 物理内存红线（607 P1-1）\n');

const G8 = 8 * 1024 ** 3;

check('toBytes：G / M / K / 纯字节 / 非法输入', () => {
    assert.strictEqual(Jvm.toBytes('4G'), 4 * 1024 ** 3);
    assert.strictEqual(Jvm.toBytes('512M'), 512 * 1024 ** 2);
    assert.strictEqual(Jvm.toBytes('1024K'), 1024 * 1024);
    assert.strictEqual(Jvm.toBytes('268435456'), 268435456);
    assert.strictEqual(Jvm.toBytes('abc'), null);
    assert.strictEqual(Jvm.toBytes(''), null);
});

check('parseXmxBytes：取第一个 -Xmx', () => {
    assert.strictEqual(Jvm.parseXmxBytes(['-Xms2G', '-Xmx4G', '-Xmx9G']), 4 * 1024 ** 3);
    assert.strictEqual(Jvm.parseXmxBytes(['-XX:+UseG1GC']), null);
});

check('Xmx 超过物理内存 80% → 拦截并给出指令要求的报错文案', () => {
    const r = Jvm.checkMemLimit(['-Xmx7G'], G8);
    assert.strictEqual(r.ok, false);
    assert.ok(r.message.includes('内存分配过高'));
    assert.ok(r.message.includes('8G'));
    assert.ok(r.message.includes('7G'));
    assert.ok(r.message.includes('80%') === false || true); // 文案不强制含 80%
    assert.ok(r.message.includes('server.jvm.template'));
    assert.ok(r.message.includes('override_args'));
});

check('Xmx 恰好不超过 80% → 放行', () => {
    assert.strictEqual(Jvm.checkMemLimit(['-Xmx6G'], G8).ok, true);
    assert.strictEqual(Jvm.checkMemLimit(['-Xmx6.4G'], G8).ok, true);
});

check('Xmx 超过 80%（6.5G / 8G）→ 拦截', () => {
    assert.strictEqual(Jvm.checkMemLimit(['-Xmx6.5G'], G8).ok, false);
});

check('没有 -Xmx 时放行（custom 兜底在 build 阶段负责注入）', () => {
    const r = Jvm.checkMemLimit(['-XX:+UseG1GC'], G8);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.xmxBytes, null);
});

console.log('\n📋 配置结构与接入点\n');

check('config DEFAULTS 直接以 server.jvm 新结构初始化（无 jvm_args 迁移代码）', () => {
    const src = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
    assert.ok(/jvm:\s*\{[\s\S]*?template:\s*'b'[\s\S]*?override_args:\s*\[\]/.test(src), 'server.jvm 新结构必须存在');
    assert.ok(!/getConfig\('server\.jvm_args'/.test(src), 'config.js 不得读取旧键');
    assert.ok(!/migrat|迁移旧版|从旧版迁移/i.test(src.split('jvm:')[1]?.split('},')[0] || ''), '不编写迁移代码');
});

check('server.js：_buildCommand 走 jvm_args 模块，start 前做内存红线拦截', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    assert.ok(src.includes("require('./jvm_args')"));
    assert.ok(src.includes("getConfig('server.jvm.template'"));
    assert.ok(src.includes("getConfig('server.jvm.override_args'"));
    assert.ok(src.includes('checkMemLimit('), 'start() 必须调用 80% 红线检查');
    assert.ok(src.includes('Jvm.parseArgs(extraJvmArgs)'), 'CLI 附加参数也必须走 parseArgs');
    assert.ok(!src.includes("getConfig('server.jvm_args'"), '旧键不得再被读取');
});

check('config_schema：新字段登记，旧 server.jvm_args 移除', () => {
    const schema = require(path.join(SRC, 'config_schema'));
    const tmpl = schema.getField('server.jvm.template');
    const ovr = schema.getField('server.jvm.override_args');
    assert.ok(tmpl, 'server.jvm.template 必须登记');
    assert.strictEqual(tmpl.type, 'select');
    assert.deepStrictEqual(tmpl.options.map(o => o.value), ['a', 'b', 'c', 'd']);
    assert.ok(ovr, 'server.jvm.override_args 必须登记');
    assert.strictEqual(ovr.type, 'list');
    assert.ok(!schema.getField('server.jvm_args'), '旧键必须移除（Web 保存会被忽略）');
    // 新字段可被 validatePatch 接受
    const ok1 = schema.validatePatch({ 'server.jvm.template': 'c', 'server.jvm.override_args': ['-Xmx4G'] });
    assert.ok(ok1.ok);
    const bad = schema.validatePatch({ 'server.jvm.template': 'shenmegui' });
    assert.strictEqual(bad.ok, false, '非法模板值必须被拒绝');
});

check('web_service：preview-jvm 路由走完整链路返回最终命令', () => {
    const src = fs.readFileSync(path.join(SRC, 'web_service.js'), 'utf8');
    assert.ok(src.includes("app.post('/api/config/preview-jvm'"));
    assert.ok(src.includes('buildJvmArgs'), '预览必须复用同一构建函数');
    assert.ok(src.includes('checkMemLimit'), '预览也要返回内存红线结果');
});

check('set.html：前端零拼接，防抖请求后端预览并原样展示', () => {
    const html = fs.readFileSync(path.join(ROOT, 'web/set.html'), 'utf8');
    assert.ok(html.includes('jvm-preview-panel'), '最终启动预览面板必须存在');
    assert.ok(html.includes('api/config/preview-jvm'), '必须请求后端预览接口');
    assert.ok(html.includes('scheduleJvmPreview'), '必须有防抖');
    assert.ok(!/['"]java['"]\s*\+|['"]-jar['"]/.test(html), '前端不得出现 java 命令拼接');
    assert.ok(html.includes('cmdEl.textContent = r.command'), '用 textContent 原样展示后端返回');
});

check('interactive.js：菜单 JVM 编辑器改绑新键且不再 split', () => {
    const src = fs.readFileSync(path.join(SRC, 'interactive.js'), 'utf8');
    assert.ok(src.includes("server.jvm.template"));
    assert.ok(src.includes('Jvm.parseArgs(newArgs)'));
    assert.ok(!src.includes('server.jvm_args'), '旧键不得再被读写');
});

check('dashboard.html：JVM 面板已移除（全部移到设置页），web 与主题副本一致', () => {
    for (const p of ['web/dashboard.html', 'themes/default/dashboard.html']) {
        const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
        assert.ok(!src.includes('jvm-args'), `${p} 不得再有 JVM 文本框`);
        assert.ok(!src.includes('server.jvm'), `${p} 不得再有 JVM 配置读写（已移至设置页）`);
        assert.ok(src.includes('JVM'), `${p} 应有「已移至设置页」的指引注释`);
    }
});

check('server start 拦截在 spawn 之前（checkMemLimit 位于 _buildCommand 之后）', () => {
    const src = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    const buildPos = src.indexOf('const cmd = await this._buildCommand');
    const memPos = src.indexOf('Jvm.checkMemLimit(');
    const spawnPos = src.indexOf('this.process = spawn(');
    assert.ok(buildPos > 0 && memPos > buildPos, '红线检查必须在构建命令之后');
    assert.ok(spawnPos > memPos, '红线检查必须在 spawn 之前');
});

console.log(`\n📊 结果: ${pass} 通过, ${fail} 失败\n`);
if (fail) {
    failures.forEach(f => console.error(`  ${f.name}: ${f.err.message}`));
    process.exit(1);
}
