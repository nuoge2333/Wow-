# V3.5.5-26.3d 发布说明（Windows 更新器修复 + 自覆盖修复）

> 本版修复 Windows 端 `update.bat` 自动更新**完全失效**，以及自更新脚本**覆盖自身**导致报错、
> 排除清单过期导致**用户存档被覆盖**的问题。

## 版本号
`V3.5.5-26.3d` = 语义版本 `3.5.5` ｜ 年份后两位 `26`（2026）｜ 十六进制第 61 个发行包（`0x3d` = 61）

## 问题现象（Windows）

```
========================================
  wow~ Updater
========================================
Checking latest version...
Latest: v3.5.4-26.3c
URL:                                    ← 空！
Downloading update package...
Invoke-WebRequest : 无效的 URI: 未能分析主机名。
Download complete.                       ← 假成功
Installing update...
...ExtractToDirectory 异常：未能找到文件 update.zip
Overwriting files...
Update complete v3.5.4-26.3c             ← 假成功
```

版本号能读出来，但 `URL:` 为空 → 下载必失败 → 解压必失败 → 仍打印"完成"。

## 根因（三个叠加缺陷）

### 1. 选源结果解析失败（核心）
原 PowerShell 用 `foreach` 输出**两行**（先 host 后 tag），再由批处理 `for /f` 配合 `if !IDX!==0` 逐行判定。该写法存在两处问题：
- `Get-LatestTag $h[1] $h[2]` 以空格分隔传参时，`$h[1]`/`$h[2]` 的数组索引解析不可靠；
- `for /f` 块内用 `!IDX!` 计数判定行序，一旦输出行数/顺序有偏差（如 PowerShell 附加空行），host 与 tag 就会错位或丢失。

**→ 修复**：改为输出**单行 `host|tag`**，批处理用 `for /f "tokens=1,2 delims=|"` 一次解析；PowerShell 侧改为 `-base`/`-repo` 具名传参。

### 2. `set` 写在 `if()else()` 括号块内
```bat
if "%RELEASE_HOST%"=="gitee" (
    set DOWNLOAD_URL=https://gitee.com/.../%LATEST_TAG%.zip   ← 块内，%VAR% 提前展开
) else (
    set DOWNLOAD_URL=https://github.com/.../%LATEST_TAG%.zip
)
```
批处理在**进入括号块前**就展开块内所有 `%VAR%`，赋值时的 `%LATEST_TAG%` 可能取到旧值/空值。

**→ 修复**：改用 `goto :label` 分支（块外单行赋值，`%VAR%` 此时已定值）。

### 3. 版本正则不支持新版本号格式
```regex
^v?\d+\.\d+\.\d+(-[0-9]+\.[0-9]+)?$      ← 只认 -26.29 这种纯数字后缀
```
V3.5.2 起版本号启用**十六进制后缀**（`-26.3a` / `-26.3b` / `-26.3c` / `-26.3d`），完全不匹配。
主路径走 `releases/latest` 时侥幸可用，但一旦回退到 tags API，**所有新版 tag 会被过滤干净**，更新器将永远认为"没有可用版本"。

**→ 修复**：后缀改为 `[0-9a-fA-F]+`。**`update.sh` 存在同一缺陷，本次一并修复。**

## 问题现象（自覆盖）

```
update.sh: line 172: $'\235启动脚本可执行（含': command not found
Update complete! v3.5.4-26.3c
```

报错的行号内容看起来是正常的中文注释，实际是**脚本覆盖了正在运行的自身**：
- 覆盖阶段把远端 zip 里的 `update.sh` 也写了回去 → 运行中的进程读到被改写的字节流 → 解析错乱；
- 且旧排除清单仍写 `server`（V3.5.2 已删除该目录），真正的运行目录 `scheme/` **不在排除列表** → 用户方案与存档会被覆盖，存在**数据丢失风险**。

**→ 修复**：
- 排除清单加入脚本本体 `update.sh` / `update.bat`；
- 排除清单 `server` → `scheme`，并补 `logs`。

## 优化

### 版本比对，已是最新则跳过
两端更新器新增本地版本读取（`core/package.json` 的 `version`）并与远程 tag 比对，一致则直接跳过下载与覆盖。
既减少重复下载，也从源头避免"每次启动都覆盖自身"。

### `update.bat` 暂停行为
原 `pause` 会在自动化平台（简幻欢等）或由 `start.bat` 调用时**阻塞流程**。
改为仅在交互式终端（双击运行）才暂停；可用 `WOW_NO_PAUSE=1` 强制跳过。

## 验证

| 项 | 结果 |
|---|---|
| 括号配对（静态校验） | 深度 0，无异常 ✅ |
| 标签引用 | `cleanup`/`found_project`/`url_done`/`url_gitee` 全部有定义 ✅ |
| `bash -n update.sh` | 通过 ✅ |
| 版本正则 | `v3.5.5-26.3d` / `v3.5.1-26.29` 匹配；`backup/*` 正确排除 ✅ |
| `update.sh` 隔离实测（已最新） | 正确输出「当前已是最新版本，无需更新」并跳过 ✅ |
| `update.sh` 隔离实测（有更新） | 下载 → 完整性校验 → 覆盖全流程通过；`scheme/keep.txt` 用户数据完好保留 ✅ |
| 自覆盖报错 | 已消除，无 `command not found` ✅ |

## 未做（留后续）
- 补 `test/` 或删除空头 `test` 脚本、接入 ESLint/CI、拆分超大模块、清理死代码。
- 发版附件附 `SHA256SUMS`（配合已实现的哈希校验，可达满血）。
