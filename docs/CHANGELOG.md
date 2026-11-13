# 📋 更新日志

> wow~ 项目版本历史记录

---

## 版本号规则

版本号形如 `3.5.24-26.40`，由「语义版本」+「年份后两位」+「十六进制发行包序号」三段组成：

| 段 | 例 | 说明 |
|----|----|------|
| 语义版本 | `3.5.24` | 功能迭代用 minor 位，补丁用 patch 位 |
| 年份 | `26` | 2026 年的后两位 |
| 序号 | `40` | 当年的发行包序号，**十六进制递增**：`…38` → `39` → `3a` → `3b` … |

> ### ⚠️ 关于 2026 年 9～10 月期间的序号重复
>
> 序号本意是「十六进制连续递增、全局唯一」，但实际发布过程中出现过三次断点与回绕，
> 导致 `26.3a` ～ `26.3f` 这几个值被重复使用：
>
> | 时间段 | 序号轨迹 | 问题 |
> |--------|----------|------|
> | 09-26 ~ 10-16 | `26.27` → `26.29` → `26.3a` → … → `26.3e` → `26.3f` | 从 `3a` 正常走到 `3f` |
> | 10-16 ~ 10-20 | `26.3f` → **`26.31`** | 从 `3f` 跳回 `31`，**`30` 与 `3a`~`3f` 段与上一轮撞车** |
> | 10-20 ~ 10-31 | `26.31` → `26.32` → … → `26.38` → `26.39` | 正常递增 |
> | 11-01 | `26.39` → **`26.3a`** | 理论上正确（`39` 之后确实是 `3a`），但 `3a`~`3f` **第三次被使用** |
> | 11-01 ~ 11-03 | `26.3a` → `26.3b` → `26.3d` → `26.3e` → `26.3f` | `3c` 被跳过，`3d`~`3f` 再次撞车 |
>
> **结论：`26.3a` ~ `26.3f` 这段值不可信，不能用来判断版本新旧。**
>
> 从 `3.5.24` 起采用 **`26.40`**：`0x40` 直接跨过已被污染的 `3a`～`3f` 整段，
> 从干净的新段重新开始，此后**严格十六进制递增，不再回绕、不再跳号**。
>
> 推论：`26.39` 之后的下一个正确值是 `26.40`（而非 `26.3a`）。
> 若拿不准某个历史版本的新旧，请以 `git tag` 的创建时间或 CHANGELOG 的发布日期为准，
> **不要比较序号字符串**。

---

## 版本说明

| 版本 | 状态 | 发布时间 |
|------|------|------|
| **待发行** | 累积改动：readline 单例 + 3.7.0 视图重构 + 危险开关锁定 + 备用钥匙密码登录 + TUI 菜单扁平化（版本号待定） | — |
| **3.7.3-26.46** | 当前版本（M 模式画面独占 + 三处线上问题） | 2026-11-09 |
| **3.7.2-26.45** | 上一版本 |2026-11-08|
| **3.7.1-26.44** | 上一版本 |2026-11-08|
| **3.7.0-26.43** | 上一版本 |2026-11-08|
| **3.6.1-26.42** | 上一版本 |2026-11-07|
| **3.6.0-26.41** | 上一版本 |2026-11-06|
| **3.5.24-26.40** | 上一版本 |2026-11-03|
| **3.5.23-26.3e** | 上一版本 |2026-11-01|
| **3.5.22-26.3d** | 上一版本 |2026-11-02|
| **3.5.21-26.3c** | 上一版本 |2026-11-02|
| **3.5.20-26.3b** | 上一版本 |2026-11-01|
| **3.5.19-26.3a** | 上一版本 |2026-10-31|
| **3.5.18-26.39** | 上一版本 |2026-10-31|
| **3.5.17-26.38** | 上一版本 |2026-10-31|
| **3.5.16-26.37** | 上一版本 |2026-10-30|
| **3.5.15-26.36** | 上一版本 |2026-10-24|
| **3.5.14-26.35** | 上一版本 |2026-10-24|
| **3.5.13-26.34** | 上一版本 |2026-10-24|
| **3.5.12-26.33** | 上一版本 |2026-10-24|
| **3.5.11-26.32** | 上一版本 |2026-10-21|
| **3.5.10-26.31** | 上一版本 |2026-10-20|
| **3.5.9-26.30** | 上一版本 |2026-10-18|
| **3.5.8-26.2f** | 上一版本 |2026-10-17|
| **3.5.7-26.2e** | 上一版本 |2026-10-16|
| **3.5.6-26.2d** | 上一版本 |2026-10-15|
| **3.5.5-26.2c** | 上一版本 |2026-10-14|
| **3.5.4-26.2b** | 上一版本 |2026-10-12|
| **3.5.3-26.2a** | 上一版本 |2026-10-04|
| **3.5.2-26.29** | 上一版本 |2026-09-26|
| **3.5.1-26.28** | 上一版本 |2026-09-26|
| **3.5.0-26.27** | 上一版本 |2026-09-26|
| **3.4.12** | 上一版本 |2026-09-13|
| **3.4.11** | 上一版本 |2026-09-13|
| **3.4.10** | 上一版本 |2026-08-28|
| **3.4.9** | 上一版本 |2026-08-28|
| **3.4.8** | 上一版本 |2026-08-27|
| **3.4.7** | 上一版本 |2026-08-27|
| **3.4.6** | 上一版本 |2026-08-27|
| **3.4.5** | 上一版本 |2026-08-26|
| **3.4.4** | 上一版本 |2026-08-21|
| **3.4.3** | 上一版本 |2026-08-21|
| **3.4.2** | 上一版本 |2026-08-11|
| **3.4.1** | 上一版本 |2026-08-17|
| **3.4.0** | 上一版本 |2026-08-15|
| **3.3.18** | 上一版本 |2026-08-14|
| **3.3.17** | 上一版本 |2026-08-12|
| **3.3.16** | 上一版本 |2026-08-12|
| **3.3.15** | 上一版本 |2026-08-12|
| **3.3.14** | 上一版本 |2026-08-12|
| **3.3.13** | 上一版本 |2026-08-11|
| **3.3.12** | 上一版本 |2026-08-11|
| **3.3.11** | 上一版本 |2026-08-10|
| **3.3.10** | 上一版本 |2026-08-09|
| **3.3.9** | 上一版本 |2026-08-05|
| **3.3.8** | 上一版本 |2026-08-04|
| **3.3.7** | 上一版本 |2026-08-03|
| **3.3.6** | 上一版本 |2026-08-03|
| **3.3.5** | 上一版本 |2026-08-03|
| **3.3.4** | 上一版本 |2026-08-02|
| **3.3.3** | 上一版本 |2026-08-02|
| **3.3.2** | 上一版本 |2026-08-02|
| **3.3.1** | 上一版本 |2026-08-02|
| **3.3.0** | 上一版本 |2026-08-01|
| **3.2.2** | 上一版本 |2026-08-01|
| **3.2.1** | 上一版本 |2026-08-01|
| **3.1.5** | 上一版本 |2026-07-28|
| **3.1.4** | 上一版本 |2026-07-26|
| **3.1.3** | 上一版本 |2026-07-26|
| **3.1.2** | 上一版本 |2026-07-26|
| **3.1.1** | 上一版本 |2026-07-26|
| **3.1.0** | 上一版本 |2026-07-26|
| **3.0.0** | 上一版本 |2026-07-23|
| **2.0.0** | 内部迭代 |2026-02-27|
| **1.0.0** | 内部迭代 |2026-02-07|

---

## [待发行] — 2026-11-13：TUI 菜单扁平化（拆掉全部二级菜单）

> 用户指令：「删掉 w1,r1,t1,y1，并将其他原本从旧的二级菜单拆出的选项，进入后删掉
> 旧二级菜单选择页面」。与 11-10 / 11-12 / 11-13 前一批改动合并累积在**同一个待发行
> 版本**下，版本号 / tag / Release 等用户说「发行」时再定（见 `docs/RELEASE_POLICY.md`）。

### 一、删掉 4 个聚合入口，子项照搬进本页

`wow m` 里 `W1` / `R1` / `T1` / `Y1` 原本不是「干活」，而是「再让你选一次」：

| 原入口 | 进去后弹的旧选择页 |
|---|---|
| `W1` 方案管理 (新建/切换/列表/删除/信息) | `请选择 (0-5)` |
| `R1` 联机 / 我要当房主 (陶瓦) | `请选择 (0-4)` |
| `T1` 错误日志分析 | `请选择 (0-3)` |
| `Y1` 系统设置（Java / 性能 / 信息） | `请选择 (0-4)` |

现在这四项连同其它同类聚合入口一并删除（**全项目零 `请选择 (0-N)`**），
子项各自成为页内独立项：

- **W 页**：新建方案 / 切换方案 / 列出全部方案 / 删除方案 / 方案信息 /
  安装整合包(本地) / 安装整合包(URL) / 生成客户端整合包 / 整理资源池
- **E 页**：列出模组 / 安装模组 / 卸载模组 / 启用禁用 / 查看配置 / 编辑配置 /
  备份配置 + server.properties 四项
- **R 页**：开房 / 房间号状态 / 关房 / 我要当房客 + 下载镜像 / 超时 / 重试
  + 端口可见性 / 网络信息 / Web 面板
- **T 页**：AI 分析 / 统计报告 / 实时跟踪 + 清理旧日志 / 生成整合包 /
  安装整合包×2
- **Y 页**：Java 设置 / JVM 参数 / 系统信息 / 重置配置 / 认证设置
  + Web 主题四项（列出 / 安装 / 切换 / 删除）
- **Q 页**：除启停与状态监控外，直接提供 server.properties 四项与错误日志分析

菜单从此只有**一层**：看到编号 = 最终动作。

### 二、「请选择 (0-N)」彻底清零

`dispatchMenu` 里 10 个 `subOf('请选择 (0-N)')` 分支全部拆成模块级具名函数
（`schemeCreate` / `schemeSwitch` / `modList` / `modInstall` / `propsSetOne` /
`terracottaHost` / `terracottaJoin` / `logAnalyze` / `javaSettingsEntry` /
`themeAction` / `packInstall` …），`dispatchMenu` 只剩一张转发表。
`subOf()`、`preset` 形参、`shareRl` 的 borrowed 分支一并删除。

### 三、旧编号兼容整体移除

- `PAGES` 里每项的 `legacy` 字段全部删除；
- `resolveNumber()` 只在本页解析，不再「本页序号 → 本页旧编号 → 别页旧编号」三级回退；
- `findPageOfItem()` 只按本页顺号匹配；
- `tui.js` 的 `drawPage()` 不再渲染 `旧 22` 灰字小注，标签列预算相应放宽；
- 输入不存在的编号统一提示「没有编号 X 的功能（本页 1~N，Q/W/E/R/T/Y 切页）」。

> 行为变化：以前记的 `22` / `141` / `144` 等旧编号不再生效，请改用页内顺号。
> `showMainMenu(options, 'W')` 的页键直达保留；数字直达（`showMainMenu(options, '2')`）
> 随旧编号一起移除，传入数字会提示改用页键。

### 四、`dispatchMenuItem` 改为查表派发

新增 `ACTION_BY_KEY`（`页键:顺号` → 动作函数）与 `action(pageKey, itemId, fn)` 注册器。
`dispatchMenuItem` 只做一次 `Map.get()`，不再有 `functional` 中转和 20+ 条
`case '21' / '141' / '84'` 的 LEGACY_ROUTES。

### 五、新增测试

| 文件 | 项数 | 内容 |
|---|---|---|
| `core/test/menu_flat.test.js`（新） | 22 | 零子菜单、零 legacy、编号 1..N 连续、每项都有动作实现、每页渲染 ≤70 列 |
| `core/test/tui_mode.test.js` | 73 | 项数改新值、删跨页断言、加「每项都能在 ACTION_BY_KEY 找到」 |
| `core/test/interactive_menu.test.js` | 67 | 断言从「case 2 有子菜单」改为「具名函数齐备、子菜单彻底消失」 |
| `core/test/terracotta_guest.test.js` | 19 | 改为断言 R1~R4 各自接到 hostRoom/getStatus/stopHost/joinRoom |

`npm test` **54 个文件全绿**，`WOW_PTY_STRICT=1` pty 回归 13 项全过。

---

## [待发行] — 2026-11-13：危险开关 Web 端锁定 + 备用钥匙密码登录

> 承接两条 Web 安全加固指令。与 11-10 / 11-12 两批改动合并累积在**同一个待发行
> 版本**下，版本号 / tag / Release 等用户说「发行」时再定（见 `docs/RELEASE_POLICY.md`）。

### 一、危险开关物理隐藏（前端防呆 + 后端二次拦截）

- 新增 `core/src/web_security.js`（零副作用纯逻辑底座）：从 `config_schema.listFields()` 派生 `danger === true && key.startsWith('web.allow_')` 的三个键，并用 `EXPECTED_DANGER_KEYS` 显式常量做双保险；schema 万一漏标 `danger:true` 会 **fail-fast 拒绝加载**，避免静默漏防。
- 新增独立中间件 `guardDangerKeys()`，注册在认证包装层**之前**，覆盖 `POST /api/config` 与 `POST /api/config/batch`，兼容「单键 `{key,value}`」「`{patch}`」「整份嵌套对象」三种载荷。命中危险键且非本机 → `403 { error: '出于安全考虑，危险开关只能在 127.0.0.1 下修改' }`；`ctx` 取不到时 **fail-closed**，绝不 fail-open。
- 「本机」判定取最严：`socket.remoteAddress` 必须是回环 + `Host` 必须是回环 + 无隧道（含建立中窗口）+ `web.trust_proxy` 未开 + 绑定地址未暴露；出现 `x-forwarded-for` / `forwarded` / `x-real-ip` / `cf-connecting-ip` / `cf-ray` 等任一转发头即锁死。转发头**只用于收紧，绝不用于放行**。
- `set.html` 非本机访问时三个开关**连 DOM 都不渲染**（不是 CSS 隐藏），原位显示红字：`⚠️ 危险开关已被锁定。如需开启，请在服务器本机（127.0.0.1）访问 Web 面板修改，或使用 CLI 命令 wow config wow ...`；原始 JSON 模式的加载与保存都剔除隐藏键，避免非本机保存整份对象被误伤成 403。
- `scheme.html` 的快捷开关在非本机时不再弹确认、不发 POST，直接给同一句红字；旧缓存页面收到 403 时也映射成同一提示。

### 二、新增配置 `web.trust_proxy`

`web.trust_proxy`（默认 `false`）：面板挂在 nginx / Caddy 等反向代理后面时置 `true`。反代到 `127.0.0.1:8080` 时，绑定地址、来源 IP、隧道标记全都「看起来是本机」，只有这个显性声明位能让服务端知道自己已被公网访问。开启后 `requireLogin()` 恒为真、危险开关保持锁定。

### 三、备用钥匙：密码登录双通道

| 接口 | 是否公开 | 说明 |
|------|----------|------|
| `GET /api/auth/config` | 是 | `{ password_enabled, email, email_configured }`；`email` 为掩码（`a***@example.com`），不回管理员邮箱明文 |
| `POST /api/auth/login-password` | 是 | 校验 `web.auth_password`（scrypt 加盐哈希），成功发 JWT；5 次 401 失败后锁 15 分钟（429 + `retry_after_seconds`） |
| `POST /api/auth/set-password` | 是 | 凭「管理员邮箱 + 邮箱验证码」认证（首次设密码时不可能已有 token，且换 token 的 login 会消费验证码）；成功返回 JWT。`mail.admin_email` 为空直接 400 |

- `login.html` 启动时查询 `/api/auth/config`，仅当 `password_enabled === true` 才出现「验证码登录 / 密码登录」双 Tab；接口失败或未设密码时保持纯验证码表单（fail-safe）。
- `set.html` 新增独立「备用钥匙」卡片：邮箱 → 获取验证码 → 验证码 + 新密码 → 提交；已有密码时追加「当前密码」校验。`mail.admin_email` 未配置时整卡禁用并提示。
- 验证码登录始终保留：密码通道被限流锁死也不影响验证码通道（限流按「通道 + IP」分桶）。
- 验证码改用 `crypto.randomInt`（CSPRNG），未过期的码复用、不刷新有效期、不重复发邮件。

### 四、已知边界（本轮明确不做）

- 锁定只作用于 Web 配置写入口；`wow config set` 等 CLI 通道不受限（本机 shell 权限本就是最高权限）。
- `socket.io` 握手未做 JWT 校验（沿用既有行为）。
- 隧道 / 反向代理共享 `127.0.0.1` 时，限流按 IP 分桶会退化为「全局限流」，可能被用于自我 DoS。
- 已登录态 `GET /api/config` 仍返回全量配置（含 secret 哈希）；匿名请求在公网 / 反代模式下已被强制登录拦住。

## [待发行] — 2026-11-12：3.7.0 视图重构与功能补丁执行令

> 承接《尚书省第 3.7.0 视图重构与功能补丁执行令》。与 11-10 的 readline
> 单例改动合并累积在**同一个待发行版本**下，版本号 / tag / Release 等
> 用户说「发行」时再定（见 `docs/RELEASE_POLICY.md`）。
> 本轮不升版本号、不打 tag、不建 Release。

### 一、新增两个配置项

| 配置 | 默认 | 语义 |
|------|------|------|
| `web.require_login` | `false` | `false` = 打开面板与调用接口都无需登录；`true` = 必须验证身份。面板监听 `0.0.0.0` / 非回环地址 / 开了内网穿透时，**忽略 false 强制登录**（公网兜底）。 |
| `log.disabled` | `false` | wow 自身日志不写入硬盘（终端与内存照常可见）；Minecraft 自己写的 `latest.log` 保留；每次正常关服把方案 `logs/` 清到只剩 `latest.log`。 |

- `web.require_login` 用 `app.use()` **包装层**实现，不改 `authMiddleware` 函数体；新增 `GET /api/auth/mode`，前端 `web/js/auth_guard.js` 的 `wowAuthGuard()` 据此决定是否跳登录页，四页接入后 `false` 时完全免登录。
- `log.disabled` 收口到新增的 `core/src/log_sink.js`：wow 主日志、`wow-console.log`、`wow-stdout.log`、`analysis_report.txt`、`cloudflared.log`、`.lan-api.log` 全部走同一闸门，disabled 时**一个文件都不产生**；`keepLatestOnly()` 关服清理不会误删 `latest.log`。

### 二、五大视图状态机（P0）

废弃旧 `:mc / :wow / :lan` 三视图，改为 `shell / menu(:m) / wow(:wow) / mc(:mc) / web(:web)`：

- 新增 `core/src/view_state.js` 作为单一事实源，**只存状态、绝不创建 readline**。
- 删除 `server start` 内的 `:lan` 视图，`SWITCH_ALIASES` 里不留任何 lan 别名（陶瓦功能仍在 `:m` 的 R 页）。
- Web 面板触发启服：`:m` **不切视图**，只把顶部状态栏刷成「🟢 已启动」；`:wow` 自动切 `:mc` 实时日志。
- `:mc` 的单次 `Ctrl+C` / `:wow` / `:m` 都是**安全退场**：只归还 stdin 租约、断开日志流，服务端继续跑，绝不 `stop()`；再次 `:mc` 可随时回来。
- `:wow` 长命令视图在 `server start` 上下文内置（`server.repl` 租约），不另起 REPL 抢 stdin。

### 三、防呆：强关终端不留僵尸

- 新增 `core/src/shutdown.js`：登记本进程持有的 MC 子进程，`SIGTERM` / `SIGHUP` / `exit` 三级兜底优雅停服（`stop` 指令 → SIGTERM → SIGKILL）；单次 `Ctrl+C` 不注册（那是 detach）。
- 两处 `spawn`（交互 / 非交互）都登记；补齐非交互分支原本完全没有信号处理器的缺口。
- 所有 `process.exit(0)` 前先 `await requestStop()`，且 `hasOwnedChild()` 保证 Web 面板启动的服务端不被 REPL 的 `exit` 误杀。

### 四、功能修复与页面重写

| 项 | 改动 |
|----|------|
| Web 文件管理打不开文件夹 | 根因是后端 `listFiles()` 返回 `type`，前端全篇读 `file.isDir`。后端补 `isDir` 字段恢复契约，前端零改动。 |
| `:m` 的 R 页「我要当房客」 | 不再只是提示，基于 `GET /state/guessing?room=&player=` 实现**真正加入房间**（`terracotta.joinRoom()` + `waitGuestOk()`），二进制不支持时降级提示且不崩。R 页由 8 项扩到 9 项。 |
| `set.html` 真·推倒重写 | 1514 行 → 817 行，内联 CSS 抽成 `web/css/set.css`；首屏干净配置表单 + JVM 预览，`<details>` 折叠高级区；改模板 500ms 后由 `/api/config/preview-jvm`（后端 `Jvm.buildJvmArgs()`）返回命令，**前端零 JVM 拼接**。 |

### 五、readline 单例补强

- `stdin_session.js` 新增默认关闭的 `WOW_STDIN_ASSERT=1` 探针：每次创建 / 销毁 readline 把 `stats().peak / live / violations` 打到 stderr，让「只有一个 readline」从输出现象上升到运行时数据。
- `acquireSync()` 新增 `expectedOwners`：**设计内的控制权交接**（`wow L` 的 REPL 里敲 `server start`，stdin 交给开服控制台）不再刷「调用方可能漏了 release」误报；未声明的占用者仍告警，对真漏 release 的诊断能力不丢。

### 六、pty 实测回归基建

新增 `core/test/pty_views.py` + `core/test/pty_views.test.js`：纯标准库 `pty.fork()` 驱动真实 TTY，用临时目录的 fake-java + dummy 方案走**真实 `server start` 主路径**，零生产代码测试钩子、零污染。

| 场景 | 覆盖 |
|------|------|
| A | `shell → :wow → :m → :wow → exit`，菜单往返 + `badapple` / `server status` 双写哨兵 |
| B | `shell → :wow → :mc → :wow → :mc → Ctrl+C 安全退场 → :wow → :mc`，fake MC 全程持续 tick（没被误杀） |
| C | 强关终端 `SIGTERM` → MC 优雅退出，PID 无残留、无僵尸 |
| D | Web 端触发启服心跳 → `:wow` 自动切 `:mc`（`:m` 不切页由静态断言锁定） |

- 每个场景断言探针 `peak<=1`、`violations==0`，且无 `sseerrvveerr` / `bbaaddaappppllee` 双写。
- 双层超时天花板（`spawnSync` 120s + SIGKILL、python `signal.alarm(100)`），保证 `test/run.js`（无 timeout）不会被拖死；`finally` 里 killpg / waitpid / rmtree / 补杀漏网 fake-java。
- 另新增 `view_state.test.js`（状态机 + 全仓租约配对）、`server_start_path.test.js`（`start()` 主路径源码形状）、`log_sink.test.js`、`auth_mode.test.js`、`set_page.test.js`、`shutdown.test.js`、`terracotta_guest.test.js`。

### 七、验证结果

- `npm test`：**49 个测试文件全绿**（72.5s）。
- `WOW_PTY_STRICT=1 node test/pty_views.test.js`：13 项全过，4 个 pty 场景 `ok=4 fail=0`。
- `diff -rq web themes/default`：逐字节一致（含新增 `css/set.css` / `js/auth_guard.js`）。
- `grep -rn "CONSOLE_MODES.lan\|_startLanWatch\|isLoginVerifyEnabled" core/src`：均无残留。
- pty 四场景已覆盖核心流转矩阵与「强关终端不留僵尸」红线，`peak=1 / violations=0` 全程成立。

---

## [待发行] — 2026-11-10：readline 收归单例，全局只允许一个消费者

> 候选版本号 `3.7.4-26.47`（序号 47）。按 `docs/RELEASE_POLICY.md` 约定，
> 版本号、tag、打包与 Release 等用户说「发行」时再定；本段先记录改动与验证结果。

> 起因：REPL、TUI 键盘、开服控制台、各级菜单、命令里的确认框/密码框，
> 一共十几处各自 `readline.createInterface({ input: process.stdin })`。
> 两个实例同时活着时，每个字节被两条 `data` 链路各读一遍：输入
> `badapple` 在屏幕上变成 `bbaaddaappppllee`，REPL 还会把彩蛋名当指令
> 执行，报「❌ 未知指令: badapple」。创建点太分散，逐个补漏必然再漏。

### 一、新增 `core/src/stdin_session.js`

全项目**唯一**的 readline 创建出口，其余模块一律「租用」lease：

| API | 用途 |
|-----|------|
| `claim(name, options)` | 长期持有；被占用时 **FIFO 排队**，不并行创建 |
| `claimSync(name)` | 启动期用；被占用直接抛错，不静默卡住 |
| `acquireSync(name)` | 必须同步建好（TUI 键盘）；有残留持有者时先 `teardown` 再接管并告警 |
| `ask(prompt)` / `confirm(prompt)` | 临时问一行，自动 claim → question → release |
| `lease.rl / pause / resume / question / enableKeypress / release` | 租约能力 |
| `stats() / violations() / currentRl()` | 诊断 |

「无论什么情况下都只有一个」靠三层防线，不靠调用方自觉：

1. **唯一出口**：只有本模块 `makeRl()` 调 `createInterface`；静态守卫测试
   扫描 `core/src/`，出现第二处即失败。`emitKeypressEvents` 也收归
   `lease.enableKeypress()`。
2. **运行时不变式**：`liveRl` 记录真实存活实例，`makeRl()` 见到它非 null
   直接抛错；`release()` / `acquireSync()` 共用幂等 `teardown()`，
   并用 WeakSet 拦住「迟到 release」把计数减穿。
3. **全局创建守卫**：模块加载时包装 `readline.createInterface`。任何绕过
   单例、且以 `process.stdin` 为输入的调用（第三方库、动态 require、
   以后新加的代码）——已有实例时**抛错拒绝**，否则记录调用栈并告警。
   非 stdin 的 readline（逐行读文件）不受约束。

### 二、迁移清单

| 模块 | 原做法 | 现在 |
|------|--------|------|
| `cli.js` | REPL 自建、`sync login` 回退自建 | `claim('repl')` + `stdinSession.ask()` |
| `tui.js` | `mkRl()` / `askLine()` 各自 `createInterface` | `acquireSync('tui.keyboard' / 'tui.askLine')` |
| `interactive.js` | `createRL()` 自建 | `acquireSync('interactive.menu')`，`rl.close()` 顺手还租约 |
| `server.js` | `_createConsoleRl()` 自建 | `acquireSync('server.console')`，进菜单前归还 |
| `party/party.js`、`config.js`、`theme_manager.js`、`pack_generator.js`、`plugin_loader.js`、`client_clone.js` | 各自自建 readline 问密码 / 确认 | `stdinSession.ask()` / `confirm()` / `claim()` |

顺手清掉 `server.js`、`party.js`、`plugin_loader.js` 里三处已失效的
`require('readline')`（只剩静态工具方法在用）。

### 三、两个真实 bug 一并修掉

**1. `install party` 输入被吃两遍（真正复现的双开）**

`party.ask()` 自己建了一个 readline，而 REPL 的 readline 还活着；
同时 `install party` 没进 `cli.js` 的 `interactiveCmd` 挂起白名单，
REPL 没有让出 stdin。两者叠加 → `badapple` 被 REPL 当指令。
现在 party 走 `stdinSession.ask()`（自动排队），白名单补上
`install\s+party\b`。

**2. 退出 M 菜单时偶发「强制接管」告警**

`runTuiMode` 结束调同步的 `kb.close()`，而 `suspend()` / `close()`
只 `rl.close()`、没归还租约，单例里 `current` 仍指向 `tui.keyboard`，
紧接着 `askLine()` / `_backToConsole()` 申请时就报
「⚠️ stdin 被…占用，…强制接管」。两条路径都改为同步调用
`lease.release()`（同步前段在第一个 `await` 前完成，足以让出所有权）。

> 更正一条早先的误判：`_backToConsole` 里 `this._rl` 看似没赋值，
> 实际在 `_createConsoleRl()` 内已完成；5 轮往返实测 `line` / `SIGINT`
> 监听器恒为 1，**不是 bug**，本次未改动该处。

### 四、关于「TTY 下数到 2 个 data 监听器」

真 TTY 中 `terminal: true` 的 readline 会让 Node 调
`emitKeypressEvents`，往 stdin 挂一个常驻 `onData` 按键解码器；
`rl.close()` 不移除它。下一个 `terminal: false` 租约再挂 `ondata`，
于是 stdin 上短暂出现 2 个 `data` 监听器。

**这不是第二个 readline**：`stats().live` 恒 ≤ 1、`peak` 恒为 1。
`onData` 只把字节解码成 keypress 事件，TUI 挂起时已卸载自己的
keypress 监听，不会造成双读。关键是它幂等、不随重建累积——
实测 28 次重建后仍 ≤ 2。没有去清 Node 私有幂等标记：换来的
「1 个」依赖内部实现，升级后可能让新 readline 收不到输入。

### 五、测试与实证

- 新增 `core/test/stdin_session.test.js`（**21 项**）：租约语义、
  并发排队、守卫拒绝绕过、非 stdin 不误伤、`makeRl` 不变式、
  `acquireSync` 接管幂等、30 轮混合压力 `live/peak ≤ 1`、
  30 轮 terminal 切换 data 监听器不累积、静态扫描唯一出口；
- `tui_mode.test.js` / `interactive_menu.test.js` 的断言由「有 N 处
  createInterface」改为「0 处 + 必须走 `stdinSession.acquireSync`」；
- 全量 **41** 个文件通过，38.4s；
- pty 端到端（注入探针采样 `process.stdin` 监听器 + 单例 `stats()`）：

| 场景 | readline 实例峰值 | data 监听器峰值 | 违规/告警 |
|------|------------------|----------------|-----------|
| TUI 七页 × 3 轮 × 二级菜单往返（28 次重建）+ 退出 | **1** | 2（Node 常驻解码器） | 0 |
| REPL → `install party` 输彩蛋名 → 普通指令 → 退出 | **1** | 1 | 0 |

两条流程均无「未知指令」、无强制接管告警、无 TypeError，`badapple`
完整送达提问框，不再被 REPL 截走。

---

## [3.7.3-26.46] — 2026-11-09：M 模式画面独占，日志不再顶菜单

> 场景：`server start` 跑着服务器（日志一直在滚），敲 `:wow` 进菜单。
> 早先只靠 `_mode === 'mc'` 判断回显，它盯的是「控制台视图」，不是「画面」——
> 只要有别的入口把 TUI 叫起来（`:wow`、L 模式回跳、以后新加的入口），
> 而 `_mode` 又恰好还是 `mc`（或 L 模式那边每 500ms 打一批的跟踪定时器还活着），
> 日志就会从菜单底下顶出来，七页界面被冲得没法看。

### 一、给画面加一道与业务无关的闸门

`tui.markScreenActive()` / `isScreenActive()`：TUI 从**第一帧之前**置位，
`kb.close()` 之后、任何 `leaving` 分支之前复位。两个日志生产方都先问它：

| 生产者 | 原判断 | 现在 |
|--------|--------|------|
| `server.js` MC stdout / stderr 回显 | `_mode === 'mc'` | `_mode === 'mc' && !tuiOwnsScreen()` |
| `cli.js` L 模式跟踪打印（`printLine`） | 无 | 占用时直接 return |

被挡住的只是「回显」：`logStream.write(data)` 照旧落盘，`wow-stdout.log`
一条不少；退出菜单后 `:mc`、`:wowlog`、菜单 5（实时日志跟踪）照样能看。
加载失败时 `tuiOwnsScreen()` 返回 false（宁可多打日志，也不能把日志永久噤声）。

### 二、菜单期间摘掉「Ctrl+C = 停服」

`process.once('SIGINT')` 的处理器原本在整个开服期间都挂着，可 TUI 的 raw 模式
只覆盖菜单本身；停在「按回车键返回」这类行输入提示上时，Ctrl+C 会直冲
process 的 SIGINT——**用户只想退出菜单，服务器却跟着关了**。
现在 `_enterMenuFromConsole()` 进菜单前 `removeListener`，退出（含选 L 回控制台
那条路）再 `once()` 装回，且只在服务端还活着时装。

### 三、退出确认大小写都认

确认框写的是「按 Y 确认」，代码里却只比 `'Y'`；CapsLock / Shift 下敲出来的
大写 Y 会落到切页分支上（直接跳到 Y 页）。改为
`String(k).toUpperCase() === 'Y'`。

### 四、测试

- 新增 `core/test/tui_screen_gate.test.js`（10 项）：闸门本体、`runTuiMode`
  置位/复位时序、两个日志生产方的判断、SIGINT 摘装、`printLine` 仍保留清行；
- `interactive_menu.test.js` 的 `printLine` 断言窗口放宽（多了一行闸门判断）；
- 全量 **40** 个文件通过，40.0s。

### 五、实证（pty + 假 java 扮演 MC，每秒约 200 行输出）

| 检查 | 结果 |
|------|------|
| `:wow` 进菜单后 3~5 秒 | 新增日志 **0** 行（改前过渡窗口能漏上百行） |
| 菜单里停在「按回车键返回」按 Ctrl+C | 只回显 `^C`，**不再**出现「收到中断信号」；退出菜单后日志照常滚 |
| 退出菜单 → `:mc` | 3 秒内 590 行，回显恢复 |
| 大写 `Y` 确认退出 | 正常回控制台（改前会跳到 Y 页） |

### 六、顺手修掉的三处线上问题（同批提测）

**1. `/api/files` 带重复 `scheme` 参数 → 404**

浏览器报 `GET /api/files?path=&scheme=1.20.1-Forge&scheme=1.20.1-Forge 404`。
根因在前端 `web/file.html`：`apiRequest()` 内部已经统一包一次 `withScheme()`，
而 `loadFiles()` 等三处调用又手动包了一次，URL 里就出现两个 `scheme`。
Express 遇同名 query 会解析成**数组** `['A','A']`，`String(['A','A'])` 得到 `"A,A"`，
拿去查方案目录自然 `ENOENT` → 404。

- 前端：三处多余的 `withScheme()` 去掉；`withScheme()` 本身改成**幂等**
  （已含 `scheme=` 就直接返回），以后谁再包一层也不会出问题；
- 后端：新增 `pickParam()`，`schemeOf()` 及 `/api/resources`、`/api/props`、
  `/api/upload` 一律「数组取第一个非空值」，就算前端拼多遍也能正确解析。

实测：`?scheme=A&scheme=A`、三连重复均 `HTTP 200`，方案目录正确。

**2. 实例配置页的配置项只有英文键名 → 加中文翻译**

`server.properties` 里全是 `enforce-secure-profile`、`entity-broadcast-range-percentage`
这种长键名，页面上原样显示，用户得先去查 wiki 才知道这项是干什么的。

新增 `core/src/props_docs.js`：47 个常用键各配一份**中文名 + 一句中文说明**，
以及 `gamemode` / `difficulty` / `level-type` 的枚举中文化（`survival → 生存`）。
`GET /api/props` 把整份字典随响应下发，前端 `props.html` 渲染成

```
服务器描述          ← 中文名（原来的位置）
motd                ← 灰色小字，标出 .properties 里真正那一行
[ A Minecraft Server ]
```

