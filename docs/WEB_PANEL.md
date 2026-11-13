# 🌐 Web 面板使用说明

Wow~ 内置一个基于 Express + Socket.IO 的 Web 管理面板，可在浏览器里查看服务器状态、实时日志，并管理配置、模组、方案、主题等。

> Web 面板把前端操作转换成 CLI 命令执行，等价于在终端里使用 `wow` 命令。

> 📌 **命令引导词**：文档中的 `wow` 是简写 —— Linux / macOS 请写 `./wow.sh`，Windows 请写 `wow.bat`。例如 `wow web start` 在 Linux 下即 `./wow.sh web start`。

---

## 一、启动与停止

```bash
# 启动（默认端口 8080，仅监听本机 127.0.0.1）
wow web start

# 指定端口 / 绑定地址
wow web start --port 9000 --host 0.0.0.0

# 允许局域网 / 公网访问（等价 --host 0.0.0.0，但会强制校验认证凭据）
wow web start --public

# 启动面板的同时开一条 Cloudflare 快速隧道，直接拿到公网 https 地址
wow web start --tunnel

# 面板已在运行时，单独为它建隧道
wow web tunnel --port 8080

# 查看 / 停止
wow web status
wow web stop
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port <port>` | 监听端口 | `8080` |
| `--host <host>` | 绑定地址 | `127.0.0.1` |
| `--public` | 等价 `--host 0.0.0.0`，**强制要求已配置认证凭据**，否则拒绝启动 | — |
| `--tunnel` | 同时建立 Cloudflare 快速隧道，输出公网 https 地址。**强制要求已配置认证凭据**，否则只起面板、不建隧道 | — |

- 当 `--host` 为 `127.0.0.1` 或 `localhost` 时，启动后会**自动打开浏览器**。
- 默认只监听本机；如需局域网/公网访问，用 `--host 0.0.0.0` 或 `--public`。
- 绑定非回环地址且 `web.auth_token` 为空时，**`web start` 会直接拒绝启动**（V3.5.16 起是硬闸门，不是建议）。
  先执行 `wow config wow web.auth_token <一串随机字符>` 再启动。
- 用 `--tunnel` 时，即便绑的是 `127.0.0.1` 也**必须**配 `web.auth_token` 或 `web.auth_password`
  （V3.5.24 起）。见下一节。

> **为什么绑了 127.0.0.1 还要凭据？**
>
> 上面那条「非回环地址才拦」的闸门看的是**绑定地址**。而隧道的工作方式恰恰是：
> 面板老实绑在 `127.0.0.1`（不触发闸门），由 cloudflared 从内部连上去，
> 再映射成 `https://xxx.trycloudflare.com` 对公网开放。
> 也就是说，**隧道会把一个原本只在本机的面板变成公网服务**——
> 这是「绑定地址闸门」唯一漏掉的暴露路径，也是最容易让人误判的一种。
> 所以判定规则补上一句：**隧道等于暴露，必须配 token。**

### 公网穿透（Cloudflare 快速隧道）

`--tunnel` / `wow web tunnel` 会调用官方 **cloudflared** 的快速隧道，
由 Cloudflare 分配一个临时的 `https://xxx.trycloudflare.com` 地址，**无需域名、无需端口映射**。
注意该地址每次启动都会变，适合临时分享，不适合长期绑定。

#### 隧道前的认证闸门

**V3.5.24 起，建立隧道前必须先配认证凭据**：`web.auth_token` 或 `web.auth_password`
任一非空即可（纯空白字符不算，防 `wow config set web.auth_token " "` 空转）。

没配的时候：

- `wow web start --tunnel`：**面板照常启动**，只是隧道被跳过，终端会打印本地地址并提示
  「补齐凭据后可用 `wow web tunnel` 单独补建隧道」。不会让整个启动看起来像失败了。
- `wow web tunnel`（单独补建命令）：直接报错退出，因为此时没有「面板还活着」这层可安慰的事。

```bash
# 任选其一
wow config set web.auth_token 一串足够长的随机字符
wow config set web.auth_password 你的密码      # 离线密码登录
```

拒绝发生在**下载 cloudflared 之前**——不会先白下 40MB 再告诉你没配凭据。

首次使用会自动下载 cloudflared（约 40MB）。**V3.5.22 起改为国内镜像优先**：

