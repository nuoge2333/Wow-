# 🔌 CurseForge 接入与三层降级

> 一句话：**代理 → 自己的 Key → 本地缓存，哪层能用用哪层。**

---

## 一、为什么需要这一层

CurseForge 的官方 API（`https://api.curseforge.com/v1`）**必须带 `x-api-key` 头**，
不带就返回 `403`（实测：不仅无效 Key 是 403，**连完全不提供 Key 也是 403**，响应体为空）。

这带来两个问题：

1. 没有 Key 的用户完全用不了 CurseForge 搜索
2. 申请 Key 需要走审核流程，不是立刻就有

社区里有人做了 **cfproxy** —— 一个帮你把 Key 补上的反向代理，
客户端只要把 base URL 从官方换成代理地址即可，Key 始终留在代理服务器上。

> ⚠️ **公共实例已经没了。** `bmpm-mc/cfproxy` 的 README 里写的公共实例
> `https://cfproxy.fly.dev` **实测 DNS 无法解析**（项目最后推送是 2022-03-04）。
> 所以 wow~ **不把它设为默认值**——写死一个死地址，只会让每个用户先白等 5 秒超时再降级。
> 想用代理，请自己起一个（见第四节）。

---

## 二、配置项

| 键 | 默认 | 说明 |
|----|------|------|
| `curseforge.api_key` | `''` | 你的 CurseForge API Key，[console.curseforge.com](https://console.curseforge.com) 免费申请 |
| `curseforge.proxy_url` | `''` | 代理地址，留空 = 不走代理 |

历史键名 `api_keys.curseforge` 与 `download.curseforge_key` **仍然兼容**，不用改老配置。

```bash
# 填 Key
wow config set curseforge.api_key 你的Key

# 或者填自建代理（二选一，也可以都配，代理优先）
wow config set curseforge.proxy_url http://127.0.0.1:3000

# 查看当前三层状态
wow cf status
```

`wow cf status` 的输出长这样：

```
  ✅ 第一层 · 公共代理
      http://127.0.0.1:3000
  ✅ 第二层 · BYOK 直连
      已配置（32 字符）
  ✅ 第三层 · 本地缓存
      202 条（新鲜 180 / 过期 22）
```

---

## 三、三层降级矩阵

### 触发顺序

```
                  ┌─────────────────────┐
                  │  缓存命中且未过期？  │──是──▶ 直接返回（0 次网络请求）
                  └──────────┬──────────┘
                             │否
                  ┌──────────▼──────────┐
                  │  配了 proxy_url？    │──是──▶ 请求代理
                  └──────────┬──────────┘         │
                             │否                   ├─成功─▶ 返回并写缓存
                             │                     └─失败─▶ 看错误类型
                  ┌──────────▼──────────┐
                  │  配了 api_key？      │──是──▶ 请求官方 API
                  └──────────┬──────────┘         │
                             │否                   ├─成功─▶ 返回并写缓存
                             │                     └─失败─▶ 看错误类型
                  ┌──────────▼──────────┐
                  │  有缓存（哪怕过期）  │──是──▶ 返回 + 提示「可能已过期」
                  └──────────┬──────────┘
                             │否
                             ▼
                        抛出错误 + 指引
```

### 哪些错误会继续降级

这个区分很关键，一刀切会让用户看到误导性的结果：

| 状态 | 含义 | 换下一层？ | 能否用过期缓存兜底 |
|------|------|-----------|------------------|
| `429` | 限流 | ✅ 换 | ✅ 能 |
| `5xx` | 服务端故障 | ✅ 换 | ✅ 能 |
| 超时（5 秒） | 网络慢/不通 | ✅ 换 | ✅ 能 |
| `403`/`401`（**直连层**） | 你的 Key 无效或没配 | ❌ 不换 | ✅ **能**（旧数据也比没有强） |
| `403`（**代理层**） | 代理拒绝服务 | ✅ 换直连 | ✅ 能 |
| `404` | 资源确实不存在 | ❌ 不换 | ❌ **不能**（缓存里也不会有） |

> 为什么直连的 403 不换层却要用缓存？
> 因为直连是最后一层网络，403 说明「这条路彻底不通」。
> 但用户可能是因为 Key 过期才失败的，他之前搜过的模组信息还在缓存里——
> 这时候给他旧数据、并提示一下，比甩一个错误好得多。

### 提示文案

代理挂了：

```
  ⚠️  [CF] 公共代理不可用（公共代理限流（429）），尝试直连…
```

只能靠旧缓存：

```
  ⚠️  [CF] 正在使用 3 天前的缓存数据，部分新模组可能无法解析。
      网络恢复后会自动刷新。
```

什么都没配：

```
  ⚠️  [CF] 公共代理未启用，且未配置 API Key。
      请前往 console.curseforge.com 申请免费 Key，填入 wow.yaml 的
      curseforge.api_key，或稍后重试。
```

---

## 四、自建 cfproxy

代理层是**完全可选**的。如果你经常用 CurseForge，或者有多个机器要共享一个 Key，
自建的好处是：Key 只存在代理上，本地配置里不落 Key；还能加缓存和更大的限流额度。

### Docker 一键部署

```bash
docker run -d --name cfproxy \
  -p 3000:3000 \
  -e CF_API_KEY="你的Key" \
  -e REQ_LIMIT_PER_HOUR=5000 \
  --restart unless-stopped \
  bmpm-mc/cfproxy
```

然后把地址填给 wow~：

```bash
wow config set curseforge.proxy_url http://127.0.0.1:3000
```

> **关于 `/v1`：** cfproxy 的语义是「把 base URL `https://api.curseforge.com` 换成代理地址，
> **path 原样转发**」（其 README 原文）。所以客户端请求的路径应该是 `/v1/mods/search`。
>
> wow~ 对此做了兜底：无论 `proxy_url` 写成 `http://127.0.0.1:3000` 还是
> `http://127.0.0.1:3000/v1`，都会自动规范成恰好一个 `/v1` 前缀，
> 两种写法都能用。**推荐写不带 `/v1` 的形式**，语义更贴合 cfproxy 的文档。
>
> 实测对照（新版本号 `v3.5.25-26.41` 起生效）：
>
> | URL | 结果 |
> |-----|------|
> | `https://api.curseforge.com/v1/mods/search` | `403`（缺 Key，说明路径对） |
> | `https://api.curseforge.com/mods/search` | `404`（路径错，证明 `/v1` 必需） |

### 从源码跑

```bash
git clone https://github.com/bmpm-mc/cfproxy
cd cfproxy
CF_API_KEY='你的Key' cargo run
# 输出：Server starting at port 3000.
```

### 验证代理通不通

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:3000/v1/mods/search?gameId=432&pageSize=1"
```

返回 `200` 就是通了；`403` 说明代理上的 `CF_API_KEY` 有问题。
注意路径里要带 `/v1`——忘了带会得到 `404`。

---

## 五、本地缓存

### 位置与格式

```
core/cache/cf_mods/
  file_<projectID>_<fileID>.json      # 按文件查直链的结果
  project_<projectID>.json            # 项目详情
```

每个文件形如：

```json
{
  "cached_at": 1762250000000,
  "data": { "data": { "id": 123, "fileName": "...", "downloadUrl": "..." } }
}
```

写文件用 `.tmp` + `rename` 的原子替换，避免写到一半被读到半截 JSON。

### 有效期与命中规则

- **24 小时**内命中 → 直接返回，**0 次网络请求**
- 超过 24 小时 → 仍然返回，但标记 `stale` 并提示用户

### 什么会被缓存

| 请求类型 | 缓存 | 为什么 |
|----------|------|--------|
| 按 projectID + fileID 查直链 | ✅ | 确定性结果，文件不会变 |
| 按 projectID 查项目详情 | ✅ | 基本稳定 |
| 关键词搜索 | ❌ | 结果随时间变化，缓存 24h 会让用户搜不到新模组 |

### 管理命令

```bash
wow cf cache     # 看统计（条目数、新鲜/过期、体积）
wow cf clear     # 清空
```

---

## 六、整合包安装

安装 CurseForge 整合包时，`manifest.json` 里的每个 `files` 条目（`projectID` + `fileID`）
都走上面同一套三层矩阵取直链。

### 部分失败不算整体失败

有些模组作者在 CurseForge 上**关闭了第三方 API 分发**，此时 API 返回的文件
`downloadUrl` 为 `null`。这**不是网络问题**，换任何层都拿不到，所以：

- 该文件记为「无法自动下载」，**继续装下一个**
- 全部处理完后汇总提示：

```
⚠️  以下 3 个模组需要手动下载（作者未开放 API 分发）：
     - jei-1.20.1-15.2.0.27.jar     https://www.curseforge.com/minecraft/mc-mods/jei/files/4567890
     - ...
   其余 47 个模组已自动安装完成。
```

> 这类错误由 `cf_client.getFileDownload()` 以 `err.code === 'CF_FILE_FORBIDDEN'` 抛出，
> 调用方据此区分「拿不到」与「网络失败」——后者可以重试，前者重试也没用。

---

## 七、常见问题

**Q：我有 Key，还需要代理吗？**
不需要。直接填 `curseforge.api_key` 即可，代理层会自动跳过。

**Q：代理和 Key 都配了，用哪个？**
代理优先。代理挂了会自动降级到直连。

**Q：`wow cf status` 显示三层全空怎么办？**
配 Key 最快。没有 Key 就只能靠本地已缓存的旧数据。

**Q：缓存会占多大空间？**
单条通常 1～5 KB。500 条大约 1～2 MB，可以忽略。

**Q：能改缓存有效期吗？**
当前固定 24 小时（`core/src/cf_client.js` 的 `CACHE_TTL_MS`）。
如果你需要更长的离线可用性，可以改这个常量——但注意搜索结果是实时的，不受影响。
