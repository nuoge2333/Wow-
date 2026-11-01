#!/usr/bin/env node
/**
 * V3.5.21：插件命令的策略管控
 * ----------------------------------------------------------------
 * 插件命令是**运行期**才知道的顶层命令，因此比内置命令多两个风险点：
 *   ① Web 面板：插件是第三方任意代码，面板是远程入口，两者叠加等于
 *      「远程可控的任意代码执行」，默认必须禁止；
 *   ② 开服控制台：classifyConsoleInput 原先用 `WOW_NAMESPACES.has(head)`
 *      判断「是不是 wow 指令」，插件命令不在这个常量里，会被当成 MC 指令
 *      转发给服务端（表现为游戏里报 unknown command）。必须显式拦截。
 *
 * 本测试锁定这两条通路，以及 registerPluginCommand / resetPluginCommands 的行为。
 */

const assert = require('assert');
const path = require('path');

const config = require('../src/config');
const policy = require('../src/command_policy');
const ServerManager = require('../src/server');

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

/** 用内存打桩替换 config.getConfig，模拟开关状态 */
const originalGet = config.getConfig;
function withSwitches(opts, fn) {
    config.getConfig = (key, def) => {
        if (key === 'web.allow_scheme_ops') return opts.schemeOps === true;
        if (key === 'web.allow_remote_install') return opts.remoteInstall === true;
        if (key === 'web.allow_plugins') return opts.plugins === true;
        if (key === 'web.host') return '127.0.0.1';
        if (key === 'web.dev_mode') return false;
        return originalGet.call(config, key, def);
    };
    try { fn(); } finally { config.getConfig = originalGet; }
}

// classifyConsoleInput 不是模块导出（server.js 导出的是 class），
// 这里用源码内的正则确认它已接入插件判断过于脆弱，
// 改为通过 ServerManager 实例的私有方法访问（挂在原型上便于测试）。
function classify(line) {
    if (typeof ServerManager.prototype.classifyConsoleInput === 'function') {
        return ServerManager.prototype.classifyConsoleInput.call({}, line);
    }
    // 兜底：通过 require server.js 内部的函数导出（若未来拆出来）
    if (typeof ServerManager.classifyConsoleInput === 'function') {
        return ServerManager.classifyConsoleInput(line);
    }
    throw new Error('classifyConsoleInput 不可达，测试需要更新');
}

console.log('\n命令名登记\n');

check('初始 RUNTIME_PLUGIN_CMDS 为空', () => {
    policy.resetPluginCommands();
    assert.strictEqual(policy.RUNTIME_PLUGIN_CMDS.size, 0);
});

check('registerPluginCommand 登记后可在 RUNTIME_PLUGIN_CMDS 里查到', () => {
    policy.resetPluginCommands();
    policy.registerPluginCommand('hello');
    assert.ok(policy.RUNTIME_PLUGIN_CMDS.has('hello'));
});

check('registerPluginCommand 统一转小写', () => {
    policy.resetPluginCommands();
    policy.registerPluginCommand('HeLLo');
    assert.ok(policy.RUNTIME_PLUGIN_CMDS.has('hello'));
});

check('registerPluginCommand 忽略空值', () => {
    policy.resetPluginCommands();
    policy.registerPluginCommand('');
    policy.registerPluginCommand(null);
    policy.registerPluginCommand('   ');
    assert.strictEqual(policy.RUNTIME_PLUGIN_CMDS.size, 0);
});

check('isWowNamespace 覆盖内置命名空间与插件命令', () => {
    policy.resetPluginCommands();
    policy.registerPluginCommand('hello');
    assert.strictEqual(policy.isWowNamespace('server'), true);
    assert.strictEqual(policy.isWowNamespace('hello'), true);
    assert.strictEqual(policy.isWowNamespace('say'), false);
});

check('resetPluginCommands 清空', () => {
    policy.registerPluginCommand('hello');
    policy.resetPluginCommands();
    assert.strictEqual(policy.RUNTIME_PLUGIN_CMDS.size, 0);
});

