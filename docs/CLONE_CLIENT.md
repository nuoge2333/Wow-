# 客户端一键克隆为方案

> `wow scheme clone-client <客户端路径> [--name <方案名>]`
>
> 把一个 Minecraft 客户端实例变成 wow 方案。产物是**方案**，不是目录。

---

## 一句话理解

不是「把 `.minecraft` 复制一份」，而是：

1. 先建方案骨架（走 `scheme create` 同一套目录与 `scheme.yaml` 逻辑）；
2. 再往方案目录里填内容；
3. 结束时入池登记、状态转 `full`。

所以克隆完成后，`scheme list` / `scheme switch` / `server start` 全套可用，
和其他方案走同一套生命周期。

---

## 基本用法

```bash
# 预检：只识别、不创建
wow scheme clone-client ~/.minecraft/versions/1.20.1-forge-47.2.0 --dry-run

# 正式克隆（交互式：选存档、确认方案名）
wow scheme clone-client ~/.minecraft/versions/1.20.1-forge-47.2.0

# 全自动（不交互，全部用默认值）
wow scheme clone-client ~/.minecraft --name myserver --save 生存世界 --yes
```

| 选项 | 说明 |
|------|------|
| `-n, --name <name>` | 方案名，默认取实例目录名 |
| `-t, --type <type>` | 手动指定核心类型（识别失败时用） |
| `-v, --version <version>` | 手动指定 MC 版本（识别失败时用） |
| `--save <name>` | 要迁移的存档名；填 `-` 表示不迁移 |
| `--dry-run` | 只识别与检查，不创建任何东西 |
| `--yes` | 不交互，全部用默认值 |
| `--extra-client-mods <list>` | 追加的客户端模组 modid，逗号分隔 |
| `--keep-mods <list>` | 强制保留的 modid，逗号分隔（优先级最高） |

---

## 九步流水线

### 第 0 步 · 定位实例

你给的路径可以是下面任意一种：

| 你给的路径 | 判定 |
|-----------|------|
| 含 `versions/` 子目录 | 游戏根目录 → 列出实例让你用数字选 |
| 本身是 `versions/<实例>/` | 实例目录 → 直接用 |
| 含 `mods/` 或 `config/` 但没有 `versions/` | 疑似「未开版本隔离」的实例 → 提示确认 |
| 以上都不是 | 向上找最多 2 级，重复判断 |

路径会先做清洗：`~` / `~/` 展开、终端拖拽的 `\ ` 转义还原、
包裹引号去掉、`file://` 前缀剥离。

**加载器与版本识别**读 `versions/<实例>/<实例>.json`：

| 信号 | 用途 |
|------|------|
| `inheritsFrom` | MC 版本 |
| `mainClass` | fabric / quilt / neoforge / forge / paper |
| `libraries` 里的 `fabric-loader` / `quilt-loader` / `neoforge` / `forge` | 加载器 + 加载器版本 |
| `arguments.game` 里的 `--fml.forgeVersion` / `--launchTarget` | 现代 Forge 的加载器信号 |

> **关于现代 Forge 的坑**：1.17 之后 Forge/NeoForge 客户端的 `mainClass` 是
> `cpw.mods.bootstraplauncher.BootstrapLauncher`，**名字里不含 "forge"**，
> `libraries` 里也可能只有分包。只认 `mainClass` 会把 Forge 误判成原版。
> 所以这里补了三条兜底：`--launchTarget` 参数 → `--fml.forgeVersion` 参数 → 实例目录名。

json 缺失或解析失败时，回退读 `mods/` 里第一个 jar 的元数据，
并在报告里标注「版本信息基于模组元数据推测」。

### 第 1 步 · 建方案骨架

- 方案名默认取实例目录名，规则与 `scheme create` 一致：
  不含 `\ / : * ? " < > |`、不以点开头结尾、不是 Windows 保留名（CON/PRN/NUL…）、不与已有方案重名。
- 写入的 `scheme.yaml`：

```yaml
name: myserver
version: 1.20.1
loader: forge
type: forge
state: partial          # 此时资源还不全
source: clone-client
source_path: /home/u/.minecraft/versions/1.20.1-forge-47.2.0
created_at: ...
```

- 建好 `mods/` `config/` `logs/` `world/` `plugins/` 空目录。

