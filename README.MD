## `README.md`

# 🎮 wow~

> Minecraft 服务器管理工具

**wow~** 是一个轻量级的 Minecraft 服务器管理工具，专为 **纯终端环境** 和 **远程管理** 场景设计。它同时提供命令行界面 (CLI) 和 Web 管理面板，支持模板模式的多实例方案管理，让你轻松管理多个服务器实例。

---

## ✨ 特性

- 🚀 **CLI + Web 双模式**：命令行高效操作，Web 面板可视化管理
- 📦 **模板模式方案管理**：智能资源共享，自动判定 `minimal` / `partial` / `full` 状态
- 🔌 **模组与插件管理**：支持 Forge / Fabric / NeoForge / Quilt 模组，Bukkit / Spigot / Paper 插件
- 📥 **整合包安装**：一键安装客户端整合包（含自动测试与不兼容模组清理）
- 🎨 **主题包系统**：用户可完全替换 Web 界面，支持 ZIP 安装与切换
- 🔌 **wow 插件系统**：通过 `plugin.json` + `index.js` 扩展新命令，无需修改核心代码
- 🤖 **AI 日志分析**：对接 OpenAI/兼容 API，自动分析服务器错误并给出建议
- 📧 **邮件通知**：登录验证码、崩溃报告、定时日志摘要（SMTP，15 分钟限流）
- 🔐 **外置登录**：自动下载并注入 `authlib-injector`，支持 LittleSkin 等第三方认证
- ☕ **JRE 自动管理**：按需下载对应版本的 JRE，无需用户手动安装
- 📦 **便携式设计**：无需安装，解压即用，自带 Node.js 便携版（首次启动自动下载）

---

## 🚀 快速开始

### 1. 下载与解压

```bash
# 解压到任意目录
unzip wow-3.1.0.zip
cd wow
```

### 2. 运行启动脚本

```bash
# Windows
start.bat

# Linux / macOS
chmod +x start.sh
./start.sh
```

> 💡 **更新**: 运行 `./update.sh` (Linux/macOS) 或 `update.bat` (Windows) 自动升级到最新版

### 3. 初始化环境

```bash
wow init
```

### 4. 安装服务器

```bash
wow install vanilla 1.20.1
# 或安装 Mohist (需要构建号)
wow install mohist 1.20.1 -b 346
```

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
| 交互式菜单 | `m [1-14]` |
| 服务器管理 | `server start/stop/kill/restart/status` |
| 方案管理 (模板模式) | `scheme create/list/switch/delete/info/status/edit/pull/prune/register` |
| 模组管理 | `mod remove/list/toggle/sync` |
| 整合包 | `pack install/generate` |
| 主题包 | `theme install/list/switch/delete/info` |
| wow 插件 | `plugin install/list/remove/info` |
| Web 面板 | `web start/stop/status` |
| 日志与 AI | `logs tail/analyze/report` |
| 配置管理 | `config wow/server/white` |
| 模组配置 (V3.1) | `config mods list/view/get/set` |
| server.properties (V3.1) | `config server-list/server-quick/server-reset` |
| 邮件 | `mail test/send-code/crash` |
| 工具 | `down/install/pool stats/prune` |

> 完整命令参考请查看 [docs/COMMANDS.md](docs/COMMANDS.md)

---

## 📂 项目结构

```
wow/
├── core/                     # 核心代码
│   ├── src/                  # 源代码 (13 个模块)
│   ├── pool/                 # 资源池 (核心/模组/插件)
│   ├── schemes/              # 方案目录
│   ├── web/                  # Web 前端
│   ├── wow.yaml              # 配置文件
│   └── package.json          # 依赖
├── themes/                   # 主题包目录
├── wow-plugins/              # wow 插件目录
├── server/                   # 当前激活的服务器实例
├── start.bat / start.sh      # 启动脚本
└── docs/                     # 文档
```

---

## 📖 文档

- [快速开始](docs/QUICKSTART.md)
- [完整命令参考](docs/COMMANDS.md)
- [方案管理详解 (模板模式)](docs/SCHEMES.md)
- [主题包开发指南](docs/THEMES.md)
- [插件开发指南](docs/WOW-PLUGINS.md)
- [Web 面板使用说明](docs/WEB_PANEL.md)
- [配置参考](docs/CONFIG.md)
- [Web API 参考](docs/API.md)
- [术语解释](docs/TERMS.md)
- [故障排除](docs/TROUBLE_*.md)
- [安卓 (Termux) 故障排除](docs/TROUBLE_ANDROID(Termux).md)
- [更新日志](docs/CHANGELOG.md)

