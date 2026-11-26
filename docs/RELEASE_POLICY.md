# 🚦 发版规则

> 这份文件定义了 wow~ 的发布节奏与发版动作边界。
> 若本文与其它文档冲突，以本文为准。

---

## 一、核心规则：攒够了再发，不由我主动发

**开发与发布解耦。** 修一个问题、加一个功能，都**不单独出版本**。

| 动作 | 谁来决定 | 说明 |
|------|----------|------|
| 改代码、改文档、跑测试 | 随时随地 | 不需要请示，正常迭代 |
| **升版本号** | **用户说「发行」时** | 之前一律不动 `version` 字段 |
| **打 git tag** | **用户说「发行」时** | |
| **双端推送 tag** | **用户说「发行」时** | |
| **创建 GitHub / Gitee Release** | **用户说「发行」时** | 含附件上传 |
| **生成并上传 `SHA256SUMS`** | **用户说「发行」时** | |

一句话：**在「发行」这个指令落地之前，远端仓库保持原样，不产生任何新 tag 或新 Release。**

---

## 二、非发行期间的工作流

代码仍然可以正常提交（commit），只是**不碰版本号、不打 tag、不发 Release**。

```bash
# 可以：正常提交改动
git add -A
git commit -m "feat: 隧道认证闸门"

# 可以：推送 commit（如果用户要求）
git push origin main

# 不可以（除非用户说了「发行」）：
#   - 修改 core/package.json 的 version
#   - git tag ...
#   - gh release create ...
#   - bash scripts/make-sha256sums.sh --upload
```

### 版本号怎么处理？

**不预支版本号。** 一个开发周期内可能累积若干条改动，全部堆在同一个「下一个版本号」下。
真正发行时，才一次性决定版本号、写 CHANGELOG、打 tag。

这样做的原因：预先升版本号会导致「版本号占用了但没发布」，中间态的
`wow -V` 输出会与远端实际可用版本不一致，用户升级时容易困惑。

### CHANGELOG 怎么记？

两种写法都可以，按习惯选：

- **先记**：改动完成就写进 CHANGELOG，标题先写「未发布」（Unreleased），发行时改成正式版本号
- **后记**：改动完成先不写，发行时回顾 commit 历史一次性补全

**推荐「先记」**——细节在改动当下最清楚，事后回忆容易丢要点。

---

## 三、收到「发行」指令时执行的动作清单

按顺序执行，不要跳步：

1. **确定版本号**，规则见 `other/CHANGELOG.md` 顶部说明
   （语义版本 + 年份后两位 + 十六进制发行包序号，例：`3.5.24-26.40`）
2. **一次性升版本号**：`core/src/cli.js`、`core/package.json`
   （`core/package-lock.json` 在 `.gitignore` 里，改不改都不影响仓库，建议同步改保持一致）
3. **整理 CHANGELOG**：把本周期所有改动合并成一条完整的版本条目，并更新顶部版本表
4. **全量回归**：`for f in core/test/*.test.js; do node "$f"; done`，必须全绿
5. **提交 + 打 tag**：`git commit` → `git tag -a v<版本号>`
6. **双端推送**：`git push origin main && git push origin <tag>`，Gitee 同理
7. **生成清单**：`bash scripts/make-sha256sums.sh v<版本号>`
8. **创建 Release**（GitHub 先建 Release，再传附件；脚本只能传附件不能建 Release）
9. **上传附件**：`SHA256SUMS` + 源码包
10. **端到端验证**：从 Release 真实下载源码包，核对哈希与 `SHA256SUMS` 一致

> ⚠️ 第 8 步的顺序很容易踩坑：`--upload` 会先找 Release，找不到就静默跳过并只打印一行
> 「先发布 Release 再上传附件」。所以必须先 `gh release create`，再传附件。

---

## 四、已知的坑（发版时会遇到）

