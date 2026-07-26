## `docs/TROUBLE_WINDOWS.md`

```markdown
# 🛠️ Windows 故障排除

> 适用于 Windows 10、Windows 11 及 Windows Server 2016+
> Windows 7用户运行前请安装Powershell
> 请注意：**自1.21起，mojang宣布使用Java21，官方文档声称不再支持Windows 7，建议安装Windows 11以安装高版本**
> Windows Vista、Windows XP及以下用户存在严重的兼容性问题，建议安装高版本，或采取特殊手段

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

### Q: 双击 `start.bat` 闪退

**原因：** 路径包含空格或中文字符。

**解决：**
- 将 wow 解压到**不包含空格和中文**的路径，例如 `C:\wow` 或 `D:\Servers\wow`
- 右键 `start.bat` → 编辑，在最后一行加上 `pause`，然后双击查看具体错误信息

---

### Q: 提示 "node.exe 不是内部或外部命令"

**原因：** Node.js 未成功下载或未正确安装。

**解决：**
```batch
# 手动下载 Node.js 放入指定目录
# 1. 访问 https://nodejs.org/dist/v20.17.0/
# 2. 下载 node-v20.17.0-win-x64.zip
# 3. 解压到 core/node/win/x64/
# 确保 core/node/win/x64/node.exe 存在
```

---

### Q: PowerShell 下载 Node.js 失败

**原因：** 网络问题或 PowerShell 版本过低。

**解决：**

**方法一：设置 TLS 1.2**
打开 PowerShell 管理员模式，执行：
```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
```

**方法二：手动下载**
- 访问 https://nodejs.org/dist/v20.17.0/
- 下载 `node-v20.17.0-win-x64.zip`
- 手动解压到 `core/node/win/x64/`

---

### Q: 启动后显示 "系统找不到指定的文件"

**原因：** 脚本中的路径格式不正确。

**解决：**
- 确保 `core/` 目录与 `start.bat` 在同一级目录
- 检查 `start.bat` 中 `CORE_DIR` 路径是否正确

---

### Q: 终端显示乱码（中文显示为 ???）

**原因：** 终端代码页不是 UTF-8（65001）。

**解决：**
```batch
# 在 start.bat 中已包含 chcp 65001
# 如果仍然乱码，手动设置终端字体为 "Consolas" 或 "Lucida Console"
```

**PowerShell 用户：**
```powershell
# 设置编码
chcp 65001
$OutputEncoding = [System.Text.Encoding]::UTF8
```

---

### Q: Windows 安全中心阻止运行脚本

**原因：** 脚本被 Windows Defender 误报。

**解决：**
1. 打开 Windows 安全中心
2. 选择 "病毒和威胁防护"
3. 点击 "管理设置"
4. 添加排除项 → 选择 wow 所在文件夹
5. 重新运行 start.bat

---

## 服务器启动问题

### Q: 提示 "Java not found" 或 "未找到 Java"

**原因：** 系统没有安装 Java，或 Java 不在 PATH 中。

**解决：**

**方法一：安装 Java**
- 访问 https://adoptium.net/
- 下载 Java 17 (LTS) 或 Java 8
- 运行安装程序，记住安装路径

**方法二：手动指定 Java 路径**
```bash
wow set server.java "C:\Program Files\Java\jdk-17.0.12\bin\java.exe"
```

---

### Q: 服务器启动时提示 "OutOfMemoryError"（内存溢出）

**原因：** 分配的内存不足。

**解决：**
```bash
# 启动时指定更大的内存（例如 4G）
wow server start --memory 4G

# 或修改配置文件
wow config wow server.jvm_args '["-Xmx4G", "-Xms4G", "-XX:+UseG1GC"]'
```

---

### Q: 提示 "Address already in use" 或 "端口被占用"

**原因：** 端口 25565（默认）被其他程序占用。

**解决：**
```cmd
# 查看端口占用
netstat -ano | findstr :25565

# 找到占用进程的 PID 后，结束进程
taskkill /PID <PID> /F
```

```bash
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
- 用记事本打开 `server/eula.txt`
- 将 `eula=false` 改为 `eula=true`
- 保存文件

或使用命令：
```bash
wow config server eula true
```

---

### Q: 路径包含中文导致服务器启动失败

**原因：** Java 或 Minecraft 对中文路径支持不佳。

**解决：**
- 将 wow 解压到**仅包含英文字母和数字**的路径
- 例如：`C:\wow`、`D:\Servers\wow`

---

## 网络问题

### Q: 下载镜像速度慢或无法连接

**原因：** BMCLAPI2 在国内某些地区可能不稳定。

**解决：**
```bash
# 切换到 Mojang 官方源
wow set download.mirror https://launcher.mojang.com

# 或使用自定义镜像
wow set download.mirror https://mirror.example.com
```

