# 🔌 Web API 参考

> 📌 **命令引导词**：文档中的 `wow` 是简写 —— Linux / macOS 请写 `./wow.sh`，Windows 请写 `wow.bat`。例如 `wow server start` 在 Linux 下即 `./wow.sh server start`。

Wow~ Web 面板以 Express 提供 HTTP 接口，并以 Socket.IO 提供实时通信。所有接口基址为 `http://<host>:<port>`（默认 `http://127.0.0.1:8080`）。

> 除认证接口外，所有 `/api/*` 接口都需在请求头携带 JWT：
> `Authorization: Bearer <token>`
> 静态文件（`web/` 下的页面与资源）无需认证。

---

## 一、认证

### `POST /api/auth/request-code`
请求验证码。

**请求体**
```json
{ "email": "admin@example.com" }
```

**响应**
```json
{ "success": true, "message": "验证码已生成（SMTP 未配置，请查看控制台）", "devCode": "123456" }
```
- 若已配置 SMTP：`message` 为「验证码已发送到您的邮箱」，`devCode` 不返回。
- 若未配置 SMTP 且 `web.dev_mode: true`：验证码打印到服务端控制台，并随响应返回 `devCode`。
- 若未配置 SMTP 且非开发模式：返回 `403`，提示先配置 SMTP 或设置离线密码（防止生产环境回显验证码被拿去登录）。
- 若邮箱不在 `mail.whitelist` 内：返回 `403`，且**不会生成验证码**。

验证码有效期 5 分钟。

### `POST /api/auth/login`
登录并换取 JWT。支持两种方式，**二选一**。

**方式一：验证码登录**
```json
{ "email": "admin@example.com", "code": "123456" }
```

**方式二：离线密码登录**（V3.5.3，未配 SMTP 时的替代方式）
```json
{ "email": "admin@local", "password": "你的离线密码" }
```
> 仅当配置了 `web.auth_password` 时可用。若该值是明文，首次登录会自动转成 scrypt 哈希写回配置，
> 之后 `GET /api/config` 里看到的就是 `scrypt$...` 形式。

**响应**
```json
{ "success": true, "token": "<jwt>" }
```
失败：`401`（密码错误 / 验证码错误 / 验证码过期）、`400`（缺少邮箱或验证码）、
`403`（邮箱不在白名单内）。

### `GET /api/auth/verify`
校验当前令牌是否有效。

**请求头**：`Authorization: Bearer <token>`

**响应**
```json
{ "valid": true, "email": "admin@example.com" }
```

### `GET /api/auth/config`
公开接口（V3.7.0 安全加固）。供登录页与设置页判断「有没有密码通道、管理员邮箱配没配」。

**响应**
```json
{
  "password_enabled": true,
  "email": "a***@example.com",
  "email_configured": true
}
```

- `password_enabled`：`wow.yaml` 的 `web.auth_password` 是否非空。`false` 时登录页只显示验证码表单。
- `email`：`mail.admin_email` 的**掩码**，永远不回明文。
- `email_configured`：`mail.admin_email` 是否已配置。`false` 时不允许设置密码。

### `POST /api/auth/login-password`
公开接口（V3.7.0 安全加固）。用「备用钥匙」密码登录，成功签发 JWT。

**请求体**
```json
{ "password": "你的面板密码" }
```

**响应**
```json
{ "success": true, "token": "<jwt>" }
```

失败：
- `401`：未设置密码 / 密码错误。
- `429`：同一 IP 在 `login-password` 通道连续失败 5 次，锁 15 分钟。返回
  `{ "success": false, "error": "尝试过于频繁，请稍后再试", "retry_after_seconds": 900 }`。
  锁定期内**即使密码正确也返回 429**。

> 限流按「通道 + IP」分桶：`login`（验证码/离线密码）、`login-password`（备用钥匙）、
> `set-password`（设置密码）互不影响，一个通道被锁不会连累其它通道。

### `POST /api/auth/set-password`
公开接口（V3.7.0 安全加固）。设置或修改「备用钥匙」密码。

**为什么公开**：首次设置密码时用户不可能已有 JWT；而用来换 token 的
`/api/auth/login` 会当场消费掉验证码，所以「先换 token 再设密码」在协议上走不通。
本接口的凭据是**管理员邮箱 + 邮箱验证码**，再叠 IP 限流。