| 坑 | 表现 | 处理 |
|----|------|------|
| GitHub token 认证头 | 用 `token` 头返回 `Bad credentials` | 必须用 `Authorization: Bearer <token>` |
| Release 附件上传接口 | REST 直接 POST 到 assets 返回 `Not Found` | 用 `gh release upload`，别手搓 API |
| GitHub 归档缓存延迟 | 刚推 tag 后下载到的可能是旧内容 | 独立核对包内 `cli.js` 的版本号，别只看哈希稳定 |
| Gitee Release 建不了 | OpenAPI 只认私人令牌（`access_token`），git remote 里的登录密码返回 401；网页端在无登录态的环境里也走不通 | 让用户给一个勾了 `projects` 权限的私人令牌，用它调 `POST /repos/{owner}/{repo}/releases` 建完再 `attach_files` |
| Gitee 网页登录二步验证 | 用 remote 内嵌密码走 Playwright 网页登录，提交后跳转 `/login/two-factor?verify_token=…`，要求邮箱/手机验证码；随后访问 `releases/new` 403 | 别在沙箱里硬闯 2FA。要么由用户临时提供验证码完成登录，要么直接用私人令牌走 OpenAPI；**优先令牌** |
| GitHub Release 漏传源码 zip | 附件只有 `SHA256SUMS`、缺 `wow-<tag>.zip`（v3.6.1 时两个都在），自动更新不受影响，手动下载的人拿不到包 | 发版后核对附件清单必须是 `SHA256SUMS` + `wow-<tag>.zip` 两项；补包用 `git archive --format=zip --prefix=wow-<tag>/ -o wow-<tag>.zip <tag>`，可复现历史包的字节 |
| Gitee 附件上传字段 | 直传会失败，`browser_download_url` 不返回 | `-F "access_token=…" -F "file=@<path>;filename=<附件名>"`，附件名要用 `filename=` 显式指定 |
| Gitee 同名附件不覆盖 | 重复上传 `SHA256SUMS` 会变成**两个同名附件**，`browser_download_url` 完全相同，下载时可能拿到旧的那份 | 上传前先删。注意 `GET /releases/tags/<tag>` 返回的 `assets` **没有 `id` 字段**，必须调 `GET /releases/{id}/attach_files` 才拿得到可删除的 id（`DELETE …/attach_files/{id}` 返回 204） |
| GitHub release 下载端点 504 | `releases/download/...` 直连频繁 504 / 传输中断 | 用 API 取 asset（`/releases/assets/<id>` + `Accept: application/octet-stream`），或走 `gh-proxy.com` 镜像 |
| GitHub 源码归档 404 | `archive/refs/tags/<tag>.zip` 直连偶发 404（缓存未生成） | 走 `gh-proxy.com` 镜像；下载后**必须**核对包内 `core/package.json` 的 version |

---

## 五、当前状态

- 已发布的最新版本：`v3.9.0-26.4d`（2026-11-26，Web 模组展示完善 + 单方案多存档与图标生态 + 多项稳定性修复）
- 上一版本：`v3.8.4-26.4c`（2026-11-21，🚨 紧急修复）
- 下一个序号是 `4e`（严格十六进制递增，见下方「序号纪律」）
- 本周期累积的改动：见 `git log v3.8.4-26.4c..HEAD`
- 本版发行进度见下方「本版发行进度（v3.9.0-26.4d）」表
- 本周期已发行内容（合并为 **v3.8.4-26.4c**，2026-11-21 — 🚨 紧急修复）：
  1. **`:mc` 检测进程退出并回到 `:wow`**：`cli.js` `stopFollow()` 三重守卫下先 `setView('WOW')` 再 `printLine`，提示符由 `view_state` onChange 订阅自动恢复；`mc_console.js` `_follow()` 每 10 tick（约 3s）用跨进程 `isRunning()` 降频检测退出，判死走 `_finish('mc.console:server-exit')` 优雅离开并清半行。刻意不用心跳检测，避免「服务器在跑但无中继」被误踢。
  2. **Web 连接/断开日志只在 `:wow`**：`web_service.js` 新增 `shouldPrintToTerminal()` 精确闸门，仅 `:wow` 且 TUI 未占屏才打终端，其余视图静默；日志仍落全局文件。
  3. **浏览器日志提速**：服务端 tail 轮询 250ms→100ms；前端 `dashboard.html` `appendConsole` 改 `requestAnimationFrame` 攒批，一帧一次 DOM 重建，两端逐字节同步。
  4. 测试同步：`mc_console`/`input_routing_p0`/`interactive_menu`/`web_pages` 断言按新逻辑更新；全量回归 **75 文件全绿**，运行时验证 **7/7**。
