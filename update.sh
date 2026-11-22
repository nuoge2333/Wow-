#!/bin/bash
# wow~ 更新脚本 (Linux/macOS)
# 从 Gitee 下载最新版本并覆盖更新（GitHub 旧仓库 nuoge2333/Wow- 作为兜底源）
# 保留 server/ pool/ jre/ schemes/ node_modules/ 等运行时目录
#
# 设计原则：自更新失败【不应】阻断服务启动。
# 优先 Gitee；Gitee 不可达时自动回退 GitHub 旧仓库；两者皆不可达则仅警告并跳过（exit 0）。
#
# 版本解析：优先读取 releases/latest；若仓库未发布 Release（如仅推送了 tag），
# 则回退到 tags API（过滤 backup/ 等非版本标签，取最大 semver），直接下载源站 zip，
# 全程无需私人令牌，也无需多镜像。
#
# V3.8.5（公测加固）：覆盖前自动备份代码目录，支持一键回滚。
#   ./update.sh                 自动更新（覆盖前备份）
#   ./update.sh --rollback      回滚到最近一次更新前的版本
#   ./update.sh --rollback <目录> 回滚到指定备份
#   ./update.sh --list          列出可用备份
#   ./update.sh --backup-only   只备份，不检查更新
#
# 备份只含代码（core/src、web、themes、docs、启动脚本等），不含 scheme/、
# node_modules、wow.yaml —— 用户数据永远原地不动，回滚也不会把配置倒回去。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKUP_ROOT="$SCRIPT_DIR/backup"
BACKUP_KEEP=3
# 备份/回滚覆盖的代码路径（与更新时的覆盖范围保持一致）
BACKUP_ITEMS="core/src core/scripts core/data core/package.json web themes docs wow.sh wow.bat update.bat README.MD LICENSE"

# 主源（Gitee）+ 兜底源（GitHub 旧仓库）
GITEE_REPO="nuoge233/wow"
GITHUB_REPO="nuoge2333/Wow-"
TEMP_DIR=$(mktemp -d)
TEMP_ZIP="$TEMP_DIR/update.zip"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# ==================== 备份 / 回滚 ====================

version_of_current() {
    local pkg="$SCRIPT_DIR/core/package.json"
    [ -f "$pkg" ] || { echo "unknown"; return; }
    local v
    v=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg" | head -1)
    echo "${v:-unknown}"
}

# 依赖指纹：只取 package.json 里 dependencies / devDependencies 两段，
# 忽略 version —— 否则每次发版都会误报「依赖变了」，白跑一次 npm install。
deps_fingerprint() {
    local pkg="$1"
    [ -f "$pkg" ] || { echo ""; return; }
    awk '
        /"(dev)?[Dd]ependencies"[[:space:]]*:/ { f = 1 }
        f { print }
        f && /^[[:space:]]*}[,]?[[:space:]]*$/ { f = 0 }
    ' "$pkg" | tr -d '[:space:]' | cksum
}

# 文件哈希：Linux 用 sha256sum，macOS 用 shasum；都没有则输出空串（降级为不比较）
file_hash() {
    [ -f "$1" ] || { echo ""; return; }
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" 2>/dev/null | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
    else
        echo ""
    fi
}

# 按时间倒序列出备份目录（最新的在前）
list_backups() {
    [ -d "$BACKUP_ROOT" ] || return 0
    ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | sed 's:/$::'
}

# 只保留最近 $BACKUP_KEEP 份，避免备份把磁盘吃满。
# $1 = 受保护的目录（回滚目标）：不计数也不删除，防止「刚备份完就把目标清掉」。
prune_backups() {
    local protect="$1"
    local n=0 d
    while IFS= read -r d; do
        [ -z "$d" ] && continue
        # 不完整备份（无 COMPLETE）不占配额、也不删：可能是用户手动放进去的目录
        [ -f "$d/COMPLETE" ] || continue
        if [ -n "$protect" ] && [ "$d" = "$protect" ]; then
            continue
        fi
        n=$((n + 1))
        if [ "$n" -gt "$BACKUP_KEEP" ]; then
            rm -rf "$d"
        fi
    done <<EOF
$(list_backups)
EOF
}

