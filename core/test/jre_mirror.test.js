/**
 * JRE 国内镜像多源轮询测试（V3.8.5）
 * - Windows / Linux / macOS 三平台统一国内优先（此前仅 macOS）
 * - 候选链顺序：清华 TUNA → 中科大 USTC → Adoptium 官方
 * - Windows 匹配 .zip，Linux/macOS 匹配 .tar.gz，JDK8 特殊文件名格式
 * - 存量旧 TUNA 值兼容、jre.mirror 置空直连官方、自定义镜像、锁定版本跳过镜像
 * - USTC 不可达时跳过（不阻塞后续源）
 *
 * 全程不联网：打桩 axios.get 返回构造的目录列表 HTML。
 * 运行：cd core && node test/jre_mirror.test.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const assert = require('assert');
const axios = require('axios');

const WORK = path.join(os.tmpdir(), 'jre_mirror_test');
fs.emptyDirSync(WORK);
process.env.WOW_CONFIG_FILE = path.join(WORK, 'wow.yaml');

const config = require('../src/config');
const JreManager = require('../src/jre_manager');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
async function checkAsync(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ---- 打桩 axios.get：按 URL 返回构造的镜像目录 HTML ----
const realGet = axios.get;
let ustcDown = false;

function verTag(feature) {
    // JDK8 用 8uXXXbXX 格式；其余用点分格式
    return feature === '8' ? '8u512b09' : '21.0.13_9';
}
function oldVerTag(feature) {
    return feature === '8' ? '8u500b08' : '21.0.12_8';
}

axios.get = async (url) => {
    // Adoptium 目录布局（TUNA / 自定义镜像）：URL 含 feature/arch/os
    const dm = url.match(/\/(\d+)\/jdk\/([^/]+)\/([^/]+)\/$/);
    if (dm && (url.includes('tuna') || url.includes('custom.example.com'))) {
        const feature = dm[1], arch = dm[2], osName = dm[3];
        const ext = osName === 'windows' ? 'zip' : 'tar.gz';
        const base = `OpenJDK${feature}U-jdk_${arch}_${osName}_hotspot_`;
        // 故意放两个版本，验证「取最高」
        return { data: [
            `<a href="${base}${oldVerTag(feature)}.${ext}">old</a>`,
            `<a href="${base}${verTag(feature)}.${ext}">new</a>`
        ].join('\n') };
    }
    // USTC LatestRelease 布局：URL 只含 feature，HTML 含全平台文件
    const um = url.match(/temurin(\d+)-binaries\/LatestRelease\//);
    if (um && url.includes('ustc')) {
        if (ustcDown) throw new Error('mock ustc unreachable');
        const f = um[1];
        const rows = [
            `OpenJDK${f}U-jdk_x64_windows_hotspot_${verTag(f)}.zip`,
            `OpenJDK${f}U-jdk_x64_linux_hotspot_${verTag(f)}.tar.gz`,
            `OpenJDK${f}U-jdk_x64_mac_hotspot_${verTag(f)}.tar.gz`,
            `OpenJDK${f}U-jdk_aarch64_linux_hotspot_${verTag(f)}.tar.gz`,
            // 干扰项：debugimage / jre 不应被误匹配
            `OpenJDK${f}U-debugimage_x64_linux_hotspot_${verTag(f)}.tar.gz`,
            `OpenJDK${f}U-jre_x64_windows_hotspot_${verTag(f)}.zip`
        ];
        return { data: rows.map(r => `<a href="${r}">x</a>`).join('\n') };
    }
    throw new Error('unmocked: ' + url);
};

function reset() {
    config.setConfig('jre.mirror', null);
    config.setConfig('jre.version', null);
    ustcDown = false;
}

function jm(osName, arch) {
    const m = new JreManager();
    m.os = osName;
    m.arch = arch || 'x64';
    return m;
}

(async () => {
    console.log('\njre_mirror（JRE 国内镜像多源轮询 V3.8.5）\n');

    await checkAsync('Windows-x64 候选链 = TUNA → USTC → 官方，且 TUNA 取 .zip 最高版', async () => {
        reset();
        const c = await jm('windows')._getDownloadUrls('21', 'windows', 'x64');
        assert.strictEqual(c.length, 3, '候选数应为 3');
        assert.deepStrictEqual(c.map(x => x.from), ['tuna', 'ustc', 'temurin']);
        assert.ok(c[0].url.endsWith('OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip'), 'TUNA 应取 windows zip 最高版: ' + c[0].url);
        assert.ok(c[0].label.includes('清华TUNA'));
        assert.ok(c[1].url.endsWith('OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip'));
        assert.ok(c[1].label.includes('中科大USTC'));
        assert.ok(c[2].url.includes('api.adoptium.net'), '末位应为官方');
    });

    await checkAsync('Linux-x64 候选链国内优先，TUNA 取 .tar.gz', async () => {
        reset();
        const c = await jm('linux')._getDownloadUrls('21', 'linux', 'x64');
        assert.deepStrictEqual(c.map(x => x.from), ['tuna', 'ustc', 'temurin']);
        assert.ok(c[0].url.endsWith('OpenJDK21U-jdk_x64_linux_hotspot_21.0.13_9.tar.gz'));
        assert.ok(c[1].url.endsWith('OpenJDK21U-jdk_x64_linux_hotspot_21.0.13_9.tar.gz'));
    });

    await checkAsync('macOS-x64 同样国内优先（三平台统一）', async () => {
        reset();
        const c = await jm('macos')._getDownloadUrls('21', 'macos', 'x64');
        assert.deepStrictEqual(c.map(x => x.from), ['tuna', 'ustc', 'temurin']);
        assert.ok(c[0].url.endsWith('OpenJDK21U-jdk_x64_mac_hotspot_21.0.13_9.tar.gz'));
    });

    await checkAsync('arm64 架构映射 aarch64', async () => {
        reset();
        const c = await jm('linux', 'arm64')._getDownloadUrls('21', 'linux', 'arm64');
        assert.ok(c[0].url.includes('/jdk/aarch64/linux/'), 'TUNA 架构应为 aarch64: ' + c[0].url);
        assert.ok(c[1].url.includes('aarch64_linux'));
    });

    await checkAsync('JDK8 特殊文件名格式（8u512b09）可解析', async () => {
        reset();
        const c = await jm('windows')._getDownloadUrls('8', 'windows', 'x64');
        assert.ok(c[0].url.endsWith('OpenJDK8U-jdk_x64_windows_hotspot_8u512b09.zip'), c[0].url);
    });

    await checkAsync('存量用户：jre.mirror 为旧默认 TUNA 值 → 仍走内置多源', async () => {
        reset();
        config.setConfig('jre.mirror', 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium');
        const c = await jm('windows')._getDownloadUrls('21', 'windows', 'x64');
        assert.deepStrictEqual(c.map(x => x.from), ['tuna', 'ustc', 'temurin'], '不应退化为单自定义镜像');
    });

    await checkAsync('jre.mirror 置空 → 仅官方源', async () => {
        reset();
        config.setConfig('jre.mirror', '');
        const c = await jm('windows')._getDownloadUrls('21', 'windows', 'x64');
        assert.deepStrictEqual(c.map(x => x.from), ['temurin']);
    });

    await checkAsync('自定义镜像 → 自定义 label，官方仍兜底', async () => {
        reset();
        config.setConfig('jre.mirror', 'https://custom.example.com/Adoptium');
        const c = await jm('windows')._getDownloadUrls('21', 'windows', 'x64');
        assert.strictEqual(c.length, 2);
        assert.ok(c[0].label.includes('自定义镜像'), c[0].label);
        assert.ok(c[0].url.includes('custom.example.com'));
        assert.strictEqual(c[1].from, 'temurin');
    });

    await checkAsync('锁定 jre.version → 跳过镜像，仅官方（精确版本由官方 API 解析）', async () => {
        reset();
        config.setConfig('jre.version', '21.0.13+9');
        const c = await jm('linux')._getDownloadUrls('21', 'linux', 'x64');
        assert.deepStrictEqual(c.map(x => x.from), ['temurin']);
        assert.ok(c[0].url.includes('/version/21.0.13+9/'));
    });

    await checkAsync('USTC 不可达 → 跳过，TUNA + 官方仍在', async () => {
        reset();
        ustcDown = true;
        const c = await jm('windows')._getDownloadUrls('21', 'windows', 'x64');
        assert.deepStrictEqual(c.map(x => x.from), ['tuna', 'temurin'], 'USTC 应被跳过');
    });

    await checkAsync('全部镜像不可达 → 官方兜底（候选链非空）', async () => {
        reset();
        config.setConfig('jre.mirror', 'https://bad.example.com/Adoptium');
        const c = await jm('windows')._getDownloadUrls('21', 'windows', 'x64');
        assert.deepStrictEqual(c.map(x => x.from), ['temurin']);
    });

    await checkAsync('无法识别的版本号 → 空候选链', async () => {
        reset();
        const c = await jm('windows')._getDownloadUrls('?.?', 'windows', 'x64');
        assert.strictEqual(c.length, 0);
    });

    // 恢复环境
    axios.get = realGet;
    reset();
    try { fs.removeSync(WORK); } catch (e) { /* ignore */ }

    console.log(`\n通过 ${passed} 项，失败 ${failed} 项\n`);
    process.exit(failed ? 1 : 0);
})().catch(e => {
    axios.get = realGet;
    console.error('运行异常:', e);
    process.exit(1);
});
