'use strict';

/**
 * 测试插件实现
 * - hello       : 校验 args 与 options 传递，打印一行可断言的结果
 * - ctxKeys     : 校验 context 里只暴露白名单模块、且不含 process
 * - boom        : 故意抛错，验证运行期异常不会打死主进程
 */

module.exports = {
    async hello(args, context) {
        // args[0] 是位置参数，末位的 options 对象含有 --name
        const opts = args[args.length - 1] || {};
        const who = opts.name || 'world';
        console.log(`HELLO_FROM_PLUGIN:${who}`);
    },

    async ctxKeys(args, context) {
        const keys = Object.keys(context).sort().join(',');
        const hasProcess = Object.prototype.hasOwnProperty.call(context, 'process');
        // 探测 context.config 是否真的是 wow 的 config 模块
        const lang = context.config && typeof context.config.getConfig === 'function'
            ? context.config.getConfig('language', 'unknown')
            : 'no-config';
        console.log(`CTX_KEYS:${keys}`);
        console.log(`CTX_HAS_PROCESS:${hasProcess}`);
        console.log(`CTX_LANG:${lang}`);
    },

    async boom() {
        throw new Error('故意崩溃');
    }
};
