# 📋 完整命令参考

> wow~ 所有命令按类别分组，共计 49 个命令

> 📌 **命令引导词说明（重要）**
> 本文档中的命令有两种写法：带前缀的（`wow server start`）与只写主干的（`### server start`）。无论哪种，**实际执行时都要加上启动脚本前缀**：
>
> | 操作系统 | 文档写法 | 实际执行 |
> |----------|----------|----------|
> | **Linux / macOS** | `wow server start` / `server start` | `./wow.sh server start` |
> | **Windows** | `wow server start` / `server start` | `wow.bat server start` |
>
> 即：Linux / macOS 下把 `wow` 读作 `./wow.sh`，Windows 下读作 `wow.bat`。下文所有示例同理。

---

> 💡 **开服控制台三视图切换（V3.4.0+）**
> 在 `wow server start` 的交互终端里，除了 MC 服务端管理员指令（如 `/stop`、`op Steve`），还可以直接输入 **wow 服务端指令**与**陶瓦联机指令**。终端内置三个控制台视图，默认停留在 Minecraft 服务端控制台：
>
> | 视图 | 切换指令 | 说明 |
> |------|----------|------|
> | 🎮 Minecraft 服务端控制台 | `:mc`（或 `:minecraft` `:1` `:服务端`） | 收发 MC 服务端指令 |
> | 🧩 wow 指令控制台 | `:wow`（或 `:2`） | 执行 wow 服务端指令 |
> | 🏠 陶瓦联机控制台 | `:lan`（或 `:terracotta` `:taowa` `:3` `:陶瓦`） | 开房 / 查房间 / 关房，显示陶瓦 HTTP API 返回 |
>
> - 输入切换指令会**清屏并显示该视图最后 10 条日志**。
> - 输入「不属于当前视图」的指令会提示「不支持」并引导切到对应控制台（例：在 Minecraft 视图输入 `lan host` → 提示先输入 `:lan`）。
> - 元指令：`:log` 重新显示当前视图最后 10 条日志，`:help` 显示控制台帮助。
> - **不可用**：会修改运行中的方案文件的指令（`scheme create`、各种 `install`/`switch` 等）、长命令 REPL（`wow L`，会抢占 stdin）、`server start/restart`、`web start`、`logs tail` —— 这些会提示「请另开终端执行」。其余无法识别的输入一律当作 MC 指令转发给服务端。
- **已移除**：旧的交互菜单命令 `wow m` / `M` 已取消。直接运行 `wow`（无参数）即进入数字选择菜单；在控制台输入 `m` 会收到对应指引。

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

**交互终端（V3.4.0+）**：启动后进入三视图控制台，默认在 Minecraft 服务端控制台。可随时用 `:mc` / `:wow` / `:lan` 切换（切换即清屏 + 显示该视图最后 10 条日志），输入非本视图指令会提示切换。详见上方「开服控制台三视图切换」说明。

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

## 二、方案管理 (5 个)

方案是独立的 Minecraft 服务器实例，支持模板模式（自动资源共享）。

### `scheme create <name>`

创建新方案，自动判定资源重合状态 (minimal/partial/full)。

```bash
wow scheme create <name> [options]
```

| 选项 | 说明 |
|------|------|
| `-v, --version <version>` | Minecraft 版本 (默认: 1.20.1) |
| `-t, --type <type>` | 核心类型/加载器: vanilla/forge/fabric/neoforge/quilt/paper/purpur/leaves/mohist/catserver（spigot/bukkit 暂不支持），同时决定加载器（已并入原 `--loader`） |
| `-b, --build <id>` | 构建号（仅 Mohist 等需要） |

> 💡 V3.4.1 起 `--loader` 已移除，加载器并入 `--type`（二者取值一致，如 `-t forge` 即 forge 核心 + forge 加载器）。

**示例：**
```bash
# 创建原版方案
wow scheme create survival -v 1.20.1 -t vanilla

# 创建模组方案（加载器并入 --type）
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

---

## 三、模组管理 (4 个)

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

## 六、Web 面板管理 (3 个)

### `web start`

启动 Web 管理面板。

```bash
wow web start [options]
```

| 选项 | 说明 |
|------|------|
| `-p, --port <port>` | 端口 (默认: 8080) |
| `--host <host>` | 绑定地址 (默认: 127.0.0.1) |

**示例：**
```bash
# 允许远程访问
wow web start --host 0.0.0.0 --port 8080
```

---

### `web stop`

停止 Web 服务。

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

生成日志统计报告（不调用 AI）。

```bash
wow logs report
```

---

## 八、配置管理 (10 个)

### `config wow <key> [value]`

查看/设置启动器配置 (wow.yaml)。

```bash
wow config wow server.dir
wow config wow server.dir ./my_server
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

白名单管理。

```bash
wow config white list
wow config white add Steve
wow config white remove Steve
```

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

> 基于陶瓦 (Terracotta) 的联机方案，详见 [联机 / 内网穿透](LAN_TERRACOTTA.md)。

### `lan host`

我要当房主：开房让好友联机（自动下载并启动陶瓦）。

```bash
wow lan host [options]
```

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

## 十一、长命令模式 (1 个)

### `L [cmd...]`

长命令模式（V3.5.8 起替代原 `wow m` 的长命令 REPL 定位）：

| 用法 | 行为 |
|------|------|
| `wow L` | 进入交互式 REPL，逐条输入长命令（无需 `wow` 前缀，`exit` / `quit` 退出） |
| `wow L server start` | 直接执行单条长命令后退出，适合脚本调用 |

```bash
# 交互式 REPL
wow L

# 单条执行
wow L server status
wow L scheme list
```

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

> **V3.5.4 起**：服务端核心安装已统一改为 `scheme create`，`install` 仅保留
> 通用文件下载与隐藏彩蛋 `install party`。

```bash
# 下载任意 URL 文件到指定目录
wow install https://example.com/plugin.jar -o pool/plugins/

# 隐藏彩蛋
wow install party
```

安装服务端核心请使用：

```bash
wow scheme create <方案名> -t <核心类型> -v <MC版本>
# 例：wow scheme create survival -t paper -v 1.20.1
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

快捷设置配置项（同 `config wow`）。

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

---