# 备份当前代码。成功时把备份目录打到 stdout（供回滚提示用），失败返回 1。
# 只复制代码路径：scheme/、node_modules、core/pool、core/jre 等运行时目录一律不碰。
#
# 先在隐藏的 .tmp-* 里建好，再整体 mv 成正式目录；COMPLETE 标记最后写。
# 这样被 Ctrl+C / 断电打断的半成品不会被当成「可回滚的备份」。
backup_current() {
    local label="${1:-pre-update}"
    local protect="$2"
    local tag stamp dest tmp item
    tag=$(version_of_current)
    stamp=$(date +%Y%m%d-%H%M%S)
    dest="$BACKUP_ROOT/$stamp-$tag-$label"
    tmp="$BACKUP_ROOT/.tmp-$stamp-$$"

    mkdir -p "$BACKUP_ROOT" 2>/dev/null
    rm -rf "$BACKUP_ROOT"/.tmp-* 2>/dev/null   # 清掉上次中断留下的半成品
    mkdir -p "$tmp" || return 1

    for item in $BACKUP_ITEMS; do
        [ -e "$SCRIPT_DIR/$item" ] || continue
        mkdir -p "$tmp/$(dirname "$item")" 2>/dev/null
        cp -a "$SCRIPT_DIR/$item" "$tmp/$(dirname "$item")/" 2>/dev/null || { rm -rf "$tmp"; return 1; }
    done

    # 连 cli.js 都没有就当失败，不给出「有备份」的错觉
    [ -f "$tmp/core/src/cli.js" ] || { rm -rf "$tmp"; return 1; }

    echo "$tag" > "$tmp/VERSION" 2>/dev/null
    : > "$tmp/COMPLETE"
    mv "$tmp" "$dest" 2>/dev/null || { rm -rf "$tmp"; return 1; }

    prune_backups "$protect"
    echo "$dest"
}

# 自动选回滚目标：最新的「完整且版本与当前不同」的备份。
# 跳过同版本，是为了避免踩到回滚前自动生成的 pre-rollback 快照——
# 否则连按两次 --rollback 会原地打转，看起来像「回滚没生效」。
pick_default_target() {
    local cur d
    cur=$(version_of_current)
    while IFS= read -r d; do
        [ -n "$d" ] || continue
        [ -f "$d/COMPLETE" ] || continue
        if [ "$(cat "$d/VERSION" 2>/dev/null)" != "$cur" ]; then
            echo "$d"
            return 0
        fi
    done <<EOF
$(list_backups)
EOF
    # 只有同版本备份时退回最新一个完整备份：至少能把代码恢复到备份时刻
    while IFS= read -r d; do
        [ -n "$d" ] || continue
        if [ -f "$d/COMPLETE" ]; then
            echo "$d"
            return 0
        fi
    done <<EOF
$(list_backups)
EOF
    return 1
}

# 从备份恢复代码。不删任何文件，只覆盖——旧版没有的文件留着也无害，
# 反而避免了「回滚时误删用户自己放进来的东西」。
restore_from() {
    local src="$1" item
    local failed=0
    for item in $BACKUP_ITEMS; do
        [ -e "$src/$item" ] || continue
        mkdir -p "$SCRIPT_DIR/$(dirname "$item")" 2>/dev/null || { failed=1; continue; }
        cp -a "$src/$item" "$SCRIPT_DIR/$(dirname "$item")/" 2>/dev/null || failed=1
    done
    chmod +x "$SCRIPT_DIR/wow.sh" 2>/dev/null
    return $failed
}