鼠标悬停出整句说明 + 键名。字典里的值本身仍是英文（写进文件必须英文），
下拉框显示成 `生存（survival）`。改动的只是显示，**保存逻辑一行未动**。

**3. 仪表盘全是 0%（CPU / 内存 / 运行时长）**

`server.js` 非交互启动分支原先把 `logStream` 直接塞进 `stdio`：

```js
spawn(cmd.javaPath, args, { stdio: ['pipe', logStream, logStream] })
```

Node 在 stdio 项是流对象时，会把 `child.stdout` / `child.stderr` 置为 `null`。
紧随其后的 `this.process.stdout.on('data', ...)` 立刻抛 `TypeError`，
`_writePid()` 根本走不到 → `.pid` 文件不存在 → `/api/status` 永远 `running:false`
→ `/api/metrics` 读不到 pid，四个指标全 0。

改为 `stdio: ['pipe','pipe','pipe']` + 手动 `logStream.write(data)`。
（同一条路径也让 `node core/src/cli.js server start` 在非 TTY 下不再崩。）

实测：`{"running":true,"pid":29603,"cpu":"0.1%","memory":"3.7 MB","uptime":"2m 17s"}`，
仪表盘页面 CPU / 内存 / 运行时长 / 方案名全部正常显示。

### 七、测试（本轮追加）

- `web_pages.test.js`：主题副本一致性纳入 `props.html`；
- 全量 **40** 个文件通过，37.4s。

### 八、附：一条被证伪的「隐患」

开发过程中一度把「`_backToConsole()` 里的 `const rl = this._createConsoleRl();`
没有赋给 `this._rl`，会反复重建 readline」当成待修 bug。

实测证明**这个结论是错的**：赋值发生在 `_createConsoleRl()` 内部
（`this._rl = rl`），调用点不需要再接一次。连跑 5 轮「进菜单 → 回控制台」，
每轮的 `line` 与 `SIGINT` 监听器都稳定为 **1** 个；`_rl` 已存在且未关闭时
`_backToConsole()` 直接跳过重建（`if (!this._rl || this._rl.closed)`），
复用同一个实例、监听器数仍是 1，不存在累积。

记在这里是为了不再有人（包括我自己）重复翻这条旧账——代码保持原样。

---

## [3.7.2-26.45] — 2026-11-08

> **主题：M 模式的编号改成「每页都从 1 开始顺号」**。
>
> 七页拆分时为了不动 `dispatch()` 的 `case`，每页直接沿用了扁平菜单的旧编号：
> Q 页是 `1 / 12 / 5 / 11 / 4 / 14`，R 页是 `14 / 141 / 142 / 143 / 7 / 121 / 122 / 123`。
> 页内顺序与编号脱节，用户得先「查表」再输入——到哪一页都是 `1 2 3 4 5`
> 才是手感对的东西。

### 一、每页 1,2,3… 顺号

| 页 | 之前 | 现在 |
|----|------|------|
| `Q` 服务器 | `1 12 5 11 4 14` | `1 2 3 4 5 6` |
| `W` 方案 | `2 21 22 23 24 25 9 10 26` | `1~9` |
| `E` 内容 | `3 4 31 32 33 34 5` | `1~7` |
| `R` 网络 | `14 141 142 143 7 121 122 123` | `1~8` |
| `T` 工具 | `11 111 112 4 113 10 9` | `1~7` |
| `Y` 高级 | `8 81 82 83 84 6 13` | `1~7` |

- 页内序号唯一 → 「敲 1」在 Q 页是启动服务器、在 W 页是方案管理，不会再被
  旧编号抢走语义；
- 编号最长从 3 位降到 1~2 位，`Backspace` 删错的机会也少了。

### 二、旧编号仍然认（不打断老习惯）

每个功能多了一个 `legacy` 字段，装着它以前的编号（原扁平菜单 1~14，以及
3.7.x 的 21/22/31/141 等扩展编号）。解析顺序固定在 `resolveNumber()`：

1. **本页序号**——界面上显示的那套，永远优先；
2. **本页旧编号**——`W` 页敲 `22` 仍是「列出全部方案」；
3. **别的页的旧编号**——本页完全没有才跳页，跳过去停在新页。

界面上用灰字小注 `旧 22` 标出，**不占编号列**（编号列只有 1 2 3 4 5）。
`dispatchMenuItem` 新增 `opts.page`，先把「本页序号」翻译成「稳定的功能键」
再走原来的 switch——业务 case 一行没改。

### 三、版面：70 列内放下「编号 + 名称 + 旧编号 + 备注」

网络页第一项的标签就有 18 字，加上 `旧 141` 和 `内网 IP / 端口` 会撑到 76 列。
`drawPage` 改为按列预算分配：先截名称（`…` 收尾，保底 10 格），不够再截备注，
编号列永远完整。顺手修掉「备注被固定上限截成 `PCL/HMC…`」的问题——现在按
本页实际最长值排版。

### 四、修「回到界面后要按两次回车」

`askLine()`（「按回车键返回…」）在 `suspend()` 之后拿到的 stdin 可能仍是
paused 状态，新建的 readline 收不到那一行，用户按一次没反应、按第二次才生效。
现在 `askLine()` 建 readline 之前显式 `stdin.resume()`；`activate()` 也只对真
TTY 开 raw 模式，非 TTY 场景不会再把流水线输入当行编辑处理。

### 五、测试

- `tui_mode.test.js` 69 → **72 项**：新增「每页序号 1,2,3… 连续」「页内序号不重复
  且能逐一解析回原项」「`resolveNumber` 三层优先级」「原主菜单 1~14 全部有页认领」；
  跨页跳转断言改为检查 `resolveNumber(id, state.page)` 与 `{ page: hit.page }`；
- `interactive_menu.test.js` 两条编号断言同步（「方案管理」现在 W 页第 1 项、
  旧编号 2；「Web 主题」Y 页第 7 项、旧编号 13）；
- 全量 39 个文件通过；另用 pty 逐键实测：六页编号全为顺号、E 页敲 `1` 进模组管理、
  Q 页敲 `5` 回车进日志跟踪、Q 页敲 `22` 跳 W 页、`99` 提示无此编号。

---

## [3.7.1-26.44] — 2026-11-08

> **主题：M 模式数字选择改回「输入编号 + 回车」**，顺带修掉「启动失败后界面变死图」。
>
> 3.7.0 的 TUI 是「按键即触发」，数字靠 `NUM_KEY_DELAY` 等待窗口猜用户
> 要不要再按一位。实测不好用：`22` 稍慢就被拆成两次 `2`，落进方案管理子菜单。
> 现与原来的数字菜单对齐——**输入编号 + 回车**，不猜、不等。

### 一、数字要回车

| 操作 | 之前（3.7.0） | 现在 |
|------|---------------|------|
| 执行 `22` | 连按 `2` `2`，250ms 内必须按完 | 按 `2` `2`，回车 |
| 单键功能（如 `5`） | 按下即执行 | 按下 `5` 再回车 |
| 输错了 | 只能等它自己执行完 | `Backspace` 删一位 |
| 输入回显 | 无（只能靠猜） | 提示行显示 `编号: 22▏` |
| `0` 退出 | 按下即弹确认框 | `0` + 回车 |

- `onDigit` / `couldExtend` / `NUM_KEY_DELAY` / 定时器全部删掉——没有等待
  窗口，也就没有「定时器泄漏到新页面 / REPL」这类问题；
- `tui.js` 的回车不再伪装成 `REFRESH`，改为发 `RETURN` 交给上层；编号为空时
  回调依旧是刷新状态；
- `Backspace` 从「被吞掉的功能键」改为发 `BACKSPACE`。

### 二、编号跨页生效

七页拆分后编号按页分布，但老用户是按扁平菜单记编号的。在 Q 页敲 `22` 回车，
现在会**自动跳到 W 页**执行「列出全部方案」，返回时停在新页——顺带让用户
记住「22 属于 W 页」。同编号出现在多页时（`4` 在 Q / E / T 都有）本页优先，
只有本页完全没有才跳。两处都没有才提示「没有编号 xxx 的功能」。

### 三、修掉「启动失败后界面变死图」

`server.start()` 有 5 条提前返回的失败路径（已在运行 / 方案目录缺失 ×2 /
核心缺失 / 内存红线），它们**打印原因就 return，不接管 stdin**。3.7.0 里
`maybeJumpToServer` 只看「start 返回了」就当成「服务端跑完退出了」，于是
关掉 TUI 键盘走人——终端停在行模式，按什么键都只是回显，用户以为程序卡死。

- `start()` 改为返回布尔值：真的把进程拉起来过 → `true`，上述 5 条 → `false`；
- `maybeJumpToServer` 判 `started === false` 时走失败分支：先用 `askLine`
  停一屏（此时键盘仍挂起、stdin 空着，正好能读），让用户看清 `未找到服务器核心`
  这类原因，回车后再 `resume()` 把键盘还给 TUI。直接重绘会把原因清屏擦掉。

### 四、测试

`core/test/tui_mode.test.js` 63 → **69 项**：删除 4 项等待窗口断言，新增
「数字只入缓冲」「回车是唯一执行入口」「空回车只刷新」「0 要回车」「Backspace
删一位」「编号长度上限」「跨页跳转且本页优先」「输入回显」「`start()` 布尔
契约」「提前返回不按跑完处理」。`scheme_missing_dir.test.js` 1 项断言同步
到 `return false`。全量回归 39 个文件通过。

### 五、发版工具修正

`scripts/make-sha256sums.sh` 生成清单时写的是 `echo "  $line"`，导致每行多出
两个前导空格：

```
  ab4821…  wow-v3.7.0-26.43-github.zip    ← 之前，非标准
ab4821…  wow-v3.7.0-26.43-github.zip      ← 现在
```

`update.sh` / `update.bat` 用 `awk '$1'` 与 `grep -qi` 匹配，前导空白不参与比较，
所以线上校验一直是好的；但 `sha256sum -c SHA256SUMS` 会直接判「格式非法」。
清单已按标准格式重新生成（191 → 187 字节，两个哈希值本身不变），
两端 Release 的 `SHA256SUMS` 附件均已替换为同一份 187 字节文件。

>
> 注：`3.7.0-26.43` 章节保留「按键即触发」的原始记录；本版是它的补丁版，
> 只改数字提交方式、跨页跳转与失败路径，其余行为与 3.7.0 一致。

---

## [3.7.0-26.43] — 2026-11-08

> 本周期主题：**M 模式从「问答菜单」变成真正的 TUI**、**模组配置有了可扩展表单引擎**、
> **共享池从「事后登记」变成「优先复用」**，外加便签聊天室与一批面板修复。
> 累计 7 个开发批次合并为一条发行记录。

### 📊 本版一览

| 板块 | 一句话 |
|------|--------|
| **609 M 模式七页 TUI** | `wow m` 变成常驻界面：QWERTY 切六页、数字执行、按键即触发，单 readline 接管 |
| **608 模组表单引擎** | 可扩展 Schema：官方库 + 用户库，六种配置文件格式行级替换，GUI/Raw 双轨 |
| **便签聊天室** | 面板右栏从单向通知栏变成多用户便签墙，实时同步 + socket 断线轮询兜底 |
| **pool 优先复用** | 建方案先查池，命中就跳过下载；安装器型加载器也省掉原版核心下载 |
| **JVM 模板 a/b/c/d** | 四档模板 + 覆盖参数，GC 互斥铁律，80% 物理内存红线 |
| **模组管理 / 实例配置页** | 面板新增两个页面：池 ↔ 方案双向复制、server.properties 分组卡片 |
| **一批硬伤修复** | REPL 双回显 `aaaassss`、clone-client 三处、面板断连崩溃、方案名未编码 |

### 🔧 升级提示

- **无破坏性变更**，老配置可直接升级：
  - 旧 JVM 档位名自动映射（`g1→b`、`zgc→c`、`custom→d`）；
  - 旧 `server.jvm_args` 数组不再读取，迁移到 `server.jvm.{template,override_args}`；
  - `wow m` / `M` 恢复可用（V3.5.8 曾被移除），与双击批处理是同一界面。
- 开服控制台里 **`:wow` 改为进 M 模式菜单**，看 wow 日志请用 `:wowlog`。
- 首次进入 M 模式会自动走 TUI；非 TTY 环境（管道 / cron / Docker）自动降级为
  「输入 + 回车」，功能完全一致。

---

### 一、609 M 模式七页 TUI（全键盘驱动 + 单 readline 接管）

### 一、M 模式从「一问一答」变成「一张界面」

此前 `wow m` 是逐行问答：打印一屏菜单、敲编号、回车、再打印一屏。现在
是**常驻界面 + 按键即触发**（`readline.emitKeypressEvents`，不用回车）
> ——数字部分已在 3.7.1-26.44 改回「输入 + 回车」，见文首对应章节：

```
════════════════════════════════════════════════════════════
  wow 3.7.0-26.43    服务器: ● 运行中 (PID 12345)
  当前方案: [1] 生存服    已装 Java: 17.0.9 / 当前: 17.0.9
────────────────────────────────────────────────────────────
  「Q」服务器启停
  ──────────────────────────────────────────────────────────
   1   启动 / 停止服务器            ● 运行中，可停止
   12  状态监控
   5   server.properties
   11  错误日志
   4   实时日志 (Ctrl+C 退出)
   14  陶瓦联机
────────────────────────────────────────────────────────────
  [Q]服务器  [W]方案  [E]内容  [R]网络  [T]工具  [Y]高级  [L]长命令  [0]退出
  按数字执行 · 按字母切页
════════════════════════════════════════════════════════════
```

- **状态栏四行**（版本 / 服务器运行态与 PID / 当前方案 / 已装与当前 Java）：
  取数走 300ms 缓存，七个字段各自独立 `try/catch`，任何一个管理器抛错
  只让那一个格子降级成 `—`，绝不带崩整屏；
- **七页排布**（`PAGES` 声明式表，`{ key, label, title, items:[{id,label,hint}] }`）：

| 页 | 标题 | 项数 | 内容 |
|----|------|------|------|
| `Q` | 服务器启停 | 6 | 启停、状态监控、properties、错误日志、实时日志、陶瓦 |
| `W` | 方案管理 | 9 | 管理、快速切换、列出、信息、新建、删除、装包、生成包、瘦身 |
| `E` | 内容与配置 | 7 | 模组管理、搜索下载、列出、启/禁用、编辑、备份、properties |
| `R` | 网络与联机 | 8 | 陶瓦、开房、房间号、关房、镜像、端口、网络信息、Web 面板 |
| `T` | 工具与日志 | 7 | 错误日志、AI 分析、报告、实时跟踪、清理、生成包、装包 |
| `Y` | 高级与杂项 | 7 | 系统设置、Java、JVM、系统信息、重置、认证、主题 |

- **`hint` 可以是函数**：画页时现算（比如「● 运行中，可停止」），计算
  过程被包在 `try/catch` 里，失败就留空；
- **CJK 宽度对齐**：`dispWidth()` 按 codepoint 判 2 列，`padRight()` 补齐，
  中英混排的 `hint` 右置时不歪；
- **每次按键都清屏重绘**，不滚屏、不残留、不留历史垃圾。

### 二、按键路由：一竖一横，互不打架

- **字母切页**：`Q/W/E/R/T/Y` → 改 `currentPage` 后重绘；`L` → 长命令；
  `0` → 退出确认；`q` 等同于 `Q`（统一 `.toUpperCase()`）；
- **数字执行**：读当前页 `items` 里的编号执行对应功能；
- **编号拼接**：单键触发意味着 `22`（列出方案）这种两位编号没法一次敲完，
  于是加了 `NUM_KEY_DELAY` 的等待窗口——按下数字时若「本页还存在
  以它开头的更长编号」就等一小段收下一键，否则立刻执行；`0` 不参与拼接。
  窗口最初定 90ms，实测人手连按同一键要 120~250ms，`22` 会被拆成两次 `2`，
  现取 **250ms**。
  > 该机制已被 3.7.1-26.44 整体删除，改为「数字 + 回车」；此处仅保留 3.7.0 的
  > 发行时状态。
  这套判定收在 `couldExtend(buf)` 里，与新编号表完全解耦，加编号不用改逻辑。

### 三、硬约束落地：全局只有「一个键盘消费者」

三条约束逐条对应实现：

**① 唯一 readline** —— 不再搞「同一个 rl 反复复用」，改成「同一时刻只有
一个消费者」。`tui.js` 里 `createInterface` 只出现在两处：TUI 态的 `mkRl()`
和临时提问的 `askLine()`。`interactive.js` 侧一处都没有。

**② 进二级菜单必须交权** —— `kb.suspend()` 做四件事，顺序是踩出来的：

```
rl.close()  →  removeListener('keypress')  →  排空 stdin 残留  →  setRawMode(false)
```

- **必须先 `close()` 再卸监听**：反过来会把触发键（比如 `2`）的最后一次
  keypress 留在 readline 内部缓冲里，进二级菜单后被重复插入，屏幕上出现
  `11` / `33`；
- **必须排空 stdin**：`while (stdin.readableLength > 0) stdin.read()`。
  用户连按 `22` 时第二键若留在缓冲区，会被二级菜单的 `question` 吃掉；
- `resume()` 同样先排空再 `activate()`，把 rl 重建回来。

**③ 三视图与 L 模式的归属** —— 把 `wow server start` 的三视图（`:mc` /
`:wow` / `:lan`）看作「L 模式里 Minecraft 正在运行时的形态」：

| 指令 | 旧行为 | 新行为 |
|------|--------|--------|
| `:wow` | 切到 wow 日志视图 | **进 M 模式菜单** |
| `:wowlog` | — | 接管控件，看 wow 日志 |
| 菜单里按 `L` | 另起 REPL | `onEnterLongCommand` 回调 → 回 `:wow` |
| 菜单里按 `0` / 走完 | — | `_backToConsole('wow')` 落回 `:wow` |

`server.js` 顺带拆出了 `_handleConsoleLine` / `_bindConsoleLine` /
`_backToConsole` / `_menuOptions` / `_createConsoleRl` / `_printConsoleIntro`，
`start()` 与 `_backToConsole()` 复用同一份路由判定，不再两套分支各写一遍。
`_menuOptions()` 懒加载六个管理器且各自 `try/catch`（失败给 `null`），
**不 require cli**——保持 server 对 cli 的零依赖。

### 四、双回显的两个坑（踩坑记录）

| 现象 | 原因 | 修法 |
|------|------|------|
| 连按 `22` 后二级菜单出现 `11` | `suspend` 里只卸监听没 `close`，触发键残留在 rl 内部缓冲 | 先 `close()` 再 `removeListener` |
| 二级菜单出现 `33` | `askLine` 用 `terminal:true`，终端行模式回显 + readline 自身回显叠加 | 改 `terminal:false`，读行交给终端，回显只有一次 |
| 「按回车键返回」卡住 | `askLine` 挂了 `rl.on('close', () => fin(''))`，提前 resolve 空串 | 删掉该监听，只靠 `question` 回调；`fin()` 里补一个 `\n` |

### 五、兼容退化

非 TTY、或 `WOW_NO_TUI=1` 时自动走 `runCompatMode`（数字 + 回车逐行读），
页面表、编号表、业务分支全部共用，功能一个不少。管道里跑、
`cron` 里跑、老式 telnet 里跑都不炸。

### 六、自查补丁（同一批次内的 bug 修复）

TUI 落地后逐条走了十遍真实按键，修掉九个问题，都是「不修也能用、用了就想砸键盘」那类：

| # | 现象 | 根因 | 修法 |
|---|------|------|------|
| 1 | 按一下 Ctrl+C，确认框刚冒出来程序就没了 | `keypress` 的 ctrl-c 与 readline 的 `SIGINT` 各调一次 `onInterrupt`，第二次看到「已在确认中」直接 `process.exit` | `fireInterrupt()` 加 80ms 去重（两条路径先后顺序不确定，用时间窗比标志位稳） |
| 2 | Q 页按 `1` 后立刻按 `W`，新页面底部冒出「本页没有编号 1 的功能」 | 编号等待窗口的定时器没随切页取消，按旧页编号在新页执行 | `cancelNumber()`，切页 / 进 L / 退出 / 刷新 / EOF 全调 |
| 3 | 按 `2` 后立刻按 `L`，REPL 里弹出「方案名称:」 | 同上，且 TUI 已交还 stdin，泄漏的定时器与 REPL 抢输入 | 同上 |
| 4 | 开服控制台 `:wow` 进菜单，按 `0` 退出 → 整个进程没了，服务器跟着陪葬 | 菜单的退出硬编码 `process.exit(0)` | 新增 `returnOnExit`：只离开 TUI，由 server 把画面还给 `:wow` |
| 5 | 启动服务器失败（jar 缺失 / 端口占用）后界面变「死图」，按什么都没反应 | 失败前已 `kb.close()`，不可逆 | 改用可逆的 `kb.suspend()`，失败 `kb.resume()`；失败原因写进 notice（重绘会清屏，`console.error` 根本看不见） |
| 6 | 兼容模式（`echo ... | wow m`）疯狂重绘同一页，CPU 空转 | 管道输入结束后 `ask` 返回空串 → `continue` → 再问 → 仍空串 | 判 `rl.closed` 后退出 |
| 7 | 兼容模式启动服务器时，「内存分配」「是否停止」两个提问被静默跳过 | `ioAsk(io, null, ...)`，`ask(null)` 立即 resolve `''` | 把调用方的 `rl` 一路传下去 |
| 8 | TUI 里「清理旧日志」永远停在「已取消」；「本机网络信息」不停留 | 同上，`ask(null)` | 统一走 `ioAsk(io, rl, ...)`；去掉重复的「按回车返回」 |
| 9 | 实时日志（`4`）一按就把画面顶乱，`tail -f` 在后台继续吐；从 `:wow` 进来时 Ctrl+C 会杀掉服务端 | 旧 `logHandler.tail()` spawn 完就返回，且 SIGINT 里 `process.exit(0)` | 重写：自己管子进程，等 Ctrl+C → kill → 返回；Windows 用 `fs.watch` 增量读兜底 |

| 10 | `22` / `142` 这类两位数编号，正常手速根本敲不出来 | 等待窗口 90ms，短于人连按同键的 120~250ms | `NUM_KEY_DELAY` 调到 250ms（单键最多等 0.25 秒，无感） |

附带三处对齐问题：

- **框线比导航短 10 列**：界面宽度 60，底部七个 `[键]标签` 实测 70 列。
  `WIDTH` 改 70（80 列终端不换行），标题行的 gap 也扣掉行首两空格；
- **三位编号把标签列顶歪**：R 页 `141/142/143` 让整列右移一格。编号列宽改为
  「本页最宽编号」；
- **`redrawTop()` 少移一行**：状态栏实际 6 个物理行，`lastRenderHeight` 记的 5，
  上移后残留一条旧框线。

### 测试

`core/test/tui_mode.test.js` 63 项（页面表：六页键序与项数、页内编号不重复、
原 1~14 全覆盖；导航：七项 label 与 `PAGES` 一致、`PAGE_KEYS` 不含 `L`、
CJK 宽度、WIDTH 与导航齐边；编号拼接：延迟区间、`couldExtend` 分支、`0`
特殊处理；单 readline：`createInterface` 恰好 2 处、`suspend` 先 close 再
卸监听、两边都排空、`askLine` 用 `terminal:false`、`interactive` 零自建；
约束③：`:wow` 进菜单、`:wowlog` 保留、`onEnterLongCommand` 指向、返回
`_backToConsole('wow')`、不 require cli；兼容模式与 StatusBar 降级；
**自查修复回归 13 项**：编号列对齐、状态栏 6 行、Ctrl+C 去重、编号取消点、
`returnOnExit`、`askLine` EOF、兼容模式 `rl` 传递、启动失败 notice、
`tailLogs` 不自杀、EOF 不死循环、控制台横幅不重复）。
`interactive_menu.test.js` 5 项断言同步到新结构。全量回归 39 个文件通过。

pty 端到端实测：Q 页初始渲染 → `W` 切页 → 连按 `22` 进方案列表 →
回车返回 → `Q` 回首页 → `142` 三位编号进陶瓦房间号 → `0` 触发退出确认。
修复后补测：单次 Ctrl+C 停在确认框（进程存活）、`1` → `W` 不再泄漏编号、
`2` → `L` 不再污染 REPL、模拟启动失败后 `W` 仍能切页、`113` 在 TUI 里
真的会问「保留最近几天」、`returnOnExit` 下 `0`+`Y` 只退菜单不杀进程、
`printf 'w\n' | wow m` 正常退出而不空转。

---

### 二、608 模组表单引擎（可扩展 Schema 架构）

### 一、架构：引擎与数据彻底解耦

- **引擎层**（`core/src/schema_engine.js` + `schema_store.js`）：只负责
  「读 Schema → 渲染表单数据 → 行级写回」，不认识任何具体模组；
- **数据层**（`core/data/mod_schemas/*.json` 官方库 + `<根>/custom-schemas/`
  用户库）：纯 JSON，字段路径、类型、中文翻译、默认值。
  **用户库同名覆盖官方库**——翻译有误或模组更新，丢一个 JSON 即可覆盖，
  不动安装目录。

### 二、引擎实现（行级替换 + 原子写 + 边界隔离）

- **六格式定位器**：TOML（节表 + 点路径，双候选兼容）、YAML（缩进栈下钻）、
  JSON（字符串感知扫描 + 就地替换区间，不 parse/stringify）、HOCON（花括号
  深度）、properties、txt（`key=value` 与 `key value` 双认）。SNBT 只读。
- **行级替换**：缩进、行尾注释（引号内 `#` 不误判）、空行、节表顺序逐字节
  保留；**未映射键绝不触碰**（Schema 没写的键连拒绝写入的资格都没有）；
- **类型强转**：`"30"` 按原值类型写成 `30` 不加引号、引号风格沿用、布尔键
  传错值直接拒绝；重复提交同一键时类型基准取最初原值；
- **原子写**：`.bak` 备份 → 临时文件 → rename；同值不落盘；
- **边界七连拒**：`..`、绝对路径、盘符、越界目录、`.jar`/世界数据扩展名、
  NUL 二进制嗅探、符号链接逃逸。只开放 `config/`、`serverconfig/`、`plugins/`。

### 三、CLI：`config schema` 六条子命令

`list` / `show <modId>` / `get <modId> <key>` / `set <modId> <key> <value>` /
`import <file|url>`（GitHub 页面地址自动转 raw 直链）/ `remove <modId>`。

### 四、Web 端：GUI/Raw 双轨 + 配置库面板

- **🪛 模组配置页**（`web/modcfg.html`）：文件树懒加载（点开才请求）；
  命中表单包时显示「🧩 可视化配置 / { } 源码编辑」Tab；**保存后自动切回
  源码模式**让极客确认没误伤注释；>200 行强制源码模式；表单最多 100 项分
  「常用 / 高级」两组；版本不匹配的字段标红「未找到此项」不可编辑；
  右上角 ? 弹免责声明（翻译由社区提供，可能有偏差，可疑请切源码模式）；
- **设置页「🧩 模组配置库」面板**：官方/用户卡片区分、粘贴 JSON 导入、
  GitHub 链接导入（页面地址自动转 raw）、删除用户包。

### 五、首批内置 Schema（5 个打样，社区第二批接手）

| 包 | 格式 | 字段数 |
|----|------|--------|
| LuckPerms（权限） | yml + json 双文件 | 14 |
| CoreProtect（查熊） | yml | 12 |
| Create（机械动力） | toml 双文件 | 14 |
| Waystones（传送石碑） | toml | 10 |
| Alex's Mobs（生物生成） | toml | 10 |

《Schema 编写规范》已落在 `docs/MOD_SCHEMAS.md`（格式、行为语义、各格式
键书写要点、PR Review 标准）。

### 测试

新增 `core/test/schema_engine.test.js` 32 项（加载优先级、六格式行级替换
逐字节比对、类型强转、重复提交基准、missing 上报、同值不落盘、原子写、
边界七连拒、符号链接、大文件降级、页面与路由断言）。端到端：真实面板
跑通表单读取 → 保存 → 自动切源码 → 源码含新值全链路，playwright 截图
验证表单渲染（中文标签、⚠️ 危险标记、标红未找到项）。全量回归 38 个
测试文件通过。

---

### 三、便签聊天室 & 面板断连崩溃修复

### 右侧栏：通知栏 → 便签聊天室

Web 面板右侧从单向的「通知栏」升级为多用户「便签墙」：
所有登录用户共用一块聊天式便签墙，以**登录邮箱为发言人标识**，
谁都可以留言，所有人可见。

- **发言人即邮箱**：JWT 登录邮箱自动作为署名；头像按邮箱哈希着色、
  取邮箱首字母，同一个人永远是同一个颜色；
- **聊天室布局**：自己的便签靠右（绿色气泡）、他人的靠左，
  气泡上方标注「邮箱 · 时间」；
- **实时同步**：发言经 `POST /api/notes` 落库后由 socket.io 广播
  `note` 事件，所有在线面板即时收到；socket 断线时退回 5s 轮询兜底，
  前端按 id 去重合并，双通道不重复渲染；
- **持久化**：存 `.web.notes.json`（与 `.web.pid` 同级），重启不丢；
  单条上限 500 字、整墙最多 200 条（旧的自动裁掉）；
- **安全**：正文清洗控制字符（保留换行），渲染一律 `textContent`，
  从根上杜绝 XSS；发言接口走 JWT 认证，未登录返回 401；
- **兼容**：原通知栏的折叠交互（含 localStorage 记忆）保留；
  父页面 `postMessage` 的系统通知继续支持，以居中系统条形式
  本地展示（不落库）。

新增模块 `core/src/web_notes.js`（存储与清洗），路由
`GET/POST /api/notes`，页面 `web/right.html`（default 主题已同步）。

### 修复：最后一个 WebSocket 客户端断开 → 面板进程崩溃（既有 bug）

`web_service.js` 的 socket `disconnect` 处理器里写的是
`stopBroadcastTail()`——**这个函数从来不存在**，实际叫 `stopLogTail()`。
后果是最后一个面板页面关闭 / 断线时抛 `ReferenceError`，
整个 Web 服务进程直接退出。本次端到端测试踩中后改为正确函数名，
并在 `web_notes.test.js` 里加了防退化断言。

### 测试

新增 `core/test/web_notes.test.js` 34 项：内容清洗（\r 归一、控制字符、
500 字截断）、空正文拒绝、邮箱小写化、200 条裁剪、坏文件容错、
路由接线（GET/POST /api/notes、JWT 发言人、socket.io 广播、400/401）、
前端静态断言（拉历史、实时通道、轮询兜底、聊天室布局、textContent
防注入、折叠兼容、未登录提示）、主题副本一致性。
端到端验证：真实面板起服后发言 / 空正文 400 / 未登录 401 / 列表 /
持久化文件落盘 / 双用户跨邮箱实时广播 / 客户端断开后服务存活，全部符合预期。
全量回归 34 个测试文件通过。

---

### 四、面板启动服务器时 L 模式同步进入日志跟踪

### 背景

L 模式（长命令 REPL）与 Web 面板共用同一个 wow 进程（V3.5.19）。
但面板点「启动服务器」走的是 `/api/exec` → **子进程** `wow server start`：
MC 的输出只落进 `logs/wow-stdout.log`，主进程的 REPL 终端什么都看不到。
用户在面板里启动了服务器，终端却毫无动静——而在 REPL 里直接敲
`server start` 是能看到实时日志的（开服控制台接管终端）。

### 实现

REPL 里轮询 `ServerManager` 的控制台中继心跳（`isConsoleRelayAlive`，
250ms 一刷、3s 过期）：

- **「死 → 活」跳变** = 服务器刚被面板（或其它进程）启动 → 进入日志跟踪；
- 进入 REPL 时服务器已在运行 → 直接跟进；
- **心跳消失** = 服务器退出 → 自动退出跟踪并提示。

跟踪的实现是**增量 tail** `logs/wow-stdout.log`：每 500ms 读新增字节、
按完整行打印（半行留到下一轮拼接），日志被重写（重启）时 offset 归零。
打印复用 WebCLI 回显的通道：先清行、写日志、再重绘 `wow>` 提示符，
不打断用户正在输入的内容。

两个边界：

- 在 REPL 里**自己敲** `server start` / `restart` 不触发跟踪——那种情况
  由开服控制台接管 stdin（支持 MC 指令直发与三视图切换），比只读跟踪更全；
- 跟踪期间 REPL 照常可用：`server stop`、`scheme list` 等指令随时能敲。

### 测试

`interactive_menu.test.js` 扩到 65 项（新增 6 项：心跳跳变判定、增量 tail、
printLine 复用、ownServerOp 边界、退出清理、已运行场景）。
另用伪造心跳 + 日志文件做了两轮端到端模拟：面板后启动、进入前已运行，
日志实时回显、半行拼接、自动退出跟踪全部符合预期。

---

### 五、JVM 模板 a/b/c/d

### 一、JVM 模板改为 a / b / c / d 四档

| 档位 | 定位 | 说明 |
|------|------|------|
| a | 低配 / 极致省内存 | SoftMaxHeapSize + G1 调优全家桶，-Xmx2500M 封顶 |
| b | 平衡 / 主力首选 | **Aikar's 标准旗标**（含 `-Daikars.new.flags` 标记），默认档 |
| c | 性能 / ZGC 低延迟 | 分代 ZGC（`-XX:+ZGenerational`），固定 8G |
| d | 自定义 | 完全由 override_args 决定，缺 -Xmx 自动补 -Xmx2G |

旧档位名平滑映射（`g1→b`、`zgc→c`、`custom→d`），老配置不炸。
GC 互斥铁律在四档下依然成立（b + override ZGC → Aikar 的 G1 系全剥）。
显式 `--memory` 覆盖堆参数的逻辑抽成 `applyMemoryOverride` 共用
（CLI 启动与 Web 预览同语义），非法格式与空值不碰参数。

### 二、JVM 配置整体移到设置页

仪表盘的「🧩 JVM 参数」文本框**删除**（连同其加载 / 保存 JS），
JVM 相关配置现在只有设置页一个入口：模板下拉（a/b/c/d）+
覆盖参数 + 「最终启动预览」。

### 测试

`jvm_args.test.js` 更新为四档断言并扩到 33 项（applyMemoryOverride、
别名映射、c+override G1 互斥）。端到端：真实面板 preview-jvm
（b 默认 Aikar 旗标、c+999G 显式覆盖 → over_limit:true）。
全量回归 37 个测试文件通过。

---

### 六、607 JVM 模板系统 & REPL 回显重复修复

### REPL 回显重复（aaaassssddddffff）——stdin 双消费者残留点清理

上一轮修复了 `clone-client`，但 REPL 里还有几条命令在提问时**自建 readline**：
两个 readline 同时挂在 TTY 上时每个字符都被回显两遍（用户看到
`aaaassssddddffff`）、输入也可能被 REPL 抢走。触发点不在 clone-client
而在这里，所以「不知道什么时候触发，但频率很高」。

| 命令 | 修复 |
|------|------|
| `sync login` | REPL 内借用 REPL 的 readline；独立运行才自建 |
| `config server-quick` | `quickSet()` 补传已有 readline（本来就支持，调用处漏传） |
| `pack install` / `pack generate` | 借用 REPL 的 readline |

