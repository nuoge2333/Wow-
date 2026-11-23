/**
 * AI 分析端点归一化 + 服务商预设
 *
 * 背景：用户常在 ai.api_url 里只填了服务商域名（如 https://api.deepseek.com），
 * 漏掉 /v1/chat/completions，导致 fetch 直接 404/410。本模块在发起请求前
 * 统一兜底，避免用户反复试错。
 *
 * 设计要点：
 * - normalizeApiUrl：幂等。已含 /chat/completions 原样返回；已含 /vN 版本段
 *   则补 /chat/completions；裸域名补 /v1/chat/completions。
 * - AI_PROVIDERS：只存「完整 chat URL + 推荐模型」，选中即把 URL/模型一次填好。
 * - resolveAiEndpoint：provider 非 custom 时用预设覆盖用户留空的 URL/模型；
 *   用户显式填了的值始终优先（约定 > 预设 > 默认）。
 *
 * 纯函数模块：不读配置、不发请求、无副作用，便于单测直接构造。
 */

'use strict';

const DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-3.5-turbo';

// 各家 OpenAI 兼容端点的完整 chat URL（2026-11 核对）。
// 智谱是 /api/paas/v4、通义是 /compatible-mode/v1、豆包是 /api/v3 —— 均非 /v1，
// 所以预设存完整 URL，不依赖 normalizeApiUrl 的路径推断。
const AI_PROVIDERS = Object.freeze({
    custom: {
        label: '自定义 / 兼容 OpenAI',
        apiUrl: null,
        model: null
    },
    openai: {
        label: 'OpenAI',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini'
    },
    deepseek: {
        label: 'DeepSeek',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat'
    },
    qwen: {
        label: '通义千问（百炼兼容模式）',
        apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: 'qwen-plus'
    },
    kimi: {
        label: 'Kimi（月之暗面）',
        apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
        model: 'moonshot-v1-8k'
    },
    glm: {
        label: '智谱 GLM',
        apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        model: 'glm-4-flash'
    },
    doubao: {
        label: '豆包（火山方舟）',
        apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        model: '' // 需在控制台创建推理接入点（ep- 开头），无法给固定模型名
    },
    ollama: {
        label: 'Ollama（本地）',
        apiUrl: 'http://localhost:11434/v1/chat/completions',
        model: 'qwen2.5:7b'
    }
});

/**
 * 把用户填的 api_url 补全为完整 chat completions 端点（幂等）。
 *
 * @param {string} raw 用户原始输入（可为 null / 空串）
 * @returns {string} 完整端点
 */
function normalizeApiUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_API_URL;

    let url = raw.trim();
    // 去尾部斜杠（保留 query/hash 原样）
    let tail = '';
    const cut = url.search(/[?#]/);
    if (cut >= 0) {
        tail = url.slice(cut);
        url = url.slice(0, cut);
    }
    url = url.replace(/\/+$/, '');
    if (!url) return DEFAULT_API_URL;

    // 1) 已含完整 chat 端点 → 幂等原样
    if (/\/chat\/completions$/i.test(url)) return url + tail;

    // 2) 已含版本段 /vN（含智谱 /api/paas/v4、豆包 /api/v3、通义 /compatible-mode/v1）
    //    → 只补 /chat/completions，不再加 /v1
    if (/\/v\d+$/i.test(url)) return url + '/chat/completions' + tail;

    // 3) 裸域名 / 根路径 → 补标准 /v1/chat/completions
    return url + '/v1/chat/completions' + tail;
}

/**
 * 综合解析最终用于 fetch 的端点与模型。
 *
 * 优先级：显式入参 > provider 预设 > 内置默认。
 * provider 非 custom 时，预设的 URL/模型用于填补「用户留空」的字段；
 * 用户显式填了 apiUrl / model 则始终以用户为准（仍然过一遍 URL 归一化）。
 *
 * @param {object} opts
 * @param {string} [opts.provider] 服务商 key（见 AI_PROVIDERS）
 * @param {string} [opts.apiUrl]   显式 API 地址
 * @param {string} [opts.model]    显式模型名
 * @returns {{apiUrl: string, model: string, provider: string, presetLabel: string|null, presetUsed: boolean}}
 */
function resolveAiEndpoint(opts = {}) {
    const providerKey = Object.prototype.hasOwnProperty.call(AI_PROVIDERS, opts.provider)
        ? opts.provider
        : 'custom';
    const preset = AI_PROVIDERS[providerKey];
    const presetUsed = providerKey !== 'custom';

    const explicitUrl = typeof opts.apiUrl === 'string' && opts.apiUrl.trim() ? opts.apiUrl : null;
    const explicitModel = typeof opts.model === 'string' && opts.model.trim() ? opts.model : null;

    const apiUrl = normalizeApiUrl(explicitUrl || (presetUsed ? preset.apiUrl : null));
    const model = explicitModel || (presetUsed ? preset.model : null) || DEFAULT_MODEL;

    return {
        apiUrl,
        model,
        provider: providerKey,
        presetLabel: presetUsed ? preset.label : null,
        presetUsed
    };
}

module.exports = {
    AI_PROVIDERS,
    DEFAULT_API_URL,
    DEFAULT_MODEL,
    normalizeApiUrl,
    resolveAiEndpoint
};
