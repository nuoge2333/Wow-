# 🔌 Web API 参考

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
- 验证码有效期 5 分钟。

### `POST /api/auth/login`
使用验证码登录，换取 JWT。

**请求体**
```json
{ "email": "admin@example.com", "code": "123456" }
```

**响应**
```json
{ "success": true, "token": "<jwt>" }
```

### `GET /api/auth/verify`
校验当前令牌是否有效。

**请求头**：`Authorization: Bearer <token>`

**响应**
```json
{ "valid": true, "email": "admin@example.com" }
```

---

## 二、服务器与资源（需认证）

### `GET /api/status`
服务器运行状态。

**响应**
```json
{ "running": true, "pid": 12345, "serverDir": "...", "jarFile": "..." }
```

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

---

## 五、WebSocket（Socket.IO）

连接地址即面板基址。连接后后端会：
- 发送 `message` 事件：`{ type: 'info', content: '已连接到 wow Web 服务' }`
- 每 500ms 推送 `log` 事件：`{ line: "...", timestamp: 1234567890 }`（服务器日志增量）

前端可发送：
- `command` 事件：`{ command: "server", args: ["status"] }` → 后端执行并以 `command_result` 事件返回 `{ command, success, output|error }`

---

## 六、错误码

| 状态码 | 含义 |
|--------|------|
| `400` | 请求参数缺失或格式错误（如邮箱无效、缺少 command） |
| `401` | 未登录 / Token 无效或过期 / 验证码错误 |
| `500` | 服务端执行出错（如命令失败） |