新增 `borrowRl()` 统一出口：凡 REPL 内可能提问的命令一律从这里拿
readline。pty 实测密码提问单次回显、`server-quick` 无未知指令。

### 607 JVM 模板系统

JVM 参数从「一坨 `server.jvm_args` 数组」升级为**模板 + 覆盖**新结构：

```yaml
server:
  jvm:
    template: g1        # g1 | zgc | custom
    override_args: []   # 用户覆盖参数
```

- **一、废弃迁移**：按指令直接以新结构初始化 DEFAULTS，
  **不编写旧 `server.jvm_args` 的迁移代码**，旧键不再被任何路径读取；
- **二、parseArgs（严禁 split）**：新增 `core/src/jvm_args.js`，
  引号感知解析器——`-Djava.library.path="C:\Program Files\xxx"`
  解析为**单个元素**（双/单引号皆可，未闭合容错）；
  Web 端传参必须给 JSON 数组，由后端安全合并；
- **三、GC 互斥（绝对铁律）**：override 声明 `UseZGC` → 模板的
  `UseG1GC` 与所有 `-XX:G1*` 全剥；声明 `UseG1GC` → 反之全剥；
  手滑两种都写 → 互斥复查兜底只留一种。G1 与 ZGC 绝不同现于一条命令；
- **四、80% 物理内存红线**：`os.totalmem()` 比对最终命令中的 -Xmx
  （override 优先，模板兜底），超红线在 **spawn 之前**中断启动并红字报错：
  `❌ 内存分配过高：当前系统物理内存 X G，您分配的 -Xmx 为 Y G。……`
  为此修正了 `start(memory='2G')` 的默认参数语义——**默认值不再视为
  显式指定**，否则 override 的 -Xmx 会被静默替换、红线形同虚设；
- **五、custom 兜底**：custom 模板且无 -Xmx → 强制注入 `-Xmx2G`；
- **六、-javaagent 独占**：`auth.enable`（外置登录）开启时，
  用户在 override_args 手填的所有 `-javaagent` 一律剥离，
  authlib-injector 由 wow 独家托管注入（未开启外置登录则不干涉）；
- **七、Web 预览一致性**：设置页新增「🖥️ 最终启动预览」——前端**零拼接
  逻辑**，模板下拉 / 覆盖参数文本域变动时防抖 500ms 请求
  `POST /api/config/preview-jvm`，后端跑完完整链路返回最终
  `java … -jar server.jar nogui` 字符串，前端用 `textContent` 原样展示，
  并提示自动移除 / 注入了哪些参数、内存是否超红线。

配套改动：`config_schema` 登记两个新字段（旧键移除，Web 保存自动忽略）；
设置页 / 仪表盘的 JVM 文本框改绑 `server.jvm.override_args`；
菜单「修改 JVM 参数」改用 parseArgs（原先用 `split(/\s+/)`，同样违规）。

### 测试

新增 `core/test/jvm_args.test.js` 32 项：parseArgs 引号语义、GC 互斥
四场景、custom 兜底、堆参数去重（override 的 -Xmx 压掉模板同类项，
JVM 只认第一个同名参数）、agent 独占、红线边界（6G/8G 恰好放行、
6.5G/8G 拦截）、配置结构与全部接入点静态断言。端到端：mock 核心走
`_buildCommand` 验证五种 memory / override 组合的最终参数；
真实面板验证 preview-jvm 接口（含 999G 超红线的完整报文）。
全量回归 37 个测试文件通过。

---

### 七、全面优先复用 pool & 克隆客户端三处硬伤

### 一、所有「创建方案」路径优先复用共享池

在此之前，池只是个「事后登记处」：建方案照样从头下载核心、复制模组，
完事再往池里塞一份。现在反转过来——**先看池里有没有，有就直接用**。

- `SchemeManager.findPoolCore(type, version)`：在 `pool/cores/<type>/<version>/`
  下按前缀匹配候选，评分选优（文件名含 `server` +1000、`.jar` +100、
  含 `installer` −500，同分取体积大的），返回 `{ path, hash }`；
- `SchemeManager.materializePoolCore(type, version, schemePath)`：
  **单文件核心**（vanilla / paper 等）直接复制进方案并 `ref_count` +1，
  完全跳过 `installer.install` 的下载流程；
- **安装器型加载器**（forge / neoforge / fabric / quilt）不能这样省——
  它们依赖 `libraries/` 与启动脚本，单靠一个核心文件起不来。于是改为
  「安装器照跑，但把原版核心的下载省掉」：`installer` 新增
  `_findPooledVanilla(mc)`，预下载前先查 `pool/cores/vanilla/<mc>/`，
  命中就打印 `♻️ 复用 pool 中的原版核心` 并跳过下载。

### 二、`scheme clone-client` 三处硬伤

用户实测 `wow scheme clone-client ~/test-minecraft` 撞上的三个问题：

| 现象 | 根因 | 修法 |
|------|------|------|
| 报 `❌ 未知指令: asdf`，方案名变成 `asdf` | REPL 与交互提问**各挂了一个 readline**，同一个 stdin 被消费两次，字符被两个消费者抢走 | 见下方「stdin 单消费者」 |
| 第 2 步 EACCES，只「已复制 1 个文件」 | 复制源取的是 `versions/<实例>/`，而那里只有版本 json 与客户端 jar，没有 mods | 见下方「版本隔离」 |
| 模组根本没复制过去 | 同上——mods/config/saves 在**游戏根目录**，不在版本目录 | 同上 |
| Forge 预下载卡 7%、ETA 2669.8s | 无低速熔断，慢源会一直被拖着 | 见下方「下载熔断」 |

**版本隔离**（`client_clone`）：新增 `gameDir` 判定——若 `resolved.rootDir`
下存在 `mods/`、`config/`、`saves/`、`defaultconfigs/`、`kubejs/` 之一，
说明游戏数据在根目录，复制源就用根目录；否则才用 `instanceDir`。
`saves/` 迁移也同步改用 `gameDir`。另外 `copyWhitelisted` 新增
`excludeNames`（跳过 `<实例名>.jar`、`launcher_profiles.json` 等启动器垃圾）
与 `destRoot`（目标在源内时跳过，防止 `ENAMETOOLONG` 无限递归），
复制到 0 个文件时给出告警而不是装作成功。

**下载熔断**（`installer`）：`_downloadFile` 重写为带速度窗口的版本——
`minSpeedBps` / `probeMs` / `stallMs`，每 5s 采样一次，停滞或过慢就
`destroy` 流并删掉半截文件，交给下一个源。`_downloadFirst` /
`_downloadWithFallbacks` 在**有备用源**时启用阈值（80KB/s、15s 探测、
20s 停滞），最后一个源降级为只查停滞（30s）。本地 mock 验证：1KB/s 的
慢源在 17s 内被熔断并切到快源，内容校验通过。

**stdin 单消费者**（`cli`）：`rl.pause()` 这条路走不通——另一处 readline
`resume()` 后 pause 就失效了。最终方案是 **借用 REPL 自己的 readline**：
新增 `makeReplIO(session)` 实现 `ask` / `choose` / `log` / `warn`，
交互期间 `suspended = true` 让 REPL 丢弃收到的 line，结束后恢复。
pty 实测：修复前回显 `aaaassssddddffff` 并报未知指令，修复后方案名
`aassddff` 完整、无未知指令、`wow>` 只出现一次。

### 三、面板新增两个页面

- **🧩 模组管理**（`web/mods.html`）：左栏当前方案的 mods / plugins，
  右栏共享池的 cores / mods / plugins；支持**启用-禁用切换**
  （`mods/` 加去 `DISABLED_` 前缀、`mods-disabled/` 移回并去前缀）与
  **池 ↔ 方案双向复制**（`pool2scheme` / `scheme2pool`），顶部可切方案。
  后端 `GET /api/resources`、`POST /api/resources/toggle`、
  `POST /api/resources/copy`。
- **📝 实例配置**（`web/props.html`）：把 `server.properties` 按 7 个分组
  渲染成卡片，布尔/数字/枚举分别用开关/输入框/下拉；改动项高亮，
  **只提交变化的键**，可查看原始文件，文件不存在时给一份默认值。
  后端 `GET /api/props`、`POST /api/props`（`core/src/server_props.js`：
  保留注释与顺序、就地替换、新键追加末尾、非法键名整批拒绝）。

### 四、修复：Web 面板报「方案不存在」

`web/scheme.html` 里有三处把方案名直接拼进 URL 或命令串：详情请求
`/api/scheme/<name>/status` 未编码（含空格、`#`、中文的方案名必挂）、
`scheme switch` / `scheme delete` / `scheme info` 用字符串拼接传参。
现统一改为 `encodeURIComponent` + `{cmd, args:[name]}` 数组形式；
`web/set.html`、`web/tool.html` 的 `plugin remove` 等同样修正。

### 测试

新增 `core/test/pool_reuse.test.js`（8 项，含 `wow.yaml` 备份恢复）、
`core/test/web_pages.test.js`（20 项）；`client_clone.test.js` 扩到 61 项
（新增「版本隔离」用例，并改为断言**不复制**客户端 jar，原先的
`<实例名>.jar.client-jar.bak` 不再产生）。全量回归 36 个文件通过。

---

## [3.6.1-26.42] — 2026-11-07

> 本版本全是**修 bug 与修体验**：把几个「照着提示做却行不通」的地方掰直。
> 没有新功能，但这些问题都是真实用户会一头撞上的；顺带把开发期目录挪出了发行包。

### 本版本一览

| 问题 | 表现 | 修法 |
|------|------|------|
| `wow config set` 不存在 | 照隧道提示敲，报 `unknown command 'set'` | 补上 `set` / `get` / `unset` 三个正式子命令 |
| 面板滚轮无效 | 仪表盘、设置页内容被裁，滚不动 | `body` 默认改为可滚动，外壳单独关闭 |
| 方案下拉误导 | 方案库根目录被标成「服务器根目录」 | 改称「方案库根目录」并说明目录结构 |
| `wow m` 没了 | 双击进菜单，命令进不去 | 恢复 `wow m`，且 M ↔ L 可互跳 |

---

### 1. M / L 模式互跳


###### 背景

V3.5.8 把 `wow m` 移除了，只保留「无参数 → 菜单」。但实际使用里有两个别扭：

- 双击 `wow.bat` / `./wow.sh` 进的是菜单（M 模式），可在终端里想主动进同一个界面时，
  只能重敲 `wow`，敲 `wow m` 反而提示「未知指令」——同一个界面有两个入口，只有一个能用；
- 进了 L 模式（长命令）之后，想切回菜单只能 `exit` 退出程序再重开。

###### 本次改动

1. **恢复 `wow m`（别名 `M`）**：与双击进入的是同一个界面，两条路指向同一个入口。
2. **L 模式输入 `m` 回到菜单**：不退出程序、不关 Web 面板，直接切回 M 模式。
3. **M 菜单新增第 15 项「进入 L 模式」**：补上反方向的路，M ↔ L 形成闭环。

###### 实现要点（踩过的坑）

- **stdin 只能有一个消费者**：菜单与 REPL 各建一个 readline 挂同一个 `process.stdin`，
  按键会被读两遍（终端回显成双份）。因此切换时必须先关掉当前 readline，
  并在 close 回调里**让出一轮事件循环**（`setImmediate`）再建下一个。
- **关闭后的残留 line 事件**：`rl.close()` 之后已排队的 `'line'` 事件仍会被派发，
  管道输入尤其明显——关闭后的输入会被当成指令执行。加 `closed` 标志挡住。
- **循环依赖**：`interactive.js` 不能 `require('./cli')`（cli 正在加载 interactive），
  改为由 `buildMenuOptions()` 注入 `startRepl` 回调。
- **回菜单 ≠ 退出**：L 的 close 回调里 `toMenu` 分支不能触发 `onExit`，
  否则会把 Web 面板一起关掉。

###### 测试

`interactive_menu.test.js` 59 项（新增 7 项覆盖 M 命令注册、`enterMainMenu` 抽取、
L→M 的 `toMenu` 分支、`closed` 标志、菜单 15 号项与回调注入、无循环依赖）。
全量回归 31 个测试文件全绿。

---

### 2. `wow config set` 不存在


###### 问题

隧道认证闸门拦住用户后给出补救办法：

```
wow config set web.auth_token  一串足够长的随机字符
wow config set web.auth_password 你的密码
```

照着敲却得到 `error: unknown command 'set'`——因为 CLI 里**从来没有 `set` 子命令**，
真正的写法是 `wow config wow <key> [value]`（子命令名就叫 `wow`）。
更糟的是这个错误写法散布在文档、AI 日志建议、错误提示里**几十处**，
等于把每个遇到闸门的人都引到死胡同。

###### 修复

- 新增正式子命令 **`config set <key> <value>` / `config get <key>` / `config unset <key>`**
- `config wow <key> [value]` 保留为兼容入口，输出格式不变（不打断依赖它的脚本）
- **凭据类键不回显明文**：`auth_token` / `auth_password` / `api_key` / `token` /
  `password` / `secret` 结尾的键，设置后只显示长度，读取时打码成 `ab******op`
- `unset` 写入真正的 `null`（不是字符串 `"null"`——后者会让「未设置」判定失效）

###### 顺带修的判定顺序问题

`config get` 原本先判「是否凭据类」再判空，导致 `unset` 之后 `String(null).length === 4`
被当成「已设置，长度 4」。改为先判 `null` / `''` / `undefined` 再打码。

###### 测试

新增 `core/test/config_cli.test.js` 10 项：三个子命令可用、凭据打码、`unset` 写 null、
旧写法兼容且保持明文回显、文档里的 `config set` 语法与 CLI 一致（防再次退化）。

---

### 3. Web 面板内容页无法滚动


###### 问题

Web 面板里内容超过一屏的页面（仪表盘 / 设置 / 工具箱）**滚轮完全无效**，
底部内容直接被裁掉，Edge 与 Chrome 均复现。设置页最严重：内容高 2957px，
视口只有 700px，底下两千多像素永远看不到。

###### 根因

`web/css/main.css` 开头的全局重置里写了 `html, body { overflow: hidden }`。
这份样式被**所有 iframe 内嵌页面共用**——它本来是给主框架外壳用的，
但仪表盘、设置这些内容页也继承了它。页面内容不在任何可滚容器里，
body 又被禁止滚动，于是超出视口的部分直接消失。

###### 修复

- `main.css`：html 保持 `overflow: hidden`（防双滚动条），**body 默认改为
  `overflow-y: auto`**，内容页不需要包一层滚动容器就能滚；
- 新增 `body.shell` / `body.no-scroll` 关闭滚动的出口，外壳 `index.html` 挂上 `shell` 类；
- 补 `body::-webkit-scrollbar` 主题化样式（原来的 `iframe::-webkit-scrollbar`
  只作用于 iframe 元素本身，管不到 body 滚动条）；
- `left.html` / `right.html` 侧栏自带 `overflow: hidden`，行为不变。

###### 验证（无头浏览器实测）

| 页面 | 修复前 | 修复后 |
|------|--------|--------|
| dashboard.html | 内容 1064px，滚轮无效 | ✅ 滚到底（364px 行程） |
| set.html | 内容 2957px，滚轮无效 | ✅ 滚到底（2257px 行程） |
| tool.html | 内容 717px，滚轮无效 | ✅ 滚到底 |
| 外壳 index.html | — | ✅ 自身无滚动条，iframe 内滚轮正常 |
| 手机端 390px | — | ✅ iframe 内可滚到底 |
| 登录页 | — | ✅ 居中布局不变 |

###### 测试

新增 `core/test/web_scroll.test.js` 14 项，锁定上述不变量（含「内容页不得
再给 body 写 overflow hidden」的防回归断言）。

---

### 4. 文件管理「服务器根目录」文案误导

文件管理页的方案下拉框有个空值选项，原本标成「**服务器根目录**」。
但新建的方案都放在**方案库 `scheme/` 的子目录**（`scheme/<方案名>/`）里，
叫「服务器根目录」会让人以为方案建到了真正的服务器根目录上。

- 空值选项改为「**方案库根目录**」（三处：初始渲染、动态填充、异常兜底）
- 下拉框悬停提示补充目录结构说明：`scheme/<方案名>`
- 仅当配置了 `server.scheme`（有正在运行的方案）时，该入口才等价于服务器根目录

### 5. 发行包剔除开发期目录

`.gitattributes` 新增两条 `export-ignore`，对 `git archive`、GitHub / Gitee 源码 zip 均生效：

| 目录 | 为什么剔除 |
|------|-----------|
| `deploy/cfproxy-worker` | 给自建代理的人单独部署的 Cloudflare Workers 脚本，装好 wow 的用户用不上 |
| `scripts` | 发版打包脚本，只服务维护者 |

仓库内两个目录原样保留，`npm test`、发版流程不受影响。此前 `core/test` 已按同样方式剔除。

---

## [3.6.0-26.41] — 2026-11-06

> 本版本主题：**把「方案」变成可搬运的资产**——从客户端克隆方案、跨设备同步方案，
> 再到执行端自动从 Modrinth 补齐模组。同时补齐 CurseForge 的多层降级链路。

### 本版本一览

| 能力 | 命令 | 一句话 |
|------|------|--------|
| 跨设备方案同步 | `wow sync login/push/list` | 清单先行、差量上传、断点续传、执行端组装入池 |
| Modrinth 补齐 | （同步内置） | pool 未命中 → 查 Modrinth → SHA-256 校验 → 复用 |
| 客户端一键克隆 | `wow scheme clone-client` | 从 .minecraft 实例直接产出可用方案 |
| 客户端模组隔离 | `wow mod client-filter` | 开服前自动剔除钠之类的客户端专用 mod |
| CurseForge 降级 | （mod 安装内置） | 代理 → BYOK → 本地缓存 |
| cfproxy Workers 版 | （部署件） | 单文件零依赖的 Cloudflare Workers 代理 |

### 1. 跨设备方案同步（`wow sync`）


#### 为什么要做

同一份服务端方案要在两台机器之间搬家：家里电脑调好了方案，VPS 上跑 `wow web start`。
以前靠手工 scp + 逐个目录对齐，容易漏文件、漏配置。现在一条 `wow sync push` 完成：
清单先行、差量上传、哈希校验、执行端自动组装入池。

两端跑的都是同一份 wow（谁都可以是控制端或执行端），没有角色区分的协议差异。

#### 架构

- **控制端**：方案所在的一方。`wow sync login <url>` 存 JWT，`wow sync push` 生成清单并上传缺口。
- **执行端**：跑 `wow web start` 的一方。开放 `/api/sync/check`、`/api/sync/upload`、`/api/sync/upload/status`、`/api/sync/finalize` 四个端点（全部走认证中间件）。
- 网络路径：公网 IP / Cloudflare Tunnel / EasyTier 虚拟 IP 均可，只要控制端能 HTTP 访问到执行端即可。

#### 四阶段流程

1. **清单先行**：控制端扫描方案，产出 `manifest.protocol = 1`（核心 + 模组 + 插件 + 其它文件 + root 配置，全部带 SHA-256 与大小）。
2. **执行端预检**：逐文件判定缺口（missing / already_present），方案名冲突拒绝（同步来源的方案允许重推做增量）。
3. **差量上传**：小文件（≤4MB）打包 JSON 束（base64）；大文件走 8MB 分块上传，断点续传（偏移不连续返回 409 + `expected_offset`；收齐后哈希不匹配返回 422 并清掉 staging）。所有上传统一进 `core/temp/sync_staging/<方案>/<sha256>.part`。
4. **组装**：finalize 是唯一往方案目录写文件的地方——staging 校验落盘、核心走 installer 装配（与 `scheme create` 共用）、`server.properties` 覆盖前备份为 `.bak`、入池登记、写 `sync_source`/`synced_at`/`sync_report`、state: full。**不自动启动**，由用户 `scheme switch` 后手动开服。

#### 安全边界

| 边界 | 规则 |
|------|------|
| 方案名冲突 | 非同步来源一律 409 拒绝，不覆盖不合并 |
| 配置文件 | `server.properties`/`eula.txt` 默认不覆盖；`--with-config` 才覆盖且先备份 `.bak` |
| 存档 | `world` 仅在显式 `--with-world` 时同步 |
| 单向 | 只能控制端 → 执行端，执行端不回传 |
| 类型白名单 | `.jar/.json/.toml/.yaml/.yml/.properties/.cfg/.txt/.dat/.mca/.mcr/.tar` |
| 路径白名单 | `mods/plugins/config/kubejs/scripts/datapacks/world` + root 两文件；拒绝 `..`/绝对路径/盘符/UNC/符号链接（safeResolve 主闸门 + isPathAllowed 纵深） |
| 大小限制 | 单文件 ≤200MB，总量 ≤2GB |
| 哈希 | 上传声明哈希 + 落盘前重算，双保险 |
| 认证 | 复用 Web 面板 JWT（`wow sync login` 存凭据） |

#### 实现过程中的关键取舍

- **核心装配放 finalize 不放 check**：Forge 安装器要下几十 MB + 跑 Java，挂在 HTTP 请求里会被 Cloudflare Tunnel ~100s 超时掐断。
- **同步来源的方案允许重推**：单纯按方案名冲突拒绝会挡住增量同步与断点续传；判据是 `scheme.yaml` 里的 `sync_source` 标记，手工方案 / clone-client 产物仍然拒绝。
- **断点续传以执行端为准**：控制端本地进度文件（`core/temp/sync_progress.json`）只做展示参考——执行端 staging 可能被清理，本地「已传完」不可信。

#### 实现过程中遇到的坑

- **Modrinth CDN 慢到离谱时没有兜底**：最初只有 socket 空闲超时（60s），但「一直有数据但极慢」的情况会挂满整个请求。加了整体时限 + 总预算两道闸。
- **单批失败被误判为「未收录」**：`consecutiveFailures` 只数到 1 就结束循环，返回 `ok: true`，导致 reason 显示「Modrinth 未收录」而不是「不可达」。修正为「一批都没成功 = 不可达」。
- **`downloadToTemp` 漏掉 URL 参数**：日志里原本不带下载地址，排障时不知道是哪个文件失败。

#### 命令

```bash
wow sync login <url> [-p password]   # 存 JWT 凭据（keyed by URL）
wow sync push <url> [--scheme X] [--name Y] [--with-world] [--with-config]
wow sync list                        # 查看已保存的执行端
```

#### 测试

- 新增 `core/test/sync_module.test.js`：路径白名单 17 项、清单结构与三路哈希 18 项、multipart 解析 5 项、staging 续传基建 5 项、Modrinth 补齐 21 项（命中 / 哈希不匹配 / 未收录 / 不可达 / 单批不可达 / 分批 / 预算耗尽 / 旧清单 / 临时目录清理）。
- 全量回归 31 个测试文件通过。
- 端到端实测：全量推送 6 文件（含 6MB 分块上传）、增量重推（5 就位 + 1 分块续传从 8MB 断点恢复）、`.bak` 备份、手工方案 409、路径白名单拒绝、422 哈希校验 + staging 清理、执行端 `scheme info` 正确识别。

#### 文档

- 新增 `docs/SYNC.md`（架构 / 命令 / 网络路径 / 边界表）。
- `docs/COMMANDS.md` 增加 `sync` 命令组。

---

### 2. Modrinth 补齐（216 号议题）

缺口补齐从「pool 未命中 → 需上传」补成「pool 未命中 → 查 Modrinth → 哈希匹配则复用 → 不匹配才需上传」。

- **清单协议升到 2**：mods/plugins 条目增加 `sha512` / `sha1`。一次读盘三路哈希并行（`hashTripleFile`），不重复读盘。SHA-256 仍是唯一写入依据，另外两个只用于查询 Modrinth。
- **批量查询**：`POST /v2/version_files`，每批 100 个哈希、批间隔 200ms、单批 30s 超时；SHA-512 被拒（400/422）时该批降级 SHA-1 重试一次；连续 3 批失败或一批都没成功 → 判为不可达，全部降级需上传。
- **下载后必须过 SHA-256**：不匹配就丢弃并标记 `modrinth_hash_mismatch`；落盘路径一律用清单 `path`，不用 Modrinth 的 `filename`（防路径注入）；临时目录 `core/temp/sync-modrinth/<session>/` 用完即清，进程被强杀时下次运行兜底清理。
- **90s 总预算**（`WOW_MODRINTH_BUDGET_MS`）：check 是 HTTP 请求，不能被慢下载挂死；超预算的文件转需上传，同步照常完成。
- **旧清单兼容**：`protocol: 1` 的清单无 sha512/sha1，直接跳过查询按需上传。
- **报告可读**：控制端新增「模组来源分布」——pool 命中 / Modrinth 补齐 / 需上传（并说明每个文件为什么还要传）。
- 不查 CurseForge，全程不碰。

### 3. 客户端一键克隆为方案（`wow scheme clone-client`）


#### 为什么要做

玩家手里通常已经有一个调好的客户端整合包（Forge 实例 + 几十个模组 + 配置 + 存档）。
想开服只能手动搬：复制 mods、找服务端核心、跑 Forge 安装器、清客户端模组、搬存档、
删 session.lock……每一步都有坑，最后还往往起不来。

本版把它压成一条命令：`wow scheme clone-client <客户端路径>`。

#### 核心约定：产物是方案，不是目录

不是「把 `.minecraft` 复制一份」，而是三步：

1. **先建方案骨架**（复用 `scheme create` 的目录与 `scheme.yaml` 逻辑，但**不触发核心下载**）；
2. **再往方案目录里填内容**（白名单复制 → 核心装配 → 存档迁移 → 模组清洗）；
3. **结束时入池登记、状态转 `full`**。

所以克隆完成后 `scheme list` / `scheme switch` / `server start` 全套可用。

#### 新增 `core/src/client_clone.js`

九步流水线，每步都是独立可测的函数：

| 步骤 | 函数 | 关键决策 |
|------|------|----------|
| 0 · 定位实例 | `resolveInstance` / `detectInstanceMeta` | 支持根目录 / 实例目录 / 未开隔离，向上找 2 级 |
| 1 · 建骨架 | `createSkeleton` | `state: partial`，识别失败就不建 |
| 2 · 白名单复制 | `copyWhitelisted` | `saves/` 不在这里搬；关键文件失败即中止 |
| 3 · 核心装配 | `installCore` | 走 `installer.install()`，不是 `wow install` |
| 4 · 存档迁移 | `migrateWorld` | 删 `session.lock`，保留 `datapacks/` |
| 5 · 模组清洗 | `cleanMods` | 元数据 > 名单，`force_keep` 最高 |
| 6 · 平台兜底 | `fillPlatformDefaults` | 已存在就不覆盖 |
| 7 · 入池登记 | `registerToPool` | 核心 + 模组入池，写 `clone_report` |
| 8 · 报告 | `buildReport` | 逐条列出被禁模组的名字与原因 |

#### 实现过程中发现并修正的四个判断错误

**1. 现代 Forge 的 `mainClass` 里没有 "forge"**

1.17 之后 Forge/NeoForge 客户端的 `mainClass` 是
`cpw.mods.bootstraplauncher.BootstrapLauncher`，`libraries` 里也可能只有分包。
只按 `mainClass` 判断会把 Forge 实例误判成原版 —— 然后拿 vanilla 核心去跑
几十个 Forge 模组。补了三条兜底：`--launchTarget` 参数 → `--fml.forgeVersion` → 实例目录名。

**2. `mods.toml` 里没有「纯客户端」标记**

需求原文写的是「`META-INF/mods.toml` 的 `side = "CLIENT"`」，但 Forge 的
`mods.toml` 里并没有这个字段。真实语义是 `[[dependencies.<modid>]]` 段里的
`side="CLIENT"`，意思是「这条依赖只在客户端需要」，**不代表模组本身不能加载**。
拿它判定会错杀（比如某个服务端也需要的模组只是声明了客户端依赖）。
所以 Forge 端只认 `mcmod.info` 的 `clientSideOnly: true`（那是真正可靠的），
其余靠 modid 名单兜底。

**3. `isCriticalPath` 的 config 判断偏了一位**

`rel.indexOf('/', 'config/'.length)` 会跳过 `config/a.toml` 这种直属文件，
只认 `config/sub/x`。结果 `config/` 下的普通文件失败时不中止，与需求不符。已改成正则。

**4. `wow scheme info` 的模组数永远是 0**

既有缺陷：`info` 读 `meta.mods`，但该字段从不存在（真实位置是 `meta.resources.mods`），
所以任何方案都打印「模组数: 0」，连装了几十个模组的方案也是 0。顺手修了，
并补了「状态」「来源」「克隆时禁用数」三行。

#### 不删任何文件

需求总则是「不自动删除任何文件」，落实到三个具体位置：

| 场景 | 处理 |
|------|------|
| 客户端核心 `<实例名>.jar` 混进方案目录 | 改名 `<实例名>.jar.client-jar.bak` |
| 目标 `world/` 已有内容 | 挪成 `world.pre-clone-<时间戳>.bak` |
| 客户端模组 | 移到 `mods-disabled/` |

（`session.lock` 是例外 —— 它是服务端会自己重建的运行时锁，带着它服务端直接启动失败。）

#### 命令

```bash
wow scheme clone-client <路径>                    # 交互式
wow scheme clone-client <路径> --dry-run          # 只识别不创建
wow scheme clone-client <路径> --yes              # 全默认值
wow scheme clone-client <路径> -n mysrv --save 生存世界 --keep-mods jei
```

#### 测试

新增 `core/test/client_clone.test.js`（60 项）：路径展开（`~` / 转义 / 引号 / `file://`）、
方案名校验（路径分隔符 / 保留名 / 点开头结尾）、五种加载器识别（含现代 Forge 的
`launchTarget` 兜底）、路径判定（根目录 / 实例 / 未开隔离 / 向上 2 级 / 完全不相关）、
白名单复制（剔除项 / `saves` 不由第 2 步搬 / 未列出目录保守保留）、
核心装配（走 `installer.install` / 客户端 jar 改名）、存档迁移（删 `session.lock` /
保留 `datapacks` / `world` 冲突留档）、模组清洗（四种判定 / `force_keep` 压过元数据 /
只移动不删除 / 重名不覆盖）、平台兜底（不覆盖已有文件）、报告（列出模组名与原因）、
整体流程（核心失败回滚 / 全流程成功且产物可被 `_schemeExists` 认回）。

不联网、不动真实 `scheme/` 目录 —— 核心装配用打桩 installer。
真实 Forge 装配要下安装器跑十几分钟，不适合单测。

#### 文档

新增 `docs/CLONE_CLIENT.md`：九步流水线逐条说明、四个判断错误的来龙去脉、
边界保证表、常见问题。

---

### 4. 客户端专用模组自动隔离

> 状态：**已开发完成，尚未发行**。按 `docs/RELEASE_POLICY.md`，版本号待「发行」时统一定。

#### 为什么要做

整合包（尤其 CurseForge 一键导入）常把客户端模组和通用模组混在同一个 `mods/` 里。
Sodium、Iris 这类纯客户端模组被服务端加载时，轻则 `ClassNotFoundException` 刷屏，
重则整个服务端起不来——而报错通常指向「某个 mixin 注入失败」，
与「你装了个客户端模组」这件事**完全看不出因果关系**。

本版在开服前扫一遍 `mods/`，把确定的客户端模组挪进 `mods_client_disabled/`，
把「必然崩」变成「不崩」。

#### 新增 `core/src/client_mod_filter.js`

四条设计原则，每条都对应一个具体的失败模式：

| 原则 | 防的是什么 |
|------|-----------|
| **只移动不删除** | 误判的代价必须可逆。全进 `mods_client_disabled/`，挪回即恢复 |
| **以 jar 内部元数据为准** | 文件名带 `sodium` 的可能是服务端兼容版；名字无害的可能就是客户端模组 |
| **宁可漏杀不可错杀** | 读不出元数据就放过（计入 skipped），只有铁证才动手 |
| **不阻断启动** | 整个流程包在 try 里，任何异常只警告。隔离逻辑不能成为「起不来」的新理由 |

#### 判定依据（分两层，元数据优先）

**第一层 · 元数据铁证**（`by: 'meta'`）：

- `fabric.mod.json` 的 `environment` 为 `client` / `client_only` / `clientside`
- `fabric.mod.json` 的 `entrypoints` **只有 `client`**，没有 `main` 也没有 `server`

**第二层 · modid 命中名单**（`by: 'modid'`）：内置 92 条，覆盖

- 渲染 / 性能：`sodium` `rubidium` `embeddium` `xenon` `magnesium` `iris` `oculus`
  `nvidium` `entityculling` `optifine` `canvas` …
- HUD / 界面：`modmenu` `jade` `wthit` `journeymap` `xaeros-minimap` `appleskin`
  `betterf3` `mouse-tweaks` `controlling` …
- 键位 / 声音 / 视觉：`amecs` `presence-footsteps` `not-enough-animations` `3d-skin-layers` …
- 连接 / 服务器列表：`serverselector` `serverlistplus` `lan-server-properties`

> 收录标准是**「服务端上要么完全无用、要么会直接崩」**。凡是存在
> 「服务端也需要」歧义的（比如 `fabric-api`、`lithium`、`carpet`）一律不收——
> 误杀比漏杀更难被发现。

**Forge 的 `clientSideOnly` 不参与判定**：`mods.toml` 里没有可靠的
「这个模组只能客户端加载」标记（`displayTest` / `side="CLIENT"` 的语义不同），
硬猜会错杀，所以 Forge 端只按 modid 名单判断。

#### 支持的元数据格式

| 加载器 | 文件 |
|--------|------|
| Fabric | `fabric.mod.json` |
| Quilt | `quilt.mod.json`（读嵌套的 `quilt_loader.id`） |
| Forge / NeoForge | `META-INF/mods.toml`、`META-INF/neoforge.mods.toml` |
| 老 Forge | `mcmod.info` |

条目路径**大小写不敏感**（jar 内路径大小写不规范是常见现象）。
不引入 TOML 解析库——只需要 `[[mods]]` 段里的 `modId`，手写正则足够，
且不会因为某个模组写了奇怪的 TOML 而整体抛异常。

#### 跳过的情况

- **原版 / 纯插件端**（`vanilla` `paper` `purpur` `spigot` `bukkit` `leaves`）
  根本不加载 `mods/`，直接不处理
- `mods/` 目录不存在（未装模组 / 原版端）
- 非 `.jar` 文件（`.zip` / `.jar.disabled` / 说明文件）
- 读不出元数据的 jar（插件、资源包、损坏文件）
- 未知 loader → 放行（不知道就别拦）

#### 覆盖名单

| 配置键 | 默认 | 说明 |
|--------|------|------|
| `mod.client_only.enabled` | `true` | 总开关 |
| `mod.client_only.extra` | `[]` | 每行一个。`xxx` 追加隔离；`-xxx` 从内置名单剔除 |
| `mod.client_only.disable_builtin` | `false` | `true` = 完全不用内置名单 |

`extra` 里支持 `xxx: 我的说明` 写法，说明会出现在日志里。

#### 命令

```bash
wow mod client-filter                 # 立即扫描并隔离
wow mod client-filter --dry-run       # 只预览，不动文件
wow mod client-filter --list sodium   # 查某个 modid 在不在内置名单里
wow mod client-filter --show          # 看隔离区里有什么
wow mod client-filter --restore       # 全部挪回 mods/
wow mod client-filter --restore x.jar # 只恢复一个
```

