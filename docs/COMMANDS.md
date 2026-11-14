# 📋 完整命令参考

> wow~ 所有命令按类别分组，共计 60 个命令。

> 📌 **命令引导词说明（重要）**
> 本文档中的命令有两种写法：带前缀的（`wow server start`）与只写主干的（### server start）。无论哪种，除非是长命令模式，**实际执行时都要加上启动脚本前缀**：
>
> | 操作系统 | 文档写法 | 实际执行 |
> |----------|----------|----------|
> | **Linux / macOS** | `wow server start` / `server start` | `./wow.sh server start` |
> | **Windows** | `wow server start` / `server start` | `wow.bat server start` |
>
> 即：Linux / macOS 下把 `wow` 读作 `./wow.sh`，Windows 下读作 `wow.bat`。下文所有示例同理。

---

> 💡 **开服控制台三视图切换**
> 在 `wow server start` 的交互终端里，不仅可以输入 MC 服务端指令，还能直接输入 **wow 服务端指令**与**陶瓦联机指令**。终端内置三个控制台视图，默认停留在 Minecraft 服务端控制台：
>
> | 视图 | 切换指令 | 说明 |
> |------|----------|------|
> | 🎮 Minecraft 服务端控制台 | `:mc` | 收发 MC 服务端指令 |
> | 🧩 wow 指令控制台 | `:wow` | **进入 M 模式 TUI** |
> | 🏠 陶瓦联机控制台 | `:lan` | 开房 / 查房间 / 关房 |
>
> - 输入 `:mc` / `:lan` 会**清屏并显示该视图最后 10 条日志**。
> - 输入「不属于当前视图」的指令会提示「不支持」并引导切换。
> - 无法识别的输入一律当作 MC 指令转发给服务端。

---

## 全局选项

所有命令均可使用以下全局选项：

| 选项 | 说明 |
|------|------|
| `--config <file>` | 指定配置文件路径 (默认: core/wow.yaml) |
| `--verbose` | 输出详细日志 |
| `-h, --help` | 显示帮助信息 |
| `-V, --version` | 显示版本号 |

---

## 一、服务器管理 (5 个)

### `server start`

启动服务器。

```bash
wow server start [options]
```

| 选项 | 说明 |
|------|------|
| `-m, --memory <size>` | 内存分配，如 4G (默认: 2G) |
| `--jvm-args <args>` | 额外 JVM 参数 |

**示例：**
```bash
wow server start --memory 4G
wow server start --memory 6G --jvm-args "-XX:+UseG1GC"
```

**交互终端**：启动后进入三视图控制台，默认在 Minecraft 服务端控制台。可随时用 `:mc` / `:wow` / `:lan` 切换。

---

### `server stop`

正常停止服务器（发送 `stop` 命令，保存世界后退出）。

```bash
wow server stop
```

---

### `server kill`

强制终止服务器进程（直接杀进程，不保存）。

```bash
wow server kill
```

---

### `server restart`

重启服务器（先 stop 再 start）。

```bash
wow server restart [options]
```

| 选项 | 说明 |
|------|------|
| `-m, --memory <size>` | 内存分配 |
| `--jvm-args <args>` | 额外 JVM 参数 |

---

### `server status`

查看服务器运行状态。

```bash
wow server status
```

**输出示例：**
```
服务器状态: 运行中
  PID: 12345
  日志: /path/to/scheme/<方案名>/logs/latest.log
  最近玩家活动: [INFO] Steve joined the game
```

---

## 二、方案管理 (9 个)

方案是独立的 Minecraft 服务器实例，支持模板模式（自动资源共享）。

### `scheme create <name>`

创建新方案，自动判定资源重合状态 (minimal/partial/full)。

```bash
wow scheme create <name> [options]
```

| 选项 | 说明 |
|------|------|
| `-v, --version <version>` | Minecraft 版本 (默认: 1.20.1) |
| `-t, --type <type>` | 核心类型: vanilla/forge/fabric/neoforge/quilt/paper/purpur/leaves/mohist/catserver，模组加载器随类型自动确定 |
| `-b, --build <id>` | 构建号（仅 Mohist 等需要） |

**示例：**
```bash
# 创建原版方案
wow scheme create survival -v 1.20.1 -t vanilla

# 创建模组方案（加载器随类型自动确定）
wow scheme create modded -t forge

# 创建混合服方案
wow scheme create hybrid -t mohist -b 346
```

