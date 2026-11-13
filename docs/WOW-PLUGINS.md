# 🔌 wow 插件开发指南

> 🧪 **[实验性 / Beta]** 插件系统仍在公测。接口（`plugin.json` 字段、`context` 能力）
> 可能在小版本内调整，文档随代码同步更新。**不建议在生产环境依赖插件**。
> 公测期的承诺只有一条：**坏插件不会拖垮主程序**（见「崩溃隔离」）。

> ✅ **插件系统已实装（V3.5.21-26.3c 起）**
> 本文描述的是**当前可用**的行为，不是设计草案。
> 命令清单可直接对照 `wow plugin --help` 与 `wow plugin path`。

> wow 插件用于扩展 wow 工具本身的命令，不涉及 Minecraft 服务端的插件（Bukkit/Spigot/Paper 插件请放 `pool/plugins/`）。

> 📌 **命令引导词**：文档中的 `wow` 是简写 —— Linux / macOS 请写 `./wow.sh`，Windows 请写 `wow.bat`。例如 `wow hello` 在 Linux 下即 `./wow.sh hello`。

---

## ⚠️ 先读这段：插件不是沙箱

插件代码与 wow 主程序**运行在同一个 Node.js 进程里，拥有完全相同的权限**。

**加载方式就是最直白的同进程 `require`**——不是子进程、不是 Worker、也不是 `vm`：

```js
// core/src/plugin_loader.js:227
mod = require(entry);   // entry = <项目根>/wow-plugins/<插件>/index.js
```

也就是说插件模块和 wow 自己的模块挂在**同一个 `module` 缓存、同一个 V8 堆、同一个
`process` 对象**上。`context` 参数只是一层「推荐用法的 API 面」，不是权限边界——
插件完全可以不理它，直接 `require('fs')`。

- 插件可以读写你机器上的任意文件；
- 插件可以发起任意网络请求、启动子进程、`require('fs')` / `require('child_process')`；
- 插件可以调 `process.exit()` 直接结束 wow，也可以改 `global` / `process.env` 污染主程序；
- 插件可以卡死整个进程（死循环）。

我们**没有**用 `node:vm` 或类似手段假装隔离——那层壳可以一行代码逃逸
（`this.constructor.constructor('return process')()`），只会带来虚假的安全感。
真隔离必须换进程（`child_process.fork`），而那意味着 `context` 里的
`scheme` / `server` 这些有状态实例都得改成 IPC 代理，代价远大于收益，
所以当前版本**明确选择不隔离**，改用下面三道准入闸。

因此安全靠三道**真能生效**的闸：

| 闸 | 作用 |
|---|---|
| **① 首次启用确认** | 第一次加载某个插件时，在终端列出它的作者、说明、将新增的命令，明确告知「同权限」，问你要不要启用。默认答案是否。 |
| **② 内容指纹** | 记住你同意时的插件内容（SHA-256）。插件文件**改一个字节**，下次启动就重新问你。 |
| **③ Web 端默认禁用** | 插件命令默认**不能**经 Web 面板执行（`web.allow_plugins: false`）。远程入口 + 任意代码 = 最高风险组合。 |

再加上一条：**非交互环境一律不放行未信任插件**。CI、定时脚本、Web 面板 spawn 的子进程都没有终端可问，此时未信任插件直接被跳过，而不是默默执行。

---

## 插件是什么？

wow 插件是一个文件夹（分发时打包成 ZIP），放进 `wow-plugins/` 后可以向 wow 添加新的 **CLI 顶层命令**。

- ✅ 添加自定义命令（如 `wow hello`、`wow backup`）
- ✅ 访问 wow 核心能力（服务器、方案、模组、主题、邮件、整合包等）
- ❌ 不能覆盖或修改内置命令的行为
- ❌ 不能修改 wow 核心代码（插件代码永远不写进 `core/`）

---

## 快速开始

### 1. 建目录

插件目录在**项目根目录**（与 `core/`、`web/`、`theme/` 同级），不是在 `core/` 里：

```
<wow 根目录>/
├── core/
├── web/
├── scheme/
└── wow-plugins/          ← 插件都放这里
    └── hello/
        ├── plugin.json
        └── index.js
```

用 `wow plugin path` 可以随时打印这个路径。

### 2. 写 `plugin.json`