`--restore` 遇到 `mods/` 里已有同名文件时不覆盖，改名为 `xxx.restored-<时间戳>.jar`，
保证两份都在。

#### 边界细节

- 隔离目录与 `mods/` 同级：`mods_client_disabled/`
- **目标重名不覆盖**：已有同名文件时改名为 `xxx.<时间戳>.jar`，
  绝不覆盖用户之前手动挪过去的文件
- 单个 jar 元数据读取有 256 KB 上限，防 zip 炸弹
- 文件移动用 `fs.moveSync`，同分区内是 `rename`（原子、零拷贝）
- 幂等：第二次运行扫不到东西就静默返回
- 恢复时遇到同名文件改名为 `xxx.restored-<时间戳>.jar`，两份都保住

#### 测试

新增 `core/test/client_mod_filter.test.js`（69 项）：名单合成（追加 / 剔除 / 停用内置）、
TOML 解析（多段 / 段外 modId 不误判 / 单引号）、四种加载器元数据读取、
判定优先级（元数据铁证压过名单剔除）、加载器白名单、
移动行为（字节一致 / 不覆盖 / dryRun / 幂等）、恢复（单个 / 全部 / 冲突改名 / 目录自动创建）、
`server.js` 接入点位置断言、配置项与 schema 校验。

全程不联网、不碰真实方案目录（临时目录里现造 zip 当 jar）。

---

### 5. CurseForge 三层降级

> 状态：**已开发完成，尚未发行**。按 `docs/RELEASE_POLICY.md`，版本号待「发行」时统一定。

#### 为什么要做

CurseForge 官方 API 必须带 `x-api-key`，不带返回 `403`（实测：无 Key 与错 Key
**都是 403，且响应体为空**，无法区分）。于是没有 Key 的用户完全用不了 CurseForge 搜索。

社区有 **cfproxy** 这种「帮你补 Key 的反向代理」，但它的公共实例
`cfproxy.fly.dev` **已停服**（实测 DNS 无法解析，仓库最后推送 2022-03-04）。
所以本版**不把公共实例设为默认值**——写死一个死地址只会让每个用户先白等 5 秒超时。

#### 新增 `core/src/cf_client.js`

三层降级：**代理 → BYOK 直连 → 本地缓存**。

| 层 | 触发条件 | 说明 |
|----|----------|------|
| 一 · 代理 | `curseforge.proxy_url` 非空 | 默认关闭。自建 cfproxy 后填地址 |
| 二 · BYOK | `curseforge.api_key` 非空 | 请求官方 API，Key 走 `x-api-key` |
| 三 · 缓存 | 前两层都失败/未配置 | 过期也给，只提示「可能已过期」 |

**缓存先于网络读**：24h 内的命中直接返回，0 次网络请求——正好补上代理层无缓存的缺陷。

#### 降级判定（这里有个真实踩坑）

实测发现官方 API 对「没带 Key」也返回 **403**，所以不能简单地把 403 当成「不可降级」：

| 状态 | 直连层 | 代理层 |
|------|--------|--------|
| `429` / `5xx` / 超时 | 换层（落到缓存） | 换层（试直连） |
| `403` / `401` | **不换层，但允许缓存兜底** | 换层（试直连） |
| `404` | 直接失败 | 直接失败 |

区分成三档：`next-layer` / `cache-only` / `fail`，见 `classifyError()`。

#### URL 拼接（另一个坑）

cfproxy 的语义是「把 base `https://api.curseforge.com` 换成代理地址，**path 原样转发**」。
所以请求路径必须自带 `/v1`。实测对照：

- `https://api.curseforge.com/v1/mods/search` → `403`（缺 Key，路径正确）
- `https://api.curseforge.com/mods/search` → `404`（路径错误）

`buildUrl()` 统一兜底：无论 base 写没写 `/v1`、path 带没带 `/v1`，最终都恰好一个 `/v1`。

#### 缓存

- 位置：`core/cache/cf_mods/`，按 `file_<projectID>_<fileID>.json` / `project_<projectID>.json`
- 有效期 24 小时；写文件用 `.tmp` + `rename` 原子替换
- **只缓存确定性结果**（文件直链、项目详情）。关键词搜索不缓存——缓存 24h 会让用户搜不到新模组
- 缓存文件损坏时当作无缓存处理，不阻断主流程

#### 配置项

| 键 | 默认 | 说明 |
|----|------|------|
| `curseforge.api_key` | `''` | 新增。兼容旧的 `api_keys.curseforge` / `download.curseforge_key` |
| `curseforge.proxy_url` | `''` | 新增。留空 = 不走代理 |

#### 命令

```bash
wow cf status    # 三层配置状态 + 缓存统计
wow cf cache     # 缓存统计
wow cf clear     # 清空缓存
```

#### 整合包安装（预留接口）

`getFileDownload(projectId, fileId)` 对「作者禁用 API 分发」（`downloadUrl` 为 null）
抛出 `code === 'CF_FILE_FORBIDDEN'` 的错误，调用方据此区分「拿不到」与「网络失败」，
实现「部分失败不算整体失败，汇总提示手动下载」。

> 本轮**未**实现 CurseForge 整合包的完整安装流程（现有 `pack_generator.js`
> 只认自定义格式的 manifest，不处理 `projectID`/`fileID`）。

#### 文档

新增 `docs/CF_PROXY.md`：三层矩阵图解、降级触发表、cfproxy 的 Docker 部署、
`/v1` 的坑、缓存管理、常见问题。

#### 自建代理：Cloudflare Workers 版

新增 `deploy/cfproxy-worker/`，提供一个**单文件、零依赖**的 Worker，
可直接粘到 Cloudflare 控制台在线编辑器部署（不需要 Wrangler CLI）。

比 Docker 版多出的能力：

- **多 Key 轮换**：`CF_API_KEYS` 支持逗号/分号/换行分隔，随机挑选
- **单 Key 熔断**：429/403 后标记不健康，冷却 10 分钟
- **单请求兜底**：一个请求内会把所有未试过的 Key 试一遍（上限 3），
  不会因一个坏 Key 整体失败
- **403 语义区分**：换 Key 后仍 403 → 是作者禁用分发，原样透传
- **`GET /__health`**：自检端点，返回 Key 数量与健康状态（Key 打码，不泄露明文）
- CORS 自动处理；路径白名单只放行 `/v1/`

路径**完全透传不改写**，因此 wow~ 侧只需 `curseforge.proxy_url` 填 Worker 地址，
`buildUrl()` 无需任何改动。

已知局限（已在代码注释与文档中写明）：`keyState` 是 isolate 内的内存状态，
**不跨边缘节点共享**，也不持久化。要全局共享需 Durable Objects / KV，
但会让每次请求多一次跨网络往返，对纯转发代理不值得——正确性由
「单请求内试完所有 Key」保证，跨请求的加速只是优化。

测试：`deploy/cfproxy-worker/worker.test.mjs`（19 项，打桩不联网）。

#### 测试

新增 `core/test/cf_fallback.test.js`（33 项）：凭据组合、代理优先、5s 超时、
429/5xx/超时/403/404 的降级分流、缓存命中零请求、缓存过期兜底、缓存损坏容错、
`CF_FILE_FORBIDDEN` 语义、`buildUrl` 六种拼接组合、源码结构断言。

全程打桩、不联网（实测耗时 0.06s）。

---

### 6. cfproxy Cloudflare Workers 版

把「自建 cfproxy」做成单文件、零依赖的 Workers 脚本，`wrangler deploy` 一条命令上线：

- 只用 Workers 运行时内置的 `fetch`，不引任何 npm 包；
- 原样转发 path 与 query，仅替换 base 域名，符合 cfproxy 的语义约定；
- 可选 `CF_PROXY_TOKEN` 环境变量做简单鉴权，避免被陌生人白嫖额度；
- 用于 CurseForge 三层降级里的「一 · 代理」层，配合 `curseforge.proxy_url` 使用。

---

## [3.5.24-26.40] — 2026-11-03

> 主题：**隧道等于暴露，必须配 token**。补上公网隧道的认证闸门。

> **编号说明**：本版本最初以 `3.5.24-26.3f` 发布，后发现 `26.3f` 属于已被重复使用的
> 污染序号段（详见文首「关于序号重复」），故收回并改名为 `26.40` 重新发布。
> 功能内容与 `3f` 完全相同，仅编号变更。若你曾拿到过 `v3.5.24-26.3f` 的包，
> 它与本版本是同一份代码。

### 背景：一个被绕过的安全闸门

V3.5.16 加了 `isExposedHost` 闸门——绑定到非回环地址（`0.0.0.0`、局域网 IP）时必须配
`web.auth_token`，否则拒绝启动。但它只看**绑定地址**。

而隧道的典型用法恰恰是 `wow web start --tunnel`：

```
面板绑 127.0.0.1   →  isExposedHost() 返回 false  →  闸门放行
cloudflared 把它映射成 https://xxx.trycloudflare.com  →  实际已是公网服务
```

结果就是：**用户以为自己只开了本地，实际上面板已经挂在公网上了**，
而这条路径恰好是 `isExposedHost` 唯一漏掉的暴露方式，也是最危险的一种。

### 新增：`checkTunnelAuth()`

在 `core/src/web_service.js` 中新增并导出：

```js
function checkTunnelAuth(options = {})
```

判定逻辑：`web.auth_token` 或 `web.auth_password` 任一非空（**纯空白字符不算**，
防 `wow config set web.auth_token " "` 绕过）即放行。

拒绝时打印四段提示，含可直接照做的修复命令：

```
❌ 拒绝建立隧道：公网隧道等于对外暴露，必须先配置认证凭据！
   ...
     wow config set web.auth_token  一串足够长的随机字符
     wow config set web.auth_password 你的密码    # 离线密码登录
```

同时导出常量 `TUNNEL_AUTH_ERR`，便于 CLI 预检与测试复用。

### 两道闸门的位置

| 闸门 | 位置 | 作用 |
|------|------|------|
| 一 | `startWeb()` 的 `options.tunnel` 分支 | **面板已起来之后**、调 `startTunnelForLocal()` **之前** |
| 二 | `startTunnelForLocal()` 函数体第一行 | 在 `require('./tunnel')` **之前**，即下载 cloudflared **之前** |

闸门二的位置很关键：`require('./tunnel')` 之后才会触发 cloudflared 下载（几十 MB）。
若闸门放在后面，用户会在被拒绝前先白等一次下载。

两处措辞不同，是刻意的：

- 闸门一（`web start --tunnel`）：**面板本身已正常启动，只是隧道被跳过**，
  并打印本地地址 + 「补齐凭据后可用 `wow web tunnel` 单独补建隧道」。
  避免用户看到一行错误就误以为整个 `web start` 失败了。
- 闸门二（`web tunnel` 单命令）：直接抛错终止，因为没有「面板还活着」这层可安慰的事。

### 顺带修复：外部 `close()` 后 `isRunning` 残留

`startWeb()` 返回的 server 若由调用方自己 `close()`（同进程嵌入式用法的标准姿势），
不会经过 `stopWeb()`，于是模块级 `isRunning` 永远停在 `true`——
之后任何一次 `startWeb()` 都只打印「Web 服务已在运行中」然后返回 `undefined`。

现为返回的 server 挂 `close` 监听，回收 `isRunning` / `httpServer` / 隧道句柄 / 日志推送。
这个问题是写测试时被稳定复现出来的：不是测试写法问题，是真的会让嵌入式调用方卡死。

### 测试

新增 `core/test/tunnel_auth_gate.test.js`（19 项）：

- `checkTunnelAuth` 六种凭据组合（含纯空白、`null`/`undefined`）
- `startTunnelForLocal` 无凭据时抛错，且**断言 `startTunnel` 未被调用**（不白下几十 MB）
- 错误信息含可直接照做的修复命令
- `startWeb({tunnel:true})` 无凭据 → 面板照常起、返回值有效、隧道被跳过
- `startWeb({tunnel:true})` 有凭据 → 隧道被启动，且 `close()` 后 `isRunning` 归位
- 源码级结构断言：两道闸门都必须出现在正确位置（闸门在 `require('./tunnel')` 之前）
- 与 `isExposedHost` 的分工：回环地址 `isExposedHost` 为 `false`，但隧道闸门仍须拒绝

全程不联网、不起真隧道（`tunnel` 模块打桩计数）。

---

## [3.5.23-26.3e] — 2026-11-01

> 主题：**开源许可证从 MIT 变更为 MPL2.0**。

### 许可变更

- `LICENSE` 由 MIT 全文替换为 **Mozilla Public License Version 2.0** 官方英文原文
  （16,726 字节，逐字一致，仅在标题后新增一行 `Copyright (c) 2026 nuoge`）。
- `core/package.json` 的 `license` 字段由 `MIT` 改为 `MPL-2.0`。
- **README** 顶部版权声明处新增：

  > 除特别声明的文件外，本仓库内的所有文件均为 MPL2.0（Mozilla Public License v2.0）许可。

  并注明「若有文件采用其他许可，会在该文件内或所在目录的 LICENSE 中单独声明」。

### 变更说明

**不追溯既往**：截至 `v3.5.22-26.3d` 的版本仍按 MIT 发布。MIT 是不可撤销授权，
已获得旧版本副本的用户**永久享有 MIT 赋予的全部权利**（含闭源再分发），
本次变更不影响这一点。README 中已明确写出这条分界。

**为什么选 MPL2.0**：文件级 copyleft——只有被修改过的文件需要以 MPL2.0 公开源码，
未修改文件与组合成的「更大作品」可采用其他许可。相比 GPL 不要求整个项目开源，
相比 MIT 又能保证改进回流。

### 附加免责声明改为纯免责

原「附加条款」含「SHA-256 不匹配即为非官方副本、已被篡改」的定性表述，
这在 MPL2.0 下会被解读为**对许可授予权利的限制**（MPL2.0 第 10 条不允许附加限制）。
现改为**纯免责声明**：仅声明作者对使用后果免责、用户应自行校验完整性，
不再对副本做「非官方/被篡改」的定性，也不构成任何使用条件。

同时把免责声明中「官方校验和将在首次公开发布时提供」改为指向 Release 页面——
V3.5.22 起 `SHA256SUMS` 已随每个 Release 上传，该表述已可落实。

### 同步修正的引用

- `README.MD` 参与贡献段：`MIT 许可证` → `MPL2.0 许可证`
- `README.MD` 版权声明的中文参考译本：原为 MIT 逐条翻译，改为 MPL2.0 核心要点说明
- `core/src/terracotta.js` 文件头注释：`wow~ 本身仍保持 MIT 许可` → `wow~ 自身以 MPL2.0 发布`
- `docs/LAN_TERRACOTTA.md` 两处：同上，并补充「与陶瓦 AGPLv3 相互独立、不受传染」的说明

> 第三方依赖（express / socket.io / commander / axios / fs-extra 等）均为 MIT 或
> Apache-2.0，与 MPL2.0 兼容；陶瓦二进制以 AGPLv3 + 例外条款发布，wow~ 未修改、
> 未静态链接，仅通过其 HTTP API 驱动，不受传染。

---

## [3.5.22-26.3d] — 2026-11-02

> 主题：**下载与更新两条链路的可靠性**。
> cloudflared 接入国内镜像（GitHub 直连实测会「只传一半还报成功」），
> 以及更新脚本的哈希校验策略从「一刀切拒绝」改成「可协商」——
> 同时修掉一个更根本的问题：**SHA256SUMS 从来没有被生成或上传过**，
> 所以那段校验逻辑在真实环境里一次都没跑过。

### 新增：cloudflared 国内镜像

- **`core/src/tunnel.js`** —— 下载源改为「镜像优先、官方兜底」：
  `gh-proxy.com` → `ghfast.top` → `ghproxy.net` → GitHub 官方。
  任一家失败自动换下一家，最终错误信息会说明「已尝试 N 个源」并给出手动兜底办法。
- **新增 `resolveMirrors()`** —— 三级覆盖：环境变量 `WOW_CLOUDFLARED_MIRROR`
  > 配置项 `web.tunnel_mirror` > 内置镜像。用户自定义源排最前，**官方始终保留在最后**，
  并自动去重。填法兼容镜像根 / 带尾斜杠 / 只填域名 / 完整 releases 前缀四种写法。
- **新增配置项 `web.tunnel_mirror`**（默认空）+ `config_schema` 登记，可 `wow config` 修改。

### 修复：cloudflared 下载可能落盘半截文件

`downloadFile()` 原来只等 `'finish'` 事件，而**断流与正常结束在 stream 里都是 finish**。
实测 GitHub 直连 40MB 的 cloudflared 多次只拿到 3.8MB 仍被当成成功，
随后 spawn 报 `exec format error` 之类难以理解的原生错误。现在：

- 以 `Content-Length` 为准比对实收字节数，不符即抛错并**删除半截文件**；
- 失败路径统一清理 `.part` 临时文件（原来会残留几十 MB 垃圾，还会干扰下次下载）；
- 写盘用 `.part` 中转，校验通过才 `move` 到正式路径。

> 镜像只做传输代理、不改内容：三家镜像取到的 cloudflared 均为 40274445 字节，
> sha256 `1f99fb51…` 与 GitHub API 公布的 digest 完全一致。

### 变更：更新脚本的哈希校验改为「可协商」

**问题**：`SHA256SUMS` 从未随 Release 上传（查 `gh release view --json assets` 只有 zip），
两端 `update.sh` / `update.bat` 的校验分支永远走「未找到清单」，
「有校验」只是文档上的说法。

现在按四种结局分别处理：

| 状态 | 含义 | 交互终端 | 非交互（CI / 平台脚本） |
|------|------|----------|--------------------------|
| `ok` | 哈希一致 | 直接升级 | 直接升级 |
| `mismatch` | **哈希不符（可疑）** | 询问，默认**否** | **一律拒绝** |
| `missing` | 拿不到清单 | 询问，默认**是** | 继续，打警告 |
| `skip` | 本机无 `sha256sum` | 提示后继续 | 同左 |

**为什么两种默认值相反**：`mismatch` 是「已有官方基准，而下载物与它不符」——强信号，
无人值守时宁可不更新；`missing` 只是「没有基准可比」，属信息缺失，不该把更新卡死。

配套改动：

- `update.sh` 新增 `IS_INTERACTIVE`（`-t 0`/`-t 1` 双判定）与 `ask_continue()`；
  支持 `WOW_NO_PROMPT=1` 强制非交互。`read` 遇 EOF / 空回车一律走默认值，**绝不挂住**。
- `update.bat` 同步实现 `:ask_continue` 子过程；`CHECKSUMS_URL` 改用 `goto` 分支
  （括号块内 `set` 的变量同块读不到新值，这是批处理的经典陷阱）。
- 哈希比对从「整行包含」改为**逐行取第一个字段精确比较**
  （`awk -v h=... 'tolower($1)==...'` / PowerShell `-eq $h`），避免清单格式异常时误命中。
- 取消升级时直接 `exit 0`，**不覆盖任何文件**。

### 新增：发版辅助脚本 `scripts/make-sha256sums.sh`

```bash
bash scripts/make-sha256sums.sh v3.5.22-26.3d            # 生成
bash scripts/make-sha256sums.sh v3.5.22-26.3d --upload   # 生成并上传两端 Release
```

- **必须针对源码归档 zip 计算**（`archive/refs/tags/<tag>.zip`），
  因为更新脚本下载的就是它；Release 附件是 `git archive` 自打包，**两者字节不同**，
  记录附件的哈希毫无意义。
- 要求同一 URL **连续两次哈希一致**才采信（防新 tag 的 CDN 缓存未刷新）。
- GitHub 直连不稳时自动走镜像，并校验两个镜像给出的字节是否一致——
  若不一致宁可报错，也不把错哈希写进清单（写错等于让所有用户升级被拒）。
- `--upload` 会先删同名旧附件再上传，避免重复；凭证优先读环境变量
  `GH_TOKEN` / `GITEE_TOKEN`，未设置时尝试从 git remote 的内嵌 URL 取。

---

## [3.5.21-26.3c] — 2026-11-02

> 主题：**插件系统实装**——把「主程序 + 外部插件」的微内核架构真正落地。
> 此前 `docs/WOW-PLUGINS.md` 写了一份相当完整的开发指南，但代码侧：
> `plugin_manager.install()` 是「功能开发中」的占位、CLI 没有 `plugin` 命令组、
> 启动时没有任何插件加载逻辑。文档描述的能力一样都用不了。

### 新增：Microkernel 插件加载

- **`core/src/plugin_loader.js`**（新）——扫描 `<项目根>/wow-plugins/`，
  读各子目录的 `plugin.json`，把声明的命令动态注册成 wow 顶层命令。
  调用点在 `cli.js` 的 `program.parse()` **之前**，且放在「无参数 → 数字菜单」
  分支之外的前置 IIFE 里——否则菜单/长命令 REPL 里敲插件命令会得到 unknown command。
- **`core/src/plugin_context.js`**（新）——构造传给插件的 `context`。
  注入 10 个能力（`config` / `utils` / `log` / `event` / `server` / `mod` /
  `scheme` / `theme` / `mail` / `pack`），用 `defineProperty` getter 做**懒加载**：
  不读就不 `new`，避免「只用 server 的插件顺带建了 scheme/ 与 pool/ 一堆目录」。
  单实例缓存 + 只读 + 禁止扩展（插件不能给 context 挂字段影响别人）。
- **`core/src/plugin_trust.js`**（新）——内容指纹与信任表。
  指纹算法与 SchemeManager 的内容指纹同源（路径归一化 + 排序 + sha256），
  跳过 `node_modules` / `.git`，超过 2MB 的文件只取「大小 + 首尾 4KB」。

### 安全模型：三条真能生效的闸

明确**不引入 `node:vm`**——require 进来的是同进程同权限，
而 vm 也能用 `this.constructor.constructor('return process')()` 一行逃逸，
只会带来虚假的安全感。改为：

1. **首次启用确认**：终端里列出作者、说明、将新增的命令、明确告知「同权限」，默认否。
2. **内容指纹校验**：插件文件改一个字节，下次启动重新问。
3. **非交互环境一律拒绝**：CI / 定时脚本 / Web 面板 spawn 的子进程没有终端可问，
   未信任插件直接跳过而不是默默执行。
4. **Web 端默认禁用**：新增 `web.allow_plugins`（默认 `false`），
   插件命令经 `RUNTIME_PLUGIN_CMDS` 判定后一律拒绝，除非显式打开。

### 新增 CLI：`wow plugin` 命令组（7 个子命令）

`list` / `info` / `install` / `remove` / `trust` / `untrust` / `path`。
`plugin_manager.install()` 从占位实装为真安装（ZIP 或目录、`--force` 覆盖、
兼容 zip 里多套一层目录、断言文件头是 `PK`），并可读写信任状态。

### 修复：插件命令曾被当成 MC 指令转发

`server.js` 的 `classifyConsoleInput` 用「命令头是否在 `WOW_NAMESPACES` 里」
区分 wow 指令与 MC 指令。插件命令是**运行期**才知道的名字，不在这个常量里，
于是 `wow server start` 的开服控制台里输入插件命令会被转发给 Minecraft 服务端
（表现成「游戏里报 unknown command」，极难排查）。现在显式拦截并给出指引。

同时把 `classifyConsoleInput` 挂到 `ServerManager` 导出上，供单测直接验证。

### 命令策略与配置

- `command_policy.js` 新增 `RUNTIME_PLUGIN_CMDS` / `registerPluginCommand` /
  `resetPluginCommands` / `isWowNamespace`；Web 端对插件命令默认拒绝；
  `auditDangerousConfig` 把 `web.allow_plugins` 纳入危险开关审计。
- `config.js` 新增 `web.allow_plugins`、`plugins.enabled_loader`、`plugins.quiet`；
  `config_schema.js` 把 `web.allow_plugins` 登记进面板设置表单（标注 danger）。
- `.gitignore` 加入 `core/.plugins.trust.json`。

### 测试

新增 3 个测试文件（`plugin_context` / `plugin_trust` / `plugin_loader`）共 61 项，
外加 `plugin_policy.test.js` 的 23 项策略管控断言，全套 **24 个文件**通过。
`core/test/fixtures/plugins/` 提供 5 个形态各异的样例插件
（正常 / 清单损坏 / 加载即崩 / 命令名冲突 / handler 缺失），走真实加载路径。

### 文档

- `docs/WOW-PLUGINS.md` **整份重写**：删掉「尚未实装」警告，
  补上「插件不是沙箱」开篇、快速开始、信任三态、指纹算法、崩溃隔离表、
  Web/控制台行为对照、完整可跑示例。
- `docs/COMMANDS.md` 新增「五之二、插件管理」7 条命令说明（53 → 60 个命令）。
- `docs/CONFIG.md` 补 `web.allow_plugins` 与 `plugins.enabled_loader/quiet`。

---

## [3.5.20-26.3b] — 2026-11-01

> 主题：**文档与代码重新对齐**——把「文档里写着、代码里没有」和「代码改了、文档没跟」
> 两类偏差一次性清掉；顺带补上一条违反最高原则的断层。

### 补齐「文档/策略里有、CLI 里没有」的命令

这是一处真实的功能断层，不只是文档问题：

- `scheme pull` / `scheme prune` 的实现（`SchemeManager.pull/prune`）早就在，
  `command_policy.js` 的 `SCHEME_OPS`、`server.js` 的控制台白名单、`web_task.js` 的异步任务白名单
  也都把它们当既有命令放行——但 `cli.js` 从未注册对应子命令。
  结果是 Web 端放行后 spawn 出来只会得到 commander 的 `unknown command`，
  **「Web 端代理 CLI 指令」这条最高原则在这三个动作上是断的**。
- 本版注册 `scheme pull <name>`、`scheme prune <name>`、`scheme status [name]`、`pool stats`。
- `scheme status` 复用已有的 `SchemeManager.status()`，输出状态 / 版本 / 核心 / 共享与独占统计。
- `pool stats` 的统计逻辑从 `web_service.js` 内联代码抽成独立模块 `core/src/pool_stats.js`，
  CLI 与 `GET /api/pool/stats` 共用同一份口径，避免两边数字对不上。
- 测试：新增 `core/test/cli_commands.test.js`，通过 `--help` 输出断言四个子命令确实注册，
  并用临时目录验证池统计口径（不碰真实 `core/pool/`）。

### 默认主题与面板页面重新同步

- `themes/default/` 长期落后于 `web/`：`diff -rq` 显示 7 个页面不同，且缺 `lan.html`。
  由于 `theme switch` 是**整目录替换**（先 `rm -rf web/` 再复制主题），
  用户一旦切换主题再切回来，面板会退回旧版并丢掉「联机」页。
- 本版把 `web/` 全量同步到 `themes/default/`，两者现已逐字节一致。

### 文档修正

按「会不会让用户照着做却失败」排序：

- **README / QUICKSTART**：快速开始不再教 `wow install vanilla 1.20.1`（V3.5.2 起该命令只打印
  「请改用 scheme create」），改为 `scheme create --type`；`install` 明确标注为「URL 下载 + 彩蛋」。
- **菜单编号**：`4 = 模组/插件搜索下载`、`14 = 联机/我要当房主`（V3.5.10 重排后的实际编号）。
  修正 QUICKSTART / SCHEMES / TROUBLE_ARCH / TROUBLE_DEBIAN / TROUBLE_WINDOWS 中的「第 10 项」，
  以及 3.3.0 历史条目里的「第 15 项」加注说明。
- **CONFIG.md**：`server.dir` 默认值 `../../server` → `../scheme`，`backup.dir` 同理
  （V3.5.2 删除 `server/` 后未同步）；`wow config set web.auth_token` 改为 `wow config wow web.auth_token`
  （`config` 没有 `set` 子命令）；补 `web.auth_password` 配置项与 `lan` 配置段；
  菜单 `11 → 1` 改为 `8 → 1`（Java 设置在系统设置下，不是日志分析）。
- **API.md**：补 `POST /api/console`、`POST /api/tasks/run`、`GET|DELETE /api/tasks`、
  `GET /api/config/schema`、`POST /api/config/batch`、`GET /api/scheme/:name/status`；
  `/api/status` 响应补齐 `scheme` / `startedAt` / `consoleRelay` / `web`；
  日志推送 500ms → 250ms；补 `task` / `tasks` / `console` 三个 Socket.IO 事件；
  说明 `/api/file/read|write` 与 `/api/files/content` 是同一实现的别名，不是两套逻辑；
  补 `?scheme=` 参数、密码登录分支、错误码 409。
- **THEMES.md**：`core/web/` → 根目录 `web/`（该目录 3.5.6 已删除）；新增「生效机制」小节说明
  整目录替换的后果；API 示例改为 `{ command, args }`；WebSocket 示例改为 `socket.io-client`
  （原生 `WebSocket` 连不上 Socket.IO）。
- **WEB_PANEL.md**：补 `--public` / `--tunnel` / `web tunnel`；补「启动后进入长命令模式、
  `exit` 同时关面板」；实时日志 500ms → 250ms；补离线密码登录；补 4 条常见问题。
- **SCHEMES.md / TERMS.md / COMMANDS.md**：把「pull / prune 没有独立命令」「`pool stats` 尚未提供」
  改为实际可用的命令说明；`COMMANDS.md` 命令总数 49 → 53。
- **TROUBLE_MACOS.md**：整份重写。原文的 `/` 被系统性吞掉（`httpsnodejs.orgdistv20.17.0`、
  `usrlibexecjava_home`、`corenodedarwinx64`、`.wow.sh`），表格竖线与引用块也一并损坏。
  重写时顺带修正了三处照搬 Linux 的错误做法：`limits.conf` → `launchctl limit maxfiles`、
  `update-ca-certificates` → macOS 无此命令、`wow --verbose` → `wow config wow verbose true`。

---

## [3.5.19-26.3a] — 2026-10-31

> 主题：**Web 面板不再是「另一套系统」**——页面上的每个动作都代理成对应的 CLI 指令，
> 并在 CLI 终端与控制台里以 `[WebCLI]` / `[System]` 回显；同时把长任务改成异步队列。

### 最高原则的落地

Web 端任何操作本质上都是「代理发送一条 CLI 指令」，CLI 端优先级永远高于 Web 端。
本版把这条原则显式化：所有从 Web 发出的指令，都会带前缀打进 wow 日志与 Web 控制台。

- 新增 `webCliEcho()` / `systemEcho()`：`[WebCLI] wow scheme pull demo`、`[System] mv a.txt b.txt`
- 文件管理器的每个动作映射为对应的模拟系统命令（`mkdir` / `mv` / `cp -r` / `rm -rf` / `zip -r` / `unzip` / `cat >`）
- 跨方案操作在回显末尾追加 `@方案名`，避免多方案场景下分不清改的是谁

### 模块一：交互与状态监控

- **仪表盘状态修复**：`/api/status` 补齐 `running` / `pid` / `scheme` / `startedAt` / `consoleRelay`；
  前端新增 `#server-pid`、`#console-relay`，不再显示空白
- **`/api/metrics` 长期恒 0 的根因**：旧实现调用 `ServerManager.isRunning()`（类上根本没有这个静态方法），
  改为实例方法后 CPU / 内存 / 运行时长 / 在线人数恢复
- **`wow web start` 不再阻塞终端**：启动面板后自动进入 `startRepl({ webMode: true })`，
  等价于 `wow L` 长命令模式，可继续敲指令；`exit` 同时关闭面板
- **控制台防脏数据**：前端发送前 `trim()`；后端 `sanitizeCommandText()` 统一剥离 `\r\n\t\0`、
  零宽空格与 BOM，并把连续空白折叠为单空格
- **新增 `POST /api/console`**：专用于发送 Minecraft 控制台指令。
  历史 bug —— 仪表盘把 `list` 发到 `/api/exec`，后端当成 `wow list` 执行，回一句 unknown command
- **跨进程控制台中继**：面板进程拿不到 MC 子进程的 stdin，改用文件队列 `.console.queue` +
  心跳文件 `.console.alive`，由持有 stdin 的进程每 250ms 消费一次
- **日志推送改为 WebSocket**：旧实现给每个 socket 各开一个 500ms 定时器且从文件开头读；
  改为全局单定时器 250ms 增量广播，日志轮转时游标自动归零

### 模块二：方案创建与下载队列

- **异步创建**：新增 `core/src/web_task.js`。`POST /api/tasks/run` 毫秒级返回 `task_id`，
  Forge 安装器跑几分钟也不会再让浏览器超时
- **白名单约束**：只放行 `scheme create` / `scheme pull` / `scheme prune` /
  `install <具名核心>` / `down` / `mod sync`，不成为绕过 `command_policy` 的后门
- **阶段化进度**：逐行解析子进程输出，映射为「初始化方案目录 → 下载服务端核心 →
  运行安装器 → 核心就绪 → 装配前置模组 → 收尾」，`Math.max` 保证进度不倒退
- **提交即跳转**：方案页创建/拉取/瘦身成功后立刻切到「下载页-任务队列」标签，
  通过 `postMessage({ type:'navigate', page:'down', tab:'queue' })`，
  父框架拼成 `/down.html?tab=queue`，左侧菜单同步高亮
- **任务队列页重写**：数据完全来自 `/api/tasks`（不再用刷新即丢的前端数组），
  每条任务显示进度条、当前阶段、尾部日志，WebSocket `task` 事件实时刷新

### 模块三：配置表单

- 新增 `core/src/config_schema.js`（约 46 个配置项）：声明 `key / type / label / desc / options / group / advanced / danger`
- 新增 `GET /api/config/schema`（必须注册在 `/api/config/:key` 之前）、`POST /api/config/batch`
- **设置页丢弃纯文本框**：按类型渲染 Switch（`auto_scheme`）／Input／Select（枚举）／
  逐行 textarea（`list`）／password（`secret`），每项下方固定显示中文说明
- `advanced` 收进折叠区，`danger` 标红 + 保存前二次确认
- 「原始 JSON」模式保留；`POST /api/config` 无 `key` 时按 schema 白名单落盘
  （旧实现直接 400，用户在原始模式保存永远静默失败）
- `secret` 字段只返回 `hasValue`，不回传明文

### 模块四：文件管理器增强

- 新增 `GET /api/file/read`、`POST|PUT /api/file/write`；双击 `.txt .json .properties .yml .yaml .cfg .toml .ini .conf`
  等文本文件弹出编辑器覆盖层，`Ctrl+S` 保存、`Esc` 关闭，超 2MB 不再尝试编辑
- **图标区分**：文件夹 `📁`，并按扩展名给文件不同图标（`.json` 🧾、`.yml` ⚙️、`.jar` 📦、`.zip` 🗜️、`.log` 📝 …）
- **方案下拉框**：右上角 `<select>` 调 `/api/schemes` 填充，初始化默认选中当前激活方案，
  切换后所有文件接口都带 `?scheme=`。后端 `file_manager.getRoot(scheme)` 做二次校验
  （拒绝 `..` / 路径分隔符 / 盘符，要求方案目录内含 `scheme.yaml`）

### 模块五：补齐拉取与瘦身

- 前端修复：`handleSchemeAction` 不再拼字符串，改用 `argv` 数组提交，
  彻底消除 `scheme pull  test_scheme`（双空格）导致的 unknown command
- 后端核实：`scheme_manager` 的 `_materializeScheme` / `_pruneScheme` 逻辑完整，本版仅补测试断言

