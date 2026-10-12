# V3.5.4-26.3c 发布说明（目录迁移残留修复 + 彩蛋恢复）

> 本版修复 V3.5.2 目录迁移遗留的**路径不同步**问题，以及 `install` 命令去除不彻底造成的误导文案。
> 核心一句话：**`scheme switch` 之后，`server start` 能正确定位到方案目录并启动。**

## 版本号
`V3.5.4-26.3c` = 语义版本 `3.5.4` ｜ 年份后两位 `26`（2026）｜ 十六进制第 60 个发行包（`0x3c` = 60）

## 问题现象

V3.5.2 之后，用户报告：

```
$ ./wow.sh scheme switch help
✅ 已切换到方案: help          # ← help 被当成方案名
$ ./wow.sh install vanilla 1.20.1
💡 核心安装已迁移到 scheme 命令，请改用 scheme create ...
$ ./wow.sh server start
未找到服务器核心，请先用 install 命令安装     # ← 仍引导已废弃命令
wow install <类型> <版本>
```

即：即便方案切换成功，`server start` 仍在错误目录找核心，且报错指引指向早已移除的 `install` 命令。

## 根因

V3.5.2 将方案目录 `core/schemes/` 迁移到项目根 `scheme/`，并删除 `server/` 目录，但以下位置未同步：

| 位置 | 旧值（错误） | 新值（修复后） |
|------|-------------|---------------|
| `utils.getServerDir()` 方案分支 | `resolvePath('schemes/<名>')` → `core/schemes/<名>` | `resolvePath('../scheme/<名>')` → 根 `scheme/<名>` |
| `core/wow.yaml` `server.dir` | `../server`（**目录已删除**） | `../scheme` |
| `core/wow.yaml` `backup.dir` | `../server/backups` | `../scheme/backups` |
| `pack_generator.js` 存档路径 | `<方案>/../../server/worlds/<存档>` | `<方案>/world` |
| `cli.js init` 目录列表 | 仍创建 `core/schemes` | 已移除 |

**最关键的是第一项**：`getServerDir()` 永远认为方案目录不存在，于是每次都回退到根目录（或已删除的 `server/`），方案切换在「启动」环节完全失效。

## 修复清单

### 🔴 路径同步（根因修复）
- `utils.getServerDir()` 方案分支改用 `../scheme/<方案名>`，与 `SchemeManager.schemesDir` 严格一致（保持纯路径拼接，避免 `scheme_manager ⇄ utils` 循环依赖）。
- `core/wow.yaml`：`server.dir` / `backup.dir` 指向根 `scheme/`。
- `pack_generator.js`：存档源路径改为方案目录下的 `world`。
- `cli.js init`：不再重建废弃的 `core/schemes`。

### 🔴 `install` 去残留
- **`server start` 报错改为上下文指引**：
  - 已激活方案 → 打印该方案目录，并建议 `scheme switch <方案>` 补齐；
  - 未激活方案 → 提示 `scheme create <名称> --type <类型> --version <MC版本>`。
- **`scheme switch help|-h|--help`** 输出用法与 `scheme list`，不再把 `help` 当方案名。
- **切换失败时列出可用方案**，无方案时提示先 `scheme create`。

### 🎉 彩蛋恢复
- `core/src/party/party.js` 由占位替换为**完整实现**：隐藏注册表 `EGG_REGISTRY`、口令校验、按需下载/解压/播放。新增彩蛋只需在注册表追加一条，无需改动其他文件。

### 🧹 其他
- `wow.sh` / `start.sh` 权限修正为可执行（755）。

## 验证

| 场景 | 命令 | 结果 |
|------|------|------|
| 未激活方案目录解析 | `getServerDir()` | `/workspace/Wow/scheme`（不再是已删除的 `/workspace/Wow/server`） |
| 激活方案目录解析 | 桩测 `server.scheme=__t3__` | `/workspace/Wow/scheme/__t3__`，方案内 jar 可被定位 ✅ |
| 用法提示 | `wow.sh scheme switch help` | 输出「用法: scheme switch <名称> / 查看可用方案: scheme list」✅ |
| 迁移引导 | `wow.sh install vanilla 1.20.1` | 输出 `scheme create <名称> --type vanilla --version 1.20.1` ✅ |
| 启动报错指引 | `wow.sh server start` | 输出「当前未激活任何方案 + scheme create 示例」✅ |
| 版本号 | `wow.sh -V` | `3.5.4-26.3c` ✅ |

- `node --check` 覆盖 `cli.js` / `server.js` / `utils.js` / `pack_generator.js` / `party/party.js` 全部通过。
- 真实 CLI 走查（`bash wow.sh ...`）三个场景输出符合预期，无异常堆栈。

## 未做（留后续）
- 补 `test/` 或删除空头 `test` 脚本、接入 ESLint/CI、拆分超大模块、补全其余占位实现、清理死代码。
- 发版附件附 `SHA256SUMS`（配合 V3.5.3 已实现的 `update.sh` 哈希校验，可达满血）。
