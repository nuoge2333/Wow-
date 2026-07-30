# 🛠️ Arch Linux / Manjaro 故障排除

> 适用于 Arch Linux、Manjaro、EndeavourOS 及其衍生发行版

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
```

---

### Q: 运行 `./start.sh` 报错 "No such file or directory"

**原因：** 可能脚本文件格式是 Windows 的 CRLF（行尾符问题）。

**解决：**
```bash
# 安装 dos2unix
sudo pacman -S dos2unix

# 转换格式
dos2unix start.sh

# 重新运行
./start.sh
```

---

### Q: 提示 "未找到 curl 或 wget"

**原因：** 系统缺少下载工具（Arch 最小安装可能不包含）。

**解决：**
```bash
sudo pacman -S curl wget
```

---

### Q: 启动后显示 "Segmentation fault" 或 "Illegal instruction"

**原因：** 系统架构不匹配（如 32 位系统运行 64 位程序）。

**检查系统架构：**
```bash
uname -m
```
- `x86_64` → 64 位
- 其他 → 可能为 32 位系统（Arch 官方已停止支持 32 位）

**解决：** 使用 64 位系统，或从 AUR 获取 32 位兼容库。

---

### Q: Node.js 下载失败（网络超时）

**原因：** Node.js 官方源在国内访问慢。

**解决：** 手动下载 Node.js 并放入对应目录。

```bash
# 1. 访问 https://nodejs.org/dist/v20.17.0/
# 2. 下载 node-v20.17.0-linux-x64.tar.xz
# 3. 放入 core/node/linux/x64/ 并解压

