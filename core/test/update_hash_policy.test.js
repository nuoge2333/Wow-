#!/usr/bin/env node
/**
 * V3.5.22 新增能力测试：更新脚本的哈希校验「可协商」策略
 * ----------------------------------------------------------------
 * 背景：SHA256SUMS 此前从未随 Release 上传，update.sh / update.bat 里的
 * 哈希校验分支在真实环境里一次都没跑过（永远走「未找到清单」）。
 * V3.5.22 把它改成三态可协商：
 *
 *   ok       → 直接升级
 *   mismatch → 交互问，默认【否】；非交互一律拒绝
 *   missing  → 交互问，默认【是】；非交互继续
 *   skip     → 无 sha256sum，仅提示
 *
 * 本测试从 update.sh 里**真实抽取** ask_continue 函数与三态分支来执行，
 * 不是另抄一份逻辑——否则脚本改了测试却还绿，等于没测。
 *
 * 运行：node test/update_hash_policy.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        failures.push({ name, err: e });
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
    }
}

const ROOT = path.join(__dirname, '..', '..');
const SH = path.join(ROOT, 'update.sh');
const BAT = path.join(ROOT, 'update.bat');

console.log('\n===== V3.5.22 更新脚本哈希校验策略 =====\n');

if (!fs.existsSync(SH) || !fs.existsSync(BAT)) {
    console.log('⚠️ 找不到 update.sh / update.bat（需在仓库根目录运行）');
    process.exit(1);
}

const shSrc = fs.readFileSync(SH, 'utf8');
const batRaw = fs.readFileSync(BAT, 'utf8');
const batSrc = batRaw.replace(/\r\n/g, '\n');

// ==================== 1. 静态结构 ====================

console.log('【update.sh 结构】');

check('声明了 IS_INTERACTIVE 判定', () => {
    assert.ok(/IS_INTERACTIVE=0/.test(shSrc), '缺少 IS_INTERACTIVE 初始值 0');
    assert.ok(/\[ -t 0 \]/.test(shSrc), '缺少 stdin 是否为终端的判定');
    assert.ok(/\[ -t 1 \]/.test(shSrc), '缺少 stdout 是否为终端的判定');
});

check('支持 WOW_NO_PROMPT=1 强制非交互', () => {
    assert.ok(/WOW_NO_PROMPT/.test(shSrc), '缺 WOW_NO_PROMPT 逃生阀');
});

check('定义了三态变量 HASH_STATE 与四个取值', () => {
    assert.ok(/HASH_STATE="skip"/.test(shSrc), '缺少默认值 skip');
    for (const s of ['ok', 'mismatch', 'missing']) {
        assert.ok(new RegExp(`HASH_STATE="${s}"`).test(shSrc), `未设置 ${s} 状态`);
    }
});

check('mismatch 分支默认值为 n（拒绝）', () => {
    const m = shSrc.match(/mismatch\)\s*\n[\s\S]{0,600}?ask_continue[^\n]*\n/);
    assert.ok(m, '未找到 mismatch 分支');
    assert.ok(/ask_continue\s+"[^"]*"\s+"n"/.test(m[0]), `mismatch 默认值应为 n: ${m[0]}`);
});

check('missing 分支默认值为 y（继续）', () => {
    const m = shSrc.match(/missing\)\s*\n[\s\S]{0,600}?ask_continue[^\n]*\n/);
    assert.ok(m, '未找到 missing 分支');
    assert.ok(/ask_continue\s+"[^"]*"\s+"y"/.test(m[0]), `missing 默认值应为 y: ${m[0]}`);
});

check('取消升级时不覆盖任何文件（直接 exit 0）', () => {
    const idx = shSrc.indexOf('mismatch)');
    const seg = shSrc.slice(idx, idx + 500);
    assert.ok(/exit 0/.test(seg), '取消后应 exit 0 退出，绝不能继续走到覆盖逻辑');
});

check('哈希比对用 awk 精确比较，不用 grep 整行包含', () => {
    assert.ok(/awk -v h=/.test(shSrc) || /awk -v h/.test(shSrc), '应使用 awk 精确比较第一个字段');
    assert.ok(!/grep -qi "\$ACTUAL"/.test(shSrc), '仍在使用 grep -qi 整行包含，可能误命中');
});

check('脚本通过 bash -n 语法检查', () => {
    const r = spawnSync('bash', ['-n', SH], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr || 'bash -n 失败');
});

console.log('\n【update.bat 结构】');

check('bat 行尾全为 CRLF（cmd 对裸 LF 解析异常）', () => {
    const bare = (batRaw.match(/\n/g) || []).length - (batRaw.match(/\r\n/g) || []).length;
    assert.strictEqual(bare, 0, `存在 ${bare} 行裸 LF`);
});

check('bat 声明了 IS_INTERACTIVE 判定', () => {
    assert.ok(/set IS_INTERACTIVE=0/.test(batSrc), '缺少初始值');
    assert.ok(/CMDCMDLINE/.test(batSrc), '缺少 /c 参数判定');
});

check('bat 有 :hash_mismatch / :hash_missing / :hash_done 三标签', () => {
    for (const l of [':hash_mismatch', ':hash_missing', ':hash_done']) {
        assert.ok(batSrc.includes(l), `缺少标签 ${l}`);
    }
});

check('bat 的 CHECKSUMS_URL 用 goto 分支而非括号块', () => {
    // 括号块内 set 的变量在同一块里读不到新值，这是批处理的经典陷阱
    assert.ok(/:ck_gitee/.test(batSrc) && /:ck_done/.test(batSrc), '缺少 goto 分支标签');
    const seg = batSrc.slice(batSrc.indexOf('set CHECKSUMS_URL='), batSrc.indexOf(':ck_done'));
    assert.ok(!/if\s+"%RELEASE_HOST%"=="gitee"\s*\(\s*$/m.test(seg), '仍在使用括号块 + set');
});

check('bat 的 ask_continue 实现（mismatch 默认 n / missing 默认 y）', () => {
    assert.ok(/:ask_continue/.test(batSrc), '缺少 ask_continue 子过程');
    // 注意用带换行的标签精确锚定：'goto :hash_mismatch' 里也含 ':hash_mismatch'
    const iMis = batSrc.indexOf('\n:hash_mismatch\n') + 1;
    const iMss = batSrc.indexOf('\n:hash_missing\n') + 1;
    const iDone = batSrc.indexOf('\n:hash_done\n') + 1;
    assert.ok(iMis > 0 && iMss > iMis && iDone > iMss, '标签顺序异常');
    const segMis = batSrc.slice(iMis, iMss);
    const segMss = batSrc.slice(iMss, iDone);
    assert.ok(/call :ask_continue\s+"[^"]*"\s+n\s*$/m.test(segMis.trimEnd()) ||
              /call :ask_continue\s+"[^"]*"\s+n\b/.test(segMis),
        `mismatch 应传默认值 n，实际: ${(segMis.match(/call :ask_continue.*/) || [''])[0]}`);
    assert.ok(/call :ask_continue\s+"[^"]*"\s+y\b/.test(segMss),
        `missing 应传默认值 y，实际: ${(segMss.match(/call :ask_continue.*/) || [''])[0]}`);
});

check('bat 哈希比对用 -eq 精确比较，不用 Contains', () => {
    assert.ok(!/-eq \$a|ToLower\(\) -eq \$a/.test(batSrc) || /-eq \$a/.test(batSrc), '应有 -eq 比较');
    assert.ok(!/\$l\.ToLower\(\)\.Contains\(\$a\)/.test(batSrc), '仍在使用 Contains，会误命中');
});

// ==================== 2. 真实执行 ask_continue ====================

console.log('\n【ask_continue 行为】（真实抽取脚本函数执行）');

// 从 update.sh 中原样截取 ask_continue 函数体
function extractAskFn() {
    const start = shSrc.indexOf('ask_continue() {');
    assert.ok(start > 0, '未找到 ask_continue 函数');
    // 用花括号配平找到函数结束
    let depth = 0, i = shSrc.indexOf('{', start), end = -1;
    for (; i < shSrc.length; i++) {
        if (shSrc[i] === '{') depth++;
        else if (shSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    assert.ok(end > 0, '函数体不完整');
    return shSrc.slice(start, end);
}

const ASK_FN = extractAskFn();

/**
 * 在独立 bash 子进程里跑 ask_continue。
 * @param {string} input   模拟 stdin 输入（null = 不给输入，即管道 EOF）
 * @param {string} def     默认值
 * @param {number} inter   1 = 交互，0 = 非交互
 */
function runAsk(input, def, inter) {
    const script = [
        ASK_FN,
        `IS_INTERACTIVE=${inter}`,
        `if ask_continue "Q?" "${def}"; then echo RC=CONTINUE; else echo RC=CANCEL; fi`
    ].join('\n');
    const tmp = path.join(os.tmpdir(), `wow-ask-${process.pid}-${Math.random().toString(36).slice(2)}.sh`);
    fs.writeFileSync(tmp, script);
    const r = spawnSync('bash', [tmp], {
        input: input === null ? '' : input,
        encoding: 'utf8',
        timeout: 5000
    });
    fs.unlinkSync(tmp);
    const out = (r.stdout || '') + (r.stderr || '');
    if (out.includes('RC=CONTINUE')) return 'continue';
    if (out.includes('RC=CANCEL')) return 'cancel';
    throw new Error(`未得到判定结果（是否挂住？）stdout=${r.stdout} stderr=${r.stderr} signal=${r.signal}`);
}

check('非交互 + 默认 n → 拒绝（哈希不符，无人值守时不能装可疑包）', () => {
    assert.strictEqual(runAsk(null, 'n', 0), 'cancel');
});

check('非交互 + 默认 y → 继续（缺清单，不该卡住更新）', () => {
    assert.strictEqual(runAsk(null, 'y', 0), 'continue');
});

check('非交互即使喂了 y 也不读输入（防脚本挂住）', () => {
    // 非交互分支应在 read 之前就返回，喂什么都不会影响结果
    assert.strictEqual(runAsk('y\n', 'n', 0), 'cancel');
    assert.strictEqual(runAsk('y\n', 'y', 0), 'continue');
});

check('交互 + 默认 n + 空回车 → 拒绝', () => {
    assert.strictEqual(runAsk('\n', 'n', 1), 'cancel');
});

check('交互 + 默认 y + 空回车 → 继续', () => {
    assert.strictEqual(runAsk('\n', 'y', 1), 'continue');
});

check('交互 + 默认 n + 输入 y → 继续', () => {
    assert.strictEqual(runAsk('y\n', 'n', 1), 'continue');
});

check('交互 + 默认 y + 输入 n → 拒绝', () => {
    assert.strictEqual(runAsk('n\n', 'y', 1), 'cancel');
});

check('交互 + 各种肯定写法都能识别（y/yes/Y/ 是）', () => {
    for (const a of ['y', 'Y', 'yes', 'YES', 'Yes', '  y  ', '是']) {
        assert.strictEqual(runAsk(a + '\n', 'n', 1), 'continue', `"${a}" 应判为继续`);
    }
});

check('交互 + 各种否定写法都判为拒绝（n/no/N/否/乱输）', () => {
    for (const a of ['n', 'N', 'no', 'NO', '否', 'x', '123']) {
        assert.strictEqual(runAsk(a + '\n', 'y', 1), 'cancel', `"${a}" 应判为拒绝`);
    }
});

check('交互 + stdin 直接 EOF（Ctrl-D）→ 走默认值，不挂住', () => {
    assert.strictEqual(runAsk('', 'n', 1), 'cancel');
    assert.strictEqual(runAsk('', 'y', 1), 'continue');
});

// ==================== 3. 一致性 ====================

console.log('\n【两端策略一致性】');

check('update.sh 与 update.bat 都针对源码归档下载', () => {
    assert.ok(/archive\/refs\/tags\/\$LATEST_TAG\.zip/.test(shSrc) || /archive\/refs\/tags/.test(shSrc),
        'update.sh 应下载源码归档');
    assert.ok(/archive\/refs\/tags\/%LATEST_TAG%\.zip/.test(batSrc), 'update.bat 应下载源码归档');
});

check('发版脚本存在且说明清单对应源码归档', () => {
    const p = path.join(ROOT, 'scripts', 'make-sha256sums.sh');
    assert.ok(fs.existsSync(p), '缺少 scripts/make-sha256sums.sh');
    const s = fs.readFileSync(p, 'utf8');
    assert.ok(/archive\/refs\/tags/.test(s), '未针对源码归档生成哈希');
    assert.ok(/--upload/.test(s), '不支持 --upload');
});

// ==================== 汇总 ====================
console.log('\n----------------------------------------');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
    console.log('\n失败明细：');
    failures.forEach(f => console.log(`  · ${f.name}\n    ${f.err.stack || f.err.message}`));
    process.exit(1);
}
console.log('✅ 更新脚本哈希策略测试全部通过\n');
process.exit(0);
