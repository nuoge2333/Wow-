# cfproxy on Cloudflare Workers

> 自己搭一个 CurseForge API 代理，把 Key 留在云端，客户端不落 Key。

三个文件：

| 文件 | 用途 |
|------|------|
| `worker.js` | 单文件 Worker，无 npm 依赖，直接粘贴到 Cloudflare 在线编辑器 |
| `worker.test.mjs` | 本地测试（19 项，打桩不联网） |
| `README.md` | 本文档 |

---

## 一、它做什么

```
wow~ ──→ https://你的worker.workers.dev/v1/mods/search?gameId=432
                          │
                          ├─ 从 CF_API_KEYS 里挑一个健康的 Key
                          ├─ 加上 x-api-key 头
                          └─→ https://api.curseforge.com/v1/mods/search?gameId=432
                                        │
                          ←── 响应 JSON 原样返回（含 CORS 头）
```

**关键设计：路径完全透传，不做任何改写。**

所以 wow~ 这边的配置只有一行：

```bash
wow config set curseforge.proxy_url https://你的worker.workers.dev
```

不需要带 `/v1`，`cf_client.buildUrl()` 会自动补上，Worker 再原样转发。

---

## 二、功能一览

| 功能 | 说明 |
|------|------|
| **多 Key 轮换** | `CF_API_KEYS` 支持逗号 / 分号 / 换行分隔，每次请求随机挑一个 |
| **单 Key 熔断** | 某 Key 返回 429/403 后标记为不健康，冷却 10 分钟 |
| **单请求兜底** | 一个请求内会把所有未试过的 Key 试一遍（最多 3 个），不会因一个坏 Key 整体失败 |
| **403 语义区分** | 换 Key 后仍 403 → 说明是作者禁用分发，原样返回而非报错 |
| **CORS** | 自动处理预检与响应头，浏览器可直接调用 |
| **自检端点** | `GET /__health` 返回 Key 数量与健康状态（Key 打码，不泄露明文） |
| **路径白名单** | 只放行 `/v1/` 下的路径，防止被当成任意转发器 |
| **超时** | 上游 8 秒，比客户端 5 秒略长，让客户端先超时降级 |

---

## 三、控制台在线编辑部署（不用 Wrangler）

### 第 1 步：创建 Worker

1. 打开 <https://dash.cloudflare.com/>
2. 左侧菜单 → **Workers & Pages**
3. 点 **Create**（有的界面是 **Create application**）
4. 选 **Workers** 标签页 → **Create Worker**
5. 给个名字，比如 `cfproxy`，点 **Deploy**

> 此时会创建一个「Hello World」示例 Worker，先部署出去，下一步再替换代码。

### 第 2 步：替换代码

1. 在刚创建的 Worker 页面，点右上角 **Edit code**（或 **Quick edit**）
2. 编辑器里会看到 `worker.js` 的示例代码
3. **全选删除**（`Ctrl+A` / `Cmd+A`，然后删除）
4. 把本目录 `worker.js` 的**全部内容**粘进去
5. 点右上角 **Deploy**（有的版本是 **Save and deploy**）

> ⚠️ 粘贴时注意别漏掉最后的 `export default { ... }`，那是 Worker 的入口。

### 第 3 步：配置 API Key

1. 回到 Worker 详情页，点 **Settings**（设置）
2. 找到 **Variables and Secrets**（变量和密钥）
3. 点 **Add**，填：

   | 字段 | 值 |
   |------|-----|
   | Variable name（变量名） | `CF_API_KEYS` |
   | Value（值） | `key1,key2,key3` |

   > 多个 Key 用**英文逗号**分隔，不要用中文逗号。
   > 只有一个 Key 就填一个。

4. **类型选 Secret**（加密），不要选 Text
   - Secret 保存后不可再查看，只可覆盖，更安全
5. 点 **Save / Deploy**

> 保存变量后，Cloudflare 会提示需要重新部署才生效。按提示再点一次 **Deploy**。

### 第 4 步：验证

浏览器或命令行打开：

```
https://<你的worker名>.<你的子域>.workers.dev/__health
```

正常应返回类似：

