# 模组表单包（Schema）编写规范

> 模组表单包决定「🪛 模组配置」页里哪些配置项可以以**中文表单**的形式编辑。
> 它本质上是一份「翻译 + 说明」数据，**不包含任何渲染逻辑**——渲染由 wow 的
> 通用引擎统一完成。你只需要按本规范写 JSON，放到指定目录即可生效。

## 一、目录与优先级

| 位置 | 说明 |
|------|------|
| `core/data/mod_schemas/` | 官方内置库，随安装包分发，**升级不会被冲掉** |
| `<wow根>/custom-schemas/` | 用户扩展库（与 `scheme/` 并列） |

**加载优先级：用户扩展库 > 官方内置库**。发现官方翻译有误、或模组作者更新
了配置结构，丢一个同名 `<mod_id>.json` 进 `custom-schemas/` 即可整体覆盖。

也可以在 Web 面板「设置 → 🧩 模组配置库」里直接粘贴 JSON 或填 GitHub 链接导入。

## 二、整体结构

```json
{
  "mod_id": "create",
  "display_name": "机械动力 (Create)",
  "platforms": ["forge", "neoforge", "fabric"],
  "author": "你的名字",
  "version": "1.0.0",
  "homepage": "https://github.com/...",
  "config_files": [
    {
      "path": "serverconfig/create-server.toml",
      "format": "toml",
      "fields": [ ... ]
    }
  ]
}
```

### 顶层字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `mod_id` | ✅ | 唯一标识。只允许字母、数字、`_` `-` `.`，同时是文件名（`<mod_id>.json`） |
| `display_name` | ✅ | 显示名（中文优先），列表与页签用它 |
| `platforms` | 推荐 | 适用平台：`forge` / `neoforge` / `fabric` / `paper` / `spigot`，缺省视为全平台 |
| `author` / `version` / `homepage` | 可选 | 署名与溯源信息，社区合并时看这里 |
| `config_files` | ✅ | 至少一个配置文件，且 `path` 不得重复 |

### config_files 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `path` | ✅ | **方案内的相对路径**，如 `serverconfig/create-server.toml`、`plugins/LuckPerms/config.yml`。禁止绝对路径与 `..` |
| `format` | 推荐 | `toml` / `yml` / `json` / `properties` / `conf`（HOCON）/ `txt` / `snbt`。缺省按扩展名猜 |
| `fields` | ✅ | 字段清单，见下。空 fields 的文件会被忽略并给 warning |

## 三、field 字段定义

```json
{
  "key": "kinetics.contraptions.maxBlocksMoved",
  "label": "动态结构最大方块数",
  "description": "数值越大，服务器计算负载越重，建议不超过 2048",
  "type": "number",
  "min": 1,
  "max": 4096,
  "default": 2048,
  "danger": true
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `key` | ✅ | **点路径**。TOML/YAML/JSON/HOCON 按层级下钻（`teleport.delay`）；properties/txt 取完整键名或末段 |
| `label` | ✅ | 中文名。**翻译不出来就原样放键名，绝不机翻** |
| `description` | 推荐 | 一句话说明影响与建议值。写「调大/调小会发生什么」，不写废话 |
| `type` | 推荐 | `number` / `boolean` / `string` / `select`，缺省 `string` |
| `min` / `max` | number 可选 | 范围校验，超范围后端直接拒绝写入 |
| `options` | select 必填 | `[{ "value": "h2", "label": "H2（本地文件）" }, ...]` 或简单字符串数组 |
| `default` | 推荐 | 模组默认值，用户「未找到此项」时展示它 |
| `danger` | 可选 | `true` = 改动有风险（影响性能/兼容性/不可逆），前端标 ⚠️ |
| `advanced` | 可选 | `true` = 折进「高级配置」分组 |
| `placeholder` | 可选 | 输入框占位文字 |

**单包字段总数上限 500**，文件大小上限 512KB。

## 四、行为语义（引擎保证，写包前必读）

1. **表单只渲染 Schema 里定义过的字段**。用户的 toml 里有但 Schema 没写的键，
   表单不显示，保存时**也绝不会被动到**——引擎是行级替换，不重写整个文件。
2. **版本不匹配**：某键在当前文件里找不到 → 该字段标红「未找到此项」、不可编辑，
   后端返回 `missing` 列表。请用户检查模组版本，或切换到源码模式。
3. **类型强转**：原值是数字时，`"30"` 会写成 `30`（不加引号）；原值带双引号的
   字符串写回时保留同款引号；布尔键传 `"abc"` 直接拒绝。
4. **写入安全**：保存前自动备份 `.bak`，临时文件 + rename 原子替换，断电不留半截文件。
5. **行级替换**：缩进、行尾注释（`key = 24 # 注释`）、空行、节表顺序逐字节保留。
   引号内的 `#` 不会被误判为注释。
6. **边界**：只允许 `config/`、`serverconfig/`、`plugins/` 三个目录下的文本配置；
   `.jar`、世界数据、二进制（含 NUL 字节的文件）一律拒绝；符号链接指向方案外也拒绝。
7. **大文件降级**：超过 200 行的文件不出表单，直接进源码模式。
8. **SNBT（FTB 任务）只读**：不提供写入，防止改坏任务数据。

## 五、键的书写要点（各格式差异）

- **TOML**：`key` 要带完整节表路径。文件里是
  `[kinetics.contraptions]` 下的 `maxBlocksMoved`，就写
  `"kinetics.contraptions.maxBlocksMoved"`。引擎也接受只写末段
  `maxBlocksMoved`（节表名不唯一时以完整路径优先）。
- **YAML**：按缩进层级下钻。列表项（`- xxx`）不参与定位。
- **JSON**：点路径逐层下钻，值本身是对象/数组时只读不可编辑。
- **HOCON（.conf）**：支持 `a { b = 1 }` 嵌套，`webserver.port` 对应
  `webserver { port = ... }`。
- **properties / txt**：`key=value` 或 `key value`（Carpet 风格）都认，
  取完整键名或末段均可。

## 六、贡献流程（第二批开始社区接管）

1. Fork [nuoge2333/Wow-](https://github.com/nuoge2333/Wow-)，在
   `core/data/mod_schemas/` 下新增 `<mod_id>.json`；
2. 对照模组的**默认配置文件**逐项核对 `key` 拼写与 `default` 值——拼错的键
   在表单里表现为「未找到此项」，是社区包最常见的质量问题；
3. `label` 拿不准就保留英文原词；`description` 至少说清「这个值影响什么」；
4. 提 PR，标题格式 `schema: <mod_id>`。Review 标准：
   - key 与官方默认配置逐一对得上（跑一遍 `wow config schema show <mod_id>`）；
   - 无机翻、无复制粘贴机翻痕迹；
   - `danger: true` 只标真正危险的项（性能炸服、不可逆、跨版本兼容）。

## 七、调试工具

```bash
wow config schema list                 # 看当前加载了哪些包
wow config schema show create          # 看包内定义的字段
wow config schema get create trains.maxTrainLength
wow config schema set create trains.maxTrainLength 64
wow config schema import ./我的包.json  # 或 GitHub 链接
wow config schema remove create        # 只能删用户库里的
```
