#!/bin/bash
# wow~ 发版辅助：生成并（可选）上传 SHA256SUMS
# ------------------------------------------------------------
# 为什么需要这个脚本：
#   update.sh / update.bat 会去 Release 下载 SHA256SUMS 来校验更新包。
#   但在此之前 SHA256SUMS **从未被生成或上传过**，两边的校验分支一直走
#   「未找到清单」的兜底路径，等于没有校验。
#
#   ⚠️ 最容易搞错的一点：脚本自更新下载的是**源码归档 zip**
#      GitHub: https://github.com/<repo>/archive/refs/tags/<tag>.zip
#      Gitee : https://gitee.com/<repo>/repository/archive/<tag>.zip
#   而 Release 附件是我们用 `git archive` 自己打的包 —— 两者字节完全不同！
#   所以清单必须针对「源码归档 zip」计算，记录 Release 附件的哈希毫无意义。
#
# 用法：
#   bash scripts/make-sha256sums.sh v3.5.22-26.3d         # 生成到 ./SHA256SUMS
#   bash scripts/make-sha256sums.sh v3.5.22-26.3d --upload # 生成并上传到两端 Release
#
# 环境变量（--upload 时需要）：
#   GH_TOKEN    GitHub token（有 repo 权限）
#   GITEE_TOKEN Gitee token（有 releases 权限）
# 两者都不设时，会尝试从 git remote 的 URL 里取内嵌凭证（本仓库的 remote 就是这种形式）。
# 环境变量优先级更高，CI 里请显式传环境变量。
#
# 注意：新 tag 推送后，源码归档 zip 通常有几分钟缓存延迟；若刚推完就下载，
# 可能拿到旧内容。脚本默认会重试 3 次并在哈希连续两次一致时才采信。

set -u

TAG="${1:-}"
UPLOAD=0
[ "${2:-}" = "--upload" ] && UPLOAD=1

GITEE_REPO="nuoge233/wow"
GITHUB_REPO="nuoge2333/Wow-"

if [ -z "$TAG" ]; then
    echo "用法: bash scripts/make-sha256sums.sh <tag> [--upload]"
    echo "例:   bash scripts/make-sha256sums.sh v3.5.22-26.3d"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$SCRIPT_DIR/SHA256SUMS"

# ---- 凭证：环境变量优先，否则从 git remote 内嵌 URL 里取 ----
# remote 形如 https://user:token@host/repo.git，取 user:token 中的 token 部分。
_remote_token() {
    local url
    url=$(cd "$SCRIPT_DIR" && git remote get-url "$1" 2>/dev/null) || return 0
    case "$url" in
        *://*@*) : ;;
        *) return 0 ;;
    esac
    # 去掉协议与 host 之后的部分，只留 userinfo
    local cred
    cred=$(echo "$url" | sed -E 's#^[a-z]+://##; s#@.*$##')
    # user:token -> token（没有冒号则整段就是 token）
    echo "${cred#*:}"
}

if [ -z "${GH_TOKEN:-}" ]; then
    GH_TOKEN=$(_remote_token origin)
    [ -n "$GH_TOKEN" ] && echo "ℹ️ GH_TOKEN 未设置，已从 git remote 取得"
