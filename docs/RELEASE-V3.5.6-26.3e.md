# V3.5.6-26.3e 发布说明（Web 面板 API 补齐 + 核心下载源修复）

> 本版修复 Web 面板**文件管理 / 模组下载 / 陶瓦开房等页面点击即报错**，
> 以及 `scheme create` **无法创建 paper 方案**（下载源全线 404）的问题。

## 版本号
`V3.5.6-26.3e` = 语义版本 `3.5.6` ｜ 年份后两位 `26`（2026）｜ 十六进制第 62 个发行包（`0x3e` = 62）

---

## 一、Web 面板：10 个接口 404，全面补齐

### 现象
文件管理、模组下载、方案详情、设置、工具箱、仪表盘等页面点击后报错。
起服务实测确认以下端点全部返回 **404**：

```
/api/files          /api/mod/search      /api/pool/stats
/api/upload         /api/mod/info        /api/plugins
/api/download       /api/download/status /api/logs/analysis
/api/metrics
```

### 根因
前端页面按这套接口写好了调用，但后端 `web_service.js` **从未实现过它们**（只有 14 条路由，前端需要 20+ 条）。

### 修复
新增 3 个后端模块并接入全部缺失路由：

| 新模块 | 职责 |
|--------|------|
| `core/src/file_manager.js` | 文件管理（列目录 / 下载 / 上传），含路径安全边界 |
| `core/src/mod_search.js` | 模组搜索（Modrinth 公开 API + CurseForge 可选 Key） |
| `core/src/download_queue.js` | 下载任务队列（内存态，供面板展示） |

---

## 二、文件管理：路径安全

用户确认的约束是 **「文件操作严格限制在方案目录内」**。

`file_manager.js` 实现**三重防御**：

1. **段级拒绝**：路径分段后，任一段为 `..` 直接拒绝
2. **前缀校验**：`path.resolve` 后必须落在根目录前缀之内
3. **符号链接阻断**：对已存在的路径调用 `fs.realpathSync`，若真实路径逃逸出根目录则拒绝

额外拦截：

- 绝对路径（`/etc/passwd`）、盘符路径（`C:\Windows`）
- UNC 网络路径（`//server/share`）—— 注意须在剥离前导斜杠**之前**判断，否则会被误判为合法相对路径
- 上传文件名中的控制字符与 Windows 保留字符 `<>:"|?*`，同时保留子目录层级
- 单次上传总量上限 **512MB**

配套单元测试 `core/test/file_manager.test.js` 覆盖 21 个用例（含空路径、`./` 归一、反斜杠归一、
多层穿越、绝对路径、盘符、UNC、符号链接逃逸、文件名净化等），**21/21 全通过**。

### 修正的一个隐蔽 Bug
`/api/files` 路由最初写成**同步**函数却调用了 async 的 `listFiles()`，rejected Promise 未被同步
`try/catch` 捕获 → 未处理异常直接**崩溃进程**。已改为 `async + await`，并给 `authMiddleware`
整体包上 `try/catch`。

---

## 三、陶瓦开房报错：前端脚本引用缺失

### 现象
`lan.html` 页面点击「开房」即报错。

### 根因
`lan.html` 调用 `window.wow.apiRequest`，但**页面没有引入 `web/js/main.js`**——
全站只有这一个页面用了 `window.wow`，也恰好只有它漏了脚本引用，于是 `window.wow` 为
`undefined`，任何交互都抛 `Cannot read properties of undefined`。

**后端完全正常。** 实测验证：

```
🌐 正在下载陶瓦 (Terracotta) 二进制（首次使用需联网）
   来源(linux-x86_64): https://gitee.com/burningtnt/Terracotta/releases/download/v0.4.2/...
✅ 陶瓦二进制就绪: core/lan/terracotta   （11,861,032 bytes）

🏠 正在开房...
📡 已启动 Minecraft 局域网广播：端口 25565
✅ 开房成功！房间号: U/4199-44W1-QJ0C-4CEY
   状态机: host-scanning → host-ok
✅ 已关闭陶瓦联机房间
```

> 开房前的**端口自检**（要求 25565 上有 Minecraft 服务端在监听，否则提示先 `wow server start`）
> 是预期的保护行为，不是 Bug。

### 修复
在 `lan.html` 的 `<head>` 中补上 `<script src="/js/main.js"></script>`。

---

## 四、`scheme create --type paper` 失败：下载源全线 404

### 根因（两层）

**第一层**：`installer.js` 中 paper 的下载 URL 拼装方式从来就是错的。

```js
url: (version, mirror) => `${mirror}/paper/${version}/latest/download`
//                             ↑ bmclapi2.bangbang93.com
```

BMCLAPI 的定位是「镜像 Forge 与 Minecraft 官方资源」（其文档明确写出），
**并不提供 Paper / Spigot / CraftBukkit / Leaves 的分发**。这些 URL 一律 404。

**第二层**：PaperMC 自身也已迁移 API。

| 旧接口 | 现状 |
|--------|------|
| `api.papermc.io/v2/projects/paper/...` | **410 Gone** |
| `fill.papermc.io/v3/projects/paper/...` | ✅ 现行接口 |

实测各源可用性：

| 源 | 旧 URL 状态 |
|----|------------|
| paper (bmclapi2) | ❌ 404 |
| spigot (bmclapi2) | ❌ 404 |
| craftbukkit (bmclapi2) | ❌ 404 |
| leaves (bmclapi2) | ❌ 404 |
| purpur (官方) | ✅ 200 |
| vanilla manifest (bmclapi2) | ✅ 200 |

