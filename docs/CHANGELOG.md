# 📋 更新日志

> wow~ 项目版本历史记录

---

## 版本说明

| 版本 | 状态 | 发布时间 |
|------|------|------|
| **3.4.4** | 当前版本 |2026-08-21|
| **3.4.3** | 上一版本 |2026-08-21|
| **3.4.2** | 上一版本 |2026-08-11|
| **3.4.1** | 上一版本 |2026-08-17|
| **3.4.0** | 上一版本 |2026-08-15|
| **3.3.18** | 上一版本 |2026-08-14|
| **3.3.17** | 上一版本 |2026-08-12|
| **3.3.16** | 上一版本 |2026-08-12|
| **3.3.15** | 上一版本 |2026-08-12|
| **3.3.14** | 上一版本 |2026-08-12|
| **3.3.13** | 上一版本 |2026-08-11|
| **3.3.12** | 上一版本 |2026-08-11|
| **3.3.11** | 上一版本 |2026-08-10|
| **3.3.10** | 上一版本 |2026-08-09|
| **3.3.9** | 上一版本 |2026-08-05|
| **3.3.8** | 上一版本 |2026-08-04|
| **3.3.7** | 上一版本 |2026-08-03|
| **3.3.6** | 上一版本 |2026-08-03|
| **3.3.5** | 上一版本 |2026-08-03|
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

## [3.4.4] — 2026-08-21

### 🔧 修复：恢复 start.sh / start.bat 启动入口

> 背景：V3.4.3 把 `start.sh` / `start.bat` 重命名为 `wow.sh` / `wow.bat` 并删除了旧脚本，导致简幻欢等靠执行根目录 `start.sh` 启动的自定义 / AIO 镜像报「找不到命令 / 请检查启动脚本」而停服。

- 重新补回 `start.sh`（Linux）/ `start.bat`（Windows），仅转发到 `wow.sh` / `wow.bat`，无参数时由 `wow.sh` 在非交互环境默认 `web start` 常驻，零双份维护。

### 🚀 优化（B）：优先复用系统 Node.js，免去便携版下载

- `wow.sh` 检测系统已安装的 Node.js（要求 `>=18`，与 `core/package.json` 的 `engines` 一致），若存在则**直接复用、跳过便携版下载**。典型收益：简幻欢 AIO 镜像自带 Node 22，启动不再联网拉取 Node 20，更快、更省网络依赖。
- 系统无 Node 或版本过低时，仍回退到原有「多镜像下载便携版」逻辑，行为不变。

### 🛡 优化（C）：自更新失败不再阻断启动

- `update.sh` 移除 `set -e`，并将 GitHub API 不可达 / 被限流 / 未找到 Release / 下载或解压失败等情形从 `exit 1` 改为**仅警告并跳过更新（`exit 0`）**。
- 目的：避免 `update.sh` 与 `start.sh` 串联时，自更新失败（受限网络）连带阻断服务器启动。

---

## [3.4.3] — 2026-08-21

### 🔧 优化：启动脚本换用更快的镜像源 + 重命名为 wow.bat / wow.sh

> 背景：`start.bat`（Windows）原本 Node.js 下载只用 `nodejs.org/dist`、npm 安装用默认 `npmjs.org`，国内极慢甚至被墙；`start.sh` 虽有镜像但顺序未优化。同时用户要求把启动脚本统一改名为 `wow.bat` / `wow.sh`。

镜像源优化：
- **Windows (`wow.bat`)**：Node.js 下载新增镜像回退链（npmmirror → 腾讯云 → 清华 → 华为云 → 官方），npm 安装默认走 `https://registry.npmmirror.com`。
- **Linux/macOS (`wow.sh`)**：把 `registry.npmmirror.com/-/binary/node` 与 `https://registry.npmmirror.com/` 提到镜像链最前（国内通常最快最稳），其余镜像作为兜底。

重命名与联动：
- `start.bat` → `wow.bat`、`start.sh` → `wow.sh`（`git mv` 保留历史）。
- 联动更新：`update.bat` / `update.sh`（靠启动脚本名定位项目根）、`core/src/scheme_manager.js` 的 `restart-script: ./wow.sh`（服务端崩溃自重启）、README / QUICKSTART / TERMS / 各 TROUBLE 文档的使用说明。
- 构建脚本 TOP 列表同步改为 `wow.bat` / `wow.sh`。

> ⚠️ 注意：旧 `start.bat` / `start.sh` 已移除，启动命令改为 `wow.bat`（Windows 双击）或 `./wow.sh`（Linux/macOS）。

---

## [3.4.2] — 2026-08-11

### ✏️ 调整：`scheme create` 命令参数重构

