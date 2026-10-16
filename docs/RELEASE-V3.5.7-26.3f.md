# V3.5.7-26.3f 发布说明（跨平台修复 + Java 自动化 + 危险指令分档开关）

> 发布时间：2026-10-16
> 版本号含义：`V3.5.7-26.3f` = 语义版本 `3.5.7` ｜ 年份后两位 `26`（2026）｜ 十六进制第 63 个发行包（`0x3f` = 63）
> 上一版本：`V3.5.6-26.3e`

---

## 一句话概括

这一版把「只在 Linux 能跑」的隐患集中清理了一遍（**Web 文件管理在 Windows 上完全不可用**、
**JRE 安装依赖 Windows 上不存在的 `unzip`**），并让 Java 环境从「找到哪个用哪个」
升级为「**自动扫描 + 版本精确匹配 + 缺失自动安装**」，同时给 Web 端危险指令加上了分档开关。

---

## 一、本次修复的真实 Bug 清单

| # | 问题 | 影响面 | 严重度 |
|---|------|--------|--------|
| 1 | Web 文件管理全部走 `mkdir`/`mv`/`rm -rf`/`cp -r`/`zip`/`unzip`/`tar` | **Windows 用户完全无法新建文件夹/重命名/删除** | 🔴 致命 |
| 2 | 文件名直接拼接进 shell 命令 | 含 `;`、反引号即可**命令注入** | 🔴 安全 |
| 3 | `getRequiredJavaVersion` 用 `parseFloat` 比较 | **MC 1.3~1.9 全部误判**（1.8.9 被判为需 Java 21） | 🔴 致命 |
| 4 | MC 1.20.5+ 边界写错（`<= 1.20` 归到 Java 17） | 1.20.5~1.20.6 启动失败 | 🟠 高 |
| 5 | `_getFeatureVersion` 只比较字符串 `'8'` | 传数字 `8` 返回 `null`，**跳过版本匹配直接兜底** | 🟠 高 |
| 6 | Temurin 下载 URL 多带 `/version` | 下载 **404** | 🔴 致命 |
| 7 | `_downloadFile` 硬编码 `.zip` 后缀 | Linux/macOS 拿到 `.tar.gz`，**解压分支选错** | 🔴 致命 |
| 8 | `_extractArchive` 无条件调 `unzip` | Windows 无此命令，**JRE 永远装不上** | 🔴 致命 |
| 9 | 解压后未剥壳 | Temurin 内层有 `jdk-17.0.12+7/`，路径对不上 | 🟠 高 |
| 10 | 菜单 13-1 用三个位置参数调 `create(name, opts)` | 用户输入的**版本和加载器被静默忽略** | 🟠 高 |
| 11 | `detectJava` 不校验版本 | 需要 21 时返回 17，**启动即崩** | 🟠 高 |

---

## 二、Web 文件管理：shell → 纯 Node

**之前**：前端所有文件操作都调 `/api/exec`，参数直接拼命令字符串。

```js
// 旧实现（已删除）
await apiExec(`mkdir -p "${path}"`);        // Windows 无
await apiExec(`mv "${from}" "${to}"`);      // Windows 无
await apiExec(`rm -rf "${path}"`);          // Windows 无
await apiExec(`unzip -o "${zip}" -d "${d}"`); // Windows 无
```

8 处调用里只有 1 个在 Windows 勉强可用。

**现在**：全部改为 REST + 纯 Node.js fs。

| 操作 | 新接口 |
|------|--------|
| 新建文件夹 | `POST /api/files/mkdir` |
| 重命名 | `POST /api/files/rename` |
| 移动 | `POST /api/files/move` |
| 复制 | `POST /api/files/copy` |
| 删除 | `DELETE /api/files` |
| 压缩 | `POST /api/files/compress` |
| 解压 | `POST /api/files/extract` |
| 读文本 | `GET /api/files/content` |
| 写文本 | `PUT /api/files/content` |

**配套加固**：