### 其他修复

- `/api/scheme/:name/status` 此前从未实现（前端「方案详情」永远失败），本版补上，
  且不调 `sm.status()`（它会往 stdout 打整块表格）
- `execCommand` 用 `command.split(' ')` 拆参数会拆出空串，改为 `split(/\s+/).filter(Boolean)`
- `stopWeb` 同进程分支不清理 `.web.pid` / `.web.port`，导致 `wow web status` 误判
- 新增 `wow web start` 遇到 `EADDRINUSE` 时的友好提示

### 测试

- 新增 `core/test/web_v3519.test.js`（39 项）：指令清洗、配置 schema 与类型转换、
  异步任务白名单与阶段映射、方案路径越权校验、控制台中继工具
- 全量 19 个测试文件全部通过

### 打包

- **发行包不再携带 `core/test/`**：在 `.gitattributes` 中标记 `core/test export-ignore`，
  `git archive`、GitHub 源码 zip、Gitee 源码 zip 三者均会自动排除该目录，
  自更新脚本 `update.sh` 走的正是源码 zip，因此用户升级后也不会再带回测试文件
- 测试在仓库内完整保留，开发期 `npm test` 行为不变
- `npm test` 改为经 `core/scripts/test.js` 转发：发行包内执行时打印友好提示并正常退出，
  不再抛 `MODULE_NOT_FOUND` 堆栈

---

## [3.5.18-26.39] — 2026-10-31

> 主题：**新增本地初级错误诊断器**——服务器崩溃时直接告诉用户「崩在哪、哪个模组、下一步做什么」。

### 新增 `core/src/error_scanner.js`

此前只有 `wow logs report` 做 `[ERROR]` 行数统计，和 `wow logs analyze` 调 AI 分析，
前者没有实际诊断价值，后者需要联网 + API Key。本次补上中间的「离线初诊」层。

#### 1. 错误字典 `ERROR_PATTERNS`

| 类型 | 判定依据 | 归属 |
|------|----------|------|
| `unsupported_class_version` | `UnsupportedClassVersionError` / `class file version` | 环境 |
| `out_of_memory` | `OutOfMemoryError` / `java heap space` / `unable to create new native thread` | 环境 |
| `bind_exception` | `java.net.BindException` / `Address already in use` / `FAILED TO BIND TO PORT` | 环境 |
| `eula` | `You need to agree to the EULA` | 环境 |
| `missing_dependency` | `Missing or unsupported mandatory dependencies` / `which is missing` | 模组 |
| `client_mod` | `net.minecraft.client` 相关报错 | 模组 |
| `mixin_failed` | `Mixin apply failed` / `MixinApplyError` | 模组 |
| `no_class_def` | `NoClassDefFoundError` / `ClassNotFoundException` | 模组 |
| `mixin_conflict` | `Mixin conflict` / `conflicting mixins` | 模组 |

每条 pattern 用 `modRelevant` 标记「是否应当归咎于模组」。EULA / 内存 / Java 版本 / 端口占用
属于服务端环境配置问题，不会再提示用户去删模组。

#### 2. 模组名提取（两路取证）

- **方括号标签**：`[sodium]`、`[/home/mc/mods/iris.jar]` → 取文件名后归一化；
- **堆栈包名**：`net.caffeinemc.mods.sodium.client.SodiumClientMod` → `sodium`。

排除规则（实测踩出来的）：

| 噪声 | 处理 |
|------|------|
| `[12:00:00]` `[main/INFO]` `[Server thread/WARN]` | 日志前缀白名单，不参与提取 |
| `net.minecraft.*` `com.mojang.*` | 原版包，整条跳过 |
| `net.fabricmc.*` `org.spongepowered.*` `io.netty.*` | 加载器/库，整条跳过 |
| `mixins.xxx.json` / `xxx.mixins.json` | 按文件扩展名识别，不是包名 |
| `missing` / `unknown` / `dependencies` | 占位名与泛化词黑名单 |
| `sodiumlike` vs 本地 `sodium` | 本地匹配改为严格模式，避免近似名误命中 |

优先级：**方括号标签 > 包名**，同来源再看**离报错行的距离**，最后看**本地是否真的装了**。
若候选模组在本机 `mods/` 里存在，优先选它——「装了才有可能是真凶」。

#### 3. 前置缺失联动

解析两种真实格式：

```
Fabric: Mod 'Trinkets' (trinkets) 3.7.0 requires any version of cloth-config, which is missing!
Forge : Mod ID: 'cloth-config', Requested by: 'trinkets', Expected range: '[11.0,)', Actual version: '[MISSING]'
```

输出会明确列出「缺失前置」与「声明方」。

> ⚠️ 需求原文的示例提示语是「是否尝试执行 `wow mod install B` 自动补全」，
> 但 **`wow mod install` 这个命令不存在**（mod 子命令只有 `remove` / `list` / `toggle` / `sync`）。
> 提示用户执行一条会报「未知命令」的指令比不提示更糟，因此改为：
> 说明「wow 暂未提供 `mod install`」，并给出真实可行的路径（手动放入 / 菜单搜索下载）。

#### 4. 渲染类模组冲突

不依赖报错行，按本地实际安装情况判断：`sodium` / `iris` / `optifine` / `lithium` / `embeddium`
等同时存在 ≥2 个时，输出「伴随模组」与冲突警告。

#### 5. 终端输出

结构化彩色输出，非 TTY 时自动关闭颜色（也支持 `NO_COLOR`）：

```
❌ 服务器异常退出，退出码: 1
============================================================
🔍 正在进行本地初级诊断...
------------------------------------------------------------

🚨 【明确报错】模组: sodium
   原因: 该模组只在客户端生效（渲染、UI、光影等），放进服务端会在初始化阶段直接抛错。
   上下文:
       [12:00:01] [main/INFO]: Loading 45 mods:
     > java.lang.NoClassDefFoundError: net/minecraft/client/MinecraftClient
       at net.caffeinemc.mods.sodium.client.SodiumClientMod.onInitialize(...)

🕵️  【疑似冲突】伴随模组: iris, lithium, sodium
   👉 警告: 多个渲染/优化类模组同时存在，极易导致底层冲突。

💡 【wow 建议】
   1. 移除该客户端模组：`wow mod remove sodium`；
   2. 若移除后依然崩溃，请尝试 `wow mod sync` 重新同步服务端环境。
============================================================
```

`renderReport()` 只返回行数组、不直接打印，便于测试断言与调用方决定输出位置。

#### 6. 降级

匹配到错误但提取不出模组名时：

- 命令中的模组名替换为 `<模组名>` 占位符，不会输出无法执行的 `wow mod remove 该模组`；
- 追加通用建议；
- 末尾提示：`未能精准定位报错模组。你可以使用 wow logs analyze 调用 AI 进行深度解析。`

**仅对「模组相关」错误生效**——EULA、内存、Java 版本这类本来就没有模组可定位，
强行提示「未能定位模组」只会诱导用户乱删模组。

#### 7. i18n 预留

`MESSAGES` 为 `{ zh, en }` 双表，通过 `setLocale()` 切换；测试断言两表 key 完全一致。

### 修改 `server.js`

异常退出分支不再直接 `console.log('服务器进程退出，退出码: x')`，改为调用
`this._diagnoseCrash(code)` → `scanner.diagnoseOnCrash()`：

- 包在 `try/catch` 内，诊断器自身出错绝不影响进程退出与 PID 清理；
- 放在 `setTimeout(..., 0)`，让 exit 回调里的清理先完成；
- 诊断结论同时写入 wow 事件日志，便于事后复盘；
- 正常退出（`code === 0`）不触发。

### 测试

新增 `core/test/error_scanner.test.js`，**49 项**断言：错误字典命中、模组提取（13 类包名样本）、
日志前缀排除、上下文窗口边界、前置缺失解析、降级策略、渲染冲突、终端渲染、i18n、server.js 接入点。

全套 **18 个测试文件通过**。

---

## [3.5.17-26.38] — 2026-10-31

> 主题：**回滚 `mail.login_verify`——该需求与既有登录机制重复，不应实现**。

### 🔙 回滚内容

3.5.16 里实现了 `mail.login_verify`（控制 Web 端是否需要登录）。但该需求原文附带
「如果之前的配置或代码已经有了，请忽略此条」，而 wow 早已有完整的登录控制机制：

| 既有能力 | 作用 |
|----------|------|
| `web.auth_token` | JWT 签名密钥，缺失时校验形同虚设 |
| `web.auth_password` | 离线密码登录（不配 SMTP 时的替代方式） |
| `mail.whitelist` | 登录邮箱白名单 |
| `web.dev_mode` | 开发模式下回显验证码 |

判断「功能已存在」时只搜了 `login_verify` 字面键名便下了结论，属于核对不到位。
本次整条移除：

- 删除 `DEFAULT_CONFIG.mail.login_verify`
- 删除 `isLoginVerifyEnabled()` 及其在 `authMiddleware` 中的免登录短路
- 删除 `GET /api/auth/config` 路由与 `publicPaths` 中的对应项
- 删除 `/api/auth/verify` 的免登录分支
- 删除「对外暴露 + `login_verify=false`」这道附加闸门

### 🔧 安全闸门回归原始要求

V3.5.16 曾把判断放宽为「`auth_token` **或** `auth_password` 任一有值即放行」，
这不是需求里写的。现恢复为**只看 `web.auth_token` 是否为空**：

```
❌ 拒绝启动：暴露公网必须设置 auth_token 或管理员密码！
```

提示中仍提及「管理员密码」，因为 `web.auth_password` 同样是可用凭据，一并配置更稳妥。

### ✅ 保持不变

`--public` / `--host`、Cloudflare Tunnel、EasyTier 内网访问提示三项功能不受影响。

### 🧪 测试

- `web_public_tunnel.test.js` 由 50 项调整为 **49 项**：移除 login_verify 相关断言，
  新增「既有登录机制未被改动」与「不残留多余配置项」两条守护性断言；
- 全套 **17 个测试文件通过**。

实测：`auth_token` 为空 + `--public` 拒绝启动；配置 `auth_token` 后正常启动；
回环地址不受闸门影响，`login_verify` 已彻底不在配置与代码中。

---

## [3.5.16-26.37] — 2026-10-30

> 主题：**Web 面板对外可达——公网暴露、Cloudflare 隧道、联机内网访问，以及一道强制安全闸门**。

### ✨ 新功能

#### 1. `web start` 支持 `--public` / `--host`

```bash
wow web start --public            # 等价于 --host 0.0.0.0，所有网卡都可访问
wow web start --host 192.168.1.9  # 只绑定指定网卡
```

默认仍是 `127.0.0.1`（只有本机能访问），行为不变。
对外绑定时会额外打印本机所有可用的局域网地址，方便直接复制给其他人。

#### 2. Cloudflare Tunnel：一条命令拿到公网 https 地址

```bash
wow web start --tunnel     # 启动面板的同时建立隧道
wow web tunnel             # 面板已在运行时，单独拉隧道
```

wow 会自动：

1. 首次使用时下载 `cloudflared` 到 `core/tunnel/`（按平台/架构选资产，含 macOS 的 `.tgz` 解包；GitHub 不可达时自动切换到镜像源）；
2. 执行 `cloudflared tunnel --url http://127.0.0.1:8080`；
3. **逐行**解析输出，抓取 `https://xxx.trycloudflare.com` 并高亮打印；
4. `web stop` 或进程退出时自动关闭隧道，不留孤儿进程。

> 该地址每次启动都会变化，适合临时分享／远程调试，不适合长期绑定。
> 如果 cloudflared 起不来，wow 会回显它的真实输出（而不是只报「超时」）。

#### 3. 联机（陶瓦 / EasyTier）时的内网访问提示

`lan host` 与 `web start` 同时开启时，控制台会提示：

```
🌐 检测到联机网络已开启，你可以通过虚拟局域网 IP 访问面板。
   虚拟局域网 IP: 10.144.7.23  (网卡 easytier0)
   面板地址:      http://10.144.7.23:8080
   把上面这个地址发给同一房间的好友即可打开面板。
```

虚拟 IP 的获取有两路取证：先读 `os.networkInterfaces()`（网卡名含 `easytier` / `terracotta`，或地址落在 `10.144.0.0/16`），
失败再回落到系统命令（Linux `ip -4 addr`、macOS `ifconfig`、Windows `ipconfig`）。
都拿不到时只给出排查提示，不编造地址。

触发时机有两个方向，任一满足即提示：

- 先开面板、后开房 → `lan host` 结束后提示；
- 先开房、后面板启动 → `web start` 结束后提示。

#### 4. 强制安全闸门

**只要绑定地址不是回环（`0.0.0.0`、局域网 IP、`::`），且 `web.auth_token` 为空，直接拒绝启动：**

```
❌ 拒绝启动：暴露公网必须设置 auth_token 或管理员密码！
```

闸门在 `server.listen()` **之前**执行，端口不会被占用。

> 说明：判断依据是 `web.auth_token`（JWT 签名密钥）。没有它，`authMiddleware` 的
> 签名校验形同虚设，暴露到公网等同把控制权交出。提示里同时提到「管理员密码」，
> 是因为 `web.auth_password`（离线密码）也是可用的登录凭据，一并配置更稳妥。

### 🔧 新增模块

| 文件 | 作用 |
|------|------|
| `core/src/tunnel.js` | cloudflared 下载、启动、域名抓取、进程组清理 |
| `core/src/netinfo.js` | EasyTier 虚拟 IP 探测与访问提示文案 |

### 🧪 测试

- 新增 `core/test/web_public_tunnel.test.js`，**49 项**断言（纯逻辑 + 源码级，不真下二进制、不真监听端口）；
- 全套 **17 个测试文件通过**。

实测记录（沙箱内）：

- `auth_token` 为空 + `--public` → 正确拒绝并给出可执行指引；
- `auth_token` 已配置 + `--public` → 正常启动并列出局域网地址；
- 用桩 cloudflared 验证：域名被拆成两个数据块输出时仍能拼出完整地址，`stop` 后无残留进程；
- 桩 cloudflared 崩溃时，wow 回显其真实错误行；
- 创建 `10.144.7.23/24` 的 dummy 网卡，两条探测路径都能正确识别。

### ⚠️ 使用提醒

- **不要把 `--public` 当作省事选项**。公网可达意味着登录页会被人扫到，请务必先设 `web.auth_token`（或 `web.auth_password`）。
- `--tunnel` 给出的地址是公开的，任何人拿到即可访问登录页，同样依赖上面的认证。
- 隧道与陶瓦均以 `detached` 方式启动，`Ctrl+C` 不会误杀；用 `wow web stop` / `wow lan stop` 关闭。

---

## [3.5.15-26.36] — 2026-10-24

> 主题：**陶瓦被终端 Ctrl+C「连坐」击杀——改为独立会话启动**。

### 🐛 真凶：陶瓦其实起来了，是被终端信号带走的

3.5.14 让错误信息可见后，用户提供的陶瓦日志显示：

```
[UI]: Welcome using Terracotta v0.4.2 ...
[Easytier]: Releasing easytier to /tmp/terracotta/2026-10-24-17-54-40-5525/embedded-easytier
Rocket has launched from http://127.0.0.1:36479     ← HTTP 服务已经起来了！
Warning: Received SIGINT. Requesting shutdown.      ← 随即被 SIGINT 杀掉
```

**陶瓦启动是成功的**（Rocket 已监听 36479），端口文件也已写出（实测约 22 ms）。
它死在 `Received SIGINT` —— 但用户并没有主动关房。

**根因**：`spawn` 未设置 `detached`，陶瓦与 wow 处在**同一个进程组**。
终端把 Ctrl+C（SIGINT）发给整个前台进程组时，陶瓦被一并杀掉；
更糟的是，信号可能落在「端口文件刚写出、wow 还没轮询到」的窗口里，
于是 wow 侧只看到「未能读取本地 API 端口」，与真实原因完全对不上。

这解释了为什么在沙箱里 10/10 次都能启动成功——那里没有终端在发送 SIGINT。

### 🔧 修复

**陶瓦以 `detached: true` 启动**，自成一个会话 / 进程组：

- 不再接收终端控制信号（Ctrl+C、关闭终端窗口都杀不到它）；
- 这与「守护进程」的语义一致：它本就该比调用它的命令活得更久；
- 关房仍走 `stopHost` → `apiPanic` + `kill(pid)`，行为不变。

> Windows 上 `detached` 会让子进程拥有独立控制台，陶瓦是纯后台服务，不受影响。

### 🧪 验证

- **实测有效**：向 node 所在进程组发送 SIGINT，修复前陶瓦被杀、修复后**存活**；
- 正常启动 / 停止流程回归通过；
- `terracotta_diagnose.test.js` 增至 9 项（新增 `detached: true` 源码断言）；
- 全套 **16 个测试文件通过**。

### 📌 如果你之前一直在踩这个坑

升级后用 `lan host` 开房，**之后不要再用 Ctrl+C 中断**——现在即使中断也不会误杀陶瓦。
若仍失败，新版本会打印陶瓦的真实输出，把那段发出来即可。

---

## [3.5.14-26.35] — 2026-10-24

> 主题：**陶瓦启动失败不再「哑巴报错」——回显子进程真实输出，按错误类型给出可执行诊断**。

### 🐛 真实故障：`lan host` 报「请检查网络 / 防火墙」

用户执行 `lan host`，二进制下载与解压都成功（`✅ 陶瓦二进制就绪`），随后立刻报：

```
❌ 开房失败: 启动陶瓦超时：未能读取本地 API 端口。请检查网络 / 防火墙，或查看陶瓦日志。
```

**这条提示是错误的归因**：陶瓦是本机 `127.0.0.1` 进程，启动阶段根本不涉及网络。

**根因**：`spawn` 时 `stdio: ['ignore','ignore','ignore']`，陶瓦的 stdout/stderr 被**完全丢弃**。
陶瓦一旦崩溃（无执行权限、架构不符、临时目录不可写、磁盘满……），我们看不到任何线索，
只能给出一个「等了 20 秒没读到端口」的笼统结论，并把锅甩给网络。

此外，进程已退出时仍要**空等满 20 秒**才报错。

### 🔧 修复

**1. 不再丢弃子进程输出**：改为 `pipe` 并留存（上限 20 KB），失败时原样回显最后 12 行。

**2. 按错误类型给出针对性诊断**：

| 情形 | 诊断 |
|------|------|
| `EACCES` | 所在分区挂载了 **noexec**，或文件缺少执行权限 —— 换到可执行分区 |
| `ENOENT` | 二进制不存在或已被清理 —— 删除后重试即可重新下载 |
| 进程退出 | 报出退出码 / 信号，并指常见原因（架构不符、依赖缺失、临时目录不可写、磁盘满） |
| 超时未写端口 | 不再提网络，改为提示 `$TMPDIR` 不可写 / 磁盘满 / 安全软件拦截 |

同时给出陶瓦日志实际路径（`$TMPDIR/terracotta/<时间戳>/application.log`）与二进制路径。

**3. 进程退出即停止等待**：不再空等 20 秒。

**4. 顺带修正一处漏读竞态**：原轮询先判「进程是否退出」再读端口文件，若进程写完端口后
立即退出，会漏掉这个有效端口。现改为**先读端口、再判退出**。

### 🧪 测试

新增 `terracotta_diagnose.test.js`（8 项）：源码级 4 项 + 用可控假二进制复现 4 类真实故障
（EACCES / 崩溃退出并回显输出 / 静默不写端口 / 正常写端口）。测试会备份并还原真实二进制。
全套 **16 个测试文件通过**。

### ⚠️ 若你仍遇到失败

新版本会直接打印陶瓦的真实报错。**把那段输出发出来即可精确定位**，常见处理：

- `permission denied` / `EACCES` → 把 wow 移到允许执行的分区（`mount | grep noexec` 可查）；
- `No space left on device` → 清理 `$TMPDIR` 或磁盘；
- 进程立即退出且无输出 → 多为二进制与系统架构不符，删除 `core/lan/terracotta` 后重试下载。

---

## [3.5.13-26.34] — 2026-10-24

> 主题：**修复「换目录升级后方案丢失」的误导性报错 + 用户配置不再随包分发**。

### 🐛 真实故障：「未找到服务器核心（.jar）」却提示 scheme switch

用户把 3.5.12 解压到新目录 `/home/lu/wow-v3.5.12-26.33/` 后启动，得到：

```
未找到服务器核心（.jar）
当前方案「wuhu!」目录内没有可运行的核心
目录: /home/lu/wow-v3.5.12-26.33/scheme
方案可能未补齐，可尝试: scheme switch wuhu!
```

**根因链路**：

1. `scheme/`（方案数据）与 `core/wow.yaml`（配置）都属于**本机用户数据**，不随发行包分发；
2. 用户换到新目录后，`core/wow.yaml` 仍记录着 `server.scheme: wuhu!`；
3. `utils.getServerDir()` 发现 `scheme/wuhu!/` 不存在，**静默回退到 `scheme/` 根目录**；
4. `_getServerJar()` 在根目录找不到 jar，抛出「未找到核心」；
5. 报错逻辑回顾配置里**有**方案名，于是判定「方案在、核心丢」，建议 `scheme switch wuhu!`
   —— 而该方案根本不存在，执行只会再报一次错。

关键在于：打印出的目录是 `.../scheme` 而不是 `.../scheme/wuhu!`，这本身就是「回退」的铁证，
但原提示完全没有体现，用户无从察觉。

### 🔧 修复

**1. 诊断准确化**（`server.js` 新增 `_reportMissingSchemeDir()`）

方案目录不存在时，如实说明回退行为并给出可执行的下一步：

```
未找到服务器核心（.jar）
当前配置指向的方案「wuhu!」目录不存在
配置位置: core/wow.yaml -> server.scheme
期望目录: /home/lu/wow-v3.5.12-26.33/scheme/wuhu!
当前实际使用: /home/lu/wow-v3.5.12-26.33/scheme（已回退到 scheme 根目录）

常见原因：换了新的解压目录（旧方案仍在旧目录里），或方案已删除。
若方案在旧目录：复制 旧目录/scheme/wuhu! 到 本目录/scheme/wuhu!
若需重新建方案: scheme create wuhu! --type <类型> --version <MC版本>
```

同时把该检查**前移到方案补齐之前**，缺失时立即 `return`，不再继续建 `logs/`、写 `eula.txt`
（此前会先刷出一行「⚠️ 方案补齐检查失败（将尝试直接启动）」再报错，噪声掩盖真因）。

**2. `core/wow.yaml` 停止跟踪**（`git rm --cached`）

该文件一直同时存在于 `.gitignore` 与版本库中（历史遗留的矛盾状态），导致**每次发版都把
开发者本机的配置塞进发行包**。虽然跟踪内容里没有 `server.scheme`，但它携带了
`server.jar: null`、`auto_scheme`、`lan.version` 等运行时状态，属于污染源。

现在它纯粹是本机配置：首次运行由 `loadConfig()` 自动生成完整默认值（已实测），
发行包不再携带。

**3. 文档**（`QUICKSTART.md`）

在「下载与解压」章节加入醒目提醒：升级请勿换目录，推荐原地 `update.sh`；
若已换目录，复制旧目录的 `scheme/` 与 `core/wow.yaml` 即可。

### 🧪 测试

- 新增 `scheme_missing_dir.test.js`：5 项（诊断两分支、`start()` 提前中止且早于目录创建、默认配置不含 `server.scheme`、无 `wow.yaml` 可加载）
- `mail_whitelist.test.js` 用例 25 改为不依赖 `wow.yaml` 存在（快照式比对）
- 实测两场景：方案目录缺失 → 准确诊断并中止；方案存在但缺核心 → 保留原提示不变
- 全套 **15 个测试文件全部通过**

---

## [3.5.12-26.33] — 2026-10-24

> 主题：**macOS 下载 JRE 优先使用国内镜像（清华 TUNA），失败自动回退官方源**。

### 🇨🇳 JRE 国内镜像源（macOS 优先）

此前 Node.js（npmmirror→TUNA→腾讯→华为→官方）、服务端核心（BMCLAPI2）、陶瓦联机（Gitee 镜像）均已国内镜像优先，**JRE 是最后一个直连国际源的环节**——`api.adoptium.net` 的 307 跳转最终落到 GitHub Release 对象存储，国内下载慢且常中断。

本次为 JRE 下载新增候选链机制，**仅 macOS 平台启用**（用户需求）：

| 平台 | 下载候选链 |
|------|-----------|
| macOS | ① 清华 TUNA Adoptium 镜像 → ② Adoptium 官方 API |
| Windows / Linux | 仅 Adoptium 官方 API（用户未要求改动，保持行为稳定） |

- 镜像源：`https://mirrors.tuna.tsinghua.edu.cn/Adoptium`（与官方产物同源的 Eclipse Temurin 静态文件）。
- TUNA 为静态目录、无 latest API，`_resolveTunaLatestUrl()` 拉取目录列表，按文件名版本号取最高版本；兼容两种版本号格式：`21.0.12.1_1`（11+）与 `8u504b01`（JDK 8 专用格式）。
- 候选链依次尝试，全部失败才抛错；任一源成功即止。单源失败只记警告不阻断（与「自更新失败不阻断启动」同一原则）。
- 用户锁定完整版本（`jre.version`）时跳过镜像——精确版本由官方 API 的 `version/{full}` 路径解析。
- 新增配置项 `jre.mirror`（默认清华 TUNA），**置空即跳过镜像直连官方**，便于镜像故障时应急。

### 🧪 测试

- `java_scan.test.js` 新增 13 项断言（4 项源码级 + 9 项行为级）：TUNA 源配置存在、`_getDownloadUrls` 候选链顺序（macOS 国内优先 / 其他平台仅官方）、`_resolveTunaLatestUrl` 版本比较（含 JDK 8 特殊格式、无关文件过滤）、`jre.mirror` 置空跳过、锁定版本跳过、TUNA 不可达回退官方。行为级用例全部 stub axios，无网络依赖。
- 功能实测（真实网络）：macOS arm64 候选链 TUNA 优先 + 官方兜底、TUNA 直链 HTTP 200（约 191 MB）、Linux 行为不变、置空 `jre.mirror` 跳过镜像，四场景全部通过。
- 全套 **14 个测试文件全部通过**。

---

## [3.5.11-26.32] — 2026-10-21

> 主题：**引导菜单支持 NeoForge + Fabric 方案自动装配 Fabric API + 全面取消加载器询问**。

### 🧩 引导菜单支持 NeoForge

`wow`（无参数）数字菜单 → 2 方案管理 → 新建方案 的核心类型列表补充 **neoforge**（插在 fabric 之后）：

```
1. vanilla   2. forge   3. fabric   4. neoforge   5. paper   6. purpur
7. spigot    8. bukkit  9. mohist   10. leaves
```

- 安装器层（`installer.js`）早已完整支持 NeoForge（Maven 直链、版本解析 `21.4.x ↔ MC 1.21.x`、`libraries/` 深层核心探测、`unix_args.txt` 启动），本次补齐的是**交互入口**。
- Web 表单 / CLI `-t` / 模组搜索的加载器枚举此前已含 neoforge，无需改动。

### 🧶 Fabric 方案自动装配 Fabric API

新建 Fabric 方案时，按 MC 版本从 Modrinth（项目 `P7dR8mSH` = fabric-api）自动解析并下载最新兼容版本到方案 `mods/`，同步入资源池共享：

- 绝大多数 Fabric 模组硬依赖 Fabric API，此前空方案启动即缺依赖，需用户手动补装。
- 实测：MC 1.20.1 → `fabric-api-0.92.12+1.20.1.jar`（约 2.1 MB）。
- **失败容忍**：解析不到适配版本 / 网络失败只警告并跳过，绝不阻断方案创建（与「自更新失败不阻断启动」同一原则）。
- 整合包导入（`fromPack`）通常自带 Fabric API，不重复装配；已存在同文件名时不重复下载。
- `mod_search.js` 新增导出 `pickModrinthFile`（原内部函数），供方案装配复用。

### 🚫 不再询问模组加载器

加载器统一由核心类型自动确定（`-t fabric` 即 fabric 核心 + fabric 加载器），三处询问入口全部移除：

| 位置 | 改动 |
|------|------|
| 引导界面（数字菜单新建方案） | 删除「加载器 (默认 xx)」提问，`create()` 改传 `loader: type` |
| `scheme create -h` | `-t` 帮助由「核心类型/加载器 … 同时决定加载器」改为「核心类型 … 模组加载器随类型自动确定，不再单独询问」；`-b` 帮助去掉加载器版本枚举 |
| Web 方案创建表单 | 删除「模组加载器」下拉（该值本就未传给 CLI，属死 UI），方案名称与 MC 版本合并同行 |

> 说明：CLI 侧 `--loader` 早在 V3.4.1 已并入 `--type`；本次把同一规则推广到引导界面与 Web 表单，三端行为完全一致。

### 🧪 测试

- `interactive_menu.test.js`：43 → 53 项（新增 neoforge 入口、无加载器提问、`loader: type`、CLI 帮助文案、Web 表单死 UI 移除等断言）。
- 新增 `fabric_api.test.js`：11 项源码级断言（挂钩条件、`P7dR8mSH`、按版本解析、入池布局、失败容忍、幂等）。
- 功能实测（隔离临时目录）：正常装配 / 幂等重入 / 假版本失败容忍三场景全部通过。
- 全套 **14 个测试文件全部通过**。

---

## [3.5.10-26.31] — 2026-10-20

> 主题：**数字主菜单分类重排 + 移除 start 入口 / RELEASE 档案**。
> 无参数 `wow` 进入的数字主菜单从 15 项精简为 14 项并按功能分类；`start.sh`/`start.bat` 与 9 份 RELEASE 档案按用户要求删除。

### 🎛️ 数字主菜单分类重排

`wow`（无参数）进入的数字主菜单原 15 项按出现顺序排列，查找成本高。现按功能聚类重排为 14 项：

| 分类 | 编号 | 菜单项 |
|------|------|--------|
| 服务器启动 | 1 | 启动服务器 |
| 方案 | 2 | 方案管理（新建/切换/列表/删除/信息）|
| 模组 / 插件 | 3 | 管理模组/插件 |
| 模组 / 插件 | 4 | 模组/插件搜索下载 |
| 配置 | 5 | 变更配置 (server.properties) |
| 配置 | 6 | 认证设置 (外置登录) |
| 配置 | 7 | 下载管理器设置 |
| 配置 | 8 | 系统设置 |
| 整合包 | 9 | 安装整合包 |
| 整合包 | 10 | 生成客户端整合包 |
| 日志 / 监控 | 11 | 错误日志分析 |
| 日志 / 监控 | 12 | 服务器状态监控 |
| 外观 | 13 | Web 主题更改 |
| 联机 | 14 | 联机 / 我要当房主 (陶瓦) |

- **方案管理合并**：原第 2 项「新建方案」与原第 13 项「方案管理（切换/列表/删除）」合并为单一入口「方案管理」，子菜单 1-5 覆盖新建、切换、列出、删除、信息；旧第 13 项整体删除。
- **编号引用同步**：`interactive.js` / `jre_manager.js` / `server.js` 中所有「菜单 11 → 1（Java 安装）」「菜单 13 → 2/1（方案）」等内部指引已更新为新编号（系统设置 → 8，方案切换/列出 → 2 → 2 / 3）；`QUICKSTART.md` 菜单引导词同步更新。
- `dispatchMenu` 各 case 重新编号并保持 1-14 连续无重复。

### 🧹 清理：移除 start 入口与 RELEASE 档案

- 按用户要求删除根目录 `start.sh` / `start.bat`（平台启动转发器）。现唯一启动入口为 `wow.sh` / `wow.bat`。
- `update.sh` 的 `chmod` 列表与 `update.bat` 的注释中残留的 `start.sh`/`start.bat` 引用已清理。
- 删除 9 份 `docs/RELEASE-V3.5.0 … V3.5.8` 发布档案（无任何文档交叉引用，历史记录以 `CHANGELOG.md` 为准）。

### 🧪 测试

`interactive_menu.test.js` 断言同步更新（40 → 43 项）：

- 顶层 case 1-14 全部存在
- 菜单 2 现为「方案管理」合并入口，含子菜单 1-5（新建/切换/列出/删除/信息），且保留新建方案的对象签名调用
- 切换/删除方案均已 `await`（异步方法）；含 `schemeManager.info`
- 主菜单第 2 项显示「方案管理」、第 13 项现为「Web 主题更改」

全套测试 **13 个文件全部通过**。

### 🔢 版本号重排：十六进制序号归位

> 背景：V3.5.8 / V3.5.9 / 本版的后缀误用了 `3g` / `3h` / `3i`——**超出十六进制位域**（十六进制只到 `f`）。
> 同时早期序号也存在漂移（`0x27` → `0x29` 跳号、`0x29` → `0x3a` 跳号），不再满足「发行包序号十六进制 +1」的规则。

按规则重排：以 `3.5.0 = 0x27` 为锚点，每个后续版本 +1（十六进制）：

| 版本 | 原后缀 | 重排后 |
|------|--------|--------|
| 3.5.0 | `26.27` | `26.27`（锚点，不变）|
| 3.5.1 | `26.29` | `26.28` |
| 3.5.2 | `26.3a` | `26.29` |
| 3.5.3 | `26.3b` | `26.2a` |
| 3.5.4 | `26.3c` | `26.2b` |
| 3.5.5 | `26.3d` | `26.2c` |
| 3.5.6 | `26.3e` | `26.2d` |
| 3.5.7 | `26.3f` | `26.2e` |
| 3.5.8 | `26.3g` ✗ | `26.2f` |
| 3.5.9 | `26.3h` ✗ | `26.30` |
| 3.5.10 | `26.3i` ✗ | **`26.31`** |

- `core/package.json` / `core/package-lock.json` / `cli.js -V` / CHANGELOG 全部同步为 `3.5.10-26.31`。
- `update.sh` 的 tag 正则本就限定 `[0-9a-fA-F]+`，因此旧的非十六进制 tag 永远不会被选中——本次重排同时让历史 tag 与文档重新对齐。

---

## [3.5.9-26.30] — 2026-10-18

> 主题：**cli.js 懒加载重构 —— 启动更快、单模块损坏不再拖垮全局、核心帮助极简**。
> 顶部只静态引用 config / utils，其余模块全部移入各自 action 内动态 require。

### ⚡ 重构：cli.js 模块懒加载 + 故障隔离

原来 cli.js 顶部静态引用 12 个项目模块（server / installer / mod_manager /
scheme_manager / theme_manager / jre_manager / pack_generator / log_handler /
mailer / web_service / terracotta / log），带来两个问题：

- **启动慢**：哪怕只是 `wow set` 改个配置，也要把 express、陶瓦、整合包生成器
  全部加载一遍
- **一损俱损**：任何一个模块语法错误或依赖缺失，顶部 require 直接抛异常，
  整个 CLI 进程起不来，连 `--help` 都打不出来

现在顶部只保留 `config` / `utils`（外加 Node 内置与 commander），其余模块在
各自的 action 回调里经 `load()` 动态加载：

```js
function load(modulePath) {
    try {
        return require(modulePath);
    } catch (e) {
        console.error(`❌ 模块加载失败 [${modulePath}]: ${e.message}`);
        return null;
    }
}
```