console.log('\nWeb 面板：插件命令默认禁止\n');

policy.resetPluginCommands();
policy.registerPluginCommand('hello');

withSwitches({ plugins: false }, () => {
    check('默认配置下拒绝插件命令', () => {
        const r = policy.isWebCommandAllowed('hello');
        assert.strictEqual(r.allowed, false);
    });

    check('拒绝理由给出 web.allow_plugins 指引', () => {
        const r = policy.isWebCommandAllowed('hello --name Steve');
        assert.match(r.reason, /web\.allow_plugins/);
        assert.match(r.reason, /hello/);
    });

    check('行首带 wow 前缀同样被拒', () => {
        assert.strictEqual(policy.isWebCommandAllowed('wow hello').allowed, false);
    });

    check('内置命令不受影响（server start 仍放行）', () => {
        assert.strictEqual(policy.isWebCommandAllowed('server start').allowed, true);
    });

    check('未登记的普通词仍不拦截（交回 execCommand 自然报错）', () => {
        assert.strictEqual(policy.isWebCommandAllowed('say hi').allowed, true);
    });
});

withSwitches({ plugins: true }, () => {
    check('allow_plugins = true 时放行插件命令', () => {
        assert.strictEqual(policy.isWebCommandAllowed('hello --name Steve').allowed, true);
    });

    check('放行插件命令不代表放行危险内置命令', () => {
        assert.strictEqual(policy.isWebCommandAllowed('init').allowed, false);
        assert.strictEqual(policy.isWebCommandAllowed('mod remove a.jar').allowed, false);
    });
});

console.log('\nauditDangerousConfig\n');

withSwitches({ plugins: false }, () => {
    check('全关时无警告', () => {
        assert.deepStrictEqual(policy.auditDangerousConfig(), []);
    });
});

withSwitches({ plugins: true }, () => {
    check('打开 allow_plugins 时产生警告并点名该开关', () => {
        const w = policy.auditDangerousConfig();
        assert.ok(w.length > 0);
        assert.ok(w.join('\n').includes('web.allow_plugins'));
        assert.ok(w.join('\n').includes('同权限'));
    });
});

console.log('\n开服控制台：插件命令不得当 MC 指令转发\n');

check('未登记时 hello 被当 MC 指令（对照组）', () => {
    policy.resetPluginCommands();
    // 未登记 → 不是 wow 命名空间 → 转发给 MC（这是原本的行为）
    const r = classify('hello Steve');
    assert.strictEqual(r.action, 'mc');
});

check('登记后插件命令被显式拒绝，而非转发给 MC', () => {
    policy.resetPluginCommands();
    policy.registerPluginCommand('hello');
    const r = classify('hello Steve');
    assert.strictEqual(r.action, 'deny');
    assert.match(r.reason, /插件命令 hello/);
});

check('带 wow 前缀的插件命令同样被拒', () => {
    policy.resetPluginCommands();
    policy.registerPluginCommand('hello');
    const r = classify('wow hello');
    assert.strictEqual(r.action, 'deny');
});

check('内置命令行为不变：lan status 允许执行', () => {
    policy.resetPluginCommands();
    assert.strictEqual(classify('lan status').action, 'run');
});

check('内置命令行为不变：server start 被拒', () => {
    assert.strictEqual(classify('server start').action, 'deny');
});

check('内置命令行为不变：op Steve 当 MC 指令', () => {
    assert.strictEqual(classify('op Steve').action, 'mc');
});

check('新增的 plugin trust / path 在控制台可用', () => {
    policy.resetPluginCommands();
    assert.strictEqual(classify('plugin trust hello').action, 'run');
    assert.strictEqual(classify('plugin path').action, 'run');
});

check('新增的 plugin untrust 在控制台被拒（改信任表属本地操作）', () => {
    policy.resetPluginCommands();
    assert.strictEqual(classify('plugin untrust hello').action, 'deny');
});

policy.resetPluginCommands();

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
