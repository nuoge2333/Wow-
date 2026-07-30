# 🛠️ Android (Termux) 故障排除

> 适用于在 Android 手机上通过 Termux 运行 wow~

---

## 前置条件

- 从 **F-Droid** 或 <https://termux.dev> 安装 Termux（**不要用 Google Play 版**，已停止维护）。
- 首次进入 Termux 先执行 `pkg update && pkg upgrade -y`，再 `pkg install nodejs` 提供 Node.js（wow~ 也会尝试自动调用 `pkg` 安装）。
- 把 wow~ 压缩包传到手机，用 `unzip` 解压到下载目录或 Termux 的家目录。

---

## 常见问题分类

- [启动问题](#启动问题)
- [Node.js / OpenSSL 问题](#nodejs--openssl-问题)
- [服务器与挂机问题](#服务器与挂机问题)
- [显示问题](#显示问题)

---

## 启动问题

### Q: 提示 `wow: command not found`（找不到命令）

**原因：** `wow` 不是系统命令，`start.sh` 不注册它。Termux 下推荐用透传方式。

**解决（推荐第①种）：**

1. **透传（最省事）：** `cd` 到 wow 目录后把 `wow` 换成 `./start.sh`：
   ```bash
   ./start.sh init
   ./start.sh server start --memory 2G
   ./start.sh web start
   ```
2. **注册：** `cd core && npm link`，之后 `wow init`（需 Node 已在 PATH，Termux 默认满足）。
3. **临时：** `cd core && npx wow init`

> 详见 [QUICKSTART.md](QUICKSTART.md) 的「2.5 怎么运行 wow 命令」。

---

### Q: 运行 `./start.sh`（不带参数）后立刻退出

**原因：** 正常现象。交互终端里无参数会打印帮助后退出，不是崩溃。开服要用 `./start.sh server start`。

---

## Node.js / OpenSSL 问题

### Q: 运行 `node` / `npm` 报 `CANNOT LINK EXECUTABLE "node": cannot locate symbol "OSSL_PROVIDER_add_conf_parameter"`

**原因：** Termux 里的 Node.js 是用较新版本的 OpenSSL 编译的，但设备上残留的旧版 `libcrypto` 缺少这个符号。常见于 Node 22/26 配老 OpenSSL 的环境。

**解决：** 升级 OpenSSL 和 Node.js 到匹配版本：

```bash
pkg update && pkg upgrade -y
pkg reinstall -y openssl nodejs
```

重装后 `node -v` 能正常输出版本号即修复。若仍报错，重启一下 Termux 再试。

---

### Q: 提示 "node: command not found" 或 wow~ 卡在下载 Node.js

**原因：** Termux 里没有 Node.js，且自动 `pkg install` 因网络或权限失败。

**解决：**

```bash
pkg update && pkg upgrade -y
pkg install -y nodejs
node -v   # 确认有输出
```

确认 Node.js 可用后，再运行 `./start.sh init`。

---

## 服务器与挂机问题

### Q: 手机息屏 / 切后台后服务器被杀死

**原因：** Android 的后台限制会回收进程，Termux 也不例外。

**解决：**
- 在 Termux 里执行 `termux-wake-lock` 申请唤醒锁（保持前台时有效）。
- 系统设置里把 Termux 设为「不受电池优化限制」。
- **长期挂机不建议用手机**：用带公网 IP 的云服务器更稳，且不受运营商 Docker 沙箱「进程退出 = 资源释放」的限制（详见下方说明）。

> 💡 关于「挂机模式」：部分面板服务商使用 Docker 沙箱，一旦你的启动脚本进程退出，服务商会释放全部内存，相当于整台机器「关机」。因此用于挂机的入口进程（如 `start.sh` → `./start.sh server start`）必须**一直保持运行**，不要后台杀掉它。

---

### Q: 启动服务器提示内存不足（Out Of Memory）

**原因：** 手机内存有限，默认 2G 可能仍然吃紧，或同时开了很多 App。

**解决：** 显式给更小内存，并关闭其他 App：

```bash
./start.sh server start --memory 1G
```

---

## 显示问题

### Q: 终端中文乱码 / 方块

**解决：**
- 安装 `tmux` 后在里面运行：`pkg install tmux && tmux`，再执行 `./start.sh ...`。
- 或在 Termux 设置里把字体改为支持中文的字体（如 Noto）。

---

## 与桌面版的主要区别

| 项目 | 桌面版（Win/Linux/macOS） | Termux（Android） |
|------|---------------------------|-------------------|
| Node.js 来源 | 脚本自动下载便携版 | 由 `pkg` 提供 |
| 适合长期挂机 | 是 | 不推荐（手机后台限制） |
| 性能上限 | 取决于电脑 | 取决于手机 CPU / 内存 |
| 外网访问 | 直接端口转发 | 需内网穿透或云服务器 |

---

## 仍然无法解决？

收集并贴出以下信息，提交到 Issue 或社区：

```bash
node -v
npm -v
uname -a
# 报错截图
```