- 上一周期已发行内容（合并为 **v3.8.3-26.4b**，2026-11-18）：
  1. **公测前第三方破坏性测试整改**：终端输入路由（`:mc` MC 指令原样转发、日志/菜单事件隔离）、
     退出状态机重构（唯一 `intendedShutdown` 意图、非主动退出退码 0 也诊断）、崩溃诊断三层防误报
     （signal 判定 + `.manual-stop.flag` + 颜色码剔除 + `jna/oshi/sun` 忽略）、
     `:mc` 刷屏保存并回填 `rl.line` 不吞半行输入；第三方审查 7 项（路径穿越 / sha256 校验 /
     流 error 兜底 / Windows execSync / FD 关闭）。
  2. **资源池统一安装 + 精确版本**：恢复 `install core/mod/plugin` 落盘到 `pool/` 不建方案、
     废弃 `mod install`；Web 装模组走 `dep_resolver` 递归拉依赖；前端选中版本经 `--version-id`
     贯通到直链，禁止后端自动挑版；`saveConfig()` 异常上抛（EACCES 明确提示）。
  3. **Web 上传加固**：`/api/upload` 全量缓存改流式落盘 + 并发闸门（≤3），
     复用路径校验，实测单/多文件 / boundary 跨分块 / 4MB 背压 / 路径穿越 / 并发排队全通过。
  4. **功能**：`wow :mc` 顶层控制台命令、token 每次启动轮换、`init` 自愈体检中心 + Web
     傻瓜式引导、实例配置 16 键中文翻译、Web 页面与 TERMS 文档微调。
  5. 新增 8+ 测试文件；全量回归 **75 个测试文件全绿**，流式上传真实 HTTP 端到端 **12/12**。
- 上一周期已发行内容（合并为 **v3.8.2-26.4a**，2026-11-15）：
  1. **公测前全量真实环境测试 Bug 修复清单**（P0 六项 / P1 六项 / P2 六项，
     详见 `other/CHANGELOG.md` `[3.8.2-26.4a]` 章节）：`server stop` 防误杀防误报
     （5s 轮询 / 30s 强杀 / 143·137 绝不触发崩溃诊断）、`:mc` 防假死（不以日志静默判退出）、
     整合包 CF manifest 规范、Clone-Client EACCES 单独标记、镜像优先、Modrinth 解析与
     全方案 `mod list`、`wow -v`、布尔切换、存档检测、`wow.md` 文档白名单等。
  2. **主题包更新机制**（`core/src/theme_updater.js`）：`theme.json` 的 `update_url` 源解析
     （Git 仓库转 API / 通用直链跟随重定向）、备份-校验-回滚「防炸机」红线、Zip Slip 复用、
     30s 超时、CLI `theme update` 与 Web「检查更新」按钮。
  3. 新增 `theme_update.test.js`（27 项）；全量回归 **67 个测试文件全绿**。
  4. 冻结期纪律：未触碰 readline / TUI 渲染层；`docs/wow.md` 原文一字未改。
- 上一周期已发行内容（合并为 **v3.8.0-26.48**，2026-11-14）：
  1. **尚书省 3.8.0 模组/插件生态与玩家管理完善令**（11-14）：下载中心重构
     （Modrinth 默认优先 + 类别/版本/加载器筛选 + 新增插件搜索 Tab +
     选方案安装弹窗 + 自动解析依赖）、玩家追踪与名单管理（日志尾部回溯 +
     `known_players` + CLI `config players` + Web 玩家管理卡片）、
     三条铁律（运行时名单走 stdin / 依赖递归 ≤3 层超时降级 / 日志禁止整文件读）。
  2. **术语彻底改名：wow插件 → wow扩展**（11-14）：含代码标识符在内的全仓改名，
     Minecraft 服务端 `plugins/`（Bukkit/Paper）保持「插件」不变；
     `plugin` 保留为 CLI 隐藏别名以防外部脚本断。
  3. 新增 `mod_search` / `dep_resolver` / `content_installer` / `player_manager` /
     `player_tracker` 等单测，全量回归 **64 个文件全绿**（76.8s）。