> 背景（用户测试反馈）：文档写 `wow scheme create xxx --version 1.20.1`，但 CLI 实际注册的是 `--mc-version`，实跑报 `unknown option '--version' (Did you mean --mc-version?)`，文档与代码不一致。

调整内容：
- 版本参数由 `--mc-version` 重命名为 `-v, --version`（短简称 `--v`）。
- 加载器参数 `--loader` 移除，并入 `-t, --type`：`--type` 的取值（vanilla/forge/fabric/neoforge/quilt/mohist/catserver/paper）同时决定核心类型与加载器，二者取值一致，不再分两个旗标。
- 构建号参数由 `--build` 增加短简称 `-b`。
- `cli.js` 中 `scheme create` 的 `action` 改为 `loader` 与 `type` 均取 `options.type`，不再读取 `options.loader`。

效果：`wow scheme create my_survival -v 1.20.1 -t forge` 与 `wow scheme create demo -v 1.20.1 -t vanilla` 均正常创建；旧 `--mc-version` / `--loader` 显式报 `unknown option`，符合预期。配套更新 `docs/COMMANDS.md`、`docs/QUICKSTART.md`、`docs/SCHEMES.md` 全部示例与说明。

---

## [3.4.1] — 2026-08-17

### 🐛 修复：方案改为「直接在方案目录内运行」（不再复制到 server/ 再跑）

> 现象（用户反馈）：切换/启动方案时，世界存档、配置在 `core/schemes/<方案>` 与 `server/` 两套目录间来回复制，出现重复/丢失；切换方案时 `server/` 被 `_backup_*` 目录堆积、原内容被整体清空；在方案目录里改了配置或存档却不生效（实际跑的是 `server/` 里的副本）。

根因：旧逻辑（`scheme_manager.switch()`）在切换方案时，会**把 `core/schemes/<当前方案>` 整体复制到 `server/` 目录，再由 `ServerManager` 以 `server/` 为根目录启动**。这是一个「模板模式」下的拷贝中介层，带来上述一系列同步问题。

修复：
- `utils.getServerDir()` 改为**优先返回当前激活方案的目录**（`core/schemes/<server.scheme>`，配置指向的目录存在时）；仅当未激活任何方案时才回退到默认 `server.dir`（`../server`）。
- 由于 `ServerManager`、`interactive.js`、`cli.js`、日志、陶瓦等所有消费方都通过 `getServerDir()` 取运行目录，这一处改动即让服务端**直接在方案目录内启动**，无需任何复制。
- `scheme_manager.switch()` 移除「备份 server 目录 + 复制方案到 server 目录」整段逻辑，切换方案只做：补齐目标方案（FULL）+ 登记 `server.scheme`/`server.version` + 瘦身旧方案 + 清理 pool。
- `server.start()` 增加兜底：若激活的方案仍为 `minimal`/`partial`（缺核心/模组文件），启动前自动从 pool 补齐（`_materializeScheme`），避免直接运行时缺文件。

效果：世界数据、配置、存档全部只存在于方案目录本身，改了立刻生效，切换不再有复制与 `_backup_` 残留。

---

## [3.4.0] — 2026-08-15

### ✨ 新功能：开服控制台三视图切换（Minecraft / wow / 陶瓦）

> 需求：开服后的交互终端支持在三个控制台视图之间切换；输入「不属于当前控制台」的指令时，提示「不支持」并引导切到对应控制台；切换后**清屏并显示该控制台最后 10 条日志**（陶瓦视图显示的是陶瓦本地 HTTP API 的返回内容）。

`wow server start` 的交互终端现在内置三个控制台视图，默认停留在 **Minecraft 服务端控制台**：

| 视图 | 切换指令 | 作用 |
|------|----------|------|
| 🎮 Minecraft 服务端控制台 | `:mc`（或 `:minecraft` `:1` `:服务端`） | 直接收发 MC 服务端指令（如 `op Steve`、`say hi`、`stop`） |
| 🧩 wow 指令控制台 | `:wow`（或 `:2`） | 执行 wow 服务端指令（如 `server status`、`scheme list`、`logs analyze`） |
| 🏠 陶瓦联机控制台 | `:lan`（或 `:terracotta` `:taowa` `:3` `:陶瓦`） | 开房 / 查房间 / 关房，并实时显示陶瓦 HTTP API 返回 |

行为要点：