- 单个模块加载失败**只报错当前命令**并返回 null，由调用方降级——其他命令照常可用
  （实测：破坏 log_handler 后 `wow logs report` 报模块错误，`wow scheme list`、
  `--help` 均正常，进程不退出）
- `interactive.js` 各菜单分支原本就有空值保护，`buildMenuOptions` 对加载失败的
  管理器传 null，菜单自动降级提示而不是崩溃
- `lan host` 保留原有退出契约：模块损坏时报错并以 exit 1 退出
- 事件日志模块同样懒加载：损坏时仅失去日志能力并告警，不阻断启动；
  全局错误钩子仍尽早安装
- 顺带清掉了从未使用的 `jre_manager` 死引用；`down` 的 axios / progress、
  `config server` 系列的行内 require 也统一走 `load()`

### 🧹 帮助菜单极简：非核心命令 `_hidden`

`wow --help` 原来列出 14 个顶层命令。现按「核心工作流」只保留 8 个：

| 处置 | 命令 |
|------|------|
| 保留可见 | `init` / `server` / `scheme` / `mod` / `web` / `lan` / `config` / `L` |
| 改为隐藏 | `set` / `down` / `pack` / `logs` / `mail` / `theme`（`install` 原本已隐藏）|

隐藏仅影响 `--help` 展示，命令本身全部照常可用；完整命令清单见 `docs/COMMANDS.md`。

### 🧪 测试

`interactive_menu.test.js` 新增 8 项源码级断言（32 → 40 项）：

- 顶层除 config/utils 外无项目模块静态 require
- `load()` 辅助函数以 try/catch 包裹 require 并降级返回 null
- log 模块懒加载（`getLog` / `logger` 访问器）
- 7 个非核心命令已 `_hidden`，且 mail/theme/pack/logs 定义后即设置
- 核心命令保持注册；server 全部子命令 action 均经 `load()`
- `buildMenuOptions` 各管理器懒加载且失败降级为 null

全套测试 **13 个文件 / 425 项全部通过**，`core/wow.yaml` 与 `scheme/` 无污染。

### ⬆️ 升级须知

- **命令用法零变化**：所有命令（含隐藏的）行为与之前完全一致，只是 `--help` 变短了。
- 写死 `wow m` 的脚本仍需按 V3.5.8 迁移（与本版无关，只是再次提醒）。
- 若曾依赖「某个模块损坏时全局报错退出」的行为做监控，现在会变成只有对应命令报错，
  告警规则可能需要相应调整。

---

## [3.5.8-26.2f] — 2026-10-17

> 主题：**修复 Forge 类型安装后核心路径找错**。
> Forge / NeoForge 的产物布局随版本剧烈漂移，旧实现只有一条 `forge-*-server.jar`
> 的正则，命中不了就开始「盲选」，最终把原版核心当成 Forge 核心、或切换方案后
> 核心落到错误目录。

### 🎯 修复：Forge 核心路径探测（安装阶段）

旧实现 `serverJarPattern: /^forge-.+-server\.jar$/` 只在 1.17 ~ 1.20.x 成立：

| MC 版本 | 真实产物 | 旧实现结果 |
|---------|----------|-----------|
| 1.12.2 / 1.16.5 | 根目录 `forge-<mc>-<ver>.jar`（**无** `-server` 后缀） | 正则不命中 → 抛「未找到核心」 |
| 1.17 ~ 1.20.x | `libraries/.../forge-<mc>-<ver>-server.jar` + `unix_args.txt` | 命中，唯一正常区间 |
| 1.21+ | 同目录仅 `unix_args.txt` / `win_args.txt`，无独立核心 jar | 抛「未找到核心」 |
| NeoForge | `libraries/net/neoforged/neoforge/<ver>/` | 依赖同名正则，脆弱 |

新增 `_detectForgeJar(dir, type)`，按三级优先探测：

1. **`*args.txt` 优先** —— 找到 `unix_args.txt`（或 `win_args.txt` / `args.txt`）后，
   其所在目录即 Forge 安装根，同目录的 jar 才是真实核心；若该目录无 jar（1.21+），
   直接返回 args 文件，交由 `server.launchArgsFile` 用 `@args` 方式启动。
2. **前缀 + 形态匹配** —— 递归搜 `forge-` / `neoforge-` 前缀 jar，优先 `-server.jar`，
   其次不带修饰后缀的普通核心（`forge-<mc>-<ver>.jar`）。
3. **显式排除误选源** —— `minecraft_server.<mc>.jar`、`server-<mc>.jar`、
   `*-installer.jar`、`*-shim.jar`、以及 libraries 里同为 `forge-` 前缀的
   `*-universal.jar` / `*-client.jar`（这些是库文件，不能启动）。

### 🎯 修复：Forge 核心路径探测（启动阶段）

`server._getServerJar()` 两处盲选：

- 原版核心 `minecraft_server.1.16.5.jar` 含 `server` 字样，兜底分支会把它选中，
  于是「装的是 Forge、跑起来却是原版」。现在 Forge/NeoForge 类型下显式优先
  `forge-` / `neoforge-` 前缀，且排除原版文件。
- 根目录没有任何 jar（1.21+ 只有 args 文件）时原本直接抛「未找到核心」。
  现在若配置里有 `server.launchArgsFile` 就直接返回它，走 `@args` 启动。

### 🎯 修复：方案瘦身/补齐把核心拍平到根目录

这是「切换方案后核心路径找错」的根因。`_addToPool()` 只按 `path.basename()`
入池 —— Forge 核心在 `libraries/net/minecraftforge/forge/...` 深层，
入池后层级丢失，`_materializeScheme()` 补回时只能落到方案**根目录**，
与记录里的深层路径对不上，`_pruneScheme()` 也因此删不掉真实文件。

修复：

- `_addToPool()` 新增 `relPath` 参数，池内按原始相对路径落盘
- `scheme.yaml` 的 `resources.core.file` 改为记录**相对方案根目录的完整路径**
  （旧方案里的纯文件名仍然兼容，落到根目录）
- 新增 `_resolveCoreTarget()` 统一解析，兼容新格式 / 老格式 / Windows 反斜杠 / `./` 前缀
- `_materializeScheme()` 补齐时自动 `ensureDirSync(dirname)` 还原深层目录
- pool 里核心缺失时不再静默跳过（旧行为会把状态强标 FULL 但实际缺核心，
  要到启动才报错），改为明确告警

### ✨ 新增：Web 面板登录邮箱白名单 `mail.whitelist`

面板默认接受任意邮箱请求验证码——一旦暴露到公网，等于谁拿到验证码谁就能进。
新增白名单配置（`wow.yaml` → `mail.whitelist`）：

```yaml
mail:
  whitelist:
    - you@example.com
    - teammate@example.com
```

- 名单外邮箱在 `POST /api/auth/request-code` 阶段直接 403，**不生成验证码**
- `POST /api/auth/login` 二次校验：即便此前已发出过验证码（白名单是后配的），
  登录阶段仍会拒绝换取 token，堵住时序漏洞
- 大小写不敏感；留空 `[]` = 不限制（与 V3.5.7 行为一致）；`- "*"` = 放开所有
- 同时接受逗号分隔字符串写法，兼容 `mail.WhiteList` / `mail.whiteList` 大小写变体
- 白名单读取异常时按放行处理并告警，避免配置写坏导致面板彻底登不上

### 🔧 修复：`docs/TROUBLE_WINDOWS.md` 被整篇包在代码围栏里

文件开头有一行 `## \`docs/TROUBLE_WINDOWS.md\`` 加一个未闭合的 ` ```markdown `，
使得整份文档在 GitHub / 编辑器里渲染成一大块代码。这条包裹自 V3.4.3 首次提交起就存在。
剥离外层包裹后又暴露出真正的问题：文件末尾的 ` ```cmd ` 从未闭合（此前靠那个多余的
外层围栏"凑巧"闭上）。两处一并修掉，现全文 36 个围栏全部配对。

### 🗂️ 优化：事件日志改为按天单文件

旧规则是每次运行生成 `Wow-YYYY-MM-DD-HHMMSS-PID.log`，退出时再改名。
一天里开关几次服就散落好几个文件，翻日志得先猜时间。

改为**按天聚合**：

```
logs/Wow-2026-10-18.log    ← 同一天的所有运行都写进这一份
```

- 同一天多次启动/停止**追加**到同一文件，用「会话开始 / 会话结束」标记区分每次运行
- 结束标记带本次运行时长；存在错误记录时额外标注 `⚠️ 存在错误记录`
- 单行写入截断到 3600 字节（小于 `PIPE_BUF`，保证多进程 `appendFileSync` 的 POSIX 原子性），超长行附 `…[已截断]`
- 强杀（SIGKILL / 断电）不会留下「会话结束」标记 —— 反过来可以用它判断异常中断
- 启动时自动清理历史版本遗留的 `-active.log` 残留文件

### 🚀 调整：启动方式 —— `wow` 无参数直接进数字菜单，长命令模式改为 `wow L`

原来 `wow` 无参数会打印帮助，进菜单要打 `wow m`；而 `wow`（无参数）这个最顺手的位置
反而给了最没有信息量的输出。本次把入口对调：

| 命令 | 旧行为 | 新行为 |
|------|--------|--------|
| `wow` | 打印帮助 | **直接进入数字选择菜单** |
| `wow m` | 进入菜单 | ❌ **已移除**（`error: unknown command 'm'`） |
| `wow L` | 无此命令 | 长命令模式：无参进交互式 REPL；带参执行单条后退出（如 `wow L server start`） |

- `wow.sh` / `wow.bat` 的无参调用随之改为直达菜单；非交互场景（Docker、面板后台）
  仍走 `web start` 保活，不受影响
- 开服控制台里输入 `m` 会得到新指引（提示改用无参数启动），输入 `L` 会被拒绝
  （REPL 会抢占 stdin，在开服控制台里不可用）

### 📵 撤销 Android 支持（Termux / proot）

经评估确认：**Android 上无法运行 Wow 服务端**，本版起正式撤销 Android 支持。

根因是 Android 的网络命名空间沙箱，不是配置问题、无法绕过：

- Termux 内监听的端口在**其他 App / 其他设备上不可见**（每个 App 独立网络栈）
- SELinux 限制非授权进程绑定通配地址
- proot-distro 只做文件系统模拟，**不改变网络栈**
- 非 root 无法突破以上限制；陶瓦（EasyTier）依赖真实网络接口，联机随之失效

随之落地的文档调整：

| 文档 | 调整 |
|------|------|
| `README.MD` | 系统要求移除 Android 行；新增「📵 不支持 Android」独立章节 |
| `docs/TROUBLE_ANDROID(Termux).md` | 重命名为 `docs/ANDROID_LIMITATIONS.md`，由故障排除指南改为**已知限制说明**（含可作联机客户端 / Web 面板访问端的说明） |
| `docs/QUICKSTART.md` / `docs/wow.md` | 移除 Android / 手机开服示例与「理论上可行」表述 |
| `docs/LAN_TERRACOTTA.md` | 「平台支持」移除 Android 服务端路径，保留客户端用法 |

Android 手机**仍可作为联机客户端加入他人房间**，或作为 Web 面板的访问端。

### 🌐 陶瓦联机实测通过（2026-10-17 里程碑）

LAN（陶瓦）联机完成真实环境测试，**家宽对家宽 P2P 打洞成功**：

- 实测双方均为家用宽带、相距约 3 公里，联机稳定
- 房间号 `U/GB30-YMAT-NBN0-GXP1`
- 完整实测记录见 `docs/LAN_TERRACOTTA-TEST-REPORT.md`（含 NAT / CGNAT 技术分析与结论）

已知限制：**移动数据下打洞成功率几乎为零**——运营商 CGNAT + 对称型 NAT 组合下
UDP 打洞不可行。开服方与加入方均需使用 Wi-Fi（家用宽带）。此结论已写入
`docs/LAN_TERRACOTTA.md` 文首提醒。

### 🧪 测试（本版累计）

新增 6 个测试文件：

- `core/test/forge_core_path.test.js`（26 项）
- `core/test/forge_scheme_roundtrip.test.js`（9 项）
- `core/test/mail_whitelist.test.js`（25 项）—— 归一化 / 判定语义 / 配置读取 / 兼容键名
- `core/test/mail_whitelist_e2e.test.js`（12 项）—— 真实起 Express 打接口，
  验证 403、不生成验证码、登录二次校验、通配符、边界输入
- `core/test/log_daily_file.test.js`（25 项）—— 按天命名 / 同日追加 / 会话标记 /
  时长与错误标注 / 超长行截断 / 跨天滚动 / 强杀无结束标记
- `core/test/interactive_menu.test.js`（21 → 32 项）—— 补充 V3.5.8 启动方式断言：
  `wow` 无参数进菜单、`L` 命令注册与 REPL 分发、`m` 已移除、控制台分类新指引

全套测试 **13 个文件 / 417 项全部通过**，`core/wow.yaml` 与 `scheme/` 无污染。

### ⬆️ 升级须知

- 无需手动迁移。已有的老方案（`resources.core.file` 是纯文件名）继续可用。
- 已安装的 Forge 1.21+ 方案**需要重建**：旧版本在安装阶段就会抛「未找到核心」，
  目录里可能残留 `libraries/` 但不完整。建议 `scheme create` 重新来一遍。
- 若 `scheme.yaml` 里的 `core.file` 与实际文件对不上，删掉该方案重新创建最省事。
- **启动习惯要改**：`wow m` 已移除，直接敲 `wow`（或双击 `wow.bat`）即进菜单；
  原来的长命令 REPL 改为 `wow L`（带参数可执行单条，如 `wow L server status`）。
  自定义脚本 / 面板配置里写死 `wow m` 的需要同步改。
- **日志文件名变了**：`logs/` 下旧版是按次生成的 `Wow-日期-时间-PID.log`，
  本版起同一天统一写 `Wow-YYYY-MM-DD.log`。旧文件不会被自动清理，需要的话手动归档。
- **Android 不再支持**：Termux / proot 用户请迁移到 PC；手机仅保留联机客户端与
  Web 面板访问两种用法（见 `docs/ANDROID_LIMITATIONS.md`）。

---

## [3.5.7-26.2e] — 2026-10-16

> 主题：**跨平台修复 + Java 自动搜索与安装 + 危险指令分档开关**。
> 这一版把「只在 Linux 能跑」的隐患集中清理了一遍，并让 Java 环境完全自动化。

### 🖥️ 修复：Web 文件管理在 Windows 上完全不可用

Web 面板的文件管理（新建文件夹、重命名、删除、移动、复制、压缩、解压）此前全部通过
`/api/exec` 调用系统命令实现，用到了 `mkdir`、`mv`、`rm -rf`、`cp -r`、`zip`、`unzip`、`tar`。
这些命令中**只有 1 个在 Windows 上存在**，导致 Windows 用户点击「新建文件夹」必然报错。
此外，文件名直接拼进命令字符串，含 `;`、反引号等字符即可造成命令注入。

本次改为**纯 Node.js 实现**，彻底消除 shell 依赖与注入面：

- `file_manager.js` 新增 8 个操作函数：`makeDir` / `renameEntry` / `transferEntry`（移动·复制）/
  `removeEntry` / `compress` / `extract` / `readText` / `writeText`
- `web_service.js` 新增 9 条 REST 路由：`POST /api/files/mkdir`、`rename`、`move`、`copy`、
  `compress`、`extract`、`DELETE /api/files`、`GET|PUT /api/files/content`
- `web/file.html` 8 处 shell 调用全部改为 `fetch`；删除操作由 `confirm` 升级为
  **要求输入 `DELETE` 全大写确认**，避免误触
- **跨平台文件名校验**：拒绝 `<>:"|?*` 与控制字符、Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）、
  以点或空格结尾的名称、超长名称
- **zip slip 防御**：解压时逐条校验条目名，拒绝 `..`、绝对路径、盘符越界；被跳过的条目会明确报告
- `safeResolve` 由「静默剥离前导斜杠」改为**明确拒绝绝对路径**，消除语义歧义

> 压缩包格式：`.zip` 走纯 Node（`adm-zip`）；`.tar.gz` 的**解压**在 Web 端暂不支持，会给出明确提示（终端可用）。

### ☕ 新增：Java 自动搜索、版本匹配与自动安装

之前的问题是「找到哪个 Java 就用哪个」，装了 Java 17 但服务器需要 Java 21 时会静默用错版本，
启动即崩。本次做了完整重构：

**1) 全平台 Java 扫描** — `utils.scanAllJava()` / `utils.findJavaByMajor()`

覆盖来源：`PATH`、`JAVA_HOME`、系统包（`/usr/lib/jvm`、`/usr/java`、`/opt/java`）、
IDE 下载目录（`~/.jdks`）、版本管理器（mise / rtx / sdkman / asdf / jabba）、
macOS（`/Library/Java/JavaVirtualMachines`、Homebrew `openjdk@17`）、
Windows（`Program Files\Java`、`Eclipse Adoptium`、`Corretto`、`Zulu`、`BellSoft`、`Semeru`、`Microsoft`）。
结果按主版本升序排列，用 `realpath` 去重（避免 `/usr/bin/java → alternatives → 真实 jdk` 被算三次）。

**2) 版本匹配策略** — 精确优先，**仅允许 LTS 向上兼容**

| 需要 | 可用替代 | 说明 |
|------|----------|------|
| Java 8 | 无 | Java 9+ 移除大量 API，1.12.2 服务端在 17 上必崩 |
| Java 11 | 17 / 21 | LTS 向上兼容 |
| Java 17 | 21 | LTS 向上兼容 |
| Java 21 | 无 | 1.20.5+ 字节码需要 21+ |

非 LTS 版本（如 Java 20）**不会**被用来替代 LTS 需求。

**3) 自动安装** — 本机找不到匹配版本时，从 Eclipse Temurin（Adoptium）自动下载

修复了安装链路中的三个问题：
- 下载产物扩展名按**重定向后的最终 URL + content-type** 推断（此前硬编码 `.zip`，
  而 Linux/macOS 拿到的是 `.tar.gz`，解压分支必选错）
- 解压改为**纯 Node**（zip 走 `adm-zip`，tar.gz 走 `tar`）—— 此前无条件调 `unzip`，
  该命令在 Windows 上不存在，导致 Windows 用户永远无法完成 JRE 安装
- 解压后**自动剥壳**：Temurin 归档内层多套一层 `jdk-17.0.12+7/`，
  现在会定位真正的 JDK 根并提升，得到预期的 `core/jre/17/bin/java`；
  同时补 `chmod 755`（zip 解压会丢失执行权限）

**4) 菜单 11 → 1 重做** — 由「手填 Java 路径」升级为交互式管理

会列出本机扫描到的**全部 Java**（标注主版本与来源）供选择，另提供
`自动检测` / `手动输入路径` / `按 MC 版本自动安装` 三个入口。

### 🔧 修复：MC 版本 → Java 版本的映射错误（影响 1.3~1.9 全部版本）

`getRequiredJavaVersion` 此前用 `parseFloat` 比较版本号：

```js
parseFloat('1.8.9')  // => 1.8
1.8 <= 1.16          // => false（因为 1.80 > 1.16）
```

于是 **Minecraft 1.8.9 被判为需要 Java 21**，1.3~1.9 的所有版本都受影响。
现改为按「点分整数」逐段比较，并把 `scheme_manager.js` 中重复的一份映射也统一到同一实现。

同时修正 1.20.5+ 的边界（此前 `<= 1.20` 会把它归到 Java 17，实际需要 Java 21）。

### 🔧 修复：`_getFeatureVersion` 数字入参失效

`getJavaExecutable(8)` 传入数字时，内部 `_getFeatureVersion` 只与字符串 `'8'` 比较，
返回 `null`，导致**跳过版本匹配、直接掉进「任意 Java」兜底分支**。
现统一归一化为字符串，并支持 `jdk8` / `java17` / `8u442` 等写法。

### 🔧 修复：Temurin 下载 URL 404

`baseUrl` 末尾多带了 `/version`，与路径段本身拼出
`/v3/binary/version/latest/8/ga/...` 这种 404 路径。已修正为 `/v3/binary`，
实测 Windows / Linux / macOS × Java 8 / 17 / 21 全部可达。

### 🛡️ 新增：危险指令分档开关（方案 B）

此前 Web 端危险指令是**硬编码拒绝清单**，无任何放开途径。现拆分为两档：

- `SCHEME_OPS`（方案操作）：`scheme create/switch/delete/edit/pull/prune/register/export/import`
  → 可通过配置 `web.allow_scheme_ops: true` 放开
- `DENIED_WEB_ALWAYS`（永久拒绝）：`init`、`mod remove/sync/toggle`、`pack install`、
  `web start`、`logs tail` → **不受任何开关影响**

新增 `web.allow_remote_install`（默认 `false`）控制远程安装入口。
两个开关**默认全关**，保持既有安全基线。
拒绝时会明确告知所需配置项，便于用户按需放开。

新增**启动自检** `auditDangerousConfig()`：当检测到「危险开关已开 + 面板监听 `0.0.0.0`
+ `dev_mode=true`」等危险组合时，在启动日志中打印安全提示（仅提示，不阻断启动）。

### 🎨 优化：主菜单第 2 项改为「新建方案」

原第 2 项是「下载/安装实例」，直接把核心装到当前目录，**不建方案也不询问方案名**，
与「方案即服务器运行目录」的模型冲突，且与菜单 13 功能重叠。

现改为完整的新建方案流程：询问方案名 → 校验合法性 → 选择核心类型 →
询问版本/加载器/构建号 → 创建方案目录并安装核心，失败时自动回滚。
原菜单 13 的「1. 创建方案」已移除，其余子项重编号为 1-4。

> 顺带修掉一个静默 bug：旧菜单 13-1 调用 `schemeManager.create(name, version, loader)`
> 用的是**三个位置参数**，而该方法签名是 `create(name, options = {})` —— 用户输入的
> 版本和加载器被**静默忽略**，永远用默认值。现已改为正确的对象签名。

### 📌 涉及文件

| 文件 | 变更 |
|------|------|
| `core/src/file_manager.js` | 新增 8 个跨平台文件操作函数 |
| `core/src/web_service.js` | 新增 9 条文件 REST 路由、启动自检 |
| `core/src/command_policy.js` | 拆分 `SCHEME_OPS` / `DENIED_WEB_ALWAYS`、新增审计函数 |
| `core/src/config.js` | 新增 `allow_scheme_ops` / `allow_remote_install` 开关 |
| `core/src/utils.js` | 新增 `scanAllJava` / `findJavaByMajor`，重写 `detectJava` |
| `core/src/jre_manager.js` | 版本匹配重构、纯 Node 解压、剥壳、下载 URL 修正 |
| `core/src/scheme_manager.js` | Java 版本映射统一 |
| `core/src/server.js` | Java 解析改为严格版本匹配 |
| `core/src/installer.js` | Java 解析同步调整 |
| `core/src/interactive.js` | 菜单 2 改为新建方案、菜单 13 重编号、菜单 11-1 重做 |
| `web/file.html` | 文件管理全面改为 REST |

### 🔧 修复：`stopWeb()` 在同进程调用时会终止调用方

PID 文件由 `startWeb()` 写入 `process.pid`，而 `stopWeb()` 无条件优先走「按 PID 杀进程」分支。
当调用方与服务**在同一进程**时（CLI 内嵌调用、自动化脚本、测试），
`process.kill(self, 'SIGTERM')` 会把自己杀掉 —— 表现为调用方在 `stopWeb()` 处直接挂掉、
后续代码完全不执行，且退出码为 143（SIGTERM）。

现改为：读取 PID 后先判断是否为当前进程，是则跳过杀进程分支，直接走同进程内存模式关闭。

### 🔧 修复：`express.json()` 默认 100kb 上限 + 缺少全局错误处理

`PUT /api/files/content` 声称支持 2MB，但 `express.json()` 默认只接受 100kb，
超限请求会在 body 解析阶段就被拒并抛出未捕获的 `PayloadTooLargeError` 堆栈
（返回 HTML 错误页而非 JSON）。现提升到 4MB，并补上**全局错误处理中间件**，
把 body 解析类错误映射为明确的 `413` / `400` JSON 响应。

### ✅ 测试

新增 6 个测试文件，合计 **309 项全部通过**：

| 测试 | 数量 | 覆盖 |
|------|------|------|
| `test/file_ops.test.js` | 56 | 名称校验、增删改移复制、压缩解压、zip slip 防御、路径穿越 |
| `test/file_ops_edge.test.js` | 56 | 名称校验 39 项（保留名/控制字符/长度边界）、safeResolve 12 项、实际操作边界（自身子目录/根目录/非 zip/超限） |
| `test/command_policy.test.js` | 47 | 默认全关、单/双开关、永久拒绝项不受开关影响、审计警告 |
| `test/java_scan.test.js` | 61 | MC→Java 映射 25 项、LTS 兼容策略、扫描去重、类型归一化、严格/放宽模式 |
| `test/web_files_e2e.test.js` | 37 | **真实启动 Web 服务**逐个验证 9 条文件路由（认证/错误码/落盘/穿越/保留名） |
| `test/interactive_menu.test.js` | 21 | 菜单 2/13 结构、对象签名调用、旧位置参数已清除 |
| `test/jre_extract.test.js` | 10 | 解压三种布局剥壳、tar.gz/zip 端到端、**手工构造 zip slip 包**验证防御 |
| `test/file_manager.test.js` | 21 | （既有，已同步 1 处断言） |

---

## [3.5.6-26.2d] — 2026-10-15

> 主题：**Web 面板 API 补齐 + 核心下载源修复**。
> 修复「文件管理 / 模组下载 / 陶瓦开房等页面报错」与「`scheme create` 无法创建 paper 方案」。

### 🐛 修复：Web 面板大面积 API 404

前端页面调用的 10 个接口在后端根本不存在，点击即报错。本次全部补齐：

| 页面 | 缺失接口 | 处理 |
|------|----------|------|
| 文件管理 | `GET /api/files`、`GET /api/download`、`POST /api/upload` | 新建 `core/src/file_manager.js` 实现 |
| 模组下载 | `GET /api/mod/search`、`GET /api/mod/info`、`GET /api/download/status` | 新建 `core/src/mod_search.js` + `core/src/download_queue.js` |
| 方案管理 | `GET /api/pool/stats` | 实现池资源引用统计 |
| 设置 | `GET /api/plugins` | 接入 `PluginManager.list()` |
| 工具箱 | `GET /api/logs/analysis` | 读取最近分析报告，无报告优雅降级 |
| 仪表盘 | `GET /api/metrics` | 读取 `/proc` 的 CPU / 内存 / 运行时长 |

### 🔒 新增：文件管理（路径安全）

- 三重防御拒绝路径穿越：段级拒绝 `..` → `path.resolve` 后前缀校验 → `fs.realpathSync` 阻断符号链接逃逸
- 拒绝绝对路径、盘符路径、UNC 网络路径（`//server/share`）
- 上传文件名净化，拒绝控制字符与 Windows 保留字符 `<>:"|?*`，但保留子目录层级
- 单次上传上限 512MB，防内存耗尽
- 配套单元测试 `core/test/file_manager.test.js`，**21 项全通过**

> 路径范围：**严格限制在当前方案的运行目录内**（`scheme/<方案名>/`）。

### 🐛 修复：`lan.html` 报错（陶瓦开房）

`lan.html` 使用 `window.wow.apiRequest`，但页面**未引入 `web/js/main.js`**，导致 `window.wow` 为 `undefined`，任何点击都抛异常。已补上脚本引用。

> 经实测，陶瓦**后端完全正常**：二进制下载成功（11.8MB），开房返回房间号，状态机 `host-scanning → host-ok`，关房正常。开房前的端口自检（要求先 `wow server start`）是**预期的保护行为**。

### 🐛 修复：`scheme create --type paper` 下载失败

**根因**：核心下载 URL 拼装错误。

- 旧写法 `${mirror}/paper/<ver>/latest/download` 一律 404 —— BMCLAPI 仅镜像 Forge 与 MC 官方资源，**不提供 Paper 分发**
- 且 PaperMC 自身也已从 `api.papermc.io/v2`（现返回 410 Gone）迁移到 `fill.papermc.io/v3`

**修复**：
- `paper` 改走 `fill.papermc.io/v3` 两段式解析（先取 latest build，再取直链），实测成功下载 43MB 核心
- `spigot` / `bukkit` 官方无预编译包，改为**明确提示**并建议改用 Paper，不再抛含糊的网络错误
- `leaves` 改走 GitHub Releases 资产解析
- `purpur` 保持可用（实测 200）
- 新增 `kind: 'unsupported'` / `'papermc'` / `'github-release'` 三种下载策略

### 🐛 修复：方案创建失败后残留残缺目录

核心安装抛错时，方案目录（含 `world/`、`config/`、`mods/` 等）已创建但未清理，`scheme list` 中会显示一个没有 `scheme.yaml` 的「损坏方案」。

已加入**回滚**：`scheme create` 的核心安装步骤失败时自动删除整个方案目录。实测验证残留为 `false`。

### 🧹 清理

- 删除 `core/web/`（13 个文件）——这是 V3.5.2 迁移前的遗留前端副本，无任何代码引用，且缺少 `lan.html`
- 删除空目录 `server/`
- `.gitignore` 补充 `core/lan/`（陶瓦二进制，11MB，不应入库）

### 📄 文档

修正多处**滞后于代码**的说明：

- `README.MD`：项目结构图（`core/schemes/` → `scheme/`，移除 `server/`）；安装步骤改为主推 `scheme create`
- `docs/QUICKSTART.md`：核心列表的全部 `wow install <core>` 示例改为 `scheme create -t <core>`；为未实现的核心（Bukkit / Spigot / Folia / Sponge / Arclight）加注「暂不支持」；修正重复的工作流步骤
- `docs/SCHEMES.md`：方案目录路径 `core/schemes/` → `scheme/`
- `docs/COMMANDS.md`：`install` 命令说明改为「核心安装已移至 `scheme create`」
- `docs/API.md`：补齐本次新增的全部接口文档与错误码（`403` / `413` / `502`）

---

## [3.5.5-26.2c] — 2026-10-14

### 修复：Windows 端 `update.bat` 自动更新完全失效

> 现象：Windows 下 `update.bat` 输出 `Latest: v3.5.4-26.2b` 但 `URL:` 为空，随后 PowerShell 报
> 「无效的 URI：未能分析主机名」，最终「未能找到文件 update.zip」，却仍打印「Update complete」。

- **🔴 选源结果解析失败（根因）**：原 PowerShell 用 `foreach + Write-Output $h[0]; Write-Output $t` 输出**两行**，再由 `for /f` 配合 `if !IDX!==0` 逐行判定谁是 host、谁是 tag。该写法在 `for /f` 块内存在解析歧义且 `$h[1]`/`$h[2]` 在函数位置参数下索引不可靠。改为输出**单行 `host|tag`** + `for /f "tokens=1,2 delims=|"` 一次解析，并显式以 `-base`/`-repo` 具名传参。
- **🔴 `set` 写在 `if()else()` 括号块内**：`set DOWNLOAD_URL=...` 在两个分支块内赋值，批处理在**进入块前**即展开块内所有 `%VAR%`，导致 URL 拼不出来。改用 `goto :label` 分支（`update.bat` 与既有 `scheme` 逻辑保持同一风格）。
- **🔴 版本正则不支持新版本号格式**：`^v?\d+\.\d+\.\d+(-[0-9]+\.[0-9]+)?$` 无法匹配 V3.5.2 起启用的**十六进制后缀**（如 `-26.2c`/`-26.2d`）。一旦走 tags API 兜底，所有新版 tag 会被过滤干净 → 永远认为"无可用版本"。修正为 `[0-9a-fA-F]+`。**`update.sh` 存在同一缺陷，一并修复。**
- **缺少 URL 空值防护**：`DOWNLOAD_URL` 为空时不再静默继续，改为明确报错并中止。
- **缺少 zip 完整性校验**：补上与 `update.sh` 对齐的完整性测试（无法打开或 0 条目则拒绝覆盖）。

### 修复：自更新脚本覆盖自身导致报错

> 现象：`update.sh: line 172: $'\235启动脚本可执行（含': command not found`（`update.sh` 自测时复现）。

- **🔴 排除清单未含脚本本体**：覆盖阶段会连 `update.sh` / `update.bat` **自身**一起覆盖，运行中的脚本字节流被改写 → 解析错乱报错。已加入排除。
- **🔴 排除清单仍写 `server`**：V3.5.2 起运行目录已改为根 `scheme/`，旧清单会**覆盖用户的方案与存档**（数据丢失风险）。已改为排除 `scheme` 与 `logs`。

### 优化：版本比对，已是最新则跳过

- 两端更新器新增本地版本读取（`core/package.json` 的 `version`）并与远程 tag 比对：**一致则直接跳过下载与覆盖**。
- 既减少重复下载，也从源头避免"每次启动都覆盖自身"。

### 优化：`update.bat` 暂停行为

- 原 `pause` 会在自动化平台（简幻欢等）或由 `start.bat` 调用时**阻塞流程**。改为仅在交互式终端（双击运行）才暂停；可用 `WOW_NO_PAUSE=1` 强制跳过。

### 验证
- `update.sh` 隔离环境实测：最新版场景正确跳过；非最新场景下载→完整性校验→覆盖全流程通过，且 `scheme/` 用户数据完好保留、无自我覆盖报错。
- `bash -n update.sh` 通过；版本正则对 `v3.5.5-26.2c` / `v3.5.1-26.28` 均匹配、对 `backup/*` 正确排除。

### 版本号
- `3.5.5` 语义版本（大.中.小）｜`26` = 2026 后两位｜`3d` = 十六进制**第 61 个**发行包（`0x3d` = 61）

---

## [3.5.4-26.2b] — 2026-10-12

### 修复：V3.5.2 目录迁移残留，导致「切换方案后 server start 找不到核心」

> V3.5.2 把方案目录从 `core/schemes/` 迁到根 `scheme/`、并删除了 `server/` 目录，但有若干路径未同步更新，
> 造成「即使 `scheme switch` 成功，`server start` 仍在错误目录找 .jar 并报未找到核心」。

- **🔴 `utils.getServerDir()` 方案路径错误**：仍按旧路径 `core/schemes/<方案名>` 查找，永远判为不存在 → 直接回退到根目录，方案切换形同失效。改为 `../scheme/<方案名>`，与 `SchemeManager.schemesDir` 完全一致。**这是本次问题的根因。**
- **🔴 `core/wow.yaml` 仍指向已删除的 `server/` 目录**：`server.dir: ../server` → `../scheme`；`backup.dir: ../server/backups` → `../scheme/backups`。原配置会让未激活方案时直接落到已被删除的 `server/` 目录。
- **`pack_generator.js` 存档路径错误**：`serverDir/../../server/worlds/<存档>` → `serverDir/world`（旧路径在 `server/` 被删除后永远不存在，导致「现有存档」选项始终失效）。
- **`cli.js init` 仍在创建废弃目录**：移除初始化列表末尾多余的 `utils.resolvePath('schemes')`（会在 `core/` 下重建旧目录）。

### 修复：install 命令「去除不彻底」