---

### `scheme list`

列出所有方案，显示状态标识。

```bash
wow scheme list
```

**输出示例：**
```
方案列表:
  ▶ 🟢 survival - 1.20.1 (forge) (当前)
    🟡 modded - 1.20.1 (forge)
    🔵 test - 1.19.2 (fabric)
```

状态图标：
- 🟢 minimal - 所有资源共享
- 🟡 partial - 部分资源共享
- 🔵 full - 完整实例（无共享）

---

### `scheme switch <name>`

切换到指定方案（自动补齐/瘦身）。

```bash
wow scheme switch <name>
```

---

### `scheme delete <name>`

删除方案，清理 pool 中未被引用的资源。

```bash
wow scheme delete <name>
```

---

### `scheme info [name]`

查看方案详情（完整显示 scheme.yaml）。

```bash
wow scheme info [name]
```

不指定 name 时显示当前方案。

---

### `scheme pull <name>`

强制补齐方案：从 `pool/` 复制缺失的核心 / 模组 / 插件到方案目录。

```bash
wow scheme pull survival
```

- 已存在且内容一致的文件会跳过（按 SHA-256 判断）。
- 执行成功后 **`auto_scheme` 会自动置为 `false`**，转入手动管理模式。

---

### `scheme prune <name>`

强制瘦身方案：把与 `pool/` 内容一致的资源改为共享引用，删掉方案目录里的重复副本。

```bash
wow scheme prune survival
```

- 只处理「与池中文件哈希一致」的资源，独占文件不动。
- 同样会把 `auto_scheme` 置为 `false`。

---

### `scheme status [name]`

查看方案的结构化状态：状态（minimal / partial / full）、版本、加载器、核心，以及模组 / 插件的「共享 vs 独占」统计。

```bash
wow scheme status survival
```

与 `scheme info` 的区别：`info` 偏元数据，`status` 偏资源分布。

---

### `scheme clone-client <path>`

把一个 Minecraft 客户端实例克隆成 wow 方案。

```bash
wow scheme clone-client ~/.minecraft/versions/1.20.1-forge-47.2.0 [options]
```

| 选项 | 说明 |
|------|------|
| `-n, --name <name>` | 方案名（默认取实例目录名） |
| `-t, --type <type>` | 手动指定核心类型（识别失败时用） |
| `-v, --version <version>` | 手动指定 Minecraft 版本（识别失败时用） |
| `--save <name>` | 要迁移的存档名；填 `-` 表示不迁移 |
| `--dry-run` | 只做识别与检查，不创建任何东西 |
| `--yes` | 不进行任何交互，全部使用默认值 |
| `--extra-client-mods <list>` | 追加的客户端模组 modid，逗号分隔 |
| `--keep-mods <list>` | 强制保留的模组 modid，逗号分隔（优先级最高） |

**关键行为：**

- **产物是方案**，克隆完成后 `scheme list` / `switch` / `server start` 全套可用
- 核心走方案的**核心装配流程**，Forge/NeoForge 会跑官方安装器
- **不删除任何文件**：客户端核心改名 `.client-jar.bak`、模组移到 `mods-disabled/`、`world/` 冲突时挪成 `.bak`
- 关键文件复制失败时**中止并回滚**方案目录

详见 [`CLONE_CLIENT.md`](scheme/CLONE_CLIENT.md)。

---

## 二之二、资源池管理 (1 个)

### `pool stats`

查看资源共享池统计。

```bash
wow pool stats
```

输出资源总数、被方案引用的数量、仅存于池中的数量、占用体积（同名文件只计一次）以及按类型的分类计数。

---

## 三、模组管理 (6 个)

### `mod install <project>` 🔺 V3.8.0

从 Modrinth（默认）/ CurseForge 下载模组或 **Minecraft 服务端插件**，安装到**指定方案**。

```bash
wow mod install sodium --scheme alpha
wow mod install luckperms --scheme alpha --kind plugins
wow mod install sodium --scheme alpha --no-auto --source curseforge
```

| 选项 | 说明 |
|------|------|
| `--scheme <name>` | **必填**。目标方案；下载中心禁止默认塞入当前方案 |
| `--kind <mods\|plugins>` | 装进 `scheme/<方案>/mods/`（默认）或 `plugins/` |
| `--source <src>` | `modrinth`（默认）\| `curseforge` |
| `--version <v>` / `--loader <l>` | 覆盖自动推断；缺省时读目标方案 `scheme.yaml` 的 `version` / `loader` |
| `--no-auto` | 关闭自动解析：不递归拉前置依赖 |

