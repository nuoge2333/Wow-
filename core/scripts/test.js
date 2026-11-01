#!/usr/bin/env node
/**
 * npm test 入口（V3.5.19-26.3a）
 * ----------------------------------------------------------------
 * 背景：
 *   core/test/ 已在 .gitattributes 里标了 export-ignore，不会进入发行包
 *   （git archive / GitHub 源码 zip / Gitee 源码 zip 均生效）。
 *   但 package.json 的 "test" 脚本仍然指向它——用户拿到发行包后敲
 *   `npm test` 会看到一坨 MODULE_NOT_FOUND 堆栈，容易误以为装坏了。
 *
 * 本文件做一层薄封装：
 *   - 仓库内（有 test/run.js）→ 正常转发执行，行为与以前完全一致
 *   - 发行包内（无 test/run.js）→ 打印人话提示后退出 0，不制造失败
 *
 * 注意：这里统一用 exit 0，因为「发行包没有测试」是预期状态，
 * 不是环境故障。需要真实跑测试的开发者，请从仓库克隆而非下载发行包。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const coreDir = path.resolve(__dirname, '..');
const runner = path.join(coreDir, 'test', 'run.js');

if (!fs.existsSync(runner)) {
    console.log('');
    console.log('ℹ️  当前是发行包，不含测试套件。');
    console.log('   测试只用于开发期回归，已在打包时通过 .gitattributes 的');
    console.log('   `core/test export-ignore` 排除，不影响 wow 正常使用。');
    console.log('');
    console.log('   如需参与开发 / 跑回归测试：');
    console.log('     git clone https://gitee.com/nuoge233/wow.git');
    console.log('     cd wow/core && npm install && npm test');
    console.log('');
    process.exit(0);
}

const r = spawnSync(process.execPath, [runner, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: coreDir
});

process.exit(r.status === null ? 1 : r.status);