- **`server start` 报错文案仍引导 `install`**：原输出「未找到服务器核心，请先用 install 命令安装 / wow install \<类型\> \<版本\>」，而该命令自 V3.5.2 起已不存在，属于误导。改为按上下文给出指引：
  - 已激活方案 → 提示该方案目录、建议 `scheme switch <方案>` 补齐；
  - 未激活方案 → 提示 `scheme create <名称> --type <类型> --version <MC版本>`。
- **`scheme switch help` 被当成方案名**：`scheme switch help` / `-h` / `--help` 现在输出用法与 `scheme list`，不再报「方案 help 不存在」。
- **切换失败时列出可用方案**：`scheme switch <不存在>` 报错后追加可用方案列表；无任何方案时提示先用 `scheme create`。

### 彩蛋恢复

- **`install party` 彩蛋补回真实实现**：`core/src/party/party.js`（此前为占位）替换为完整实现——隐藏的 `EGG_REGISTRY` 注册表（首个彩蛋 `badapple`）、口令校验、按需下载/解压并播放；新增彩蛋只需在注册表加一条，无需改动其他文件。

### 其他

- `wow.sh` / `start.sh` 修正为可执行权限（644 → 755）。

### 版本号
- `3.5.4` 语义版本（大.中.小）｜`26` = 2026 后两位｜`3c` = 十六进制**第 60 个**发行包（`0x3c` = 60）

---

## [3.5.3-26.2a] — 2026-10-04

### 安全整改（响应代码审查）
> 基于一份第三方安全/工程质量审查报告，对高危与易改中危问题落地整改。**安全优先，不为新手便利牺牲服务器安全。**

- **🔴 Web `/api/exec` 与 WebSocket 命令加拒绝清单（V3.5.3）**：新增 `core/src/command_policy.js`，导出 `isWebCommandAllowed()`。Web 端禁止 `scheme delete/create/switch/edit/pull/prune/register/export/import`、`mod remove/sync/toggle`、`pack install`、`web start`、`logs tail`、`init`、以及 `install <远程 http(s) 地址>` 与 `config` 写入形态；其余 wow 命令（含面板正常使用的 `server start`、`mod install`、`theme install/switch/delete`、`plugin *`、`set *`、`pack generate`、`install <本地文件>` 等）放行。覆盖审查点名的 `scheme delete`/`mod remove` 等灾难性操作，同时不打断面板功能。
- **🔴 生产环境不再回显登录验证码（devCode）**：未配置 SMTP 时，仅当 `web.dev_mode=true` 或 `NODE_ENV=development` 才随响应返回验证码；否则返回 `403` 并提示「请先在终端配置 SMTP 或设置离线密码（web.auth_password）后再登录」。堵住「未配 SMTP 即可直接拿到验证码登录」的绕过。
- **🔴 新增离线密码登录**：`web.auth_password` 配置项（scrypt 哈希存储，明文首次使用即哈希持久化），作为不配 SMTP 时的合法替代登录方式；登录接口新增密码分支。
- **🔴 `update.sh` 加完整性 / 哈希校验**：下载后先做 `unzip -tq` 完整性测试，失败即拒绝覆盖；并尝试从同源获取 `SHA256SUMS` 清单校验 zip 哈希，不符则拒绝覆盖（供应链 RCE 面收敛）。建议发版时随 tag 附带 `SHA256SUMS`。
- **🟡 `utils.js` 改用 `execFileSync` / `spawnSync`**：移除 `execSync` 模板字符串插值（原 `which ${cmd}` 等），消除潜在命令注入模式。
- **🟡 WebSocket CORS 收紧**：`cors.origin` 由 `'*'` 改为可配置 `web.cors_origins`（默认空=仅同源）；跨域部署时显式设置白名单。
- **🟡 密钥支持环境变量**：`web.auth_token` 优先读 `WOW_WEB_AUTH_TOKEN`；SMTP 凭据 `user`/`pass` 支持 `WOW_MAIL_SMTP_USER` / `WOW_MAIL_SMTP_PASS`，避免明文落 `wow.yaml`。

### 配置新增（兼容旧配置，默认关闭/空）
- `web.dev_mode: false`
- `web.auth_password: null`
- `web.cors_origins: []`

### 版本号
- `3.5.3` 语义版本（大.中.小）｜`26` = 2026 后两位｜`3b` = 十六进制**第 59 个**发行包（`0x3b` = 59）

---

## [3.5.2-26.29] — 2026-09-26

### 重大变更
- **交互式 REPL（V3.5.2）**：`./wow.sh` 无参数运行不再只弹出帮助后退出，而是进入交互模式，逐行读取指令且**无需 `wow` 前缀**（如直接输入 `server start`，原 `wow server start`）；输入 `exit` / `quit` 退出。`exitOverride` 兜底未知指令与帮助展示，每条指令仍由事件日志系统记录。
- **install 命令精简**：保留隐藏命令 `install party` 彩蛋与 `install <URL>` 通用文件下载；**服务端核心安装（vanilla/paper/forge/fabric…）全部移除**，统一改用 `scheme create <名称> --type <核心> --version <MC版本>`（scheme 内部仍调用 `installer.install`）。
- **scheme 目录迁移到根目录**：`core/schemes/` → 根 `scheme/`（`.gitignore` 同步改为 `scheme/`）。
- **删除 `server/` 目录**：服务器运行目录彻底改为「当前激活的方案目录」；`utils.getServerDir()` 默认回退由 `../server` 改为 `../scheme`，`config.js` 的 `server.dir` / `backup.dir` 默认值同步更新。

### 版本号
- `3.5.2` 语义版本（大.中.小）｜`26` = 2026 后两位｜`3a` = 十六进制**第 58 个**发行包（`0x3a` = 58）

---

## [3.5.1-26.28] — 2026-09-26

### 🔄 优化：启动即自检更新

- `start.sh`（及 Windows 端 `start.bat`）在转发到 `wow.sh` / `wow.bat` **启动前**，先（最佳努力）运行 `update.sh` 检查并应用更新；更新过程失败仅警告、**不阻断服务启动**（沿用 `update.sh` 的容错设计）。
- 支持环境变量 `WOW_SKIP_UPDATE=1` 跳过自检更新（便于本地开发调试，避免每次启动都联网）。
- `update.sh` / `update.bat` 继续采用**源码归档 zip**（Gitee `repository/archive/<tag>.zip`、GitHub `archive/refs/tags/<tag>.zip`，即 Source code zip）进行覆盖更新，无需私人令牌、无需多镜像。

### 🔖 版本号

- 本版为 `V3.5.1-26.28`：`3.5.1` 语义版本（大.中.小）、`26` = 2026 年后两位、`28` = 自上传开源仓库后的第 **40** 个发行包（`0x28` = 40，十六进制）。

---

## [3.5.0-26.27] — 2026-09-26

### 🆕 新增：事件日志系统（重构）

> 版本号格式调整为 `V大版本.小版本.补丁更新号-发布年份后两位.自上传到开源仓库后的第xx个发行包（十六进制）`，本版为 `V3.5.0-26.27`。

- 新增 `core/src/log.js` 事件日志模块，统一记录 **wow 本体运行过程中的事件**：
  - 用户运行了哪些**有效指令**（含 Web 面页面 `/api/exec` 与 WebSocket `command`）、指令**返回内容**、**是否运行成功**；
  - **Minecraft 运行过程中是否报错 / 崩溃**（扫描服务端输出中的 `ERROR`/`Exception`/`Caused by` 等特征行，记入 `ERRO`；进程非零退出或异常标记为崩溃）。
- 日志文件位于 wow 根目录 `logs/`：
  - 命名：`Wow-[YYYY-MM-DD]-[MIN].log`，`MIN` 为本次运行持续分钟数；进程跨越 `00:00` 自动另起按新日期命名的文件；
  - 若本次运行出现**崩溃记录**，文件名追加 `-Wrong`：`Wow-[YYYY-MM-DD]-[MIN]-Wrong.log`；
  - 文件开头固定为：`Wow～ V<版本>` + 运行系统 / 系统架构 / JAVA版本 / node版本；
  - 每行格式（二十四小时制）：`[HH:MM:SS-信息分级]信息内容`，信息分级含 `INFO` / `IMPT` / `WARN` / `ERRO`。
- 接入点：`cli.js`（全局指令钩子 + 异常兜底）、`server.js`（MC 生命周期与运行报错）、`web_service.js`（Web 面板指令与启动/停止）、`interactive.js`（菜单操作）、`installer.js` / `jre_manager.js` / `mailer.js`（安装 / JRE 下载 / 邮件与崩溃报告关键事件）。

---

## [3.4.12] — 2026-09-13

### 🔄 优化：自更新「优先 Gitee」真正生效（无需 Gitee 私人令牌）

> 此前 `update.sh` / `update.bat` 仅从 `releases/latest` 取版本；若 Gitee 仓库只推送了 tag、未发布 Release，该接口会 404 并整体回退到 GitHub，导致「优先 Gitee」形同虚设。现增加 tags API 兜底解析。

- 版本解析顺序：先试 `releases/latest`（已发布 Release 时优先采用）；失败则回退到 `tags` API，过滤 `backup/` 等非版本标签，按 semver 取最大版本号；
- 下载统一走源站 zip（Gitee `repository/archive/{tag}.zip` / GitHub `archive/refs/tags/{tag}.zip`），全程无需私人令牌、不保留多镜像；
- Gitee 主源、GitHub 兜底的优先级不变。

---

## [3.4.11] — 2026-09-13

### 🔄 变更：自更新源迁移到 Gitee（GitHub 旧仓库作兜底）

> 仓库地址由 GitHub `nuoge2333/Wow-` 迁移到 Gitee `nuoge233/wow`。自更新脚本优先从 Gitee 拉取，Gitee 不可达时自动回退 GitHub 旧仓库，去掉原来的 ghproxy 多镜像代理。

- `update.sh`：主源 `https://gitee.com/api/v5/repos/nuoge233/wow/releases/latest`，兜底 `https://api.github.com/repos/nuoge2333/Wow-/releases/latest`；源站 zip 回退按当前源分别走 `gitee.com/.../repository/archive/{tag}.zip` 与 `github.com/.../archive/refs/tags/{tag}.zip`；
- `update.bat`：同样 Gitee 优先、GitHub 兜底；
- `README.MD`：Issue 与官方发布页链接改为 Gitee。

---

## [3.4.10] — 2026-08-28

### 🐛 修复：JRE 17 自动下载失败 `Request failed with status code 404`

> 根因：`jre_manager.js` 的 JRE 下载 URL 模板里使用了字面 `version` 段，而 Temurin API 的 `version` 端点要求**完整版本号**（如 `17.0.12+7`），仅传特征号 `17` 解析不到 → 返回 404。

- `_getDownloadUrl` 改为默认走 `latest/{featureVersion}` 端点（307 跳到 GitHub Release 真实 tar.gz/zip），8/11/17/21 全平台生效；
- 兼容旧行为：若用户在 `config.json` 写 `jre.version: "17.0.12+7"` 锁定完整版本号，则走 `version/{完整版本号}` 端点，行为更可控；
- `_downloadFile` 仍用 `maxRedirects: 5 + stream`，可顺利拿到 307 后的 tar.gz/zip。

---

## [3.4.9] — 2026-08-28

### 🐛 修复：`mailer.js` `sendMail` 增强（拒收检测 + 返回详情）

- `core/src/mailer.js` 的 `sendMail` 方法：发送后检查 `info.rejected`，若有被拒收收件人则明确告警并返回 `{ success:false, error, rejected }`；
- 成功返回从 `{ success:true }` 扩展为携带 `messageId` 与 `accepted` 字段，便于调用方追踪投递结果；
- 调用方（`sendVerificationCode` / `sendTestEmail` / `sendAdminAlert`）仅判 `.success`，新增字段向后兼容，不影响现有逻辑。

---

## [3.4.8] — 2026-08-27

### 🐛 修复：简幻欢部署「服务器已停止运行」+ 自动更新「无法解析版本信息」

> 根因：V3.4.6 按需求删除了根目录 `start.sh`，但**简幻欢等自定义镜像的启动契约就是执行根目录 `start.sh`**，删除后平台找不到启动脚本 → 报「服务器已停止运行，请检查启动脚本」。`start.sh` 已恢复（仅转发到 `wow.sh`，与 V3.4.4 的修复一致）。

#### 1. 恢复 `start.sh` / `start.bat` 入口
- 简幻欢固定执行根目录 `start.sh` 启动服务器；该脚本仅 `exec "$SCRIPT_DIR/wow.sh"`，不重复维护启动逻辑。
- 自动更新（`update.sh`）失败只会警告并 `exit 0`，**绝不阻断启动**。

#### 2. 重写 `update.sh` 自动更新（多镜像兜底 + JSON 校验）
- 版本检查依次尝试：`ghproxy.net` → `ghproxy.com` → 官方 `api.github.com`，任一返回含 `tag_name` 的合法 JSON 即采用；乱码/错误页会被拒绝并自动换源，不再误报「无法解析版本信息」。
- 下载更新包同样走镜像回退（原始地址 + ghproxy 代理），提升大陆网络下的自更新成功率。
- 无自定义 zip 资产时，自动回退到 GitHub 生成的 `Source code (zip)`。
- 覆盖更新时确保 `start.sh` / `wow.sh` / `update.sh` 均 `chmod +x`。

---

## [3.4.7] — 2026-08-27

### 🐛 修复：Mohist（墨端）下载失败 `getaddrinfo ENOTFOUND dl.mohistmc.cn`

> 根因：Mohist 原下载站 `dl.mohistmc.cn:41211` 已于 2025 年停用（域名已无 DNS 解析），官方统一迁移到 `mohistmc.com` 的 v2 API；且构建标识由「数字构建号（如 346）」改为「git sha」，旧硬编码构建号全部失效。

#### 1. 下载源切换到官方 v2 API
- `core/src/installer.js` 的 `mohist` 源改为：
  - 主：`https://mohistmc.com/api/v2/projects/mohist/{版本}/builds/{gitSha}/download`
  - 备份：`https://mohistmc.com/api/v2/sources/github/{版本}/builds/{gitSha}/download`（同源互为备份，Cloudflare 拦截时自动换源）
- 新增 `resolveBuild(version)`：下载前先 `GET /builds/latest` 解析最新构建的 git sha，不再要求用户手填构建号（交互菜单与 `wow install mohist 1.20.1` 现在都能直接用）。

#### 2. 直连下载增加「空文件」校验
- 新增 `_downloadWithFallbacks(url, dest, fallbacks)`：依次尝试主源与备份源，任一成功即可；
- 对下载到 **0 字节** 的情况（典型为被 CDN/Cloudflare 拦截返回空体）显式报错，避免静默写出假成功 jar。

#### 3. 版本显示修正（顺带）
- 主菜单 banner 原写死 `V3.3.17`，现改为读取 `core/package.json` 真实版本；`wow -V` 同步为 `3.4.7`。

> 注：若你的服务器出口 IP 被 `mohistmc.com` 的 Cloudflare 拦截导致仍下载不动，可手动从 https://mohistmc.com/download 下载对应版本 jar，放入服务端目录后重试。

---

## [3.4.6] — 2026-08-27

### 🔧 优化：仪表盘状态横排、删除简幻欢兼容入口、修复 Web 子进程 Node 解析

#### 1. 主页仪表盘「服务器状态」改为横向布局
- 桌面端（≥900px）：保持 3×2 grid。
- 平板/窄屏（<900px）：6 张状态卡横排并允许横向滚动（`flex + overflow-x: auto + scroll-snap`），**不再纵向堆叠**，解决手机端浏览时一长串垂直卡片体验割裂的问题。
- 同步改：`themes/default/dashboard.html`。

#### 2. 删除 `start.sh`/`start.bat` 兼容入口
- 此前为「简幻欢」等自定义镜像启动而补回的 `start.sh`/`start.bat` 现已移除（按用户要求）。后续部署以 `wow.sh`/`wow.bat` 为唯一启动入口。

#### 3. 修复 Web 服务 spawn 子进程解析 Node 失败
- `core/src/web_service.js` 中 `execCommand` 把 `spawn('node', ...)` 改为 `spawn(process.execPath, ...)`，与 `server.js:164` 已使用的 `process.execPath` 模式一致。
- 解决用户服务器用 mise/shim 管理 Node 时出现的：
  - `mise ERROR No version is set for shim: node`
  - 「创建方案」等 Web 操作「程序没反应」「自动启动 web 失败」

#### 4. 同步清理：移除前端的废弃 `--loader` 参数
- `web/scheme.html` 创建方案请求命令删掉了 `scheme create ... --loader <L>`，避免 commander 解析参数异常。
- 同步改：`themes/default/scheme.html`。

---

## [3.4.5] — 2026-08-26

### 🔧 修复：将 temp 目录统一收归 `core/temp`，修复越界写盘

> 背景：`core/src/pack_generator.js` 使用 `utils.resolvePath('../../temp/packs')`，`resolvePath` 基准目录为 `core/`，`../../` 会越过仓库根、把整合包临时文件写到**仓库上一级目录**（越界）；而 `core/src/cli.js`（down 命令）使用 `../temp`，解析到仓库根的 `temp`。两处既不一致、又都不在 `/core` 内。

- `pack_generator.js`：`'../../temp/packs'` → `'temp/packs'`，整合包临时目录落到 `core/temp/packs`。
- `cli.js`（down 命令）：`'../temp'` → `'temp'`，下载临时目录落到 `core/temp`，与前者统一。
- `.gitignore`：根级 `temp/` 改为 `core/temp/`，与 `core/down/` 等运行时目录归类一致。

---

## [3.4.4] — 2026-08-21

### 🔧 修复：恢复 start.sh / start.bat 启动入口

> 背景：V3.4.3 把 `start.sh` / `start.bat` 重命名为 `wow.sh` / `wow.bat` 并删除了旧脚本，导致简幻欢等靠执行根目录 `start.sh` 启动的自定义 / AIO 镜像报「找不到命令 / 请检查启动脚本」而停服。

- 重新补回 `start.sh`（Linux）/ `start.bat`（Windows），仅转发到 `wow.sh` / `wow.bat`，无参数时由 `wow.sh` 在非交互环境默认 `web start` 常驻，零双份维护。

### 🚀 优化（B）：优先复用系统 Node.js，免去便携版下载

- `wow.sh` 检测系统已安装的 Node.js（要求 `>=18`，与 `core/package.json` 的 `engines` 一致），若存在则**直接复用、跳过便携版下载**。典型收益：简幻欢 AIO 镜像自带 Node 22，启动不再联网拉取 Node 20，更快、更省网络依赖。
- 系统无 Node 或版本过低时，仍回退到原有「多镜像下载便携版」逻辑，行为不变。

### 🛡 优化（C）：自更新失败不再阻断启动

- `update.sh` 移除 `set -e`，并将 GitHub API 不可达 / 被限流 / 未找到 Release / 下载或解压失败等情形从 `exit 1` 改为**仅警告并跳过更新（`exit 0`）**。
- 目的：避免 `update.sh` 与 `start.sh` 串联时，自更新失败（受限网络）连带阻断服务器启动。

---

## [3.4.3] — 2026-08-21

### 🔧 优化：启动脚本换用更快的镜像源 + 重命名为 wow.bat / wow.sh

> 背景：`start.bat`（Windows）原本 Node.js 下载只用 `nodejs.org/dist`、npm 安装用默认 `npmjs.org`，国内极慢甚至被墙；`start.sh` 虽有镜像但顺序未优化。同时用户要求把启动脚本统一改名为 `wow.bat` / `wow.sh`。

镜像源优化：
- **Windows (`wow.bat`)**：Node.js 下载新增镜像回退链（npmmirror → 腾讯云 → 清华 → 华为云 → 官方），npm 安装默认走 `https://registry.npmmirror.com`。
- **Linux/macOS (`wow.sh`)**：把 `registry.npmmirror.com/-/binary/node` 与 `https://registry.npmmirror.com/` 提到镜像链最前（国内通常最快最稳），其余镜像作为兜底。

重命名与联动：
- `start.bat` → `wow.bat`、`start.sh` → `wow.sh`（`git mv` 保留历史）。
- 联动更新：`update.bat` / `update.sh`（靠启动脚本名定位项目根）、`core/src/scheme_manager.js` 的 `restart-script: ./wow.sh`（服务端崩溃自重启）、README / QUICKSTART / TERMS / 各 TROUBLE 文档的使用说明。
- 构建脚本 TOP 列表同步改为 `wow.bat` / `wow.sh`。

> ⚠️ 注意：旧 `start.bat` / `start.sh` 已移除，启动命令改为 `wow.bat`（Windows 双击）或 `./wow.sh`（Linux/macOS）。

---

## [3.4.2] — 2026-08-11

### ✏️ 调整：`scheme create` 命令参数重构

> 背景（用户测试反馈）：文档写 `wow scheme create xxx --version 1.20.1`，但 CLI 实际注册的是 `--mc-version`，实跑报 `unknown option '--version' (Did you mean --mc-version?)`，文档与代码不一致。

调整内容：
- 版本参数由 `--mc-version` 重命名为 `-v, --version`（短简称 `--v`）。
- 加载器参数 `--loader` 移除，并入 `-t, --type`：`--type` 的取值（vanilla/forge/fabric/neoforge/quilt/mohist/catserver/paper）同时决定核心类型与加载器，二者取值一致，不再分两个旗标。
- 构建号参数由 `--build` 增加短简称 `-b`。
- `cli.js` 中 `scheme create` 的 `action` 改为 `loader` 与 `type` 均取 `options.type`，不再读取 `options.loader`。

效果：`wow scheme create my_survival -v 1.20.1 -t forge` 与 `wow scheme create demo -v 1.20.1 -t vanilla` 均正常创建；旧 `--mc-version` / `--loader` 显式报 `unknown option`，符合预期。配套更新 `docs/COMMANDS.md`、`docs/QUICKSTART.md`、`docs/SCHEMES.md` 全部示例与说明。

---

## [3.4.1] — 2026-08-17

### 🐛 修复：方案改为「直接在方案目录内运行」（不再复制到 server/ 再跑）

> 现象（用户反馈）：切换/启动方案时，世界存档、配置在 `core/schemes/<方案>` 与 `server/` 两套目录间来回复制，出现重复/丢失；切换方案时 `server/` 被 `_backup_*` 目录堆积、原内容被整体清空；在方案目录里改了配置或存档却不生效（实际跑的是 `server/` 里的副本）。

根因：旧逻辑（`scheme_manager.switch()`）在切换方案时，会**把 `core/schemes/<当前方案>` 整体复制到 `server/` 目录，再由 `ServerManager` 以 `server/` 为根目录启动**。这是一个「模板模式」下的拷贝中介层，带来上述一系列同步问题。

修复：
- `utils.getServerDir()` 改为**优先返回当前激活方案的目录**（`core/schemes/<server.scheme>`，配置指向的目录存在时）；仅当未激活任何方案时才回退到默认 `server.dir`（`../server`）。
- 由于 `ServerManager`、`interactive.js`、`cli.js`、日志、陶瓦等所有消费方都通过 `getServerDir()` 取运行目录，这一处改动即让服务端**直接在方案目录内启动**，无需任何复制。
- `scheme_manager.switch()` 移除「备份 server 目录 + 复制方案到 server 目录」整段逻辑，切换方案只做：补齐目标方案（FULL）+ 登记 `server.scheme`/`server.version` + 瘦身旧方案 + 清理 pool。
- `server.start()` 增加兜底：若激活的方案仍为 `minimal`/`partial`（缺核心/模组文件），启动前自动从 pool 补齐（`_materializeScheme`），避免直接运行时缺文件。

效果：世界数据、配置、存档全部只存在于方案目录本身，改了立刻生效，切换不再有复制与 `_backup_` 残留。

---

## [3.4.0] — 2026-08-15

### ✨ 新功能：开服控制台三视图切换（Minecraft / wow / 陶瓦）

> 需求：开服后的交互终端支持在三个控制台视图之间切换；输入「不属于当前控制台」的指令时，提示「不支持」并引导切到对应控制台；切换后**清屏并显示该控制台最后 10 条日志**（陶瓦视图显示的是陶瓦本地 HTTP API 的返回内容）。

`wow server start` 的交互终端现在内置三个控制台视图，默认停留在 **Minecraft 服务端控制台**：

| 视图 | 切换指令 | 作用 |
|------|----------|------|
| 🎮 Minecraft 服务端控制台 | `:mc`（或 `:minecraft` `:1` `:服务端`） | 直接收发 MC 服务端指令（如 `op Steve`、`say hi`、`stop`） |
| 🧩 wow 指令控制台 | `:wow`（或 `:2`） | 执行 wow 服务端指令（如 `server status`、`scheme list`、`logs analyze`） |
| 🏠 陶瓦联机控制台 | `:lan`（或 `:terracotta` `:taowa` `:3` `:陶瓦`） | 开房 / 查房间 / 关房，并实时显示陶瓦 HTTP API 返回 |

行为要点：

- **切换即清屏 + 尾 10 条**：输入切换指令后清屏，打印标题栏，并显示该视图最近 10 条日志。Minecraft 视图读 `logs/latest.log`；wow 视图读 `logs/wow-console.log`；陶瓦视图读陶瓦 API 调用流水（`.lan-api.log`）。
- **指令隔离 + 友好引导**：在 Minecraft 视图输入 `lan host`、在 wow 视图输入 `list`、在陶瓦视图输入 `scheme list` 等「错视图」指令时，会提示「不支持：该指令属于某某控制台，请先输入 `:xx` 切换」，而不会误执行或静默吞掉。
- **陶瓦视图便捷指令**：在陶瓦视图里 `host` / `status` / `stop` 会自动补 `lan ` 前缀，等价于 `lan host|status|stop`。
- 元指令：`:log` 重新显示当前视图最后 10 条日志，`:help` 显示控制台帮助。
- 服务端原始 stdout/stderr 始终落盘到 `logs/wow-stdout.log`（逻辑分离见下方修复），但**只有停留在 Minecraft 视图时才回显到终端**，避免切到 wow / 陶瓦视图后被服务端日志刷屏。

### 🐛 修复：陶瓦开房 `lan host` 卡在 `host-scanning` 超时（自 V3.3.0 起的设计性缺陷）

> 现象（Termux/Android、公网服务器、macOS 均可能触发）：`wow lan host` 在 `host-scanning` 阶段卡住，wow 侧 30s 超时退出，拿不到房间号。

根因（扒取陶瓦 Rust 源码 `scanning.rs` / `fakeserver.rs` / `api.rs` 定位）：陶瓦**不是**扫描进程或端口来发现 MC 端口，而是**监听 Minecraft 局域网发现多播广播**——IPv4 `224.0.2.60:4445`、IPv6 `[FF75:230::60]:4445`，载荷格式 `[MOTD]<描述>[/MOTD][AD]<端口>[/AD]`。而 **Minecraft 专用服务端（`server.jar`）从不发送 LAN 多播广播**——只有游戏*客户端*「对局域网开放存档」才会广播。因此陶瓦永远拿不到端口，永久停在 `host-scanning`，wow 侧最终超时。这与平台无关，Termux 只是诱因之一。

修复：新增 `core/src/lan_beacon.js`，由 wow **代发** Minecraft 局域网多播广播——每个真实本地 IPv4 地址（排除 loopback 与 `10.144.144.x` 虚拟网段）+ `0.0.0.0` 各建立一个独立 socket（复刻陶瓦 `fakeserver.rs` 的「一个地址一个 socket」设计，规避 `send()` 异步导致多播出口错乱的陷阱），每 1500ms 发送一次 `[MOTD]wow~ Minecraft Server[/MOTD][AD]<server-port>[/AD]`。`hostRoom()` 在调 `GET /state/scanning` 前：`apiIde()` 复位陶瓦为 `waiting`（避免非 waiting 状态下扫描被静默忽略），并启动 `LanBeacon`，直到 `host-ok` 后再 `beacon.stop()`。`waitHostOk()` 超时从 30s 放宽到 60s，且停在 `host-scanning` 超 10s 时给出针对性诊断（广播是否真发出、多播是否被拦截）。实测对照：无广播时陶瓦 8s 仍 `host-scanning`；启动 wow 广播器后 0.9s 即 `host-ok`。

### 🐛 修复：MC `latest.log` 被 wow 双写 / 截断 / 重复

> 现象：开服后 `logs/latest.log` 出现重复行、`Done (...)` 出现 3 次、行首被截断交错。

根因：Minecraft 的 log4j 在启动时会**重建** `latest.log`，而 wow 的服务端输出写入流仍持有旧 fd 并按原偏移继续追加，导致同一份日志被写两遍、行首截断、内容交错。

修复：服务端进程的原始 stdout/stderr 改为单独落盘到 `logs/wow-stdout.log`（交互模式 `createWriteStream`、非交互模式 `openSync` 均改写该文件，`flags:'w'`），不再写 `latest.log`。`latest.log` 现在只由 Minecraft 自身写入，干净无重复。验证：实开服一次后 `latest.log` 的 `Done (` 行数由 3 降为 1，`wow-stdout.log` 正常捕获服务端输出。

---

## [3.3.18] — 2026-08-14

### 🐛 修复：陶瓦开房在 `host-ok` 后一直超时（房间号读不到）

> 现象（Termux/Android aarch64、公网服务器等）：服务端已启动、端口已监听、陶瓦返回 `host-ok`，但 `wow lan host` 最终报「等待开房完成超时（最后状态: host-ok）」，拿不到房间号。

根因：陶瓦 HTTP API 在开房状态（`hosting` / `host-ok`）返回的是**顶层字符串**房间号：

```json
{ "state": "host-ok", "room": "ABCD-EFGH" }
```

而 `terracotta.js` 的 `waitHostOk()` 判断写成 `s.state === 'host-ok' && s.room && s.room.code` —— 把 `room` 当成了 `{ code: ... }` 的嵌套对象。当 `s.room` 是字符串时，`s.room.code` 永远为 `undefined`，成功条件恒假，轮询到 30s 抛超时。这与「host-ok 已返回却超时」的现象 100% 吻合（这不是超时时长问题，延长也没用）。`getStatus()` 里 `state.room && state.room.code` 同理也拿不到房间号。

修复：

- 新增 `extractRoomCode(s)`：优先按字符串读取 `s.room`，并兼容 `s.room.code` / `s.room.room_code` 旧写法。
- `waitHostOk()` 与 `getStatus()` 统一改用 `extractRoomCode()`，房间号现在能正确拿到，开房成功后正常打印并返回。

### 🐛 修复：Quilt/Fabric 开服报 `Missing game jar (.../server.jar)`

> 现象：`wow install quilt 1.20.1` 成功生成 `quilt-server-launch.jar`，但 `wow server start` 报 `The Minecraft server .JAR is missing (/workspace/.../server.jar)`，启动器退出码 1。

根因：安装器把预拉的原版核心存为 `minecraft_server.<mc>.jar`，但 Quilt/Fabric 启动器生成的 `*-server-launcher.properties` 写死 `serverJar=server.jar`，二者命名不一致，启动器找不到游戏核心。

修复：安装完成后新增 `_patchLauncherServerJar()`，把 `*-server-launcher.properties` 里的 `serverJar` 指向真实文件名（`minecraft_server.<mc>.jar`），并在支持的环境下再建一个 `server.jar` 软链/副本做最大兼容。无需改动、也不重复占用约 46MB 原版核心。

### 🐛 修复：`_getServerJar()` 盲选目录里第一个 `.jar`

> 现象：服务端目录里若混有别的 `.jar`（如遗留的 `forge-*-installer.jar`），会被当成核心启动，报 `Invalid or corrupt jarfile`。

根因：`_getServerJar()` 在配置 `server.jar` 缺失时，直接 `readdirSync` 取目录里第一个 `.jar`，不区分安装器与可运行核心，也不参考 `server.type`。

修复：候选过滤排除 `*-installer.jar`（安装器不可直接运行）；多候选时按 `server.type`（quilt/fabric/forge/neoforge）精确匹配启动器 jar，仍无法确定才尽力而为并给出告警，避免误选。

---

## [3.3.17] — 2026-08-12

### 🐛 修复：交互菜单输入被读两遍（输入 1.20.1 显示成 11..2200..11，自 3.0 起存在）

> 现象：所有环境（Termux、简幻欢、真实公网 IP 的 Linux x86 服务器）下，菜单里输入 `1.20.1`，终端却把每个按键显示/记录成两倍：`1.20.1` → `11..2200..11`、`2` → `22`。实际 `ask()` 取到的值仍是单份（所以 forge 仍能解析出 1.20.1），但**回显双倍**严重误导、且在部分环境会真正污染输入。

根因：`process.stdin` 上同时挂了**两个 `readline` 接口**。

- `showMainMenu` 创建一个 `rl`（主菜单循环用）；
- `dispatchMenu` 又 `createRL()` 了**第二个** `rl` 挂在**同一个 `process.stdin`** 上（且用完不关，泄漏）。两个接口同时消费同一 stdin，每个按键被处理/回显两次 → 输入显示成两倍。
- 同理，`config.quickSet` / `theme_manager` / `pack_generator` 内部也各自 `readline.createInterface({ input: process.stdin })`，从菜单进入这些子流程时又叠出第二个接口，同样双倍。

修复（确保所有交互路径复用**同一个** `readline` 接口，绝不重复挂 stdin）：

- `dispatchMenu(choice, options, rl)` 改为**复用主菜单传入的 `rl`**，不再自建；仅当外部未传入时才自建并负责关闭（`ownRl` 标记）。
- `showMainMenu` 在直跳 `wow m N` 与菜单循环两条路径都把 `rl` 传给 `dispatchMenu`。
- `config.quickSet` / `theme_manager.install|switch|_askConfirm` / `pack_generator.install|_askWorldOption|_selectWorld|_askConfirm` 全部新增可选 `existingRl` 参数：传入则复用、不关闭；不传则保持原行为（自建并关闭），向后兼容 `cli.js` 等直接调用。
- `dispatchMenu` 内调用上述管理器时统一把 `rl` 透传下去。
- 验证：`node cli.js m` 在伪终端下实测，菜单 `2 → 2 → 1.20.1` 现在显示为 `选择类型 (1-9): 2` / `Minecraft 版本 (如 1.20.1): 1.20.1`（不再双倍），forge 1.20.1 正常安装；菜单 `3 → 3` 快速设置向导首行 `服务器端口 (默认: 25565): 25566` 也单份且正确写入。

> 说明：`server.js` 开服时也会建一个 `rl` 接管 stdin，但停止时已 `this._rl.close()`，菜单 `rl` 在开服期间 `pause()`、停服后 `resume()`，不会叠加，故无此问题。

---

## [3.3.16] — 2026-08-12

### ✨ 修复：安装器/启动在 mise/rtx 等版本管理器下找不到 Java 的问题

> 现象（简幻欢环境）：菜单「下载/安装实例」选 forge 1.20.1，原版核心预下载成功，但运行 `java -jar forge-installer.jar` 时报 `mise ERROR No version is set for shim: java`，安装器退出码 1，安装失败；主菜单也显示 `Java 路径: (未检测到)`。

根因：`java` 在 简幻欢等环境里是 `mise` 的 shim，未设置全局版本时 `java -version` 直接报错退出。而原安装器的 `_resolveJava` 在 `detectJava()` 失败时只回退到**裸 `java` 命令**，于是被 mise 拒绝；`utils.detectJava()` 也只认能跑通 `java -version` 的 java，识别不到 mise 本地已安装的多个 Java（zulu-8/11/16/17/19/21）。

