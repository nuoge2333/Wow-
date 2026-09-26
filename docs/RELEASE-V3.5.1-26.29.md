# Wow V3.5.1-26.29 发布说明

> 发布日期：2026-09-26
> 主仓库（Gitee）：`nuoge233/wow` ｜ 兜底仓库（GitHub）：`nuoge2333/Wow-`
> 标签：`v3.5.1-26.29`

---

## 一、版本号

`V3.5.1-26.29` = 语义版本 `3.5.1`（大.中.小）+ 年份后两位 `26`(2026) + 自上传开源仓库后的第 **41** 个发行包 `29`（十六进制 `0x29` = 41）。

---

## 二、启动即自检更新（核心改动）

- **`start.sh`**（及 Windows 端 `start.bat`）在转发到 `wow.sh` / `wow.bat` **启动前**，会先（最佳努力）运行 `update.sh` 检查并应用更新。
- 更新过程**失败仅警告、不阻断服务启动**（沿用 `update.sh` 的容错设计：优先 Gitee、失败回退 GitHub、皆不可达则跳过）。
- 新增环境变量 **`WOW_SKIP_UPDATE=1`**：跳过自检更新，便于本地开发调试（避免每次启动都联网）。

## 三、更新源：源码归档 zip

`update.sh` / `update.bat` 继续采用**源码归档 zip** 进行覆盖更新（无需私人令牌、无需多镜像）：

- Gitee：`https://gitee.com/nuoge233/wow/repository/archive/<tag>.zip`
- GitHub：`https://github.com/nuoge2333/Wow-/archive/refs/tags/<tag>.zip`

> 已实测 Gitee 主源返回 `200 + application/zip`（有效 Zip 归档）；GitHub 兜底格式一致（真实环境可用，沙箱内因网络限制无法拉取）。

---

## 四、升级提示

- 老用户：下次通过 `start.sh` 启动时会自动拉取本版本（或手动执行 `update.sh`）。
- 本地开发：可设 `WOW_SKIP_UPDATE=1` 跳过联网自检。
- 日志目录 `logs/` 仍被 `.gitignore` 忽略，不进仓库。