usage() {
    echo "用法: ./update.sh [选项]"
    echo ""
    echo "  (无参数)            检查并更新到最新版本（覆盖前自动备份代码）"
    echo "  --rollback          回滚到最近一次更新前的版本"
    echo "  --rollback <目录>   回滚到指定备份目录"
    echo "  --list              列出可用备份"
    echo "  --backup-only       只备份当前代码，不检查更新"
    echo "  -h, --help          显示本帮助"
    echo ""
    echo "备份位置: $BACKUP_ROOT（仅保留最近 $BACKUP_KEEP 份）"
    echo "备份不含 scheme/、node_modules、core/wow.yaml —— 方案与配置不会被动。"
}

do_rollback() {
    local want="$1" target
    if [ -n "$want" ]; then
        target="$want"
    else
        target=$(pick_default_target)
    fi

    if [ -z "$target" ] || [ ! -d "$target" ]; then
        echo "⚠️ 没有找到可回滚的备份。"
        echo "   备份会在每次 ./update.sh 覆盖前自动生成，位置: $BACKUP_ROOT"
        if [ -n "$(list_backups)" ]; then
            echo "   现有备份:"
            list_backups | sed 's/^/     /'
        fi
        exit 1
    fi
    # 统一成绝对路径：list_backups 给的是绝对路径，保护逻辑要与它可比
    target=$(cd "$target" 2>/dev/null && pwd) || target=""
    if [ -z "$target" ] || [ ! -f "$target/COMPLETE" ] || [ ! -f "$target/core/src/cli.js" ]; then
        echo "❌ 该备份不完整（上次备份可能被打断过），拒绝回滚。"
        echo "   可换一个: ./update.sh --list"
        exit 1
    fi

    echo "========================================"
    echo "  wow~ 回滚"
    echo "========================================"
    echo ""
    echo "备份目录: $target"
    echo "备份版本: $(cat "$target/VERSION" 2>/dev/null || echo unknown)"
    echo "当前版本: $(version_of_current)"
    if [ "$(cat "$target/VERSION" 2>/dev/null)" = "$(version_of_current)" ]; then
        echo ""
        echo "⚠️ 该备份与当前版本相同，回滚只会恢复文件、版本号不变。"
        echo "   要回到更早的版本: ./update.sh --list 查看，再 --rollback <目录>"
    fi
    echo ""

    # 回滚前也留一份当前版本：万一「回滚错了」还能再回来。
    # 把回滚目标作为受保护目录传下去，避免刚备份完就把它按「保留 3 份」清掉。
    local keep
    keep=$(backup_current "pre-rollback" "$target")
    if [ -n "$keep" ]; then
        echo "已先把当前版本备份到: $keep"
    else
        echo "⚠️ 当前版本备份失败（磁盘满？），继续回滚。"
    fi
    echo ""

    echo "正在恢复代码（scheme/、node_modules、wow.yaml 保持不动）..."
    if restore_from "$target"; then
        echo ""
        echo "========================================"
        echo "  ✅ 已回滚到 $(version_of_current)"
        echo "========================================"
        echo ""
        echo "运行 ./wow.sh 启动 wow~"
        exit 0
    fi
    echo "❌ 回滚过程中有文件复制失败，当前代码可能处于混合状态。"
    echo "   可重试，或从备份目录手动复制: $target"
    exit 1
}

# 参数解析：回滚 / 列备份 / 只备份都在联网之前处理，断网也能救火
ACTION="update"
case "${1:-}" in
    --rollback)
        ACTION="rollback"
        ;;
    --list)
        echo "可用备份（最新在前）:"
        list_backups | while IFS= read -r d; do
            if [ -f "$d/COMPLETE" ]; then
                printf '  %s  (版本 %s)\n' "$(basename "$d")" "$(cat "$d/VERSION" 2>/dev/null || echo unknown)"
            else
                printf '  %s  —— 不完整（上次备份被打断，已跳过）\n' "$(basename "$d")"
            fi
        done
        [ -n "$(list_backups)" ] || echo "  （还没有备份：每次更新覆盖前会自动生成）"
        exit 0
        ;;
    --backup-only)
        ACTION="backup-only"
        ;;
    -h|--help)
        usage
        exit 0
        ;;
    "")
        ;;
    *)
        echo "❌ 未知参数: $1"
        echo ""
        usage
        exit 1
        ;;
