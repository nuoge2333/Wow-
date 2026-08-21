# 📖 计算机术语解释

> 面向非专业用户，用通俗语言解释本项目涉及的核心概念。

---

## 基础概念

### CLI (Command Line Interface)
**命令行界面**，就是那种黑色背景、白色文字的窗口。你在这里输入命令，电脑执行操作。

**在 wow 中：** 你打开终端（Windows 叫 CMD/PowerShell，Linux/macOS 叫终端），输入 `wow server start` 这样的命令来管理服务器。

---

### Web 面板
**浏览器里的管理页面**，有按钮、图表、输入框，点点鼠标就能操作。

**在 wow 中：** 运行 `wow web start` 后，在浏览器打开 `http://localhost:8080`，就能看到图形化的管理界面。

---

### 方案 (Scheme)
**一个完整的 Minecraft 服务器实例**，包含核心、模组、插件、存档、配置、日志等所有文件。

**在 wow 中：** 你可以创建多个方案（如“生存服”、“创造服”、“模组测试服”），每个方案相互独立，切换方案相当于切换整个服务器环境。

---

### 模板模式 (Template Mode)
**wow 独有的多实例管理方式**，兼顾硬盘空间和启动速度。

**原理：**
- 重复的文件（如同一个核心）只存一份在 `pool` 中
- 切换方案时自动补齐需要的文件
- 切换离开时自动瘦身，删除可共享的文件

**对比：**
- 传统方式：每个实例存一份完整文件 → 硬盘占用大
- 模板模式：共享文件只存一份 → 硬盘占用小，启动速度快

---

### 资源池 (Pool)
**存放共享文件的地方**，位于 `core/pool/` 目录。

**里面有什么：**
- `cores/` —— 服务端核心（如 forge-1.20.1.jar）
- `mods/` —— 模组文件（如 JEI.jar）
- `plugins/` —— 插件文件（如 Essentials.jar）

**怎么判断共享：** 通过 SHA-256 哈希值（文件指纹）判断文件是否相同，相同的文件只存一份。

---

### SHA-256
**文件指纹**，一个文件的唯一“身份证号”。哪怕文件内容只有一个字节不同，SHA-256 值也会完全不一样。

**在 wow 中：** 用 SHA-256 判断两个文件是否完全相同，从而决定是否共享存储。

**示例：**
- `minecraft_server.1.20.1.jar` 的 SHA-256 是 `a1b2c3...`
- 另一个同样文件的 SHA-256 也是 `a1b2c3...` → 判定为相同文件，共享存储

---

### 方案状态 (minimal / partial / full)

| 状态 | 含义 | 比喻 |
|------|------|------|
| **minimal** | 所有资源都在 pool 中，方案目录只有配置和存档 | “空壳子”，只有配置文件，实际文件在仓库 |
| **partial** | 部分资源在方案目录，部分在 pool 中 | “半成品”，部分文件自己带着，部分从仓库借 |
| **full** | 所有资源都在方案目录中 | “完整包”，所有文件都在自己手里 |

---

## 运行环境

### JRE / Java
**运行 Minecraft 服务器必须的环境**。Minecraft 服务器是用 Java 写的，没有 Java 就跑不起来。

**在 wow 中：** 如果系统没有 Java，wow 会自动下载对应版本的 JRE 到 `core/jre/` 目录。

---

### Node.js
**运行 wow 工具本身的运行时**。wow 是用 JavaScript 写的，没有 Node.js 就跑不了 wow。

**在 wow 中：** 首次运行 `wow.sh` 或 `wow.bat` 时，会自动下载便携版 Node.js。

---

### authlib-injector
**外置登录工具**，让 Minecraft 服务器支持第三方认证（如 LittleSkin）。

**在 wow 中：** 在 `wow.yaml` 中设置 `auth.enable: true` 和 `auth.server` 地址，启动服务器时自动注入。

---

### SMTP
**发邮件的协议**。用于发送登录验证码、崩溃报告、日志摘要。

**在 wow 中：** 在 `wow.yaml` 中配置 `mail.smtp` 后，才能使用邮件功能。

---

## Minecraft 相关

### 模组加载器 (Mod Loader)
**让 Minecraft 加载模组的工具**。不同模组需要不同的加载器。

| 加载器 | 说明 |
|--------|------|
| **Forge** | 最成熟的模组加载器，模组数量最多 |
| **Fabric** | 轻量级，更新快 |
| **NeoForge** | Forge 的分支，1.20.1+ 兼容 Forge 模组 |
| **Quilt** | Fabric 的分支，兼容 Fabric 模组 |

---

### 插件 (Plugin)
**为服务器添加功能的扩展**，不需要玩家安装，直接在服务器端运行。

**与模组的区别：**
- 模组：需要玩家和服务器同时安装
- 插件：只需服务器安装，玩家无需任何操作

**常见插件平台：**
- Bukkit / Spigot / Paper —— 最常用
- Sponge —— 独立 API

---

### 混合核心 (Hybrid Core)
**同时支持模组和插件的服务端核心**。

| 核心 | 支持模组 | 支持插件 |
|------|---------|----------|
| Mohist | ✅ Forge | ✅ Bukkit/Spigot/Paper |
| CatServer | ✅ Forge | ✅ Bukkit/Spigot |
| Arclight | ✅ Forge | ✅ Bukkit/Spigot/Paper |

---

## wow 特有术语

### pull (拉取)
从 pool 复制资源到方案目录，将方案补齐为完整实例。

**命令：** `wow scheme pull <name>`

---

### prune (瘦身)
从方案目录移除可共享的资源，将方案转为最小实例。

**命令：** `wow scheme prune <name>`

---

### auto_scheme
一个开关，控制是否自动管理方案状态。

- `true`（默认）：切换方案时自动补齐/瘦身
- `false`：需要手动执行 `pull` / `prune`

**设置：** `wow set auto_scheme false`

---

### 隔离模式 vs 方案模式 vs 模板模式

| 模式 | 说明 | 代表 |
|------|------|------|
| **隔离模式** | 每个实例独立存储，不共享任何文件 | 大多数启动器 |
| **方案模式** | 所有资源在 pool 中，启动时拼凑 | 理论模式，未实现 |
| **模板模式** | 方案目录 + pool 池，切换时补齐/瘦身 | **wow 首创** |

---

## 缩写速查

| 缩写 | 全称 | 说明 |
|------|------|------|
| CLI | Command Line Interface | 命令行界面 |
| JRE | Java Runtime Environment | Java 运行时环境 |
| SMTP | Simple Mail Transfer Protocol | 邮件传输协议 |
| SHA | Secure Hash Algorithm | 安全哈希算法 |
| PID | Process ID | 进程 ID |
| TPS | Ticks Per Second | 每秒刻数（服务器性能指标） |
| EULA | End User License Agreement | 最终用户许可协议 |