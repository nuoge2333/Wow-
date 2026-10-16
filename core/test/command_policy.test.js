/**
 * Web 指令安全策略测试（V3.5.7 方案 B）
 * 验证两个开关的放开/收敛行为，以及永久拒绝项不受开关影响。
 */
const assert = require('assert');
const path = require('path');

const config = require('../src/config');
const policy = require('../src/command_policy');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${extra ? ' → ' + extra : ''}`); }
}

/** 用内存打桩替换 config.getConfig，模拟开关状态 */
const originalGet = config.getConfig;
function withSwitches(schemeOps, remoteInstall, fn) {
    config.getConfig = (key, def) => {
        if (key === 'web.allow_scheme_ops') return schemeOps;
        if (key === 'web.allow_remote_install') return remoteInstall;
        if (key === 'web.host') return '127.0.0.1';
        if (key === 'web.dev_mode') return false;
        return originalGet.call(config, key, def);
    };
    try { fn(); } finally { config.getConfig = originalGet; }
}

const allow = (c) => policy.isWebCommandAllowed(c).allowed;

console.log('\n[默认：两开关全关]');
withSwitches(false, false, () => {
    check('拒绝 scheme create', !allow('scheme create demo -t paper -v 1.20.1'));
    check('拒绝 scheme switch', !allow('scheme switch demo'));
    check('拒绝 scheme delete', !allow('scheme delete demo'));
    check('拒绝 scheme pull',   !allow('scheme pull demo'));
    check('拒绝 scheme export', !allow('scheme export demo'));
    check('拒绝 install 远程',  !allow('install https://a.com/x.jar'));
    check('拒绝 init',          !allow('init'));
    check('拒绝 mod remove',    !allow('mod remove a.jar'));
    check('拒绝 logs tail',     !allow('logs tail'));
    check('拒绝 web start',     !allow('web start'));
    check('拒绝 config 写入',   !allow('config server port 25566'));
    // 面板正常功能必须放行
    check('放行 server start',  allow('server start'));
    check('放行 server stop',   allow('server stop'));
    check('放行 scheme list',   allow('scheme list'));
    check('放行 scheme info',   allow('scheme info demo'));
    check('放行 mod install',   allow('mod install a.jar'));
    check('放行 theme install', allow('theme install x.zip'));
    check('放行 config 只读',   allow('config server'));
    check('放行 install 本地',  allow('install ./local.jar -o ./'));
    check('放行 lan',           allow('lan status'));
});

console.log('\n[allow_scheme_ops = true]');
withSwitches(true, false, () => {
    check('放行 scheme create', allow('scheme create demo -t paper -v 1.20.1'));
    check('放行 scheme switch', allow('scheme switch demo'));
    check('放行 scheme delete', allow('scheme delete demo'));
    check('放行 scheme export', allow('scheme export demo'));
    check('仍拒绝 install 远程', !allow('install https://a.com/x.jar'));
    check('仍拒绝 init',         !allow('init'));
    check('仍拒绝 mod remove',   !allow('mod remove a.jar'));
    check('仍拒绝 logs tail',    !allow('logs tail'));
    check('仍拒绝 web start',    !allow('web start'));
});

console.log('\n[allow_remote_install = true]');
withSwitches(false, true, () => {
    check('放行 install 远程',  allow('install https://a.com/x.jar'));
    check('仍拒绝 scheme create', !allow('scheme create demo -t paper -v 1.20.1'));
    check('仍拒绝 init',          !allow('init'));
    check('放行 install 本地',    allow('install ./local.jar'));
});

console.log('\n[两开关全开]');
withSwitches(true, true, () => {
    check('放行 scheme create', allow('scheme create demo -t paper -v 1.20.1'));
    check('放行 install 远程',  allow('install https://a.com/x.jar'));
    check('仍拒绝 init',        !allow('init'));
    check('仍拒绝 mod remove',  !allow('mod remove a.jar'));
    check('仍拒绝 logs tail',   !allow('logs tail'));
    check('仍拒绝 web start',   !allow('web start'));
    check('仍拒绝 pack install',!allow('pack install x.zip'));
    check('仍拒绝 config 写入', !allow('config wow lang en_US'));
});

console.log('\n[审计：开关全关时无警告]');
withSwitches(false, false, () => {
    check('无警告', policy.auditDangerousConfig().length === 0);
});

console.log('\n[审计：开关打开时产生警告]');
withSwitches(true, false, () => {
    const w = policy.auditDangerousConfig();
    check('产生警告', w.length >= 1, JSON.stringify(w));
    check('提到开关名', w.some(x => x.includes('allow_scheme_ops')), JSON.stringify(w));
});
withSwitches(false, true, () => {
    const w = policy.auditDangerousConfig();
    check('远程下载单独警告', w.some(x => x.includes('任意代码执行')), JSON.stringify(w));
});

console.log('\n[拒绝时提供配置指引]');
withSwitches(false, false, () => {
    const r1 = policy.isWebCommandAllowed('scheme create x -t paper -v 1.20.1');
    check('scheme 拒绝提示开关名', r1.reason.includes('allow_scheme_ops'), r1.reason);
    const r2 = policy.isWebCommandAllowed('install https://a.com/x.jar');
    check('install 拒绝提示开关名', r2.reason.includes('allow_remote_install'), r2.reason);
});

console.log('\n====================');
console.log(`  通过 ${pass} / 失败 ${fail}`);
console.log('====================\n');
process.exit(fail === 0 ? 0 : 1);