esac

if [ "$ACTION" = "rollback" ]; then
    do_rollback "${2:-}"
fi

if [ "$ACTION" = "backup-only" ]; then
    echo "正在备份当前代码（$(version_of_current)）..."
    DEST=$(backup_current "manual")
    if [ -n "$DEST" ]; then
        echo "✅ 已备份到: $DEST"
        echo "   回滚: ./update.sh --rollback $DEST"
        exit 0
    fi
    echo "❌ 备份失败（检查磁盘空间与目录权限）"
    exit 1
fi

# 带超时与失败容忍的 HTTP GET：成功输出 body 到 stdout，HTTP 错误/空响应输出空。
http_get() {
    curl -fsSL --connect-timeout 10 --max-time 30 "$1" 2>/dev/null
}

# 解析最新 tag：先试 releases/latest；失败则回退 tags API（过滤非版本标签，取最大 semver）
get_latest_tag() {
    local base="$1" repo="$2"
    # 1) releases/latest（若用户已发布 Release，优先采用）
    local info; info=$(http_get "$base/repos/$repo/releases/latest")
    if echo "$info" | grep -q '"tag_name"'; then
        echo "$info" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/'
        return 0
    fi
    # 2) tags API：仅保留形如 vX.Y.Z（-YY.NN 可选，YY=年两位 / NN=发行包序号十六进制）的标签，
    #    按主.中.小 数值取最大（排除 backup/ 等同步标签）。
    #    注：新版本号格式为 V大.中.小-年两位.发行包序号(十六进制)，如 v3.5.0-26.27；
    #    排序以 X.Y.Z 为主，后缀 -YY.NN 仅作同版本内的次级区分（实际发布只会用带后缀的标签）。
    http_get "$base/repos/$repo/tags" \
        | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | sed 's/.*"\([^"]*\)".*/\1/' \
        | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+\.[0-9a-fA-F]+)?$' \
        | sed -E 's/^(v?)([0-9]+)\.([0-9]+)\.([0-9]+).*$/\2 \3 \4 &/' \
        | sort -k1,1n -k2,2n -k3,3n | tail -1 | awk '{print $NF}'
}

# 版本比较：返回 0 表示 $1 > $2（支持 X.Y.Z 与可选的 -YY.NN 后缀；
# YY=2 位年，NN=十六进制发行包序号）。用于「Gitee 未更新时再比一遍 GitHub」。
version_gt() {
    local a="${1#v}" b="${2#v}"
    [ -z "$a" ] || [ -z "$b" ] && return 1
    local a_base="${a%%-*}" b_base="${b%%-*}"
    local a1 a2 a3 b1 b2 b3
    IFS='.' read -r a1 a2 a3 <<< "$a_base"
    IFS='.' read -r b1 b2 b3 <<< "$b_base"
    for v in a1 a2 a3 b1 b2 b3; do [ -z "${!v}" ] && printf -v "$v" 0; done
    if   [ "$((a1))" -gt "$((b1))" ]; then return 0
    elif [ "$((a1))" -lt "$((b1))" ]; then return 1; fi
    if   [ "$((a2))" -gt "$((b2))" ]; then return 0
    elif [ "$((a2))" -lt "$((b2))" ]; then return 1; fi
    if   [ "$((a3))" -gt "$((b3))" ]; then return 0
    elif [ "$((a3))" -lt "$((b3))" ]; then return 1; fi
    # 主版本相同，比较 -YY.NN 后缀
    local a_suf="${a#*-}" b_suf="${b#*-}"
    [ "$a" = "$a_base" ] && a_suf=""
    [ "$b" = "$b_base" ] && b_suf=""
    local a_y a_n b_y b_n
    IFS='.' read -r a_y a_n <<< "${a_suf:-0.0}"
    IFS='.' read -r b_y b_n <<< "${b_suf:-0.0}"
    [ -z "$a_y" ] && a_y=0; [ -z "$a_n" ] && a_n=0
    [ -z "$b_y" ] && b_y=0; [ -z "$b_n" ] && b_n=0
    if   [ "$((a_y))" -gt "$((b_y))" ]; then return 0
    elif [ "$((a_y))" -lt "$((b_y))" ]; then return 1; fi
    # NN 为十六进制序号
    if   [ "$((16#$a_n))" -gt "$((16#$b_n))" ]; then return 0
    elif [ "$((16#$a_n))" -lt "$((16#$b_n))" ]; then return 1; fi
    return 1
}

