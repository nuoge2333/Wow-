#!/usr/bin/env node
/**
 * V3.5.21：插件运行上下文（plugin_context.js）
 * ----------------------------------------------------------------
 * 锁定的行为：
 *   1. 只暴露 10 个白名单模块（config/utils/log/event/server/mod/scheme/theme/mail/pack），**不含** process / require / fs 这类逃生口；
 *   2. 懒加载——没读过 context.scheme 时，scheme_manager 不被 require
 *      （它的构造函数会 ensureDirSync 建 scheme/ 与 pool/ 下一堆目录，
 *        一个只用 context.server 的插件不该顺带改磁盘）；
 *   3. 同一 context 反复取同一能力返回同一引用（否则插件会觉得状态莫名丢失）；
 *   4. 构造失败返回 null 而非抛（某个能力不可用不该拖垮整个插件）。
 */

const assert = require('assert');
const path = require('path');

const { createContext, CONTEXT_KEYS } = require('../src/plugin_context');

const SRC = path.resolve(__dirname, '..', 'src');

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

/** 某个模块是否已被 require 进缓存 */
function isLoaded(modName) {
    const target = path.join(SRC, modName + '.js');
    return Object.keys(require.cache).some(k => path.resolve(k) === target);
}

console.log('\ncontext 键集合\n');

check('恰好暴露 11 个模块', () => {
    assert.strictEqual(CONTEXT_KEYS.length, 11);
});

check('键名与预期一致', () => {
    assert.deepStrictEqual(
        [...CONTEXT_KEYS].sort(),
        ['config', 'event', 'log', 'mail', 'mod', 'pack', 'pluginConfig', 'scheme', 'server', 'theme', 'utils']
    );
});

check('枚举 context 得到同样的 11 个键', () => {
    const ctx = createContext({ warn: () => {} });
    assert.deepStrictEqual(Object.keys(ctx).sort(), [...CONTEXT_KEYS].sort());
});

console.log('\n逃生口不得注入\n');

check('context 上没有 process', () => {
    const ctx = createContext({ warn: () => {} });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(ctx, 'process'), false);
    assert.strictEqual(ctx.process, undefined);
});

check('context 上没有 require / fs / child_process', () => {
    const ctx = createContext({ warn: () => {} });
    for (const k of ['require', 'fs', 'child_process', 'global', 'module', 'exports', '__dirname']) {
        assert.strictEqual(ctx[k], undefined, `不应存在 context.${k}`);
    }
});

check('插件的 _plugin 标识不可写', () => {
    const ctx = createContext({ pluginName: 'demo', warn: () => {} });
    assert.strictEqual(ctx._plugin, 'demo');
    assert.throws(() => { 'use strict'; ctx._plugin = 'hacked'; }, /Cannot assign|read only/i);
});

check('context 不可扩展（插件不能挂新字段）', () => {
    const ctx = createContext({ warn: () => {} });
    ctx.myHelper = () => {};
    assert.strictEqual(ctx.myHelper, undefined);
    assert.strictEqual(Object.isExtensible(ctx), false);
});

console.log('\n懒加载\n');

check('未访问前不 require scheme_manager', () => {
    // 注意：本文件前面没碰过 context.scheme，因此此时应为未加载
    if (isLoaded('scheme_manager')) {
        // 若同进程别处已加载（本测试单独跑，理论上不会），跳过断言而非误报
        console.log('     （scheme_manager 已被其它原因加载，跳过）');
        return;
    }
    const ctx = createContext({ warn: () => {} });
    // 只访问 config，不该连带加载 scheme_manager
    void ctx.config;
    assert.strictEqual(isLoaded('scheme_manager'), false, 'scheme_manager 被提前 require 了');
});

check('访问 context.scheme 之后 scheme_manager 才进缓存', () => {
    const ctx = createContext({ warn: () => {} });
    const before = isLoaded('scheme_manager');
    void ctx.scheme;
    assert.strictEqual(isLoaded('scheme_manager'), true, '访问后仍未加载');
    // before 只用于说明，不强制
    void before;
});

console.log('\n单实例缓存\n');

check('两次取 context.server 是同一引用', () => {
    const ctx = createContext({ warn: () => {} });
    assert.strictEqual(ctx.server, ctx.server);
});

check('两次取 context.config 是同一引用', () => {
    const ctx = createContext({ warn: () => {} });
    assert.strictEqual(ctx.config, ctx.config);
});

check('不同 context 之间互不共享实例', () => {
    const a = createContext({ warn: () => {} });
    const b = createContext({ warn: () => {} });
    // config 是模块本身（同一份），server 是 new 出来的（应不同）
    assert.notStrictEqual(a.server, b.server);
});

check('context.config 是真正的 config 模块', () => {
    const ctx = createContext({ warn: () => {} });
    const config = require('../src/config');
    assert.strictEqual(ctx.config, config);
    assert.strictEqual(typeof ctx.config.getConfig, 'function');
});

console.log('\n降级不抛\n');

check('构造失败时返回 null 且记录 warn', () => {
    // 打桩：让 log_handler 的构造抛错（通过临时改写 require 结果不可行，
    // 这里退一步验证「工厂抛错 → null」的通用路径：用一个不存在的 key 走不通，
    // 改为直接验证实现里的 try-catch 包装存在——用 monkey patch FACTORIES。
    const mod = require('../src/plugin_context');
    const factories = mod._internals.FACTORIES;
    const original = factories.server;
    const warns = [];
    factories.server = () => { throw new Error('模拟构造失败'); };
    try {
        const ctx = createContext({ pluginName: 'x', warn: (m) => warns.push(m) });
        assert.strictEqual(ctx.server, null);
        assert.strictEqual(warns.length, 1);
        assert.match(warns[0], /context\.server 初始化失败/);
        // 失败结果也被缓存，不会每次访问都重试并重复告警
        void ctx.server;
        assert.strictEqual(warns.length, 1);
    } finally {
        factories.server = original;
    }
});

check('单个能力失败不影响其它能力', () => {
    const mod = require('../src/plugin_context');
    const factories = mod._internals.FACTORIES;
    const original = factories.mail;
    factories.mail = () => { throw new Error('模拟 SMTP 构造失败'); };
    try {
        const ctx = createContext({ warn: () => {} });
        assert.strictEqual(ctx.mail, null);
        assert.ok(ctx.config, 'config 应仍可用');
        assert.ok(ctx.server, 'server 应仍可用');
    } finally {
        factories.mail = original;
    }
});

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
