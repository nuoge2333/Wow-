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
minimal ──(scheme pull)──▶ full
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
| `auto_scheme: false` | ⚠️ 切换时仅更新链接，不操作资源<br>⚠️ 需要手动执行 `pull`/`prune` |

```yaml
# wow.yaml
auto_scheme: true   # 默认启用
```

> 执行 `scheme pull` 或 `scheme prune` 时，`auto_scheme` 自动设为 `false`，进入手动管理模式。

---

## 命令详解

### `scheme create <name>`

创建方案时自动判定资源重合状态：

```bash
wow scheme create survival --version 1.20.1 --type vanilla
```

**判定逻辑：**
1. 计算所需资源的 SHA-256
2. 与 pool/index.yaml 比对
3. 若全部命中 → `minimal`
4. 若部分命中 → `partial`
5. 若全部未命中 → `full`

---

### `scheme switch <name>`

切换方案时（`auto_scheme: true`）：

1. 检查目标方案状态
2. 若不是 `full`，从 pool 复制资源补齐（`pull` 逻辑）
3. 备份并清空 `server/` 目录
4. 复制目标方案到 `server/`
5. 瘦身旧方案（`prune` 逻辑）
6. 清理未被引用的 pool 资源

```bash
wow scheme switch survival
```

---

### `scheme pull <name>`

强制将方案补齐为完整实例（`full` 状态）：

```bash
wow scheme pull survival
```

执行后 `auto_scheme` 自动设为 `false`。

---

### `scheme prune <name>`

强制瘦身方案（转为 `minimal` 状态）：

```bash
wow scheme prune survival
```

执行后 `auto_scheme` 自动设为 `false`。

---

### `scheme status [name]`

查看方案的详细状态：

```bash
wow scheme status survival
```

**输出示例：**
```
📊 方案状态: survival
============================================================
  状态: minimal
  版本: 1.20.1
  加载器: vanilla
  核心: minecraft_server.1.20.1.jar (🔄 共享)
  模组: 0 个 (共享: 0, 独有: 0)
  插件: 0 个 (共享: 0, 独有: 0)
  世界: ✅ 存在
  独有资源: 0 个
============================================================
```

---

### `pool stats`

查看资源池统计信息：

```bash
wow pool stats
```

**输出示例：**
```
📊 Pool 统计:
  总资源数: 45
  被引用资源数: 38
  未引用资源数: 7
  按类型分布:
    cores: 5
    mods: 28
    plugins: 12
```

---

### `pool prune`

手动清理未被引用的 pool 资源：

```bash
wow pool prune
```

---

## 方案目录结构

```
core/schemes/{scheme_name}/
├── scheme.yaml              # 方案元数据 (状态、资源引用)
├── server.jar               # 核心文件 (或指向 pool)
├── mods/                    # 模组文件 (或指向 pool)
│   └── JEI.jar
├── plugins/                 # 插件文件 (或指向 pool)
│   └── Essentials.jar
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

---

## 方案元数据 (`scheme.yaml`)

```yaml
name: survival
version: 1.20.1
engine: vanilla
state: minimal
created_at: 2026-07-22T10:00:00.000Z
updated_at: 2026-07-22T14:30:00.000Z

resources:
  core:
    file: minecraft_server.1.20.1.jar
    hash: abc123def456...
    in_pool: true
    pool_path: pool/cores/vanilla/1.20.1/minecraft_server.1.20.1.jar
  mods: []
  plugins: []

unique_resources: []
```

---

## 工作流示例

### 创建多个共享资源的方案

```bash
# 1. 创建第一个方案 (所有资源未命中 pool → full)
wow scheme create server_a --version 1.20.1 --loader forge --type forge
wow scheme switch server_a
wow mod install https://example.com/JEI.jar
wow mod install https://example.com/Create.jar

# 2. 创建第二个方案 (部分资源命中 pool → partial)
wow scheme create server_b --version 1.20.1 --loader forge --type forge
wow scheme switch server_b
# JEI.jar 从 pool 自动复制 (无需重新下载)
# Create.jar 从 pool 自动复制
wow mod install https://example.com/WorldEdit.jar  # 新增，加入 pool
```

### 手动管理方案

```bash
# 1. 切换方案 (auto_scheme: false)
wow set auto_scheme false
wow scheme switch survival

# 2. 手动补齐
wow scheme pull survival

# 3. 手动瘦身
wow scheme prune survival

# 4. 查看 pool 状态
wow pool stats

# 5. 清理未引用资源
wow pool prune
```

---

## 备份与迁移

### 打包方案

```bash
wow scheme export survival
# 生成 survival.zip (包含方案目录 + 所需 pool 资源)
```

### 导入方案

```bash
wow scheme import survival.zip
# 自动解析并创建方案
```

---

## 与隔离模式对比总结

| 场景 | 隔离模式 | 模板模式 (wow) |
|------|----------|----------------|
| 创建 3 个 Forge 1.20.1 服务器 | 3 份 Forge 核心 (约 1.5GB) | 1 份 Forge 核心 (约 500MB) |
| 启动速度 | 直接启动 (快) | 补齐后启动 (接近快) |
| 硬盘占用 | 大 | 小 |
| 迁移 | 直接打包 | 使用 `scheme export` |
| 添加新模组 | 每个实例单独添加 | 一个实例添加，其他可同步 |