- **跨平台文件名校验**：拒绝 `< > : " | ? *`、控制字符、Windows 保留设备名（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`）、以点或空格结尾、超长
- **zip slip 防御**：解压时逐条校验，拒绝 `..`、绝对路径、盘符越界；被跳过的条目明确报告
- **删除需输入 `DELETE`**：由 `confirm` 升级为全大写文本确认
- `safeResolve` 由「静默剥离前导斜杠」改为**明确拒绝绝对路径**

> `.tar.gz` 的**解压**在 Web 端暂不支持（会给出明确提示），终端可用。

---

## 三、Java：自动搜索、版本匹配、自动安装

### 3.1 全平台扫描

`utils.scanAllJava()` 覆盖 6 类来源：

| 来源 | 路径示例 |
|------|----------|
| PATH | `which java` / `where java`，含 Windows 多个候选 |
| JAVA_HOME | `$JAVA_HOME/bin/java` |
| 系统包 | `/usr/lib/jvm/*`、`/usr/java/*`、`/opt/java/*` |
| IDE 下载 | `~/.jdks/*` |
| 版本管理器 | mise、rtx、sdkman、asdf、jabba |
| 平台特有 | macOS `JavaVirtualMachines/`、Homebrew；Windows `Program Files\Java`、Adoptium、Corretto、Zulu、BellSoft、Semeru、Microsoft |

返回结果按主版本升序、用 `realpath` 去重（避免 `/usr/bin/java → alternatives → 真实 jdk` 被算三次），
每项带 `major`（主版本号）、`source`（来源标签）。

### 3.2 版本匹配策略

**精确优先，仅允许 LTS 向上兼容：**

| 需要 | 可替代 | 理由 |
|------|--------|------|
| Java 8 | ❌ | Java 9+ 移除大量 API，1.12.2 在 17 上必崩 |
| Java 11 | 17 / 21 | LTS 向上兼容 |
| Java 17 | 21 | LTS 向上兼容 |
| Java 21 | ❌ | 1.20.5+ 字节码需要 21+ |

非 LTS（如 Java 20）**不会**被用于替代 LTS 需求。找不到匹配时返回 `null`，
交由上层触发下载 —— **宁缺毋滥**，而不是硬塞一个错版本。

### 3.3 自动安装链路修复

```
下载 → 按重定向 URL 推断扩展名 → 解压到暂存区 → 定位 JDK 根
     → 剥壳提升 → chmod 755 → 落到 core/jre/<版本>/bin/java
```

修复点：

1. **扩展名推断**：按重定向后的最终 URL + `content-type` 判断 `.zip` / `.tar.gz`
2. **纯 Node 解压**：zip 走 `adm-zip`（含 zip slip 防御），tar.gz 走 `tar`
3. **剥壳**：定位含 `bin/java` 的真实 JDK 根，兼容 `stage/bin`、`stage/jdk-xxx/bin`、
   macOS 的 `Contents/Home/bin` 三种布局
4. **权限修复**：Linux/macOS 下对 `bin/*` 补 `chmod 755`
5. **URL 修正**：`baseUrl` 由 `/v3/binary/version` 改为 `/v3/binary`

**实测验证**：Windows / Linux / macOS × Java 8 / 17 / 21 共 9 个 URL 全部可达（HTTP 200/307）。

### 3.4 菜单 11 → 1 重做

由「手填 Java 路径」升级为交互式管理，会列出本机扫描到的**全部 Java**
（标注主版本与来源）供选择，另提供三个入口：

```
当前配置: (自动检测)

本机扫描到 3 个 Java：
   1. Java 8   [系统包]   /usr/lib/jvm/java-8-openjdk/bin/java
   2. Java 17  [sdkman]   /root/.sdkman/candidates/java/17.0.12/bin/java
   3. Java 21  [Adoptium] /opt/eclipse-adoptium/jdk-21.0.4/bin/java

  a. 自动检测（清除手动配置）
  m. 手动输入 Java 路径
  i. 自动安装缺失的 Java（按 MC 版本）
  0. 返回
```

---

## 四、MC 版本 → Java 版本映射修复

**问题代码：**

```js
// 旧实现
const version = parseFloat(minecraftVersion);
if (version <= 1.16) return '8';
```

`parseFloat('1.8.9')` 得到 `1.8`，而 `1.8 <= 1.16` 是 **`false`**（因为 `1.80 > 1.16`），
于是 1.8.9 被判为需要 Java 21。**1.3~1.9 的所有版本都受影响**。

**修复后**按「点分整数」逐段比较：

```js
const cmp = _parseMcVersion(minecraftVersion);  // '1.8.9' -> [1, 8, 9]
```

| MC | 修复前 | 修复后 |
|----|--------|--------|
| 1.8.9 | ❌ Java 21 | ✅ Java 8 |
| 1.12.2 | ✅ Java 8 | ✅ Java 8 |
| 1.20.1 | ✅ Java 17 | ✅ Java 17 |
| **1.20.5** | ❌ Java 17 | ✅ **Java 21** |
| 1.21.4 | ✅ Java 21 | ✅ Java 21 |

同时把 `scheme_manager.js` 里重复的一份映射统一到同一实现，避免两处漂移。

---

## 五、危险指令分档开关（方案 B）

**之前**：硬编码拒绝清单，**无任何放开途径**。

**现在**拆成两档：

| 类别 | 指令 | 开关 |
|------|------|------|
| `SCHEME_OPS` | `scheme create/switch/delete/edit/pull/prune/register/export/import` | `web.allow_scheme_ops: true` |
| `DENIED_WEB_ALWAYS` | `init`、`mod remove/sync/toggle`、`pack install`、`web start`、`logs tail` | ❌ 永久禁用 |
| 远程安装 | `install <http(s)://...>` | `web.allow_remote_install: true` |

两个开关**默认全关**，保持既有安全基线。拒绝时告知所需配置项：

```
该指令已在 Web 端禁用：scheme delete。
如需放开，请在配置中设置 web.allow_scheme_ops: true
```

**启动自检**：检测到「危险开关已开 + 监听 `0.0.0.0` + `dev_mode=true`」等组合时，
启动日志打印安全提示（仅提示，不阻断）。

---

## 六、主菜单调整

**第 2 项：「下载/安装实例」→「新建方案」**

旧实现直接把核心装到当前目录，不建方案也不问方案名，与「方案即运行目录」模型冲突。
现改为完整流程：询问方案名 → 校验 → 选类型 → 问版本/加载器/构建号 → 创建 + 装核心（失败回滚）。

**第 13 项：「备份/恢复 (方案管理)」** 移除「1. 创建方案」，其余重编号为 1-4。

> **顺带修掉一个静默 bug**：旧菜单 13-1 调 `schemeManager.create(name, version, loader)`
> 用的是三个位置参数，而方法签名是 `create(name, options = {})` ——
> 用户输入的版本和加载器**被静默忽略**，永远用默认值。现已改为正确的对象签名。

---

## 七、测试

新增 6 个测试文件，合计 **309 项全部通过**：

| 测试文件 | 数量 | 覆盖内容 |
|----------|------|----------|
| `test/file_ops.test.js` | 56 | 名称校验 15 项、增删改移复制、压缩解压、zip slip 防御、路径穿越总检 |
| `test/file_ops_edge.test.js` | 56 | 名称校验 39 项（Windows 保留名、控制字符、长度边界 255/256）、safeResolve 12 项、实际操作边界（移入自身子目录、删根目录、非 zip、读超限） |
| `test/command_policy.test.js` | 47 | 默认全关、单/双开关、永久拒绝项不受开关影响、审计警告 |
| `test/java_scan.test.js` | 61 | MC→Java 映射 25 项、LTS 兼容策略、扫描去重、类型归一化、严格/放宽模式 |
| `test/web_files_e2e.test.js` | 37 | **真实启动 Web 服务**，逐个验证 9 条文件路由（认证 401、错误码、落盘结果、路径穿越、Windows 保留名） |
| `test/interactive_menu.test.js` | 21 | 菜单 2/13 结构、对象签名调用、旧位置参数已清除、getSchemeDir 已移除 |
| `test/jre_extract.test.js` | 10 | 解压三种布局剥壳、tar.gz / zip 端到端、**手工构造 zip slip 包**验证防御生效 |
| `test/file_manager.test.js` | 21 | 既有测试，同步 1 处断言（绝对路径由静默放行改为拒绝） |

### 测试发现的额外问题（已修）

测试过程中抓出 5 个我最初实现时的问题：

1. **`detectJava(17)` 在只有 Java 20 时返回了 Java 20** —— 退到了「任意可跑」分支，
   改为默认严格匹配、返回 `null`
2. **`getJavaExecutable(8)` 返回 Java 20** —— 根因是 `_getFeatureVersion(8)`（数字）
   返回 `null` 而非 `'8'`，跳过匹配直接兜底
3. **`stopWeb()` 在同进程调用时会杀掉调用方** —— PID 文件记录的是 `process.pid`，
   `stopWeb()` 无条件走「按 PID 杀进程」分支，于是 `process.kill(self, 'SIGTERM')` 自杀，
   表现为调用方在 `stopWeb()` 处挂掉、退出码 143。已改为先判断 PID 是否为自己
4. **`express.json()` 默认 100kb 上限**导致 2MB 的保存请求在 body 解析阶段就被拒，
   且抛出未捕获的 `PayloadTooLargeError` 堆栈 —— 已提升到 4MB 并补上全局错误处理中间件
5. **首个 Java 测试用例自身逻辑错** —— 用 `assert.match(r.reason, /.../)` 断言了
   实际上不含该关键词的字符串（已修正为检查 `ok === false`）

---

## 八、涉及文件

| 文件 | 变更 |
|------|------|
| `core/src/file_manager.js` | +318 行：8 个跨平台文件操作函数 |
| `core/src/web_service.js` | +172 行：9 条文件 REST 路由、启动自检 |
| `core/src/command_policy.js` | +118 行：拆分 `SCHEME_OPS` / `DENIED_WEB_ALWAYS`、审计函数 |
| `core/src/utils.js` | 新增 `scanAllJava` / `findJavaByMajor`，重写 `detectJava` |
| `core/src/jre_manager.js` | 版本匹配重构、纯 Node 解压、剥壳、URL 修正、类型归一化 |
| `core/src/scheme_manager.js` | Java 版本映射统一 |
| `core/src/server.js` | Java 解析改为严格版本匹配 |
| `core/src/installer.js` | Java 解析同步调整 |
| `core/src/interactive.js` | 菜单 2 / 13 / 11-1 改造 |
| `core/src/config.js` | 新增 2 个开关（默认 false） |
| `web/file.html` | 8 处 shell 调用改为 REST |
| `core/test/*.test.js` | 新增 3 个测试文件 |

---

## 九、升级须知

1. **Web 文件管理 API 变更**：如果外部有脚本调 `/api/exec` 做文件操作，需迁移到新的
   `/api/files/*` 接口
2. **危险指令默认仍全部禁用**，与之前行为一致；需要放开请在 `web` 配置段按需开启
3. **Java 行为变更**：`detectJava(版本)` 现在严格匹配版本，匹配不到返回 `null`
   （旧行为返回任意可跑 Java）。如需旧行为，传 `{ allowMismatch: true }`
4. **已有方案的 `scheme.yaml`** 中 `compatibility.java` 可能因映射修复而变化，
   切换方案时会自动重新计算

---

## 十、已知限制

- Web 端**解压仅支持 `.zip`**，`.tar.gz` 请在终端操作（压缩两种格式都支持）
- `scanAllJava()` 在 Windows 上依赖注册表以外的目录约定，非标准安装路径可能扫不到；
  此时可用菜单 11 → 1 → `m` 手动指定
- 自动下载使用 Eclipse Temurin，国内网络可能较慢；可在 `jre.version` 锁定具体版本
  或预先手动放置到 `core/jre/<版本>/`
