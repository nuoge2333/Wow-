# 🛠️ macOS 故障排除

 适用于 macOS 10.15 (Catalina) 及以上版本
 包括 Intel 和 Apple Silicon (M1M2M3) 芯片

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

### Q 运行 `.start.sh` 报错 Permission denied

原因： 脚本没有执行权限。

解决：
```bash
chmod +x start.sh
.start.sh
```

---

### Q 运行 `.start.sh` 报错 No such file or directory

原因： 可能脚本文件格式是 Windows 的 CRLF（行尾符问题）。

解决：
```bash
# 安装 dos2unix
brew install dos2unix

# 转换格式
dos2unix start.sh

# 重新运行
.start.sh
```

---

### Q 提示 未找到 curl 或 wget

原因： 系统缺少下载工具（macOS 自带 curl，但可能版本较旧）。

解决：
```bash
# 更新 curl（通过 Homebrew）
brew install curl

# 安装 wget（如果需要）
brew install wget
```

---

### Q 提示 无法打开 start.sh，因为它来自身份不明的开发者

原因： macOS Gatekeeper 阻止未签名的脚本运行。

解决：

方法一：右键打开
- 右键点击 `start.sh` → 选择“打开”
- 在弹出的对话框中点击“打开”

方法二：终端运行
```bash
# 直接使用 bash 运行
bash start.sh
```

方法三：解除隔离属性（推荐）
```bash
xattr -d com.apple.quarantine start.sh
.start.sh
```

---

### Q 启动后显示 Segmentation fault 或 Illegal instruction

原因： 系统架构不匹配（如在 Apple Silicon 上运行 Intel 版本程序）。

检查系统架构：
```bash
uname -m
```
- `arm64` → Apple Silicon (M1M2M3)
- `x86_64` → Intel

解决：
- `start.sh` 会自动检测架构并下载对应的 Node.js 版本
- 如果下载了错误的版本，删除 `corenode` 目录重新运行

---

### Q Node.js 下载失败（网络超时）

原因： Node.js 官方源在某些网络环境下访问慢。

解决： 手动下载 Node.js 并放入对应目录。

Intel Mac：
```bash
# 1. 访问 httpsnodejs.orgdistv20.17.0
# 2. 下载 node-v20.17.0-darwin-x64.tar.gz
# 3. 放入 corenodedarwinx64 并解压

cd corenodedarwinx64
tar -xzf pathtonode-v20.17.0-darwin-x64.tar.gz
mv node-v20.17.0-darwin-x64bin .
chmod +x node
```

Apple Silicon Mac：
```bash
# 1. 访问 httpsnodejs.orgdistv20.17.0
# 2. 下载 node-v20.17.0-darwin-arm64.tar.gz
# 3. 放入 corenodedarwinarm64 并解压

cd corenodedarwinarm64
tar -xzf pathtonode-v20.17.0-darwin-arm64.tar.gz
mv node-v20.17.0-darwin-arm64bin .
chmod +x node
```

---

### Q 提示 zsh no such file or directory .start.sh

原因： 当前目录不在 PATH 中，或文件名拼写错误。

解决：
```bash
# 使用相对路径
.start.sh

# 或使用绝对路径
pathtowowstart.sh
```

---

## 服务器启动问题

### Q 提示 Java not found 或 未找到 Java

原因： 系统没有安装 Java，或 Java 不在 PATH 中。

解决：

方法一：通过 Homebrew 安装
```bash
# 安装 Java 17（推荐）
brew install openjdk@17

# 链接到系统路径
sudo ln -sfn $(brew --prefix)optopenjdk@17libexecopenjdk.jdk LibraryJavaJavaVirtualMachinesopenjdk-17.jdk

# 验证安装
java -version
```

方法二：从 Adoptium 下载
- 访问 httpsadoptium.net
- 下载 macOS 版本的 Java 17 (LTS)
- 运行安装包，按照提示安装

---

### Q Apple Silicon Mac 上 Java 安装后无法使用

原因： 可能安装了 Intel 版本的 Java。

解决：
```bash
# 查看已安装的 Java 版本
usrlibexecjava_home -V

# 确保安装了 arm64 版本
# 如果只有 x86_64，重新下载 arm64 版本

# 设置 JAVA_HOME
export JAVA_HOME=LibraryJavaJavaVirtualMachinesjdk-17.jdkContentsHome
```

---

### Q 服务器启动时提示 OutOfMemoryError（内存溢出）