默认开启**自动解析**：按方案核心版本 + 加载器选最适配文件，并递归抓取必需依赖
（最多 3 层，API 超时自动降级并给出提示）。文件以 stream 方式下载到方案目录，
进度会进入 Web 面板「下载队列」Tab。

> ⚠️ 这里的 `--kind plugins` 指 **Minecraft 服务端的 Bukkit/Paper 插件**；
> wow 自身的扩展请用 `wow extension install`（见第五节）。

---

### `mod list`

列出已安装模组。

```bash
wow mod list [options]
```

| 选项 | 说明 |
|------|------|
| `--loader <loader>` | 过滤加载器 |
| `-v, --mc-version <version>` | 过滤版本 |

---

### `mod remove <name>`

卸载模组。

```bash
wow mod remove <name>
```

---

### `mod toggle <name>`

启用/禁用模组（不删除文件，文件名添加 `DISABLED_` 前缀）。

```bash
wow mod toggle <name>
```

---

### `mod sync`

从 pool 同步模组到当前方案。

```bash
wow mod sync [options]
```

| 选项 | 说明 |
|------|------|
| `--loader <loader>` | 加载器 (默认: forge) |
| `-v, --mc-version <version>` | 版本 (默认: 1.20.1) |

---

### `mod client-filter`

扫描 `mods/` 并隔离客户端专用模组（钠、铷、Iris 这一类）。

```bash
wow mod client-filter [options]
```

