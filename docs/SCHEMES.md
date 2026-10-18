# 📦 方案管理（模板模式）

> wow~ 使用**模板模式**管理多实例，兼顾硬盘占用与启动速度

---

## 三种多实例模式对比

| 特性 | 隔离模式 | 方案模式 | 模板模式 (wow) |
|------|----------|----------|----------------|
| **文件存储** | 每个实例完整独立 | 全部在 pool 池中 | 方案目录 + pool 池 |
| **资源池** | ❌ 无 | ✅ 全部共享 | ✅ 部分共享 |
| **启动速度** | 🚀 最快 (直接运行) | 🐌 最慢 (需拼凑) | ⚡ 较快 (已补齐) |
| **硬盘占用** | 💾 最大 | 💾 最小 | 💾 小 (同方案模式) |
| **备份方式** | 直接打包目录 | 需重建引用关系 | 可打包方案目录 |
| **实例独立性** | ✅ 完全独立 | ❌ 依赖 pool | ✅ 切换后独立 |
| **代表启动器** | 几乎所有启动器 | 理论模式 (未实现) | **wow 首创** |

### 模式详解

#### 隔离模式 (Isolation Mode)

每个实例拥有完整的独立文件（核心、模组、插件、配置、存档），没有任何资源池。

- **优点**：启动速度最快（直接运行），实例完全独立，打包迁移简单
- **缺点**：硬盘占用大，多个实例重复存储相同文件
- **代表**：绝大多数客户端/服务端启动器

#### 方案模式 (Scheme Mode) — 理论模式

所有资源全部存储在 pool 池中，每次启动时需要从 pool 调取并复制文件来拼凑出一个完整的实例。

- **优点**：硬盘占用最小
- **缺点**：启动速度慢（需要复制文件），备份复杂（需要同时备份 pool 和方案定义）
- **状态**：仅存在于理论设计中，尚无启动器实际实现

#### 模板模式 (Template Mode) — wow 当前模式

**硬盘占用与方案模式相同（小），启动速度接近隔离模式（快）。**

工作方式：
1. 方案创建时，自动判定资源重合状态
2. 初次切换时，从 pool 复制资源补齐方案目录
3. 切换后，方案目录即为完整实例（可快速启动）
4. 切换离开时，自动瘦身（移除可共享资源，减少占用）
5. 方案目录始终包含配置、存档、日志（方案独有内容）

---

## 模板模式核心概念

### 方案状态 (State)

每个方案根据资源存放方式，处于以下三种状态之一：

| 状态 | 图标 | 说明 | 硬盘占用 |
|------|------|------|----------|
| **minimal** | 🟢 | 所有资源都在 pool 中，方案目录仅含配置+存档 | 极小 |
| **partial** | 🟡 | 部分资源在方案目录，部分在 pool 中 | 中等 |
| **full** | 🔵 | 所有资源都在方案目录中（无 pool 引用） | 大 |

### 状态转换

```
创建方案
    │
    ▼
minimal ──(切换方案时自动补齐)──▶ full
    │                         │
    │                         │
    └──(auto_scheme)──────────┘
        切换时自动补齐/瘦身
```

### 资源池 (pool)

`core/pool/` 目录是共享资源仓库，存储所有被多个方案引用的文件：

```
core/pool/
├── index.yaml              # 资源索引 (SHA-256 → 路径 + 引用计数)
├── cores/                  # 服务端核心
│   ├── vanilla/1.20.1/
│   └── forge/1.20.1/
├── mods/                   # 模组库 (按加载器/版本)
│   └── forge/1.20.1/
└── plugins/                # 插件库 (按加载器)
    └── bukkit/
```

资源通过 **SHA-256 哈希值** 判定是否相同，相同文件共享同一份存储。

### 资源引用计数

pool 中的每个资源都记录被多少个方案引用。当引用计数归零时，资源可被自动清理。

