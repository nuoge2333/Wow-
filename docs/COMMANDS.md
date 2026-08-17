# 📋 完整命令参考

> wow~ 所有命令按类别分组，共计 51 个命令

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
> - **不可用**：会修改运行中的方案文件的指令（`scheme create`、各种 `edit`/`install`/`switch` 等）、交互菜单 `M`、`server start/restart`、`web start`、`logs tail` —— 这些会提示「请另开终端执行」。其余无法识别的输入一律当作 MC 指令转发给服务端。

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
  日志: /path/to/server/logs/latest.log
  最近玩家活动: [INFO] Steve joined the game
```

---

## 二、方案管理 (12 个)

方案是独立的 Minecraft 服务器实例，支持模板模式（自动资源共享）。

### `scheme create <name>`

创建新方案，自动判定资源重合状态 (minimal/partial/full)。

```bash
wow scheme create <name> [options]
```

| 选项 | 说明 |
|------|------|
| `-v, --version <version>` | Minecraft 版本 (默认: 1.20.1) |
| `-t, --type <type>` | 核心类型/加载器: vanilla/forge/fabric/neoforge/quilt/mohist/catserver/paper，同时决定加载器（已并入原 `--loader`） |
| `-b, --build <number>` | 构建号（仅 Mohist 等需要） |
| `--other-type <name>` | 自定义核心名称（当 type=other 时） |

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

### `scheme status [name]`

查看方案状态（minimal/partial/full + 资源统计）。

```bash
wow scheme status [name]
```

**输出示例：**
```
📊 方案状态: survival
============================================================
  状态: minimal
  版本: 1.20.1
  加载器: forge
  核心: forge-1.20.1.jar (🔄 共享)
  模组: 12 个 (共享: 10, 独有: 2)
  插件: 3 个 (共享: 3, 独有: 0)
  世界: ✅ 存在
  独有资源: 2 个
    - pool/mods/forge/1.20.1/CustomMod.jar
============================================================
```

---

### `scheme edit <name>`

修改方案元数据。

```bash
wow scheme edit <name> --key <key> --value <value>
```

| 选项 | 说明 |
|------|------|
| `--key <key>` | 要修改的字段名 |
| `--value <value>` | 新值 |

**示例：**
```bash
wow scheme edit survival --key version --value 1.21
# 警告: 核心版本变更，已清空 mods 和 plugins
```

---

### `scheme pull <name>`

从 pool 拉取资源，强制补齐为完整实例。

```bash
wow scheme pull <name>
```

执行后 `auto_scheme` 自动设为 `false`。

---

### `scheme prune <name>`

强制瘦身方案（转为最小实例）。

```bash
wow scheme prune <name>
```

执行后 `auto_scheme` 自动设为 `false`。

---

### `scheme register <other-type> <eco-list>`

注册未知来源核心（other 字段）。

```bash
wow scheme register <other-type> <eco-list>
```

| 参数 | 说明 |
|------|------|
| `<other-type>` | 自定义核心名称 |
| `<eco-list>` | 兼容生态列表，用逗号分隔 |

**示例：**
```bash
wow scheme register MyFork forge,bukkit,spigot
```

---

### `scheme export <name>`

导出方案为整合包。

```bash
wow scheme export <name>
```

---

### `scheme import <file>`

导入整合包为方案。

```bash
wow scheme import <file>
```

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
| `--version <version>` | 过滤版本 |

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
| `--version <version>` | 版本 (默认: 1.20.1) |

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
| `--version <version>` | Minecraft 版本 |
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

## 六、wow 插件管理 (4 个)

> 注意：这是 wow 工具本身的插件（扩展命令），不是 Minecraft 服务端插件。

### `plugin install <source>`

安装 wow 插件（ZIP 文件路径或 URL）。

```bash
wow plugin install <source>
```

插件包必须包含 `plugin.json` 和 `index.js`。

---

### `plugin list`

列出已安装的 wow 插件。

```bash
wow plugin list
```

---

### `plugin remove <name>`

卸载 wow 插件。

```bash
wow plugin remove <name>
```

---

### `plugin info <name>`

查看插件详情。

```bash
wow plugin info <name>
```

---

## 七、Web 面板管理 (3 个)

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

## 八、日志与 AI 分析 (3 个)

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

## 九、配置管理 (3 个)

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

## 十、邮件管理 (3 个)

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

## 十一、工具与下载 (5 个)

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

安装服务端核心 或 下载任意 URL 文件。

```bash
# 安装核心
wow install vanilla 1.20.1

# 下载任意 URL
wow install https://example.com/plugin.jar -o ./server/plugins/
```

---

### `pool stats`

查看 pool 资源引用统计。

```bash
wow pool stats
```

**输出示例：**
```
📊 Pool 统计:
  总资源数: 45
  被引用资源数: 38
  未引用资源数: 7
  按类型分布:
    cores: 5
    mods: 28
    plugins: 12
```

---

### `pool prune`

手动清理未被引用的 pool 资源。

```bash
wow pool prune
```

---

### `init`

初始化环境（创建目录、检测 Java、生成默认配置）。

```bash
wow init
```

---

## 十二、其他 (2 个)

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