---

### Q: CurseForge / Modrinth 搜索无结果

**原因：** API 被网络环境限制（如防火墙）。

**解决：**
- 检查 Windows 防火墙设置
- 尝试使用 Web 面板的搜索功能
- 手动下载模组后使用 `wow mod install` 安装

---

### Q: 提示 "SSL certificate verify failed"

**原因：** Windows 的 CA 证书过期。

**解决：**
- 安装 Windows 最新更新
- 或手动下载证书更新包

---

## 权限问题

### Q: 提示 "拒绝访问" 或 "Access denied"

**原因：** 当前用户没有写入权限。

**解决：**
1. 右键点击 wow 文件夹 → 属性
2. 安全 → 编辑
3. 添加当前用户 → 勾选 "完全控制"
4. 确定

**或使用管理员权限运行：**
- 右键点击 `start.bat` → 以管理员身份运行

---

### Q: 提示 "无法创建文件"

**原因：** 文件被其他程序占用（如杀毒软件）。

**解决：**
- 临时关闭 Windows Defender 或第三方杀毒软件
- 或将 wow 文件夹添加到杀毒软件排除列表

---

### Q: 提示 "脚本执行被禁用"

**原因：** PowerShell 执行策略限制。

**解决：**
```powershell
# 以管理员身份打开 PowerShell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Java 相关问题

### Q: 提示 "UnsupportedClassVersionError"

**原因：** Java 版本与 Minecraft 版本不兼容。

**兼容性对照表：**

| Minecraft 版本 | 需要 Java 版本 |
|----------------|---------------|
| 1.16 及以下 | Java 8 |
| 1.17 - 1.20 | Java 17 |
| 1.21+ | Java 21 |

**解决：** 安装对应的 Java 版本。

---

### Q: Java 路径包含空格导致启动失败

**原因：** 默认 Java 安装路径 `C:\Program Files\Java\` 包含空格。

**解决：**
```bash
# 使用短路径或引号
wow set server.java "C:\Program Files\Java\jdk-17\bin\java.exe"

# 或使用环境变量
wow set server.java %JAVA_HOME%\bin\java.exe
```

---

### Q: 安装了多个 Java 版本，如何切换？

**解决：**

**方法一：修改环境变量 JAVA_HOME**
1. 右键 "此电脑" → 属性 → 高级系统设置
2. 环境变量 → 系统变量
3. 修改 JAVA_HOME 指向目标 Java 版本

**方法二：在 wow 中指定路径**
```bash
wow set server.java "C:\Program Files\Java\jdk-17\bin\java.exe"
```

---

## 其他问题

### Q: 日志文件过大，磁盘空间不足

**解决：**
```cmd
# 查看日志大小
dir server\logs\

# 清空日志
type nul > server\logs\latest.log
```

### Q: 如何查看详细错误信息？

**方法：**
```bash
# 启用详细输出
wow --verbose server start

# 查看服务器日志
type server\logs\latest.log

# 查看 wow 自身日志
type core\logs\cli.log
```

### Q: 提示 "系统资源不足，无法完成请求的服务"

**原因：** 可用内存或磁盘空间不足。

**解决：**
- 关闭其他大型程序释放内存
- 清理磁盘空间（至少保留 2GB 可用空间）
- 增加虚拟内存：系统属性 → 高级 → 性能 → 虚拟内存 → 更改

### Q: 提示 "Error: Cannot find module"

**原因：** 依赖包未正确安装。

**解决：**
```bash
# 重新安装依赖
cd core
npm install
```

---

## 快速命令参考

| 问题 | 命令 |
|------|------|
| 查看端口占用 | `netstat -ano \| findstr :25565` |
| 结束进程 | `taskkill /PID <PID> /F` |
| 查看 Java 版本 | `java -version` |
| 查看系统信息 | `systeminfo` |
| 设置 PowerShell 执行策略 | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |

---

## 与 Linux 的主要区别

| 操作 | Windows | Linux |
|------|---------|-------|
| 启动脚本 | `start.bat` | `start.sh` |
| 路径分隔符 | `\` | `/` |
| 系统 Java | `java -version` | `java -version` |
| 端口占用查看 | `netstat -ano` | `lsof -i :port` |
| 管理员权限 | 右键 → 以管理员身份运行 | `sudo` |
| 环境变量 | 系统属性 → 环境变量 | `~/.bashrc` |

---

## 仍然无法解决？

收集以下信息，提交到社区或 Issue 区：

```cmd
# 系统信息
systeminfo

# Java 版本
java -version

# wow 版本
wow --version

# 配置文件（去除敏感信息）
type core\wow.yaml

# 错误日志（最近 50 行）
tail -50 server\logs\latest.log
```