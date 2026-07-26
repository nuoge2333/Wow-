# 🔌 wow 插件开发指南

> wow 插件用于扩展 wow 工具本身的命令，不涉及 Minecraft 服务端插件。

---

## 插件是什么？

wow 插件是一个 **ZIP 压缩包**，安装后可以向 wow 添加新的 CLI 命令。

- ✅ 添加自定义命令（如 `wow hello`、`wow backup`）
- ✅ 访问 wow 核心模块（服务器管理、方案管理、模组管理等）
- ❌ 不能修改已有命令的行为
- ❌ 不能修改 wow 核心代码

---

## 前置知识

插件使用 **Node.js** 运行时环境（wow 自带便携版），使用 **JavaScript** 编写。

如果你不熟悉这些，请先学习：

| 技术 | 用途 |
|------|------|
| **JavaScript (ES6+)** | 插件逻辑编写 |
| **Node.js 基础** | 文件系统 (`fs`)、路径 (`path`)、子进程 (`child_process`) 等 |
| **npm 包管理** | 如需使用第三方依赖 |

> 💡 插件运行在 Node.js 环境中，你可以使用任何 npm 包，但需要自行管理依赖。

---

## 签名文件 `plugin.json`

插件根目录**必须**包含 `plugin.json` 签名文件。

### 文件格式

```json
{
    "name": "插件名称",
    "author": "作者名",
    "version": "1.0.0",
    "compatible": "3.0.0",
    "description": "简短描述",
    "commands": [
        {
            "name": "hello",
            "description": "打招呼",
            "options": [
                { "flag": "-n, --name <name>", "description": "名字", "default": "World" }
            ],
            "handler": "helloHandler"
        }
    ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 插件显示名称 |
| `author` | ✅ | 作者名 |
| `version` | ✅ | 版本号（语义化版本） |
| `compatible` | ✅ | 兼容的 wow 版本（如 `3.0.0`） |
| `description` | ✅ | 简短描述 |
| `commands` | ✅ | 命令定义数组 |

### `commands` 数组

每个命令对象包含：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 命令名称（如 `hello`，用户输入 `wow hello`） |
| `description` | ✅ | 命令帮助描述 |
| `options` | ❌ | 选项数组（见下方） |
| `handler` | ✅ | 对应 `index.js` 中导出的函数名 |

### `options` 数组

每个选项对象包含：

| 字段 | 必填 | 说明 |
|------|------|------|
| `flag` | ✅ | 选项标志（如 `-n, --name <name>`） |
| `description` | ✅ | 选项描述 |
| `default` | ❌ | 默认值 |

---

## 处理函数 `index.js`

插件必须包含 `index.js` 文件，导出与 `plugin.json` 中 `handler` 对应的函数。

### 函数签名

```javascript
/**
 * 命令处理函数
 * @param {Object} args - 解析后的命令行参数（包含 options）
 * @param {Object} context - 上下文对象（可访问 wow 核心模块）
 */
function myHandler(args, context) {
    // 实现你的命令逻辑
}

module.exports = { myHandler };
```

### `context` 对象

`context` 提供了 wow 核心模块的引用，你可以直接调用：

```javascript
function exampleHandler(args, context) {
    // 服务器管理
    context.server.start();
    context.server.stop();
    context.server.status();

    // 配置管理
    context.config.getConfig('server.dir');
    context.config.setConfig('web.port', 8080);

    // 模组管理
    context.mod.listMods();
    context.mod.install('./mod.jar');

    // 方案管理
    context.scheme.list();
    context.scheme.switch('survival');

    // 主题管理
    context.theme.list();
    context.theme.switch('dark');

    // 日志
    context.log.tail();

    // 邮件
    context.mail.sendVerificationCode('user@example.com', '123456');

    // 整合包
    context.pack.generate('my_pack');

    // 工具
    context.utils.detectJava();
    context.utils.getOS();
}
```

---

## 目录结构完全自由

插件解压后放入 `wow-plugins/{plugin_name}/` 目录。

**除了根目录必须有 `plugin.json` 和 `index.js` 外，其他文件结构完全自由。**

你可以：
- 使用子目录组织代码
- 引入图片、配置文件等资源
- 使用 `require()` 加载其他 JS 文件（模块化）

```bash
my-plugin/
├── plugin.json          # 必需
├── index.js             # 必需（入口文件）
├── lib/
│   ├── helper.js        # 可选
│   └── config.js        # 可选
└── assets/
    └── data.json        # 可选