> 这一步之后方案已经出现在 `scheme list` 里（`state: partial`），
> 后续步骤都是往这个方案里填内容。
>
> 加载器或 MC 版本识别失败时**直接中止，不创建骨架** ——
> 半个方案比没有方案更麻烦。

### 第 2 步 · 白名单复制

**整棵子树跳过：**

| 类别 | 条目 |
|------|------|
| 客户端运行数据 | `assets/` `libraries/` `versions/` `logs/` `crash-reports/` `.cache/` |
| 客户端资源 | `resourcepacks/` `shaderpacks/` `texturepacks/` `screenshots/` |
| 客户端状态文件 | `options.txt` `optionsof.txt` `optionsshaders.txt` `usercache.json` `usernamecache.json` `servers.dat` `realms_persistence.json` |
| 存档 | `saves/` → **不在这一步处理**，由第 4 步单独搬 |

**保留：** `mods/`（第 5 步清洗）、`config/`、`defaultconfigs/`、`kubejs/`、`scripts/`、`datapacks/`，
以及**其它未列出的目录**（保守保留）。

**失败处理：**

| 文件 | 处理 |
|------|------|
| `world/level.dat`、`mods/*.jar`、`config/` 下任意文件 | **中止并回滚**，删除 `scheme/<方案名>/` |
| 其它文件 | 红字警告，继续 |

### 第 3 步 · 核心装配

**走方案的核心装配流程**（`installer` 模块，与 `scheme create` 共用），不是调 `wow install` 命令。

| 类型 | 走哪条路 |
|------|---------|
| Vanilla | 直连下载 `minecraft_server.<mc>.jar` |
| Paper / Purpur / Leaves | 现有核心下载链路（解析最新构建） |
| Fabric / Quilt | 加载器安装器 + 原版核心 |
| Forge / NeoForge | 官方安装器生成 `libraries/` 与 `unix_args.txt` |

**客户端核心残留**：方案目录里如果复制进了 `<实例名>.jar`，会改名成
`<实例名>.jar.client-jar.bak`。为什么不删 —— 本项目总则是「不自动删除任何文件」，
改名既消除了「被误认成服务端核心」的干扰，又留了后路。

装配完成后核心入池（`pool/cores/<type>/<mc>/`），`scheme.yaml` 记录 `pool_path`。

装配失败 → **回滚方案目录**，不留半残方案。

顺带检查 Java：`≤1.16.5 → 8`、`1.17~1.20.4 → 17`、`≥1.20.5 → 21`，
不匹配时提示，但不自动下载（下载动作交给 `server start`）。

### 第 4 步 · 存档迁移

1. 列出 `saves/` 下含 `level.dat` 的存档，让你选一个（或选「不迁移」）；
2. 复制到方案目录的 `world/`；
3. **删除 `world/session.lock`** —— 单机运行时锁，带进去服务端会报「世界已被锁定」；
4. 保留 `world/datapacks/`；
5. 若目标 `world/` 已有内容，先挪成 `world.pre-clone-<时间戳>.bak`，不覆盖。

### 第 5 步 · 模组清洗

**判定优先级（从高到低）：**

| 优先级 | 依据 | 说明 |
|--------|------|------|
| 1 | `force_keep_mods` | 用户强制保留，后面全部跳过 |
| 2 | 元数据铁证 | Fabric/Quilt `environment: client` 或 entrypoints 只有 `client`；Forge `mcmod.info` 的 `clientSideOnly: true` |
| 3 | 名单 | `extra_client_mods`（用户扩展）+ 内置名单（92 条） |

> **关于 Forge 的 `side = "CLIENT"`**：`mods.toml` 里**没有**全局的
> 「这个模组只能客户端加载」标记。真实语义是 `[[dependencies.<modid>]]` 段里的
> `side="CLIENT"`，表示「这条依赖只在客户端需要」，并不代表模组本身不能加载。
> 拿它当判定依据会错杀，所以只作为附带信息，不参与判定。
> 旧版 Forge 的 `mcmod.info` 里倒是有真正可靠的 `clientSideOnly: true`。

**处理方式**：移到方案目录下的 `mods-disabled/`，输出：

```
🧹 已禁用 3 个仅供客户端使用的模组：
   - rubidium（内置黑名单）
   - oculus（内置黑名单）
   - oldclient（元数据标记 client（mcmod.info 标记 clientSideOnly））
已移至 mods-disabled/，如需恢复请手动移回 mods/。
```

只移动不删除。

