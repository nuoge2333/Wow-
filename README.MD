## `README.md`

# 🎮 wow~

> Minecraft 服务器管理工具

**wow~** 是一个轻量级的 Minecraft 服务器管理工具，专为 **纯终端环境** 和 **远程管理** 场景设计。它同时提供命令行界面 (CLI) 和 Web 管理面板，支持模板模式的多实例方案管理，让你轻松管理多个服务器实例。

> 📌 **命令引导词说明（重要）**
> 本文档中所有以 `wow` 开头的命令（如 `wow server start`）都是**简写**，实际执行时请按你的操作系统替换为对应的启动脚本：
>
> | 操作系统 | 文档写法 | 实际执行 |
> |----------|----------|----------|
> | **Linux / macOS** | `wow server start` | `./wow.sh server start` |
> | **Windows** | `wow server start` | `wow.bat server start` |
>
> 下文所有文档（QUICKSTART / COMMANDS / CONFIG 等）均遵循同一约定。

---

## ✨ 特性

- 🚀 **CLI + Web 双模式**：命令行高效操作，Web 面板可视化管理
- 📦 **模板模式方案管理**：智能资源共享，自动判定 `minimal` / `partial` / `full` 状态
- 🔌 **模组与插件管理**：支持 Forge / Fabric / NeoForge / Quilt 模组，Bukkit / Spigot / Paper 插件
- 📥 **整合包安装**：一键安装客户端整合包（含自动测试与不兼容模组清理）
- 🎨 **主题包系统**：用户可完全替换 Web 界面，支持 ZIP 安装与切换
- 🧩 **wow 插件系统**：通过 `plugin.json` + `index.js` 扩展新 CLI 命令，代码放 `wow-plugins/`，与主程序物理隔离；首次启用需确认，内容改动后重新确认
- 🤖 **AI 日志分析**：对接 OpenAI/兼容 API，自动分析服务器错误并给出建议
- 📧 **邮件通知**：登录验证码、崩溃报告、定时日志摘要（SMTP，15 分钟限流）
- 🔐 **外置登录**：自动下载并注入 `authlib-injector`，支持 LittleSkin 等第三方认证
- ☕ **JRE 自动管理**：按需下载对应版本的 JRE，无需用户手动安装
- 📦 **便携式设计**：无需安装，解压即用，自带 Node.js 便携版（首次启动自动下载）

---

## 🚀 快速开始

### 1. 下载与解压

```bash
# 解压到任意目录（文件名随版本变化，以实际下载到的为准）
unzip wow-<版本号>.zip
cd wow
```

### 2. 运行启动脚本

```bash
# Windows
wow.bat

# Linux / macOS
chmod +x wow.sh
./wow.sh
```

> 💡 **更新**: 运行 `./update.sh` (Linux/macOS) 或 `update.bat` (Windows) 自动升级到最新版

### 3. 初始化环境

```bash
wow init
```

### 4. 安装服务器

```bash
# 创建方案 = 下载核心 + 建目录 + 激活（唯一的核心安装入口）
wow scheme create myserver --type paper --version 1.20.1

# 其他核心同理，类型用 --type 指定
wow scheme create modded --type mohist --version 1.20.1 -b 346
```

> ⚠️ **V3.5.2 起 `install` 不再安装服务端核心**。`wow install vanilla 1.20.1` 只会提示你改用
> `scheme create`；`install` 现在只剩两件事：下载任意 URL 文件（`wow install https://... -o 路径`）
> 和隐藏彩蛋 `wow install party`。

### 5. 启动服务器

```bash
wow server start --memory 4G
```

### 6. 打开 Web 面板

```bash
wow web start
# 浏览器访问 http://localhost:8080
```

---

## 📋 命令概览