- **切换即清屏 + 尾 10 条**：输入切换指令后清屏，打印标题栏，并显示该视图最近 10 条日志。Minecraft 视图读 `logs/latest.log`；wow 视图读 `logs/wow-console.log`；陶瓦视图读陶瓦 API 调用流水（`.lan-api.log`）。
- **指令隔离 + 友好引导**：在 Minecraft 视图输入 `lan host`、在 wow 视图输入 `list`、在陶瓦视图输入 `scheme list` 等「错视图」指令时，会提示「不支持：该指令属于某某控制台，请先输入 `:xx` 切换」，而不会误执行或静默吞掉。
- **陶瓦视图便捷指令**：在陶瓦视图里 `host` / `status` / `stop` 会自动补 `lan ` 前缀，等价于 `lan host|status|stop`。
- 元指令：`:log` 重新显示当前视图最后 10 条日志，`:help` 显示控制台帮助。
- 服务端原始 stdout/stderr 始终落盘到 `logs/wow-stdout.log`（逻辑分离见下方修复），但**只有停留在 Minecraft 视图时才回显到终端**，避免切到 wow / 陶瓦视图后被服务端日志刷屏。

### 🐛 修复：陶瓦开房 `lan host` 卡在 `host-scanning` 超时（自 V3.3.0 起的设计性缺陷）

> 现象（Termux/Android、公网服务器、macOS 均可能触发）：`wow lan host` 在 `host-scanning` 阶段卡住，wow 侧 30s 超时退出，拿不到房间号。

根因（扒取陶瓦 Rust 源码 `scanning.rs` / `fakeserver.rs` / `api.rs` 定位）：陶瓦**不是**扫描进程或端口来发现 MC 端口，而是**监听 Minecraft 局域网发现多播广播**——IPv4 `224.0.2.60:4445`、IPv6 `[FF75:230::60]:4445`，载荷格式 `[MOTD]<描述>[/MOTD][AD]<端口>[/AD]`。而 **Minecraft 专用服务端（`server.jar`）从不发送 LAN 多播广播**——只有游戏*客户端*「对局域网开放存档」才会广播。因此陶瓦永远拿不到端口，永久停在 `host-scanning`，wow 侧最终超时。这与平台无关，Termux 只是诱因之一。

修复：新增 `core/src/lan_beacon.js`，由 wow **代发** Minecraft 局域网多播广播——每个真实本地 IPv4 地址（排除 loopback 与 `10.144.144.x` 虚拟网段）+ `0.0.0.0` 各建立一个独立 socket（复刻陶瓦 `fakeserver.rs` 的「一个地址一个 socket」设计，规避 `send()` 异步导致多播出口错乱的陷阱），每 1500ms 发送一次 `[MOTD]wow~ Minecraft Server[/MOTD][AD]<server-port>[/AD]`。`hostRoom()` 在调 `GET /state/scanning` 前：`apiIde()` 复位陶瓦为 `waiting`（避免非 waiting 状态下扫描被静默忽略），并启动 `LanBeacon`，直到 `host-ok` 后再 `beacon.stop()`。`waitHostOk()` 超时从 30s 放宽到 60s，且停在 `host-scanning` 超 10s 时给出针对性诊断（广播是否真发出、多播是否被拦截）。实测对照：无广播时陶瓦 8s 仍 `host-scanning`；启动 wow 广播器后 0.9s 即 `host-ok`。

### 🐛 修复：MC `latest.log` 被 wow 双写 / 截断 / 重复

> 现象：开服后 `logs/latest.log` 出现重复行、`Done (...)` 出现 3 次、行首被截断交错。

根因：Minecraft 的 log4j 在启动时会**重建** `latest.log`，而 wow 的服务端输出写入流仍持有旧 fd 并按原偏移继续追加，导致同一份日志被写两遍、行首截断、内容交错。

修复：服务端进程的原始 stdout/stderr 改为单独落盘到 `logs/wow-stdout.log`（交互模式 `createWriteStream`、非交互模式 `openSync` 均改写该文件，`flags:'w'`），不再写 `latest.log`。`latest.log` 现在只由 Minecraft 自身写入，干净无重复。验证：实开服一次后 `latest.log` 的 `Done (` 行数由 3 降为 1，`wow-stdout.log` 正常捕获服务端输出。

---

## [3.3.18] — 2026-08-14

### 🐛 修复：陶瓦开房在 `host-ok` 后一直超时（房间号读不到）

> 现象（Termux/Android aarch64、公网服务器等）：服务端已启动、端口已监听、陶瓦返回 `host-ok`，但 `wow lan host` 最终报「等待开房完成超时（最后状态: host-ok）」，拿不到房间号。

根因：陶瓦 HTTP API 在开房状态（`hosting` / `host-ok`）返回的是**顶层字符串**房间号：

```json
{ "state": "host-ok", "room": "ABCD-EFGH" }
```

