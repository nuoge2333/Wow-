# 🚀 快速开始

> 5 分钟上手 wow~ Minecraft 服务器管理工具

---

## 1. 下载与解压

```bash
# 解压你下载的 wow~ 压缩包（文件名以实际下载的为准）
unzip wow*.zip
cd wow
```

---

## 2. 运行启动脚本

脚本会自动检测系统架构，下载对应的 Node.js 便携版。

```bash
# Windows
start.bat

# Linux / macOS
chmod +x start.sh
./start.sh
```

首次运行会询问是否下载 Node.js，输入 `y` 确认。

---

## 2.5 ⚠️ 重要：怎么运行 `wow` 命令（必读，否则后面全卡住）

`start.sh` / `start.bat` **只是安装器**，它**不会**把 `wow` 注册成系统命令。你后面会看到大量 `wow xxx` 命令，它们**不能直接敲**，要用下面任一种方式运行：

| 方式 | 怎么敲 | 适合谁 |
|------|--------|--------|
| ① 透传参数（最省事，推荐新手） | `./start.sh init`、`start.bat init` | 所有人，尤其 Windows / Termux / 新手 |
| ② 注册成全局命令 | 先 `cd core && npm link`，之后直接 `wow init` | 愿意折腾一次的 Linux/macOS/Termux 用户 |
| ③ 临时调用 | 在 `core` 目录里 `npx wow init` | 不想装全局命令时 |

> 🆘 如果你直接敲 `wow init` 出现 `command not found`（找不到命令），**别慌**，直接用 `./start.sh init`（方式①）就行，不用管 `npm link`。

📌 **全文约定**：从 step 3 起，下面所有示例里的 `wow xxx` 都默认你已按上面选好一种方式；**新手请一律用 `./start.sh xxx` 代替 `wow xxx`**（Windows 用 `start.bat xxx`）。表格里的 `wow install ...` 同理替换。

---

## 3. 初始化环境

> 用方式①运行（新手推荐）：

```bash
./start.sh init
# 若已按方式② npm link，也可直接：wow init
```

该命令会：
- 创建必要的目录结构 (`core/pool/`, `core/schemes/`, `themes/`, `wow-plugins/`)
- 检测 Java 安装（未检测到时，会在启动服务器时自动下载）
- 生成默认配置文件 `core/wow.yaml`
- 生成默认主题 `themes/default/`

---

## 4. 安装服务器核心

> 📌 本节的安装命令示例写作 `wow install ...`，实际运行时请替换成 `./start.sh install ...`（或你选的调用方式）。

### 服务端核心分类

wow 支持四大类服务端核心，根据你的需求选择：

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| **纯净服** | 原版体验，无模组无插件 | 原版生存、建筑、红石 |
| **模组服** | 支持 Mod 加载器 (Forge/Fabric/NeoForge/Quilt) | 模组生存、科技模组、魔法模组 |
| **插件服** | 支持 Bukkit/Spigot/Paper 插件 | 小游戏、RPG、生存 with 插件管理 |
| **混合服** | 同时支持 Mod + 插件 | 需要模组功能同时又需要插件管理的复杂服务器 |

### 支持的核心列表

#### 纯净服 (Pure)

| 核心 | 说明 | 安装命令示例 |
|------|------|-------------|
| **Vanilla** | Mojang 官方原版服务端 | `wow install vanilla 1.20.1` |

#### 模组服 (Mod)

| 核心 | 加载器 | 说明 | 安装命令示例 |
|------|--------|------|-------------|
| **Forge** | Forge | 最成熟的模组加载器，模组数量最多 | `wow install forge 1.20.1` |
| **Fabric** | Fabric | 轻量级模组加载器，更新快 | `wow install fabric 1.20.1` |
| **NeoForge** | NeoForge | Forge 的分支，1.20.1+ 兼容 Forge 模组 | `wow install neoforge 1.20.1` |
| **Quilt** | Quilt | Fabric 的分支，兼容 Fabric 模组 | `wow install quilt 1.20.1` |

#### 插件服 (Plugin)

| 核心 | 说明 | 安装命令示例 |
|------|------|-------------|
| **Bukkit** | 最早的插件服务端 | `wow install bukkit 1.20.1` |
| **Spigot** | Bukkit 的优化分支，性能更好 | `wow install spigot 1.20.1` |
| **Paper** | Spigot 的进一步优化，性能最佳 | `wow install paper 1.20.1` |
| **Purpur** | Paper 的分支，更多配置选项 | `wow install purpur 1.20.1` |
| **Leaves** | Paper 的优化分支，专注性能 | `wow install leaves 1.20.1` |
| **Folia** | Paper 的分支，分区并行引擎 (⚠️ 部分插件不稳定) | `wow install folia 1.20.1` |
| **Sponge** | 独立 API 的插件服务端 | `wow install sponge 1.20.1` |