```json
{
  "name": "hello",
  "version": "1.0.0",
  "author": "wow Team",
  "description": "打招呼命令",
  "commands": [
    {
      "name": "hello",
      "description": "打招呼",
      "options": [
        { "flag": "-n, --name <name>", "description": "名字" }
      ],
      "handler": "hello"
    }
  ]
}
```

### 3. 写 `index.js`

```javascript
module.exports = {
    async hello(args, context) {
        // args 是 commander 传入的位置参数数组，末位是 options 对象
        const opts = args[args.length - 1] || {};
        const name = opts.name || 'World';
        console.log(`👋 Hello, ${name}!`);
    }
};
```

### 4. 安装并信任

```bash
# 直接指目录（开发期最方便）
wow plugin install ./hello

# 或指 ZIP 包
wow plugin install ./hello.zip

# 查看状态：信任状态、命令一览
wow plugin list

# 授权：记下当前内容指纹，以后启动不再询问
wow plugin trust hello

# 用起来
wow hello --name Steve
```

第一次不带 `trust` 直接在终端运行 `wow hello`，wow 会问你：

```
📦 插件 hello v1.0.0 首次加载
   作者：wow Team
   说明：打招呼命令
   将新增命令：wow hello
   ⚠️ 插件代码与 wow 主程序同权限，可读写任意文件、发起网络请求。
      请只启用你信任来源的插件。
   指纹：sha256:865469a04969d522…
   启用该插件？[y/N]
```

---

