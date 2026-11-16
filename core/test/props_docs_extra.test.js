/**
 * 实例配置「其他配置」中文翻译回归
 *
 * server_props.js 的 7 个分组只覆盖常用键，未分组的键落在页面「其他配置」卡片。
 * 此前 props_docs.js 的词库与分组一一对应，导致「其他配置」里的键只显示英文原名。
 * 本测试锁定：常见「其他」键也有中文名 + 说明，且经 /api/props 的 allDocs() 透传。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const Docs = require(path.join(SRC, 'props_docs'));
const Props = require(path.join(SRC, 'server_props'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// 这批键都不在任何分组里，正是「其他配置」卡片的来源
const EXTRA_KEYS = [
    'enable-status', 'hide-online-players', 'sync-chunk-writes', 'spawn-radius',
    'initial-tick-limit', 'pause-when-empty-seconds', 'allow-end',
    'function-permission-level', 'teleport-target-radius', 'resource-pack-prompt',
    'resource-pack-id', 'enable-jmx-monitoring', 'text-filtering-config',
    'text-filtering-version', 'rate-limit', 'enable-metrics'
];

console.log('\n— 实例配置「其他配置」中文翻译 —\n');

check('每个「其他」键都有中文名与说明', () => {
    for (const key of EXTRA_KEYS) {
        const d = Docs.docOf(key);
        if (!d) throw new Error(`${key} 无翻译`);
        if (!d.label || !/[\u4e00-\u9fa5]/.test(d.label)) throw new Error(`${key} 中文名异常: ${d.label}`);
        if (!d.desc || !/[\u4e00-\u9fa5]/.test(d.desc)) throw new Error(`${key} 中文说明异常: ${d.desc}`);
    }
});

check('这批键确实不在任何分组里（属于「其他配置」）', () => {
    const grouped = new Set(Props.GROUPS.flatMap(g => g.keys));
    for (const key of EXTRA_KEYS) {
        if (grouped.has(key)) throw new Error(`${key} 已在分组里，不应算「其他」`);
    }
});

check('原 7 分组的键仍全部有翻译', () => {
    const all = Docs.allDocs();
    for (const g of Props.GROUPS) {
        for (const key of g.keys) {
            if (!all[key]) throw new Error(`分组键 ${key} 缺翻译`);
        }
    }
});

check('allDocs 透传全部词条（含新增）', () => {
    const all = Docs.allDocs();
    for (const key of EXTRA_KEYS) {
        if (!all[key] || all[key].key !== key) throw new Error(`allDocs 缺 ${key}`);
    }
    if (Object.keys(all).length < 60) throw new Error(`词条数偏少: ${Object.keys(all).length}`);
});

check('docOf 对未知自定义键回退 null（前端只显示键名）', () => {
    if (Docs.docOf('totally-custom-key') !== null) throw new Error('未知键应返回 null');
});

check('前端 fieldHtml 用 docs[key] 渲染中文名（两份文件一致）', () => {
    const web = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'props.html'), 'utf8');
    const theme = fs.readFileSync(path.join(__dirname, '..', '..', 'themes', 'default', 'props.html'), 'utf8');
    if (web !== theme) throw new Error('web/ 与 themes/default/ 的 props.html 不一致');
    if (!/return docs && docs\[key\] \? docs\[key\] : null/.test(web)) throw new Error('前端 docOf 未按 key 查字典');
    if (!/const doc = docOf\(key\)/.test(web)) throw new Error('前端未调用 docOf');
    if (!/doc \? doc\.label : key/.test(web)) throw new Error('前端未用中文名作标签');
});

check('端到端：含「其他」键的 properties 落到 others 且命中翻译', () => {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-props-docs-'));
    try {
        fs.writeFileSync(path.join(dir, 'server.properties'), [
            'motd=分组内',
            'enable-status=true',
            'sync-chunk-writes=false',
            'rate-limit=0',
            'totally-custom-key=xyz',
            ''
        ].join('\n'));
        const r = Props.readProps(dir);
        const othersKeys = r.others.map(o => o.key);
        for (const k of ['enable-status', 'sync-chunk-writes', 'rate-limit', 'totally-custom-key']) {
            if (!othersKeys.includes(k)) throw new Error(`${k} 未落入 others`);
        }
        const translated = r.others.filter(o => Docs.docOf(o.key)).map(o => o.key);
        if (!translated.includes('enable-status')) throw new Error('enable-status 未命中翻译');
        if (translated.includes('totally-custom-key')) throw new Error('未知键不应命中翻译');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
if (failed) process.exitCode = 1;