| 选项 | 说明 |
|------|------|
| `--dry-run` | 只列出将会被隔离的模组，不实际移动 |
| `--list <modid>` | 检查单个 modid 是否在内置名单里 |
| `--show` | 列出隔离区里有什么，不做任何改动 |
| `--restore [file]` | 把隔离区里的模组挪回 `mods/`（不填 ` 全部恢复） |

**行为说明：**

- 读取 jar 内部元数据判断真正的 modid
- 元数据声明「纯客户端」或 modid 命中内置名单时，把 `jar` 移到 `mods_client_disabled/`
- **只移动不删除**，需要恢复时用 `--restore` 挪回来
- 原版 / 纯插件端直接跳过

**开服时会自动执行**（受 `mod.client_only.enabled` 控制），一般无需手动运行。

---

## 四、整合包管理 (2 个)

### `pack install <source>`

安装客户端整合包。

```bash
wow pack install <source>
```

| 参数 | 说明 |
|------|------|
| `<source>` | 整合包文件路径或 URL |

**流程：**
1. 解析 manifest.json (或 modpack.json)
2. 安装核心 + 模组 + 配置文件
3. 询问使用哪个存档（新建/现有）
4. 测试启动，自动移除不兼容模组

---

### `pack generate <name>`

生成客户端整合包。

```bash
wow pack generate <name> [options]
```

| 选项 | 说明 |
|------|------|
| `-v, --mc-version <version>` | Minecraft 版本 |
| `--loader <loader>` | 模组加载器 (forge/fabric) |
| `--output <path>` | 输出目录 |

---

## 五、主题包管理 (5 个)

### `theme install <source>`

安装主题包（ZIP 文件路径或 URL）。

```bash
wow theme install <source>
```

主题包必须包含 `theme.json` 签名文件。

---

### `theme list`

列出已安装主题。

```bash
wow theme list
```

---

### `theme switch <name>`

切换主题（每次切换会弹出安全警告）。

```bash
wow theme switch <name>
```

---

### `theme delete <name>`

删除主题。

```bash
wow theme delete <name>
```

---

### `theme info <name>`

查看主题详情。

```bash
wow theme info <name>
```

---

## 五之二、wow扩展管理 (7 个)

> 📌 这里的「wow扩展」指 **wow 自身的 CLI 扩展系统**（`wow-extensions/` 目录），
> 不是 Minecraft 服务端的 Bukkit/Paper 插件。开发指南见
> [WOW-EXTENSIONS.md](other/WOW-EXTENSIONS.md)。
> `wow plugin` 作为隐藏别名保留，兼容旧脚本。
>
> ⚠️ wow扩展与主程序同权限，不是沙箱。首次启用需确认，内容改动后需重新确认。

### `extension list`

列出已安装 wow扩展及其信任状态。

```bash
wow extension list
```

信任状态三态：`✅ 已信任` / `⏳ 未信任` / `⚠️ 已变更`。

---

### `extension info <name>`

查看单个 wow扩展详情：作者、版本、信任状态、命令一览。

```bash
wow extension info hello
```

---

### `extension install <source>`

安装 wow扩展。`<source>` 可以是 ZIP 包，也可以直接是扩展目录（开发期方便）。

```bash
wow extension install ./hello.zip
wow extension install ./hello          # 目录形态
wow extension install ./hello.zip -f   # 覆盖同名 wow扩展
```

安装只做两件事：断言文件是 ZIP（文件头 `PK`）、断言包内有合法的 `extension.json`。**不验证来源、不验证签名**——是否信任由你决定。

---

### `extension remove <name>`

卸载 wow扩展：删除 `wow-extensions/<name>/` 目录，同时撤销信任记录。

```bash
wow extension remove hello
```

---

### `extension trust <name>`

信任 wow扩展：记录它**当前内容**的 SHA-256 指纹，之后启动不再询问。

```bash
wow extension trust hello
```

---

### `extension untrust <name>`

撤销信任。下次启动时该 wow扩展会被当作新扩展，重新要求确认。

```bash
wow extension untrust hello
```

---

### `extension path`

打印 wow扩展目录与信任表位置，并给出目录结构示意。

```bash
wow extension path
```

---

### wow扩展注册的自定义命令

wow扩展可以在 `extension.json` 里声明命令，安装并信任后它们会变成 wow 的**顶层命令**：

```bash
wow hello --name Steve
```

| 场景 | 行为 |
|------|------|
| CLI 终端 | ✅ 正常执行 |
| **Web 面板** | ❌ 默认禁止。需在配置中打开 `web.allow_extensions: true` |
| **开服控制台** | ❌ 显式拒绝，不会转发给 Minecraft 服务端 |

---

## 六、Web 面板管理 (4 个)

### `web start`

启动 Web 管理面板。

```bash
wow web start [options]
```

| 选项 | 说明 |
|------|------|
| `-p, --port <port>` | 端口 (默认: 8080) |
| `--host <host>` | 绑定地址 (默认: 127.0.0.1) |
| `--public` | 等价于 `--host 0.0.0.0`，局域网 / 公网可访问 |
| `--tunnel` | 同时建立 Cloudflare 快速隧道，生成公网 https 地址 |

**示例：**
```bash
# 允许远程访问（需先配置认证凭据，否则会被拒绝启动）
wow web start --host 0.0.0.0 --port 8080