**请求体**
```json
{
  "email": "admin@example.com",
  "code": "123456",
  "password": "新密码",
  "old_password": "已有密码时必填"
}
```

**响应**
```json
{ "success": true, "message": "登录密码已设置，验证码登录仍可继续使用", "token": "<jwt>" }
```

失败：
- `400`：`mail.admin_email` 未配置 / 提交邮箱与管理员邮箱不一致 / 密码不足 8 位或不含字母。
- `401`：验证码未获取、已过期、错误，或已有密码时 `old_password` 不正确。
- `429`：同 IP 在 `set-password` 通道连续失败 5 次。

成功后会删除该验证码，并把 `scrypt$<saltHex>$<derivedHex>` 写入 `web.auth_password`；
同时返回 JWT，前端可直接进入登录态。

> 注意：`mail.admin_email` 必须同时出现在 `mail.whitelist` 里（若白名单非空），
> 否则获取验证码会被 403 拒绝。

---

## 二、服务器与资源（需认证）

### `GET /api/status`
服务器运行状态（V3.5.19 补齐了方案名、启动时刻、控制台中继与 Web 监听信息）。

**响应**
```json
{
  "running": true,
  "pid": 12345,
  "serverDir": "/path/to/wow/scheme/myserver",
  "jarFile": "server.jar",
  "logFile": "/path/to/wow/scheme/myserver/logs/latest.log",
  "scheme": "myserver",
  "startedAt": 1767225600000,
  "consoleRelay": true,
  "web": { "port": 8080, "host": "127.0.0.1" }
}
```

| 字段 | 说明 |
|------|------|
| `running` / `pid` | 是否在运行 / 进程号（未运行为 `null`） |
| `serverDir` / `jarFile` / `logFile` | 当前方案目录、核心文件名、日志路径 |
| `scheme` | 当前激活方案名（取自 `server.scheme`，未激活为 `null`） |
| `startedAt` | 启动时刻（毫秒时间戳，由 `server.pid` 的 mtime 近似；未运行为 `null`） |
| `consoleRelay` | 是否有进程在接收 MC 控制台指令；为 `false` 时 `/api/console` 会失败 |
| `web` | 面板实际监听的端口与地址（多实例时以端口文件为准） |

### `GET /api/logs?lines=50`
最近 N 行服务器日志（默认 50）。

**响应**
```json
{ "logs": ["...", "..."], "total": 1234 }
```

### `GET /api/mods`
已安装模组列表。

**响应**
```json
{ "mods": [ ... ] }
```

### `GET /api/schemes`
方案列表与当前激活方案。

**响应**
```json
{ "schemes": [ ... ], "current": "survival" }
```

### `GET /api/scheme/:name/status`
单个方案的详细信息（V3.5.19 新增）。前端「方案详情」弹窗用的就是它。

**响应**
```json
{
  "success": true,
  "name": "survival",
  "state": "partial",
  "version": "1.20.1",
  "loader": "forge",
  "type": "forge",
  "build": null,
  "created_at": "2026-10-01T12:00:00.000Z",
  "updated_at": "2026-10-20T08:30:00.000Z",
  "active": true,
  "core": { "file": "forge-1.20.1-47.2.0.jar", "in_pool": true },
  "mods": { "count": 42, "shared": 30, "unique": 12 },
  "plugins": { "count": 0, "shared": 0, "unique": 0 },
  "unique_resources": ["config/mymod.toml"],
  "world": { "exists": true }
}
```
方案不存在返回 `404`。`state` 取值为 `minimal` / `partial` / `full`，含义见 [SCHEMES.md](SCHEMES.md)。

### `GET /api/themes`
主题包列表与当前主题。

**响应**
```json
{ "themes": [ ... ], "current": "default" }
```

---

## 三、配置（需认证）

### `GET /api/config/:key?`
读取配置。带 `:key` 读单项，不带则读取完整配置。

**响应（单项）**
```json
{ "key": "web.port", "value": 8080 }
```
**响应（全部）**
```json
{ "web": { "port": 8080, "host": "127.0.0.1", "theme": "default", ... }, ... }
```

### `POST /api/config`
写入配置项。

