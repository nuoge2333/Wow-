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

1. **确定版本号**，规则见 `docs/CHANGELOG.md` 顶部说明
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
| GitHub Release 漏传源码 zip | 附件只有 `SHA256SUMS`、缺 `wow-<tag>.zip`（v3.6.1 时两个都在），自动更新不受影响，手动下载的人拿不到包 | 发版后核对附件清单必须是 `SHA256SUMS` + `wow-<tag>.zip` 两项；补包用 `git archive --format=zip --prefix=wow-<tag>/ -o wow-<tag>.zip <tag>`，可复现历史包的字节 |
| Gitee 附件上传字段 | 直传会失败，`browser_download_url` 不返回 | `-F "access_token=…" -F "file=@<path>;filename=<附件名>"`，附件名要用 `filename=` 显式指定 |
| Gitee 同名附件不覆盖 | 重复上传 `SHA256SUMS` 会变成**两个同名附件**，`browser_download_url` 完全相同，下载时可能拿到旧的那份 | 上传前先删。注意 `GET /releases/tags/<tag>` 返回的 `assets` **没有 `id` 字段**，必须调 `GET /releases/{id}/attach_files` 才拿得到可删除的 id（`DELETE …/attach_files/{id}` 返回 204） |
| GitHub release 下载端点 504 | `releases/download/...` 直连频繁 504 / 传输中断 | 用 API 取 asset（`/releases/assets/<id>` + `Accept: application/octet-stream`），或走 `gh-proxy.com` 镜像 |
| GitHub 源码归档 404 | `archive/refs/tags/<tag>.zip` 直连偶发 404（缓存未生成） | 走 `gh-proxy.com` 镜像；下载后**必须**核对包内 `core/package.json` 的 version |

---

## 五、当前状态

- 已发布的最新版本：`v3.7.3-26.46`（2026-11-09）
- **下一个版本号尚未确定**，等用户说「发行」时再定
- 下一周期累积的改动：见 `git log v3.7.3-26.46..HEAD`
- 待发行改动摘要（截至 2026-11-13，四批合并累积在**同一待发行版本**下）：
  1. **readline 收归单例**（11-10）：`core/src/stdin_session.js` 全项目唯一
     消费者，三层防线（唯一出口 / 运行时不变式 / 全局创建守卫）。
  2. **3.7.0 视图重构与功能补丁执行令**（11-12）：五大视图状态机 +
     `web.require_login` / `log.disabled` 两个配置项 + 公网强制登录 +
     日志统一闸门 `log_sink.js` + 文件管理 `isDir` 修复 + 陶瓦真加入房间 +
     `set.html` 推倒重写 + `shutdown.js` 防僵尸 + 4 场景 pty 实测回归。
     `npm test` **49 个文件全绿**（72.5s），`WOW_PTY_STRICT=1` 严格模式
     13 项全过。详见 `docs/CHANGELOG.md` 的 `[待发行]` 章节。
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
     新增 `menu_flat.test.js`（22 项契约）。`npm test` **54 个文件全绿**（76.0s）。

### 本版发行进度（v3.7.3-26.46，2026-11-09）

| 步骤 | 状态 |
|------|------|
| 升版本号（cli.js / package.json / tui.js 注释 / docs/TUI.md） | ✅ `3.7.3-26.46`（`package-lock.json` 被 gitignore，不入库） |
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
| M 模式画面独占：`tui.markScreenActive()` 闸门 | `docs/TUI.md` | `core/test/tui_screen_gate.test.js`（10 项） |
| 菜单期间摘掉 Ctrl+C 停服、退出时装回 | `docs/TUI.md` | 同上 |
| 退出确认 `toUpperCase() === 'Y'` | — | 同上 |
| `/api/files` 重复 scheme → `withScheme` 幂等 + 后端 `pickParam()` | `docs/CHANGELOG.md` | 实测 `?scheme=A&scheme=A` 三连均 200 |
| 实例配置页 47 键中文翻译（`props_docs.js`） | `docs/CHANGELOG.md` | 浏览器实测覆盖 100% |
| 仪表盘指标归零：`stdio` 改 pipe + 手动写 logStream | `docs/CHANGELOG.md` | 实测 `cpu 0.1% / mem 3.7MB / uptime 2m17s` |

### 本版发行进度（v3.7.2-26.45，2026-11-08）

| 步骤 | 状态 |
|------|------|
| 升版本号（cli.js / package.json / tui.js 注释 / docs/TUI.md） | ✅ `3.7.2-26.45`（`package-lock.json` 被 gitignore，不入库） |
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
| M 模式每页编号改为 1,2,3… 顺号（`legacy` 兼容旧编号） | `docs/TUI.md` | `core/test/tui_mode.test.js`（72 项） |
| `resolveNumber()` 三层解析（本页序号 → 本页旧编号 → 跨页旧编号） | `docs/TUI.md` | 同上 |
| 70 列内排版：标签/备注按预算截断，编号列完整 | `docs/TUI.md` | pty 逐页宽度实测 |
| `askLine` 前 `stdin.resume()`，修「返回要按两次回车」 | `docs/TUI.md` | pty 实测 |
| 编号相关两条旧断言同步到新编号 | — | `core/test/interactive_menu.test.js` |

### 序号纪律

`26.40` 是新的干净起点，`40` → `41` → `42` → `43` → `44` → `45` 一路递增下来。
继续保持**严格十六进制递增**，具体约束：

- 下一个是 `47`，之后 `48` … — 正常十六进制递增，**不要跳过中间值**
- **绝不回绕复用**旧序号。历史上 `26.3a` ~ `26.3f` 因反复回绕被用了 2～3 次，
  导致无法用序号判断版本新旧，详见 `docs/CHANGELOG.md` 文首说明
- 发版前先 `git tag --list | grep <候选序号>` 确认未被占用