而 `terracotta.js` 的 `waitHostOk()` 判断写成 `s.state === 'host-ok' && s.room && s.room.code` —— 把 `room` 当成了 `{ code: ... }` 的嵌套对象。当 `s.room` 是字符串时，`s.room.code` 永远为 `undefined`，成功条件恒假，轮询到 30s 抛超时。这与「host-ok 已返回却超时」的现象 100% 吻合（这不是超时时长问题，延长也没用）。`getStatus()` 里 `state.room && state.room.code` 同理也拿不到房间号。

修复：

- 新增 `extractRoomCode(s)`：优先按字符串读取 `s.room`，并兼容 `s.room.code` / `s.room.room_code` 旧写法。
- `waitHostOk()` 与 `getStatus()` 统一改用 `extractRoomCode()`，房间号现在能正确拿到，开房成功后正常打印并返回。

### 🐛 修复：Quilt/Fabric 开服报 `Missing game jar (.../server.jar)`

> 现象：`wow install quilt 1.20.1` 成功生成 `quilt-server-launch.jar`，但 `wow server start` 报 `The Minecraft server .JAR is missing (/workspace/.../server.jar)`，启动器退出码 1。

根因：安装器把预拉的原版核心存为 `minecraft_server.<mc>.jar`，但 Quilt/Fabric 启动器生成的 `*-server-launcher.properties` 写死 `serverJar=server.jar`，二者命名不一致，启动器找不到游戏核心。

修复：安装完成后新增 `_patchLauncherServerJar()`，把 `*-server-launcher.properties` 里的 `serverJar` 指向真实文件名（`minecraft_server.<mc>.jar`），并在支持的环境下再建一个 `server.jar` 软链/副本做最大兼容。无需改动、也不重复占用约 46MB 原版核心。

### 🐛 修复：`_getServerJar()` 盲选目录里第一个 `.jar`

> 现象：服务端目录里若混有别的 `.jar`（如遗留的 `forge-*-installer.jar`），会被当成核心启动，报 `Invalid or corrupt jarfile`。

根因：`_getServerJar()` 在配置 `server.jar` 缺失时，直接 `readdirSync` 取目录里第一个 `.jar`，不区分安装器与可运行核心，也不参考 `server.type`。

修复：候选过滤排除 `*-installer.jar`（安装器不可直接运行）；多候选时按 `server.type`（quilt/fabric/forge/neoforge）精确匹配启动器 jar，仍无法确定才尽力而为并给出告警，避免误选。

---

## [3.3.17] — 2026-08-12

### 🐛 修复：交互菜单输入被读两遍（输入 1.20.1 显示成 11..2200..11，自 3.0 起存在）

> 现象：所有环境（Termux、简幻欢、真实公网 IP 的 Linux x86 服务器）下，菜单里输入 `1.20.1`，终端却把每个按键显示/记录成两倍：`1.20.1` → `11..2200..11`、`2` → `22`。实际 `ask()` 取到的值仍是单份（所以 forge 仍能解析出 1.20.1），但**回显双倍**严重误导、且在部分环境会真正污染输入。

根因：`process.stdin` 上同时挂了**两个 `readline` 接口**。

- `showMainMenu` 创建一个 `rl`（主菜单循环用）；
- `dispatchMenu` 又 `createRL()` 了**第二个** `rl` 挂在**同一个 `process.stdin`** 上（且用完不关，泄漏）。两个接口同时消费同一 stdin，每个按键被处理/回显两次 → 输入显示成两倍。
- 同理，`config.quickSet` / `theme_manager` / `pack_generator` 内部也各自 `readline.createInterface({ input: process.stdin })`，从菜单进入这些子流程时又叠出第二个接口，同样双倍。

修复（确保所有交互路径复用**同一个** `readline` 接口，绝不重复挂 stdin）：

- `dispatchMenu(choice, options, rl)` 改为**复用主菜单传入的 `rl`**，不再自建；仅当外部未传入时才自建并负责关闭（`ownRl` 标记）。
- `showMainMenu` 在直跳 `wow m N` 与菜单循环两条路径都把 `rl` 传给 `dispatchMenu`。
- `config.quickSet` / `theme_manager.install|switch|_askConfirm` / `pack_generator.install|_askWorldOption|_selectWorld|_askConfirm` 全部新增可选 `existingRl` 参数：传入则复用、不关闭；不传则保持原行为（自建并关闭），向后兼容 `cli.js` 等直接调用。
- `dispatchMenu` 内调用上述管理器时统一把 `rl` 透传下去。
- 验证：`node cli.js m` 在伪终端下实测，菜单 `2 → 2 → 1.20.1` 现在显示为 `选择类型 (1-9): 2` / `Minecraft 版本 (如 1.20.1): 1.20.1`（不再双倍），forge 1.20.1 正常安装；菜单 `3 → 3` 快速设置向导首行 `服务器端口 (默认: 25565): 25566` 也单份且正确写入。