| 类别 | 命令 |
|------|------|
| 数字选择菜单 | `wow`（无参数直接进入） |
| 长命令模式 | `L [命令...]`（无参进 REPL，带参执行单条） |
| 服务器管理 | `server start/stop/kill/restart/status` |
| 方案管理 (模板模式) | `scheme create/list/switch/delete/info/status/pull/prune` |
| 资源池 | `pool stats` |
| 模组管理 | `mod remove/list/toggle/sync` |
| 整合包 | `pack install/generate` |
| 主题包 | `theme install/list/switch/delete/info` |
| Web 面板 | `web start/stop/status/tunnel` |
| 联机 / 内网穿透 | `lan host/stop/status` |
| 日志与 AI | `logs tail/analyze/report` |
| 配置管理 | `config wow/server/white/mods/server-list/server-quick/server-reset` |
| 邮件 | `mail test/send-code/crash` |
| 工具 | `down`、`install`（**仅 URL 下载与彩蛋，不再装核心**） |

> 完整命令参考请查看 [docs/COMMANDS.md](docs/COMMANDS.md)

---

## 📂 项目结构

```
wow/
├── core/                     # 核心代码
│   ├── src/                  # 源代码
│   ├── pool/                 # 资源池 (核心/模组/插件，跨方案共享)
│   ├── lan/                  # 陶瓦联机二进制 (首次使用时自动下载)
│   ├── wow.yaml              # 配置文件
│   └── package.json          # 依赖
├── scheme/                   # 方案目录（每个方案一个子目录，即服务器运行目录）
│   └── <方案名>/             # 含核心 jar、mods/、plugins/、world/、server.properties、scheme.yaml
├── web/                      # Web 面板前端（实际生效的前端资源）
├── themes/                   # 主题包目录
├── wow-plugins/              # wow 插件目录
├── wow.bat / wow.sh          # 启动脚本
├── update.bat / update.sh    # 更新脚本
└── docs/                     # 文档
```

> **说明**：V3.5.2 起方案目录由 `core/schemes/` 迁移至根目录 `scheme/`，
> 且不再复制到 `server/`——服务器直接在各方案目录内运行。

---

## 📖 文档

- [快速开始](docs/QUICKSTART.md)
- [完整命令参考](docs/COMMANDS.md)
- [方案管理详解 (模板模式)](docs/scheme/SCHEMES.md)
- [主题包开发指南](docs/net/THEMES.md)
- [插件开发指南](docs/other/WOW-PLUGINS.md)
- [Web 面板使用说明](docs/net/WEB_PANEL.md)
- [联机 / 内网穿透（陶瓦）](docs/net/LAN_TERRACOTTA.md)
- [陶瓦联机实测报告](docs/other/LAN_TERRACOTTA-TEST-REPORT.md)
- [配置参考](docs/CONFIG.md)
- [Web API 参考](docs/net/API.md)
- [术语解释](docs/TERMS.md)
- [Android 已知限制说明](docs/other/ANDROID_LIMITATIONS.md)
- [更新日志](docs/other/CHANGELOG.md)
## 🛠 故障排除
- [Windows 故障排除](docs/trouble/TROUBLE_WINDOWS.md)
- [MacOS故障排除](docs/trouble/TROUBLE_MACOS.md)
### Linux
- [Debian/Ubuntu 故障排除](docs/trouble/TROUBLE_DEBIAN.md)
- [Arch/Manjaro 故障排除](docs/trouble/TROUBLE_ARCH.md)

---

## 📵 不支持 Android

Android 设备无法运行 wow~ 服务端（网络沙箱限制，详见 [Android 已知限制说明](docs/other/ANDROID_LIMITATIONS.md)）。
手机可以作为**联机客户端**通过陶瓦加入房间，也可以用浏览器访问跑在电脑 / VPS 上的 Web 面板。

---

## 🛠️ 系统要求

| 组件 | 要求 |
|------|------|
| 操作系统 | Windows 10+, Linux (glibc 2.28+), macOS 10.15+ |
| Java | 8、17、21（按需自动下载） |
| Node.js | 自动下载便携版，无需手动安装 |
| 浏览器 | Chrome 90+, Firefox 88+, Edge 90+, Safari 15+ |
> 注：Windows 7 无法保证能够稳定运行，建议升级到 Windows 10+。
> 注：**不支持 Android**。Android 的网络沙箱使服务端无法对外暴露端口，详见 [Android 已知限制说明](docs/other/ANDROID_LIMITATIONS.md)。
---

## 🤝 参与贡献