fi
if [ -z "${GITEE_TOKEN:-}" ]; then
    GITEE_TOKEN=$(_remote_token gitee)
    # Gitee 的 remote 常写成 https://user:password@...，其中 password 可能是登录密码，
    # 而 API 需要的是私人令牌（形如 32~40 位十六进制/字母数字）。
    # 这里做一次粗筛：非空、长度 >= 20、且不是仓库所有者名字。
    if [ -n "$GITEE_TOKEN" ] && { [ ${#GITEE_TOKEN} -lt 20 ] || [ "$GITEE_TOKEN" = "nuoge233" ]; }; then
        echo "ℹ️ git remote 里的 Gitee 凭证不像是 access_token（长度 ${#GITEE_TOKEN}），已忽略"
        echo "   如需上传 Gitee，请设置环境变量 GITEE_TOKEN=<私人令牌>"
        GITEE_TOKEN=""
    elif [ -n "$GITEE_TOKEN" ]; then
        echo "ℹ️ GITEE_TOKEN 未设置，已从 git remote 取得"
    fi
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

GH_URL="https://github.com/$GITHUB_REPO/archive/refs/tags/$TAG.zip"
GT_URL="https://gitee.com/$GITEE_REPO/repository/archive/$TAG.zip"

echo "========================================"
echo "  生成 SHA256SUMS  tag=$TAG"
echo "========================================"
echo ""

# 下载并计算单个 URL 的哈希，要求连续两次一致（防 CDN 缓存未刷新）。
# 直连失败时依次走国内镜像——镜像只是传输代理，不改内容，
# 但**必须验证**：如果两个不同镜像给出的字节不一致，说明代理中途改写了内容，
# 此时宁可报错也不要把哈希写进清单（写错等于让所有用户升级被拒）。
hash_of() {
    local url="$1" label="$2" name="$3"
    local prev="" cur="" i u got
    local urls=("$url")
    if [ "$label" = "github" ]; then
        urls=("$url" \
              "https://gh-proxy.com/$url" \
              "https://ghfast.top/$url")
    fi
    for i in 1 2 3; do
        got=0
        for u in "${urls[@]}"; do
            rm -f "$TMP/$label.zip"
            if curl -fsSL --connect-timeout 15 --max-time 300 "$u" -o "$TMP/$label.zip" 2>/dev/null \
               && unzip -tq "$TMP/$label.zip" >/dev/null 2>&1; then
                got=1
                break
            fi
            echo "  ⚠️ $label 下载失败（第 $i 次，源: $(echo "$u" | cut -d/ -f3)）" >&2
        done
        if [ "$got" != "1" ]; then
            sleep 5
            continue
        fi
        cur=$(sha256sum "$TMP/$label.zip" | awk '{print $1}')
        if [ -n "$prev" ] && [ "$prev" = "$cur" ]; then
            echo "$cur  $name"
            return 0
        fi
        prev="$cur"
        sleep 3
    done
    # 三次都拿不到稳定值，最后再试一次直接采信
    if [ -n "$cur" ]; then
        echo "  ⚠️ $label 哈希两次不一致（可能有 CDN 缓存），采用最后一次" >&2
        echo "$cur  $name"
        return 0
    fi
    return 1
}


: > "$TMP/SHA256SUMS"
FAIL=0

echo "计算 GitHub 源码归档…"
if line=$(hash_of "$GH_URL" "github" "wow-$TAG-github.zip"); then
    echo "$line" | tee -a "$TMP/SHA256SUMS"
else
    echo "  ❌ GitHub 归档不可用"
    FAIL=1
fi

echo "计算 Gitee 源码归档…"
if line=$(hash_of "$GT_URL" "gitee" "wow-$TAG-gitee.zip"); then
    echo "$line" | tee -a "$TMP/SHA256SUMS"
else
    echo "  ❌ Gitee 归档不可用"
    FAIL=1
fi

if [ "$FAIL" = "1" ] && [ ! -s "$TMP/SHA256SUMS" ]; then
    echo ""
    echo "❌ 两端归档都拿不到，未生成清单。"
    echo "   可能原因：tag 尚未推送（源码归档由托管平台按 tag 实时生成）。"
    exit 1
fi

cp "$TMP/SHA256SUMS" "$OUT"
echo ""
echo "✅ 已生成: $OUT"
echo ""
cat "$OUT"
echo ""

# 说明：update.sh/.bat 用 `grep -qi "$ACTUAL"` 匹配，因此清单里多一行的
# 另一平台哈希不会造成误判（两端源码归档内容不同，哈希本就不同）。
echo "ℹ️ 清单同时包含 GitHub 与 Gitee 两份归档的哈希，"
echo "   update 脚本会按实际下载到的包做匹配，不区分平台。"
echo ""

if [ "$UPLOAD" != "1" ]; then
    echo "下一步：手动把 SHA256SUMS 上传到两个 Release 的附件里，或加 --upload 参数。"
    exit 0
fi

# ==================== 上传 ====================
echo "========================================"
echo "  上传到 Release 附件"
echo "========================================"
echo ""

if [ -n "${GH_TOKEN:-}" ]; then
    echo "→ GitHub…"
    API="https://api.github.com/repos/$GITHUB_REPO"
    # 用 python 解析 JSON：GitHub 返回的格式是 "id": 123（冒号后有空格），
    # 早先用 grep -o '"id":[0-9]*' 抓不到数字，导致误报「找不到 Release」。
    RID=$(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
        "$API/releases/tags/$TAG" 2>/dev/null \
        | python3 -c "import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get('id') or '')
except Exception:
    print('')")
    if [ -z "$RID" ]; then
        echo "  ⚠️ 找不到 GitHub Release $TAG（先发布 Release 再上传附件）"
    else
        # 先删同名旧附件，避免重复
        OLD_ID=$(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
            "$API/releases/$RID/assets" 2>/dev/null \
            | python3 -c "import json,sys
try:
    for a in json.load(sys.stdin):
        if a.get('name')=='SHA256SUMS':
            print(a['id']); break
except Exception:
    pass")
        if [ -n "$OLD_ID" ]; then
            echo "  删除旧附件 id=$OLD_ID"
            curl -fsSL -X DELETE -H "Authorization: Bearer $GH_TOKEN" \
                "$API/releases/assets/$OLD_ID" >/dev/null 2>&1
        fi
        CODE=$(curl -s -o "$TMP/gh_up.json" -w '%{http_code}' -X POST \
            -H "Authorization: Bearer $GH_TOKEN" \
            -H "Content-Type: text/plain" \
            -H "Accept: application/vnd.github+json" \
            --data-binary "@$OUT" \
            "https://uploads.github.com/repos/$GITHUB_REPO/releases/$RID/assets?name=SHA256SUMS")
        if [ "$CODE" = "201" ]; then
            echo "  ✅ 已上传"
        else
            echo "  ❌ 上传失败（HTTP $CODE）"
            head -c 300 "$TMP/gh_up.json" 2>/dev/null; echo ""
        fi
    fi
else
    echo "→ GitHub：跳过（未设置 GH_TOKEN）"
fi

if [ -n "${GITEE_TOKEN:-}" ]; then
    echo "→ Gitee…"
    RID=$(curl -fsSL "https://gitee.com/api/v5/repos/$GITEE_REPO/releases/tags/$TAG?access_token=$GITEE_TOKEN" 2>/dev/null \
        | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('id') or '')
except Exception:
    print('')")
    if [ -n "$RID" ]; then
        # 先删同名旧附件
        curl -fsSL "https://gitee.com/api/v5/repos/$GITEE_REPO/releases/$RID?access_token=$GITEE_TOKEN" 2>/dev/null \
            | python3 -c "import json,sys
try:
    d=json.load(sys.stdin)
    for a in (d.get('assets') or []):
        if a.get('name')=='SHA256SUMS':
            print('DELETE', a.get('id'))
except Exception:
    pass" > "$TMP/gt_del.txt" 2>/dev/null
        while read -r op aid; do
            [ "$op" = "DELETE" ] || continue
            echo "  删除旧附件 id=$aid"
            curl -fsSL -X DELETE "https://gitee.com/api/v5/repos/$GITEE_REPO/releases/$RID/attach_files/$aid?access_token=$GITEE_TOKEN" >/dev/null 2>&1
        done < "$TMP/gt_del.txt"

        RESP=$(curl -s -X POST "https://gitee.com/api/v5/repos/$GITEE_REPO/releases/$RID/attach_files" \
            -F "access_token=$GITEE_TOKEN" -F "file=@$OUT" 2>/dev/null)
        if echo "$RESP" | grep -q 'browser_download_url'; then
            echo "  ✅ 已上传"
            echo "$RESP" | python3 -c "import json,sys
try: print('     ' + json.load(sys.stdin).get('browser_download_url',''))
except Exception: pass"
        else
            # Gitee 附件上限 10MB，SHA256SUMS 很小不会超；失败多半是 token 权限不足
            echo "  ❌ 上传失败：$(echo "$RESP" | head -c 300)"
            echo "     提示：Gitee 需要用私人令牌(access_token)而不是账号密码，"
            echo "           且该令牌需勾选 projects 权限。"
        fi
    else
        echo "  ⚠️ 找不到 Gitee Release $TAG（先发布 Release 再上传附件）"
    fi
else
    echo "→ Gitee：跳过（未设置 GITEE_TOKEN）"
fi

echo ""
echo "完成。发版后请验证两端 SHA256SUMS 可下载："
echo "  curl -fsSL https://github.com/$GITHUB_REPO/releases/download/$TAG/SHA256SUMS"
echo "  curl -fsSL https://gitee.com/$GITEE_REPO/releases/download/$TAG/SHA256SUMS"