#### 混合服 (Hybrid)

| 核心 | 支持模组 | 支持插件 | 说明 | 安装命令示例 |
|------|---------|---------|------|-------------|
| **Mohist** | ✅ Forge | ✅ Bukkit/Spigot/Paper | 同时运行 Forge 模组和 Bukkit 插件，高版本 Paper API 可能不稳定 | `wow install mohist 1.20.1 -b 346` |
| **CatServer** | ✅ Forge | ✅ Bukkit/Spigot | 同时运行 Forge 模组和 Bukkit/Spigot 插件 | `wow install catserver 1.12.2` |
| **Arclight** | ✅ Forge | ✅ Bukkit/Spigot/Paper | 同时运行 Forge 模组和 Bukkit/Spigot/Paper 插件 | `wow install arclight 1.20.1` |

> **Mohist 特殊说明**：Mohist 需要指定构建号 (build)，已知构建号：
> - 1.12.2: `264` (已停更)
> - 1.16.5: `238` (已停更)
> - 1.20.1: `346` (仍保持更新)

### 安装示例

```bash
# 安装原版 (纯净服)
wow install vanilla 1.20.1

# 安装 Forge (模组服)
wow install forge 1.20.1

# 安装 Paper (插件服)
wow install paper 1.20.1

# 安装 Mohist (混合服) - 需要指定构建号
wow install mohist 1.20.1 -b 346

# 安装 CatServer (混合服)
wow install catserver 1.12.2

# 下载任意 URL 文件
wow install https://example.com/plugin.jar -o ./server/plugins/
```

> 安装后核心会自动复制到 `core/pool/cores/` 供其他方案共享。

---

## 5. 创建方案 (实例)

方案是独立的 Minecraft 服务器实例，每个方案拥有独立的世界、配置和日志。

```bash
# 创建方案
./start.sh scheme create my_survival --version 1.20.1 --loader forge --type forge

# 列出所有方案
./start.sh scheme list

# 切换到方案
./start.sh scheme switch my_survival
```

---

## 6. 启动服务器

```bash
# 启动（默认分配 2G 内存）
./start.sh server start

# 指定内存分配
./start.sh server start --memory 4G

# 停止
./start.sh server stop

# 查看状态
./start.sh server status
```

---

## 7. 打开 Web 管理面板

```bash
# 启动 Web 服务（默认端口 8080）
./start.sh web start

# 指定端口
./start.sh web start --port 8080 --host 0.0.0.0
```

然后在浏览器中访问 `http://localhost:8080`，使用邮箱验证码登录。

Web 面板提供以下功能：
- 📊 仪表盘：服务器状态、控制台、玩家统计
- 📦 方案管理：创建/切换/删除/拉取/瘦身
- 📥 下载管理：搜索 CurseForge/Modrinth 模组，下载核心
- 🛠️ 工具：AI 日志分析、压缩包处理、邮件设置
- ⚙️ 设置：修改 wow.yaml、管理插件/主题

---

## 8. 安装模组/插件

```bash
# 列出已安装模组
./start.sh mod list

# 安装模组（URL）
./start.sh mod install https://example.com/JEI.jar

# 安装模组（本地文件）
./start.sh mod install ./JEI.jar

# 启用/禁用模组
./start.sh mod toggle JEI

# 卸载模组
./start.sh mod remove JEI
```

---

## 9. 常见工作流

### 快速搭建一个生存服务器

```bash
# 1. 初始化
./start.sh init

# 2. 安装 Paper
./start.sh install paper 1.20.1

# 3. 创建方案
./start.sh scheme create survival --version 1.20.1 --loader paper --type paper

# 4. 切换方案
./start.sh scheme switch survival

# 5. 启动服务器
./start.sh server start --memory 4G

# 6. 打开 Web 面板
./start.sh web start
```

### 快速搭建一个模组服务器

```bash
# 1. 初始化
./start.sh init

# 2. 安装 Forge
./start.sh install forge 1.20.1

# 3. 创建方案
./start.sh scheme create modded --version 1.20.1 --loader forge --type forge

# 4. 切换方案
./start.sh scheme switch modded

# 5. 安装模组（通过 Web 面板或 CLI）
./start.sh mod install https://example.com/JEI.jar

# 6. 启动服务器
./start.sh server start --memory 6G
```

---

## 下一步

- 📖 [完整命令参考](COMMANDS.md)
- 📦 [方案管理详解](SCHEMES.md)
- 🎨 [主题包开发指南](THEMES.md)
- 🔌 [插件开发指南](WOW-PLUGINS.md)
- 🛠️ [故障排除](TROUBLE_*.md)