- 本周期已发行内容（合并为 **v3.8.1-26.49**，2026-11-14）：
  1. **Web 面板内置帮助文档抽屉**（11-14）：右上角 📖 入口（便签栏 + 左侧菜单双入口），
     顶层右侧滑出抽屉（左目录 + 右 Markdown 渲染，独立滚动、Esc/遮罩/X 关闭）；
     `marked@12` + `DOMPurify@3` 本地化到 `web/js/vendor/`，渲染必经清洗、库缺失降级；
     后端 `web_docs.js` 写死 18 篇文档白名单，`name` 只作查表 key 绝不拼路径、非法 403、
     13 种路径穿越全拦；外链强 `target=_blank` + `rel=noopener noreferrer`。
  2. **Web 内容页统一留白（不贴边）**（11-14）：内容页 `body` 统一 `padding:20px 24px`，
     `shell`/`no-scroll` 排除；`down`/`tool`/`lan`/`login` 清掉零散 margin，主题副本逐字节同步。
  3. **移动端菜单抽屉**（11-14）：修掉旧 `≤768px` 断点把左菜单压成 50px 且 `scrolling=no`、
     10 个导航项被裁掉无法滚动的致命问题——移动端顶栏常驻 `☰`/`便签` 唤出左右抽屉、遮罩关闭、
     选中菜单项自动收起；桌面三栏布局不变（菜单 220px / 便签 280px）。
  4. 新增 `web_docs` / `web_docs_http` 单测与 `web_pages` 移动端断言；全量回归
     **66 个测试文件全绿**。
- 上一周期已发行内容（六项合并为 **v3.7.4-26.47**，2026-11-13）：
  1. **readline 收归单例**（11-10）：`core/src/stdin_session.js` 全项目唯一
     消费者，三层防线（唯一出口 / 运行时不变式 / 全局创建守卫）。
  2. **3.7.0 视图重构与功能补丁执行令**（11-12）：五大视图状态机 +
     `web.require_login` / `log.disabled` 两个配置项 + 公网强制登录 +
     日志统一闸门 `log_sink.js` + 文件管理 `isDir` 修复 + 陶瓦真加入房间 +
     `set.html` 推倒重写 + `shutdown.js` 防僵尸 + 4 场景 pty 实测回归。
  3. **Web 安全加固两指令**（11-13）：危险开关在非本机访问时物理隐藏 +
     `/api/config`、`/api/config/batch` 后端 403 二次拦截
     （`core/src/web_security.js`）；新增 `web.trust_proxy` 反代声明位；
     备用钥匙密码登录三接口（`auth/config` / `login-password` /
     `set-password`）+ 5 次/15 分钟 IP 限流 + 验证码 CSPRNG。
     新增 4 个测试文件（`aa_web_security` 37 项、`web_security_static` 22 项、
     `danger_guard_e2e` 16 项、`password_auth_e2e` 21 项）。
  4. **TUI 菜单扁平化**（11-13）：删除 `W1`/`R1`/`T1`/`Y1` 四个聚合入口，
     把 `dispatchMenu` 里 10 张 `请选择 (0-N)` 子菜单全部拆成页内独立项与
     模块级具名动作函数；`PAGES` 的 `legacy` 字段、跨页编号解析、
     `tui.js` 的「旧 xx」渲染一并移除。菜单只剩一层：看到编号 = 最终动作。
     新增 `menu_flat.test.js`（22 项契约）。
  5. **R8 / R10 修复**（11-13）：R10「Web 面板启动 / 停止」原先解构缺 `env`
     导致 `ReferenceError` 被吞、且用 `isRunning()`（仅本进程内存）误判跨进程
     面板；R8「服务器端口与外网可见性」补读 `server-ip` 与监听范围判定。
     `menu_flat.test.js` 扩到 27 项。
  6. **`file.html` 工具栏 `margin: px;` 缺值**（11-13）：补为 `margin: 12px 0`。
- 上一周期全量回归：`npm test` **54 个文件全绿**（75.9s），`WOW_PTY_STRICT=1`
  严格模式 13 项全过。本周期回归见上（64 个文件）。

### 本版发行进度（v3.9.0-26.4d，2026-11-26 — Web 模组展示 + 多存档 + 稳定性）