echo "========================================"
echo "  wow~ 自动更新工具"
echo "========================================"
echo ""

echo "正在检查最新版本..."

# 读取本地版本（供后续比对）
CURRENT_TAG=""
if [ -f "$SCRIPT_DIR/core/package.json" ]; then
    CURRENT_TAG=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/core/package.json" | head -1)
fi

# 主源（Gitee）与兜底源（GitHub）都解析一遍最新 tag，再决定用哪个。
# 设计：Gitee 优先；但若 Gitee 显示「未更新」（其最新 tag ≤ 本地版本），
# 仍要再查一遍 GitHub —— Gitee 同步可能滞后，GitHub 上可能已有更新的版本。
LATEST_TAG=""
RELEASE_HOST=""
GITEE_TAG=""
GITHUB_TAG=""

echo "  尝试 [gitee]..."
GITEE_TAG=$(get_latest_tag "https://gitee.com/api/v5" "$GITEE_REPO")
echo "  尝试 [github]..."
GITHUB_TAG=$(get_latest_tag "https://api.github.com" "$GITHUB_REPO")

# 决策：Gitee 有更新 → 用 Gitee（主源）；否则若 GitHub 有更新 → 用 GitHub。
if [ -n "$GITEE_TAG" ] && version_gt "$GITEE_TAG" "$CURRENT_TAG"; then
    LATEST_TAG="$GITEE_TAG"
    RELEASE_HOST="gitee"
elif [ -n "$GITHUB_TAG" ] && version_gt "$GITHUB_TAG" "$CURRENT_TAG"; then
    LATEST_TAG="$GITHUB_TAG"
    RELEASE_HOST="github"
    if [ -n "$GITEE_TAG" ]; then
        echo "  ℹ️ Gitee 未更新（仍为 $GITEE_TAG），改用 GitHub 最新版本"
    fi
fi

if [ -z "$LATEST_TAG" ]; then
    if [ -n "$GITEE_TAG" ] || [ -n "$GITHUB_TAG" ]; then
        echo "✅ 当前已是最新版本 ($CURRENT_TAG)，无需更新"
        exit 0
    fi
    echo "⚠️ 无法访问 Gitee / GitHub（网络受限），跳过自动更新（不影响启动）"
    exit 0
fi

echo "最新版本: $LATEST_TAG (源: $RELEASE_HOST)"
echo ""

if [ -n "$CURRENT_TAG" ]; then
    echo "本地版本: $CURRENT_TAG → 将更新到 $LATEST_TAG"
    echo ""
fi

# 下载链接：直接取源站 zip（releases 资产与源站 zip 等价，且无需私人令牌）
if [ "$RELEASE_HOST" = "gitee" ]; then
    DOWNLOAD_URL="https://gitee.com/$GITEE_REPO/repository/archive/$LATEST_TAG.zip"
else
    DOWNLOAD_URL="https://github.com/$GITHUB_REPO/archive/refs/tags/$LATEST_TAG.zip"
fi

echo "正在下载更新包..."
if curl -fsSL --connect-timeout 10 --max-time 120 "$DOWNLOAD_URL" -o "$TEMP_ZIP" 2>/dev/null && [ -s "$TEMP_ZIP" ]; then
    echo "  ✅ 下载完成"
else
    rm -f "$TEMP_ZIP"
    echo "⚠️ 下载失败，跳过自动更新（不影响启动）"
    exit 0