---

## 🛠️ 系统要求

| 组件 | 要求 |
|------|------|
| 操作系统 | Windows 10+, Linux (glibc 2.28+), macOS 10.15+, **Android（需 Termux）** |
| Java | 8、17、21（桌面端按需自动下载）；Android 端由 Termux 的 `pkg install openjdk-17` 提供 |
| Node.js | 自动下载便携版（桌面端），或由 Termux 的 `pkg` 提供（安卓端）；均无需手动安装 |
| 浏览器 | Chrome 90+, Firefox 88+, Edge 90+, Safari 15+ |
> 注：Windows 7 无法保证能够稳定运行，建议升级到 Windows 10+。
> 注：安卓必须在 **Termux** 终端内运行（不要用系统自带终端或 ADB shell），且设备架构需为 arm64 或 x64。
---

## 🤝 参与贡献

Wow~ 是一个**散装项目**，它没有编译成 `.exe`、`.deb` 等可执行文件——这意味着你下载的副本里就是完整的源代码。你可以随意修改代码，打造专属自己的 `Wow~` 版本。

如果你发现任何 Bug，或者有好的功能建议，欢迎提交 [Issue](https://github.com/nuoge2333/Wow-/issues)。

你也可以通过开发 `Wow~` 插件来扩展功能，无需修改主程序代码。

如果你想制作一个更好的版本，欢迎 **Fork** 本仓库，但请在遵守 **MIT 许可证** 及 [附加条款](#附加条款) 的前提下进行。

## 📄 版权声明

Copyright © 2025-2026 nuoge

本项目使用*MIT开源许可证*，原文请见./LICENSE
以下是本项目的附加条款
```
##Additional Disclaimer (Please read before use):
If your copy's SHA‑256 checksum does not match the official release (as published by nuoge on the designated distribution platform, to be announced), then your copy is not official and has been tampered with.

The author (nuoge) assumes no responsibility for any data loss, system crashes, security breaches, or other damages arising from the use of modified, unofficial, or incorrectly distributed copies.

It is the user's sole responsibility to verify the integrity of the software before running it. The official checksum will be provided upon the first public release.


```
以下为许可证与附加条款的中文译本，由于部分措辞在中文语境中没有最准确的匹配词汇，不能做到100%准确，仅作参考，不具有任何法律效力，法律效力以附加条款英文原文（即上文）与./LICENSE中MIT许可证英文原版为准：

MIT 许可证

版权所有 (c) 2025 nuoge

特此授予任何获得本软件及其相关文档文件（“软件”）副本的人免费许可，允许其不受限制地处理本软件，包括但不限于使用、复制、修改、合并、发布、分发、再许可和/或销售本软件副本的权利，并允许被提供本软件的人员这样做，但须符合以下条件：

上述版权声明和本许可声明应包含在本软件的所有副本或实质性部分中。

本软件按“现状”提供，不提供任何形式的明示或暗示担保，包括但不限于适销性、特定用途适用性和非侵权性的担保。在任何情况下，作者或版权持有人均不对任何索赔、损害或其他责任负责，无论该责任是基于合同、侵权或其他原因，因本软件或本软件的使用或其他交易而产生、引起或与之相关。

##附加免责声明（使用前请阅读）：

如果您的副本经 SHA‑256 校验和与[官方发布版本](https://github.com/nuoge2333/Wow-/)不匹配，则您的副本并非官方版本，且已被篡改。

作者（nuoge）对因使用修改过的、非官方的或错误分发的软件副本而引起的任何数据丢失、系统崩溃、安全漏洞或其他损害不承担任何责任。

用户有责任在运行软件前自行验证其完整性。官方校验和将在首次公开发布时提供。

---

## 🙏 致谢

- [BMCLAPI2](https://bmclapi2.bangbang93.com) —— 国内 Minecraft 下载镜像
- [authlib-injector](https://authlib-injector.yushi.moe) —— 外置登录支持
- [Mojang](https://www.minecraft.net) —— Minecraft 游戏本身
> *Minecraft 是 Mojang AB 的注册商标。 本项目未经 Mojang 或 Microsoft 批准，也不与 Mojang 或 Microsoft 关联。*
---