**请求体**
```json
{ "key": "web.port", "value": 9000 }
```

**响应**
```json
{ "success": true, "key": "web.port", "value": 9000 }
```

> ### ⚠️ 危险开关的 403 拦截（V3.7.0 安全加固）
>
> `web.allow_scheme_ops`、`web.allow_remote_install`、`web.allow_plugins`
> 三个键只能从**本机**（`127.0.0.1` / `localhost` / `::1`）直连面板修改。
> 通过公网、局域网、内网穿透、反向代理访问时，`POST /api/config` 与
> `POST /api/config/batch` 只要载荷里**出现**这三个键就直接：
>
> ```json
> { "success": false, "error": "出于安全考虑，危险开关只能在 127.0.0.1 下修改", "keys": ["web.allow_plugins"] }
> ```
>
> HTTP 状态码 `403`。判定是「出现即拦」——不比较值，`false` 也拦，避免类型归一化绕过。
> 判定条件全部满足才算本机：socket 来源为回环、`Host` 为回环、无隧道（含建立中）、
> `web.trust_proxy` 未开启、绑定地址未暴露；出现任何转发头（`X-Forwarded-For` 等）即锁死。
> 拦截发生在认证之前，所以未登录时也是 403 而不是 401。
>
> 需要在远端开启时，请登录服务器本机操作，或使用 CLI：`wow config set web.allow_scheme_ops true`。

### `GET /api/config/schema`
配置表单结构（V3.5.19 新增）。返回「有哪些键、什么类型、中文怎么解释」，前端据此生成表单。

**响应**
```json
{
  "success": true,
  "fields": [
    {
      "key": "web.port",
      "type": "number",
      "group": "Web 面板",
      "label": "监听端口",
      "desc": "面板对外提供服务的端口，改完需要重启 web 服务。",
      "value": 8080
    },
    {
      "key": "web.auth_token",
      "type": "secret",
      "group": "Web 面板",
      "label": "JWT 密钥",
      "desc": "同时用于签发登录令牌与签名校验。",
      "value": null,
      "hasValue": false
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `type` | `boolean` / `string` / `number` / `select` / `list` / `secret` |
| `options` | 仅 `select` 有，形如 `[{ "value": "zh_CN", "label": "简体中文" }]` |
| `advanced` | `true` 表示默认收在「高级」折叠区 |
| `danger` | `true` 表示改动风险高，前端标红并二次确认 |
| `value` | `secret` 类型恒为 `null`，不返回明文 |
| `hasValue` | 仅 `secret` 有，表示「是否已设置」 |

> 该接口必须注册在 `GET /api/config/:key` 之前，否则 `schema` 会被当成配置键名。

### `POST /api/config/batch`
批量保存配置（V3.5.19 新增）。表单模式一次提交多个改动项，避免逐个 key 往返。

**请求体**（两种写法等价）
```json
{ "patch": { "auto_scheme": true, "web.port": 8080 } }
```
```json
{ "auto_scheme": true, "web.port": 8080 }
```

**响应**
```json
{ "success": true, "applied": 2, "keys": ["auto_scheme", "web.port"], "skipped": [] }
```

- 嵌套对象会被摊平成点号键（`{ web: { port: 8080 } }` → `web.port`）。
- **未在 `/api/config/schema` 登记过的键一律忽略**，出现在 `skipped` 里，防止前端塞垃圾键把 `wow.yaml` 写花。
- 任一键取值非法即整体拒绝：`400` + `{ success: false, error: "配置项 xxx 取值非法：...", key }`。

---

## 四、命令执行（需认证）

### `POST /api/exec`
在后端以子进程执行一条 `wow` CLI 命令，等价于终端里运行该命令。

**请求体**
```json
{ "command": "server", "args": ["status"] }
```
> `command` 为命令主干（如 `server`、`scheme`、`install`），`args` 为其余参数数组。

**响应**
```json
{ "success": true, "output": "..." }
```
失败时返回 HTTP 500：`{ "success": false, "error": "..." }`。

#### 危险指令分档（V3.5.7）

后端维护两份清单，拒绝时返回 `403` 并说明原因：

| 类别 | 指令 | 可否放开 |
|------|------|----------|
| **方案操作** `SCHEME_OPS` | `scheme create` / `switch` / `delete` / `edit` / `pull` / `prune` / `register` / `export` / `import` | ✅ 配置 `web.allow_scheme_ops: true` |
| **永久拒绝** `DENIED_WEB_ALWAYS` | `init`、`mod remove` / `sync` / `toggle`、`pack install`、`web start`、`logs tail` | ❌ 不受任何开关影响 |
| **远程安装** | `install <http(s)://...>` | ✅ 配置 `web.allow_remote_install: true` |