```

### 模块化示例

```javascript
// index.js
const helper = require('./lib/helper.js');
const config = require('./lib/config.js');

function myHandler(args, context) {
    const data = helper.process(args);
    config.save(data);
    console.log('Done!');
}

module.exports = { myHandler };
```

---

## 使用其他语言编写

wow 插件以 **JavaScript** 为入口，但你可以通过以下方式使用其他语言：

### 方法一：编译为 JavaScript

使用 TypeScript、CoffeeScript、Dart 等编译为 JS 的语言：

```bash
# TypeScript 示例
tsc index.ts --outDir dist/
# 然后在 plugin.json 中指向 dist/index.js
```

### 方法二：通过子进程调用外部程序

在 JavaScript 中调用 Python、Rust、Go 等编译的程序：

```javascript
const { exec } = require('child_process');

function myHandler(args, context) {
    exec('python3 ./script.py', (error, stdout) => {
        if (error) {
            console.error('执行失败:', error);
            return;
        }
        console.log(stdout);
    });
}
```

### ⚠️ 后果自负声明

> **使用其他语言编写插件时，请确保运行环境已安装对应的解释器或运行时。**
>
> wow 仅提供 Node.js 环境，不保证其他语言的可用性。
>
> 因插件引起的任何问题（包括但不限于：系统崩溃、数据丢失、安全漏洞），均由插件作者自行承担。

---

## 打包与安装

### 打包

1. 将你的所有文件放在一个文件夹中
2. 确保根目录有 `plugin.json` 和 `index.js`
3. 打包为 **ZIP 压缩包**

```bash
zip -r my-plugin.zip my-plugin-folder/
```

### 安装

```bash
wow plugin install ./my-plugin.zip
```

安装后会自动解压到 `wow-plugins/my-plugin/`，下次启动 CLI 时自动加载。

### 管理

```bash
# 列出已安装插件
wow plugin list

# 查看插件详情
wow plugin info my-plugin

# 卸载插件
wow plugin remove my-plugin
```

---

## 加载机制

CLI 启动时，wow 会：

1. 扫描 `wow-plugins/` 目录
2. 查找包含 `plugin.json` 和 `index.js` 的子目录
3. 解析 `plugin.json`，注册命令
4. 加载 `index.js`，绑定处理函数

**加载顺序**：按目录名排序。插件间的执行顺序不可依赖。

---

## 安全警告

安装插件时，wow 不会验证插件来源。由用户自行判断。

建议：
- 仅安装可信来源的插件
- 安装前检查 `plugin.json` 内容
- 查看 `index.js` 代码（如果公开）

---

## 示例：完整插件

### 目录结构

```
hello-plugin/
├── plugin.json
└── index.js
```

### plugin.json

```json
{
    "name": "Hello World",
    "author": "wow Team",
    "version": "1.0.0",
    "compatible": "3.0.0",
    "description": "打招呼命令",
    "commands": [
        {
            "name": "hello",
            "description": "打招呼",
            "options": [
                { "flag": "-n, --name <name>", "description": "名字", "default": "World" },
                { "flag": "-c, --count <number>", "description": "重复次数", "default": "1" }
            ],
            "handler": "helloHandler"
        }
    ]
}
```

### index.js

```javascript
function helloHandler(args, context) {
    const name = args.name || 'World';
    const count = parseInt(args.count) || 1;

    for (let i = 0; i < count; i++) {
        console.log(`👋 Hello, ${name}!`);
    }

    // 可选：显示服务器状态
    const status = context.server.status();
    console.log(`服务器状态: ${status.running ? '运行中' : '已停止'}`);
}

module.exports = { helloHandler };
```

### 使用效果

```bash
$ wow hello -n Steve -c 3
👋 Hello, Steve!
👋 Hello, Steve!
👋 Hello, Steve!
服务器状态: 运行中
```

---

## 注意事项

1. **插件不能修改已有命令**：无法覆盖 `wow server start` 等内置命令
2. **不保证向后兼容**：wow 版本升级可能导致插件 API 变化
3. **性能影响**：插件在 CLI 启动时加载，过多插件可能影响启动速度
4. **依赖管理**：如需使用 npm 包，请在插件目录中自行 `npm install`，wow 不会自动安装
5. **全局对象污染**：避免修改 `global` 对象，防止影响其他插件

---

## 发布与分享

将你的插件 ZIP 文件分享给其他 wow 用户，他们可以通过 `wow plugin install` 安装。

**祝你开发出有用的插件！🔌**