| 步骤 | 状态 |
|------|------|
| 版本号确定 `v3.9.0-26.4d`（用户指定语义版本 3.9.0，序号 4c→4d 十六进制递增） | ✅ |
| 升版本号（cli.js / package.json / tui.js / package-lock.json） | ✅ 实测 `wow -V` 输出 `3.9.0-26.4d` |
| CHANGELOG `[3.9.0-26.4d]` 五大节 + 版本表更新，「未发版」字样清零 | ✅ |
| 全量回归 `npm test` | ✅ 86 文件全绿（85.9s） |
| commit + tag | ✅ `a30413d` / `v3.9.0-26.4d`（annotated，指向 a30413d） |
| 双端推送 main + tag | ✅ GitHub + Gitee 均成功 |
| 打包 `wow-v3.9.0-26.4d.zip` + SHA256SUMS | ✅ 1,125,235 B，包内 version `3.9.0-26.4d`；两端归档哈希与清单精确一致 |
| GitHub Release + 双附件 + latest | ✅ 双附件（`SHA256SUMS` + `wow-v3.9.0-26.4d.zip`），latest 指向本版 |
| Gitee Release + 双附件 + latest | ✅ id `1372849`，双附件（`SHA256SUMS` + `wow-v3.9.0-26.4d.zip`），latest 指向本版（私人令牌 OpenAPI） |
| GitHub 端到端核对 | ✅ 附件真实下载字节与本地一致、包内 version `3.9.0-26.4d`、latest 指向本版 |
| Gitee 端到端核对 + 三端对齐 | ✅ 匿名下载附件字节与本地一致、包内 version `3.9.0-26.4d`；本地 / Gitee / GitHub 三端 tag `v3.9.0-26.4d` 同指 `a30413d` |

> 说明：Gitee 用用户提供的私人令牌（归属 `nuoge233`）经 OpenAPI 建 Release + 传附件；
> 令牌仅在本次会话的临时目录出现、未写入仓库，发版完成后已立即清理。该令牌此前已多次明文出现，
> 建议用完后在 Gitee 设置撤销并重新生成。

### 上一版发行进度（v3.8.4-26.4c，2026-11-21 — 🚨 紧急修复）

| 步骤 | 状态 |
|------|------|
| 版本号确定 `v3.8.4-26.4c`（紧急修复定性；patch 位 +1、序号 4b→4c 严格十六进制递增，用户拍板） | ✅ |
| 升版本号（cli.js / package.json / tui.js / package-lock.json） | ✅ |
| CHANGELOG 新增 `[3.8.4-26.4c]` 紧急修复章节 + 版本表更新 | ✅ |
| 全量回归 75 文件 | ✅ 全绿 |
| 运行时视图闸门与存活检测验证 | ✅ 7/7 |
| commit + tag | ✅ `4e3a678` / `v3.8.4-26.4c`（annotated，三端 tag object 一致 `726e586`） |
| 双端推送 main + tag | ✅ GitHub（GnuTLS 重置重试 3 次成功）+ Gitee 均成功 |
| 打包 `wow-v3.8.4-26.4c.zip` + SHA256SUMS | ✅ 1,054,830 B，包内 version `3.8.4-26.4c`，排除文件未泄漏；清单双端归档哈希（GitHub `33f6f880…` / Gitee `7ab19e54…`） |
| GitHub Release + 双附件 | ✅ id `RE_kwDOTjF9W84bAAjd`（databaseId 见附件 772702076/77），`SHA256SUMS` + `wow-v3.8.4-26.4c.zip`，`latest` 指向本版 |
| Gitee Release + 双附件 | ✅ id `1340500`，`SHA256SUMS` + `wow-v3.8.4-26.4c.zip`，`latest` 指向本版（私人令牌 OpenAPI） |
| 端到端核对 + 三端对齐 | ✅ 两端清单字节与本地一致；两端归档实测哈希与清单精确匹配；包内 version `3.8.4-26.4c`；本地/Gitee/GitHub 三端 main `4e3a678` 一致 |

> 说明：Gitee 用用户提供的私人令牌（归属 `nuoge233`）经 OpenAPI 建 Release + 传附件；
> 令牌仅在本次会话的临时目录出现、未写入仓库，发版完成后已立即清理，建议用完后在 Gitee 设置撤销并重新生成。

### 本版发行进度（v3.8.3-26.4b，2026-11-18）

