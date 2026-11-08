/**
 * 模组表单引擎测试（V3.6.2 · 608 进阶）
 *
 * 覆盖：
 *   - schema_store：加载、校验、用户库覆盖官方库、导入解析、删除保护
 *   - schema_engine：五格式定位与行级替换（注释/缩进/未映射键保留）、
 *     类型强转、范围校验、missing 上报、原子写、边界隔离、大文件降级
 *   - Web API 与页面存在性
 */

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const Store = require('../src/schema_store');
const Engine = require('../src/schema_engine');

// ---------------------------------------------------------------------------
// 测试现场：临时方案目录 + 临时用户扩展库 + 临时官方库（用环境变量注入）
// ---------------------------------------------------------------------------

const tmpScheme = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-scheme-'));
const tmpCustom = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-custom-'));
const tmpBuiltin = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-builtin-'));

process.env.WOW_MODCFG_ROOT = tmpScheme;
process.env.WOW_CUSTOM_SCHEMAS_DIR = tmpCustom;
// 官方库是模块常量（BUILTIN_DIR），无法注入 —— 用 loadFile 的路径判断做不了
// 假官方库，改为直接构造 schema 对象测「用户覆盖官方」用真实官方库里的 create.json
// 拷进用户库后断言 display_name 被覆盖。

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

