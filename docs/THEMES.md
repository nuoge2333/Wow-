# 🎨 主题包开发指南

> 主题包用于完全替换 wow 的 Web 管理界面外观，你可以自由设计任意风格的界面。

---

## 主题包是什么？

主题包是一个 **ZIP 压缩包**，解压后替换 `core/web/` 目录的全部内容。你可以：

- 完全重写 HTML 结构
- 设计自己的 CSS 样式
- 编写任意 JavaScript 交互逻辑
- 添加图片、字体等静态资源
- 文件结构完全自由，**只要你的代码中的链接（`src`、`href` 等）遵循你自己定制的文件结构即可**（“能跑就行”）

---

## 前置知识

如果你对网页开发不熟悉，请先学习以下基础知识（在线教程搜索即可）：

| 技术 | 用途 |
|------|------|
| **HTML** | 网页结构 |
| **CSS** | 网页样式 |
| **JavaScript** | 网页交互逻辑 |

> 💡 主题包只替换前端界面，后端 API 由 wow 核心提供。你只需要关心如何调用 API 和显示数据。

---

## 签名文件 `theme.json`

主题包根目录**必须**包含 `theme.json` 签名文件，用于标识主题信息。

### 文件格式

```json
{
    "name": "主题名称",
    "author": "作者名",
    "version": "1.0.0",
    "compatible": "3.0.0",
    "description": "简短描述"
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 主题显示名称 |
| `author` | ✅ | 作者名 |
| `version` | ✅ | 版本号（语义化版本） |
| `compatible` | ✅ | 兼容的 wow 版本（如 `3.0.0`） |
| `description` | ✅ | 简短描述（显示在列表中） |

---

## 打包方式

1. 将你的所有前端文件（HTML、CSS、JS、图片等）放在一个文件夹中
2. 确保该文件夹**根目录**有 `theme.json` 文件
3. 将整个文件夹打包为 **ZIP 压缩包**（不要压缩成 `.rar` 或 `.7z`，只支持 `.zip`）

```bash
# 示例：打包主题
zip -r my_theme.zip my_theme_folder/
```

---

## 安装与使用

```bash
# 安装主题包
wow theme install ./my_theme.zip

# 列出已安装主题
wow theme list

# 切换主题（会弹出安全警告，确认后继续）
wow theme switch my_theme

# 查看主题信息
wow theme info my_theme

# 删除主题
wow theme delete my_theme
```

---

## 主题与 Web API

主题前端需要通过 AJAX/Fetch 调用后端 API 获取数据或执行操作。

所有 API 端点均需要 **Bearer Token** 认证（登录后自动获得）。

API 详细文档请参阅 [API.md](API.md)。

### 常用 API 示例

```javascript
// 获取服务器状态
fetch('/api/status', {
    headers: { 'Authorization': 'Bearer ' + token }
})
.then(res => res.json())
.then(data => console.log(data));

// 执行命令
fetch('/api/exec', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ command: 'server status' })
})
.then(res => res.json())
.then(data => console.log(data));

// WebSocket 实时日志
const ws = new WebSocket('ws://' + location.host + '?token=' + token);
ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'log') {
        console.log(data.line);
    }
};
```

---

## 安全警告

每次切换主题时，wow 都会弹出安全警告：

```
⚠️ =================== 安全警告 ===================
⚠️ 您正在切换主题包！
⚠️ 主题包由第三方提供，可能包含恶意代码。
⚠️ 请确保您信任此主题包的来源。
⚠️ =================================================
是否继续切换主题？ (y/N):
```

用户确认后才会生效。作为主题作者，你可以在 README 或宣传中说明自己的可信度，但 wow 不会主动验证。

---

## 文件结构完全自由

主题包解压后直接替换 `core/web/` 目录。你可以在你的主题包中自由放置任何文件，只要：

1. `theme.json` 在根目录
2. 你自己写的 HTML 中引用的路径（CSS、JS、图片等）与你自己的文件结构一致

例如，如果你的主题包结构是：

```
my_theme/
├── theme.json
├── index.html
├── css/
│   └── style.css
└── js/
    └── script.js
```

那么 `index.html` 中引用：

```html
<link rel="stylesheet" href="css/style.css">
<script src="js/script.js"></script>
```

---

## 注意事项

1. **登录页**（`login.html`）位于 `core/web/` 根目录，在未登录时直接访问。
   如果你希望自定义登录页，需要在主题包中包含 `login.html`，并确保登录逻辑调用 `/api/auth/request-code` 和 `/api/auth/login`。

2. **主框架**（`index.html`）默认包含菜单栏 (`left.html`) 和通知栏 (`right.html`) 的 iframe。
   你可以完全替换 `index.html` 的设计，但建议保留与后端 API 的通信方式（使用 `token`）。

3. 如果你修改了菜单栏的页面跳转逻辑，请确保跳转目标是你的主题包中存在的 HTML 文件。

4. 主题包中**不需要**包含 `css/main.css` 或 `js/main.js`，除非你打算覆盖它们。wow 的默认全局样式会被你的样式覆盖（如果文件名相同），但建议你使用自己的样式文件，避免冲突。

---

## 示例：极简主题包

### 目录结构

```
minimal_theme/
├── theme.json
├── index.html
└── style.css
```

### theme.json

```json
{
    "name": "极简主题",
    "author": "wow Team",
    "version": "1.0.0",
    "compatible": "3.0.0",
    "description": "一个极简的服务器状态页面"
}
```

### index.html

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>wow 服务器</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <h1>🎮 我的服务器</h1>
    <div id="status">加载中...</div>
    <button onclick="startServer()">启动</button>
    <button onclick="stopServer()">停止</button>
    <div id="log" style="background:#1e1e1e;color:#d4d4d4;padding:10px;height:200px;overflow-y:scroll;font-family:monospace;"></div>

    <script>
        const token = sessionStorage.getItem('wow_token');
        if (!token) window.location.href = '/login.html';

        async function apiExec(cmd) {
            const resp = await fetch('/api/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ command: cmd })
            });
            return await resp.json();
        }

        function startServer() { apiExec('server start'); }
        function stopServer() { apiExec('server stop'); }

        async function updateStatus() {
            const resp = await fetch('/api/status', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json();
            document.getElementById('status').textContent = data.running ? '✅ 运行中' : '⏹️ 已停止';
        }
        updateStatus();
        setInterval(updateStatus, 3000);

        // 连接 WebSocket 实时日志
        const ws = new WebSocket('ws://' + location.host + '?token=' + token);
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'log') {
                const log = document.getElementById('log');
                log.textContent += data.line + '\n';
                log.scrollTop = log.scrollHeight;
            }
        };
    </script>
</body>
</html>
```

### style.css

```css
body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #1a1a2e; color: #eee; }
h1 { color: #4CAF50; }
button { padding: 8px 16px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
button:first-of-type { background: #4CAF50; color: white; }
button:last-of-type { background: #f44336; color: white; }
#status { padding: 10px; background: #16213e; border-radius: 4px; margin: 10px 0; }
#log { background: #0a0f18; border-radius: 4px; }
```

---

## 发布与分享

将你的主题包 ZIP 文件分享给其他 wow 用户，他们可以通过 `wow theme install` 安装。
