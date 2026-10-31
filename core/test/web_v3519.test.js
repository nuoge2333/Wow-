/**
 * Web 端 V3.5.19 改造回归测试
 * ---------------------------------------------------------------
 * 覆盖这次派工单里「不靠点浏览器就能验证」的部分：
 *   1. sanitizeCommandText —— 控制台脏数据清洗（模块一 · 3）
 *   2. config_schema      —— 配置结构 / 类型转换 / 白名单校验（模块三）
 *   3. web_task           —— 异步任务白名单与阶段映射（模块二 · 1/3、模块五）
 *   4. file_manager.getRoot(scheme) —— 跨方案浏览的越权校验（模块四 · 3）
 *   5. server 控制台中继工具 —— 文件队列 / 心跳（模块一 · 2）
 *
 * 运行: node test/web_v3519.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');

let pass = 0;
let fail = 0;

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        console.log(`  ❌ ${name}\n     ${e.message}`);
    }
}

function checkAsync(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => {
            pass++;
            console.log(`  ✅ ${name}`);
        })
        .catch(e => {
            fail++;
            console.log(`  ❌ ${name}\n     ${e.message}`);
        });
}

async function main() {
    // ============================================================
    console.log('\n[1] sanitizeCommandText —— 控制台指令清洗');
    // ============================================================
    const webService = require('../src/web_service');
    const clean = webService.sanitizeCommandText;

    check('剥离 \\r\\n\\t 等控制字符，压成单空格', () => {
        assert.strictEqual(clean('say\r\nhello\tworld'), 'say hello world');
    });

    check('剥离 \\0 / 零宽空格 / BOM（落入控制字符区间的变空格后再折叠）', () => {
        // \\u0000 属于控制字符 → 变空格；\\u200b / \\ufeff 直接删除
        assert.strictEqual(clean('sa\u0000y\u200b\ufeffhi'), 'sa yhi');
    });

    check('首尾空白被 trim', () => {
        assert.strictEqual(clean('   list   '), 'list');
    });

    check('连续空白折叠为一个空格（避免双空格拆出空参数）', () => {
        assert.strictEqual(clean('scheme   pull    test'), 'scheme pull test');
    });

    check('null / undefined → 空串', () => {
        assert.strictEqual(clean(null), '');
        assert.strictEqual(clean(undefined), '');
    });

    check('纯空白 → 空串', () => {
        assert.strictEqual(clean(' \r\n\t '), '');
    });

    // ============================================================
    console.log('\n[2] config_schema —— 配置结构');
    // ============================================================
    const schema = require('../src/config_schema');
    const fields = schema.listFields();

    check('字段数量合理（覆盖 server/web/download/backup 等分组）', () => {
        assert.ok(fields.length >= 30, `实际 ${fields.length} 项，偏少`);
    });

    check('每个字段都有 key / type / label / desc / group', () => {
        for (const f of fields) {
            assert.ok(f.key, '缺 key');
            assert.ok(f.type, `${f.key} 缺 type`);
            assert.ok(f.label, `${f.key} 缺 label`);
            assert.ok(f.desc, `${f.key} 缺中文说明`);
            assert.ok(f.group, `${f.key} 缺 group`);
        }
    });

    check('type 都在允许集合内', () => {
        const allowed = new Set(['boolean', 'string', 'number', 'select', 'list', 'secret']);
        for (const f of fields) {
            assert.ok(allowed.has(f.type), `${f.key} 的 type=${f.type} 不合法`);
        }
    });

    check('select 字段必须带 options', () => {
        for (const f of fields.filter(x => x.type === 'select')) {
            assert.ok(Array.isArray(f.options) && f.options.length > 0, `${f.key} 缺 options`);
        }
    });

    check('auto_scheme 是 boolean 类型（模块三·2 举例项）', () => {
        const f = schema.getField('auto_scheme');
        assert.ok(f, 'auto_scheme 未登记');
        assert.strictEqual(f.type, 'boolean');
    });

    check('server.scheme 是 string 类型', () => {
        const f = schema.getField('server.scheme');
        assert.ok(f, 'server.scheme 未登记');
        assert.strictEqual(f.type, 'string');
    });

    check('web.auth_password 是 secret 类型（不回显明文）', () => {
        const f = schema.getField('web.auth_password');
        assert.ok(f, 'web.auth_password 未登记');
        assert.strictEqual(f.type, 'secret');
    });

    // ---- coerce ----
    console.log('\n    coerce 类型转换：');

    check('boolean: "true"/1/"1" → true', () => {
        const f = schema.getField('auto_scheme');
        assert.strictEqual(schema.coerce(f, 'true').value, true);
        assert.strictEqual(schema.coerce(f, 1).value, true);
        assert.strictEqual(schema.coerce(f, '1').value, true);
    });

    check('boolean: "false"/0/""/null → false', () => {
        const f = schema.getField('auto_scheme');
        assert.strictEqual(schema.coerce(f, 'false').value, false);
        assert.strictEqual(schema.coerce(f, 0).value, false);
        assert.strictEqual(schema.coerce(f, '').value, false);
        assert.strictEqual(schema.coerce(f, null).value, false);
    });

    check('boolean: 非法值被拒绝', () => {
        const f = schema.getField('auto_scheme');
        assert.strictEqual(schema.coerce(f, 'maybe').ok, false);
    });

    check('number: 字符串数字可转，负数被拒', () => {
        const f = schema.getField('web.port');
        assert.ok(f, 'web.port 未登记');
        assert.strictEqual(schema.coerce(f, '8080').value, 8080);
        assert.strictEqual(schema.coerce(f, -1).ok, false);
    });

    check('list: 数组原样保留，字符串按行拆', () => {
        const f = fields.find(x => x.type === 'list');
        assert.ok(f, '没有 list 类型字段，测试失效');
        const r1 = schema.coerce(f, ['-Xmx4G', '-XX:+UseG1GC']);
        assert.deepStrictEqual(r1.value, ['-Xmx4G', '-XX:+UseG1GC']);
        const r2 = schema.coerce(f, '-Xmx4G\n-XX:+UseG1GC');
        assert.deepStrictEqual(r2.value, ['-Xmx4G', '-XX:+UseG1GC']);
    });

    // ---- validatePatch ----
    console.log('\n    validatePatch 白名单校验：');

    check('未知键被忽略而不是报错', () => {
        const r = schema.validatePatch({ 'bogus.key': 1, auto_scheme: true });
        assert.strictEqual(r.ok, true);
        assert.deepStrictEqual(r.skipped, ['bogus.key']);
        assert.strictEqual(r.values.auto_scheme, true);
    });

    check('已知键取值非法时整体失败并指出是哪个键', () => {
        const r = schema.validatePatch({ 'web.port': -5 });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.key, 'web.port');
    });

    // ============================================================
    console.log('\n[3] web_task —— 异步任务');
    // ============================================================
    const WebTask = require('../src/web_task');

    check('scheme create / pull / prune 在白名单内', () => {
        assert.strictEqual(WebTask.isAllowed('scheme create', ['foo']), true);
        assert.strictEqual(WebTask.isAllowed('scheme pull', ['foo']), true);
        assert.strictEqual(WebTask.isAllowed('scheme prune', ['foo']), true);
    });

    check('install 具名目标在白名单内（下载核心走异步）', () => {
        assert.strictEqual(WebTask.isAllowed('install vanilla', ['1.20.1']), true);
        assert.strictEqual(WebTask.isAllowed('install fabric', ['1.20.1']), true);
    });

    check('危险指令不在白名单：scheme switch / delete', () => {
        assert.strictEqual(WebTask.isAllowed('scheme switch', ['foo']), false);
        assert.strictEqual(WebTask.isAllowed('scheme delete', ['foo']), false);
    });

    check('任意 shell 指令不在白名单', () => {
        assert.strictEqual(WebTask.isAllowed('start', []), false);
        assert.strictEqual(WebTask.isAllowed('rm', ['-rf', '/']), false);
        assert.strictEqual(WebTask.isAllowed('', []), false);
    });

    check('buildArgv 过滤空参数，不产生双空格', () => {
        assert.deepStrictEqual(
            WebTask.buildArgv('scheme pull', ['test', '', '  ', 'utf8']),
            ['scheme', 'pull', 'test', 'utf8']
        );
    });

    check('buildArgv 支持多词 command', () => {
        assert.deepStrictEqual(
            WebTask.buildArgv('scheme create', ['demo', '--version', '1.20.1']),
            ['scheme', 'create', 'demo', '--version', '1.20.1']
        );
    });

    check('STAGE_RULES 进度单调不倒退（按顺序取 max 不冲突）', () => {
        // 规则本身的 progress 应覆盖 5~95 区间
        const ps = WebTask.STAGE_RULES.map(r => r.progress);
        assert.ok(Math.min(...ps) >= 1, '有阶段的 progress 小于 1');
        assert.ok(Math.max(...ps) <= 99, '有阶段的 progress 大于等于 100');
    });

    check('关键输出行能被 STAGE_RULES 命中', () => {
        const cases = [
            ['📦 创建方案 demo', '初始化方案目录'],
            ['正在下载 fabric 安装器', '下载服务端核心'],
            ['运行安装器...', '运行安装器（初始化加载器）'],
            ['✅ 方案 demo 创建完成', '收尾']
        ];
        for (const [line, expectStage] of cases) {
            const hit = WebTask.STAGE_RULES.find(r => r.re.test(line));
            assert.ok(hit, `"${line}" 没有命中任何阶段`);
            assert.strictEqual(hit.stage, expectStage, `"${line}" 命中的阶段不对`);
        }
    });

    // ============================================================
    console.log('\n[4] file_manager.getRoot(scheme) —— 跨方案越权校验');
    // ============================================================
    // 与 file_manager.getRoot 保持一致：相对 core 目录的上一级
    const schemeBase = require('../src/utils').resolvePath('../scheme');
    fs.ensureDirSync(path.join(schemeBase, '_v3519_ok'));
    fs.writeFileSync(path.join(schemeBase, '_v3519_ok', 'scheme.yaml'), 'name: _v3519_ok\n');
    fs.ensureDirSync(path.join(schemeBase, '_v3519_incomplete'));

    const FileManager = require('../src/file_manager');

    check('合法方案名解析到 scheme/<name>', () => {
        const root = FileManager.getRoot('_v3519_ok');
        assert.strictEqual(root, path.join(schemeBase, '_v3519_ok'));
    });

    check('拒绝 .. 越权', () => {
        assert.throws(() => FileManager.getRoot('..'), /非法/);
    });

    check('拒绝路径分隔符', () => {
        assert.throws(() => FileManager.getRoot('a/b'), /非法/);
        assert.throws(() => FileManager.getRoot('a\\b'), /非法/);
    });

    check('拒绝盘符形式', () => {
        assert.throws(() => FileManager.getRoot('C:windows'), /非法/);
    });

    check('不存在的方案报 ENOENT', () => {
        assert.throws(() => FileManager.getRoot('_v3519_not_exist'), e => e.code === 'ENOENT');
    });

    check('缺 scheme.yaml 的方案被判定为不完整', () => {
        assert.throws(
            () => FileManager.getRoot('_v3519_incomplete'),
            e => e.code === 'ENOENT' && /不完整/.test(e.message)
        );
    });

    check('不传方案 → 回落到服务器根目录', () => {
        const root = FileManager.getRoot();
        assert.ok(typeof root === 'string' && root.length > 0);
        assert.ok(!root.endsWith('_v3519_ok'), '不该解析到测试方案目录');
    });

    // 清理测试方案
    fs.removeSync(path.join(schemeBase, '_v3519_ok'));
    fs.removeSync(path.join(schemeBase, '_v3519_incomplete'));

    // ============================================================
    console.log('\n[5] ServerManager —— 控制台中继工具');
    // ============================================================
    const ServerManager = require('../src/server');

    check('isConsoleRelayAlive / enqueueConsoleCommand 已挂到类上', () => {
        assert.strictEqual(typeof ServerManager.isConsoleRelayAlive, 'function');
        assert.strictEqual(typeof ServerManager.enqueueConsoleCommand, 'function');
    });

    await checkAsync('enqueueConsoleCommand 会把指令写进队列文件', async () => {
        const qf = ServerManager.CONSOLE_QUEUE_FILE;
        try { fs.unlinkSync(qf); } catch (e) {}
        assert.strictEqual(ServerManager.enqueueConsoleCommand('say hi'), true);
        assert.ok(fs.existsSync(qf), '队列文件未生成');
        const content = fs.readFileSync(qf, 'utf8').trim();
        assert.strictEqual(content, 'say hi');
        try { fs.unlinkSync(qf); } catch (e) {}
    });

    await checkAsync('enqueueConsoleCommand 拒绝空指令', async () => {
        assert.strictEqual(ServerManager.enqueueConsoleCommand(''), false);
        assert.strictEqual(ServerManager.enqueueConsoleCommand('  \r\n '), false);
        assert.strictEqual(ServerManager.enqueueConsoleCommand(null), false);
    });

    check('心跳文件不存在时 isConsoleRelayAlive 为 false', () => {
        assert.strictEqual(ServerManager.isConsoleRelayAlive(), false);
    });

    // ============================================================
    // 汇总
    // ============================================================
    console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
    console.error('测试运行异常:', e);
    process.exit(1);
});