```yaml
# pool/index.yaml 示例
resources:
  abc123def456...: cores/forge/1.20.1/forge-1.20.1.jar
  def456ghi789...: mods/forge/1.20.1/JEI.jar
ref_count:
  abc123def456...: 3    # 被 3 个方案引用
  def456ghi789...: 1    # 被 1 个方案引用
```

---

## 自动管理 (auto_scheme)

`wow.yaml` 中的 `auto_scheme` 控制是否自动管理方案状态：

| 设置 | 行为 |
|------|------|
| `auto_scheme: true` | ✅ 切换时自动补齐目标方案，自动瘦身旧方案<br>✅ 自动清理未被引用的 pool 资源 |
| `auto_scheme: false` | ⚠️ 切换时仅更新当前方案指针，不操作资源<br>⚠️ 需要自行手动复制/删除资源文件 |

```yaml
# wow.yaml
auto_scheme: true   # 默认启用
```

> 💡 补齐（pull）与瘦身（prune）目前是 `scheme switch` 的内部行为，由 `auto_scheme`
> 自动触发，**没有对应的手动命令**。把 `auto_scheme` 设为 `false` 后，切换方案不再
> 自动补齐/瘦身，资源需要你自己管理。

---

## 命令详解

### `scheme create <name>`

创建方案时自动判定资源重合状态：

```bash
wow scheme create survival -v 1.20.1 -t vanilla
```

**判定逻辑：**
1. 计算所需资源的 SHA-256
2. 与 pool/index.yaml 比对
3. 若全部命中 → `minimal`
4. 若部分命中 → `partial`
5. 若全部未命中 → `full`

---

### `scheme switch <name>`

从 V3.4.1 起，服务器**直接在方案目录下运行**；V3.5.2 起方案目录由 `core/schemes/` 迁移到项目根 `scheme/<方案>/`，且不再把方案复制到 `server/`（该目录已移除）。切换方案时（`auto_scheme: true`）：

1. 检查目标方案状态
2. 若不是 `full`，从 pool 复制资源补齐（`pull` 逻辑）
3. 登记 `server.scheme`（写入 `core/wow.yaml`），无需移动/复制任何文件
4. 瘦身旧方案（`prune` 逻辑）
5. 清理未被引用的 pool 资源

> 世界存档、配置文件等全部保留在各自方案目录内，切换方案不会丢失数据，也不会影响其它方案。

```bash
wow scheme switch survival
```

---

### 补齐与瘦身（`scheme switch` 的内部行为）

补齐（pull）与瘦身（prune）没有独立命令，它们在 `scheme switch` 时按
`auto_scheme` 设置自动执行：

```bash
# auto_scheme: true（默认）时，切换即自动完成补齐 + 瘦身
wow scheme switch survival

# 查看方案详情（含状态 minimal/partial/full）
wow scheme info survival
```

`scheme info` 的输出包含状态、版本、加载器、核心与资源引用信息，
相当于早期文档中的 `scheme status`。

> 📌 **尚未提供**：手动的 `scheme pull` / `scheme prune` / `scheme status` 命令，
> 以及 `pool stats` / `pool prune`。资源统计可查看 `core/pool/index.yaml`，
> 未引用资源在 `auto_scheme: true` 时会自动清理。

---

## 方案目录结构

```
scheme/{scheme_name}/
├── scheme.yaml              # 方案元数据 (状态、资源引用)
├── <核心>.jar                # 核心文件 (如 paper-1.20.1.jar；或共享自 pool)
├── mods/                    # 模组文件 (或指向 pool)
│   └── JEI.jar
├── plugins/                 # 插件文件 (或指向 pool)
│   └── Essentials.jar
├── libraries/               # Forge / NeoForge 的核心与库文件位于此处 (深层)
│   └── net/minecraftforge/forge/1.20.1-47.2.0/
├── world/                   # 存档 (方案独有)
│   ├── region/
│   └── level.dat
├── config/                  # 模组配置 (方案独有)
│   └── jei.toml
├── logs/                    # 日志 (方案独有)
│   └── latest.log
├── server.properties        # Minecraft 配置 (方案独有)
├── bukkit.yml               # 加载器配置 (方案独有)
├── spigot.yml               # 加载器配置 (方案独有)
└── eula.txt                 # EULA (方案独有)
```