function w(rel, content) {
    const abs = path.join(tmpScheme, rel);
    fs.ensureDirSync(path.dirname(abs));
    fs.writeFileSync(abs, content, 'utf8');
}
function r(rel) {
    return fs.readFileSync(path.join(tmpScheme, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// schema_store
// ---------------------------------------------------------------------------

console.log('\n📦 schema_store');

check('loadAll 加载官方内置库且无错误', () => {
    delete process.env.WOW_CUSTOM_SCHEMAS_DIR;
    const r = Store.loadAll();
    process.env.WOW_CUSTOM_SCHEMAS_DIR = tmpCustom;
    assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
    const ids = r.schemas.map(s => s.mod_id);
    for (const id of ['create', 'luckperms', 'coreprotect', 'waystones', 'alexsmobs']) {
        assert.ok(ids.includes(id), `缺少 ${id}`);
    }
});

check('get 支持中文显示名模糊匹配', () => {
    const s = Store.get('机械动力');
    assert.ok(s && s.mod_id === 'create');
    assert.ok(Store.get('CREATE') && Store.get('CREATE').mod_id === 'create');
    assert.strictEqual(Store.get('不存在的模组xyz'), null);
});

check('validate 拒绝缺 mod_id / 非法路径 / 重复字段', () => {
    assert.ok(!Store.validate({}).ok);
    const bad1 = Store.validate({
        mod_id: 'x', config_files: [{ path: '/abs/path.toml', fields: [{ key: 'a' }] }]
    });
    assert.ok(!bad1.ok);
    const bad2 = Store.validate({
        mod_id: 'x', config_files: [{ path: 'a/../b.toml', fields: [{ key: 'a' }] }]
    });
    assert.ok(!bad2.ok);
    const bad3 = Store.validate({
        mod_id: 'x',
        config_files: [{ path: 'a.toml', fields: [{ key: 'k' }, { key: 'k' }] }]
    });
    assert.ok(!bad3.ok);
    const bad4 = Store.validate({
        mod_id: 'x', config_files: [{ path: 'a.toml', fields: [{ key: 'k', type: ' nonsense ' }] }]
    });
    // 未知类型降级 string 并给 warning，不算失败
    assert.ok(bad4.ok && bad4.warnings.length === 1);
});

check('用户扩展库覆盖官方库（同名 mod_id）', () => {
    const official = JSON.parse(fs.readFileSync(
        path.join(Store.BUILTIN_DIR, 'create.json'), 'utf8'));
    official.display_name = '机械动力（用户改版）';
    fs.writeJsonSync(path.join(tmpCustom, 'create.json'), official);
    const s = Store.get('create');
    assert.strictEqual(s.display_name, '机械动力（用户改版）');
    assert.strictEqual(s._origin, 'custom');
    // 删掉恢复
    fs.removeSync(path.join(tmpCustom, 'create.json'));
    assert.strictEqual(Store.get('create')._origin, 'builtin');
});

check('parseImport 校验 JSON 文本并给出中文错误', () => {
    assert.ok(!Store.parseImport('{oops').ok);
    assert.ok(!Store.parseImport('{"mod_id":"x"}').ok, '缺 config_files 应失败');
    const ok1 = Store.parseImport(JSON.stringify({
        mod_id: 'testmod',
        config_files: [{ path: 'config/x.toml', fields: [{ key: 'a.b', label: '甲', type: 'number', min: 1, max: 9, default: 5 }] }]
    }));
    assert.ok(ok1.ok && ok1.schema.config_files[0].format === 'toml');
});

check('saveCustom / removeCustom：原子落盘、官方包删不掉', () => {
    const v = Store.validate({
        mod_id: 'deleteme',
        config_files: [{ path: 'config/d.toml', fields: [{ key: 'k' }] }]
    });
    assert.ok(v.ok);
    const saved = Store.saveCustom(v.schema);
    assert.ok(fs.existsSync(saved.file));
    assert.ok(Store.get('deleteme'));
    assert.ok(Store.removeCustom('deleteme').ok);
    assert.ok(!Store.removeCustom('create').ok, '官方包（用户库无同名文件）应报「没有」');
    assert.ok(!Store.removeCustom('../../etc').ok);
});

// ---------------------------------------------------------------------------
// schema_engine：定位与写回
// ---------------------------------------------------------------------------

console.log('\n⚙️ schema_engine');

const TOML_TEXT = [
    '# Create 服务端配置',
    '[kinetics]',
    'maxEntityCramming = 24 # 最大实体数',
    'stressCapacity = true',
    '',
    '[kinetics.contraptions]',
    'maxBlocksMoved = 2048',
    '',
    '[trains]',
    'maxTrainLength = 32'
].join('\n') + '\n';

const TOML_SCHEMA = {
    format: 'toml',
    fields: [
        { key: 'kinetics.maxEntityCramming', type: 'number', min: 1, max: 100 },
        { key: 'kinetics.stressCapacity', type: 'boolean' },
        { key: 'kinetics.contraptions.maxBlocksMoved', type: 'number' },
        { key: 'trains.maxTrainLength', type: 'number' },
        { key: 'ghost.key', type: 'number' }
    ]
};

check('toml 读值：含节表嵌套与行尾注释', () => {
    w('serverconfig/c.toml', TOML_TEXT);
    const r = Engine.readFile('serverconfig/c.toml', TOML_SCHEMA);
    const byKey = new Map(r.entries.map(e => [e.key, e]));
    assert.strictEqual(byKey.get('kinetics.maxEntityCramming').value, 24);
    assert.strictEqual(byKey.get('kinetics.stressCapacity').value, true);
    assert.strictEqual(byKey.get('kinetics.contraptions.maxBlocksMoved').value, 2048);
    assert.strictEqual(byKey.get('trains.maxTrainLength').value, 32);
    assert.deepStrictEqual(r.missing, ['ghost.key']);
});

check('toml 写值：注释、空行、节表结构逐字节保留', () => {
    const before = TOML_TEXT;
    const r = Engine.writeChanges('serverconfig/c.toml', TOML_SCHEMA, {
        'kinetics.maxEntityCramming': 30,
        'kinetics.stressCapacity': false,
        'kinetics.contraptions.maxBlocksMoved': 4096
    });
    assert.ok(r.ok, r.reason);
    const after = r.text;
    // 注释还在
    assert.ok(after.includes('maxEntityCramming = 30 # 最大实体数'));
    // 节表行原样
    assert.ok(after.includes('[kinetics.contraptions]'));
    // 未映射内容原样
    const keep = (s) => s.split('\n').filter(l => l.startsWith('#') || l.startsWith('[')).join('\n');
    assert.strictEqual(keep(before), keep(after).replace('2048', '2048'));
    // ghost.key 没被追加
    assert.ok(!after.includes('ghost'));
});

check('toml 类型与范围：小数写小数、越界拒绝、布尔乱值拒绝', () => {
    w('serverconfig/f.toml', 'x = 1.5\nb = true\n');
    const schema = { format: 'toml', fields: [
        { key: 'x', type: 'number', min: 0, max: 10 },
        { key: 'b', type: 'boolean' }
    ] };
    let r = Engine.writeChanges('serverconfig/f.toml', schema, { x: 2.5 });
    assert.ok(r.ok && r.text.includes('x = 2.5'), r.text);
    r = Engine.writeChanges('serverconfig/f.toml', schema, { x: 11 });
    assert.ok(!r.ok && /不能大于/.test(r.reason));
    r = Engine.writeChanges('serverconfig/f.toml', schema, { x: 'abc' });
    assert.ok(!r.ok && /不是合法数字/.test(r.reason));
    r = Engine.writeChanges('serverconfig/f.toml', schema, { b: 'sometimes' });
    assert.ok(!r.ok && /必须是 true\/false/.test(r.reason));
});

const YML_TEXT = [
    '# EssentialsX',
    'teleport:',
    '  delay: 3',
    '  safety: true',
    'motd: "Welcome!"',
    'max-npcs: 100'
].join('\n') + '\n';

check('yml 缩进与注释 100% 保留', () => {
    w('plugins/P/config.yml', YML_TEXT);
    const schema = { format: 'yml', fields: [
        { key: 'teleport.delay', type: 'number' },
        { key: 'teleport.safety', type: 'boolean' },
        { key: 'motd', type: 'string' }
    ] };
    const r = Engine.writeChanges('plugins/P/config.yml', schema, {
        'teleport.delay': 5, 'teleport.safety': false, 'motd': "Hi \"X\""
    });
    assert.ok(r.ok, r.reason);
    const lines = r.text.split('\n');
    assert.strictEqual(lines[2], '  delay: 5');
    assert.strictEqual(lines[3], '  safety: false');
    assert.strictEqual(lines[4], 'motd: "Hi \\"X\\""');
    assert.ok(r.text.startsWith('# EssentialsX'));
});

const JSON_TEXT = [
    '{',
    '  "general": {',
    '    "debug": false,',
    '    "maxCount": 10,',
    '    "name": "a\\"b"',
    '  },',
    '  "list": [1, 2, 3]',
    '}'
].join('\n') + '\n';

check('json 就地替换：转义与结构不破坏', () => {
    w('config/x.json', JSON_TEXT);
    const schema = { format: 'json', fields: [
        { key: 'general.debug', type: 'boolean' },
        { key: 'general.maxCount', type: 'number' },
        { key: 'general.name', type: 'string' }
    ] };
    const r = Engine.writeChanges('config/x.json', schema, {
        'general.debug': true, 'general.maxCount': 99, 'general.name': 'x"y'
    });
    assert.ok(r.ok, r.reason);
    const parsed = JSON.parse(r.text); // 必须仍是合法 JSON
    assert.strictEqual(parsed.general.debug, true);
    assert.strictEqual(parsed.general.maxCount, 99);
    assert.strictEqual(parsed.general.name, 'x"y');
    assert.deepStrictEqual(parsed.list, [1, 2, 3]);
    assert.ok(r.text.includes('"list": [1, 2, 3]'), '未映射键原样保留');
});

check('properties / conf / txt 三格式扁平与嵌套', () => {
    w('plugins/D/configuration.conf', [
        '# BlueMap',
        'webserver {',
        '  port = 8123',
        '  enabled = true',
        '}',
        'maps {',
        '  color = "#123456"',
        '}'
    ].join('\n') + '\n');
    const conf = { format: 'conf', fields: [
        { key: 'webserver.port', type: 'number' },
        { key: 'maps.color', type: 'string' }
    ] };
    let r = Engine.writeChanges('plugins/D/configuration.conf', conf, { 'webserver.port': 8100 });
    assert.ok(r.ok && r.text.includes('port = 8100'), r.reason);
    assert.ok(r.text.includes('# BlueMap'));

    w('config/rules.conf', 'commandPlayer true\nmaxEntityCramming 24\n');
    const txt = { format: 'txt', fields: [
        { key: 'maxEntityCramming', type: 'number' },
        { key: 'commandPlayer', type: 'boolean' }
    ] };
    r = Engine.writeChanges('config/rules.conf', txt, { maxEntityCramming: 12 });
    assert.ok(r.ok && r.text.includes('maxEntityCramming 12'));
});

check('重复提交同一键：类型基准取最初原值', () => {
    w('serverconfig/dup.toml', 'n = 5\n');
    const schema = { format: 'toml', fields: [{ key: 'n', type: 'number' }] };
    const r = Engine.writeChanges('serverconfig/dup.toml', schema, [
        { key: 'n', value: 50 },
        { key: 'n', value: '60' }   // 第二次传字符串，基准仍是 5（数字）
    ]);
    assert.ok(r.ok, r.reason);
    assert.strictEqual(r.applied.length, 2);
    assert.strictEqual(r.applied[0].oldValue, 5);
    assert.strictEqual(r.applied[1].oldValue, 50, '第二次的 oldValue 是本次替换前的值');
    assert.ok(r.text.includes('n = 60'));
});

check('部分缺失：写入照常、missing 上报', () => {
    w('serverconfig/part.toml', TOML_TEXT);
    const r = Engine.writeChanges('serverconfig/part.toml', TOML_SCHEMA, {
        'kinetics.maxEntityCramming': 48,
        'ghost.key': 1
    });
    assert.ok(r.ok, r.reason);
    assert.strictEqual(r.changed, 1);
    assert.deepStrictEqual(r.missing, ['ghost.key']);
    assert.ok(r.text.includes('maxEntityCramming = 48'));
});

check('未映射键拒绝写入（防误改未翻译配置）', () => {
    const r = Engine.writeChanges('serverconfig/c.toml', TOML_SCHEMA, { 'hacker.key': 1 });
    assert.ok(!r.ok && /Schema 里没有这个键/.test(r.reason));
});

check('同值不写盘（changed=0，无备份产生）', () => {
    // 动态读当前值再原样写回，保证「同值」与前面的测试顺序无关
    const cur = Engine.readKey('serverconfig/c.toml', 'kinetics.maxEntityCramming', 'toml');
    assert.ok(cur.ok);
    const mtimeBefore = fs.statSync(path.join(tmpScheme, 'serverconfig/c.toml')).mtimeMs;
    const r = Engine.writeChanges('serverconfig/c.toml', TOML_SCHEMA,
        { 'kinetics.maxEntityCramming': cur.value });
    assert.strictEqual(r.changed, 0, JSON.stringify(r.applied));
    assert.strictEqual(r.backup, null);
    const mtimeAfter = fs.statSync(path.join(tmpScheme, 'serverconfig/c.toml')).mtimeMs;
    assert.ok(mtimeAfter === mtimeBefore, '文件不应被改动');
});

check('原子写：.bak 备份 + 无 tmp 残留', () => {
    const dir = path.join(tmpScheme, 'serverconfig');
    const r = Engine.writeChanges('serverconfig/c.toml', TOML_SCHEMA, { 'kinetics.maxEntityCramming': 64 });
    assert.ok(r.changed === 1 && r.backup);
    assert.ok(fs.existsSync(path.join(dir, 'c.toml.bak')));
    assert.ok(!fs.readdirSync(dir).some(n => n.includes('.wow-tmp')));
    assert.ok(r.text.includes('maxEntityCramming = 64'));
});

check('snbt 只读拒绝写入', () => {
    w('config/quest.snbt', 'a: 1\n');
    const r = Engine.writeChanges('config/quest.snbt', { format: 'snbt', fields: [{ key: 'a', type: 'number' }] }, { a: 2 });
    assert.ok(!r.ok && /snbt.*不支持写入|不支持写入/.test(r.reason), r.reason);
});

// ---------------------------------------------------------------------------
// 边界隔离
// ---------------------------------------------------------------------------

console.log('\n🛡️ 边界隔离');

check('七连拒：.. / 绝对路径 / 越界目录 / jar / 盘符 / 空 / NUL', () => {
    for (const [p, why] of [
        ['../wow.yaml', ''], ['/etc/passwd', ''], ['C:/windows/system32', ''],
        ['world/level.dat', ''], ['plugins/evil.jar', ''], ['', ''],
        ['config/../wow.yaml', '']
    ]) {
        const r = Engine.resolveInBoundary(p);
        assert.ok(!r.ok, `${p} 应被拒绝`);
    }
});

check('白名单内路径通过', () => {
    for (const p of ['config/a.toml', 'serverconfig/b.yml', 'plugins/C/config.yml']) {
        assert.ok(Engine.resolveInBoundary(p, { mustExist: false }).ok, p);
    }
});

check('符号链接逃逸拒绝', () => {
    const outside = path.join(tmpScheme, '..', 'outside-target.txt');
    fs.writeFileSync(outside, 'secret');
    const link = path.join(tmpScheme, 'config', 'link.yml');
    fs.ensureDirSync(path.dirname(link));
    try { fs.removeSync(link); } catch (e) { /* ignore */ }
    fs.symlinkSync(outside, link);
    const r = Engine.resolveInBoundary('config/link.yml', { mustExist: true });
    assert.ok(!r.ok, '符号链接指向方案外应拒绝');
    fs.removeSync(link);
    fs.removeSync(outside);
});

// ---------------------------------------------------------------------------
// listDir / readFileForEdit（懒加载 + 降级）
// ---------------------------------------------------------------------------

console.log('\n📂 懒加载与降级');

check('listDir 根层只给边界目录', () => {
    const r = Engine.listDir('');
    assert.deepStrictEqual(r.dirs, ['config', 'plugins', 'serverconfig']);
    assert.deepStrictEqual(r.files, []);
});

check('listDir 懒加载一层 + schema 命中标注 + bak 过滤', () => {
    w('serverconfig/create-server.toml', TOML_TEXT);
    const r = Engine.listDir('serverconfig');
    const names = r.files.map(f => f.name);
    assert.ok(names.includes('create-server.toml'));
    assert.ok(!names.some(n => n.endsWith('.bak')), '备份文件不应出现在文件树');
    const c = r.files.find(f => f.name === 'create-server.toml');
    assert.ok(c.schema, 'create-server.toml 应标注 schema 命中');
    assert.strictEqual(c.schema.mod_id, 'create');
});

check('readFileForEdit：大文件降级（>200 行）', () => {
    const lines = [];
    for (let i = 1; i <= 250; i++) lines.push(`k${i} = ${i}`);
    w('serverconfig/big.toml', lines.join('\n') + '\n');
    const r = Engine.readFileForEdit('serverconfig/big.toml');
    assert.strictEqual(r.form_mode, false);
    assert.strictEqual(r.too_big, true);
    assert.ok(/超过 200 行/.test(r.reason));
});

check('readFileForEdit：表单模式 + 截断保护', () => {
    const r = Engine.readFileForEdit('serverconfig/create-server.toml');
    assert.strictEqual(r.form_mode, true, r.reason);
    assert.strictEqual(r.schema.mod_id, 'create');
    assert.ok(r.entries.length <= Engine.FORM_MAX_ENTRIES);
    assert.ok(r.entries.every(e => typeof e.present === 'boolean'));
});

check('readFileForEdit：禁用扩展名与 NUL 二进制双防线', () => {
    // .dat 直接被扩展名黑名单拒绝
    const abs = path.join(tmpScheme, 'config', 'bin.dat');
    fs.writeFileSync(abs, Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]));
    let r = Engine.readFileForEdit('config/bin.dat');
    assert.ok(!r.ok && /\.dat 文件/.test(r.reason));
    // 改成 .toml 但内容含 NUL → NUL 嗅探兜底
    const abs2 = path.join(tmpScheme, 'config', 'evil.toml');
    fs.writeFileSync(abs2, Buffer.from([0x61, 0x20, 0x3d, 0x20, 0x31, 0x00, 0x0a]));
    r = Engine.readFileForEdit('config/evil.toml');
    assert.ok(!r.ok && /二进制/.test(r.reason));
});

check('saveRaw 源码整体保存走同一备份链路', () => {
    const r = Engine.saveRaw('config/x.json', '{\n  "general": { "debug": true, "maxCount": 10, "name": "a\\"b" },\n  "list": [1, 2, 3]\n}\n');
    assert.ok(r.ok);
    assert.ok(fs.existsSync(path.join(tmpScheme, 'config', 'x.json.bak')));
});

// ---------------------------------------------------------------------------
// Web 页面与 API 存在性
// ---------------------------------------------------------------------------

console.log('\n🌐 Web 页面');

check('modcfg.html 存在且含 GUI/Raw 双轨与免责声明', () => {
    for (const p of ['web/modcfg.html', 'themes/default/modcfg.html']) {
        const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
        assert.ok(src.includes('可视化配置'), `${p} 应有 GUI Tab`);
        assert.ok(src.includes('源码编辑'), `${p} 应有 Raw Tab`);
        assert.ok(src.includes('翻译由社区提供'), `${p} 应有免责声明`);
        assert.ok(src.includes('/api/modcfg/save'), `${p} 应调用保存接口`);
        assert.ok(!src.includes('localStorage.getItem(\'wow_token\')'), `${p} token 应读 sessionStorage`);
    }
});

check('left.html 有模组配置入口（两份同步）', () => {
    for (const p of ['web/left.html', 'themes/default/left.html']) {
        const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
        assert.ok(src.includes('data-page="modcfg"'), `${p} 应有菜单入口`);
    }
});

check('set.html 有模组配置库面板与导入模态（两份同步）', () => {
    for (const p of ['web/set.html', 'themes/default/set.html']) {
        const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
        assert.ok(src.includes('/api/schema/list'), `${p} 应有 schema 列表`);
        assert.ok(src.includes('/api/schema/import'), `${p} 应有导入`);
        assert.ok(src.includes('schema-import-modal'), `${p} 应有导入模态`);
    }
});

check('web_service 注册了 schema 与 modcfg 路由', () => {
    const src = fs.readFileSync(path.join(ROOT, 'core/src/web_service.js'), 'utf8');
    for (const route of [
        '/api/schema/list', '/api/schema/import',
        '/api/modcfg/tree', '/api/modcfg/file', '/api/modcfg/save', '/api/modcfg/save-raw'
    ]) {
        assert.ok(src.includes(`'${route}'`), `缺少路由 ${route}`);
    }
});

check('cli.js 注册了 config schema 子命令', () => {
    const src = fs.readFileSync(path.join(ROOT, 'core/src/cli.js'), 'utf8');
    for (const cmd of ["command('list')", "command('show <modId>')", "command('get <modId> <key>')", "command('set <modId> <key> <value>')", "command('import <source>')", "command('remove <modId>')"]) {
        assert.ok(src.includes(cmd), `缺少 ${cmd}`);
    }
});

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

fs.removeSync(tmpScheme);
fs.removeSync(tmpCustom);
fs.removeSync(tmpBuiltin);

console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
