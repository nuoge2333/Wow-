# 🛠️ Debian / Ubuntu 故障排除

> 适用于 Debian、Ubuntu 及其衍生发行版（如 Linux Mint、Pop!_OS、Kubuntu 等）
> 包括 x86_64 和 ARM64 (aarch64) 架构

---

## 常见问题分类

- [启动问题](#启动问题)
- [服务器启动问题](#服务器启动问题)
- [网络问题](#网络问题)
- [权限问题](#权限问题)
- [Java 相关问题](#java-相关问题)
- [包管理问题](#包管理问题)
- [其他问题](#其他问题)

---

## 启动问题

### Q: 运行 `./wow.sh` 报错 "Permission denied"

**原因：** 脚本没有执行权限。

**解决：**
```bash
chmod +x wow.sh
./wow.sh
```

---

Q: 运行 ./wow.sh 报错 "No such file or directory"

原因： 可能脚本文件格式是 Windows 的 CRLF（行尾符问题），或 wow.sh 不存在。

解决：

```bash
# 安装 dos2unix
sudo apt update
sudo apt install dos2unix

# 转换格式
dos2unix wow.sh

# 重新运行
./wow.sh
```

---

Q: 提示 "未找到 curl 或 wget"

原因： 系统缺少下载工具。

解决：

```bash
sudo apt update
sudo apt install curl wget
```

---

Q: 提示 "Node.js 下载失败" 或 "Network is unreachable"

原因： 国内访问 nodejs.org 可能较慢或超时。

解决：

· wow.sh 已内置国内镜像源（npmmirror），可自动加速。
· 如果仍失败，可以在 wow.sh 中手动更换镜像源：

```bash
# 编辑 wow.sh，找到 NODE_URL 相关行，替换为：
NODE_URL="https://npmmirror.com/mirrors/node/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz"
```

---

Q: 提示 "Segmentation fault" 或 "Illegal instruction"

原因： 系统架构不匹配（如在 ARM 设备上运行 x86 程序）。

检查系统架构：

```bash
uname -m
```

· x86_64 → 64 位 Intel/AMD
· aarch64 → 64 位 ARM（树莓派 3/4/5、RK 系列等）

解决： wow.sh 会自动检测架构并下载对应版本。如果下载了错误版本，删除 core/node/ 目录重新运行。

---

服务器启动问题

Q: 提示 "Java not found" 或 "未找到 Java"

原因： 系统没有安装 Java，或 Java 不在 PATH 中。

解决：

安装 Java 17（推荐 Minecraft 1.17+）：

```bash
sudo apt update
sudo apt install openjdk-17-jre-headless
```

对于 Minecraft 1.16 及以下版本（需要 Java 8）：

```bash
sudo apt install openjdk-8-jre-headless
```

验证安装：

```bash
java -version
```

---

Q: 服务器启动时提示 "OutOfMemoryError"（内存溢出）

原因： 分配的内存不足。

解决：

```bash
# 启动时指定更大的内存
wow server start --memory 4G

# 或修改配置文件
wow config wow server.jvm_args '["-Xmx4G", "-Xms4G", "-XX:+UseG1GC"]'
```

---

Q: 提示 "Address already in use" 或 "端口被占用"

原因： 端口 25565（默认）被其他程序占用。

解决：

```bash
# 查看端口占用
sudo lsof -i :25565

# 或使用 ss
sudo ss -tlnp | grep 25565

# 修改服务器端口
wow config server server-port 25566
```

---

Q: 提示 "The server is running in offline mode and online-mode is true"

原因： 正版验证开启但玩家使用离线登录。

解决：

```bash
# 关闭正版验证
wow config server online-mode false
```

---

Q: EULA 未接受，服务器无法启动

原因： 未接受 Minecraft EULA。

解决：

```bash
# 编辑 eula.txt
nano server/eula.txt

# 将 eula=false 改为 eula=true
# 保存退出 (Ctrl+O, Enter, Ctrl+X)
```

或使用命令：

```bash
wow config server eula true
```

---

网络问题

Q: 下载镜像速度慢或无法连接

原因： BMCLAPI2 在某些地区可能不稳定。

解决：

```bash
# 切换到 Mojang 官方源
wow set download.mirror https://launcher.mojang.com

# 或使用自定义镜像
wow set download.mirror https://mirror.example.com
```

---

Q: 提示 "SSL certificate verify failed"

原因： 系统 SSL 证书过期或缺失。

解决：

```bash
sudo apt update
sudo apt install ca-certificates
sudo update-ca-certificates
```

---

Q: CurseForge / Modrinth 搜索无结果

原因： API 被网络环境限制（如防火墙）。

解决：

· 检查网络代理设置
· 尝试使用 Web 面板的搜索功能（可能使用不同 API）
· 手动下载模组后使用 wow mod install 安装

---

权限问题

Q: 提示 "Permission denied" 无法写入文件

原因： 文件或目录属于其他用户（如 root）。

解决：

```bash
# 确保 wow 目录属于当前用户
sudo chown -R $USER:$USER /path/to/wow

# 或给目录添加写权限
chmod -R u+w /path/to/wow
```

---

Q: 提示 "Read-only file system"

原因： 磁盘以只读模式挂载。

解决：

```bash
# 检查挂载状态
mount | grep " / "

# 如果不是硬件故障，重新挂载为读写
sudo mount -o remount,rw /
```

---

Java 相关问题

Q: 安装了多个 Java 版本，如何切换？

解决：

```bash
# 查看已安装的 Java 版本
sudo update-alternatives --config java

# 选择对应版本（输入编号）
```

指定特定版本：

```bash
# 使用 Java 17
wow set server.java /usr/lib/jvm/java-17-openjdk-amd64/bin/java

# ARM64 设备路径不同：
wow set server.java /usr/lib/jvm/java-17-openjdk-arm64/bin/java
```

---

Q: 提示 "UnsupportedClassVersionError"

原因： Java 版本与 Minecraft 版本不兼容。

兼容性对照表：

Minecraft 版本 需要 Java 版本 Debian 安装命令
1.16 及以下 Java 8 sudo apt install openjdk-8-jre-headless
1.17 - 1.20 Java 17 sudo apt install openjdk-17-jre-headless
1.21+ Java 21 sudo apt install openjdk-21-jre-headless

---

包管理问题

Q: apt update 报错或软件源不可用

原因： 软件源配置过时或网络问题。

解决：

```bash
# 备份现有源列表
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak

# 使用国内镜像源（以清华源为例）
# 适用于 Ubuntu 22.04 (Jammy)
sudo sed -i 's/archive.ubuntu.com/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list
sudo sed -i 's/security.ubuntu.com/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list

# 适用于 Debian 12 (Bookworm)
# 编辑 /etc/apt/sources.list，替换为：
# deb https://mirrors.tuna.tsinghua.edu.cn/debian bookworm main contrib non-free non-free-firmware

sudo apt update
```

---

Q: 提示 "Unable to locate package" 找不到某个包

原因： 包名错误或软件源未包含。

解决：

```bash
# 搜索包名
apt search <关键词>

# 更新包列表
sudo apt update

# 确保 universe/multiverse 仓库已启用
sudo add-apt-repository universe
sudo add-apt-repository multiverse
sudo apt update
```

---

其他问题

Q: 终端显示乱码

原因： 终端编码不是 UTF-8。

解决：

```bash
# 设置终端编码
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 永久生效（添加到 ~/.bashrc）
echo 'export LANG=en_US.UTF-8' >> ~/.bashrc
echo 'export LC_ALL=en_US.UTF-8' >> ~/.bashrc
source ~/.bashrc
```

---

Q: 提示 "Too many open files"（文件句柄不足）

原因： 系统限制同时打开的文件数量。

解决：

```bash
# 查看当前限制
ulimit -n

# 临时提高限制
ulimit -n 65535

# 永久提高（修改 /etc/security/limits.conf）
echo '* soft nofile 65535' | sudo tee -a /etc/security/limits.conf
echo '* hard nofile 65535' | sudo tee -a /etc/security/limits.conf
```

---

Q: 日志文件过大，磁盘空间不足

解决：

```bash
# 查看日志大小
du -sh server/logs/

# 清空日志
> server/logs/latest.log

# 或删除旧日志
rm server/logs/*.log
```

---

Q: 如何查看详细错误信息？

方法：

```bash
# 启用详细输出
wow --verbose server start

# 查看服务器日志
cat server/logs/latest.log

# 查看 wow 自身日志
cat core/logs/cli.log
```

---

快速命令参考

问题 命令
安装 Java 17 sudo apt install openjdk-17-jre-headless
安装依赖工具 sudo apt install curl wget unzip
设置文件权限 chmod +x wow.sh
查看端口占用 sudo lsof -i :25565
查看 Java 版本 java -version
查看系统信息 uname -a
更新软件源 sudo apt update
升级所有软件 sudo apt upgrade

---

与 Arch 的主要区别

操作 Debian/Ubuntu Arch/Manjaro
包管理器 apt pacman
安装 Java sudo apt install openjdk-17-jre-headless sudo pacman -S jre17-openjdk
安装 curl sudo apt install curl sudo pacman -S curl
Java 版本切换 sudo update-alternatives --config java archlinux-java set

---

仍然无法解决？

收集以下信息，提交到社区或 Issue 区：

```bash
# 系统信息
uname -a
lsb_release -a

# Java 版本
java -version

# wow 版本
wow --version

# 配置文件（去除敏感信息）
cat core/wow.yaml

# 错误日志（最近 50 行）
tail -50 server/logs/latest.log
```