### 修复
`installer.js` 新增三种下载策略：

| 策略 | 用于 | 说明 |
|------|------|------|
| `kind: 'papermc'` | paper | 两段式解析 `fill.papermc.io/v3`：先取 `builds/latest`，再从 `downloads['server:default'].url` 取直链 |
| `kind: 'github-release'` | leaves | 从 GitHub Releases 资产中按正则匹配 MC 版本 |
| `kind: 'unsupported'` | spigot / bukkit | 官方无预编译包，给出**可执行的替代建议**而非含糊的网络错误 |

`spigot` / `bukkit` 现在报错如下（而非 `Request failed with status code 404`）：

```
Spigot 官方不提供预编译服务端，需用 BuildTools 现场构建。
  → 推荐改用 Paper（完全兼容 Spigot 插件，性能更好）：wow install paper <版本>
```

**端到端实测**：`scheme create demo-paper -t paper -v 1.20.1` 成功解析并下载
`paper-1.20.1-196.jar`（43,230,582 bytes），方案目录结构完整，`scheme.yaml` 正常生成。

---

## 五、方案创建失败后残留残缺目录

### 问题
`scheme create` 先建目录（`world/` `config/` `logs/` `mods/` `plugins/`），再装核心。
核心安装抛错时目录**不回滚**，于是 `scheme/` 下留下一个没有 `scheme.yaml`、没有核心 jar
的残缺方案，在 `scheme list` 中显示为损坏状态。

### 修复
把核心安装步骤包进 `try/catch`，失败时 `fs.removeSync(schemePath)` 整个方案目录并打印回滚日志：

```
📦 创建方案: demo-rollback
  核心类型: spigot
⚠️ 核心安装失败，已回滚方案目录: /path/to/wow/scheme/demo-rollback
抛错: 创建方案 demo-rollback 失败: Spigot 官方不提供预编译服务端...
  scheme/demo-rollback 是否残留: false
```

---

## 六、清理

- 删除 `core/web/`（13 个文件）—— V3.5.2 目录迁移前的**遗留前端副本**，无任何代码引用，
  且比现行 `web/` 少一个 `lan.html`。真正生效的前端是根目录 `web/`
  （见 `web_service.js` 的 `webDir = utils.resolvePath('../web')`）
- 删除空目录 `server/`
- `.gitignore` 补充 `core/lan/`，避免 11MB 的陶瓦二进制被误提交

---

## 七、文档滞后修正

用户反馈「文档检查修改，具有滞后性」。本次核对并修正：

| 文件 | 修正内容 |
|------|----------|
| `README.MD` | 项目结构图 `core/schemes/` → `scheme/`、移除 `server/`；安装步骤改为主推 `scheme create` |
| `docs/QUICKSTART.md` | 全部 `wow install <core>` 示例改为 `scheme create -t <core>`；Bukkit / Spigot / Folia / Sponge / Arclight 标注「暂不支持」；修正重复的工作流步骤与编号 |
| `docs/SCHEMES.md` | 方案目录路径 `core/schemes/` → `scheme/`；修正「清空 `server/`」等过期描述 |
| `docs/COMMANDS.md` | `install` 说明改为「服务端核心安装已移至 `scheme create`」；日志路径示例修正 |
| `docs/API.md` | 补齐本次新增的全部接口（文件管理 / 模组搜索 / 下载队列 / pool / plugins / logs / metrics / lan）与错误码 `403` `413` `502` |

---

## 八、验收测试

### 全页面 + 全 API 回归：29 项，零失败

```
--- 页面/静态资源 ---
✔ 200  /  /index.html  /dashboard.html  /down.html  /file.html  /lan.html
✔ 200  /left.html  /login.html  /right.html  /scheme.html  /set.html  /tool.html
✔ 200  /js/main.js  /css/main.css  /theme.json

--- API ---
✔ 200  /api/status  /api/config  /api/logs  /api/mods  /api/schemes  /api/themes
✔ 200  /api/files  /api/pool/stats  /api/plugins  /api/logs/analysis
✔ 200  /api/metrics  /api/download/status  /api/lan/status
✔ 200  /api/mod/search?source=modrinth&query=jei   （真实联网，返回 9.8KB 数据）
失败项: 0
```

### 安全测试（文件管理）

| 场景 | 结果 |
|------|------|
| `../` `../../` 穿越 | 403 拦截 |
| 符号链接逃逸 | 403 拦截 |
| 上传 `../../evil.sh` | 进 `skipped`，未落盘 |
| 下载无 token | 401 拒绝 |

### 模组搜索（真实联网）

| 请求 | 结果 |
|------|------|
| `?source=modrinth&query=sodium&loader=fabric` | 200，返回 Sodium / 245.2M 下载量 |
| `?source=modrinth&query=JEI` | 200 |
| `/api/mod/info?project=JEI` | 200，含 `dependencies` 依赖解析 |
| `?source=curseforge`（无 Key） | 400，明确指引配置 `api_keys.curseforge` |

---

## 九、兼容性说明

- **无破坏性变更**，所有修复向后兼容
- `scheme create` 用法不变
- File Manager 的路径根为**当前方案目录**；未激活方案时回退为 `scheme/` 容器目录
- CurseForge 搜索为可选项：在 `core/wow.yaml` 配置 `api_keys.curseforge` 后启用，不配则只用 Modrinth