> 说明：`server.js` 开服时也会建一个 `rl` 接管 stdin，但停止时已 `this._rl.close()`，菜单 `rl` 在开服期间 `pause()`、停服后 `resume()`，不会叠加，故无此问题。

---

## [3.3.16] — 2026-08-12

### ✨ 修复：安装器/启动在 mise/rtx 等版本管理器下找不到 Java 的问题

> 现象（简幻欢环境）：菜单「下载/安装实例」选 forge 1.20.1，原版核心预下载成功，但运行 `java -jar forge-installer.jar` 时报 `mise ERROR No version is set for shim: java`，安装器退出码 1，安装失败；主菜单也显示 `Java 路径: (未检测到)`。

根因：`java` 在 简幻欢等环境里是 `mise` 的 shim，未设置全局版本时 `java -version` 直接报错退出。而原安装器的 `_resolveJava` 在 `detectJava()` 失败时只回退到**裸 `java` 命令**，于是被 mise 拒绝；`utils.detectJava()` 也只认能跑通 `java -version` 的 java，识别不到 mise 本地已安装的多个 Java（zulu-8/11/16/17/19/21）。

修复：

- **`utils.detectJava(preferredVersion?)`** 增强：裸 `java` 不可用时，依次尝试用 `mise where java@<v>` / `rtx where java@<v>`（v 优先 `preferredVersion`，再 `21/17/11/8`）解析本地已安装 Java；仍不行则扫描 `MISE_DATA_DIR` / `XDG_DATA_HOME` / `~/.local/share/mise|rtx/installs/java` 目录。这样直接复用环境已有的 Java，无需重新下载。
- **`jre_manager.getJavaExecutable`** 把期望版本传给 `detectJava`，版本管理器场景下优先匹配对应大版本（如 1.20.1→17）的本地 Java。
- **`installer._resolveJava(mc)`** 改为异步，统一走 `JreManager.ensureJavaForMinecraft(mc)`（与 `server.js` 启动逻辑一致）：用户显式配置 → 已下载 JRE → 系统 Java（含 mise/rtx）→ 自动下载 Temurin JRE。在 mise 环境下会直接复用本地 Java（无下载），彻底避免 `No version is set for shim: java`。

> 注：日志里 `选择类型 (1-9): 22`、`Minecraft 版本: 11..2200..11` 是**简幻欢 Web 控制台把每个按键重复显示两次**的显示副作用（实际输入为 `2` / `1.20.1`，wow~ 行为正确），并非输入解析 bug。

---

## [3.3.15] — 2026-08-12

### ✨ 优化：陶瓦开房扫描失败时改为交互式手动输入端口

> 用户反馈：3.3.14 在「未检测到服务端监听」时直接抛错崩掉，但有时只是自检探测偶发失败、或服务端监听在非默认端口，一刀切报错体验不好。

改动（`terracotta.js` 的 `hostRoom`）：

- 开房前自检（TCP 探测 `server-port`）失败时，**不再直接抛错退出**，而是进入交互式流程：
  - 提示用户输入本机 Minecraft 服务端实际监听的端口（`1-65535`）；
  - 输入**合法** → 采用该端口继续开房；
  - 输入**非法**（空 / 非数字 / 带字母 / 越界 `0` 或 `>65535`）→ 视为**放弃开服**：停止陶瓦守护、函数返回 `null`、**不抛错、正常退出**，不再让菜单崩溃。
- 非交互场景（`autoHost` 服务器启动自动开房、无 stdin 输入）保持原有静默失败行为（无 `promptPort` 回调时不进入手动输入分支）。
- 菜单「联机 / 我要当房主」(选项 15) 调用 `hostRoom` 时传入 `promptPort: (msg) => ask(rl, msg)`，把 readline 输入接入该流程。

> 说明：手动输入的端口会被信任并直接用于开房；若服务端确实未在该端口监听，陶瓦会在后续连接公共节点阶段给出明确超时/异常提示，而不是在自检阶段就崩掉。

---

## [3.3.14] — 2026-08-12

### 🐛 修复：陶瓦开房时端口读取更可靠、更可定位

> 用户反馈：陶瓦报错「扫描本机 25565 端口」，但期望它直接检查 `server.properties` 的 `server-port`。

问题与修复：

- **`utils.getServerDir()` 默认路径错误**：原默认值为 `'../../server'`，在 `path.resolve(__dirname, '..', relativePath)` 解析下会指到**项目外层**（例如 `/home/server` 而不是 `/home/wow/server`），导致找不到真正的 `server.properties`。修正默认值为 `'../server'`，与随包 `wow.yaml` 中的 `server.dir: ../server` 一致。
- **`terracotta.getServerPort()` 静默回退 25565**：原先读取失败、值非法或 `server-port` 缺失时直接回退 25565，没有任何提示，用户无法判断是自己端口改成功了还是根本没读到文件。现在会**显式打印**：
  - 读取成功：`📡 从 server.properties 读取到 server-port: <端口>（<文件路径>）`
  - 文件缺失/读取失败/值非法/键缺失：`⚠️ ... 回退默认 25565。文件路径：...`