# 一步到位：对外暴露 + 公网 https 地址
wow web start --public --tunnel
```

> 🛡️ **强制安全闸门**
> 绑定地址非回环且 `web.auth_token` 为空时，**直接拒绝启动**。检查发生在 `server.listen()` 之前。

> 🖥️ **终端不再被占用**
> `wow web start` 启动面板后**不会阻塞 CLI**，而是自动进入等价于 `wow L` 的长命令模式，可直接输入 wow 指令，无需再来一个终端。

---

### `web tunnel`

为**已经在运行**的面板单独建立 Cloudflare 隧道。

```bash
wow web tunnel [-p <port>]
```

| 选项 | 说明 |
|------|------|
| `-p, --port <port>` | 要暴露的本地端口（默认取 `web.port`） |

**示例：**
```bash
wow web tunnel
wow web tunnel -p 8080
```

---

### `web stop`

停止 Web 服务（同时关闭 Cloudflare 隧道）。

```bash
wow web stop
```

---

### `web status`

查看 Web 服务状态。

```bash
wow web status
```

---

## 六之三、跨设备方案同步 (3 个)

> 详见 [SYNC.md](scheme/SYNC.md)。控制端推送方案到跑 `wow web start` 的执行端，单向、增量、断点续传。

### `sync login <url>`

登录执行端并保存 JWT 凭据（按 URL 区分，可保存多个执行端）。

```bash
wow sync login http://your-vps:8080 [-p 密码]
```

### `sync push <url>`

推送方案到执行端。清单先行 → 预检缺口 → 差量上传 → 执行端组装入池（不自动开服）。

```bash
wow sync push http://your-vps:8080 [options]
```

| 选项 | 说明 |
|------|------|
| `-s, --scheme <name>` | 控制端要推的方案名（缺省用当前激活方案） |
| `-n, --name <name>` | 推到执行端时用的方案名（缺省同名） |
| `--with-world` | 连存档一起同步（默认不带） |
| `--with-config` | 允许覆盖执行端 `server.properties`/`eula.txt`（先备份 `.bak`） |

---

### `sync list`

查看已保存的执行端凭据。

```bash
wow sync list
```

---

## 七、日志与 AI 分析 (3 个)

### `logs tail`

实时查看服务器日志（`tail -f`）。

```bash
wow logs tail
```

按 `Ctrl+C` 退出。

---

### `logs analyze`

AI 分析日志（需服务器关闭）。

```bash
wow logs analyze [options]
```

| 选项 | 说明 |
|------|------|
| `--api-key <key>` | AI API 密钥（覆盖配置） |
| `--model <model>` | 模型名称 |
| `--api-url <url>` | API 端点 |

---

### `logs report`

生成日志统计报告（不调用 AI，仅做 `[ERROR]` 等计数）。

```bash
wow logs report
```

---

### 崩溃时的本地初级诊断（自动触发）

**不是命令**——服务器非正常退出（退出码非 0）时自动运行，无需手动调用。纯本地，毫秒级给出归因与修复建议（如 Java 版本错误、内存溢出、客户端模组误装等）。

---

## 八、配置管理 (13 个)

### `config set <key> <value>`

设置启动器配置（写入 `wow.yaml`）。

```bash
wow config set server.memory 4G
wow config set web.auth_token 一串足够长的随机字符
wow config set web.auth_password 你的密码      # 离线密码登录
```

> 🔐 **凭据类键不回显明文**：设置后只提示「已设置，长度 N」，避免密码留在终端录屏或截图里。

---

### `config get <key>`

读取启动器配置。凭据类键打码显示，未设置时统一显示 `null`。

```bash
wow config get server.memory
```

---

### `config unset <key>`

清除启动器配置（写回 `null`）。

```bash
wow config unset web.auth_token
```

---

### `config server <key> [value]`

查看/设置 server.properties。

```bash
wow config server max-players
wow config server max-players 50
```

---

### `config white <action> [player]`

白名单管理（直接改 `whitelist.json`，**仅在停服时使用**）。

```bash
wow config white list
wow config white add Steve
wow config white remove Steve
```

> ⚠️ 这条旧命令不检查服务器是否在跑。运行中改白名单请用
> `wow config players whitelist <id>`（自动走服务器指令）。

---

### `config players <action>` 🔺 V3.8.0

玩家管理：从日志追踪已知玩家，并把玩家移入白/黑名单。

```bash
wow config players scan                 # 从 logs/latest.log 尾部回溯提取 joined the game
wow config players list                 # 列出 known_players 及白/黑名单状态
wow config players whitelist Steve      # 移入白名单
wow config players ban Griefer          # 移入黑名单
wow config players list --scheme alpha  # 指定方案（缺省用当前激活方案）
```

**铁律①（防翻车）**：服务器运行时，`whitelist` / `ban` 通过服务器指令
（`whitelist add` / `ban`）即时生效，**绝不直接改 JSON**（避免与运行中的服务端
抢写文件）；只有停服时才写 `whitelist.json` / `banned-players.json`。
玩家 ID 强制校验 `^[a-zA-Z0-9_]{3,16}$`，防止指令注入。

`scan` 只读日志**末尾最多 5MB**（流式回溯），不会把整份 `latest.log` 读进内存；
结果按 ID 去重合并进 `scheme/<方案>/scheme.yaml` 的 `known_players`，
已有条目保留原 `first_join`。

---

### `config mods list [options]`

列出 `config/` 下所有模组配置文件。

```bash
wow config mods list
```

---

### `config mods view <file>`

查看指定配置文件内容。

```bash
wow config mods view jei.toml
```

---

### `config mods get <file> <key>`

读取配置文件中的嵌套键值（点号分隔）。

```bash
wow config mods get jei.toml general.enable
```

---

### `config mods set <file> <key> <value>`

设置配置文件中的嵌套键值（自动备份原文件）。

```bash
wow config mods set jei.toml general.enable true
```

---

### `config server-list`

分类列出所有 `server.properties` 属性及当前值。

```bash
wow config server-list
```

---

### `config server-quick`

`server.properties` 快速设置向导（交互式常用项）。

```bash
wow config server-quick
```

---

### `config server-reset <key>`

重置单个 `server.properties` 属性为默认值。

```bash
wow config server-reset motd
```

---

## 九、邮件管理 (3 个)

> 邮件功能有 15 分钟频率限制。

### `mail test`

测试邮件配置，发送验证码到管理员邮箱。

```bash
wow mail test
```

---

### `mail send-code <email>`

发送验证码到指定邮箱（用于登录测试）。

```bash
wow mail send-code player@example.com
```

---

### `mail crash <message>`

模拟发送崩溃报告（用于测试）。

```bash
wow mail crash "测试崩溃消息"
```

---

## 十、联机 / 内网穿透 (3 个)

> 基于陶瓦 (Terracotta) 的联机方案，详见 [联机 / 内网穿透](net/LAN_TERRACOTTA.md)。

### `lan host`

我要当房主：开房让好友联机（自动下载并启动陶瓦）。

```bash
wow lan host [options]
```

| 选项 | 说明 |
|------|------|
| `-r, --room <code>` | 指定固定房间号（留空则自动生成） |

> 🌐 **与 Web 面板联动**
> 若 `lan host` 时 Web 面板已在运行（或反之），控制台会提示本机的 **EasyTier 虚拟局域网 IP（10.144.x.x）**。
> 注意：面板默认绑定 `127.0.0.1`，虚拟 IP 访问不到。要用这个地址，需以 `wow web start --host 0.0.0.0`（或 `--public`）启动，并配置好认证凭据。

### `lan stop`

关闭联机房间（停止陶瓦）。

```bash
wow lan stop
```

### `lan status`

查看联机房间状态 / 房间号。

```bash
wow lan status
```

---

## 十一、M / L 两种交互模式 (2 个)

wow 有两个常驻交互界面，**可以互相切换**：

| 模式 | 进入方式 | 形态 | 切到另一模式 |
|------|----------|------|----------|
| **M 模式**（七页 TUI） | 双击 `wow.bat` / `./wow.sh`；或 `wow m` | `Q`/`W`/`E`/`R`/`T`/`Y` 切页，数字输入后回车执行 | 按 `L` → L 模式 |
| **L 模式**（长命令） | `wow L`；或 M 界面按 `L` | 逐条敲完整指令（无 `wow` 前缀） | 输入 `m` → M 模式 |

> 非 TTY 环境（管道 / `cron`）自动降级为「数字 + 回车」的兼容模式，功能一致。

### `m`

M 模式界面。与双击批处理进入的是**同一个界面**。

```bash
wow m
```

### `L [cmd...]`

长命令模式：

| 用法 | 行为 |
|------|------|
| `wow L` | 进入交互式 REPL，逐条输入长命令（无需 `wow` 前缀，`exit` / `quit` 退出，输入 `m` 回菜单） |
| `wow L server start` | 直接执行单条长命令后退出，适合脚本调用 |

> 💡 **M ↔ L 切换**：L 模式里输入 `m` 回到菜单；菜单里选 `15` 进入 L 模式。
> ⚠️ REPL 会独占终端 stdin，**不能在开服控制台内使用**（控制台输入 `L` 会被拒绝并提示）。

---

## 十二、工具与下载 (3 个)

### `down <url>`

下载文件到临时目录。

```bash
wow down <url> [options]
```

| 选项 | 说明 |
|------|------|
| `-o, --output <path>` | 输出路径 |

---

### `install <target> [version]`

> 服务端核心安装已统一改为 `scheme create`，`install` 仅保留通用文件下载与隐藏彩蛋 `install party`。

```bash
# 下载任意 URL 文件到指定目录
wow install https://example.com/plugin.jar -o pool/plugins/

# 隐藏彩蛋
wow install party
```

安装服务端核心请使用：

```bash
wow scheme create <方案名> -t <核心类型> -v <MC版本>
```

---

### `init`

初始化环境（创建目录、检测 Java、生成默认配置）。

```bash
wow init
```

---

## 十三、其他 (2 个)

### `set <key> <value>`

快捷设置配置项（同 `config set`）。

```bash
wow set server.dir ./my_server
wow set web.port 9000
```

---

### `help`

显示帮助信息。

```bash
wow help
wow server --help
```