fi

# V3.5.3：下载后先做 zip 完整性测试（防截断/损坏）
if ! unzip -tq "$TEMP_ZIP" >/dev/null 2>&1; then
    rm -f "$TEMP_ZIP"
    echo "⚠️ 更新包完整性校验失败，跳过自动更新（可能为损坏或被篡改的下载）"
    exit 0
fi

# V3.5.3 引入哈希校验；V3.5.22 改成「可协商」策略。
#
# 改动的起因：SHA256SUMS 在此之前**从未随 Release 上传**，所以这段校验在真实
# 环境里一次都没跑过（永远走 else 分支）——「有校验」一直只是文档上的说法。
# 现在三种结局分别处理：
#
#   ① ok        哈希一致            → 直接升级
#   ② mismatch  哈希不一致（可疑）  → 交互终端问「是否继续」，默认【否】；
#                                     非交互环境（CI / 平台脚本）一律拒绝，
#                                     绝不静默装上与官方基准不符的内容
#   ③ missing   拿不到 SHA256SUMS   → 交互终端问「是否继续」，默认【是】；
#                                     非交互环境继续，但打醒目警告
#   ④ skip      本机没有 sha256sum  → 仅提示，继续（已通过 zip 完整性测试）
#
# 为什么②默认拒绝、③默认继续：
#   ② 是「已有官方基准，而下载物与它不符」——这是强信号，无人值守时宁可不更新；
#   ③ 只是「没有基准可比」，属信息缺失，不该因此把用户的更新卡死。
CHECKSUMS_URL=""
if [ "$RELEASE_HOST" = "gitee" ]; then
    CHECKSUMS_URL="https://gitee.com/$GITEE_REPO/releases/download/$LATEST_TAG/SHA256SUMS"
else
    CHECKSUMS_URL="https://github.com/$GITHUB_REPO/releases/download/$LATEST_TAG/SHA256SUMS"
fi

# 清单里记录的是「源码归档 zip」的哈希，不是 Release 附件（自打包）的哈希——
# 因为下面 DOWNLOAD_URL 走的就是 archive/refs/tags/<tag>.zip，两者才可比。
# 发版时必须用 `bash scripts/make-sha256sums.sh <tag> --upload` 针对同一 URL
# 生成清单并上传；否则比对必然失败——那才是最坏的情况：看起来在防护，
# 实际只会拦住所有人的升级。
#
# 是否处于可交互终端。非交互（管道 / CI / 平台调用）时不能 read，否则会挂住。
# 注意 [ -t 0 ] 在 Windows Git Bash 下也有效；重定向输入时返回假。
# WOW_NO_PROMPT=1 可强制按非交互处理（给上层脚本用）。
IS_INTERACTIVE=0
if [ -t 0 ] && [ -t 1 ] && [ "${WOW_NO_PROMPT:-}" != "1" ]; then
    IS_INTERACTIVE=1
fi

# 询问用户是否继续。
#   $1 = 提示语   $2 = 默认值（y 或 n）
# 非交互环境直接返回默认值，绝不停下来等输入。
# 空回车 / read 读到 EOF 也按默认值处理。
ask_continue() {
    local prompt="$1"
    local default="$2"
    if [ "$IS_INTERACTIVE" != "1" ]; then
        [ "$default" = "y" ] && return 0 || return 1
    fi
    local hint="[y/N]"
    [ "$default" = "y" ] && hint="[Y/n]"
    local ans=""
    printf '%s %s ' "$prompt" "$hint" >&2
    if ! read -r ans; then
        ans=""
    fi
    ans=$(echo "$ans" | tr -d '[:space:]' | tr 'A-Z' 'a-z')
    if [ -z "$ans" ]; then
        [ "$default" = "y" ] && return 0 || return 1
    fi
    [ "$ans" = "y" ] || [ "$ans" = "yes" ] || [ "$ans" = "是" ]
}