| 步骤 | 状态 |
|------|------|
| 版本号确定 `v3.8.3-26.4b`（序号 4a→4b 严格十六进制递增，用户拍板 patch 位） | ✅ |
| 升版本号（cli.js / package.json / tui.js / package-lock.json） | ✅ |
| CHANGELOG 新增 `[3.8.3-26.4b]` 章节（合并本周期 11 条提交）+ 版本表更新 | ✅ 四节（P0 / P1 / 功能 / 测试） |
| 全量回归 75 文件 | ✅ 82.7s 全绿 |
| 流式上传真实 HTTP 端到端 | ✅ 12/12（单/多文件、boundary 跨分块、4MB 背压、路径穿越、并发排队） |
| commit + tag | ✅ `8b51937` / `v3.8.3-26.4b`（annotated，双端 tag object 一致 `fdf31f1a`） |
| 双端推送 main + tag | ✅ GitHub + Gitee 均成功 |
| 打包 `wow-v3.8.3-26.4b.zip` | ✅ 1,052,367 B，包内 version `3.8.3-26.4b`，排除文件未泄漏 |
| SHA256SUMS 生成 | ✅ 187 B；两端归档哈希（GitHub 走 gh-proxy 镜像、Gitee 直连）均两次一致采信 |
| GitHub Release + 双附件 | ✅ id `450176003`，`SHA256SUMS` + `wow-v3.8.3-26.4b.zip`，`latest` 指向本版 |
| Gitee Release + 双附件 | ✅ id `1325308`，`SHA256SUMS` + `wow-v3.8.3-26.4b.zip`，`latest` 指向本版（私人令牌 OpenAPI；平台另附 tag 源码包 2 项属正常） |
| 端到端核对 | ✅ 两端清单字节与本地一致；两端源码归档实测哈希与清单精确匹配；包内 version `3.8.3-26.4b` |
| 三端对齐 | ✅ 本地 / Gitee / GitHub 均为 `8b51937` |

> 说明：Gitee 用用户提供的私人令牌（归属 `nuoge233`）经 OpenAPI 建 Release + 传附件；
> 令牌仅在本次对话中明文出现、未写入仓库，建议用完后在 Gitee 设置撤销并重新生成。

### 本版发行进度（v3.8.0-26.48，2026-11-14）

| 步骤 | 状态 |
|------|------|
| 升版本号（cli.js / package.json / package-lock.json / tui.js 注释） | ✅ `3.8.0-26.48` |
| CHANGELOG 新增 `[3.8.0-26.48]` 章节 + 版本表更新 | ✅ 四节（P0 / P1 / 铁律 / 改名） |
| 全量回归 64 文件 | ✅ 76.8s 全绿（发版后二次复核同样 64 文件全绿） |
| `docs/RELEASE_POLICY.md` 与 `TUI.md` 排除出发行包 | ✅ `.gitattributes` export-ignore |
| commit + tag | ✅ `9deeeed` / `v3.8.0-26.48` |
| 双端推送 main + tag | ✅ GitHub（`http.version=HTTP/1.1`）、Gitee 均成功 |
| 源码附件 zip | ✅ `wow-v3.8.0-26.48.zip`（911 KB，包内 `version` 已核对） |
| SHA256SUMS | ✅ 两行（GitHub + Gitee 源码归档），两端归档哈希实测一致 |
| GitHub Release + 双附件 + latest | ✅ 附件 `SHA256SUMS` + `wow-v3.8.0-26.48.zip`；`latest` 已指向本版 |
| 端到端核对 | ✅ GitHub 归档经 gh-proxy 下载，包内 version `3.8.0-26.48`，哈希 `397e30d5…` 与清单一致；Gitee 归档 `8f116da1…` 一致 |
| 发版后二次复核 | ✅ `gh release download` 取回 GitHub 两附件；Gitee 匿名下载 `SHA256SUMS`（187 B）与 zip（931,875 B）均与本地字节一致；两端清单字节相同；源码包 `8f116da1…` 与本地打包件一致；包内 version `3.8.0-26.48`；`RELEASE_POLICY.md` / `TUI.md` / `core/test/` / `scripts/` 均未泄漏；两端 `latest` 均指向本版 |
| **Gitee Release** | ✅ id `1308707`，`SHA256SUMS` + `wow-v3.8.0-26.48.zip` 双附件，`latest` 指向本版；用户提供私人令牌后由 OpenAPI 补齐（网页登录二步验证走不通，详见下方） |