cd core/node/linux/x64/
tar -xJf /path/to/node-v20.17.0-linux-x64.tar.xz
mv node-v20.17.0-linux-x64/bin/* ./
chmod +x node
```

---

### Q: 缺少 `libstdc++` 等动态链接库

**原因：** Node.js 需要 `glibc` 和 `libstdc++` 等库。

**解决：**
```bash
# 安装必要的系统库
sudo pacman -S glibc gcc-libs
```

---

## 服务器启动问题

### Q: 提示 "Java not found" 或 "未找到 Java"

**原因：** 系统没有安装 Java，或 Java 不在 PATH 中。

**解决：**

```bash
# 安装 Java 17（推荐 Minecraft 1.17+）
sudo pacman -S jre17-openjdk

# 验证安装
java -version
```

**对于 Minecraft 1.16 及以下版本（需要 Java 8）：**
```bash
sudo pacman -S jre8-openjdk
```

---

### Q: 服务器启动时提示 "OutOfMemoryError"（内存溢出）

**原因：** 分配的内存不足。

**解决：**
```bash
# 启动时指定更大的内存
wow server start --memory 4G

# 或修改配置文件
wow config wow server.jvm_args '["-Xmx4G", "-Xms4G", "-XX:+UseG1GC"]'
```

---

### Q: 提示 "Address already in use" 或 "端口被占用"

**原因：** 端口 25565（默认）被其他程序占用。

**解决：**
```bash
# 查看端口占用
sudo ss -tlnp | grep 25565

# 或使用 lsof
sudo lsof -i :25565

# 修改服务器端口
wow config server server-port 25566
```

---

### Q: 提示 "The server is running in offline mode and online-mode is true"

**原因：** 正版验证开启但玩家使用离线登录。

**解决：**
```bash
# 关闭正版验证
wow config server online-mode false
```

---

### Q: EULA 未接受，服务器无法启动

**原因：** 未接受 Minecraft EULA。

**解决：**
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

## 网络问题

### Q: 下载镜像速度慢或无法连接

**原因：** BMCLAPI2 在某些地区可能不稳定。

**解决：** 切换镜像源。
```bash
# 切换到 Mojang 官方源
wow set download.mirror https://launcher.mojang.com

# 或使用自定义镜像
wow set download.mirror https://mirror.example.com
```

---

### Q: 提示 "SSL certificate verify failed"

**原因：** 系统 SSL 证书过期或缺失。

**解决：**
```bash
# 更新 CA 证书
sudo pacman -S ca-certificates
sudo update-ca-certificates
```

---

### Q: CurseForge / Modrinth 搜索无结果

**原因：** API 被网络环境限制。

**解决：**
- 检查网络代理设置
- 尝试使用 Web 面板的搜索功能（可能使用不同 API）
- 手动下载模组后使用 `wow mod install` 安装

---

## 权限问题

### Q: 提示 "Permission denied" 无法写入文件

**原因：** 文件或目录属于其他用户（如 root）。

**解决：**
```bash
# 确保 wow 目录属于当前用户
sudo chown -R $USER:$USER /path/to/wow

# 或给目录添加写权限
chmod -R u+w /path/to/wow
```

---

### Q: 提示 "Read-only file system"

**原因：** 磁盘以只读模式挂载。

**解决：**
```bash
# 检查挂载状态
mount | grep " / "

# 如果不是硬件故障，重新挂载为读写
sudo mount -o remount,rw /
```

---

## Java 相关问题

### Q: 安装了多个 Java 版本，如何切换？

**解决：**
```bash
# 查看已安装的 Java 版本
archlinux-java status

# 设置默认 Java 版本
sudo archlinux-java set java-17-openjdk

# 或切换到 Java 8
sudo archlinux-java set java-8-openjdk
```

**指定特定版本：**
```bash
# 使用 Java 17
wow set server.java /usr/lib/jvm/java-17-openjdk/bin/java

# 使用 Java 8
wow set server.java /usr/lib/jvm/java-8-openjdk/jre/bin/java
```

---

### Q: 提示 "UnsupportedClassVersionError"

**原因：** Java 版本与 Minecraft 版本不兼容。

**兼容性对照表：**

| Minecraft 版本 | 需要 Java 版本 |
|----------------|---------------|
| 1.16 及以下 | Java 8 |
| 1.17 - 1.20 | Java 17 |
| 1.21+ | Java 21 |

**解决：** 安装对应的 Java 版本。
```bash
# 安装 Java 17
sudo pacman -S jdk17-openjdk

# 安装 Java 21
sudo pacman -S jdk21-openjdk
```

---

## 其他问题

### Q: 终端显示乱码

**原因：** 终端编码不是 UTF-8。

**解决：**
```bash
# 设置终端编码
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 永久生效（添加到 ~/.bashrc 或 ~/.zshrc）
echo 'export LANG=en_US.UTF-8' >> ~/.bashrc
echo 'export LC_ALL=en_US.UTF-8' >> ~/.bashrc
source ~/.bashrc
```

---

### Q: 提示 "Too many open files"（文件句柄不足）

**原因：** 系统限制同时打开的文件数量。

**解决：**
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

### Q: 缺少 AUR 依赖（使用 yay 或 paru）

如果使用 AUR 辅助工具，可能需要安装某些依赖：

```bash
# 使用 yay
yay -S <package>

# 使用 paru
paru -S <package>
```

---

### Q: 日志文件过大，磁盘空间不足

**解决：**
```bash
# 查看日志大小
du -sh server/logs/

# 清空日志
> server/logs/latest.log

# 或删除旧日志
rm server/logs/*.log
```

---

### Q: 如何查看详细错误信息？

**方法：**
```bash
# 启用详细输出
wow --verbose server start

# 查看服务器日志
cat server/logs/latest.log

# 查看 wow 自身日志
cat core/logs/cli.log
```

---

## 快速命令参考

| 问题 | 命令 |
|------|------|
| 安装 Java 17 | `sudo pacman -S jre17-openjdk` |
| 安装依赖工具 | `sudo pacman -S curl wget unzip` |
| 设置文件权限 | `chmod +x start.sh` |
| 查看端口占用 | `sudo ss -tlnp \| grep 25565` |
| 查看 Java 版本 | `java -version` |
| 查看系统信息 | `uname -a` |
| 查看已安装 Java | `archlinux-java status` |
| 切换默认 Java | `sudo archlinux-java set java-17-openjdk` |

---

## 与 Debian 系的主要区别

| 操作 | Debian/Ubuntu | Arch/Manjaro |
|------|---------------|--------------|
| 包管理器 | `apt` | `pacman` |
| 安装 Java | `apt install openjdk-17-jre` | `pacman -S jre17-openjdk` |
| 安装 curl | `apt install curl` | `pacman -S curl` |
| Java 版本切换 | `update-alternatives --config java` | `archlinux-java set` |

---

## 仍然无法解决？

收集以下信息，提交到社区或 Issue 区：

```bash
# 系统信息
uname -a

# Java 版本
java -version

# 已安装 Java 列表
archlinux-java status

# wow 版本
wow --version

# 配置文件（去除敏感信息）
cat core/wow.yaml

# 错误日志（最近 50 行）
tail -50 server/logs/latest.log
```