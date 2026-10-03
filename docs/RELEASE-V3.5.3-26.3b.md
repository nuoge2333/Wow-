# V3.5.3-26.3b 发布说明（安全整改）

> 本版本针对一份第三方安全/工程质量审查报告，落地全部**高危**与**易改中危**问题的整改。
> 取向：**安全优先，不为新手便利牺牲服务器安全。**

## 版本号
`V3.5.3-26.3b` = 语义版本 `3.5.3` ｜ 年份后两位 `26`（2026）｜ 十六进制第 59 个发行包（`0x3b` = 59）

## 修复清单

### 🔴 高危-1：Web `/api/exec` 与 WebSocket 无命令限制
- 新增 `core/src/command_policy.js` 导出 `isWebCommandAllowed()`，对 `/api/exec` 与 WebSocket `command` 共用。
- **Web 端禁止**：`scheme delete/create/switch/edit/pull/prune/register/export/import`、`mod remove/sync/toggle`、`pack install`、`web start`、`logs tail`、`init`、以及 `install <远程 http(s) 地址>` 与 `config` 写入形态。
- **放行**：面板正常使用的 `server start/stop/restart/kill`、`scheme list/info/status`、`mod list/install`、`theme *`、`plugin *`、`set *`、`pack generate`、`install <本地文件>`、`config` 只读等。
- 设计取舍：审查建议「复用开服控制台 ALLOWED 集合」会禁掉 `server start`、且会挡掉面板自己的 `mod install`/`theme install`，故采用**拒绝清单**而非白名单。

### 🔴 高危-2：未配 SMTP 时验证码随响应泄露（登录绕过）
- 生产环境（`web.dev_mode=false` 且非 `NODE_ENV=development`）未配 SMTP 时，`/api/auth/request-code` **不再回显验证码**，改返回 `403` 并提示「请先在终端配置 SMTP 或设置离线密码（web.auth_password）后再登录」。
- 新增**离线密码登录**：配置 `web.auth_password`（scrypt 哈希存储，明文首次使用即哈希持久化），登录接口支持密码登录，作为不配 SMTP 时的合法替代。

### 🔴 高危-3：`update.sh` 无校验的远程覆盖
- 下载后先做 `unzip -tq` 完整性测试，失败即拒绝覆盖。
- 尝试从同源获取 `SHA256SUMS` 清单校验 zip 哈希，不符则拒绝覆盖（供应链 RCE 面收敛）。
- 建议：发版时随 tag 附带 `SHA256SUMS`。

### 🟡 中危-4：`utils.js` 命令注入模式
- `execSync(\`which ${cmd}\`)` 等模板插值改为 `execFileSync` / `spawnSync`，消除潜在注入面（当前参数均硬编码，暂不 exploit）。

### 🟡 中危-5：WebSocket CORS `origin: '*'`
- 改为可配置 `web.cors_origins`（默认空 = 仅同源）；跨域部署时显式设置白名单。

### 🟡 中危-6/7：密钥明文落盘
- `web.auth_token` 优先读环境变量 `WOW_WEB_AUTH_TOKEN`。
- SMTP 凭据 `user`/`pass` 支持 `WOW_MAIL_SMTP_USER` / `WOW_MAIL_SMTP_PASS`。

## 配置新增（兼容旧配置，默认关闭/空）
```yaml
web:
  dev_mode: false        # 仅开发时设为 true，未配 SMTP 才回显验证码
  auth_password: null    # 离线密码（scrypt 哈希），不配 SMTP 时的替代登录
  cors_origins: []       # 跨域白名单，空=仅同源
```

## 验证
- `node --check` 全部改动文件通过；`bash -n update.sh` 通过。
- `command_policy` 单元测试 32 项全过（覆盖允许/拒绝边界，含 `wow` 前缀剥离、`install` 远程 vs 本地、config 写入形态）。
- `utils.commandExists` / `detectJava` 实测无回归；`mailer` 环境变量覆盖实测生效；`web_service` 模块可正常加载（不自动起服务）。

## 未做（留后续）
- 补 `test/` 或删除空头 `test` 脚本、接入 ESLint/CI、拆分超大模块、补全占位实现（plugin install 等）、清理死代码。
