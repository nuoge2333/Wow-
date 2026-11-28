# 客户端克隆为方案（`wow clone`）

> `wow clone <客户端目录> [-v <MC版本>] [-t <核心类型>]`
>
> 把 Minecraft 客户端目录变成 wow 方案。**版本与类型由你指定，工具不猜。**

---

## 一句话理解

不是「把 `.minecraft` 复制一份」，而是：

1. 建方案骨架（走 `scheme create` 同一套目录与 `scheme.yaml` 逻辑）；
2. 只把白名单目录（`mods` / `config` / `kubejs` …）原样搬进来；
3. 按内置名单把仅供客户端使用的模组移到 `mods-disabled/`；
4. 按你指定的类型与版本，走 installer 装配服务端核心。

完成后 `scheme list` / `switch` / `server start` 全套可用。

---

## 为什么不再「识别」客户端

V3 会读 `versions/*.json`、解析 mods 里每个 jar 的元数据，推断「这是 Forge 1.20.1」。
猜中很省事，猜错就造出一个核心错配的方案——用户看到的是一串无法归因的报错，
而代码里为了覆盖各种客户端形态（版本隔离、整合包启动器、改名 jar…）堆了大量分支。

V4 的取舍很直接：**让用户敲两行字，比让代码猜一万种情况便宜。**

- 不读 `versions/`；
- 不解析 `mods.toml` / `fabric.mod.json`；
- 不判断「这是游戏根目录还是版本目录」——你指向哪，就从哪复制。

---

## 用法

```bash
# 交互：会依次问「客户端目录 / MC 版本 / 核心类型」
wow clone

# 参数齐全：适合脚本与面板
wow clone ~/.minecraft -v 1.20.1 -t fabric -n myserver

# 只看参数是否成立，不创建任何东西
wow clone ~/.minecraft -v 1.20.1 -t forge --dry-run
```

| 选项 | 说明 |
|------|------|
| `-n, --name <name>` | 方案名（默认取客户端目录名） |
| `-t, --type <type>` | `forge` / `fabric` / `neoforge` / `vanilla` / `paper` |
| `-v, --version <version>` | Minecraft 版本，如 `1.20.1` |
| `--save <name>` | 迁移指定存档到 `world/`；**默认不迁移**，`-` 表示明确不迁移 |
| `--dry-run` | 只校验参数 |
| `--yes` | 不交互（非 TTY 环境必须给全 `-v` / `-t`） |
| `--extra-client-mods <list>` | 追加的客户端模组 id，逗号分隔 |
| `--keep-mods <list>` | 强制保留的模组 id（优先级最高） |

> 旧入口 `wow scheme clone-client <path>` 仍然可用，但从 `--help` 隐藏。

---

## 复制规则

**白名单**（只搬这些，其余一概不看）：

```
mods/  config/  defaultconfigs/  kubejs/  scripts/  datapacks/
```

`assets/`、`libraries/`、`versions/`、`logs/`、`crash-reports/`、`resourcepacks/`、
`shaderpacks/`、`options.txt` 等一概不复制。

**不删除任何东西**：客户端模组是「移动」到 `mods-disabled/`，不是删除。
想恢复就把它移回 `mods/`（Web 面板的模组页也能一键切回）。

---

## 模组剔除是怎么判定的

只看**文件名**，不读 jar 内容。判断顺序：

1. `--keep-mods` 命中 → 一定保留；
2. `--extra-client-mods` 命中 → 剔除；
3. 命中 `client_mod_filter.js` 里的内置名单（`sodium` / `iris` / `optifine` …）→ 剔除。

匹配方式是把文件名按非字母数字切成 token，再与名单比对（
`sodium-fabric-0.5.8.jar` 会被切成 `sodium` `fabric` `0` `5` `8`）。

> 代价：如果某个客户端模组的文件名里完全不含它的 id，会漏判。
> 用 `--extra-client-mods` 或内置名单补上即可；这比解析每一种加载器的 jar 元数据便宜。

---

## 失败与回滚

- 关键步骤（建骨架 / 复制关键文件 / 装配核心）失败 → **删除刚建的方案目录**，
  不留「看起来成功、switch 过去发现没核心」的半残方案；
- 单个非关键文件复制失败（权限等）→ 记账继续，最后在报告里列出；
- 存档迁移失败 → 中止并回滚。

---

## 常见问题

**Q：客户端目录应该指哪一层？**
A：指 `mods/` 的那一层。整合包启动器常见的 `versions/<实例>/` 里通常只有版本
json 和客户端 jar——如果你指了那里，会发现没有模组可复制。指错了不会报错，
但报告里「已复制 0 个文件」就是提示。

**Q：为什么默认不迁移存档？**
A：克隆的主要目的是「把这堆模组变成能开服的方案」，存档迁移是另一件事，
默认做容易造成「我原来的世界去哪了」。需要时用 `--save <名字>` 显式指定。

**Q：能指定 Quilt / Mohist / 其他核心吗？**
A：当前只开放 `forge` / `fabric` / `neoforge` / `vanilla` / `paper`。
其他类型请用 `wow scheme create <name> --type <type> --version <ver>` 建方案，
再把 `mods/` 与 `config/` 手动拷进去。