> 🕳 **本版 Gitee 阻塞与解法（已解决）**：
> 1. `git remote get-url gitee` 里的是 17 位**登录密码**，
>    `GET /releases/tags/<tag>?access_token=…` 直接 `401 Access token does not exist`；
>    Basic Auth 调 `/api/v5/user` 同样 401。
> 2. 改用 Playwright 走**网页端登录**：密码提交后被重定向到
>    `/login/two-factor?verify_token=…`，提示「当前帐号存在异常登录行为」并要求发送
>    邮箱/手机验证码；无登录态访问 `releases/new` 返回 403。沙箱无法接收验证码。
> 3. ✅ **最终解法**：由用户提供勾了 `projects` 权限的 Gitee 私人令牌，
>    `POST /repos/nuoge233/wow/releases`（带 `target_commitish=main`）创建 Release
>    （id `1308707`，说明正文与 GitHub 一致），再用 `attach_files` 上传
>    `SHA256SUMS` + `wow-v3.8.0-26.48.zip`（`filename=` 显式指定附件名）；
>    匿名下载两附件与本地字节一致，`releases/latest` 已指向本版。
>
> Gitee 会**自动额外附带** `v3.8.0-26.48.zip` / `.tar.gz` 两个 tag 源码包，
> 属于平台行为（故附件列表共 4 项），不影响 `update.sh` 按 `SHA256SUMS` 校验的链路。
>
> ⚠️ 令牌仅从环境变量读取、未写入仓库；因其在对话中明文出现，
> 建议用完后在 Gitee 设置里撤销并重新生成，不要长期复用。

### 上一版发行进度（v3.7.4-26.47，2026-11-13）

| 步骤 | 状态 |
|------|------|
| 升版本号（cli.js / package.json / package-lock.json / tui.js 注释） | ✅ `3.7.4-26.47` |
| CHANGELOG 四条 `[待发行]` 合并为 `[3.7.4-26.47]`，版本表更新 | ✅ 「待发行」字样清零 |
| 全量回归 54 文件 | ✅ 75.9s 全绿 |
| pty 严格回归 | ✅ `WOW_PTY_STRICT=1` 13 项全过，4 场景 `peak<=1 violations=0` |
| commit + tag | ✅ `dbafb9f` / `v3.7.4-26.47` |
| 双端推送 | ✅ GitHub（`http.version=HTTP/1.1` + `postBuffer` 绕开 GnuTLS 重置）、Gitee 均成功 |
| 打包 `wow-v3.7.4-26.47.zip` | ✅ 910,626 B，包内 version 已核对 |
| GitHub Release + 附件 | ✅ id 直读 `releases/latest` 校验，zip + SHA256SUMS 双附件 |
| Gitee Release + 附件 | ✅ id `1305652`，zip + SHA256SUMS 双附件（新建时须带 `target_commitish`） |
| SHA256SUMS 生成 | ✅ 187 B；GitHub 归档经 gh-proxy / ghfast 两镜像复算一致 |
| 端到端下载核对 | ✅ 两端 zip 同为 `3cc40dd9…`；两端清单字节相同（`4de437dc…`）；两端 `latest` 已指向本版 |

> 🕳 **Gitee token 的坑（本版踩到）**：git remote 里内嵌的是**登录密码**（17 位），
> `POST /releases` 会返回 `401 Access token does not exist`。
> 建 Release / 传附件必须用**勾了 `projects` + `releases` 权限的私人令牌**
> （32 位十六进制），且 `POST /releases` 必须带 `target_commitish`，否则
> 返回 `400 target_commitish is missing`。

### 本版发行进度（v3.7.3-26.46，2026-11-09）

| 步骤 | 状态 |
|------|------|
| 升版本号（cli.js / package.json / tui.js 注释） | ✅ `3.7.3-26.46`（`package-lock.json` 被 gitignore，不入库） |
| CHANGELOG 新增 3.7.3 章节 + 版本表更新 | ✅ 含「一条被证伪的隐患」记录 |
| 全量回归 40 文件 | ✅ 37.4s 全绿 |
| 浏览器实测三项 | ✅ `/api/files` 重复 scheme → 200；props 页 19 项中文翻译 100%；仪表盘 CPU/内存/时长正常 |
| commit + tag | ✅ `d0d5265` / `v3.7.3-26.46` |
| 双端推送 | ✅ GitHub（`http.version=HTTP/1.1` 绕开 GnuTLS 重置）、Gitee 均成功 |
| 打包 `wow-v3.7.3-26.46.zip` | ✅ 839,841 B，包内 version 已核对 |
| GitHub Release + 附件 | ✅ id `439133389`，zip + SHA256SUMS 双附件 |
| Gitee Release + 附件 | ✅ id `1291385`，zip + SHA256SUMS 双附件 |
| SHA256SUMS 生成 | ✅ 187 B；GitHub 归档经 gh-proxy / ghfast **两个独立镜像**复算一致 |
| 端到端下载核对 | ✅ 两端清单字节相同（`f7ca57b0…`）；Gitee zip 与本地打包件同哈希；两端 `latest` 已指向本版 |

