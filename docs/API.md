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

## 四之二、文件管理（V3.5.6 新增，需认证）

> 所有路径均以**当前方案的运行目录**为根（即 `scheme/<方案名>/`），并严格拒绝路径穿越。
> 未激活任何方案时，根目录回退为 `scheme/`。

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
列出已安装的 wow 插件：`{ "success": true, "plugins": [ { "name": "...", "author": "...", "version": "...", "active": true } ] }`

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

连接地址即面板基址。连接后后端会：
- 发送 `message` 事件：`{ type: 'info', content: '已连接到 wow Web 服务' }`
- 每 500ms 推送 `log` 事件：`{ line: "...", timestamp: 1234567890 }`（服务器日志增量）

前端可发送：
- `command` 事件：`{ command: "server", args: ["status"] }` → 后端执行并以 `command_result` 事件返回 `{ command, success, output|error }`

---

## 六、错误码

| 状态码 | 含义 |
|--------|------|
| `400` | 请求参数缺失或格式错误（如邮箱无效、缺少 command、路径非法） |
| `403` | 路径越界 / 权限不足（如文件管理中的路径穿越） |
| `404` | 资源不存在（目录、文件或项目） |
| `413` | 上传内容过大（超过 512MB） |
| `502` | 上游服务异常（Modrinth / CurseForge 等第三方接口） |
| `401` | 未登录 / Token 无效或过期 / 验证码错误 |
| `500` | 服务端执行出错（如命令失败） |