```json
{
  "ok": true,
  "service": "cfproxy (Cloudflare Workers)",
  "keyCount": 2,
  "healthyCount": 2,
  "keys": [
    { "index": 0, "key": "abc123***wxyz", "healthy": true, "lastStatus": null },
    { "index": 1, "key": "def456***uvwx", "healthy": true, "lastStatus": null }
  ],
  "upstream": "https://api.curseforge.com",
  "time": "2026-11-05T10:30:00.000Z"
}
```

- `keyCount` 是解析出的 Key 数量 → 若为 `0`，说明变量名拼错或没生效
- `keys[].key` 是打码后的，**不会泄露明文**

再测一次真实接口：

```bash
curl -s "https://<你的worker>.workers.dev/v1/games/432" | head -c 300
```

返回 `{"data":{"id":432,"name":"Minecraft",...}}` 就成功了。

### 第 5 步：接到 wow~ 上

```bash
wow config set curseforge.proxy_url https://<你的worker>.workers.dev
wow cf status
```

`wow cf status` 里的第一层会显示已启用：

```
  ✅ 第一层 · 公共代理
      https://cfproxy.xxx.workers.dev
```

---

## 四、常见问题

### 部署后访问返回 500「未配置 API Key」

变量没生效。检查：

1. 变量名必须是 **`CF_API_KEYS`**（全大写，下划线）
2. 加完变量后**必须重新 Deploy 一次**
3. 如果用的是 Secret 类型，确认保存成功了

### `/__health` 里 `keyCount` 是 0

同上，多半是变量名拼错，或用了中文逗号导致解析出空项。

### 一直返回 503「所有 API Key 均不可用」

访问 `/__health` 看 `keys[].lastStatus`：

| lastStatus | 含义 | 处理 |
|-----------|------|------|
| `403` | Key 无效或已过期 | 去 [console.curseforge.com](https://console.curseforge.com) 重新生成 |
| `429` | 额度用完 | 等一段时间，或换一个 Key |
| `null` + healthy | Key 正常，问题在别处 | 看 Worker 日志（控制台 **Logs** 页签） |

### 请求返回 400「路径不被允许」

你的路径不在 `/v1/` 下。这个 Worker 只代理 CurseForge API，不是通用转发器。
正确路径形如 `/v1/mods/search`。

### 想换 Key 但不想停机

直接改 `CF_API_KEYS` 的值，重新 Deploy 即可。旧 Key 从值里移除后就失效了。

### 免费额度够用吗

Cloudflare Workers 免费版：**10 万次请求/天**。

对个人使用完全够——配合 wow~ 的 24 小时本地缓存，实际请求量远低于这个数。

---

## 五、安全说明

1. **Key 不会泄露给客户端**
   Worker 只用 Key 去请求上游，响应里不含 Key。客户端自带 `x-api-key` 也会被覆盖。

2. **`/__health` 不返回明文**
   只返回打码后的形式（前 6 位 + `***` + 后 4 位）。

3. **路径白名单**
   只放行 `/v1/` 开头的路径，避免这个 Worker 被当成通用代理滥用。

4. **建议加访问限制**
   如果不想公开，可以在 Cloudflare 控制台给 Worker 加：
   - **Settings → Triggers → Route**，绑定到自己的域名并加 WAF 规则
   - 或者简单点：把 Worker 地址当成一个「密码」用，不告诉别人

5. **关于 CurseForge 的使用条款**
   CurseForge 的第三方 API 条款里有「不得通过代理或 VPN 隐藏身份」的表述，
   主要针对**规避地域限制**。自己搭代理只为「把 Key 从客户端挪走」，
   性质上更接近官方推荐的架构（服务端持有 Key），风险较低。
   但请**不要**拿这个 Worker 去做大规模爬取——那才是真正会被封的行为。

---

## 六、本地测试

改完 `worker.js` 后，可以不联网地跑一遍测试：

```bash
node deploy/cfproxy-worker/worker.test.mjs
```

覆盖 19 项：路径透传、query 保留、Key 覆盖、路径白名单、
多 Key 解析（逗号/分号/换行）、429 降级、熔断生效、
单请求内试完所有 Key、403 语义、CORS 预检、自检端点、缺配置。

全程打桩，不需要真实 Key，也不消耗额度。
