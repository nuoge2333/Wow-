#!/usr/bin/env node
/**
 * wow 测试套件入口（npm test）
 * ----------------------------------------------------------------
 * 顺序执行 test/ 下全部 *.test.js，按子进程退出码判定成败，
 * 输出每个文件的耗时与汇总；任一文件失败即整体失败（exit 1）。
 *
 * 各测试文件自身在末尾以 process.exit(0/1) 报告结果，
 * 因此本 runner 只需按退出码汇总，不解析输出内容。
 * 顺序执行（非并行）是为 web_files_e2e / mail_whitelist_e2e 等
 * 会真实监听端口的测试避免相互抢占。
 *
 * 运行：cd core && npm test   （或 node test/run.js）
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testDir = __dirname;
const files = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'))
    .sort();

if (files.length === 0) {
    console.log('❌ 未找到任何测试文件（test/*.test.js）');
    process.exit(1);
}

console.log(`\nwow 测试套件：共 ${files.length} 个测试文件\n`);

let failedFiles = 0;
const t0 = Date.now();

for (const f of files) {
    const start = Date.now();
    const r = spawnSync(process.execPath, [path.join(testDir, f)], {
        stdio: 'inherit',
        cwd: path.join(testDir, '..')
    });
    const ms = Date.now() - start;
    if (r.status === 0) {
        console.log(`\n  ✅ ${f}（${ms}ms）\n`);
    } else {
        failedFiles++;
        console.log(`\n  ❌ ${f} 失败（退出码 ${r.status}，${ms}ms）\n`);
    }
}

const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
console.log('====================');
if (failedFiles === 0) {
    console.log(`✅ 全部通过：${files.length} 个文件，总耗时 ${totalSec}s`);
} else {
    console.log(`❌ ${failedFiles}/${files.length} 个文件失败，总耗时 ${totalSec}s`);
}
console.log('====================\n');
process.exit(failedFiles === 0 ? 0 : 1);
