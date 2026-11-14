# 🔄 跨设备方案同步（wow sync）

> 把一台机器上调好的方案，一条命令搬到另一台跑 `wow web start` 的机器上。

---

## 架构

```
控制端（方案在这）                      执行端（wow web start 在这）
┌─────────────────────┐               ┌──────────────────────────────┐
│ wow sync push <url>  │  HTTP + JWT   │ /api/sync/check     预检缺口  │
│  1. 生成清单（哈希）   │ ────────────▶ │ /api/sync/upload    收文件    │
│  2. 差量上传缺口      │ ◀──────────── │ /api/sync/upload/status 断点  │
│  3. 通知组装          │               │ /api/sync/finalize  组装入池  │
└─────────────────────┘               └──────────────────────────────┘
```

- **两端跑的都是同一份 wow**，谁都可以是控制端或执行端，没有协议差异。
- 认证复用 Web 面板的 JWT：`wow sync login <url>` 存凭据（按 URL 区分多个执行端）。

## 网络路径（按优先级）

| 路径 | 说明 |
|------|------|
| 公网 IP | 执行端有公网 IP 时直接 `http://ip:port` |
| Cloudflare Tunnel | 执行端 `wow tunnel` 起 Tunnel，控制端走 `https://xxx.trycloudflare.com`。注意 Tunnel 单请求 ~100s 超时，所以**核心装配放在组装阶段**，不会挂在 check 请求里 |
| EasyTier 虚拟 IP | 双方都装 EasyTier 组网后走虚拟 IP（`http://<虚拟IP>:port`） |

## 命令

```bash
# 控制端
wow sync login <url> [-p password]     # 登录并保存 JWT（之后 push 不用再输密码）
wow sync push <url> [--scheme X] [--name Y] [--with-world] [--with-config]
wow sync list                          # 查看已保存的执行端

# 执行端
wow web start                          # 开面板即可，sync 端点自动挂载
```

`push` 参数：

| 参数 | 说明 |
|------|------|
| `--scheme X` | 控制端要推的方案名（缺省用当前激活方案） |
| `--name Y` | 推到执行端时用的方案名（缺省与 X 相同） |
| `--with-world` | 连存档（world）一起同步，默认不带 |
| `--with-config` | 允许覆盖执行端的 `server.properties`/`eula.txt`（覆盖前自动备份 `.bak`），默认不覆盖 |

## 四阶段流程

1. **清单先行**：扫描方案产出 `manifest.protocol = 2`——核心 + 模组 + 插件 + 其它文件 + root 配置，全部带 SHA-256 与大小；模组/插件额外带 SHA-512 与 SHA-1（只用于问 Modrinth，不参与任何写入决策）。执行端收到 v1 旧清单时跳过 Modrinth 查询，全部按需上传处理。
2. **执行端预检**：逐文件判定缺口。预检通过即建方案骨架（幂等）。方案名冲突时：非同步来源（手工创建、clone-client 等）一律拒绝；同步来源的方案允许重推（增量 / 续传）。

   **模组比对**（pool → Modrinth → 仍缺才要上传）：

   ```
   1. 查 pool 有无同 SHA-256 → 有则复用；
   2. 无则用 SHA-512 批量查 Modrinth → 命中则下载；
   3. 下载后算 SHA-256 与清单比对 → 匹配则复用，不匹配则标记需上传；
   4. Modrinth 未命中或查询失败 → 标记需上传。
   ```

   Modrinth 查询细节：每批 100 个哈希、批间隔 200ms、单批 30s 超时、连续 3 批失败即整体放弃；
   整个补齐阶段有 90s 总预算（`WOW_MODRINTH_BUDGET_MS` 可覆盖），超预算的文件直接降级为需上传。
   SHA-512 被拒（400/422）时该批自动降级用 SHA-1 重试一次。
3. **差量上传**：≤4MB 的小文件打包 JSON 束；大文件 8MB 分块上传，支持断点续传（中断后重跑 `push` 自动从已收偏移继续）。所有上传先进 `core/temp/sync_staging/`。
4. **组装**：执行端把 staging 校验落盘（落盘前重算哈希）、核心走安装器装配、`server.properties` 按需备份覆盖、资源入池、写 `sync_report`、state 置 `full`。**不会自动启动服务器**——需要 `wow scheme switch <名>` 后手动开服。

## 安全边界

| 边界 | 规则 |
|------|------|
| 方案名冲突 | 非同步来源一律拒绝（409），不覆盖不合并 |
| 配置文件 | 默认不覆盖；`--with-config` 才覆盖且先备份 `.bak` |
| 存档 | 仅显式 `--with-world` 才同步 |
| 方向 | 单向：控制端 → 执行端，执行端不回传 |
| 扩展名 | `.jar .json .toml .yaml .yml .properties .cfg .txt .dat .mca .mcr .tar` |
| 路径 | `mods plugins config kubejs scripts datapacks world` + `server.properties`/`eula.txt`；拒绝 `..`、绝对路径、盘符、UNC、符号链接 |
| 大小 | 单文件 ≤200MB，总量 ≤2GB |
| 校验 | 上传声明哈希 + 落盘前重算哈希，双保险；不匹配返回 422 并清 staging |
| Modrinth | 下载的文件必须通过 SHA-256 校验才写入方案目录；不信任 Modrinth 返回的文件名（一律按清单 path 落盘，临时目录 `core/temp/sync-modrinth/` 用完即清） |

## 已知限制

- Modrinth 查询有速率限制（约 300 请求/分钟），超大整合包（> 500 模组）首次同步时查询耗时较长。失败会自动降级为需上传，不中断同步。
- Modrinth 上不存在的模组（本地魔改、私有的）仍需控制端上传。
- 执行端到 Modrinth CDN 的下行带宽决定补齐速度；极慢时会触发 90s 总预算，剩余模组转为需上传（重跑 `push` 即可补齐）。
- 核心装配要求执行端有可用的 Java 环境与网络（Forge/Fabric 安装器要下载文件）。