两个开关**默认均为 `false`**。拒绝响应示例：

```json
{ "success": false, "error": "该指令已在 Web 端禁用：scheme delete。如需放开，请在配置中设置 web.allow_scheme_ops: true" }
```

> ⚠️ `web.allow_remote_install: true` 等同于开放任意代码执行入口，请仅在完全可信的网络环境中开启。
> 启动时会做一次危险配置自检，若检测到「危险开关已开 + 监听 `0.0.0.0` + `dev_mode=true`」
> 等组合，会在日志中打印安全提示（仅提示，不阻断启动）。

### `POST /api/console`
向**运行中的 Minecraft 服务端**发送一条控制台指令（V3.5.19 新增）。

**请求体**
```json
{ "line": "say hello" }
```

**响应**
```json
{ "success": true, "via": "relay", "line": "say hello", "queued": true }
```

| 字段 | 说明 |
|------|------|
| `via` | `relay` = 通过控制台中继进程投递；`stdin` = 直接写服务端 stdin（旧版本拉起的进程才走这条） |
| `queued` | 仅 `relay` 分支有，表示已入队 |

> 🎯 **为什么不用 `/api/exec`**：控制台指令不是 wow 指令。`say hi` 走 `/api/exec` 会被拆成
> `wow say hi` → unknown command。本接口只做三件事：清洗（剥离控制字符 / 零宽字符）→ 回显
> `[WebCLI]` → 投递给持有 stdin 的进程。

错误：`400` 指令为空、`413` 超过 512 字符、`409` 服务器未运行或当前进程没有控制台接收器。

---

## 四之一、异步任务队列（V3.5.19 新增，需认证）

耗时操作（创建方案、拉取 / 瘦身资源）不再让 HTTP 请求干等，改为「提交 → 立即返回 task_id → 订阅进度」。

### `POST /api/tasks/run`
提交异步任务。**立即返回**，不等下载/安装完成。

**请求体**
```json
{
  "command": "scheme create",
  "args": ["myserver", "--version", "1.20.1", "--type", "paper"],
  "name": "myserver",
  "type": "方案"
}
```

| 字段 | 说明 |
|------|------|
| `command` | 指令主体，必须是白名单内的前缀：`scheme create` / `scheme pull` / `scheme prune` |
| `args` | 其余参数数组（会自动清洗空白与控制字符） |
| `name` | 任务显示名，缺省用 `command` |
| `type` | 任务分类标签，缺省 `方案` |

**响应**
```json
{
  "success": true,
  "task_id": "1767225600000-a1b2c3",
  "task": {
    "id": "1767225600000-a1b2c3",
    "name": "myserver",
    "type": "方案",
    "status": "运行中",
    "progress": 5,
    "stage": "初始化方案目录",
    "command": "scheme create myserver --version 1.20.1 --type paper",
    "logs": [],
    "created_at": "2026-11-01T09:00:00.000Z"
  }
}
```

错误：`403` + `code: "POLICY_DENIED"`（指令不在白名单 / 被 `web.allow_scheme_ops` 拦下）、
`400`（缺少 command 或队列已满）。

### `GET /api/tasks`
任务列表与汇总。

```json
{
  "success": true,
  "tasks": [ { "id": "...", "name": "myserver", "status": "完成", "progress": 100, "stage": "完成", "logs": ["..."] } ],
  "stats": { "total": 1, "running": 0, "finished": 1, "failed": 0 }
}
```

`status` 取值：`等待中` / `运行中` / `完成` / `失败`。`logs` 只保留尾部 60 行，`tasks` 最多 50 条。

### `DELETE /api/tasks`
清理已结束（完成 / 失败）的任务，返回 `{ "success": true, "removed": 2 }`。

