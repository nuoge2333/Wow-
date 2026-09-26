# Wow~ V3.5.2-26.3a 发布说明

> 发布时间：2026-09-26
> 版本号含义：`3.5.2` 语义版本（大.中.小）｜`26` = 2026 年后两位｜`3a` = 十六进制**第 58 个**发行包（`0x3a` = 58）

## 一、交互式 REPL（核心新特性）

`./wow.sh`（或 `node core/src/cli.js`）**无参数运行不再只弹出帮助后退出**，而是进入交互模式：

- 逐行读取用户指令，**无需输入 `wow` 前缀**（例如直接输入 `server start`，等价于原 `wow server start`）
- 输入 `exit` / `quit`（或 `Ctrl+C`）退出交互模式
- 进入/退出、每条指令的「发起」与「完成」仍由事件日志系统（`log.js`）记录
- 未知指令给出干净提示（`❌ 未知指令: xxx（输入 help 查看可用指令）`），不再抛出 commander 默认报错
- `help` / `-h` / `--help` 在交互模式中正常可用

## 二、install 命令精简

- **保留**隐藏命令 `install party`（彩蛋，调用 `core/src/party/party.js` 的 `runParty`）
- **保留** `install <URL>` 通用文件下载能力
- **移除**服务端核心安装（vanilla / paper / forge / fabric / neoforge / quilt / mohist / catserver / leaves 等）
- 核心安装统一改用 `scheme create <名称> --type <核心> --version <MC版本>`（scheme 内部仍调用 `installer.install`，无孤儿代码）

> 注：`theme install` 与 `pack install` 作为独立的主题包 / 整合包管理命令**予以保留**（与 scheme 无迁移关系）。若你希望也一并移除，告知即可。

## 三、目录结构变更

- **scheme 目录迁移到根目录**：`core/schemes/` → 根 `scheme/`（`scheme_manager.js` 路径同步；`.gitignore` 由 `core/schemes/` 改为 `scheme/`）
- **删除 `server/` 目录**：服务器运行目录彻底改为「当前激活的方案目录」；`utils.getServerDir()` 默认回退由 `../server` 改为 `../scheme`，`config.js` 的 `server.dir` / `backup.dir` 默认值同步更新
- 新增 `core/src/party/party.js`

## 四、验证情况

- 全部改动 `node --check` 通过
- REPL 实测：`server status`、`install party`、`install <核心>`（重定向提示）、未知指令、`help`、`exit` 均按预期工作
- scheme 路径实测解析为 `/workspace/Wow/scheme`
- 双端（Gitee 主仓库 + GitHub 兜底）已同步 `main` 与标签 `v3.5.2-26.3a`，GitHub Release 已创建

## 五、关于 party 彩蛋

`party` 模块**从未进入过本仓库的 git 历史**（已排查全部提交、标签、Gitee 标签树、reflog 与文件系统），仅存在于作者本地未提交的工作副本。本次已把 `install party` 命令接线还原，但 `core/src/party/party.js` 目前为**占位实现**——请将本地原始 `runParty()` 逻辑粘贴替换该文件即可恢复彩蛋。