HASH_STATE="skip"   # ok | mismatch | missing | skip
if curl -fsSL --connect-timeout 10 --max-time 30 "$CHECKSUMS_URL" -o "$TEMP_DIR/SHA256SUMS" 2>/dev/null && [ -s "$TEMP_DIR/SHA256SUMS" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL=$(sha256sum "$TEMP_ZIP" | awk '{print $1}')
        # 逐行取第一个字段比对，而不是 grep 整行包含——后者在清单格式异常时
        # （比如哈希被截断）可能误命中。awk 取 $1 后精确比较更稳。
        if awk -v h="$ACTUAL" 'tolower($1)==tolower(h){f=1} END{exit !f}' "$TEMP_DIR/SHA256SUMS"; then
            echo "  ✅ 哈希校验通过"
            HASH_STATE="ok"
        else
            HASH_STATE="mismatch"
            echo ""
            echo "  ⚠️⚠️  更新包哈希与官方清单不符  ⚠️⚠️"
            echo "     清单期望: $(head -1 "$TEMP_DIR/SHA256SUMS" | awk '{print $1}' | cut -c1-16)…"
            echo "     实际下载: $(echo "$ACTUAL" | cut -c1-16)…"
            echo "     可能原因：下载被中间人篡改、镜像同步了错误内容、或清单本身是旧的。"
            echo "     继续升级有一定风险，建议先取消，稍后重试或手动下载核对。"
        fi
    else
        HASH_STATE="skip"
        echo "  ℹ️ 系统缺少 sha256sum，跳过哈希校验（仅已通过 zip 完整性测试）"
    fi
else
    HASH_STATE="missing"
    echo ""
    echo "  ⚠️ 未找到官方 SHA256SUMS 清单，无法校验更新包完整性。"
    echo "     已通过 zip 结构完整性测试，但无法确认内容与官方发布一致。"
fi

case "$HASH_STATE" in
    ok)
        ;;
    mismatch)
        if ask_continue "  哈希不符，仍要继续升级吗？" "n"; then
            echo "  ⚠️ 你选择了继续，将以未经验证的内容覆盖当前版本。"
        else
            rm -f "$TEMP_ZIP"
            echo "  ❌ 已取消升级（未做任何改动）"
            exit 0
        fi
        ;;
    missing)
        if ask_continue "  没有校验清单，仍要继续升级吗？" "y"; then
            echo "  ℹ️ 继续升级（未经哈希校验）"
        else
            rm -f "$TEMP_ZIP"
            echo "  ❌ 已取消升级（未做任何改动）"
            exit 0
        fi
        ;;
    *)
        : # skip：缺少工具，仅提示
        ;;
esac

# 解压到临时目录
echo "正在安装更新..."
if ! unzip -qo "$TEMP_ZIP" -d "$TEMP_DIR/extract" 2>/dev/null; then
    echo "⚠️ 解压失败，跳过自动更新"
    exit 0
fi

# 从解压根目录找到项目文件（zip 内可能是 ./wow-v3.4.12/ 多层嵌套）
# 策略：递归找到包含 wow.sh 的目录，那就是项目根
PROJECT_DIR=$(find "$TEMP_DIR/extract" -name "wow.sh" -not -path "*/core/*" 2>/dev/null | head -1)
if [ -z "$PROJECT_DIR" ]; then
    echo "⚠️ 更新包格式错误，未找到 wow.sh，跳过自动更新"
    exit 0
fi
PROJECT_DIR=$(dirname "$PROJECT_DIR")

# ==================== 覆盖前备份 ====================
# 备份放在覆盖之前：一旦备份失败就中止本次更新，宁可这次不升，
# 也不能让用户落到「升完发现坏了、又退不回去」的境地。
echo "正在备份当前代码..."
BACKUP_DIR=$(backup_current "pre-update")
if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
    echo ""
    echo "⚠️ 备份失败（磁盘空间不足或权限问题），本次更新已中止。"
    echo "   当前版本未做任何改动；清理空间后可重试。"
    echo "   已有备份可用 ./update.sh --list 查看。"
    exit 0