### 上一周期已发行（v3.7.3-26.46）

| 内容 | 文档 | 测试 |
|------|------|------|
| M 模式画面独占：`tui.markScreenActive()` 闸门 | `docs/COMMANDS.md` | `core/test/tui_screen_gate.test.js`（10 项） |
| 菜单期间摘掉 Ctrl+C 停服、退出时装回 | `docs/COMMANDS.md` | 同上 |
| 退出确认 `toUpperCase() === 'Y'` | — | 同上 |
| `/api/files` 重复 scheme → `withScheme` 幂等 + 后端 `pickParam()` | `other/CHANGELOG.md` | 实测 `?scheme=A&scheme=A` 三连均 200 |
| 实例配置页 47 键中文翻译（`props_docs.js`） | `other/CHANGELOG.md` | 浏览器实测覆盖 100% |
| 仪表盘指标归零：`stdio` 改 pipe + 手动写 logStream | `other/CHANGELOG.md` | 实测 `cpu 0.1% / mem 3.7MB / uptime 2m17s` |

### 本版发行进度（v3.7.2-26.45，2026-11-08）

| 步骤 | 状态 |
|------|------|
| 升版本号（cli.js / package.json / tui.js 注释） | ✅ `3.7.2-26.45`（`package-lock.json` 被 gitignore，不入库） |
| CHANGELOG 新增 3.7.2 章节 + 版本表更新 | ✅ |
| 全量回归 39 文件 | ✅ 连跑三次均 37.1~37.3s，全绿 |
| pty 逐键实测 | ✅ 六页顺号 / 跨页旧编号 / 非法编号 / 日志跟踪 / 一次回车返回 |
| commit + tag + 双端推送 | ✅ `8583ea6`，两端 tag `6086836` 一致（GitHub 首次推送连接被重置，重试成功） |
| 打包 `wow-v3.7.2-26.45.zip` | ✅ 831,130 B，包内 version 已核对 |
| SHA256SUMS 生成 | ✅ 两份归档哈希均已复算（github 走 gh-proxy 镜像） |
| GitHub Release + 附件 | ✅ [v3.7.2-26.45](https://github.com/nuoge2333/Wow-/releases/tag/v3.7.2-26.45) |
| Gitee Release + 附件 | ✅ [v3.7.2-26.45](https://gitee.com/nuoge233/wow/releases/tag/v3.7.2-26.45)（id `1288326`） |
| 端到端下载核对 | ✅ 两端 zip 均为 `4b1fa7fa…`；两端清单字节相同；两端 `releases/latest` 已指向本版 |

### 上一周期已发行（v3.7.2-26.45）

| 内容 | 文档 | 测试 |
|------|------|------|
| M 模式每页编号改为 1,2,3… 顺号（`legacy` 兼容旧编号） | `docs/COMMANDS.md` | `core/test/tui_mode.test.js`（72 项） |
| `resolveNumber()` 三层解析（本页序号 → 本页旧编号 → 跨页旧编号） | `docs/COMMANDS.md` | 同上 |
| 70 列内排版：标签/备注按预算截断，编号列完整 | `docs/COMMANDS.md` | pty 逐页宽度实测 |
| `askLine` 前 `stdin.resume()`，修「返回要按两次回车」 | `docs/COMMANDS.md` | pty 实测 |
| 编号相关两条旧断言同步到新编号 | — | `core/test/interactive_menu.test.js` |

### 序号纪律

`26.40` 是新的干净起点，`40` → `41` → `42` → `43` → `44` → `45` 一路递增下来。
继续保持**严格十六进制递增**，具体约束：

- 下一个是 `47`，之后 `48` … — 正常十六进制递增，**不要跳过中间值**
- **绝不回绕复用**旧序号。历史上 `26.3a` ~ `26.3f` 因反复回绕被用了 2～3 次，
  导致无法用序号判断版本新旧，详见 `other/CHANGELOG.md` 文首说明
- 发版前先 `git tag --list | grep <候选序号>` 确认未被占用
