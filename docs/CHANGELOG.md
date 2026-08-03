# 📋 更新日志

> wow~ 项目版本历史记录

---

## 版本说明

| 版本 | 状态 | 发布时间 |
|------|------|------|
| **3.3.5** | 当前版本 |2026-08-03|
| **3.3.4** | 上一版本 |2026-08-02|
| **3.3.3** | 上一版本 |2026-08-02|
| **3.3.2** | 上一版本 |2026-08-02|
| **3.3.1** | 上一版本 |2026-08-02|
| **3.3.0** | 上一版本 |2026-08-01|
| **3.2.2** | 上一版本 |2026-08-01|
| **3.2.1** | 上一版本 |2026-08-01|
| **3.1.5** | 上一版本 |2026-07-28|
| **3.1.4** | 上一版本 |2026-07-26|
| **3.1.3** | 上一版本 |2026-07-26|
| **3.1.2** | 上一版本 |2026-07-26|
| **3.1.1** | 上一版本 |2026-07-26|
| **3.1.0** | 上一版本 |2026-07-26|
| **3.0.0** | 上一版本 |2026-07-23|
| **2.0.0** | 内部迭代 |2026-02-27|
| **1.0.0** | 内部迭代 |2026-02-07|

---

## [3.3.5] — 2026-08-03

### 🎮 开服控制台：MC 指令与 wow 指令同台输入

> 在 `wow server start` 的交互终端里，除了 Minecraft 服务端管理员指令（如 `/stop`、`op Steve`），现在还可以直接输入 **wow 服务端指令**（来自本文件 COMMANDS.md）。

- **stdin 接管**：交互模式下 wow 不再把终端原样交给 MC，而是用 readline 读取输入——识别为 wow 指令则交由子进程执行，其余一律转发给 MC 服务端控制台
- **允许清单（不修改运行中的方案文件）**：`server status/stop/kill`、`lan host/stop/status`、`scheme list/info/status`、`mod list`、`logs analyze/report`、`config wow|server|white`（只读形式）、`web stop/status`、`pool stats`、`mail *`、`down`、`plugin list/info`、`theme list/info`、`help`
- **禁用清单（危险 / 冲突 / 抢占终端）**：会修改运行中的方案文件的指令（`scheme create/switch/delete/edit/...`、`mod remove/sync/toggle`、`pack *`、`theme install/switch/delete`、`plugin install/remove`、`install`、`init`、`pool prune`、`config/server` 写入形式、`set`、`config white add/remove`）一律拒绝并提示「请另开终端」；`server start/restart`（与开服进程冲突）、`web start` / `logs tail`（常驻 / 抢占终端）同样禁用；交互菜单 `M` 也禁用
- **执行方式**：允许的 wow 指令通过 `node cli.js <args>` 子进程执行（输出继承当前终端），MC 服务端作为独立进程不受影响、持续运行
- 本地单元测试 + 转发/执行/拒绝三态联调均通过
- 版本号同步至 3.3.5

---

## [3.3.4] — 2026-08-02

### 🐛 修复（联机 / 陶瓦 Terracotta · 解压后找不到二进制）

> 修复 Termux 中回退到 `linux/arm64` 时，下载 100% 后仍报「解压后未找到陶瓦可执行文件」的问题。

- **修正 `locateBinary()` 的文件名匹配逻辑**：陶瓦压缩包解压出的文件名本身带版本号小数点，例如 `terracotta-0.4.2-linux-arm64`。旧逻辑用 `!f.includes('.')` 判断「无扩展名可执行文件」，会误把带 `0.4.2` 点号的合法二进制排除掉，导致任何平台（Windows 除外）都定位失败
- **新的排除规则**：改为 `f.startsWith(prefix)` 后排除已知的非二进制扩展名（`.tar.gz`、`.tar`、`.zip`、`.gz`、`.so`、`.dll`、`.json`、`.txt`、`.md`、`.yaml`、`.yml`、`.log`），保留 `.exe` 和无明确后缀的二进制文件
- **候选排序**：优先无 `.exe`（Linux/macOS），其次 `.exe`（Windows），文件名短的优先
- 本地模拟 Android/Termux 验证通过：`ensureBinary()` 先尝试 `.so`、识别 JNI 后回退、成功解压并定位到 `core/lan/terracotta`（10MB）
- 版本号同步至 3.3.4