---

## 四之二、文件管理（V3.5.6 新增，需认证）

> 所有路径均以**方案的运行目录**为根（即 `scheme/<方案名>/`），并严格拒绝路径穿越。
> 未指定方案且未激活任何方案时，根目录回退为 `scheme/`。
>
> **`scheme` 参数**（V3.5.19）：下列文件接口都接受 `?scheme=<方案名>`（写操作也可放在请求体里），
> 用于在面板里跨方案浏览文件。缺省 = 当前激活方案。方案名会做二次校验，
> 必须真实存在且含 `scheme.yaml`，含 `..` / 路径分隔符 / 盘符一律拒绝。

### `GET /api/files?path=<相对路径>`
列出目录内容。`path` 为空表示根目录。

**响应**
```json
{
  "success": true,
  "path": "mods",
  "root": "/path/to/wow/scheme/myserver",
  "files": [
    { "name": "JEI.jar", "type": "file", "size": 123456, "mtime": "2026-01-01T00:00:00.000Z", "path": "mods/JEI.jar" }
  ]
}
```
目录条目排在文件之前。路径越界返回 `403`，目录不存在返回 `404`。

### `GET /api/download?path=<相对路径>&token=<JWT>`
下载单个文件。因浏览器 `window.open` 无法携带 `Authorization` 头，本接口额外接受 `?token=` 查询参数。

响应为文件流，`Content-Disposition` 同时给出 ASCII 与 RFC 5987 编码的文件名。

### `POST /api/upload`
上传文件（`multipart/form-data`）。

| 表单字段 | 说明 |
|----------|------|
| `files[]` | 文件字段，可多个；支持 `webkitRelativePath` 保留子目录结构 |
| `path` | 目标子目录（相对方案根目录），可空 |

**响应**
```json
{ "success": true, "uploaded": 2, "files": ["a.jar", "b.jar"], "skipped": [] }
```
单次上传总大小上限 **512MB**，超限返回 `413`；被安全策略拒绝的文件会出现在 `skipped` 中。

### 文件管理进阶接口（V3.5.7 新增，需认证）

> **重要变更**：V3.5.7 起，新建/重命名/移动/复制/删除/压缩/解压全部改为下列 REST 接口，
> **不再通过 `/api/exec` 调用系统命令**。旧实现依赖 `mkdir`/`mv`/`rm`/`cp`/`zip`/`unzip`/`tar`，
> 在 Windows 上几乎全部不可用，且存在命令注入风险。
> 所有接口的响应错误码见下方映射表。

**通用错误码**

| 错误码 | HTTP | 含义 |
|--------|------|------|
| `EPATH` | 403 | 路径越界 / 名称非法 / 操作方案根目录 |
| `ENOENT` | 404 | 目标不存在 |
| `ENOTDIR` | 400 | 路径中存在非目录段 |
| `EISDIR` | 400 | 期望文件但拿到目录 |
| `EEXIST` | 409 | 目标已存在 |
| `ETOOBIG` | 413 | 内容超出上限 |
| `EBADZIP` | 400 | 压缩包损坏或格式不符 |