Wow~ 是一个**散装项目**，它没有编译成 `.exe`、`.deb` 等可执行文件——这意味着你下载的副本里就是完整的源代码。你可以随意修改代码，打造专属自己的 `Wow~` 版本。

如果你发现任何 Bug，或者有好的功能建议，欢迎提交 [Issue](https://gitee.com/nuoge233/wow/issues)。

你也可以通过开发 `Wow~` 插件来扩展功能，无需修改主程序代码。

如果你想制作一个更好的版本，欢迎 **Fork** 本仓库，但请在遵守 **MPL2.0 许可证** 的前提下进行（详见 [版权声明](#-版权声明)）。

## 📄 版权声明

Copyright © 2025-2026 nuoge

> **除特别声明的文件外，本仓库内的所有文件均为 MPL2.0（Mozilla Public License v2.0）许可。**
> 若有文件采用其他许可，会在该文件内或所在目录的 LICENSE 中单独声明。

本项目使用 *Mozilla Public License v2.0* 开源许可证，原文请见 [./LICENSE](LICENSE)。

**许可变更说明**：本项目从 `v3.5.23-26.3e` 起改为 MPL2.0，此前的版本
（截至 `v3.5.22-26.3d`）仍按 **MIT 许可证** 发布。MIT 是不可撤销的授权，
因此**你已经获得的旧版本副本，永久享有 MIT 赋予的全部权利**（包括闭源再分发），
这一点不会因本次变更而改变。

以下是本项目的附加免责声明（仅作免责，不构成对 MPL2.0 所授予权利的限制或附加条件）
```
## Additional Disclaimer (Please read before use):

The author (nuoge) assumes no responsibility for any data loss, system crashes,
security breaches, or other damages arising from the use of this software, including
modified, unofficial, or incorrectly distributed copies.

It is the user's sole responsibility to verify the integrity of the software before
running it. Official SHA-256 checksums are published alongside each release; you can
download them from the release page of the official repository.
```
以下为许可证与免责声明的中文参考译本。由于部分措辞在中文语境中没有完全对应的
词汇，本译本不能做到 100% 准确，**仅作参考，不具有任何法律效力**；
法律效力以 [./LICENSE](LICENSE) 中 MPL2.0 英文原版为准。

Mozilla 公共许可证 第二版

（本中文译本为 MPL2.0 的参考译文，条文含义以英文原文为准，此处不逐条重述。
核心要点如下：）

- **文件级 copyleft**：你修改过的**文件**必须以 MPL2.0 公开其源代码；
  未修改的文件、以及与之组合的其他代码，可以采用其他许可。
- **允许更大的作品**：你可以把本软件与其他代码组合成"更大作品"（Larger Work）
  并按其自选条款分发，只要对本软件部分继续履行 MPL2.0 的义务。
- **允许闭源集成**：与 GPL 不同，MPL2.0 不要求你的整个项目开源，
  只要求被修改的 MPL 文件开源。
- **专利授权**：每位贡献者向你授予其贡献相关的专利许可。
- **无担保**：本软件按"现状"提供，不附带任何明示或暗示的担保。

## 附加免责声明（使用前请阅读）：

作者（nuoge）对因使用本软件（包括被修改过的、非官方的或错误分发的副本）
而引起的任何数据丢失、系统崩溃、安全漏洞或其他损害不承担任何责任。

用户有责任在运行软件前自行验证其完整性。官方 SHA-256 校验和随每个版本一同发布，
可从官方仓库的 Release 页面下载。

---

## 🙏 致谢

- [BMCLAPI2](https://bmclapi2.bangbang93.com) —— 国内 Minecraft 下载镜像
- [authlib-injector](https://authlib-injector.yushi.moe) —— 外置登录支持
- [Terracotta｜陶瓦联机](https://github.com/burningtnt/Terracotta) —— 联机 / 内网穿透支持（基于 EasyTier，AGPLv3）；wow~ 通过其本地 HTTP API 驱动，未修改其二进制
- [Mojang](https://www.minecraft.net) —— Minecraft 游戏本身
> *Minecraft 是 Mojang AB 的注册商标。 本项目未经 Mojang 或 Microsoft 批准，也不与 Mojang 或 Microsoft 关联。*
---
