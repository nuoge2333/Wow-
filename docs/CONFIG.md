# ⚙️ 配置参考 (wow.yaml)

> wow 的所有配置集中在 `core/wow.yaml` 文件中，采用 YAML 格式。

> 📌 **命令引导词说明（重要）**
> 本文档中所有以 `wow` 开头的命令都是**简写**，实际执行时请按你的操作系统替换为对应的启动脚本：
>
> | 操作系统 | 文档写法 | 实际执行 |
> |----------|----------|----------|
> | **Linux / macOS** | `wow config ...` | `./wow.sh config ...` |
> | **Windows** | `wow config ...` | `wow.bat config ...` |

---

## 配置文件位置

```
core/wow.yaml
```

首次运行 `wow init` 时自动生成默认配置。

---

## 修改配置

### 方式一：命令行（推荐）

```bash
# 查看配置项
wow config wow server.dir

# 设置配置项
wow config wow server.dir ./my_server

# 快捷方式
wow set server.dir ./my_server
```

### 方式二：手动编辑

直接用文本编辑器打开 `core/wow.yaml` 修改，保存后需要重启生效。

---

## 配置项详解

### 顶层配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | string | `zh_CN` | 语言设置（当前仅支持中文） |
| `verbose` | boolean | `false` | 是否输出详细日志 |
| `auto_scheme` | boolean | `true` | 是否自动管理方案状态（切换时补齐/瘦身） |

---

### `server` — 服务器设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dir` | string | `../../server` | 服务器实例目录 |
| `jar` | string | `null` | 指定服务端 jar 文件名（`null` 自动检测） |
| `java` | string | `null` | Java 可执行文件路径（`null` 自动检测或下载） |
| `jvm_args` | array | `["-Xmx2G", "-Xms2G", "-XX:+UseG1GC"]` | 默认 JVM 参数 |
| `version` | string | `null` | 当前方案 Minecraft 版本（自动记录） |
| `type` | string | `null` | 当前方案核心类型（自动记录） |
| `scheme` | string | `null` | 当前激活的方案名称（自动记录） |

**示例：**
```yaml
server:
  dir: ../../server
  jar: null
  java: null
  jvm_args:
    - -Xmx4G
    - -Xms4G
    - -XX:+UseG1GC
```

---

### `download` — 下载设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mirror` | string | `https://bmclapi2.bangbang93.com` | 下载镜像源 |
| `timeout` | integer | `30` | 下载超时（秒） |
| `retry` | integer | `3` | 下载失败重试次数 |

**可用镜像：**
- `https://bmclapi2.bangbang93.com` — BMCLAPI2（国内推荐）
- `https://launcher.mojang.com` — Mojang 官方源

**示例：**
```yaml
download:
  mirror: https://bmclapi2.bangbang93.com
  timeout: 60
  retry: 5
```

---

### `mod` — 模组设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `auto_dependencies` | boolean | `true` | 是否自动安装模组依赖 |
| `sources` | array | `["curseforge", "modrinth"]` | 模组搜索来源 |

**示例：**
```yaml
mod:
  auto_dependencies: true
  sources:
    - curseforge
    - modrinth
```

---

### `backup` — 备份设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dir` | string | `../../server/backups` | 备份存储目录 |
| `auto` | boolean | `false` | 是否自动备份 |
| `max` | integer | `5` | 保留的最大备份数 |

**示例：**
```yaml
backup:
  dir: ../../server/backups
  auto: true
  max: 10
```

---

### `web` — Web 面板设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | integer | `8080` | Web 服务监听端口 |
| `host` | string | `127.0.0.1` | 绑定地址（`0.0.0.0` 允许远程访问） |
| `auth_token` | string | `null` | 自定义 JWT 密钥（`null` 自动生成） |
| `run_startup` | boolean | `true` | 是否随 CLI 自动启动 Web 服务 |
| `theme` | string | `default` | 当前激活的主题包名称 |
| `session_timeout` | integer | `86400` | 登录会话有效期（秒），默认 24 小时 |
| `dev_mode` | boolean | `false` | 开发模式（开启后暴露调试信息） |
| `cors_origins` | array | `[]` | 允许的跨源域名白名单；空数组 = 仅同源 |
| `allow_scheme_ops` | boolean | `false` | 🔺 **V3.5.7** 放开 `scheme create/switch/delete/edit/pull/prune/register/export/import` |
| `allow_remote_install` | boolean | `false` | 🔺 **V3.5.7** 放开 `install <http(s)://...>` 远程下载（等同任意代码执行入口） |

