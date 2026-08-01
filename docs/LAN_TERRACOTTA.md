# 🌐 联机 / 内网穿透（陶瓦 Terracotta）— V3.3.0

wow~ V3.3.0 起内置对接 **[陶瓦（Terracotta）](https://github.com/burningtnt/Terracotta)**，为你的 Minecraft 服务端提供开箱即用的内网 / 局域网穿透联机能力。没有公网 IP 也能让好友直接加入。

> ⚠️ **3.3.0 范围**：仅实现 **房主端（「我要当房主」）**。加入端由 **PCL / HMCL / BakaXL / FCL** 等启动器内置支持，wow~ 无需也不实现加入逻辑。

---

## 一、它是怎么工作的

陶瓦（Terracotta）是一个基于 EasyTier 的 Minecraft: Java Edition 联机工具。wow~ 在本地拉起**未经修改的陶瓦二进制**，并通过其提供的**本地 HTTP API** 与之交互（符合陶瓦 AGPLv3 的例外条款，wow~ 自身仍保持 MIT 许可）。

流程简述：

1. 你先启动 Minecraft 服务端（`wow server start` 或 Web 面板启动）。
2. wow~ 启动陶瓦二进制（以 `--hmcl` 模式，二进制会把动态分配的本地 API 端口写入文件供 wow~ 读取）。
3. wow~ 调用陶瓦 `GET /state/scanning`，陶瓦**自动扫描本机正在运行的 Minecraft 服务端端口**并建立穿透通道。
4. 开房成功后，陶瓦返回**房间号（room code）**——这就是好友加入的凭证。
5. 好友在启动器中选择「加入陶瓦房间」并输入该房间号即可联机。

> 房间号本身就是加入凭证，陶瓦没有独立的「密码」参数；如不填写固定房间号，陶瓦会自动生成一个。

---

## 二、如何开房

### 方式一：命令行
```bash
wow lan host                 # 开房（房间号自动生成）
wow lan host -r ABCD-EFGH    # 使用固定房间号（按需）
wow lan status               # 查看房间号 / 状态 / 本地 API 端口
wow lan stop                 # 关房（停止陶瓦）
```

### 方式二：交互式菜单
运行 `wow m`，选择第 **15** 项「联机 / 我要当房主」：

```
1. 我要当房主（开房）
2. 查看房间号 / 状态
3. 关房（停止陶瓦）
0. 返回
```

### 方式三：Web 面板
左侧菜单「🌐 联机(陶瓦)」页：
- 点击 **🏠 我要当房主（开房）** —— 首次会从 Gitee 镜像下载陶瓦二进制（约 8–14 MB），请耐心等待；
- 页面展示**房间号**与运行状态；
- 可填写「固定房间号」后再开房（留空 = 自动生成）；
- 提供「🔄 刷新状态」「🛑 关房」。

开房成功后，把页面上的**房间号**发给好友即可。

---

## 三、好友如何加入

好友**不需要** wow~，也不需要公网 IP。让对方在以下任一启动器中选择「加入陶瓦房间 / 加入房间」，输入你提供的房间号即可：

- **PCL**（PCL2）
- **HMCL**
- **BakaXL**
- **FCL**（Android）

---

## 四、配置（core/wow.yaml 的 `lan` 段）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `auto_room` | boolean | `false` | 设为 `true` 后，启动 Minecraft 服务端时**自动开房**、停止服务端时**自动关房**（适合后台 / Docker 场景） |
| `room_code` | string | `''` | 固定房间号（留空 = 陶瓦自动生成） |
| `server_port` | number | `25565` | 本地 MC 服务端端口（陶瓦会自动扫描，无需手动传递） |
| `mirror` | string | `https://gitee.com/burningtnt/Terracotta/releases` | 陶瓦二进制下载镜像（默认 Gitee 国内镜像） |
| `version` | string | `0.4.2` | 陶瓦版本号（对应 release tag） |
| `binary_url` | string | `''` | 二进制完整下载地址（留空 = 按 `mirror`/`version`/平台自动拼装；如镜像不可用可手动填写） |

示例：
```yaml
lan:
  auto_room: true          # 服务器启动即自动开房
  room_code: ''            # 房间号自动生成
  server_port: 25565
  mirror: 'https://gitee.com/burningtnt/Terracotta/releases'
  version: '0.4.2'
  binary_url: ''
```

修改配置后无需重启 wow~（开房时实时读取）。

---

## 五、许可与版权（重要）

陶瓦以 **GNU Affero General Public License v3.0 or later** 发布，并附例外条款：

> 若你的程序通过陶瓦提供的进程间通信接口（如 HTTP API）与之交互，且在用户界面明显处标识其版权信息，则不会导致你的作品被 AGPL 协议涵盖。

wow~ 据此在 **CLI 输出、Web 面板「联机(陶瓦)」页、交互菜单** 中显著标注：

```
Powered by Terracotta | 陶瓦联机 — https://github.com/burningtnt/Terracotta (AGPLv3)
```

并已在 `README.MD` 致谢中列出。wow~ 本身仍保持 **MIT 许可**，未修改或静态链接陶瓦二进制。

---

## 六、常见问题

- **首次开房很慢 / 卡在下载**：会从 Gitee 镜像下载陶瓦二进制（Linux x64 约 9.7 MB）。若网络到 Gitee 不通，可在 `lan.binary_url` 填写 GitHub 直链，例如：
  `https://github.com/burningtnt/Terracotta/releases/download/v0.4.2/terracotta-0.4.2-linux-x86_64-pkg.tar.gz`
- **开房失败 / 一直 scanning**：确认 Minecraft 服务端已启动并监听 `server_port`（默认 25565），且本机网络可访问陶瓦公共节点。
- **想固定房间号**：在 `lan.room_code` 填写，或在 `wow lan host -r <房间号>` 指定；若格式不被陶瓦接受，陶瓦会自动重新生成一个（不会报错）。
- **关不掉房间**：`wow lan stop` 会先通过陶瓦 API 优雅退出，失败时回退为终止进程；也可直接结束陶瓦进程（运行时状态记录在 `core/.lan.json`）。
- **平台支持**：自动下载支持 Windows / macOS / Linux 的 x64 与 arm64（Linux 为 musl 静态二进制，免 glibc 依赖）。其它架构请改用 `lan.binary_url` 手动提供。
