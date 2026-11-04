# 🚦 发版规则

> 这份文件定义了 wow~ 的发布节奏与发版动作边界。
> 若本文与其它文档冲突，以本文为准。

---

## 一、核心规则：攒够了再发，不由我主动发

**开发与发布解耦。** 修一个问题、加一个功能，都**不单独出版本**。

| 动作 | 谁来决定 | 说明 |
|------|----------|------|
| 改代码、改文档、跑测试 | 随时随地 | 不需要请示，正常迭代 |
| **升版本号** | **用户说「发行」时** | 之前一律不动 `version` 字段 |
| **打 git tag** | **用户说「发行」时** | |
| **双端推送 tag** | **用户说「发行」时** | |
| **创建 GitHub / Gitee Release** | **用户说「发行」时** | 含附件上传 |
| **生成并上传 `SHA256SUMS`** | **用户说「发行」时** | |

一句话：**在「发行」这个指令落地之前，远端仓库保持原样，不产生任何新 tag 或新 Release。**

---

## 二、非发行期间的工作流

代码仍然可以正常提交（commit），只是**不碰版本号、不打 tag、不发 Release**。

```bash
# 可以：正常提交改动
git add -A
git commit -m "feat: 隧道认证闸门"

# 可以：推送 commit（如果用户要求）
git push origin main

# 不可以（除非用户说了「发行」）：
#   - 修改 core/package.json 的 version
#   - git tag ...
#   - gh release create ...
#   - bash scripts/make-sha256sums.sh --upload
```

### 版本号怎么处理？

**不预支版本号。** 一个开发周期内可能累积若干条改动，全部堆在同一个「下一个版本号」下。
真正发行时，才一次性决定版本号、写 CHANGELOG、打 tag。

这样做的原因：预先升版本号会导致「版本号占用了但没发布」，中间态的
`wow -V` 输出会与远端实际可用版本不一致，用户升级时容易困惑。

### CHANGELOG 怎么记？

两种写法都可以，按习惯选：

- **先记**：改动完成就写进 CHANGELOG，标题先写「未发布」（Unreleased），发行时改成正式版本号
- **后记**：改动完成先不写，发行时回顾 commit 历史一次性补全

**推荐「先记」**——细节在改动当下最清楚，事后回忆容易丢要点。

---

## 三、收到「发行」指令时执行的动作清单

按顺序执行，不要跳步：

1. **确定版本号**，规则见 `docs/CHANGELOG.md` 顶部说明
   （语义版本 + 年份后两位 + 十六进制发行包序号，例：`3.5.24-26.40`）
2. **一次性升版本号**：`core/src/cli.js`、`core/package.json`
   （`core/package-lock.json` 在 `.gitignore` 里，改不改都不影响仓库，建议同步改保持一致）
3. **整理 CHANGELOG**：把本周期所有改动合并成一条完整的版本条目，并更新顶部版本表
4. **全量回归**：`for f in core/test/*.test.js; do node "$f"; done`，必须全绿
5. **提交 + 打 tag**：`git commit` → `git tag -a v<版本号>`
6. **双端推送**：`git push origin main && git push origin <tag>`，Gitee 同理
7. **生成清单**：`bash scripts/make-sha256sums.sh v<版本号>`
8. **创建 Release**（GitHub 先建 Release，再传附件；脚本只能传附件不能建 Release）
9. **上传附件**：`SHA256SUMS` + 源码包
10. **端到端验证**：从 Release 真实下载源码包，核对哈希与 `SHA256SUMS` 一致

> ⚠️ 第 8 步的顺序很容易踩坑：`--upload` 会先找 Release，找不到就静默跳过并只打印一行
> 「先发布 Release 再上传附件」。所以必须先 `gh release create`，再传附件。

---

## 四、已知的坑（发版时会遇到）

| 坑 | 表现 | 处理 |
|----|------|------|
| GitHub token 认证头 | 用 `token` 头返回 `Bad credentials` | 必须用 `Authorization: Bearer <token>` |
| Release 附件上传接口 | REST 直接 POST 到 assets 返回 `Not Found` | 用 `gh release upload`，别手搓 API |
| GitHub 归档缓存延迟 | 刚推 tag 后下载到的可能是旧内容 | 独立核对包内 `cli.js` 的版本号，别只看哈希稳定 |
| Gitee Release 建不了 | 需要私人令牌（`GITEE_TOKEN`），git remote 里的密码用不了 | 用户提供令牌后补建 |

---

## 五、当前状态

- 已发布的最新版本：`v3.5.24-26.40`
- **下一个版本号尚未确定**，等用户说「发行」时再定
- 本周期已累积的未发布改动：见 `git log v3.5.24-26.40..HEAD`

### 序号纪律

`26.40` 是新的干净起点。从它开始**严格十六进制递增**，具体约束：

- `39` 之后是 `3a`，`3f` 之后是 `40` —— 正常进位，**不要跳过中间值**
- **绝不回绕复用**旧序号。历史上 `26.3a` ~ `26.3f` 因反复回绕被用了 2～3 次，
  导致无法用序号判断版本新旧，详见 `docs/CHANGELOG.md` 文首说明
- 发版前先 `git tag --list | grep <候选序号>` 确认未被占用