原因： 分配的内存不足。

解决：
```bash
# 启动时指定更大的内存
wow server start --memory 4G

# 或修改配置文件
wow config wow server.jvm_args '[-Xmx4G, -Xms4G, -XX+UseG1GC]'
```

---

### Q 提示 Address already in use 或 端口被占用

原因： 端口 25565（默认）被其他程序占用。

解决：
```bash
# 查看端口占用
sudo lsof -i 25565

# 结束占用进程
kill -9 PID

# 修改服务器端口
wow config server server-port 25566
```

---

### Q 提示 The server is running in offline mode and online-mode is true

原因： 正版验证开启但玩家使用离线登录。

解决：
```bash
# 关闭正版验证
wow config server online-mode false
```

---

### Q EULA 未接受，服务器无法启动

原因： 未接受 Minecraft EULA。

解决：
```bash
# 编辑 eula.txt
nano servereula.txt

# 将 eula=false 改为 eula=true
# 保存退出 (Ctrl+O, Enter, Ctrl+X)
```

或使用命令：
```bash
wow config server eula true
```

---

### Q 路径包含中文导致服务器启动失败

原因： Java 对中文路径支持可能有问题。

解决：
- 将 wow 解压到仅包含英文字母和数字的路径
- 例如：`Users用户名wow` 或 `optwow`

---

## 网络问题

### Q 下载镜像速度慢或无法连接

原因： BMCLAPI2 在某些地区可能不稳定。

解决： 切换镜像源。
```bash
# 切换到 Mojang 官方源
wow set download.mirror httpslauncher.mojang.com

# 或使用自定义镜像
wow set download.mirror httpsmirror.example.com
```

---

### Q 提示 SSL certificate verify failed

原因： 系统 SSL 证书过期或缺失。

解决：
```bash
# 更新证书（通过 Homebrew）
brew install ca-certificates

# 或更新系统证书
sudo usrbinupdate-certificates
```

---

### Q CurseForge  Modrinth 搜索无结果

原因： API 被网络环境限制（如防火墙）。

解决：
- 检查网络代理设置
- 尝试使用 Web 面板的搜索功能
- 手动下载模组后使用 `wow mod install` 安装

---

## 权限问题

### Q 提示 Permission denied 无法写入文件

原因： 文件或目录权限不足。

解决：
```bash
# 确保 wow 目录属于当前用户
sudo chown -R $USERstaff pathtowow

# 给目录添加写权限
chmod -R u+w pathtowow
```

---

### Q 提示 Operation not permitted

原因： macOS 的 SIP（系统完整性保护）限制了某些操作。

解决：
- 将 wow 放在用户目录下（如 `Users用户名wow`）而非系统目录
- 避免在 `System`、`bin` 等受保护目录运行

---

### Q 提示 无法打开文件，因为无法验证开发者

原因： 某些文件被 macOS 隔离。

解决：
```bash
# 解除所有文件的隔离属性
xattr -d com.apple.quarantine pathtowow
```

---

## Java 相关问题

### Q 提示 UnsupportedClassVersionError

原因： Java 版本与 Minecraft 版本不兼容。

兼容性对照表：

 Minecraft 版本  需要 Java 版本  说明 
-------------------------------------
 1.16 及以下  Java 8  旧版本兼容 
 1.17 - 1.20  Java 17  推荐使用 
 1.21+  Java 21  较新版本 

解决： 安装对应的 Java 版本。

```bash
# 安装 Java 17
brew install openjdk@17

# 安装 Java 21
brew install openjdk@21
```

---

### Q 如何查看已安装的 Java 版本？

解决：
```bash
# 查看系统默认 Java 版本
java -version

# 查看所有已安装的 Java
usrlibexecjava_home -V

# 查看 Java 安装路径
which java
```

---

### Q 安装了多个 Java 版本，如何切换？

解决：

方法一：使用 JAVA_HOME
```bash
# 临时切换
export JAVA_HOME=LibraryJavaJavaVirtualMachinesjdk-17.jdkContentsHome

# 永久切换（添加到 ~.zshrc）
echo 'export JAVA_HOME=LibraryJavaJavaVirtualMachinesjdk-17.jdkContentsHome'  ~.zshrc
source ~.zshrc
```

方法二：在 wow 中指定路径
```bash
wow set server.java LibraryJavaJavaVirtualMachinesjdk-17.jdkContentsHomebinjava
```

---