---

## [3.3.3] — 2026-08-02

### 🤖 平台支持（联机 / 陶瓦 Terracotta · Android 回退修复）

> 修复：在 Termux 中 `process.platform === 'android'`（并非 `linux`），此前 3.3.1 直接报「平台不支持」，3.3.2 能下载 `.so` 却无法作为命令行进程启动。3.3.3 改为「**优先 android，失败回退 linux/arm64**」。

- **`detectTerraAssets()` 改为返回候选数组**：Android 下按优先级返回 `[android .so, linux/arm64]`，其余平台返回单个候选（向后兼容）
- **下载优先 android、失败回退 linux/arm64**：`ensureBinary()` 依次尝试候选——优先下载 `terracotta-<ver>-android-<arch>.so`；若遇 **HTTP 404 / 网络错误 / 解压失败** 等异常，自动回退到 `terracotta-<ver>-linux-arm64-pkg.tar.gz`（musl 静态二进制，可在 Termux 中直接 `spawn` 运行）
- **`.so` 即 JNI 共享库，不再报错中断**：android 的 `.so` 下载成功后仍会被识别为 JNI 共享库（供 FCL / HMCL 加载、不可作为 CLI 启动），因此**仅作为「优先尝试」**；真正在 Termux 中运行的是回退得到的 `linux/arm64` 二进制，路径统一为 `lan/terracotta`（无扩展名，可直接执行）
- **移除 `startDaemon()` 的 `.so` 硬性拦截**：原 3.3.2 对 `.so` 直接抛错，现因回退逻辑已保证拿到可运行二进制，不再需要拦截
- **`binaryPath()` 使用固定文件名**：Windows 为 `terracotta.exe`，其余（含 Android 回退的 linux/arm64）为 `terracotta`，避免不同扩展名 / 候选导致的路径漂移
- 版本号同步至 3.3.3

---

## [3.3.2] — 2026-08-02

### 🤖 平台支持（联机 / 陶瓦 Terracotta · Android）

- **`detectTerraAsset()` 新增 Android 分支**：`process.platform === 'android'` 时映射为 `osName=android`、`ext=.so`，并采用 Android 专用 arch 命名（arm64→`arm64v8a`、arm→`armv7`、x64→`x86_64`、ia32→`x86`），不再对 Android 直接返回「平台不支持」
- **Android 二进制直链下载（无 tar 解压）**：`resolveDownloadUrl()` 为 Android 拼出 `terracotta-<ver>-android-<arch>.so` 直链（Gitee 上即原样发布，无 `-pkg.tar.gz` 包裹）；`ensureBinary()` 直接把 `.so` 下载到 `lan/terracotta.so`，跳过 tar 解压流程
- **真·Android 启动保护（JNI 说明）**：`startDaemon()` 拦截 `.so` 二进制并给出清晰提示——Android 的 `.so` 是 **JNI 共享库**（需由 FCL / HMCL 等安卓启动器通过 `System.loadLibrary` 加载），**不能**作为独立命令行进程 `spawn`；在手机上用 wow~ 开陶瓦房间请在 **Termux** 中运行（Termux 下 `process.platform` 为 `linux`，会使用可独立运行的 `linux/arm64` musl 静态二进制）
- **消除误报**：此前在 Android / Termux 上会因「平台不支持」提前抛错；现桌面端 arm 命名保持不变（`arm64`/`armv7`，不含无构建的 32 位 linux），Termux 联机路径（linux/arm64 musl）保持可用
- 版本号同步至 3.3.2

---

## [3.3.1] — 2026-08-02

### 🐛 修复（start.sh 多镜像下载）

