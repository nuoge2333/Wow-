# 🛠️ Debian / Ubuntu 故障排除

> 适用于 Debian、Ubuntu 及其衍生发行版（如 Linux Mint、Pop!_OS）

---

## 常见问题分类

- [启动问题](#启动问题)
- [服务器启动问题](#服务器启动问题)
- [网络问题](#网络问题)
- [权限问题](#权限问题)
- [Java 相关问题](#java-相关问题)
- [其他问题](#其他问题)

---

## 启动问题

### Q: 提示 `wow: command not found`（找不到命令）

**原因：** `wow` 不是系统自带的命令，`start.sh` 也**不会**自动把它注册到系统里。你大概率是直接敲了 `wow init`，但它还没进 PATH。

**解决（三选一，新手用第①种）：**

1. **透传参数（最省事，全平台通用）：** 别敲 `wow`，把 `wow` 换成 `./start.sh`：
   ```bash
   ./start.sh init
   ./start.sh server start --memory 4G
   ./start.sh web start
   ```
2. **注册成全局命令：** 执行一次后，以后就能直接 `wow`：
   ```bash
   cd core && npm link
   wow init
   ```
3. **临时调用：** 在 `core` 目录里用 `npx`：
   ```bash
   cd core && npx wow init
   ```

> 详细图解见 [QUICKSTART.md](QUICKSTART.md) 的「2.5 怎么运行 wow 命令」。

---

### Q: 运行 `./start.sh`（不带任何参数）后窗口一闪而过 / 立刻退出

**原因：** 这是**正常现象，不是崩溃、也不是开服成功**。在交互终端里，`./start.sh` 不带参数会打印一屏帮助然后退出。真正开服要用带参数的命令，例如 `./start.sh server start`。

**解决：** 永远带着子命令运行，例如 `./start.sh init`、`./start.sh server start`、`./start.sh web start`。

---

### Q: 运行 `./start.sh` 报错 "Permission denied"

**原因：** 脚本没有执行权限。

**解决：**
```bash
chmod +x start.sh
./start.sh