**示例：**
```yaml
web:
  port: 8080
  host: 0.0.0.0
  auth_token: null
  run_startup: true
  theme: dark
  session_timeout: 86400
  cors_origins: []
  allow_scheme_ops: false
  allow_remote_install: false
```

> ⚠️ 将 `host` 设为 `0.0.0.0` 会允许外部 IP 访问，请确保已配置防火墙或设置 `auth_token`。

> 🔒 **关于 `allow_scheme_ops` / `allow_remote_install`**
> 默认均为 `false`，保持安全基线。开启 `allow_remote_install` 相当于把任意代码执行入口
> 暴露给 Web 面板访问者，请仅在完全可信的网络环境中开启。
> 若同时开启危险开关 + 监听 `0.0.0.0` + `dev_mode: true`，启动日志会打印安全提示。
> 无论如何，`init`、`mod remove/sync/toggle`、`pack install`、`web start`、`logs tail`
> 这五项在 Web 端**永久禁用**，不受配置影响。

---

### `mail` — 邮件设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `smtp` | object | `{}` | SMTP 服务器配置 |
| `smtp.host` | string | `null` | SMTP 服务器地址（如 `smtp.gmail.com`） |
| `smtp.port` | integer | `587` | SMTP 端口（587 或 465） |
| `smtp.user` | string | `null` | SMTP 用户名（邮箱地址） |
| `smtp.pass` | string | `null` | SMTP 密码或应用专用密码 |
| `smtp.from` | string | `null` | 发件人邮箱地址 |
| `admin_email` | string | `null` | 管理员邮箱（接收崩溃报告） |
| `whitelist` | array | `[]` | **Web 面板登录邮箱白名单**（V3.5.8）。仅名单内邮箱可获取验证码并登录；空数组 = 不限制；含 `"*"` = 放开所有 |
| `send_on_crash` | boolean | `true` | 是否在服务器崩溃时发送邮件通知 |
| `send_logs_interval` | integer | `0` | 定时发送日志摘要（小时），`0` 禁用 |

**示例：**
```yaml
mail:
  smtp:
    host: smtp.gmail.com
    port: 587
    user: myemail@gmail.com
    pass: abcd efgh ijkl mnop
    from: myemail@gmail.com
  admin_email: admin@example.com
  whitelist:
    - admin@example.com
    - friend@example.com
  send_on_crash: true
  send_logs_interval: 24
```

> 🔐 **`whitelist` 用法**（V3.5.8 新增）
>
> - 只有列表内的邮箱才能请求登录验证码、并换取 Web 面板的 token；
>   名单外的邮箱在 `/api/auth/request-code` 阶段就直接返回 403，**不会生成验证码**。
> - 大小写不敏感：配置写 `Admin@Example.com`，用 `admin@example.com` 登录同样放行。
> - 留空（`whitelist: []`）= 不限制，行为与 V3.5.7 完全一致。
> - 写 `- "*"` = 放开所有邮箱（等价于不限制，仅用于明确表态）。
> - 除 YAML 列表外，也接受逗号分隔字符串：`whitelist: "a@b.com, c@d.cn"`。
> - 兼容 `mail.WhiteList` / `mail.whiteList` 写法（主键 `whitelist` 优先）。

> 💡 Gmail 需要使用 **应用专用密码**，不是登录密码。

---

### `ai` — AI 日志分析设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `api_key` | string | `null` | AI API 密钥 |
| `model` | string | `null` | 模型名称（如 `gpt-3.5-turbo`） |
| `api_url` | string | `null` | API 端点（默认使用 OpenAI 兼容接口） |

**示例：**
```yaml
ai:
  api_key: sk-xxxxxxxxxxxxxxxxxxxxxxxx
  model: gpt-3.5-turbo
  api_url: https://api.openai.com/v1/chat/completions
```

---

### `auth` — 外置登录设置 (authlib-injector)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enable` | boolean | `false` | 是否启用外置登录 |
| `javaagent` | string | `null` | 自定义 `-javaagent` 路径（`null` 自动下载） |
| `server` | string | `null` | 认证服务器地址（如 LittleSkin） |
| `auto_download` | boolean | `true` | 是否自动下载 `authlib-injector.jar` |

**示例：**
```yaml
auth:
  enable: true
  javaagent: null
  server: https://littleskin.cn/api/yggdrasil
  auto_download: true
```

---

### `plugins` — wow 插件设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | integer | `9000` | 插件通信端口（预留） |
| `enabled` | boolean | `false` | 是否启用插件服务 |

---

