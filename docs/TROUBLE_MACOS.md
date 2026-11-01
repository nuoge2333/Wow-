# 🛠️ macOS 故障排除

> 适用于 macOS 10.15 (Catalina) 及以上版本，包括 Intel 与 Apple Silicon（M1 / M2 / M3 / M4）芯片。

> 📌 **命令引导词**：文档中的 `wow` 是简写 —— macOS / Linux 下实际写 `./wow.sh`（Windows 为 `wow.bat`）。例如 `wow server start` 即 `./wow.sh server start`。

---

## 常见问题分类

- [启动问题](#启动问题)
- [服务器启动问题](#服务器启动问题)
- [网络问题](#网络问题)
- [权限问题](#权限问题)
- [Java 相关问题](#java-相关问题)
- [Apple Silicon 相关问题](#apple-silicon-相关问题)
- [其他问题](#其他问题)

---

## 启动问题

### Q：运行 `./wow.sh` 报 Permission denied

**原因**：脚本没有执行权限。

```bash
chmod +x wow.sh
./wow.sh
```

---

### Q：运行 `./wow.sh` 报 No such file or directory

**原因**：脚本是 Windows 的 CRLF 行尾，`#!` 后面的解释器路径带上了 `\r`。

```bash
# 安装 dos2unix
brew install dos2unix

# 转换行尾并重新运行
dos2unix wow.sh
./wow.sh
```

> 如果是解压工具（如某些 Windows 压缩软件）造成的行尾变化，重新用 `unzip` 解压也可以。

---

### Q：提示「未找到 curl 或 wget」

**原因**：系统缺少下载工具。macOS 自带 `curl`，但极少数精简环境会被移除。

```bash
brew install curl
brew install wget    # 可选
```

---

### Q：提示「无法打开 wow.sh，因为它来自身份不明的开发者」

**原因**：Gatekeeper 阻止未签名脚本运行。

**方法一：右键打开**

右键点击 `wow.sh` → 选择「打开」→ 在弹窗中再次点「打开」。

**方法二：用 bash 直接执行**

```bash
bash wow.sh
```

**方法三：解除隔离属性（推荐）**

```bash
xattr -d com.apple.quarantine wow.sh
./wow.sh
```

---

### Q：启动后显示 Segmentation fault 或 Illegal instruction

**原因**：架构不匹配，例如在 Apple Silicon 上运行了 Intel 版 Node。

```bash
uname -m
```

- `arm64` → Apple Silicon
- `x86_64` → Intel

**解决**：

- `wow.sh` 会自动检测架构并下载对应版本的 Node.js 便携版；
- 如果之前下错了版本，删掉 `core/node` 目录后重新运行：

```bash
rm -rf core/node
./wow.sh
```

---

### Q：Node.js 下载失败（网络超时）

**原因**：Node.js 官方源在部分网络环境下很慢。`wow.sh` 已内置 5 个镜像依次重试
（npmmirror → 清华 → 腾讯 → 华为 → 官方），全部失败时才需要手动处理。

**解决一：挂代理后重试**

```bash
export https_proxy=http://127.0.0.1:7890
./wow.sh
```

**解决二：手动下载并放入对应目录**

目录结构（相对 `core/`）：`node/<系统>/<架构>/node`，macOS 即 `core/node/darwin-x64` 或 `core/node/darwin-arm64`。

**Intel Mac**：

```bash
# 1. 从 https://nodejs.org/dist/v20.17.0/ 下载 node-v20.17.0-darwin-x64.tar.gz
# 2. 解压并按脚本期望的结构摆放
cd core/node/darwin-x64
tar -xzf ~/Downloads/node-v20.17.0-darwin-x64.tar.gz
mv node-v20.17.0-darwin-x64 extracted
ln -sf "$PWD/extracted/bin/node" node
chmod +x node
```

**Apple Silicon**：

```bash
# 1. 从 https://nodejs.org/dist/v20.17.0/ 下载 node-v20.17.0-darwin-arm64.tar.gz
cd core/node/darwin-arm64
tar -xzf ~/Downloads/node-v20.17.0-darwin-arm64.tar.gz
mv node-v20.17.0-darwin-arm64 extracted
ln -sf "$PWD/extracted/bin/node" node
chmod +x node
```

> 💡 如果系统里已经装了 Node.js ≥ 18，`wow.sh` 会**自动复用系统 Node**，跳过便携版下载：
>
> ```
> 检测到系统 Node.js v20.x.x，优先复用，跳过便携版下载
> ```
>
> 想走这条路，先 `brew install node` 即可，无需任何额外开关。

---

### Q：zsh 提示 no such file or directory: ./wow.sh

**原因**：当前目录不对（不在 wow 根目录），或文件确实不存在。

```bash
# 先确认当前位置
pwd
ls -l wow.sh

# 用相对路径
./wow.sh

# 或用绝对路径
/path/to/wow/wow.sh
```

---

## 服务器启动问题

### Q：提示 Java not found 或「未找到 Java」

**原因**：系统没有安装 Java，或 Java 不在 `PATH` 中。

**方法一：Homebrew 安装（推荐）**

```bash
# 安装 Java 17
brew install openjdk@17

# 链接到系统 Java 目录，让 /usr/libexec/java_home 能找到
sudo ln -sfn "$(brew --prefix openjdk@17)/libexec/openjdk.jdk" \
  /Library/Java/JavaVirtualMachines/openjdk-17.jdk

# 验证
java -version
```

**方法二：从 Adoptium 下载**

访问 https://adoptium.net/ → 下载 macOS 版 Java 17 (LTS) → 运行安装包。

> 装好后可以用 wow 的扫描功能确认：菜单 **8 → 1**（系统设置 → Java 设置），
> 或直接 `wow config wow server.java /path/to/bin/java`。

---

### Q：Apple Silicon 上 Java 装完却用不了

**原因**：装成了 Intel 版 Java，需要 Rosetta 才能跑。

```bash
# 列出所有已安装的 Java 及其架构
/usr/libexec/java_home -V

# 确认某个 java 的架构（应显示 arm64）
file "$(/usr/libexec/java_home)/bin/java"

# 临时指定 JAVA_HOME
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

如果只有 `x86_64`，重新安装 arm64 版本（`brew install openjdk@17` 在 Apple Silicon 上装的即为 arm64）。

---

### Q：启动时提示 OutOfMemoryError（内存溢出）

**原因**：分配内存不足。

```bash
# 启动时临时指定
wow server start --memory 4G

# 或写入配置（长期生效）
wow config wow server.jvm_args '["-Xmx4G","-Xms4G","-XX:+UseG1GC"]'
```

> Apple Silicon 机器建议 `-Xmx` 不超过物理内存的一半，给系统和 JVM 元空间留余量。

---

### Q：提示 Address already in use / 端口被占用

**原因**：25565 端口被其他程序（另一个 MC 实例、残留进程）占用。

```bash
# 查看占用
sudo lsof -i :25565

# 结束占用进程
kill -9 <PID>

# 或换端口（写入 server.properties）
wow config server server-port 25566
```

---

### Q：提示 The server is running in offline mode and online-mode is true

**原因**：服务端开了正版验证，但玩家用离线登录进服。

```bash
wow config server online-mode false
```

> 外置登录（authlib-injector）场景见 [CONFIG.md · auth](CONFIG.md#auth--外置登录设置-authlib-injector)。

---

### Q：EULA 未接受，服务器无法启动

**原因**：首次启动需要接受 Minecraft EULA。

`eula.txt` 在首次启动时生成于**当前方案目录**，把 `eula=false` 改成 `eula=true` 即可：

```bash
# 先看当前是哪个方案
wow scheme status

# 编辑（把 <方案名> 换成实际名字）
nano scheme/<方案名>/eula.txt
```

保存退出（`Ctrl+O` → 回车 → `Ctrl+X`），或在 Web 面板的「文件管理」里双击 `eula.txt` 在线编辑。

---

### Q：路径包含中文导致启动失败

**原因**：部分 JVM / 加载器对非 ASCII 路径处理不稳。

**解决**：把 wow 解压到纯英文路径，例如 `/Users/<用户名>/wow` 或 `/opt/wow`，
避免 `~/桌面/我的服务器` 这类路径。

---

## 网络问题

### Q：下载镜像速度慢或连不上

**原因**：BMCLAPI2 在部分地区不稳定。

```bash
# 切回 Mojang 官方源
wow set download.mirror https://launcher.mojang.com

# 或换自定义镜像
wow set download.mirror https://mirror.example.com
```

---

### Q：提示 SSL certificate verify failed

**原因**：证书链缺失或过期。

```bash
# 更新 Homebrew 的证书包
brew install ca-certificates

# 确认系统时间正确（时间偏差会导致证书校验失败）
date
```

> macOS 没有 `update-ca-certificates`（那是 Debian 系的命令），不要照搬 Linux 教程。

---

### Q：CurseForge / Modrinth 搜索无结果

**原因**：API 被网络环境限制（防火墙、代理未生效）。

**解决**：

- 检查终端与浏览器的代理设置是否一致（`curl` 不一定走系统代理）；
- 尝试在 Web 面板的下载管理页搜索（浏览器走的代理可能不同）；
- 手动下载模组后，进数字菜单第 **4** 项「模组/插件搜索下载」→「从本地安装模组」。

---

## 权限问题

### Q：Permission denied，无法写入文件

**原因**：文件或目录属主不是当前用户（常见于用 `sudo` 解压过）。

```bash
# 把 wow 目录归还给当前用户（注意 macOS 的主组是 staff）
sudo chown -R "$USER":staff /path/to/wow

# 补写权限
chmod -R u+w /path/to/wow
```

---

### Q：Operation not permitted

**原因**：macOS SIP（系统完整性保护）限制了系统目录操作。

**解决**：

- 把 wow 放在用户目录下（如 `/Users/<用户名>/wow`），不要放在 `/System`、`/usr/bin` 等受保护位置；
- 若必须放在受保护目录，需要在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中给终端授权。

---

### Q：提示「无法打开文件，因为无法验证开发者」

**原因**：文件被打了隔离属性（通常是从浏览器/聊天工具下载的 zip 解压而来）。

```bash
# 解除整个目录的隔离属性
xattr -dr com.apple.quarantine /path/to/wow
```

---

## Java 相关问题

### Q：UnsupportedClassVersionError

**原因**：Java 版本低于该 Minecraft 版本的要求。

| Minecraft 版本 | 需要的 Java |
|----------------|-------------|
| 1.16 及以下 | Java 8 |
| 1.17 ~ 1.20.4 | Java 17 |
| ≥ 1.20.5 | Java 21 |

```bash
brew install openjdk@17
brew install openjdk@21
```

> wow 会按 `server.version` 自动挑选匹配的 Java（含 LTS 向上兼容规则），
> 详见 [CONFIG.md · jre](CONFIG.md#jre--jre-设置)。

---

### Q：如何查看已安装的 Java 版本？

```bash
# 系统默认 Java
java -version

# 所有已安装的 Java（macOS 专有工具）
/usr/libexec/java_home -V

# 当前 java 的真实路径
which java
```

> `/usr/libexec/java_home` 是 macOS 独有的，Linux 上没有，对应做法是 `update-alternatives --list java`。

---

### Q：装了多个 Java，如何切换？

**方法一：临时切换 `JAVA_HOME`**

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

**方法二：永久切换（写入 `~/.zshrc`）**

```bash
echo 'export JAVA_HOME=$(/usr/libexec/java_home -v 17)' >> ~/.zshrc
source ~/.zshrc
```

**方法三：只让 wow 用指定 Java**

```bash
wow set server.java /Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home/bin/java
```

---

### Q：wow 扫描不到已安装的 Java

**原因**：Java 装在非常规位置，或缺少 `/Library/Java/JavaVirtualMachines` 链接。

```bash
# 确认 java_home 能否列出
/usr/libexec/java_home -V

# 若 Homebrew 装的 Java 没出现在列表里，补一个链接
sudo ln -sfn "$(brew --prefix openjdk@17)/libexec/openjdk.jdk" \
  /Library/Java/JavaVirtualMachines/openjdk-17.jdk
```

然后在菜单 **8 → 1** 里重新扫描。

---

## Apple Silicon 相关问题

### Q：需要运行 Intel 版本的程序

**原因**：部分工具还没有 arm64 版本。

```bash
# 检查 Rosetta 2 是否安装
/usr/bin/pgrep -q oahd && echo "Rosetta 2 已安装" || echo "Rosetta 2 未安装"

# 安装
softwareupdate --install-rosetta

# 用 Rosetta 运行
arch -x86_64 /bin/bash wow.sh
```

---

### Q：Node.js 下成了错误的架构版本

**原因**：架构检测异常（例如在 Rosetta 终端里运行了 `wow.sh`，`uname -m` 会返回 `x86_64`）。

```bash
# 确认当前 shell 的真实架构
uname -m
arch

# 删掉错误的便携版后重跑
rm -rf core/node
./wow.sh
```

> 在 Apple Silicon 上请使用原生终端（不要在「使用 Rosetta 打开」的终端里运行）。

---

### Q：Java 在 Apple Silicon 上性能不佳

**原因**：跑的是 Intel 版 Java（经 Rosetta 转译）。

```bash
# 确认架构（应显示 arm64）
file "$(/usr/libexec/java_home)/bin/java"

# 安装原生版本
brew install openjdk@17
```

---

## 其他问题

### Q：终端显示乱码

**原因**：终端编码不是 UTF-8。

```bash
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 永久生效
echo 'export LANG=en_US.UTF-8' >> ~/.zshrc
echo 'export LC_ALL=en_US.UTF-8' >> ~/.zshrc
source ~/.zshrc
```

---

### Q：提示 Too many open files

**原因**：macOS 默认文件句柄上限较低（通常 256），大整合包容易撞上。

```bash
# 查看当前限制
ulimit -n

# 当前会话临时提高
ulimit -n 65535

# 系统级永久提高（重启后仍生效）
sudo launchctl limit maxfiles 65535 200000
```

> ⚠️ macOS **没有** `/etc/security/limits.conf` 这套机制（那是 Linux 的），
> 网上让你改 `limits.conf` 的教程在 macOS 上不生效，请用 `launchctl`。

---

### Q：日志文件过大，磁盘空间不足

```bash
# 查看日志占用（在方案目录下）
du -sh scheme/*/logs

# 清空最新日志（保留文件句柄，不要直接 rm）
: > scheme/<方案名>/logs/latest.log

# 删除按日期归档的旧日志
rm -f scheme/<方案名>/logs/*.log.gz
```

> 直接 `rm` 正在写入的日志文件，服务端仍会往已删除的 inode 写，磁盘不会释放，必须重启才回收。

---

### Q：如何查看详细错误信息？

```bash
# 打开详细日志（写入配置，长期生效）
wow config wow verbose true

# 服务器日志
tail -n 100 scheme/<方案名>/logs/latest.log

# wow 自身的事件日志
tail -n 100 core/logs/cli.log
```

> `wow --verbose` 这种全局参数并不存在，`verbose` 是配置项。

---

### Q：无法监听 1024 以下的端口

**原因**：macOS 限制非 root 用户绑定特权端口。

```bash
# 改用 1024 以上的端口
wow set web.port 8080

# 或临时用 root 启动（不推荐长期这样跑）
sudo ./wow.sh web start
```

---

## 快速命令参考

| 问题 | 命令 |
|------|------|
| 解除隔离属性 | `xattr -dr com.apple.quarantine /path/to/wow` |
| 查看端口占用 | `sudo lsof -i :25565` |
| 查看 Java 版本 | `java -version` |
| 查看已安装 Java | `/usr/libexec/java_home -V` |
| 查看系统信息 | `system_profiler SPSoftwareDataType` |
| 查看架构 | `uname -m` |
| 安装 Rosetta 2 | `softwareupdate --install-rosetta` |
| 提高文件句柄上限 | `sudo launchctl limit maxfiles 65535 200000` |

---

## 与 Linux 的主要区别

| 操作 | macOS | Linux |
|------|-------|-------|
| 包管理器 | `brew` | `apt` / `pacman` / `dnf` |
| 启动脚本 | `./wow.sh` | `./wow.sh` |
| 查找 Java | `/usr/libexec/java_home -V` | `update-alternatives --list java` |
| 查看端口占用 | `sudo lsof -i :port` | `ss -lntp` / `lsof -i :port` |
| 解除隔离 | `xattr -dr com.apple.quarantine` | 无需此操作 |
| 文件句柄上限 | `launchctl limit maxfiles` | `/etc/security/limits.conf` |
| Shell 配置 | `~/.zshrc` | `~/.bashrc` |

---

## 仍然无法解决？

收集以下信息后提交到 Issue 区：

```bash
# 系统与架构
system_profiler SPSoftwareDataType
uname -m

# Java
java -version
/usr/libexec/java_home -V

# wow 版本
wow --version

# 配置（记得去掉 auth_token / SMTP 密码等敏感信息）
cat core/wow.yaml

# 错误日志（最近 50 行）
tail -n 50 scheme/<方案名>/logs/latest.log
```

---

> 备注：在 macOS 上推荐用 `brew` 安装和更新依赖。如果还没有 Homebrew，执行：
>
> ```bash
> /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
> ```