> Forge / NeoForge 方案的核心在 `libraries/` 深层（1.21+ 甚至只有 args 文件、
> 没有独立核心 jar），`scheme.yaml` 的 `resources.core.file` 记录的是**相对路径**。

---

## 方案元数据 (`scheme.yaml`)

```yaml
name: survival
version: 1.20.1
loader: vanilla
type: vanilla
build: null
state: minimal
created_at: 2026-07-22T10:00:00.000Z
updated_at: 2026-07-22T14:30:00.000Z
compatibility:
  java: 17
  loaders: [vanilla]

resources:
  core:
    # V3.5.8 起记录「相对方案根目录」的完整路径（Forge 核心在 libraries/ 深层）；
    # 老方案这里是纯文件名，读取端兼容两种格式
    file: minecraft_server.1.20.1.jar
    hash: abc123def456...
    in_pool: true
    pool_path: pool/cores/vanilla/1.20.1/minecraft_server.1.20.1.jar
  mods: []
  plugins: []

unique_resources: []
world:
  exists: false
  size: 0
```

---

## 工作流示例

### 创建多个共享资源的方案

```bash
# 1. 创建第一个方案 (所有资源未命中 pool → full)
wow scheme create server_a -v 1.20.1 -t forge
wow scheme switch server_a

# 2. 安装模组：进入数字菜单第 10 项「模组/插件搜索下载」，
#    或用 Web 面板上传（装进当前方案的 mods/ 并计入 pool）
#    URL 下载 / 本地文件两种方式都支持

# 3. 创建第二个方案 (部分资源命中 pool → partial)
wow scheme create server_b -v 1.20.1 -t forge
wow scheme switch server_b
# JEI.jar 等已入 pool 的模组会随切换自动补齐，无需重新下载
```

### 手动管理资源

`auto_scheme: false` 时，切换方案只更新指针，不自动补齐/瘦身：

```bash
# 1. 关闭自动管理
wow set auto_scheme false

# 2. 切换方案（仅更新指针）
wow scheme switch survival

# 3. 资源需自行管理：
#    补齐 = 从 core/pool/ 手动复制所需文件到 scheme/<方案名>/
#    瘦身 = 手动删除方案目录中可共享的文件
#    未引用资源清理 = 手动删除 core/pool/ 中的对应文件
```

---

## 备份与迁移

### 打包方案

直接打包 `scheme/<方案名>/` 目录即可完整迁移一个方案
（核心、模组、配置、存档都在里面）：

```bash
# 打包方案目录
tar -czf survival.tar.gz scheme/survival/

# 或使用 zip
zip -r survival.zip scheme/survival/
```

> 📌 `scheme export` / `scheme import` 命令**尚未提供**。
> 若方案处于 `minimal` 状态（资源在 pool 中），迁移时需一并打包
> `core/pool/`，或先切换到该方案让其自动补齐为 `full` 再打包。

---

## 与隔离模式对比总结

| 场景 | 隔离模式 | 模板模式 (wow) |
|------|----------|----------------|
| 创建 3 个 Forge 1.20.1 服务器 | 3 份 Forge 核心 (约 1.5GB) | 1 份 Forge 核心 (约 500MB) |
| 启动速度 | 直接启动 (快) | 补齐后启动 (接近快) |
| 硬盘占用 | 大 | 小 |
| 迁移 | 直接打包 | 打包 `scheme/<方案名>/` 目录 |
| 添加新模组 | 每个实例单独添加 | 一个实例添加，其他可同步 |