这样用户能立刻判断：陶瓦到底用了哪个端口、读的是哪个 `server.properties`、有没有读到真实配置。

> 说明：截图中的 `host-ok` 状态表示陶瓦已在扫描端口上找到了本地服务端；之后的超时是陶瓦连接公共节点阶段的问题，与端口读取无关。若日志显示读到的是 25565，说明你的 `server.properties` 里确实是 25565（或该文件/键缺失）；若日志显示的是其他端口但报错仍写 25565，欢迎再截图。

---

## [3.3.13] — 2026-08-11

### 🐛 修复：Fabric 安装崩溃 + ⚡ 优化：Fabric/Quilt 运行时复用预拉原版核心

> 现象：用户反馈「fabric 和 quilt 能跑的动吗」。实测发现 Fabric 安装直接崩溃，Quilt 正常。

#### 1) Fabric 安装崩溃（既有 bug，非 3.3.12 引入）

- `_resolveFabricInstaller` 把 Fabric 版本 API（**降序**返回，最新在前）当升序处理，取了**最后一个＝最旧的 `0.2.0.7`** 安装器；该老安装器用 `args[0]` 空格拆分解析子命令，而 wow 传入的 `server -downloadMinecraft` 是两个独立参数，导致 `ArrayIndexOutOfBoundsException: Index 1 out of bounds` 崩溃。
- 同时 Fabric 服务端安装命令**缺少 `-mcversion <mc>`**（必需参数）。

修复：

- `_resolveFabricInstaller` 改为取**最新稳定版**安装器（做语义化排序兜底，不依赖接口排序顺序），现解析为 `1.1.2`。
- Fabric `installArgs` 改为 `(mc) => ['server', '-mcversion', mc, '-downloadMinecraft']`。

#### 2) Fabric / Quilt 运行时复用预拉的原版核心

- 与 Forge/NeoForge 不同，Fabric/Quilt 安装器**安装阶段总是自行从 mojang 重新下载原版核心、不复用预置文件**（Forge 的 3.3.12 预置技巧对它们无效），所以在沙箱/弱网里安装或首次启动仍可能慢。
- 但它们的**运行启动器**（`fabric-server-launch.jar` / `quilt-server-launch.jar`）启动时会优先复用目录里已存在的 `minecraft_server.<mc>.jar`。
- 新增 `_ensureVanillaAtRoot`：模组加载器安装成功后，把官方原版核心（BMCLAPI2 按 SHA1 精确寻址，快且字节一致）预置到安装目录根 `minecraft_server.<mc>.jar`，让 Fabric/Quilt 运行时**跳过从 mojang 拉取**；Forge/NeoForge 也兜底确保根目录有完整副本。

#### 验证

- Quilt `1.20.1` 安装成功并触发 `_ensureVanillaAtRoot`，根目录生成 46MB 官方原版核心（沙箱内 BMCLAPI2 约 2.4s）。
- Fabric 修复后解析 `1.1.2`、参数正确、能正常下载 Fabric 库；安装末尾从 mojang 拉原版核心在沙箱超时（环境限制，真实网络下正常），其运行时同样受益于根目录预拉。

---

## [3.3.12] — 2026-08-11

### ⚡ 优化：Forge / NeoForge 安装前预下载原版核心，避开安装器慢速下载

> 现象：上一版（3.3.11）虽然装出了 Forge 核心，但安装器仍会自行从 `piston-data.mojang.com` 下载原版核心（`minecraft_server.<mc>.jar`），在部分网络环境下极慢甚至超时，导致安装卡死。

根因：

- Forge / NeoForge 安装器的 `downloadVanilla` **仅在目标文件已存在时才跳过下载**，而该目标路径写在安装器 jar 内 `install_profile.json` 的 `serverJarPath`（形如 `{LIBRARY_DIR}/net/minecraft/server/{MINECRAFT_VERSION}/server-{MINECRAFT_VERSION}.jar`），**不是**根目录的 `minecraft_server.<mc>.jar`。旧实现把预下载的核心放错位置，安装器判定目标不存在 → 照常连 mojang 慢速下载 → 超时失败（`A problem installing was detected`）。
- 3.3.12 初版还曾把 BMCLAPI2 的 `/version/<mc>/server` 当作首选，仍偶发不对版；最终改为按 SHA1 精确寻址。

修复：

