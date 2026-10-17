# V3.5.8-26.3g 发布说明

> 发布日期：2026-10-17
> 主题：**修复 Forge 类型安装后核心路径找错**

---

## 一句话概括

Forge / NeoForge 的安装产物布局随 MC 版本剧烈漂移，旧实现只有一条
`/^forge-.+-server\.jar$/` 正则硬匹配。命中不了就退化成「盲选」，
于是出现两种症状：

1. 安装阶段直接报「未找到匹配的服务端核心」，方案创建失败；
2. 安装「成功」但启动的是**原版**（`minecraft_server.<mc>.jar` 抢了位置）；
3. 切换方案后提示「目录内没有可运行的核心」——核心被补齐到了错误的目录。

---

## 一、根因：Forge 的产物布局本来就不统一

| MC 版本 | `--installServer` 的真实产物 | 旧正则命中？ |
|---------|------------------------------|--------------|
| 1.12.2 | 根目录 `forge-1.12.2-14.23.5.2860.jar` | ❌ 无 `-server` 后缀 |
| 1.16.5 | 根目录 `forge-1.16.5-36.2.39.jar` + `minecraft_server.1.16.5.jar` | ❌ 无 `-server` 后缀 |
| 1.17 ~ 1.20.4 | `libraries/net/minecraftforge/forge/<mc>-<ver>/forge-<mc>-<ver>-server.jar` + `unix_args.txt` | ✅ 唯一正常区间 |
| 1.20.5 ~ 1.21+ | 同目录，但**只有** `unix_args.txt` / `win_args.txt` | ❌ 无独立核心 jar |
| NeoForge | `libraries/net/neoforged/neoforge/<ver>/` + args 文件 | ⚠️ 同构脆弱 |

更麻烦的是 1.16.5 这种「根目录同时躺着 Forge 核心和原版核心」的布局：
`_getServerJar()` 的兜底分支是「找文件名里含 `server` 的」，而
`minecraft_server.1.16.5.jar` 恰好含 `server`，Forge 核心反而不含 ——
**装的是 Forge，跑起来是原版**。

---

## 二、修复内容

### 2.1 安装阶段：新增 `_detectForgeJar(dir, type)`

三级优先探测，替换掉单一正则：

```
① *args.txt 优先
   找到 unix_args.txt / win_args.txt / args.txt 后，其所在目录即 Forge 安装根
   → 同目录的 jar 才是真实核心（-server.jar 优先）
   → 该目录若无 jar（1.21+），直接返回 args 文件（走 @args 启动）

② 前缀 + 形态匹配
   递归搜 forge- / neoforge- 前缀 jar
   → 优先 -server.jar
   → 其次不带修饰后缀的普通核心 forge-<mc>-<ver>.jar
   → 最后才退回首个

③ 老版本兜底
   退回原 pattern，兼容历史行为
```

**显式排除的误选源**（这是修 bug 的关键）：

- `minecraft_server.<mc>.jar` / `server-<mc>.jar` —— 原版核心，不是加载器
- `*-installer.jar` —— 安装器，`java -jar` 会报 `Invalid or corrupt jarfile`
- `*-shim.jar` —— Forge 1.21 的引导壳，不是游戏核心
- `*-universal.jar` / `*-client.jar` —— libraries 里同为 `forge-` 前缀的**库文件**

> `-universal.jar` 这一项是测试跑出来才发现的。最初写了个「libraries 里的优先」的规则，
> 结果 1.16.5 布局下选中了 `forge-1.16.5-36.2.39-universal.jar` —— 那是个库，不能启动。

### 2.2 启动阶段：`server._getServerJar()` 去掉盲选

- Forge / NeoForge 类型下，显式优先 `forge-` / `neoforge-` 前缀核心，**排除原版**
- 根目录没有任何 jar 时，若配置里有 `server.launchArgsFile` 就直接返回它
  （1.21+ 的正常形态），不再抛「未找到核心」

### 2.3 方案层：核心路径不再被「拍平」

这才是「切换方案后核心路径找错」的真正根因。

旧链路：