fi
echo "  ✅ 已备份: $BACKUP_DIR"
PKG_HASH_BEFORE=$(deps_fingerprint "$SCRIPT_DIR/core/package.json")

# 覆盖更新（跳过运行时 / 用户数据目录）
echo "正在覆盖文件..."
for item in "$PROJECT_DIR"/*; do
    name=$(basename "$item")
    # 跳过运行时与用户数据目录：
    #   scheme  = V3.5.2 起的服务器运行目录（含用户方案/存档，绝不可覆盖）
    #   logs    = 运行日志
    #   update.sh = 正在执行的自更新脚本本体，覆盖会导致运行中的字节流被改写而报错
    #   core/tunnel = V3.5.16 起 cloudflared 二进制的落地目录（几十 MB，不必随包更新）
    case "$name" in
        scheme|node_modules|.git|.gitignore|logs|update.sh)
            continue
            ;;
    esac
    if [ -d "$item" ]; then
        # 目录：用 rsync 或 cp 合并
        if command -v rsync >/dev/null 2>&1; then
            rsync -a "$item/" "$SCRIPT_DIR/$name/" 2>/dev/null
        else
            cp -rf "$item" "$SCRIPT_DIR/" 2>/dev/null
        fi
    else
        cp -f "$item" "$SCRIPT_DIR/" 2>/dev/null
    fi
done

# 确保启动脚本可执行（唯一入口 wow.sh / wow.bat）
chmod +x "$SCRIPT_DIR/wow.sh" 2>/dev/null
chmod +x "$SCRIPT_DIR/update.sh" 2>/dev/null

# ==================== 依赖变化检测 ====================
# 覆盖时跳过了 node_modules，所以新版本若改了 package.json，用户手里还是旧的依赖。
# 这里只做「检测 + 询问」，不静默联网装包：装不上比不装更让人困惑。
PKG_HASH_AFTER=$(deps_fingerprint "$SCRIPT_DIR/core/package.json")
if [ -n "$PKG_HASH_BEFORE" ] && [ "$PKG_HASH_BEFORE" != "$PKG_HASH_AFTER" ]; then
    echo ""
    echo "⚠️ 本次更新修改了 core/package.json —— 依赖可能对不上。"
    echo "   旧依赖不会自动替换，直接启动可能报 Cannot find module。"

    NPM_ARR=()
    if command -v npm >/dev/null 2>&1; then
        NPM_ARR=(npm)
    else
        NODE_BIN=$(ls -1 "$SCRIPT_DIR"/core/node/*/*/node 2>/dev/null | head -1)
        NPM_JS=$(find "$SCRIPT_DIR/core/node" -name "npm-cli.js" -path "*/node_modules/npm/*" 2>/dev/null | head -1)
        if [ -n "$NODE_BIN" ] && [ -n "$NPM_JS" ]; then
            NPM_ARR=("$NODE_BIN" "$NPM_JS")
        fi
    fi

    if [ ${#NPM_ARR[@]} -eq 0 ]; then
        echo "   未找到 npm，请手动执行: cd core && npm install"
    elif ask_continue "  现在就安装依赖吗？" "y"; then
        echo "正在安装依赖（可能需要几分钟）..."
        if ( cd "$SCRIPT_DIR/core" && "${NPM_ARR[@]}" install --no-audit --no-fund ); then
            echo "  ✅ 依赖安装完成"
        else
            echo "  ❌ 依赖安装失败，请手动执行: cd core && npm install"
        fi
    else
        echo "   已跳过；启动前请手动执行: cd core && npm install"
    fi
fi

echo ""
echo "========================================"
echo "  ✅ 更新完成! $LATEST_TAG (源: $RELEASE_HOST)"
echo "========================================"
echo ""
echo "运行 ./wow.sh 启动 wow~"
echo ""
echo "💡 如果新版本有问题，可以一键回滚到更新前:"
echo "     ./update.sh --rollback"
echo "   备份位置: backup/（仅保留最近 $BACKUP_KEEP 份）"
