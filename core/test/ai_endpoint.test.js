/**
 * AI 分析端点容错 + 服务商预设测试（feat/ai-provider）
 * - normalizeApiUrl：裸域名补全 /v1/chat/completions；已含 /vN 版本段只补 /chat/completions；
 *   已含完整端点幂等；空值走官方默认；尾斜杠 / query 参数处理。
 * - resolveAiEndpoint：显式入参 > provider 预设 > 内置默认；custom 不套预设；
 *   未知 provider 回落 custom；豆包空模型回落默认。
 * - 与 config_schema / config 默认值的一致性（provider 是合法 select 键、默认 custom）。
 *
 * 纯函数测试：不联网、不读真实配置、无副作用。
 * 运行：cd core && node test/ai_endpoint.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'src');
const {
    AI_PROVIDERS,
    DEFAULT_API_URL,
    DEFAULT_MODEL,
    normalizeApiUrl,
    resolveAiEndpoint
} = require('../src/ai_endpoint');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('\n=== ai_endpoint：URL 归一化 ===');

check('裸域名补全 /v1/chat/completions', () => {
    assert.strictEqual(normalizeApiUrl('https://api.deepseek.com'), 'https://api.deepseek.com/v1/chat/completions');
});

check('尾斜杠不产生双斜杠', () => {
    assert.strictEqual(normalizeApiUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/v1/chat/completions');
});

check('已含 /v1 → 只补 /chat/completions（不重复 /v1）', () => {
    assert.strictEqual(normalizeApiUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
    assert.strictEqual(normalizeApiUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1/chat/completions');
});

check('智谱 /api/paas/v4 → 补 /chat/completions，不误加 /v1', () => {
    assert.strictEqual(normalizeApiUrl('https://open.bigmodel.cn/api/paas/v4'), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
});

check('豆包 /api/v3 → 补 /chat/completions', () => {
    assert.strictEqual(normalizeApiUrl('https://ark.cn-beijing.volces.com/api/v3'), 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
});

check('通义 /compatible-mode/v1 → 补 /chat/completions', () => {
    assert.strictEqual(normalizeApiUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
});

check('已含完整 /v1/chat/completions → 幂等原样', () => {
    const url = 'https://api.openai.com/v1/chat/completions';
    assert.strictEqual(normalizeApiUrl(url), url);
    assert.strictEqual(normalizeApiUrl(normalizeApiUrl(url)), url);
});

check('已含 /chat/completions（无 /v1）→ 幂等原样', () => {
    const url = 'https://api.deepseek.com/chat/completions';
    assert.strictEqual(normalizeApiUrl(url), url);
});

check('query 参数保留且不干扰路径判断', () => {
    assert.strictEqual(normalizeApiUrl('https://api.deepseek.com/v1?x=1'), 'https://api.deepseek.com/v1/chat/completions?x=1');
    assert.strictEqual(normalizeApiUrl('https://api.deepseek.com/v1/chat/completions?x=1'), 'https://api.deepseek.com/v1/chat/completions?x=1');
});

check('空值 / 非字符串 → 官方默认端点', () => {
    assert.strictEqual(normalizeApiUrl(null), DEFAULT_API_URL);
    assert.strictEqual(normalizeApiUrl(''), DEFAULT_API_URL);
    assert.strictEqual(normalizeApiUrl('   '), DEFAULT_API_URL);
    assert.strictEqual(normalizeApiUrl(undefined), DEFAULT_API_URL);
});

check('大小写不敏感：/CHAT/COMPLETIONS 亦判为完整', () => {
    assert.strictEqual(normalizeApiUrl('https://x.com/v1/CHAT/COMPLETIONS'), 'https://x.com/v1/CHAT/COMPLETIONS');
});

console.log('\n=== ai_endpoint：provider 预设解析 ===');

check('deepseek 预设：URL + 模型一次填好', () => {
    const r = resolveAiEndpoint({ provider: 'deepseek' });
    assert.strictEqual(r.apiUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.strictEqual(r.model, 'deepseek-chat');
    assert.strictEqual(r.presetUsed, true);
    assert.strictEqual(r.presetLabel, 'DeepSeek');
});

check('glm 预设：/api/paas/v4 完整端点', () => {
    const r = resolveAiEndpoint({ provider: 'glm' });
    assert.strictEqual(r.apiUrl, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    assert.strictEqual(r.model, 'glm-4-flash');
});

check('qwen / kimi / ollama / openai 预设均登记', () => {
    assert.ok(resolveAiEndpoint({ provider: 'qwen' }).apiUrl.includes('compatible-mode/v1'));
    assert.ok(resolveAiEndpoint({ provider: 'kimi' }).apiUrl.includes('moonshot.cn/v1'));
    assert.ok(resolveAiEndpoint({ provider: 'ollama' }).apiUrl.includes('localhost:11434'));
    assert.ok(resolveAiEndpoint({ provider: 'openai' }).apiUrl.includes('api.openai.com'));
});

check('显式入参优先于预设（URL 仍归一化）', () => {
    const r = resolveAiEndpoint({ provider: 'deepseek', apiUrl: 'https://my.proxy.com', model: 'my-model' });
    assert.strictEqual(r.apiUrl, 'https://my.proxy.com/v1/chat/completions');
    assert.strictEqual(r.model, 'my-model');
});

check('custom 不套预设，空值走内置默认', () => {
    const r = resolveAiEndpoint({ provider: 'custom' });
    assert.strictEqual(r.apiUrl, DEFAULT_API_URL);
    assert.strictEqual(r.model, DEFAULT_MODEL);
    assert.strictEqual(r.presetUsed, false);
});

check('未知 provider 回落 custom（fail-safe 不 crashes）', () => {
    const r = resolveAiEndpoint({ provider: 'not-exist' });
    assert.strictEqual(r.provider, 'custom');
    assert.strictEqual(r.presetUsed, false);
});

check('豆包模型名为空 → 回落默认模型', () => {
    const r = resolveAiEndpoint({ provider: 'doubao' });
    assert.ok(r.apiUrl.includes('api/v3'));
    assert.strictEqual(r.model, DEFAULT_MODEL);
});

check('只给裸域名 apiUrl（无 provider）→ 自动补全', () => {
    const r = resolveAiEndpoint({ apiUrl: 'https://api.deepseek.com' });
    assert.strictEqual(r.apiUrl, 'https://api.deepseek.com/v1/chat/completions');
});

check('预设 URL 经归一化后仍幂等', () => {
    for (const [key, p] of Object.entries(AI_PROVIDERS)) {
        if (!p.apiUrl) continue;
        assert.strictEqual(normalizeApiUrl(p.apiUrl), p.apiUrl, `${key} 预设 URL 非稳定态`);
    }
});

console.log('\n=== ai_endpoint：与配置/schema 一致性 ===');

check('config 默认值含 ai.provider 且为 custom', () => {
    const src = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
    assert.ok(/ai:\s*\{[\s\S]{0,120}?provider:\s*'custom'/.test(src), '默认配置缺少 ai.provider=custom');
});

check('config_schema 登记 ai.provider 为 select', () => {
    const schema = require('../src/config_schema');
    const f = schema.listFields().find(x => x.key === 'ai.provider');
    assert.ok(f, 'ai.provider 未登记');
    assert.strictEqual(f.type, 'select');
    assert.ok(f.options.some(o => o.value === 'deepseek'), '缺少 deepseek 选项');
    assert.ok(f.options.some(o => o.value === 'custom'), '缺少 custom 选项');
});

check('schema 选项与 AI_PROVIDERS key 一一对应', () => {
    const schema = require('../src/config_schema');
    const f = schema.listFields().find(x => x.key === 'ai.provider');
    const schemaKeys = f.options.map(o => o.value).sort();
    const providerKeys = Object.keys(AI_PROVIDERS).sort();
    assert.deepStrictEqual(schemaKeys, providerKeys, 'schema 选项与预设表不一致');
});

check('log_handler 使用 resolveAiEndpoint（真正接入请求路径）', () => {
    const src = fs.readFileSync(path.join(SRC, 'log_handler.js'), 'utf8');
    assert.ok(/resolveAiEndpoint\(/.test(src), 'analyze 未调用 resolveAiEndpoint');
    assert.ok(/require\('\.\/ai_endpoint'\)/.test(src), '未引入 ai_endpoint');
});

check('CLI logs analyze 暴露 --provider 选项', () => {
    const src = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');
    assert.ok(/--provider <name>/.test(src), '缺少 --provider 选项');
});

console.log(`\n通过 ${passed} 项，失败 ${failed} 项\n`);
process.exit(failed ? 1 : 0);