> **注意**：`mods-disabled/`（克隆阶段，需求指定名）与
> `mods_client_disabled/`（开服时的自动隔离，见 `client_mod_filter.js`）
> 是两个不同的隔离区，互不影响。

### 第 6 步 · 平台兜底

- 生成 `server.properties`（含 `level-name=world`、`server-port=25565`）；
- 生成 `eula.txt`（`eula=true`）并提示 EULA 条款；
- 按类型建空目录（插件端才建 `plugins/`）。

**已存在的文件一律不覆盖** —— 克隆进来的 `config/` 可能已经包含用户调好的设置。

### 第 7 步 · 入池登记

- `state` 从 `partial` 改为 `full`；
- 核心与模组入池，`scheme.yaml` 的 `resources.*` 记录 `hash` + `in_pool` + `pool_path`；
- 写 `clone_report`（被禁用模组数、存档名、复制失败数）；
- 更新 `updated_at`。

> **关于 `state`**：项目里 `state` 描述的是「方案目录里资源是否齐全」，
> 而「池里有没有备份」由 `in_pool` 字段表达。克隆结束时目录内容齐全，
> 所以是 `full`；这与 `prune` 之后的 `minimal` / `partial` 不冲突。

### 第 8 步 · 输出报告

```
✅ 客户端克隆为方案完成
────────────────────────────────────────────────────
   方案名：myserver（scheme/myserver）
   源实例：/home/user/.minecraft/versions/1.20.1-Forge_47.2.0
   加载器：forge 47.2.0（MC 1.20.1）
   核心：forge-1.20.1-47.2.0-server.jar（已入池，pool/cores/forge/1.20.1/）
   模组：42 个已复制并入池，3 个已禁用（见 mods-disabled/）
   存档：已迁移「生存世界」→ world/（session.lock 已删除）
   配置：config/ 已复制
   方案状态：full

🧹 已禁用 3 个仅供客户端使用的模组：
   - rubidium（内置黑名单）
   ...
   ⚠️ 注意：
      - 单机玩家数据不会自动转换，首次进服状态可能与单机不同
      - 部分 config/ 可能是客户端专用，如遇异常请检查
      - 3 个模组被禁用，如确认服务端需要请手动移回

   下一步：wow scheme switch myserver && wow server start --memory 4G
────────────────────────────────────────────────────
```

---

## 边界与保证

| 保证 | 实现 |
|------|------|
| 产物是方案，不是目录 | 骨架 → 填内容 → 入池 → 状态更新，全程复用 `scheme create` 的目录与 `scheme.yaml` 逻辑 |
| 不出现 `wow install` 命令 | 核心一律走 `installer.install()` |
| 不自动删除任何文件 | 客户端 jar 改名留档、`world/` 冲突挪 `.bak`、模组只移动 |
| 关键失败要回滚 | 第 2~3 步关键文件失败 → 删除 `scheme/<方案名>/` |
| 模组判定以元数据为主 | 名单只作兜底，元数据铁证优先 |
| 报告列出被禁用模组名 | 不是只报数量 |

---

## 常见问题

**Q：提示「无法识别加载器 / 版本」怎么办？**

手动指定即可：

```bash
wow scheme clone-client ~/.minecraft/versions/xxx --type forge --version 1.20.1
```

**Q：提示「未启用版本隔离」危险吗？**

如果你的 `.minecraft/versions/` 里每个实例都有自己的 `mods/`，
那根目录下的 `mods/` 通常只有少量全局模组。但如果你只玩一个整合包、
把所有东西都堆在根目录，那这些就都是该整合包的一部分 —— 所以这里要你确认。

**Q：克隆后发现模组被禁错了？**

从 `mods-disabled/` 里把 jar 挪回 `mods/` 即可。下次克隆想自动保留它，
用 `--keep-mods <modid>`，或在 `wow.yaml` 里配：

```yaml
mod:
  client_only:
    extra:
      - -sodium     # 从内置名单剔除
```

**Q：单机的背包、坐标会带过去吗？**

不会。单机存档的玩家数据存在 `level.dat` 的 `Player` 标签里，
服务端用的是 `playerdata/<UUID>.dat`，两者格式不同，不会自动转换。
首次进服状态（背包、位置、经验）可能与单机不同。

**Q：克隆出来的方案能瘦身共享吗？**

能。模组与核心都已入池，`wow scheme prune <name>` 会把与池重复的资源改成共享引用。