**名称合法性规则**（跨平台，Windows 最严格）：不得为空、不得为 `.` / `..`、不得含路径分隔符、
不得含 `< > : " | ? *` 或控制字符、不得是 Windows 保留设备名（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`）、
不得以点或空格结尾、长度不超过 255。

---

### `POST /api/files/mkdir`
新建文件夹。

```json
{ "path": "mods", "name": "新文件夹" }
```
`path` 为父目录（相对方案根，可为空表示根目录）。成功返回 `{ "success": true, "path": "mods/新文件夹" }`。

### `POST /api/files/rename`
重命名。

```json
{ "path": "mods/a.jar", "newName": "b.jar" }
```

### `POST /api/files/move`
移动。

```json
{ "paths": ["mods/a.jar"], "target": "mods/old" }
```
支持批量。**不允许把目录移入自身的子目录**（返回 `403`）。

### `POST /api/files/copy`
复制。请求体同 `move`。

### `DELETE /api/files`
删除文件或目录（目录递归删除）。

```json
{ "paths": ["mods/a.jar", "temp"] }
```
支持批量。**不允许删除方案根目录**（返回 `403`）。

### `POST /api/files/compress`
压缩为 zip。

```json
{ "paths": ["mods/a.jar", "config"], "dest": "backup.zip" }
```

### `POST /api/files/extract`
解压 zip。

```json
{ "path": "backup.zip", "dest": "restore" }
```
> **仅支持 `.zip`**，其他格式返回 `403` 并提示在终端操作。
> 解压时逐条校验条目名，含 `..`、绝对路径或盘符越界的条目会被**跳过**（不报错中断），
> 并在响应 `skipped` 数组中列出。

### `GET /api/files/content?path=<相对路径>`
读取文本文件。默认上限 512KB，超限返回 `413`。

```json
{ "success": true, "path": "server.properties", "content": "..." }
```

> 💡 **两套路径等价**（V3.5.19）：`GET /api/file/read` 与 `GET /api/files/content` 是同一实现，
> 后者是早期 REST 风格接口，前者是文本编辑器专用的薄别名，**没有第二份读写逻辑**。
> 新代码建议用 `/api/file/read`、`/api/file/write`，语义更直白；老代码继续用 `/api/files/content` 不会失效。

### `PUT /api/files/content`
写入文本文件（覆盖）。上限 2MB。

```json
{ "path": "server.properties", "content": "motd=Hello\n" }
```
父目录不存在会自动创建。

### `GET /api/file/read` / `POST|PUT /api/file/write`
V3.5.19 新增的文本编辑器接口，参数与 `/api/files/content` 完全一致：

```json
// POST /api/file/write
{ "path": "config/my.toml", "content": "[a]\nb = 1\n" }
```

`POST` 与 `PUT` 等价，方便前端按语义调用。成功返回 `{ success: true, path, size }`。

---

## 四之三、模组搜索与下载队列（V3.5.6 新增，需认证）

### `GET /api/mod/search?source=<modrinth|curseforge>&query=<关键词>&loader=<加载器>&version=<MC版本>`
搜索模组。

- `source` 默认 `modrinth`（公开 API，无需密钥）
- `curseforge` 需在配置中提供 `api_keys.curseforge`，否则返回 `400` 并给出指引
- 返回的每项含 `name`、`author`、`version`、`downloads`、`summary`、`loaders`、`project_id`、`slug`、`download_url`

```json
{ "success": true, "source": "modrinth", "results": [ { "name": "Sodium", "download_url": "https://..." } ] }
```

### `GET /api/mod/info?source=<来源>&project=<项目id或slug>`
获取项目详情，含 `dependencies` 依赖列表（Modrinth）。

```json
{ "success": true, "name": "Just Enough Items (JEI)", "author": "mezz", "version": "15.70.0.221", "downloads": "83.3M", "dependencies": [ { "project_id": "7tEfOcA7", "dependency_type": "required" } ] }
```

### `GET /api/download/status`
查询下载队列。

```json
{ "success": true, "queue": [ { "id": "...", "name": "JEI.jar", "type": "模组", "status": "下载中", "progress": 40 } ], "stats": { "total": 1, "running": 1, "finished": 0, "failed": 0 } }
```

### `DELETE /api/download/status`
清理已完成 / 失败的任务，返回 `{ "success": true, "removed": 2 }`。

---

## 四之四、其它面板数据（V3.5.6 新增，需认证）

### `GET /api/pool/stats`
资源共享池统计。

```json
{ "success": true, "total": 12, "refs": 8, "unique": 4, "byType": { "mods": 10, "cores": 2 }, "totalSize": 123456789 }
```
`total` 为 pool 中资源文件总数，`refs` 为已被方案引用的数量（按文件名匹配）。

### `GET /api/plugins`
列出已安装的 wow 插件（只读）：

```json
{
  "success": true,
  "plugins": [
    {
      "name": "hello",
      "dirName": "hello",
      "version": "1.0.0",
      "author": "wow Team",
      "description": "打招呼",
      "commands": ["hello", "hello-status"],
      "trusted": "trusted",
      "active": true
    }
  ]
}
```

`trusted` 三态：`trusted`（指纹一致）/ `new`（从未信任）/ `changed`（信任后被改过）。
`active` 恒等于 `trusted === 'trusted'`，即「下次启动会被真正加载」。

> ⚠️ **插件命令默认不能经 Web 端执行**（`web.allow_plugins: false`）。
> 本接口只是列出插件，不提供执行入口；即便插件已被信任，
> 它的命令经 `/api/exec` 调用也会被 `command_policy` 拒绝，
> 除非用户在配置里显式打开 `web.allow_plugins`。

### `GET /api/logs/analysis`
获取最近一次日志 AI 分析报告。无报告时返回 `{ "success": true, "result": "", "message": "暂无分析报告，请先执行「日志分析」。" }`（而非 404）。

### `GET /api/metrics`
运行时指标：`{ "success": true, "running": false, "cpu": "0%", "memory": "0 MB", "uptime": "0s", "players": 0 }`
（CPU / 内存 / 运行时长读取自 `/proc`，非 Linux 平台返回零值；`players` 从最近日志中解析。）

---

## 四之五、联机（陶瓦 Terracotta）（需认证）

| 接口 | 说明 |
|------|------|
| `POST /api/lan/host` | 开房。请求体可带 `{ "roomCode": "自定义房间号" }`。返回 `{ success, roomCode, port }` |
| `POST /api/lan/stop` | 关闭房间 |
| `GET /api/lan/status` | 查询状态：`{ running, roomCode, port, pid, state, meta }` |

> 开房前会自检本机 Minecraft 服务端端口（默认 25565，取自 `server.properties`）是否在监听，未监听则报错提示先 `wow server start`。


---

## 五、WebSocket（Socket.IO）

连接地址即面板基址。**必须使用 Socket.IO 客户端**（`socket.io-client`），原生 `WebSocket`
连不上 —— 握手协议不是纯 WebSocket。

### 服务端推送

| 事件 | 载荷 | 时机 |
|------|------|------|
| `message` | `{ type: 'info', content: '已连接到 wow Web 服务' }` | 连接建立时 |
| `tasks` | `{ tasks: [...], stats: {...} }` | 连接建立时推一份当前队列快照 |
| `log` | `{ line: "...", timestamp: 1767225600000 }` | **每 250ms** 推送一次服务器日志增量（V3.5.19 起） |
| `task` | 单个任务对象（同 `GET /api/tasks` 里的结构） | 任务状态 / 进度 / 阶段变化时广播 |
| `console` | `{ line: "[WebCLI] ...", kind: 'system', timestamp }` | 面板发起 CLI 操作时的回显，所有客户端可见 |
| `command_result` | `{ command, success, output \| error }` | 响应前端发来的 `command` 事件 |

> 📌 **日志推送机制**（V3.5.19）：全局只维护**一个** 250ms 定时器和一份读取游标，
> 增量按行广播给所有客户端；首个客户端连上时启动，最后一个断开时停掉。
> 旧实现是每个 socket 各开一个 500ms 定时器、各自从文件头读，三个页面同时开着就是三份重复 IO。
>
> 新客户端**只从连接那一刻开始收增量**，历史日志请先 `GET /api/logs?lines=N` 拉一次。

### 前端可发送

| 事件 | 载荷 | 说明 |
|------|------|------|
| `command` | `{ command: "server", args: ["status"] }` | 执行一条 wow CLI 指令，结果由 `command_result` 返回；与 `/api/exec` 共用同一套安全策略 |

> MC 控制台指令（`say`、`op` 等）请走 `POST /api/console`，不要用 `command` 事件 ——
> 那会被当成 `wow say ...` 执行并报 unknown command。

---

## 六、错误码

| 状态码 | 含义 |
|--------|------|
| `400` | 请求参数缺失或格式错误（如邮箱无效、缺少 command、路径非法、配置取值非法） |
| `401` | 未登录 / Token 无效或过期 / 验证码或密码错误 |
| `403` | 路径越界、指令被策略拒绝、邮箱不在白名单、暴露公网但缺少凭据 |
| `404` | 资源不存在（目录、文件、方案或项目） |
| `409` | 状态冲突（服务器未运行、控制台无接收器、目标已存在） |
| `413` | 上传内容过大（超过 512MB）或控制台指令超过 512 字符 |
| `500` | 服务端执行出错（如命令失败） |
| `502` | 上游服务异常（Modrinth / CurseForge 等第三方接口） |
