'use strict';

/**
 * 插件运行上下文（V3.5.21-26.3c）
 * ----------------------------------------------------------------
 * 插件 index.js 的处理函数签名是 `(args, context)`，本模块负责构造那个 context。
 *
 * 设计要点：
 *  1. **白名单注入**：只暴露下列 9 个模块，绝不注入 process / 内部 fs / require。
 *     注意：这不是沙箱。require 进来的是同一个 Node 进程、同一份权限，
 *     插件照样可以通过 require('fs') 直接读写磁盘。安全边界靠三道闸：
 *       ① 首次启用确认（plugin_trust.js）
 *       ② 内容指纹校验（改一个字节就要重新确认）
 *       ③ Web 端默认禁用（command_policy.js 的 RUNTIME_PLUGIN_CMDS）
 *     这里做白名单，目的是「给插件一份稳定、可预期的 API 面」，
 *     让它不必猜 wow 内部结构（比如 scheme_manager 的私有字段），
 *     而不是假装隔离。
 *
 *  2. **懒加载**：用 Object.defineProperty 的 getter，只有插件真正读了
 *     `context.scheme` 才会 `new SchemeManager()`。原因很实际——
 *     `new SchemeManager()` 会 ensureDirSync 建 scheme/ 和 pool/ 下一堆目录，
 *     一个只用 `context.server` 的插件不该顺带改动磁盘。
 *
 *  3. **单实例缓存**：同一个 context 反复读 `context.server` 返回同一引用。
 *     否则插件里 `context.server.status()` 和 `context.server.foo()`
 *     会各拿一个新实例，看起来像「状态莫名其妙丢了」。
 *
 *  4. **降级不抛**：某个模块构造失败（依赖缺失 / 目录不可写 / 环境异常）时，
 *     该 key 返回 null 并记一条 warn，其它 8 个照常可用。
 *     插件里看到 null 就能判断「这个能力在当前环境不可用」。
 */

/** 模块名 → 工厂函数。工厂在首次访问时执行，结果被缓存。 */
const FACTORIES = {
    // config 是一组函数（getConfig / setConfig / ...），不是类，直接给模块本身
    config: () => require('./config'),
    // utils 同理，是纯函数集合
    utils: () => require('./utils'),
    // log 给的是 LogHandler 实例（tail/analyze/report）
    log: () => new (require('./log_handler'))(),
    // 事件日志（log.js 单例），与 CLI 里 logger() 拿到的是同一个
    event: () => {
        const log = require('./log');
        return log && log.logger ? log.logger : null;
    },
    server: () => new (require('./server'))(),
    mod: () => new (require('./mod_manager'))(),
    // scheme 的构造函数有建目录副作用，因此必须懒加载（见文件头第 2 点）
    scheme: () => new (require('./scheme_manager'))(),
    theme: () => new (require('./theme_manager'))(),
    mail: () => new (require('./mailer'))(),
    pack: () => new (require('./pack_generator'))()
};

/** 对外暴露的 key 顺序即此处顺序（object 保留插入序），用于 help / 文档展示 */
const CONTEXT_KEYS = Object.freeze(Object.keys(FACTORIES));

/**
 * 创建一个插件上下文。
 * @param {object} [options]
 * @param {string} [options.pluginName] 插件名，仅用于 warn 日志定位
 * @param {function} [options.warn] 日志回调 (msg) => void，默认 console.error
 * @returns {object} 带 9 个只读属性 + _plugin 标识的上下文对象
 */
function createContext(options = {}) {
    const pluginName = options.pluginName || '(unknown)';
    const warn = typeof options.warn === 'function'
        ? options.warn
        : (msg) => console.error(msg);

    const cache = Object.create(null);

    /** 取某个能力的实例；构造失败返回 null，不抛 */
    function resolve(key) {
        if (key in cache) return cache[key];
        let value = null;
        try {
            value = FACTORIES[key]();
        } catch (e) {
            warn(`⚠️ 插件 ${pluginName}：context.${key} 初始化失败（返回 null）: ${e.message}`);
            value = null;
        }
        cache[key] = value;
        return value;
    }

    const ctx = {};

    for (const key of CONTEXT_KEYS) {
        Object.defineProperty(ctx, key, {
            // 只读：插件不能把 context.config 换成自己的东西，
            // 否则后续调用方（其它插件命令）会拿到被篡改的能力
            enumerable: true,
            configurable: false,
            get() { return resolve(key); }
        });
    }

    // 插件可由此知道自己是谁，做日志前缀之类；不可写
    Object.defineProperty(ctx, '_plugin', {
        value: pluginName,
        enumerable: false,
        writable: false,
        configurable: false
    });

    // 禁止插件给 context 挂新字段：避免 A 插件塞的东西被 B 插件/主程序误读
    Object.preventExtensions(ctx);

    return ctx;
}

module.exports = {
    createContext,
    CONTEXT_KEYS,
    _internals: { FACTORIES }
};