## `plugin.json` 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 插件名。仅允许字母、数字、`-`、`_`；同时用作目录名与信任表键 |
| `version` | ❌ | 版本号（建议语义化版本），仅用于展示 |
| `author` | ❌ | 作者名，仅用于展示（首次启用确认里会显示） |
| `description` | ❌ | 简短描述，`plugin list` / 确认提示里会显示 |
| `compatible` | ❌ | 兼容的 wow 版本，仅作文档用途，**当前不做运行时校验** |
| `commands` | ✅ | 命令数组，**必须非空** |
| `config` | ❌ | 默认配置对象（JSON），见 [插件配置持久化](#插件配置持久化plugin-config) |
| `web` | ❌ | 前端资源目录（相对插件根），见 [插件 Web UI](#插件-web-ui实验性--beta) |

### `commands[]`

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 命令名，用户输入 `wow <name>` |
| `description` | ❌ | 帮助描述（出现在 `wow --help` 里） |
| `options` | ❌ | 选项数组，透传给 commander 的 `.option()` |
| `handler` | ✅ | `index.js` 导出的函数名 |

### 命令名规则

- 必须**小写字母开头**，只允许 `a-z 0-9 - _`（`Hello`、`1abc`、`a.b` 都会被拒）；
- 不能是保留标识符（`__proto__` / `constructor` / `prototype`）；
- 不能撞 wow 内置命令（`server` / `scheme` / `mod` / `plugin` / `theme` / `pack` / `config` / `set` / `mail` / `lan` / `down` / `pool` / `logs` / `web` / `install` / `init` / `help`）；
- 不能撞 commander 内置（`help` / `version` / 单字母别名）；
- 不能与**已注册的其它插件**重名；
- 同一插件的 `commands` 内部也不能重名。

**任意一条不满足 → 整个插件被跳过**（不会「注册一半」）。原因很简单：声明了 5 个命令却只生效 3 个，用户看到的错误比直接不加载更难排查。

### `options[]`

| 字段 | 必填 | 说明 |
|------|------|------|
| `flag` | ✅ | commander 语法的标志串，如 `-n, --name <name>` |
| `description` | ❌ | 选项描述 |

`flag` 写错了不会让插件整体失败——那一条选项被忽略，并在启动时打一条 warn。

---

## `index.js` 处理函数

```javascript
/**
 * @param {Array} args    位置参数数组，末位是 commander 的 options 对象
 * @param {Object} context 受限的能力注入对象（见下）
 */
async function myHandler(args, context) { /* ... */ }
```

**支持 async**：返回的 Promise 会被 await，异步逻辑正常完成。

### `args` 到底是什么

这是最容易踩的坑。commander 的 action 回调签名是 `(...位置参数, options)`，
wow 原样把这一串传给你的 handler。所以：

```json
{ "name": "greet", "handler": "greet" }
```
```javascript
// wow greet Steve --loud
async greet(args, context) {
    console.log(args);           // [ 'Steve', { loud: true } ]
    console.log(args[0]);        // 'Steve'
    console.log(args[args.length - 1].loud);  // true
}
```

命令本身不声明位置参数（wow 只按 `plugin.json` 的 `options` 注册选项），
所以 `args` 里除末位的 options 外，是你自己从 `process.argv` 之外的渠道拿不到的——
**推荐用 options 传参**，不要依赖位置参数。

### `context` 提供的能力

只注入下面 11 个，全部**只读**、**懒加载**（不读就不初始化）：

| key | 类型 | 说明 |
|-----|------|------|
| `context.config` | 模块函数集 | `getConfig(key, def)` / `setConfig(key, val)` / `getFullConfig()` |
| `context.utils` | 模块函数集 | `resolvePath` / `getServerDir` / `getPoolPath` / `detectJava` / `getOS` 等 |
| `context.log` | `LogHandler` 实例 | `tail()` / `analyze(opts)` / `report()` |
| `context.event` | 事件日志单例 | `info` / `warn` / `erro` / `impt`（与 CLI 自己的日志同一条流） |
| `context.server` | `ServerManager` 实例 | `start` / `stop` / `status` / `kill` 等 |
| `context.mod` | `ModManager` 实例 | 模组列表 / 安装 / 搜索 |
| `context.scheme` | `SchemeManager` 实例 | `list` / `switch` / `pull` / `prune` / `status` |
| `context.theme` | `ThemeManager` 实例 | `list` / `switch` / `install` |
| `context.mail` | `Mailer` 实例 | 验证码 / 日志邮件 |
| `context.pack` | `PackGenerator` 实例 | 整合包生成 |
| `context.pluginConfig` | `PluginConfig` 实例 | 本插件自己的持久化配置：`all()` / `get(k)` / `set(k,v)` / `merge(obj)` / `reset()` |

```javascript
async status(args, context) {
    // 只用 server 时，其余 9 个模块根本不会被 require / new
    const s = context.server.status();
    console.log(`服务器：${s.running ? '运行中' : '已停止'}`);

    // 方案管理（第一次读 context.scheme 时才 new SchemeManager）
    console.log(`当前方案：${context.config.getConfig('server.scheme', '(未设置)')}`);
}
```

三个必须知道的细节：

1. **懒加载**。`new SchemeManager()` 会 `ensureDirSync` 建 `scheme/` 和 `pool/` 下一堆目录。
   一个只用 `context.server` 的插件不该顺带改动磁盘，所以能力是按需构造的。
2. **单实例缓存**。同一个 `context` 反复读 `context.server` 返回同一引用；
   不同插件拿到的是**不同实例**（互不干扰）。
3. **构造失败返回 `null`**。某个模块在当前环境不可用（依赖缺失、目录不可写）时，
   该 key 为 `null` 并打一条 warn，其余 9 个照常可用。用之前判空。

### 拿不到什么

`context` 上**没有** `process`、`require`、`fs`、`child_process`、`global`。

但请注意：这**不是**隔离，只是「不主动把逃生口递给你」。
你的插件文件本身就在 Node 环境里，`require('fs')` 随时可用。
真正的约束是那三道闸（首次确认 / 指纹 / Web 禁用）。

---

## 插件配置持久化（plugin-config）

插件可以在 `plugin.json` 里用 `config` 声明默认配置，wow 会把它落到
**`core/plugin-config/<插件名>/config.json`**——注意是 `core/` 下，不在插件目录里。
这样插件目录被整体删除/重装，用户配置仍然保留。

```json
{
  "name": "hello",
  "version": "1.1.0",
  "config": {
    "greeting": "你好",
    "limit": 5,
    "nested": { "enabled": true }
  },
  "commands": [{ "name": "hello", "handler": "hello" }]
}
```

```javascript
module.exports = {
    async hello(args, context) {
        const cfg = context.pluginConfig;      // 没有 pluginName 时为 null，记得判空
        if (!cfg) return;

        console.log(`${cfg.get('greeting', 'hi')}，限制 ${cfg.get('limit')}`);
        await cfg.set('limit', 10);            // 原子写盘，返回 Promise
        await cfg.merge({ nested: { enabled: false } });  // 深合并
    }
};
```

API：

| 方法 | 说明 |
|------|------|
| `all()` | 当前生效配置（默认值 ← 磁盘值，深合并） |
| `get('a.b', fallback)` | 点号路径取值 |
| `set('a.b', value)` | 点号路径写入，**原子**落盘 |
| `merge(obj)` | 深合并一批键 |
| `reset()` | 恢复 `plugin.json` 里的默认值 |
| `exists()` | 是否已有落盘文件 |
| `file` | 配置文件绝对路径（只读） |

四条实现约束（`core/src/plugin_config.js`）：

1. **路径不许穿越**。插件名必须是单段名称（`..`、`/`、`\`、盘符一律拒绝），
   解析结果还必须严格落在 `core/plugin-config/` 之内。
   配置键也过滤 `__proto__` / `constructor` / `prototype`，防原型污染。
2. **写入原子**。同目录临时文件 → `fsync` → `rename` 覆盖。
   `rename` 在同一文件系统内是原子的：断电后你只会看到旧内容或新内容，
   不会看到写了一半的 JSON。同一进程内的并发 `set` 会串行执行。
3. **坏文件不拖垮插件**。`config.json` 被手改成非法 JSON 时，
   原文件会被备份成 `config.json.corrupt-<时间戳>`，读取退回默认值。
4. **默认值随代码走**。插件升级新增了默认键，用户旧配置里没有，
   `all()` 会自动补上（磁盘值优先）。

---

## 插件 Web UI（实验性 / Beta）

插件可以在 `plugin.json` 里用 `web` 声明一个前端目录：

```json
{
  "name": "hello",
  "web": "frontend",
  "commands": [{ "name": "hello", "handler": "hello" }]
}
```

**默认不启用**。需要在 `wow.yaml` 里显式打开：

```yaml
web:
  allow_plugins_web: true      # 对应文档里的 allow-plugins-web
```

或 `wow config set web.allow_plugins_web true`，然后在 Web 面板「设置 → 高级管理 → 插件」里
点该插件的「打开界面」。

### 它是怎么挂上的

| 环节 | 行为 |
|------|------|
| 端口 | **绝不新开端口**。挂在主面板同源 `/plugin-web/<插件名>/` |
| 复制 | 启动时把 `frontend/` 复制到 `core/plugin-web/<插件名>/`，**全量重建** |
| 静态根 | Express 只认复制出来的目录，插件目录本身从不对外 |
| 默认值 | `web.allow_plugins_web: false`，关掉时会清空 `core/plugin-web/` |

为什么必须复制：插件目录里同时躺着 `index.js` 和可能的密钥文件。
直接把插件目录当静态根，等于把服务端代码当静态资源发出去。

复制时还会跳过：**符号链接**（防链到 `/etc/passwd`）、**隐藏文件**（`.env` / `.git`）、
单文件 > 5MB、单插件总量 > 20MB、层级 > 8 层。超限只跳过对应文件/插件并记日志。

### 强制 CSP

`/plugin-web/*` 的所有响应都带：

```
Content-Security-Policy: frame-ancestors 'self'; connect-src 'self';
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

- `frame-ancestors 'self'`：插件页面不能被外站 iframe 嵌套（防点击劫持）；
- `connect-src 'self'`：页面里的 `fetch` / `XHR` / `WebSocket` 只能打到本站，
  没法把登录 Token 发到第三方。

### 面板里的 iframe 必须带 sandbox

主面板打开插件界面时用的是：

```html
<iframe src="/plugin-web/hello/"
        sandbox="allow-scripts allow-forms allow-popups"
        referrerpolicy="no-referrer"></iframe>
```

**没有** `allow-same-origin`：iframe 里是 opaque origin，读不到父页面的
`localStorage` / cookie / JWT。插件前端若需要数据，请让用户重新登录，
或通过 `postMessage` 与父页面约定协议（父页面自行校验来源）。

> ⚠️ `sandbox` 只在面板的 iframe 里生效。用户直接在新标签页打开
> `/plugin-web/hello/` 时它是同源的——这正是 `allow_plugins_web` 默认关闭的原因。

---

## 目录结构

除根目录必须有 `plugin.json` 和 `index.js` 外，其余结构完全自由。

```bash
hello/
├── plugin.json          # 必需
├── index.js             # 必需（入口）
├── lib/                 # 可选，随便组织
│   └── helper.js
├── assets/
│   └── data.json
└── frontend/            # 可选，声明 "web": "frontend" 后才对外
    └── index.html
```

插件运行后会涉及三个**独立于插件目录**的位置：

```bash
core/plugin-config/hello/config.json   # 插件配置（卸载插件也不删）
core/plugin-web/hello/                 # 复制出来的前端资源（每次启动重建）
core/.plugins.trust.json               # 信任表（内容指纹）
```

```javascript
// index.js —— 可以正常 require 同目录下的其它文件
const helper = require('./lib/helper.js');

module.exports = {
    async hello(args, context) {
        console.log(helper.greet(args[args.length - 1].name));
    }
};
```

### 关于 `node_modules`

插件可以自带依赖：在插件目录里 `npm install`，wow 不会替你装。

`node_modules/` 与 `.git/` **不参与内容指纹计算**——否则「装没装依赖」会改变插件身份，
每次 `npm install` 都要重新确认一遍，这显然不合理。

---

## 管理命令

```bash
wow plugin list                # 列出插件 + 信任状态（✅ 已信任 / ⏳ 未信任 / ⚠️ 已变更）
wow plugin info <name>         # 详情：作者、版本、命令一览、信任状态
wow plugin install <source>    # 安装（ZIP 或目录），-f/--force 覆盖同名
wow plugin remove <name>       # 卸载（删目录 + 撤销信任记录）
wow plugin trust <name>        # 信任（记录当前内容指纹）
wow plugin untrust <name>      # 撤销信任（下次启动重新询问）
wow plugin path                # 打印插件目录与信任表位置
```

### 信任状态三态

| 状态 | 含义 | 启动时行为 |
|---|---|---|
| `⏳ 未信任` | 从没同意过 | 终端里询问；非交互环境跳过 |
| `✅ 已信任` | 指纹与记录一致 | 直接加载 |
| `⚠️ 已变更` | 有记录但指纹变了 | 重新询问（当作新插件对待） |

### 信任表在哪

`core/.plugins.trust.json`（已加入 `.gitignore`，属本机运行时状态，不进版本库）：

```json
{
  "version": 1,
  "plugins": {
    "hello": {
      "fingerprint": "sha256:865469a04969d522c13db21b329b797d4620eb63bb113c4bcfc91618b8104487",
      "trusted_at": "2025-01-02T03:04:05.000Z"
    }
  }
}
```

指纹算法：目录递归取文件 → 路径统一为 `/` 分隔并按小写排序 → `相对路径\0sha256(内容)`
逐个拼接 → 整体再 sha256。跳过的目录：`node_modules` / `.git` / `.svn`。
超过 2MB 的文件只取「大小 + 首尾各 4KB」，避免大文件把启动拖慢。

---

## 加载机制（当前实现）

CLI 每次启动时：

1. 读配置 `plugins.enabled_loader`（默认 `true`）。为 `false` 则完全不碰 `wow-plugins/`。
2. 扫描 `<项目根>/wow-plugins/` 下含 `plugin.json` 的子目录（跳过 `.` 开头的隐藏目录）。
3. 按目录名排序，逐个处理：
   - 读 `plugin.json` → 结构校验；
   - 算内容指纹 → 查信任表 → 未信任则走确认流程；
   - `require(index.js)` → **失败则提示「插件 X 崩溃，已跳过」**；
   - 检查每个 handler 是否真的导出 → 缺失同样整插件跳过；
   - 逐条注册命令（名字冲突则整插件跳过）。
4. 注册完成后再解析 `program.parse(process.argv)`。

因此：**插件命令必须在 `parse` 之前注册**，否则 commander 会报 `unknown command`。
无参数进入数字菜单的分支同样会先注册，这样菜单和长命令 REPL 里敲插件命令也能用。

### 加载顺序

按**目录名**排序，不按 `plugin.json` 里的 `name`。插件之间不应有执行顺序依赖——
它们共享同一个目录与同一个进程。

### 崩溃隔离

| 崩溃点 | 表现 |
|---|---|
| `plugin.json` 不是合法 JSON | 跳过该插件，warn 一行 |
| `index.js` require 时抛错 / 语法错误 | `❌ 插件 X 崩溃，已跳过：<原因>`，其它插件照常加载 |
| handler 名对不上 | `❌ 插件 X 崩溃，已跳过：index.js 缺少处理函数：a, b` |
| 注册阶段抛错（非法 option、重复命令） | `❌ 插件 X 注册失败，已跳过` |
| handler 运行期同步抛错 / `await` 到的 reject | 终端只显示 `插件内部错误：wow Y 执行失败。请查看日志或联系插件作者。`；详细堆栈写日志，进程继续，退出码置 1 |
| 信任指纹计算抛错（目录权限等） | `❌ 插件 X 加载异常，已跳过（不影响主程序）`，整轮加载不中断 |
| 命令名冲突 | `⚠️ 插件 X 已跳过：命令名冲突：...` |

**整轮加载用 try...catch 兜住每个插件**，包括我们没预料到的第三方异常。
一个坏插件换来的是一次跳过 + 一条日志，而不是 wow 启动失败。

**对外只说「插件内部错误」**：插件抛出的 message 可能带内部路径、SQL、密钥片段，
不该直接呈现在终端或 Web 面板上；完整堆栈只进日志。

**上表只覆盖「加载期」和「handler 执行期」。** 插件是同进程 `require` 的，
所以下面这些**兜不住**——它们不是被隔离，而是根本不在被监视的栈上：

| 兜不住的情况 | 后果 |
|---|---|
| `process.exit()` / `process.abort()` | **主程序立刻退出**，退出码就是插件给的值 |
| `setTimeout` / 事件回调里**同步** throw | 被全局 `uncaughtException` 钩子接住，记一条 `ERRO` 后进程继续。**但那次操作已经半途而废** |
| 未 `await` 的 Promise 被 reject | V3.7.5 起由 `installRejectionGuard()` 接管：记日志，**进程不退出**（Node 15+ 默认会直接终止）。`WOW_STRICT_PROMISE=1` 可关掉护栏 |
| 死循环 / 长时间同步阻塞 | 整个 wow 卡死，面板与 CLI 一起无响应 |
| 内存泄漏 | 拖着主程序一起 OOM |
| 改 `global` / `process.env` / 内置原型 | 直接污染主程序和其它插件，且**无法回滚** |

> ⚠️ 对长期运行的 `wow web start` 尤其要留意：面板进程被插件 `process.exit` 带走时，
> 由它管理的 MC 服务端可能变成孤儿进程继续占着端口，需要手动清理。

插件系统是可选扩展点，**但「插件坏了 wow 必须照常能用」只对受控的异常成立**，
对上面这五类不成立。装插件前请把它当成「往主程序里加代码」看待，而不是「装个扩展」。

---

## Web 端与开服控制台

### Web 面板

插件命令默认**禁止**经 Web 面板执行：

```
插件命令 hello 默认禁止在 Web 端执行（如需放开，请在配置中设置 web.allow_plugins: true）
```

要放开，在 `wow.yaml` 里：

```yaml
web:
  allow_plugins: true
```

或者在面板「设置 → Web 面板 → 允许执行插件命令」里打开（该项标注为危险）。

> ⚠️ 打开这个开关，等于让任何能登录面板的人通过插件执行**任意代码**。
> 面板对外暴露时必须配合强密码/HTTPS，且只装你自己审过的插件。

打开后 `web_service` 启动时会打印一条警告（见 `auditDangerousConfig`）。

**插件 Web UI 是另一个独立开关**，默认也关闭：

```yaml
web:
  allow_plugins_web: true      # 对应 allow-plugins-web
```

打开后，「设置 → 高级管理 · 插件」里声明了 `web` 的插件会多出一个「打开界面」按钮，
点击后在 sandbox iframe 里打开 `/plugin-web/<插件名>/`。关闭时该目录会被清空，
避免旧版本的页面继续可访问。详见
[插件 Web UI（实验性 / Beta）](#插件-web-ui实验性--beta)。

### 开服控制台

`wow server start` 的交互终端里输入插件命令会被**显式拒绝**：

```
插件命令 hello 不提供在开服控制台中执行，请另开终端运行
```

而不是转发给 Minecraft 服务端。这一条很重要——`classifyConsoleInput` 原本用
「命令头是否属于 wow 命名空间」来区分 wow 指令和 MC 指令，插件命令是运行期才知道的，
不在那个常量里，如果不显式拦截就会变成「游戏里报 unknown command」，非常难查。

---

## 完整示例

目录：`wow-plugins/hello/`

**`plugin.json`**

```json
{
  "name": "hello",
  "version": "1.0.0",
  "author": "wow Team",
  "description": "打招呼 + 查看服务器状态",
  "commands": [
    {
      "name": "hello",
      "description": "打招呼",
      "options": [
        { "flag": "-n, --name <name>", "description": "名字" },
        { "flag": "-c, --count <number>", "description": "重复次数" }
      ],
      "handler": "hello"
    },
    {
      "name": "hello-status",
      "description": "查看服务器状态",
      "handler": "status"
    }
  ]
}
```

**`index.js`**

```javascript
module.exports = {
    async hello(args, context) {
        const opts = args[args.length - 1] || {};
        const name = opts.name || 'World';
        const count = Math.max(1, parseInt(opts.count, 10) || 1);
        for (let i = 0; i < count; i++) {
            console.log(`👋 Hello, ${name}!`);
        }
    },

    async status(args, context) {
        // 判空：某个能力在当前环境不可用时为 null，不要直接解引用
        if (!context.server) {
            console.error('服务器模块不可用');
            return;
        }
        const s = context.server.status();
        console.log(`服务器状态：${s.running ? '运行中' : '已停止'}`);
        console.log(`当前方案：${context.config.getConfig('server.scheme', '(未设置)')}`);
    }
};
```

**使用**

```bash
$ wow plugin install ./hello
✅ 插件 hello v1.0.0 已安装到 /path/to/wow/wow-plugins/hello
   下次执行 wow 命令时会询问是否信任并加载。

$ wow plugin trust hello
✅ 已信任插件 hello

$ wow hello -n Steve -c 3
👋 Hello, Steve!
👋 Hello, Steve!
👋 Hello, Steve!

$ wow hello-status
服务器状态：已停止
当前方案：survival
```

---

## 打包与分发

```bash
# 1. 确保根目录有 plugin.json 和 index.js
# 2. 打包（不要把 node_modules 打进去，让别人自己 npm install）
zip -r hello.zip hello/ -x "hello/node_modules/*"
```

接收方：

```bash
wow plugin install ./hello.zip
wow plugin list          # 确认装上了，状态是 ⏳ 未信任
wow plugin trust hello   # 或者下次运行插件命令时在提示里按 y
```

**wow 不验证插件来源**，没有签名、没有中心仓库。
分发时要自己讲清楚插件会读写什么；接收方要自己判断是否信任。
`plugin install` 只做两件事：断言是 ZIP（文件头 `PK`）、断言有合法 `plugin.json`。

---

## 注意事项

1. **不能覆盖内置命令**：`wow server start` 之类的行为不会被插件改变。
2. **不保证 API 稳定**：`context` 里的管理器方法随 wow 版本演进可能变化。用了非公开方法（比如访问 `context.scheme.poolIndex` 这种私有字段）的插件，升级后可能坏。
3. **启动开销**：插件在每次 CLI 启动时都会被扫描并加载。装几十个插件会明显拖慢 `wow --help`。不用时用 `plugins.enabled_loader: false` 全部关掉。
4. **依赖自理**：需要 npm 包就在插件目录里 `npm install`，wow 不会自动装。
5. **别污染全局**：不要改 `global`，不要改 `Array.prototype` 这类原型，会影响主程序和其它插件。
6. **别抢 stdin**：插件命令在 CLI 前台运行，如果它开 readline 或长驻循环，会霸占终端。需要交互就用 `context` 之外自己的方案，并明确告知用户怎么退出。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `wow-plugins/` | 插件目录（项目根，已在 `.gitignore`） |
| `core/.plugins.trust.json` | 信任表（已 `.gitignore`） |
| `core/src/plugin_loader.js` | 扫描 / 信任 / 注册命令 |
| `core/src/plugin_context.js` | context 构造（10 个能力的懒加载注入） |
| `core/src/plugin_trust.js` | 内容指纹与信任表读写 |
| `core/src/plugin_manager.js` | 安装 / 卸载 / 列表 / 详情 |
| `core/src/command_policy.js` | Web 端插件命令管控（`RUNTIME_PLUGIN_CMDS`） |

**祝你开发出有用的插件！🔌**
