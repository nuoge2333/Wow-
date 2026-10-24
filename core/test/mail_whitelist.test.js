/**
 * Web 登录邮箱白名单测试（V3.5.8）
 *
 * 语义：mail.whitelist 内的邮箱才能获取验证码并登录 Web 面板。
 *   - 空列表 = 不限制（向后兼容）
 *   - 含 "*" = 放开所有
 *   - 其余 = 必须精确命中（大小写不敏感）
 *
 * 运行：cd core && node test/mail_whitelist.test.js
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const assert = require('assert');

const Mailer = require('../src/mailer');

let passed = 0, failed = 0;
function check(title, fn) {
    try { fn(); console.log(`  ✅ ${title}`); passed++; }
    catch (e) { console.log(`  ❌ ${title}\n     ${e.message}`); failed++; }
}

console.log('\nWeb 登录邮箱白名单测试 (V3.5.8)\n');

// ─────────────────────────────────────────────
console.log('— normalizeWhitelist：输入形态归一化 —');

check('1 YAML 列表 → 小写去重', () => {
    const r = Mailer.normalizeWhitelist(['Admin@Example.com', 'admin@example.com', 'b@c.cn']);
    assert.deepStrictEqual(r, ['admin@example.com', 'b@c.cn']);
});

check('2 逗号分隔字符串', () => {
    assert.deepStrictEqual(Mailer.normalizeWhitelist('a@b.com, c@d.cn'), ['a@b.com', 'c@d.cn']);
});

check('3 分号/空白分隔字符串', () => {
    assert.deepStrictEqual(Mailer.normalizeWhitelist('a@b.com; c@d.cn  e@f.io'), ['a@b.com', 'c@d.cn', 'e@f.io']);
});

check('4 单个邮箱字符串', () => {
    assert.deepStrictEqual(Mailer.normalizeWhitelist('only@one.com'), ['only@one.com']);
});

check('5 YAML 映射写法 { a@b.com: true }', () => {
    const r = Mailer.normalizeWhitelist({ 'a@b.com': true, 'x@y.z': false });
    assert.deepStrictEqual(r, ['a@b.com']);
});

check('6 null / undefined / 空数组 → 空列表', () => {
    assert.deepStrictEqual(Mailer.normalizeWhitelist(null), []);
    assert.deepStrictEqual(Mailer.normalizeWhitelist(undefined), []);
    assert.deepStrictEqual(Mailer.normalizeWhitelist([]), []);
    assert.deepStrictEqual(Mailer.normalizeWhitelist(''), []);
});

check('7 非法邮箱被滤掉（防止手写配置写错）', () => {
    const r = Mailer.normalizeWhitelist(['not-an-email', 'ok@ok.com', 'a@b', '  ']);
    assert.deepStrictEqual(r, ['ok@ok.com']);
});

check('8 "*" 通配被保留', () => {
    assert.deepStrictEqual(Mailer.normalizeWhitelist(['*']), ['*']);
});

check('9 "*" 与其他邮箱共存时都保留', () => {
    assert.deepStrictEqual(Mailer.normalizeWhitelist(['a@b.com', '*']), ['a@b.com', '*']);
});

// ─────────────────────────────────────────────
console.log('— isEmailAllowed：判定语义 —');
{
    const m = new Mailer();

    check('10 白名单为空 → 不限制（向后兼容）', () => {
        m.whitelist = [];
        assert.strictEqual(m.isEmailAllowed('anyone@anywhere.com').allowed, true);
        assert.strictEqual(m.isEmailAllowed('').allowed, true);
    });

    check('11 名单内邮箱放行', () => {
        m.whitelist = ['admin@example.com'];
        assert.strictEqual(m.isEmailAllowed('admin@example.com').allowed, true);
    });

    check('12 大小写不敏感（配置大写、请求小写）', () => {
        m.whitelist = ['admin@example.com'];
        assert.strictEqual(m.isEmailAllowed('ADMIN@Example.COM').allowed, true);
    });

    check('13 名单外邮箱拒绝', () => {
        m.whitelist = ['admin@example.com'];
        const v = m.isEmailAllowed('hacker@evil.com');
        assert.strictEqual(v.allowed, false);
        assert.ok(/不在白名单/.test(v.reason));
    });

    check('14 空邮箱在非空名单下拒绝', () => {
        m.whitelist = ['admin@example.com'];
        assert.strictEqual(m.isEmailAllowed('').allowed, false);
        assert.strictEqual(m.isEmailAllowed(null).allowed, false);
    });

    check('15 "*" 通配放开所有', () => {
        m.whitelist = ['*'];
        assert.strictEqual(m.isEmailAllowed('anyone@x.y').allowed, true);
    });

    check('16 前后空格被忽略', () => {
        m.whitelist = ['admin@example.com'];
        assert.strictEqual(m.isEmailAllowed('  admin@example.com  ').allowed, true);
    });

    check('17 相似但不同的邮箱不会被误放行', () => {
        m.whitelist = ['admin@example.com'];
        assert.strictEqual(m.isEmailAllowed('admin@example.com.evil.com').allowed, false);
        assert.strictEqual(m.isEmailAllowed('admin2@example.com').allowed, false);
        assert.strictEqual(m.isEmailAllowed('admin@example.co').allowed, false);
    });
}

// ─────────────────────────────────────────────
console.log('— loadWhitelist：从配置读取 —');
{
    const config = require('../src/config');
    const orig = config.getConfig;
    const store = {};

    config.getConfig = (k, d = null) => (k in store ? store[k] : d);

    check('18 读 mail.whitelist（主键，小写）', () => {
        Object.keys(store).forEach(k => delete store[k]);
        store['mail.whitelist'] = ['a@b.com'];
        assert.deepStrictEqual(Mailer.loadWhitelist(), ['a@b.com']);
    });

    check('19 兼容 mail.WhiteList 写法', () => {
        Object.keys(store).forEach(k => delete store[k]);
        store['mail.WhiteList'] = ['C@D.cn'];
        assert.deepStrictEqual(Mailer.loadWhitelist(), ['c@d.cn']);
    });

    check('20 兼容 mail.whiteList 写法', () => {
        Object.keys(store).forEach(k => delete store[k]);
        store['mail.whiteList'] = 'e@f.io';
        assert.deepStrictEqual(Mailer.loadWhitelist(), ['e@f.io']);
    });

    check('21 主键优先于兼容键', () => {
        Object.keys(store).forEach(k => delete store[k]);
        store['mail.whitelist'] = ['main@x.com'];
        store['mail.WhiteList'] = ['other@y.com'];
        assert.deepStrictEqual(Mailer.loadWhitelist(), ['main@x.com']);
    });

    check('22 都没配 → 空列表（不限制）', () => {
        Object.keys(store).forEach(k => delete store[k]);
        assert.deepStrictEqual(Mailer.loadWhitelist(), []);
    });

    check('23 配置为 null 时不报错', () => {
        Object.keys(store).forEach(k => delete store[k]);
        store['mail.whitelist'] = null;
        assert.deepStrictEqual(Mailer.loadWhitelist(), []);
    });

    config.getConfig = orig;
}

// ─────────────────────────────────────────────
console.log('— 真实配置加载（不污染 wow.yaml）—');
{
    check('24 构造函数能从真实 wow.yaml 读到 whitelist 字段', () => {
        const m = new Mailer();
        assert.ok(Array.isArray(m.whitelist), `whitelist 应为数组，实际 ${typeof m.whitelist}`);
    });
}

// ─────────────────────────────────────────────
// 确认没写脏 wow.yaml
// V3.5.13：wow.yaml 不再随发行包分发（属用户配置，首次运行自动生成），
// 因此这里以「内存中加载的配置」为准，不依赖该文件在磁盘上存在。
{
    const cfgFile = path.join(__dirname, '..', 'wow.yaml');
    const snapshot = () => (fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : null);
    const before = snapshot();
    check('25 测试过程未改动 core/wow.yaml', () => {
        assert.strictEqual(snapshot(), before);
    });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