## Apple Silicon 相关问题

### Q 在 Apple Silicon Mac 上运行 Intel 版本程序

原因： 部分程序可能还没有 ARM 版本。

解决： 使用 Rosetta 2 运行 Intel 程序。

```bash
# 检查是否安装了 Rosetta 2
usrbinpgrep -q oahd && echo Rosetta 2 已安装  echo Rosetta 2 未安装

# 如果未安装，执行以下命令安装
softwareupdate --install-rosetta

# 使用 Rosetta 运行
arch -x86_64 binbash start.sh
```

---

### Q Node.js 下载了错误的架构版本

原因： 架构检测可能出错。

解决： 手动删除并重新下载。

```bash
# 删除错误版本
rm -rf corenodedarwin

# 重新运行启动脚本
.start.sh
```

---

### Q Java 在 Apple Silicon 上性能不佳

原因： 可能运行的是 Intel 版本的 Java。

解决：
```bash
# 安装 ARM 原生版本的 Java
brew install openjdk@17

# 确认版本信息
file opthomebrewoptopenjdk@17binjava
# 应显示 Mach-O 64-bit executable arm64
```

---

## 其他问题

### Q 终端显示乱码

原因： 终端编码不是 UTF-8。

解决：
```bash
# 设置终端编码
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 永久生效（添加到 ~.zshrc）
echo 'export LANG=en_US.UTF-8'  ~.zshrc
echo 'export LC_ALL=en_US.UTF-8'  ~.zshrc
source ~.zshrc
```

---

### Q 提示 Too many open files（文件句柄不足）

原因： 系统限制同时打开的文件数量。

解决：
```bash
# 查看当前限制
ulimit -n

# 临时提高限制
ulimit -n 65535

# 永久提高（修改 etcsecuritylimits.conf）
echo ' soft nofile 65535'  sudo tee -a etcsecuritylimits.conf
echo ' hard nofile 65535'  sudo tee -a etcsecuritylimits.conf
```

---

### Q 日志文件过大，磁盘空间不足

解决：
```bash
# 查看日志大小
du -sh serverlogs

# 清空日志
 serverlogslatest.log

# 或删除旧日志
rm serverlogs.log
```

---

### Q 如何查看详细错误信息？

方法：
```bash
# 启用详细输出
wow --verbose server start

# 查看服务器日志
cat serverlogslatest.log

# 查看 wow 自身日志
cat corelogscli.log
```

---

### Q 提示 Operation not permitted 无法监听低端口

原因： macOS 限制了非 root 用户监听 1024 以下端口。

解决：
```bash
# 修改 Web 面板端口为 8080 以上
wow set web.port 8080

# 或使用 root 权限运行
sudo .start.sh web start
```

---

## 快速命令参考

 问题  命令 
------------
 解除隔离属性  `xattr -d com.apple.quarantine 文件` 
 查看端口占用  `sudo lsof -i 25565` 
 查看 Java 版本  `java -version` 
 查看已安装 Java  `usrlibexecjava_home -V` 
 查看系统信息  `system_profiler SPSoftwareDataType` 
 查看架构  `uname -m` 
 安装 Rosetta 2  `softwareupdate --install-rosetta` 

---

## 与 Linux 的主要区别

 操作  macOS  Linux 
--------------------
 包管理器  `brew`  `apt`  `pacman` 
 启动脚本  `.start.sh`  `.start.sh` 
 系统 Java  `java -version`  `java -version` 
 端口占用查看  `sudo lsof -i port`  `lsof -i port` 
 解除隔离  `xattr -d com.apple.quarantine`  无需此操作 
 权限管理  `sudo`  `sudo` 
 环境变量  `~.zshrc`  `~.bashrc` 

---

## 仍然无法解决？

收集以下信息，提交到社区或 Issue 区：

```bash
# 系统信息
system_profiler SPSoftwareDataType

# 架构信息
uname -m

# Java 版本
java -version

# 已安装 Java 列表
usrlibexecjava_home -V

# wow 版本
wow --version

# 配置文件（去除敏感信息）
cat corewow.yaml

# 错误日志（最近 50 行）
tail -50 serverlogslatest.log
```
---

备注： 在macOS上，推荐使用`brew`安装和更新软件，这是最常用的方式。如果用户没有安装Homebrew，建议先执行`binbash -c $(curl -fsSL httpsraw.githubusercontent.comHomebrewinstallHEADinstall.sh)`进行安装。