- **Node.js 便携版下载增加多镜像 fallback**：依次尝试 清华 → npmmirror(阿里) → 腾讯云 → 华为云 → 官方源，任一成功即停止，避免单源故障导致启动失败
- **npm 依赖安装增加多镜像 fallback**：依次尝试 清华 → npmmirror(阿里) → 腾讯云 → 华为云 → npm 官方源，每次失败后清理残留 `node_modules` 和 `package-lock.json` 再重试
- 版本号同步至 3.3.1

---

## [3.3.0] — 2026-08-01

### 🌐 新功能（联机 / 内网穿透 · 陶瓦 Terracotta）
- **对接陶瓦（Terracotta）实现内网穿透联机**：基于 EasyTier 的 [Terracotta](https://github.com/burningtnt/Terracotta)，让没有公网 IP 的房主也能让好友直接加入自己的 Minecraft 服务端
- **「我要当房主」一键开房**：`wow lan host` 命令、交互菜单第 15 项、Web 面板「联机(陶瓦)」页均可开房；陶瓦会自动扫描本机正在运行的 Minecraft 服务端端口并建立穿透通道
- **房间号即加入凭证**：开房成功后返回房间号，好友在 **PCL / HMCL / BakaXL / FCL** 启动器中选择「加入陶瓦房间」并输入该房间号即可联机（3.3.0 仅实现房主端，加入端由上述启动器内置支持）
- **陶瓦二进制运行时自动下载**：首次开房时按平台从默认 **Gitee 镜像**（`https://gitee.com/burningtnt/Terracotta/releases`）下载对应二进制（约 8–14 MB）并解压缓存，之后复用本地缓存，无需手动安装
- **`lan.auto_room` 配置**：设为 `true` 后，启动 Minecraft 服务端时自动开房、停止服务端时自动关房（适合非交互 / 后台 / Docker 场景）
- **Web 面板新增「联机(陶瓦)」页**：显著展示陶瓦版权（AGPLv3 例外条款要求），提供开房 / 查看房间号 / 关房操作
- 版本号同步至 3.3.0

### 📝 许可与致谢
- 陶瓦以 **AGPLv3 + 例外条款** 发布；wow~ 通过陶瓦提供的本地 HTTP API 与之交互（未修改其二进制），并在 CLI / Web / 菜单显著处标注其版权信息，符合其例外条款，wow~ 自身仍保持 MIT 许可

---

## [3.2.2] — 2026-08-01

### 🐛 修复（实时日志与指令输入）
- **`server start` 启动后无实时日志、无法输入指令**：原 `start()` 把子进程 stdout/stderr 仅重定向到日志文件、且未接管终端输入，导致控制台看不到日志、无法向服务器发送命令（并间接造成 `server stop` 的"跨进程模式"提示）
- **交互式终端下改为前台运行**：子进程输出实时转发到控制台并同步写入日志文件，stdin 直接继承终端以支持输入指令（如 `stop`/`list`），并保持前台阻塞直到服务器退出；`Ctrl+C` 优先发送 `stop` 优雅关闭
- **非交互环境（Web 面板 / Docker）保持原文件重定向行为**
- **交互式菜单启动服务器前暂停 readline**（`rl.pause()`），避免与服务器的终端输入冲突，结束后恢复
- 版本号同步至 3.2.2

### 🐛 修复（服务端核心隔离 / CLI 参数）
- **安装时清理旧核心，实现版本隔离**：`install` 在安装前调用 `_cleanupOtherCores()`，清理 `server/` 根目录下其它服务端核心，避免安装 forge + vanilla 等多个核心堆在根目录互相干扰（已验证：仅删除其它核心、保留目标核心、`authlib-injector` 白名单与 `libraries/` 依赖子目录均不受影响）
- **原版核心文件名加类型前缀**：由 `minecraft_server.<ver>.jar` 改为 `vanilla-<ver>.jar`，便于按类型识别与隔离
- **放行子命令的 `--version` 参数**：全局版本标志由 `--version` 改为 `-V`，避免 `wow scheme create --mc-version 1.20.1` 等子命令参数被全局 `--version` 静默拦截
- 报告版本号由过时的 3.1.5 修正为 3.2.2

---

## [3.2.1] — 2026-08-01

### 🔧 优化
- **Termux 环境自动安装 OpenJDK 17**：`start.sh` 在 Termux 中检测到无 Java 时，自动执行 `pkg install -y openjdk-17`，确保 Minecraft 服务端在安卓上无需手动配置 Java 即可直接运行
- 版本号同步至 3.2.1

---

## [3.1.5] — 2026-07-28

### 🔧 优化
- **Node.js 下载改用清华镜像**：`start.sh` 从 `https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/` 获取便携 Node.js（原为 nodejs.org）
- **npm 依赖安装改用清华镜像**：依赖安装使用 `https://mirrors.tuna.tsinghua.edu.cn/npm/` 作为 registry
- 文档不再明示支持安卓（不把安卓 / Termux 列为支持平台）
- 版本号同步至 3.1.5

### 📝 文档修复
- **修复 README 文档死链**：插件文档链接 `docs/PLUGINS.md` → `docs/WOW-PLUGINS.md`（实际文件名）
- **补全缺失文档**：新增 `docs/WEB_PANEL.md`（Web 面板使用说明）与 `docs/API.md`（Web API 参考），此前 README 引用但文件缺失
- **`server stop` 跨进程提示文案更准确**：不再误导"请使用 kill 强制终止"，改为说明将自动发送 SIGTERM 由 Minecraft 优雅关闭

---

## [3.1.4] — 2026-07-26

### 🔧 修复（面板/Docker 兼容性）
- **`start.sh` 非交互环境自动下载 Node.js**：移除 `read` 交互确认，检测到非 TTY（Pterodactyl/Docker）时自动下载便携 Node.js
- **`start.sh` 无参数默认启动 Web 面板**：面板启动命令只写 `./start.sh` 时，不再打印 `--help` 后退出，而是默认 `web start` 保持进程常驻
- **交互式菜单（`wow m`）改为纯数字导航**：
  - 主菜单重排顺序：1.启动服务器　2.下载/安装实例　3.变更配置　4.管理模组/插件　5.错误日志分析……（见 `wow m`）
  - 仅接受数字选择（1-14）；非数字输入提示用户查阅 README.MD 的命令说明，**不再在菜单内执行长命令**
  - 仍用数值比较，避免字符串比较把 `2`~`9` 误判非法
- **`start.bat` 无条件 `pause` 防闪退**：无论命令是否带参数、是否报错，执行结束后都暂停等待按键，避免 cmd 窗口输出一段后直接关闭看不到结果
- **`start.sh` 增强非 glibc 环境适配**：
  - 在非 glibc 环境下改用系统包管理器提供的 Node.js，不再下载 glibc 便携版
  - 标准 Linux / macOS 仍走原有便携 Node 下载逻辑
- 版本号同步至 3.1.4

---

## [3.1.3] — 2026-07-26

### 🔧 修复
- **启动脚本 npm 路径问题**：`start.sh`/`start.bat` 中 npm 符号链接断裂导致依赖安装失败，改为保留完整 Node.js 目录结构

---

## [3.1.0] — 2026-07-26

### 🆕 新增功能

- **交互式菜单模式** (`wow m`)：14 项主菜单，数字选择引导操作，支持 `wow m <N>` 直达
- **多格式模组配置管理** (`config mods`)：支持读取/编辑 `config/` 目录下 JSON/TOML/YAML/properties/CFG 文件
  - `list` — 列出配置文件 | `view` — 查看内容 | `get` — 读取嵌套键值 | `set` — 设置键值（自动备份）
- **server.properties 增强管理**
  - `config server-list` — 分类列出所有属性
  - `config server-quick` — 快速设置向导
  - `config server-reset <key>` — 重置为默认值

### 🔧 修复

- **Web 服务跨进程管理**：`web stop/status` 改用 PID 文件方案，支持跨进程调用
- **服务器跨进程停止**：`server stop` 跨进程时自动降级为 SIGTERM（Minecraft 优雅保存退出）
- **自动同意 EULA**：`server start` 自动写入 `eula=true`，方案创建时默认同意
- **Commander `--version` 冲突**：子命令版本参数改为 `-v, --mc-version`，避免被全局 `-V` 拦截

---

## [3.0.0] — 2026-07-23

### 🎉 重大更新：完全重写为 Node.js

- 使用 Node.js 完全重写，不再依赖 Python
- 启动脚本自动检测系统架构并下载便携版 Node.js
- 所有功能模块化，代码结构清晰

### ⭐ 新特性

#### 模板模式方案管理
- 首创“模板模式”多实例管理，兼顾硬盘占用与启动速度
- 方案状态自动判定：`minimal` / `partial` / `full`
- 资源池 (pool) 通过 SHA-256 自动去重共享
- `auto_scheme` 自动管理方案状态，支持手动接管

#### Web 管理面板
- 全功能 Web 面板，支持远程管理
- 邮箱验证码登录，JWT 会话管理
- 仪表盘：服务器控制、实时日志、状态监控
- 方案管理：创建/切换/拉取/瘦身
- 文件管理：上传/下载/解压/打包
- 模组/核心下载搜索 (CurseForge/Modrinth/BMCLAPI2)
- AI 日志分析 (OpenAI 兼容 API)
- 主题包管理：一键切换，安全警告
- wow 插件管理：扩展 CLI 命令

#### 主题包系统
- 主题包通过 ZIP 安装，包含 `theme.json` 签名文件
- 完全替换 `web/` 目录，文件结构自由
- 切换时弹出安全警告

#### wow 插件系统
- 插件通过 ZIP 安装，包含 `plugin.json` + `index.js`
- 可添加自定义 CLI 命令
- 上下文对象 (context) 访问核心模块
- 支持使用其他语言编写（通过子进程调用）
- 目录结构完全自由

#### 服务器管理增强
- 自动下载对应版本的 JRE
- 集成 authlib-injector，支持外置登录 (LittleSkin 等)
- 服务器控制台命令输入
- 实时日志 WebSocket 推送

#### 邮件系统
- SMTP 邮件支持
- 登录验证码发送
- 服务器崩溃报告
- 定时日志摘要 (15 分钟限流)

### 🔧 改进

- 启动脚本自动检测系统架构（Windows/Linux/macOS）
- 首次启动自动下载 Node.js 便携版
- 配置文件使用 YAML 格式，更易读
- 所有目录结构由 `init` 命令自动创建
- 错误信息更详细，便于排查

### 🐛 修复

- 修复 Windows 中文路径乱码问题
- 修复跨平台路径分隔符不一致问题
- 修复 Mohist 核心下载构建号解析
- 修复 Web 面板 WebSocket 断线重连

---

## [2.0.0] — 2026-02-27

### 🎉 重大更新：引入 Web 面板

- 新增 Web 管理面板 (Python + Flask)
- CLI 命令大幅扩展

### ⭐ 新特性

- Web 面板基础功能（仪表盘、服务器控制）
- 模组管理
- 配置文件编辑
- 主题包系统雏形

### 📦 发布变体

| 变体 | 说明 |
|------|------|
| **轻量版** | 用户自行安装 Python 和 JRE |
| **兼容版** | 预装便携版 Python 和 JRE |

### 🔧 改进

- 命令结构重新设计，更规范
- 错误处理增强

---

## [1.0.0] — 2026-02-07

### 🎉 首次发布

- 纯 CLI 模式 (Python)
- 基础服务器管理：启动/停止/重启/状态
- 服务端核心安装 (Vanilla/Forge/Fabric/Paper/Mohist/CatServer)
- 基础模组管理
- `serverchange.py` 配置文件编辑器

### 🔧 技术栈

- Python 3.7+
- argparse 命令行解析
- 单文件设计，散装项目

---