### `pool` — 资源池路径

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dir` | string | `pool` | 资源池根目录（位于 core/ 内） |
| `cores` | string | `pool/cores` | 核心存储路径 |
| `mods` | string | `pool/mods` | 模组存储路径 |
| `plugins` | string | `pool/plugins` | 插件存储路径 |
| `loader` | string | `pool/loader` | 加载器存储路径 |

一般不需要修改。

---

### `jre` — JRE 设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dir` | string | `jre` | JRE 存储路径（位于 core/ 内） |
| `auto_download` | boolean | `true` | 是否按需自动下载 JRE |
| `version` | string | `null` | 锁定 Temurin 完整版本号（如 `17.0.12+7`）；`null` 自动取该特征版本的最新 GA |

#### Java 版本选择逻辑（V3.5.7）

启动服务器 / 安装核心时按以下优先级确定 Java：

1. **`server.java`** — 用户显式配置的路径（最高优先，不做版本校验，只在不匹配时告警）
2. **系统扫描** — 遍历 PATH、`JAVA_HOME`、系统包、IDE 目录、版本管理器，
   按 `Minecraft 版本 → 所需 Java 版本` 精确匹配
3. **内置 JRE** — `core/jre/<特征版本>/bin/java`
4. **自动下载** — 以上都没有时，从 Eclipse Temurin 下载对应版本

**Minecraft 版本与 Java 要求的对应关系：**

| Minecraft | 所需 Java |
|-----------|-----------|
| ≤ 1.16.5 | Java 8 |
| 1.17 ~ 1.20.4 | Java 17 |
| ≥ 1.20.5 | Java 21 |

**版本允许的替代关系（仅 LTS 向上兼容）：**

| 需要 | 可用替代 |
|------|----------|
| Java 8 | ❌ 不可向上替代（Java 9+ 移除了大量 API） |
| Java 11 | Java 17 / 21 |
| Java 17 | Java 21 |
| Java 21 | ❌ 不可向下替代 |

> 非 LTS 版本（如 Java 20）不会被用来替代 LTS 需求。
> 若本机没有匹配版本且 `auto_download: false`，则直接报错而不是硬用错版本。

**扫描来源一览：**

| 平台 | 覆盖路径 |
|------|----------|
| 通用 | `PATH`、`JAVA_HOME`、mise / rtx / sdkman / asdf / jabba、`~/.jdks` |
| Linux | `/usr/lib/jvm`、`/usr/java`、`/opt/java`、`/opt/jdk` |
| macOS | `/Library/Java/JavaVirtualMachines`、Homebrew（`/opt/homebrew/opt/openjdk@17` 等） |
| Windows | `Program Files\Java`、`Eclipse Adoptium`、`Corretto`、`Zulu`、`BellSoft`、`Semeru`、`Microsoft` |

在菜单 **11 → 1** 中可查看扫描结果并交互式选择。

---

## 完整配置示例

```yaml
language: zh_CN
verbose: false
auto_scheme: true

server:
  dir: ../../server
  jar: null
  java: null
  jvm_args:
    - -Xmx4G
    - -Xms4G
    - -XX:+UseG1GC
  version: null
  type: null
  scheme: null

download:
  mirror: https://bmclapi2.bangbang93.com
  timeout: 30
  retry: 3

mod:
  auto_dependencies: true
  sources:
    - curseforge
    - modrinth

backup:
  dir: ../../server/backups
  auto: true
  max: 10

web:
  port: 8080
  host: 127.0.0.1
  auth_token: null
  run_startup: true
  theme: default
  session_timeout: 86400

mail:
  smtp:
    host: null
    port: 587
    user: null
    pass: null
    from: null
  admin_email: null
  whitelist: []
  send_on_crash: true
  send_logs_interval: 0

ai:
  api_key: null
  model: null
  api_url: null

auth:
  enable: false
  javaagent: null
  server: null
  auto_download: true

plugins:
  port: 9000
  enabled: false

pool:
  dir: pool
  cores: pool/cores
  mods: pool/mods
  plugins: pool/plugins
  loader: pool/loader

jre:
  dir: jre
  auto_download: true
```

---

## 配置生效说明

| 修改项 | 生效方式 |
|--------|----------|
| `server.jvm_args` | 下次启动服务器时生效 |
| `server.java` | 下次启动服务器时生效 |
| `web.port` / `web.host` | 重启 Web 服务生效（`wow web stop` 后 `wow web start`） |
| `web.theme` | 执行 `wow theme switch` 后立即生效 |
| `download.mirror` | 下次下载时生效 |
| `mail.*` | 下次发送邮件时生效 |
| `ai.*` | 下次执行 `logs analyze` 时生效 |
| `auth.*` | 下次启动服务器时生效 |
| `auto_scheme` | 下次执行 `scheme switch` 时生效 |
| 其他配置项 | 重启 wow 生效 |