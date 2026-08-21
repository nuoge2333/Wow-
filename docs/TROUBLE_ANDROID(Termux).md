# 🤖 Android (Termux) 故障排除

> 适用于在 Android 手机 / 平板上通过 **Termux** 运行 wow~ 的场景

---

## 适用环境

- **必须**在 Termux 终端内运行（不能用系统自带终端、ADB shell 或其它终端模拟器）
- 设备架构需为 **arm64** 或 **x64**
- 推荐通过 [F-Droid](https://f-droid.org/packages/com.termux/) 安装 Termux（Google Play 上的旧版本已停止维护，可能缺少必要组件）
- wow~ 会在首次启动时自动通过 `pkg` 装配 **Node.js** 与 **OpenJDK 17**，无需手动安装

---

## 快速定位

- [安装与启动问题](#安装与启动问题)
- [pkg / 网络问题](#pkg--网络问题)
- [存储与权限问题](#存储与权限问题)
- [服务器运行问题](#服务器运行问题)
- [其他问题](#其他问题)

---

## 安装与启动问题

### Q: 启动时报错 "❌ 错误：在安卓上运行 wow~ 必须通过 Termux。"

**原因：** 你不是在 Termux 环境内运行脚本，例如：

- 使用了系统自带的「终端」App
- 通过 ADB shell 执行
- 使用了非 Termux 的终端模拟器

**解决：**

1. 从 F-Droid 安装 Termux
2. 在 Termux 内用 `cd` 进入 wow~ 解压目录
3. 在 Termux 内执行 `bash wow.sh`（或 `./wow.sh`）

```bash
# 在 Termux 中
cd /storage/emulated/0/wow   # 假设解压到手机存储
bash wow.sh
```

---

### Q: 提示 "未检测到 node，正在通过 pkg 安装 Node.js..." 后卡住或失败

**原因：** Termux 的 `pkg` 源访问慢，或首次 `pkg update` 失败。

**解决：**

```bash
# 手动更新并安装
pkg update -y
pkg install -y nodejs
```

安装完成后重新运行 `bash wow.sh`，脚本检测到已存在 node 会跳过自动安装。

---

### Q: 提示 "未检测到 java，正在通过 pkg 安装 OpenJDK 17..." 后失败

**原因：** OpenJDK 17 未安装且 `pkg install openjdk-17` 失败（网络或源问题）。

**解决：**

```bash
pkg update -y
pkg install -y openjdk-17
java -version   # 验证安装
```

验证输出应包含 `OpenJDK` 与版本号。安装成功后重新运行 `bash wow.sh` 即可。

---

### Q: `bash wow.sh` 报错 "Permission denied"

**原因：** 脚本没有执行权限（少见，Termux 默认允许）。

**解决：**

```bash
chmod +x wow.sh
bash wow.sh
```

---

## pkg / 网络问题

### Q: `pkg install` 速度极慢或超时

**原因：** 默认源在国外，国内访问不稳定。

**解决：** 切换到国内镜像（清华源）：

```bash
# 使用清华 TUNA 镜像
sed -i 's@^\(deb.*stable main\)$@#\1\ndeb https://mirrors.tuna.tsinghua.edu.cn/termux/termux-packages-24 stable main@' $PREFIX/etc/apt/sources.list
pkg update -y
```

或使用北外源：

```bash
sed -i 's@^\(deb.*stable main\)$@#\1\ndeb https://mirrors.bfsu.edu.cn/termux/termux-packages-24 stable main@' $PREFIX/etc/apt/sources.list
pkg update -y
```

---

### Q: Minecraft 服务端 / 核心下载很慢

**原因：** 默认从 Mojang 官方或 BMCLAPI2 下载，受网络影响。

**解决：**

- wow~ 已默认优先使用 BMCLAPI2 国内镜像
- 也可在 Termux 内为 `curl`/`wget` 配置代理，或在桌面端下载后通过文件路径传入

---

## 存储与权限问题

### Q: 找不到解压后的 wow~ 目录

**原因：** Termux 的 `/storage/emulated/0/` 需要授权才能访问。

**解决：**

```bash
# 授权访问手机存储（按提示在弹窗中允许）
termux-setup-storage

# 之后可通过以下路径访问下载目录
cd /storage/emulated/0/Download
```

建议把 wow~ 解压到 Termux 的 `$HOME`（即 `~`）目录下，避免跨存储访问权限问题：

```bash
# 在 Termux 内
cd ~
# 用 unzip 解压到当前目录
unzip /storage/emulated/0/Download/wow-3.2.2.zip
cd wow
bash wow.sh
```

---

### Q: 提示 "Read-only file system" 或无法写入文件

**原因：** 在只读目录（如系统分区）运行，或存储未授权。

**解决：** 确保在 Termux 可写目录（如 `~` 或已授权的 `/storage/emulated/0/`）下运行。

---

## 服务器运行问题

### Q: 提示 "UnsupportedClassVersionError" 或 Java 版本不匹配

**原因：** 安装的 OpenJDK 版本与 Minecraft 版本不兼容。

**兼容性对照表：**

| Minecraft 版本 | 需要 Java 版本 |
|----------------|---------------|
| 1.16 及以下 | Java 8 |
| 1.17 - 1.20 | Java 17 |
| 1.21+ | Java 21 |

**解决：** 安装对应版本（wow~ 默认装 17，可对应当前主流版本）：

```bash
pkg install -y openjdk-17
# 如需 Java 21
pkg install -y openjdk-21
```

---

### Q: 服务器启动后很快被系统杀掉 / 后台运行中断

**原因：** Android 电池优化或 Termux 被放入后台后遭系统回收。

**解决：**

```bash
# 允许 Termux 在后台运行（关闭电池优化）
# 设置 → 应用 → Termux → 电池 → 不受限制

# 或在 Termux 内锁定会话（下拉通知栏 Termux 通知 → 锁）
```

也可配合 `termux-wake-lock` 保持唤醒：

```bash
pkg install -y termux-tools
termux-wake-lock
bash wow.sh
```

---

### Q: 手机内存不足（OutOfMemoryError）

**原因：** 手机 RAM 有限，默认分配内存可能过高。

**解决：** 启动服务器时指定更小内存：

```bash
# 先用 node 进入 cli（假设便携 Node 已就绪）
node core/src/cli.js server start --memory 1G
```

或直接在菜单中选择启动服务器时填写较小内存（如 `1024M`）。

---

### Q: 局域网内其他设备无法连接到服务器

**原因：** 手机热点 / WiFi 下的防火墙或端口未放行。

**解决：**

- 确认服务器监听 `*:25565`（默认）
- 手机与玩家设备处于同一局域网
- 如被占用可改端口：`node core/src/cli.js config server server-port 25566`

---

## 其他问题

### Q: 终端中文显示乱码

**原因：** Termux 默认 locale 可能不是 UTF-8。

**解决：**

```bash
# 安装并切换 locale
pkg install -y locale
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

---

### Q: 提示架构不支持 / "Illegal instruction"

**原因：** 设备不是 arm64 / x64（如老旧 32 位设备）。

**解决：** wow~ 仅支持 arm64 / x64 架构的 Android 设备，老旧 32 位设备无法运行。

---

## 快速命令参考

| 问题 | 命令 |
|------|------|
| 安装 Node.js | `pkg install -y nodejs` |
| 安装 OpenJDK 17 | `pkg install -y openjdk-17` |
| 授权存储访问 | `termux-setup-storage` |
| 保持后台唤醒 | `termux-wake-lock` |
| 切换国内 pkg 源 | 见 [pkg / 网络问题](#pkg--网络问题) |
| 启动 wow~ | `bash wow.sh` |
| 查看 Java 版本 | `java -version` |
| 查看系统架构 | `uname -m` |

---

## 仍然无法解决？

收集以下信息，提交到 Issue 区：

```bash
# 系统信息
uname -a
uname -m

# Termux 版本
termux-info

# Java 版本
java -version

# node 版本
node -v

# wow 版本
node core/src/cli.js --version
```