修复：

- **`utils.detectJava(preferredVersion?)`** 增强：裸 `java` 不可用时，依次尝试用 `mise where java@<v>` / `rtx where java@<v>`（v 优先 `preferredVersion`，再 `21/17/11/8`）解析本地已安装 Java；仍不行则扫描 `MISE_DATA_DIR` / `XDG_DATA_HOME` / `~/.local/share/mise|rtx/installs/java` 目录。这样直接复用环境已有的 Java，无需重新下载。
- **`jre_manager.getJavaExecutable`** 把期望版本传给 `detectJava`，版本管理器场景下优先匹配对应大版本（如 1.20.1→17）的本地 Java。
- **`installer._resolveJava(mc)`** 改为异步，统一走 `JreManager.ensureJavaForMinecraft(mc)`（与 `server.js` 启动逻辑一致）：用户显式配置 → 已下载 JRE → 系统 Java（含 mise/rtx）→ 自动下载 Temurin JRE。在 mise 环境下会直接复用本地 Java（无下载），彻底避免 `No version is set for shim: java`。

> 注：日志里 `选择类型 (1-9): 22`、`Minecraft 版本: 11..2200..11` 是**简幻欢 Web 控制台把每个按键重复显示两次**的显示副作用（实际输入为 `2` / `1.20.1`，wow~ 行为正确），并非输入解析 bug。

---

## [3.3.15] — 2026-08-12

### ✨ 优化：陶瓦开房扫描失败时改为交互式手动输入端口

> 用户反馈：3.3.14 在「未检测到服务端监听」时直接抛错崩掉，但有时只是自检探测偶发失败、或服务端监听在非默认端口，一刀切报错体验不好。

改动（`terracotta.js` 的 `hostRoom`）：

- 开房前自检（TCP 探测 `server-port`）失败时，**不再直接抛错退出**，而是进入交互式流程：
  - 提示用户输入本机 Minecraft 服务端实际监听的端口（`1-65535`）；
  - 输入**合法** → 采用该端口继续开房；
  - 输入**非法**（空 / 非数字 / 带字母 / 越界 `0` 或 `>65535`）→ 视为**放弃开服**：停止陶瓦守护、函数返回 `null`、**不抛错、正常退出**，不再让菜单崩溃。
- 非交互场景（`autoHost` 服务器启动自动开房、无 stdin 输入）保持原有静默失败行为（无 `promptPort` 回调时不进入手动输入分支）。
- 菜单「联机 / 我要当房主」(选项 15) 调用 `hostRoom` 时传入 `promptPort: (msg) => ask(rl, msg)`，把 readline 输入接入该流程。

> 说明：手动输入的端口会被信任并直接用于开房；若服务端确实未在该端口监听，陶瓦会在后续连接公共节点阶段给出明确超时/异常提示，而不是在自检阶段就崩掉。

---

## [3.3.14] — 2026-08-12

### 🐛 修复：陶瓦开房时端口读取更可靠、更可定位

> 用户反馈：陶瓦报错「扫描本机 25565 端口」，但期望它直接检查 `server.properties` 的 `server-port`。

问题与修复：

- **`utils.getServerDir()` 默认路径错误**：原默认值为 `'../../server'`，在 `path.resolve(__dirname, '..', relativePath)` 解析下会指到**项目外层**（例如 `/home/server` 而不是 `/home/wow/server`），导致找不到真正的 `server.properties`。修正默认值为 `'../server'`，与随包 `wow.yaml` 中的 `server.dir: ../server` 一致。
- **`terracotta.getServerPort()` 静默回退 25565**：原先读取失败、值非法或 `server-port` 缺失时直接回退 25565，没有任何提示，用户无法判断是自己端口改成功了还是根本没读到文件。现在会**显式打印**：
  - 读取成功：`📡 从 server.properties 读取到 server-port: <端口>（<文件路径>）`
  - 文件缺失/读取失败/值非法/键缺失：`⚠️ ... 回退默认 25565。文件路径：...`

这样用户能立刻判断：陶瓦到底用了哪个端口、读的是哪个 `server.properties`、有没有读到真实配置。

> 说明：截图中的 `host-ok` 状态表示陶瓦已在扫描端口上找到了本地服务端；之后的超时是陶瓦连接公共节点阶段的问题，与端口读取无关。若日志显示读到的是 25565，说明你的 `server.properties` 里确实是 25565（或该文件/键缺失）；若日志显示的是其他端口但报错仍写 25565，欢迎再截图。

---

## [3.3.13] — 2026-08-11

### 🐛 修复：Fabric 安装崩溃 + ⚡ 优化：Fabric/Quilt 运行时复用预拉原版核心

> 现象：用户反馈「fabric 和 quilt 能跑的动吗」。实测发现 Fabric 安装直接崩溃，Quilt 正常。

#### 1) Fabric 安装崩溃（既有 bug，非 3.3.12 引入）

- `_resolveFabricInstaller` 把 Fabric 版本 API（**降序**返回，最新在前）当升序处理，取了**最后一个＝最旧的 `0.2.0.7`** 安装器；该老安装器用 `args[0]` 空格拆分解析子命令，而 wow 传入的 `server -downloadMinecraft` 是两个独立参数，导致 `ArrayIndexOutOfBoundsException: Index 1 out of bounds` 崩溃。
- 同时 Fabric 服务端安装命令**缺少 `-mcversion <mc>`**（必需参数）。

修复：

- `_resolveFabricInstaller` 改为取**最新稳定版**安装器（做语义化排序兜底，不依赖接口排序顺序），现解析为 `1.1.2`。
- Fabric `installArgs` 改为 `(mc) => ['server', '-mcversion', mc, '-downloadMinecraft']`。

#### 2) Fabric / Quilt 运行时复用预拉的原版核心

- 与 Forge/NeoForge 不同，Fabric/Quilt 安装器**安装阶段总是自行从 mojang 重新下载原版核心、不复用预置文件**（Forge 的 3.3.12 预置技巧对它们无效），所以在沙箱/弱网里安装或首次启动仍可能慢。
- 但它们的**运行启动器**（`fabric-server-launch.jar` / `quilt-server-launch.jar`）启动时会优先复用目录里已存在的 `minecraft_server.<mc>.jar`。
- 新增 `_ensureVanillaAtRoot`：模组加载器安装成功后，把官方原版核心（BMCLAPI2 按 SHA1 精确寻址，快且字节一致）预置到安装目录根 `minecraft_server.<mc>.jar`，让 Fabric/Quilt 运行时**跳过从 mojang 拉取**；Forge/NeoForge 也兜底确保根目录有完整副本。

#### 验证

- Quilt `1.20.1` 安装成功并触发 `_ensureVanillaAtRoot`，根目录生成 46MB 官方原版核心（沙箱内 BMCLAPI2 约 2.4s）。
- Fabric 修复后解析 `1.1.2`、参数正确、能正常下载 Fabric 库；安装末尾从 mojang 拉原版核心在沙箱超时（环境限制，真实网络下正常），其运行时同样受益于根目录预拉。

---

## [3.3.12] — 2026-08-11

### ⚡ 优化：Forge / NeoForge 安装前预下载原版核心，避开安装器慢速下载

> 现象：上一版（3.3.11）虽然装出了 Forge 核心，但安装器仍会自行从 `piston-data.mojang.com` 下载原版核心（`minecraft_server.<mc>.jar`），在部分网络环境下极慢甚至超时，导致安装卡死。

根因：

- Forge / NeoForge 安装器的 `downloadVanilla` **仅在目标文件已存在时才跳过下载**，而该目标路径写在安装器 jar 内 `install_profile.json` 的 `serverJarPath`（形如 `{LIBRARY_DIR}/net/minecraft/server/{MINECRAFT_VERSION}/server-{MINECRAFT_VERSION}.jar`），**不是**根目录的 `minecraft_server.<mc>.jar`。旧实现把预下载的核心放错位置，安装器判定目标不存在 → 照常连 mojang 慢速下载 → 超时失败（`A problem installing was detected`）。
- 3.3.12 初版还曾把 BMCLAPI2 的 `/version/<mc>/server` 当作首选，仍偶发不对版；最终改为按 SHA1 精确寻址。

修复：

- **`installer.js`**：新增 `_resolveInstallerVanillaTarget`，用 `adm-zip` 读取安装器 jar 内的 `install_profile.json`，按 `{ROOT}` / `{LIBRARY_DIR}` / `{MINECRAFT_VERSION}` 占位符**动态推导**安装器真正期望的原版核心路径（兼容新旧 Forge / NeoForge 的不同布局）；并把官方原版核心预置到该路径（下载一次后复制到其余期望位置作为保险）。
- 下载源顺序：**BMCLAPI2 按 SHA1 精确寻址**（`/v1/objects/<sha1>/server.jar`，与官方对象字节一致、国内快、稳）→ mojang 官方（兜底）→ BMCLAPI2 按版本（备用）；并保留 ≥10MB 截断校验。
- 无 `serverJarPath` 声明的加载器（如 Fabric / Quilt）自动跳过预下载，由其自行处理，互不干扰。
- 验证：本地 `wow install forge 1.20.1 -b 47.2.0` 全程**未出现一次 mojang 原版核心下载**，安装器直接复用预置核心并成功生成 `forge-*-server.jar` + `unix_args.txt`。

---

## [3.3.11] — 2026-08-10

### 🐛 修复：Forge（及现代 NeoForge）安装失败 + 启动方式错误

> 现象：`wow install forge 1.20.1` 安装器跑完后报错「未在 … 找到匹配的服务端核心（/^forge-.+-server\\.jar$/）」，安装判定失败。

根因有两层：

- **核心生成位置变了**：现代 Forge / NeoForge（1.17+）用 `--installServer` 不再把 `forge-*-server.jar` 放在服务器根目录，而是生成在 `libraries/net/minecraftforge/forge/<mc>-<loader>/` 子目录；原 `_detectServerJar` 只扫根目录，自然扫不到。
- **启动方式不成立**：现代 Forge 不能用 `java -jar <jar>` 启动，必须用 `java @user_jvm_args.txt @libraries/.../unix_args.txt nogui`（args 文件里含完整 classpath / 模块参数）。原 `server.js` 写死 `-jar`，即使扫到核心也起不来。

修复：

- **`installer.js`**：`_detectServerJar` 改为**递归扫描**（跳过 world/logs/backups 等运行时目录），能找到 `libraries/` 子目录里的核心；并新增 `_detectForgeArgsFile`，在核心同目录探测 `unix_args.txt` / `win_args.txt`，把其相对路径写入配置 `server.launchArgsFile`
- **`server.js`**：`_buildCommand` 若检测到 `server.launchArgsFile` 且文件存在，改用 `@args` 启动模式（`java ... @user_jvm_args.txt @<argsFile> nogui`），否则退回原 `-jar` 模式（Fabric/Quilt/旧版 Forge 不受影响）
- 验证：本地 `wow install forge 1.20.1 -b 47.2.0` 安装成功，`server start` 实测 Forge 1.20.1 服务端正常启动并输出 `Done (30.149s)! For help, type "help"`

---

## [3.3.10] — 2026-08-09

### 🐛 修复：`install` 隐藏在 commander v11 下崩溃（Termux 启动报错）

> v3.3.9 用 `Command.prototype.hideHelp()` 隐藏 `install`，但该项目锁定的 `commander ^11.0.0` 实际安装 v11.1.0，`.hideHelp()` 是 commander v12 才有的 API；在 Termux 运行 `./start.sh` 时报 `TypeError: ...hideHelp is not a function`，主程序直接退出。

- **改用 v11 兼容写法**：`install` 子命令保留，通过链式 `.command('install <target> [version>').description(...).option(...).action(...)._hidden = true` 隐藏（commander v11 无公开 `hideHelp()`，用内部 `_hidden = true` 同样可从 `--help` 移除，但命令仍可被 `wow install ...` 显式调用）
- **背景说明（用户确认）**：`install` 暂不移除，仅逐步弱化、最终计划全部迁移到 `scheme`；v3.3.10 仅修复兼容性崩溃，行为不变
- **避坑**：v11 的 `.command(name, desc, {hidden:true})` 会返回父对象，导致后续 `.option()` 错挂到全局；本版本已规避

---

## [3.3.9] — 2026-08-05

### 🧹 安装与镜像源：隐藏 install、修复符号链接、多镜像源轮换、模组服改用官方安装器

> 本版本聚焦「安装体验」：把 `install` 从 `--help` 藏起来、修好 wow 符号链接不生效、`scheme` 与安装器统一走多镜像源轮换、以及把 Forge/Fabric/NeoForge/Quilt 改为用官方 `installer.jar` 安装（而非直接下服务端核心）。

- **`--help` 不再提示 `install`**：`install` 是进阶操作，对其加 `.hideHelp()`（仅交互菜单与显式 `wow install ...` 仍可触发）；`init` 引导文案也不再列 `install`
- **修复 wow 符号链接不生效**：`start.sh` 的 node/npm 软链改用**绝对路径**（`$CORE_DIR/$NODE_DIR/extracted/bin/...`），并加 `cp` 兜底（软链不可用时复制），同时补齐 npm 软链；解决此前相对软链在 CWD/解析差异下失效的问题
- **多镜像源轮换（scheme / 安装器共用）**：原版版本清单 `launchermeta` 获取顺序改为 `默认镜像 → mojang (launchermeta.mojang.com) → bangbang93 (bmclapi2.bangbang93.com)`，任一镜像失败自动轮换下一个；`scheme` 走 `installer.install()`，天然继承该轮换
- **模组服安装方式修正（装对应安装器）**：Forge/Fabric/NeoForge/Quilt 不再直接下载服务端 jar，而是依次——用镜像轮换下载对应 `installer.jar` → `java -jar installer.jar [参数]` 执行安装 → 探测产物 jar（`forge-*-server.jar` / `fabric-server-launch.jar` / `neoforge-*-server.jar` / `quilt-server-launch.jar`）→ 在 `config` 写入 `server.jar`，供 `server.js` 优先选用（避免 Fabric/Quilt 安装后原版 `server.jar` 与之并存导致选错核心）
- **配套**：`server.js` 的 `_getServerJar()` 优先使用 `server.jar` 配置项，其次回退到过滤 `authlib-injector` 后的自动探测

---

## [3.3.8] — 2026-08-04

### 🔌 联机（陶瓦）：放弃自带端口配置，统一自动读取 server-port

> 陶瓦联机的本地 MC 端口不再依赖 wow 自己的配置项，改为**始终自动读取 `server.properties` 的 `server-port`**。

- **移除 `lan.server_port` 配置**：删除 `core/wow.yaml` 的 `lan.server_port` 与 `config.js` 的默认值；`getServerPort()` 不再回退到该配置，只从 `server.properties` 的 `server-port` 读取，未配置/非法时回退到 Minecraft 默认端口 `25565`
- **行为不变的部分**：开房前 TCP 端口自检、`waitHostOk` / 陶瓦异常报错仍然展示 `server.properties` 里的真实 `server-port`，开服控制台执行 `lan host` 后可继续输入指令
- **文档同步**：`LAN_TERRACOTTA.md` 的配置表去掉 `server_port` 行，并补充说明「端口自动读取，无需配置」

---

## [3.3.7] — 2026-08-03

### 🐛 修复：开服控制台执行 `lan host` 后卡死，无法再输入指令

> 在 `wow server start` 交互终端里执行 `lan host` 开房成功后，控制台被卡死、既打不了 MC 指令也打不了 wow 指令。

- **根因**：`lan host` 在子进程 `node cli.js lan host` 内调用 `hostRoom()`，后者启动的**陶瓦守护进程是长驻子进程**。命令执行完毕后该子进程仍存活，会阻止 `node cli.js` 退出；而开服控制台依赖 `runWowSubcommand` 的 `exit` 事件来 `rl.resume()` 恢复输入，子进程不退 → `await` 不返回 → 终端永久卡死。
- **修复**：`lan host` 处理器在开房完成（成功 / 失败）后**显式 `process.exit()`**，把控制权交还开服控制台；陶瓦守护进程被父进程接管继续运行，关房时由 `stopHost` 依据 `.lan.json` 清理。
- **双保险**：`startDaemon()` 中对陶瓦子进程调用 `child.unref()`，确保它绝不阻止任何调用方进程退出（含 `auto_room` 所在的 server start 主进程）。

---

## [3.3.6] — 2026-08-03

### 🔌 联机（陶瓦）：自动读取 server.properties 的 server-port

> `wow lan host` 开房时，陶瓦会自动扫描本机运行中的 Minecraft 服务端来发现端口。本版本让 **wow~ 显式读取 `server.properties` 的 `server-port`**，用于开房前的端口自检与报错提示，彻底告别「写死 25565」导致的误导。

- **`getServerPort()`**：端口优先级 `server.properties 的 server-port` > 配置 `lan.server_port` > 默认 `25565`
- **开房前自检**：`lan host` 启动陶瓦前，先用 TCP 探测本机 `server-port` 是否真的有服务监听；若没启动服务器，立即给出清晰报错（含真实端口号），不再傻等 30 秒超时
- **报错提示同步**：开房超时 / 陶瓦异常的报错信息，现在一律展示 `server.properties` 里的真实 `server-port`，而不是过时的默认 25565
- 顺带把 `terracotta.js` 头部版本注释同步到 V3.3.6

---

## [3.3.5] — 2026-08-03

### 🎮 开服控制台：MC 指令与 wow 指令同台输入

> 在 `wow server start` 的交互终端里，除了 Minecraft 服务端管理员指令（如 `/stop`、`op Steve`），现在还可以直接输入 **wow 服务端指令**（来自本文件 COMMANDS.md）。

- **stdin 接管**：交互模式下 wow 不再把终端原样交给 MC，而是用 readline 读取输入——识别为 wow 指令则交由子进程执行，其余一律转发给 MC 服务端控制台
- **允许清单（不修改运行中的方案文件）**：`server status/stop/kill`、`lan host/stop/status`、`scheme list/info/status`、`mod list`、`logs analyze/report`、`config wow|server|white`（只读形式）、`web stop/status`、`pool stats`、`mail *`、`down`、`plugin list/info`、`theme list/info`、`help`
- **禁用清单（危险 / 冲突 / 抢占终端）**：会修改运行中的方案文件的指令（`scheme create/switch/delete/edit/...`、`mod remove/sync/toggle`、`pack *`、`theme install/switch/delete`、`plugin install/remove`、`install`、`init`、`pool prune`、`config/server` 写入形式、`set`、`config white add/remove`）一律拒绝并提示「请另开终端」；`server start/restart`（与开服进程冲突）、`web start` / `logs tail`（常驻 / 抢占终端）同样禁用；交互菜单 `M` 也禁用
- **执行方式**：允许的 wow 指令通过 `node cli.js <args>` 子进程执行（输出继承当前终端），MC 服务端作为独立进程不受影响、持续运行
- 本地单元测试 + 转发/执行/拒绝三态联调均通过
- 版本号同步至 3.3.5

---

## [3.3.4] — 2026-08-02

### 🐛 修复（联机 / 陶瓦 Terracotta · 解压后找不到二进制）

> 修复 Termux 中回退到 `linux/arm64` 时，下载 100% 后仍报「解压后未找到陶瓦可执行文件」的问题。

- **修正 `locateBinary()` 的文件名匹配逻辑**：陶瓦压缩包解压出的文件名本身带版本号小数点，例如 `terracotta-0.4.2-linux-arm64`。旧逻辑用 `!f.includes('.')` 判断「无扩展名可执行文件」，会误把带 `0.4.2` 点号的合法二进制排除掉，导致任何平台（Windows 除外）都定位失败
- **新的排除规则**：改为 `f.startsWith(prefix)` 后排除已知的非二进制扩展名（`.tar.gz`、`.tar`、`.zip`、`.gz`、`.so`、`.dll`、`.json`、`.txt`、`.md`、`.yaml`、`.yml`、`.log`），保留 `.exe` 和无明确后缀的二进制文件
- **候选排序**：优先无 `.exe`（Linux/macOS），其次 `.exe`（Windows），文件名短的优先
- 本地模拟 Android/Termux 验证通过：`ensureBinary()` 先尝试 `.so`、识别 JNI 后回退、成功解压并定位到 `core/lan/terracotta`（10MB）
- 版本号同步至 3.3.4

---

## [3.3.3] — 2026-08-02

### 🤖 平台支持（联机 / 陶瓦 Terracotta · Android 回退修复）

> 修复：在 Termux 中 `process.platform === 'android'`（并非 `linux`），此前 3.3.1 直接报「平台不支持」，3.3.2 能下载 `.so` 却无法作为命令行进程启动。3.3.3 改为「**优先 android，失败回退 linux/arm64**」。

- **`detectTerraAssets()` 改为返回候选数组**：Android 下按优先级返回 `[android .so, linux/arm64]`，其余平台返回单个候选（向后兼容）
- **下载优先 android、失败回退 linux/arm64**：`ensureBinary()` 依次尝试候选——优先下载 `terracotta-<ver>-android-<arch>.so`；若遇 **HTTP 404 / 网络错误 / 解压失败** 等异常，自动回退到 `terracotta-<ver>-linux-arm64-pkg.tar.gz`（musl 静态二进制，可在 Termux 中直接 `spawn` 运行）
- **`.so` 即 JNI 共享库，不再报错中断**：android 的 `.so` 下载成功后仍会被识别为 JNI 共享库（供 FCL / HMCL 加载、不可作为 CLI 启动），因此**仅作为「优先尝试」**；真正在 Termux 中运行的是回退得到的 `linux/arm64` 二进制，路径统一为 `lan/terracotta`（无扩展名，可直接执行）
- **移除 `startDaemon()` 的 `.so` 硬性拦截**：原 3.3.2 对 `.so` 直接抛错，现因回退逻辑已保证拿到可运行二进制，不再需要拦截
- **`binaryPath()` 使用固定文件名**：Windows 为 `terracotta.exe`，其余（含 Android 回退的 linux/arm64）为 `terracotta`，避免不同扩展名 / 候选导致的路径漂移
- 版本号同步至 3.3.3

---

## [3.3.2] — 2026-08-02

### 🤖 平台支持（联机 / 陶瓦 Terracotta · Android）

- **`detectTerraAsset()` 新增 Android 分支**：`process.platform === 'android'` 时映射为 `osName=android`、`ext=.so`，并采用 Android 专用 arch 命名（arm64→`arm64v8a`、arm→`armv7`、x64→`x86_64`、ia32→`x86`），不再对 Android 直接返回「平台不支持」
- **Android 二进制直链下载（无 tar 解压）**：`resolveDownloadUrl()` 为 Android 拼出 `terracotta-<ver>-android-<arch>.so` 直链（Gitee 上即原样发布，无 `-pkg.tar.gz` 包裹）；`ensureBinary()` 直接把 `.so` 下载到 `lan/terracotta.so`，跳过 tar 解压流程
- **真·Android 启动保护（JNI 说明）**：`startDaemon()` 拦截 `.so` 二进制并给出清晰提示——Android 的 `.so` 是 **JNI 共享库**（需由 FCL / HMCL 等安卓启动器通过 `System.loadLibrary` 加载），**不能**作为独立命令行进程 `spawn`；在手机上用 wow~ 开陶瓦房间请在 **Termux** 中运行（Termux 下 `process.platform` 为 `linux`，会使用可独立运行的 `linux/arm64` musl 静态二进制）
- **消除误报**：此前在 Android / Termux 上会因「平台不支持」提前抛错；现桌面端 arm 命名保持不变（`arm64`/`armv7`，不含无构建的 32 位 linux），Termux 联机路径（linux/arm64 musl）保持可用
- 版本号同步至 3.3.2

---

## [3.3.1] — 2026-08-02

### 🐛 修复（start.sh 多镜像下载）

- **Node.js 便携版下载增加多镜像 fallback**：依次尝试 清华 → npmmirror(阿里) → 腾讯云 → 华为云 → 官方源，任一成功即停止，避免单源故障导致启动失败
- **npm 依赖安装增加多镜像 fallback**：依次尝试 清华 → npmmirror(阿里) → 腾讯云 → 华为云 → npm 官方源，每次失败后清理残留 `node_modules` 和 `package-lock.json` 再重试
- 版本号同步至 3.3.1

---

## [3.3.0] — 2026-08-01

### 🌐 新功能（联机 / 内网穿透 · 陶瓦 Terracotta）
- **对接陶瓦（Terracotta）实现内网穿透联机**：基于 EasyTier 的 [Terracotta](https://github.com/burningtnt/Terracotta)，让没有公网 IP 的房主也能让好友直接加入自己的 Minecraft 服务端
- **「我要当房主」一键开房**：`wow lan host` 命令、交互菜单第 15 项（V3.5.10 菜单重排后为第 14 项）、Web 面板「联机(陶瓦)」页均可开房；陶瓦会自动扫描本机正在运行的 Minecraft 服务端端口并建立穿透通道
- **房间号即加入凭证**：开房成功后返回房间号，好友在 **PCL / HMCL / BakaXL / FCL** 启动器中选择「加入陶瓦房间」并输入该房间号即可联机（3.3.0 仅实现房主端，加入端由上述启动器内置支持）
- **陶瓦二进制运行时自动下载**：首次开房时按平台从默认 **Gitee 镜像**（`https://gitee.com/burningtnt/Terracotta/releases`）下载对应二进制（约 8–14 MB）并解压缓存，之后复用本地缓存，无需手动安装
- **`lan.auto_room` 配置**：设为 `true` 后，启动 Minecraft 服务端时自动开房、停止服务端时自动关房（适合非交互 / 后台 / Docker 场景）
- **Web 面板新增「联机(陶瓦)」页**：显著展示陶瓦版权（AGPLv3 例外条款要求），提供开房 / 查看房间号 / 关房操作
- 版本号同步至 3.3.0

### 📝 许可与致谢
- 陶瓦以 **AGPLv3 + 例外条款** 发布；wow~ 通过陶瓦提供的本地 HTTP API 与之交互（未修改其二进制），并在 CLI / Web / 菜单显著处标注其版权信息，符合其例外条款，wow~ 自身仍保持 MIT 许可

---

## [3.2.2] — 2026-08-01

### 🐛 修复（实时日志与指令输入）
- **`server start` 启动后无实时日志、无法输入指令**：原 `start()` 把子进程 stdout/stderr 仅重定向到日志文件、且未接管终端输入，导致控制台看不到日志、无法向服务器发送命令（并间接造成 `server stop` 的"跨进程模式"提示）
- **交互式终端下改为前台运行**：子进程输出实时转发到控制台并同步写入日志文件，stdin 直接继承终端以支持输入指令（如 `stop`/`list`），并保持前台阻塞直到服务器退出；`Ctrl+C` 优先发送 `stop` 优雅关闭
- **非交互环境（Web 面板 / Docker）保持原文件重定向行为**
- **交互式菜单启动服务器前暂停 readline**（`rl.pause()`），避免与服务器的终端输入冲突，结束后恢复
- 版本号同步至 3.2.2

### 🐛 修复（服务端核心隔离 / CLI 参数）
- **安装时清理旧核心，实现版本隔离**：`install` 在安装前调用 `_cleanupOtherCores()`，清理 `server/` 根目录下其它服务端核心，避免安装 forge + vanilla 等多个核心堆在根目录互相干扰（已验证：仅删除其它核心、保留目标核心、`authlib-injector` 白名单与 `libraries/` 依赖子目录均不受影响）
- **原版核心文件名加类型前缀**：由 `minecraft_server.<ver>.jar` 改为 `vanilla-<ver>.jar`，便于按类型识别与隔离
- **放行子命令的 `--version` 参数**：全局版本标志由 `--version` 改为 `-V`，避免 `wow scheme create --mc-version 1.20.1` 等子命令参数被全局 `--version` 静默拦截
- 报告版本号由过时的 3.1.5 修正为 3.2.2

---

## [3.2.1] — 2026-08-01

### 🔧 优化
- **Termux 环境自动安装 OpenJDK 17**：`start.sh` 在 Termux 中检测到无 Java 时，自动执行 `pkg install -y openjdk-17`，确保 Minecraft 服务端在安卓上无需手动配置 Java 即可直接运行
- 版本号同步至 3.2.1

---

## [3.1.5] — 2026-07-28

### 🔧 优化
- **Node.js 下载改用清华镜像**：`start.sh` 从 `https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/` 获取便携 Node.js（原为 nodejs.org）
- **npm 依赖安装改用清华镜像**：依赖安装使用 `https://mirrors.tuna.tsinghua.edu.cn/npm/` 作为 registry
- 文档不再明示支持安卓（不把安卓 / Termux 列为支持平台）
- 版本号同步至 3.1.5

### 📝 文档修复
- **修复 README 文档死链**：插件文档链接 `docs/PLUGINS.md` → `docs/WOW-PLUGINS.md`（实际文件名）
- **补全缺失文档**：新增 `docs/WEB_PANEL.md`（Web 面板使用说明）与 `docs/API.md`（Web API 参考），此前 README 引用但文件缺失
- **`server stop` 跨进程提示文案更准确**：不再误导"请使用 kill 强制终止"，改为说明将自动发送 SIGTERM 由 Minecraft 优雅关闭

---

## [3.1.4] — 2026-07-26

### 🔧 修复（面板/Docker 兼容性）
- **`start.sh` 非交互环境自动下载 Node.js**：移除 `read` 交互确认，检测到非 TTY（Pterodactyl/Docker）时自动下载便携 Node.js
- **`start.sh` 无参数默认启动 Web 面板**：面板启动命令只写 `./start.sh` 时，不再打印 `--help` 后退出，而是默认 `web start` 保持进程常驻
- **交互式菜单（`wow m`）改为纯数字导航**：
  - 主菜单重排顺序：1.启动服务器　2.下载/安装实例　3.变更配置　4.管理模组/插件　5.错误日志分析……（见 `wow m`）
  - 仅接受数字选择（1-14）；非数字输入提示用户查阅 README.MD 的命令说明，**不再在菜单内执行长命令**
  - 仍用数值比较，避免字符串比较把 `2`~`9` 误判非法
- **`start.bat` 无条件 `pause` 防闪退**：无论命令是否带参数、是否报错，执行结束后都暂停等待按键，避免 cmd 窗口输出一段后直接关闭看不到结果
- **`start.sh` 增强非 glibc 环境适配**：
  - 在非 glibc 环境下改用系统包管理器提供的 Node.js，不再下载 glibc 便携版
  - 标准 Linux / macOS 仍走原有便携 Node 下载逻辑
- 版本号同步至 3.1.4

---

## [3.1.3] — 2026-07-26

### 🔧 修复
- **启动脚本 npm 路径问题**：`start.sh`/`start.bat` 中 npm 符号链接断裂导致依赖安装失败，改为保留完整 Node.js 目录结构

---

## [3.1.0] — 2026-07-26

### 🆕 新增功能

- **交互式菜单模式** (`wow m`)：14 项主菜单，数字选择引导操作，支持 `wow m <N>` 直达
- **多格式模组配置管理** (`config mods`)：支持读取/编辑 `config/` 目录下 JSON/TOML/YAML/properties/CFG 文件
  - `list` — 列出配置文件 | `view` — 查看内容 | `get` — 读取嵌套键值 | `set` — 设置键值（自动备份）
- **server.properties 增强管理**
  - `config server-list` — 分类列出所有属性
  - `config server-quick` — 快速设置向导
  - `config server-reset <key>` — 重置为默认值

### 🔧 修复

- **Web 服务跨进程管理**：`web stop/status` 改用 PID 文件方案，支持跨进程调用
- **服务器跨进程停止**：`server stop` 跨进程时自动降级为 SIGTERM（Minecraft 优雅保存退出）
- **自动同意 EULA**：`server start` 自动写入 `eula=true`，方案创建时默认同意
- **Commander `--version` 冲突**：子命令版本参数改为 `-v, --mc-version`，避免被全局 `-V` 拦截

---

## [3.0.0] — 2026-07-23

### 🎉 重大更新：完全重写为 Node.js

- 使用 Node.js 完全重写，不再依赖 Python
- 启动脚本自动检测系统架构并下载便携版 Node.js
- 所有功能模块化，代码结构清晰

### ⭐ 新特性

#### 模板模式方案管理
- 首创“模板模式”多实例管理，兼顾硬盘占用与启动速度
- 方案状态自动判定：`minimal` / `partial` / `full`
- 资源池 (pool) 通过 SHA-256 自动去重共享
- `auto_scheme` 自动管理方案状态，支持手动接管

#### Web 管理面板
- 全功能 Web 面板，支持远程管理
- 邮箱验证码登录，JWT 会话管理
- 仪表盘：服务器控制、实时日志、状态监控
- 方案管理：创建/切换/拉取/瘦身
- 文件管理：上传/下载/解压/打包
- 模组/核心下载搜索 (CurseForge/Modrinth/BMCLAPI2)
- AI 日志分析 (OpenAI 兼容 API)
- 主题包管理：一键切换，安全警告
- wow 插件管理：扩展 CLI 命令

#### 主题包系统
- 主题包通过 ZIP 安装，包含 `theme.json` 签名文件
- 完全替换 `web/` 目录，文件结构自由
- 切换时弹出安全警告

#### wow 插件系统
- 插件通过 ZIP 安装，包含 `plugin.json` + `index.js`
- 可添加自定义 CLI 命令
- 上下文对象 (context) 访问核心模块
- 支持使用其他语言编写（通过子进程调用）
- 目录结构完全自由

#### 服务器管理增强
- 自动下载对应版本的 JRE
- 集成 authlib-injector，支持外置登录 (LittleSkin 等)
- 服务器控制台命令输入
- 实时日志 WebSocket 推送

#### 邮件系统
- SMTP 邮件支持
- 登录验证码发送
- 服务器崩溃报告
- 定时日志摘要 (15 分钟限流)

### 🔧 改进

- 启动脚本自动检测系统架构（Windows/Linux/macOS）
- 首次启动自动下载 Node.js 便携版
- 配置文件使用 YAML 格式，更易读
- 所有目录结构由 `init` 命令自动创建
- 错误信息更详细，便于排查

### 🐛 修复

- 修复 Windows 中文路径乱码问题
- 修复跨平台路径分隔符不一致问题
- 修复 Mohist 核心下载构建号解析
- 修复 Web 面板 WebSocket 断线重连

---

## [2.0.0] — 2026-02-27

### 🎉 重大更新：引入 Web 面板

- 新增 Web 管理面板 (Python + Flask)
- CLI 命令大幅扩展

### ⭐ 新特性

- Web 面板基础功能（仪表盘、服务器控制）
- 模组管理
- 配置文件编辑
- 主题包系统雏形

### 📦 发布变体

| 变体 | 说明 |
|------|------|
| **轻量版** | 用户自行安装 Python 和 JRE |
| **兼容版** | 预装便携版 Python 和 JRE |

### 🔧 改进

- 命令结构重新设计，更规范
- 错误处理增强

---

## [1.0.0] — 2026-02-07

### 🎉 首次发布

- 纯 CLI 模式 (Python)
- 基础服务器管理：启动/停止/重启/状态
- 服务端核心安装 (Vanilla/Forge/Fabric/Paper/Mohist/CatServer)
- 基础模组管理
- `serverchange.py` 配置文件编辑器

### 🔧 技术栈

- Python 3.7+
- argparse 命令行解析
- 单文件设计，散装项目

---