| 顺序 | 源 | 说明 |
|------|----|------|
| 1 | `WOW_CLOUDFLARED_MIRROR` 环境变量 | 临时覆盖，优先级最高 |
| 2 | `web.tunnel_mirror` 配置项 | 长期覆盖，见 [配置说明](CONFIG.md#webtunnel_mirror--cloudflared-下载源) |
| 3 | `gh-proxy.com` → `ghfast.top` → `ghproxy.net` | 内置国内镜像，默认即用 |
| 4 | GitHub 官方 | 始终兜底，不会被去掉 |

任何一家失败自动换下一家。下载完成后**必做长度校验**（比对 `Content-Length`），
不足即删除半截文件并换源——实测 GitHub 直连存在「只收到 3.8MB / 40MB 却报成功」的情况，
不校验就会把残缺二进制落盘，之后 spawn 时报难以理解的原生错误。

镜像站只做**传输代理，不改内容**：三家镜像给出的 cloudflared 字节数与
sha256（`1f99fb51…`）和 GitHub API 公布的 digest 完全一致。

```bash
# 若下载仍然很慢，可手动把 cloudflared 放到 core/tunnel/ 下（Windows 为 cloudflared.exe），
# 程序检测到文件存在就直接用，不再下载。
```

### 启动后终端不会「被占住」

V3.5.19 起，`web start` 在**交互终端**里启动面板后会直接进入**长命令模式**（等价 `wow L`）：

```
💡 已进入长命令模式（等价 `wow L`）：可直接输入 wow 指令，无需再来一个终端。
   面板与本终端共用同一个 wow 进程；输入 exit 会同时关闭面板。
```

- 面板和终端共用同一个 wow 进程，终端里敲的指令与面板里点按钮是等价的（受同一套命令策略约束）。
- 输入 `exit` 会**同时关闭面板**；只想关面板请另开终端用 `wow web stop`。
- 非交互环境（systemd / docker / 管道重定向）下不会进 REPL，进程常驻，由 `Ctrl+C` 或信号退出。

---

## 二、登录与认证

面板支持两种登录方式，任选其一。**设置密码后，登录页会出现「验证码登录 / 密码登录」双 Tab**；
没设置密码时只显示验证码表单，不会出现空入口。

### 方式一：邮箱 + 验证码（默认）

1. 在登录页输入邮箱，点击「获取验证码」。
2. 系统生成 6 位验证码，有效期 **5 分钟**：
   - 若已在 `wow.yaml` 配置 SMTP，验证码通过邮件发送；
   - 若未配置 SMTP 且 `web.dev_mode: true`，验证码会打印在**启动面板的终端控制台**，并随登录接口返回 `devCode`；
   - 若未配置 SMTP 且**不是**开发模式，接口直接返回 `403`，不会回显验证码。
3. 输入验证码完成登录，后端签发 **JWT** 令牌，后续请求通过 `Authorization: Bearer <token>` 携带。

### 方式二：备用钥匙密码（V3.5.3 起支持，V3.7.0 起可在面板内设置）

不想配邮箱服务器、或只想少收几封邮件时，设一个面板密码。

**在面板里设置（推荐）**：打开「设置」页 → 下方 **🔑 备用钥匙** 卡片

1. 填管理员邮箱（必须与 `wow.yaml` 的 `mail.admin_email` 一致）；
2. 点「获取验证码」，去邮箱取 6 位码（没配 SMTP 时看服务端控制台）；
3. 填验证码 + 新密码（8~128 位、至少含一个字母）+ 确认密码，提交。

成功后密码以 **`scrypt$<saltHex>$<derivedHex>`** 加盐哈希写入 `web.auth_password`，
不会以明文落盘；同时接口会返回 JWT，设完即为登录态。已有密码时再改，需要额外填「当前密码」。

**用命令行设置（等效）**：

```bash
wow config set web.auth_password "你的密码"
```

首次用明文密码登录时也会自动转成 scrypt 哈希写回。

> ### 🔒 限流与安全底线
>
> - **密码接口 5 次 / 15 分钟**：同一 IP 在 `login-password` 通道连续失败 5 次，锁 15 分钟，
>   返回 `429` 与 `retry_after_seconds`；**锁定期内即使密码正确也拒绝**。
> - **通道隔离**：`login`（验证码）、`login-password`（密码）、`set-password`（设置密码）
>   分别计数，密码通道被锁**不影响验证码登录** —— 忘记密码永远能靠邮箱回来。
> - **双通道永存**：设置密码不会关闭验证码登录；两者同时可用时互不覆盖。
> - **邮箱是硬门槛**：`mail.admin_email` 为空时不允许设置密码（设置页整卡禁用并提示）。
> - **验证码用 CSPRNG 生成**（`crypto.randomInt`），未过期的码会复用，
>   反复点「获取验证码」不会让手上的码失效、也不会重复发邮件。
> - **公网 / 反代 / 隧道下强制登录**：与 `web.require_login` 的取值无关。
>   经 nginx / Caddy 反代时，务必在 `wow.yaml` 设 `web.trust_proxy: true`。

> 🔐 **限制可登录的邮箱**（V3.5.8 新增）
>
> 默认任何邮箱都能请求验证码。若面板暴露在公网，建议在 `wow.yaml` 配置白名单：
>
> ```yaml
> mail:
>   whitelist:
>     - you@example.com
>     - teammate@example.com
> ```
>
> 名单外的邮箱在「获取验证码」这步就会被拒绝（HTTP 403），**不会生成验证码**；
> 即便此前已发出过验证码，登录阶段还会再校验一次。留空 = 不限制。
> 设置备用钥匙密码时，`mail.admin_email` 必须也在名单内，否则拿不到验证码。
> 详见 [配置参考 · mail](CONFIG.md#mail--邮件设置)。

相关配置项（见 [配置参考](CONFIG.md)）：

| 配置键 | 说明 | 默认值 |
|--------|------|--------|
| `mail.whitelist` | **登录邮箱白名单**，名单外邮箱无法获取验证码（V3.5.8） | `[]`（不限制） |
| `web.auth_token` | JWT 签名密钥；也可手动指定。绑定非回环地址**或使用 `--tunnel`** 时必填 | 自动生成 |
| `web.auth_password` | 备用钥匙密码（scrypt 哈希存储，V3.5.3） | `null` |
| `web.require_login` | `false` = 本机免登录；`true` = 强制验证（V3.7.0） | `false` |
| `web.trust_proxy` | 挂在反向代理后面时置 `true`，强制登录并锁定危险开关（V3.7.0） | `false` |
| `web.session_timeout` | 登录会话有效期（秒） | `86400`（24 小时） |
| `web.dev_mode` | 开发模式。未配 SMTP 时会回显验证码，**生产环境务必关闭** | `false` |
| `web.port` | 监听端口 | `8080` |
| `web.host` | 绑定地址 | `127.0.0.1` |
| `web.theme` | 面板主题包名 | `default` |

---

## 三、面板功能

| 功能 | 说明 |
|------|------|
| 服务器状态 | 运行中 / PID / 方案名 / 启动时刻 / 核心文件 / 服务器目录 |
| 实时日志 | Socket.IO **每 250ms** 推送 `logs/latest.log` 增量（V3.5.19 起，旧版为 500ms） |
| MC 控制台 | 直接向运行中的服务端发指令（`say`、`op` 等），走 `POST /api/console` |
| 任务队列 | 创建方案等耗时操作异步执行，显示阶段文案与百分比进度，可跳转到队列页看详情 |
| 文件管理 | 浏览 / 上传 / 下载 / 改名 / 移动 / 复制 / 删除 / 压缩 / 解压，支持在线编辑文本文件 |
| 配置管理 | 表单化编辑 `wow.yaml`（开关 / 输入框 / 下拉框 + 中文说明），也可切回原始 JSON |
| 模组列表 | 列出当前方案已安装模组 |
| 方案管理 | 列出方案及当前激活方案，查看资源引用详情 |
| 主题切换 | 列出并切换主题包 |
| 命令执行 | 直接在面板里执行 `wow` CLI 命令，终端同步回显 `[WebCLI] ...` |

> 🎯 **面板上的每个操作，本质都是「代理发送一条 CLI 指令」**。终端会同步打印
> `[WebCLI] wow <指令>`，方便对照与排查。CLI 优先级高于面板：面板不实现独立逻辑，
> 只做参数收集、进度展示与结果呈现。

面板页面（静态资源）来自 `web/` 目录。启动时若 `web/` 不存在，会从当前主题包
（`themes/<web.theme>/`，缺失则回退 `themes/default/`）复制生成；两个主题目录都没有时，
才生成一个只有提示的最小页。切换主题是**整目录替换**，详见 [主题包开发指南](THEMES.md)。

---

## 四、接口与实时通信

- 数据接口以 `/api/` 开头，除认证接口外均需携带 JWT（详见 [Web API 参考](API.md)）。
- 实时通信使用 **Socket.IO**（不是原生 WebSocket），服务端推送事件包括：
  `message`（连接确认）、`log`（日志增量，250ms）、`tasks`（队列快照）、`task`（单个任务进度）、
  `console`（`[WebCLI]` 回显）、`command_result`（指令执行结果）。
- 前端可发送 `command` 事件执行 CLI 指令；MC 控制台指令请走 `POST /api/console`，两者不要混用。

---

## 五、常见问题

- **打开面板是空白页 / 提示未找到主题包**：运行 `wow theme install <主题包.zip>` 安装主题，或确认 `themes/default` 存在。
- **验证码没收到邮件**：多半是 SMTP 未配置。要么配 SMTP，要么用离线密码 `web.auth_password`；开发模式（`web.dev_mode: true`）下验证码会打印在终端。
- **想换端口 / 允许远程访问**：用 `wow web start --port <端口> --host 0.0.0.0`，或 `--public`（强制校验凭据）。
- **远程访问时启动被拒绝**：提示「暴露公网必须设置 auth_token 或管理员密码」。先 `wow config wow web.auth_token <随机串>`，或设 `web.auth_password`，再启动。
- **`--tunnel` 起来了但没给公网地址**：提示「已跳过隧道：面板本身已正常启动，但隧道未建立（缺认证凭据）」。面板是好的，只是没建隧道。补齐 `web.auth_token` / `web.auth_password` 后执行 `wow web tunnel` 补建，或重启时带上凭据。
- **控制台发指令报「当前服务端进程没有控制台接收器」**：服务端是旧版本 `wow server start` 拉起的，用新版本重启服务器即可建立控制台中继。
- **方案操作提示「该指令已在 Web 端禁用」**：`web.allow_scheme_ops` 默认 `false`。确认风险后设为 `true`（或直接到终端执行对应 `wow scheme ...` 命令）。