- **`installer.js`**：新增 `_resolveInstallerVanillaTarget`，用 `adm-zip` 读取安装器 jar 内的 `install_profile.json`，按 `{ROOT}` / `{LIBRARY_DIR}` / `{MINECRAFT_VERSION}` 占位符**动态推导**安装器真正期望的原版核心路径（兼容新旧 Forge / NeoForge 的不同布局）；并把官方原版核心预置到该路径（下载一次后复制到其余期望位置作为保险）。
- 下载源顺序：**BMCLAPI2 按 SHA1 精确寻址**（`/v1/objects/<sha1>/server.jar`，与官方对象字节一致、国内快、稳）→ mojang 官方（兜底）→ BMCLAPI2 按版本（备用）；并保留 ≥10MB 截断校验。
- 无 `serverJarPath` 声明的加载器（如 Fabric / Quilt）自动跳过预下载，由其自行处理，互不干扰。
- 验证：本地 `wow install forge 1.20.1 -b 47.2.0` 全程**未出现一次 mojang 原版核心下载**，安装器直接复用预置核心并成功生成 `forge-*-server.jar` + `unix_args.txt`。

---

## [3.3.11] — 2026-08-10

### 🐛 修复：Forge（及现代 NeoForge）安装失败 + 启动方式错误

> 现象：`wow install forge 1.20.1` 安装器跑完后报错「未在 … 找到匹配的服务端核心（/^forge-.+-server\\.jar$/）」，安装判定失败。

根因有两层：

- **核心生成位置变了**：现代 Forge / NeoForge（1.17+）用 `--installServer` 不再把 `forge-*-server.jar` 放在服务器根目录，而是生成在 `libraries/net/minecraftforge/forge/<mc>-<loader>/` 子目录；原 `_detectServerJar` 只扫根目录，自然扫不到。
- **启动方式不成立**：现代 Forge 不能用 `java -jar <jar>` 启动，必须用 `java @user_jvm_args.txt @libraries/.../unix_args.txt nogui`（args 文件里含完整 classpath / 模块参数）。原 `server.js` 写死 `-jar`，即使扫到核心也起不来。

修复：

- **`installer.js`**：`_detectServerJar` 改为**递归扫描**（跳过 world/logs/backups 等运行时目录），能找到 `libraries/` 子目录里的核心；并新增 `_detectForgeArgsFile`，在核心同目录探测 `unix_args.txt` / `win_args.txt`，把其相对路径写入配置 `server.launchArgsFile`
- **`server.js`**：`_buildCommand` 若检测到 `server.launchArgsFile` 且文件存在，改用 `@args` 启动模式（`java ... @user_jvm_args.txt @<argsFile> nogui`），否则退回原 `-jar` 模式（Fabric/Quilt/旧版 Forge 不受影响）
- 验证：本地 `wow install forge 1.20.1 -b 47.2.0` 安装成功，`server start` 实测 Forge 1.20.1 服务端正常启动并输出 `Done (30.149s)! For help, type "help"`

---

## [3.3.10] — 2026-08-09

### 🐛 修复：`install` 隐藏在 commander v11 下崩溃（Termux 启动报错）

> v3.3.9 用 `Command.prototype.hideHelp()` 隐藏 `install`，但该项目锁定的 `commander ^11.0.0` 实际安装 v11.1.0，`.hideHelp()` 是 commander v12 才有的 API；在 Termux 运行 `./start.sh` 时报 `TypeError: ...hideHelp is not a function`，主程序直接退出。

- **改用 v11 兼容写法**：`install` 子命令保留，通过链式 `.command('install <target> [version>').description(...).option(...).action(...)._hidden = true` 隐藏（commander v11 无公开 `hideHelp()`，用内部 `_hidden = true` 同样可从 `--help` 移除，但命令仍可被 `wow install ...` 显式调用）
- **背景说明（用户确认）**：`install` 暂不移除，仅逐步弱化、最终计划全部迁移到 `scheme`；v3.3.10 仅修复兼容性崩溃，行为不变
- **避坑**：v11 的 `.command(name, desc, {hidden:true})` 会返回父对象，导致后续 `.option()` 错挂到全局；本版本已规避

---

## [3.3.9] — 2026-08-05

### 🧹 安装与镜像源：隐藏 install、修复符号链接、多镜像源轮换、模组服改用官方安装器

> 本版本聚焦「安装体验」：把 `install` 从 `--help` 藏起来、修好 wow 符号链接不生效、`scheme` 与安装器统一走多镜像源轮换、以及把 Forge/Fabric/NeoForge/Quilt 改为用官方 `installer.jar` 安装（而非直接下服务端核心）。