```
create     核心在 libraries/.../forge-xxx-server.jar
           ↓ _addToPool() 只取 path.basename()
入池       pool/cores/forge/1.20.1/forge-1.20.1-47.2.0-server.jar   ← 层级丢了
prune      按 scheme.yaml 里的 file（纯文件名）去方案根目录找 → 找不到 → 删不掉
materialize 从池里按纯文件名补回 → 落到方案根目录 → 与真实位置对不上
```

修复：

| 改动点 | 内容 |
|--------|------|
| `_addToPool()` | 新增 `relPath` 参数，池内按原始相对路径落盘 |
| `scheme.yaml` | `resources.core.file` 改记**相对方案根目录的完整路径** |
| `_resolveCoreTarget()` | 新增统一解析，兼容新格式 / 老格式 / Windows 反斜杠 / `./` 前缀 |
| `_materializeScheme()` | 补齐时 `ensureDirSync(dirname)` 还原深层目录 |
| `_pruneScheme()` | 按相对路径删除，不再只看根目录 |
| `_copyToPool()` | args 文件不当核心复制，避免污染共享池 |
| pool 核心缺失 | 不再静默跳过（旧行为强标 FULL 但实际缺核心，启动才报错），改为明确告警 |

---

## 三、测试

新增 2 个测试文件、35 项，全部离线运行（不需要联网、不需要真装 Forge）：

### `core/test/forge_core_path.test.js`（26 项）

在临时目录里造出 5 种真实布局：

- **A** 1.16.5：根目录 forge jar + 原版核心 + installer + libraries
- **B** 1.20.1：libraries 深层 `-server.jar` + `unix_args.txt` + shim
- **C** 1.21+：只有 args 文件，根目录只有原版
- **D** NeoForge 1.21
- **E** 1.12.2：根目录 jar，libraries 里有 `-universal.jar`

验证点：探测结果正确、绝不选中原版 / installer / shim / universal、
空目录返回 `null` 不抛异常、args 文件能被定位。

### `core/test/forge_scheme_roundtrip.test.js`（9 项）

端到端跑完整链路，完全隔离到临时目录（不写真实的 `scheme/` 与 `wow.yaml`）：

```
造深层核心 → _addToPool → _pruneScheme → _materializeScheme
```

验证点：池内保留层级、瘦身能删掉深层文件、补齐回到原位、
根目录不出现被拍平的 jar、老方案（纯文件名）仍解析正确。

### 全量回归

| 测试文件 | 项数 |
|----------|------|
| command_policy | 47 |
| file_manager | 21 |
| file_ops | 56 |
| file_ops_edge | 56 |
| **forge_core_path** | **26** |
| **forge_scheme_roundtrip** | **9** |
| interactive_menu | 21 |
| java_scan | 61 |
| jre_extract | 10 |
| web_files_e2e | 37 |
| **合计** | **344 项全部通过** |

工作区无污染：`scheme/` 为空、`core/wow.yaml` 的 `jar` / `scheme` 仍为初始值。

---

## 四、升级须知

- **老方案无需迁移**。`resources.core.file` 是纯文件名的老方案继续可用
  （解析到方案根目录），新方案才会记录深层相对路径。
- **已装过的 Forge 1.21+ 方案建议重建**。旧版本在安装阶段就会抛「未找到核心」，
  目录里可能残留不完整的 `libraries/`。直接 `scheme delete <名>` 后
  `scheme create <名> --type forge --version 1.21.1` 重新来一遍最稳妥。
- 若 `scheme.yaml` 的 `core.file` 与实际文件对不上，删掉方案重建比手动改 YAML 省事。

---

## 五、涉及文件

| 文件 | 改动 |
|------|------|
| `core/src/installer.js` | +117 行：`_detectForgeJar()` 新增，`_installModLoader()` 接入，`_copyToPool()` 加 jar 校验 |
| `core/src/scheme_manager.js` | +54 / -16：`_addToPool()` 支持 relPath，`_resolveCoreTarget()` 新增，create / materialize / prune 三处统一 |
| `core/src/server.js` | +24 行：`_getServerJar()` 排除原版、支持 args-only |
| `core/test/forge_core_path.test.js` | 新增，26 项 |
| `core/test/forge_scheme_roundtrip.test.js` | 新增，9 项 |
| `docs/CHANGELOG.md` | 新增 3.5.8-26.3g 条目 |
| `docs/RELEASE-V3.5.8-26.3g.md` | 本文件 |