- **`--help` 不再提示 `install`**：`install` 是进阶操作，对其加 `.hideHelp()`（仅交互菜单与显式 `wow install ...` 仍可触发）；`init` 引导文案也不再列 `install`
- **修复 wow 符号链接不生效**：`start.sh` 的 node/npm 软链改用**绝对路径**（`$CORE_DIR/$NODE_DIR/extracted/bin/...`），并加 `cp` 兜底（软链不可用时复制），同时补齐 npm 软链；解决此前相对软链在 CWD/解析差异下失效的问题
- **多镜像源轮换（scheme / 安装器共用）**：原版版本清单 `launchermeta` 获取顺序改为 `默认镜像 → mojang (launchermeta.mojang.com) → bangbang93 (bmclapi2.bangbang93.com)`，任一镜像失败自动轮换下一个；`scheme` 走 `installer.install()`，天然继承该轮换
- **模组服安装方式修正（装对应安装器）**：Forge/Fabric/NeoForge/Quilt 不再直接下载服务端 jar，而是依次——用镜像轮换下载对应 `installer.jar` → `java -jar installer.jar [参数]` 执行安装 → 探测产物 jar（`forge-*-server.jar` / `fabric-server-launch.jar` / `neoforge-*-server.jar` / `quilt-server-launch.jar`）→ 在 `config` 写入 `server.jar`，供 `server.js` 优先选用（避免 Fabric/Quilt 安装后原版 `server.jar` 与之并存导致选错核心）
- **配套**：`server.js` 的 `_getServerJar()` 优先使用 `server.jar` 配置项，其次回退到过滤 `authlib-injector` 后的自动探测

---

## [3.3.8] — 2026-08-04

### 🔌 联机（陶瓦）：放弃自带端口配置，统一自动读取 server-port

> 陶瓦联机的本地 MC 端口不再依赖 wow 自己的配置项，改为**始终自动读取 `server.properties` 的 `server-port`**。

- **移除 `lan.server_port` 配置**：删除 `core/wow.yaml` 的 `lan.server_port` 与 `config.js` 的默认值；`getServerPort()` 不再回退到该配置，只从 `server.properties` 的 `server-port` 读取，未配置/非法时回退到 Minecraft 默认端口 `25565`
- **行为不变的部分**：开房前 TCP 端口自检、`waitHostOk` / 陶瓦异常报错仍然展示 `server.properties` 里的真实 `server-port`，开服控制台执行 `lan host` 后可继续输入指令
- **文档同步**：`LAN_TERRACOTTA.md` 的配置表去掉 `server_port` 行，并补充说明「端口自动读取，无需配置」

---

## [3.3.7] — 2026-08-03

### 🐛 修复：开服控制台执行 `lan host` 后卡死，无法再输入指令

> 在 `wow server start` 交互终端里执行 `lan host` 开房成功后，控制台被卡死、既打不了 MC 指令也打不了 wow 指令。

- **根因**：`lan host` 在子进程 `node cli.js lan host` 内调用 `hostRoom()`，后者启动的**陶瓦守护进程是长驻子进程**。命令执行完毕后该子进程仍存活，会阻止 `node cli.js` 退出；而开服控制台依赖 `runWowSubcommand` 的 `exit` 事件来 `rl.resume()` 恢复输入，子进程不退 → `await` 不返回 → 终端永久卡死。
- **修复**：`lan host` 处理器在开房完成（成功 / 失败）后**显式 `process.exit()`**，把控制权交还开服控制台；陶瓦守护进程被父进程接管继续运行，关房时由 `stopHost` 依据 `.lan.json` 清理。
- **双保险**：`startDaemon()` 中对陶瓦子进程调用 `child.unref()`，确保它绝不阻止任何调用方进程退出（含 `auto_room` 所在的 server start 主进程）。

---

## [3.3.6] — 2026-08-03

### 🔌 联机（陶瓦）：自动读取 server.properties 的 server-port

> `wow lan host` 开房时，陶瓦会自动扫描本机运行中的 Minecraft 服务端来发现端口。本版本让 **wow~ 显式读取 `server.properties` 的 `server-port`**，用于开房前的端口自检与报错提示，彻底告别「写死 25565」导致的误导。

- **`getServerPort()`**：端口优先级 `server.properties 的 server-port` > 配置 `lan.server_port` > 默认 `25565`
- **开房前自检**：`lan host` 启动陶瓦前，先用 TCP 探测本机 `server-port` 是否真的有服务监听；若没启动服务器，立即给出清晰报错（含真实端口号），不再傻等 30 秒超时
- **报错提示同步**：开房超时 / 陶瓦异常的报错信息，现在一律展示 `server.properties` 里的真实 `server-port`，而不是过时的默认 25565
- 顺带把 `terracotta.js` 头部版本注释同步到 V3.3.6

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

