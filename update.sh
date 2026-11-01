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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 主源（Gitee）+ 兜底源（GitHub 旧仓库）
GITEE_REPO="nuoge233/wow"
GITHUB_REPO="nuoge2333/Wow-"
TEMP_DIR=$(mktemp -d)
TEMP_ZIP="$TEMP_DIR/update.zip"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

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

echo "========================================"
echo "  wow~ 自动更新工具"
echo "========================================"
echo ""

echo "正在检查最新版本..."

# 依次尝试：Gitee（主）→ GitHub（兜底），任一解析到合法 tag 即采用
LATEST_TAG=""
RELEASE_HOST=""
for SRC in "gitee" "github"; do
    if [ "$SRC" = "gitee" ]; then
        BASE="https://gitee.com/api/v5"
        REPO="$GITEE_REPO"
    else
        BASE="https://api.github.com"
        REPO="$GITHUB_REPO"
    fi
    echo "  尝试 [$SRC]..."
    TAG=$(get_latest_tag "$BASE" "$REPO")
    if [ -n "$TAG" ]; then
        LATEST_TAG="$TAG"
        RELEASE_HOST="$SRC"
        break
    fi
done

if [ -z "$LATEST_TAG" ]; then
    echo "⚠️ 无法访问 Gitee / GitHub（网络受限），跳过自动更新（不影响启动）"
    exit 0
fi

echo "最新版本: $LATEST_TAG (源: $RELEASE_HOST)"
echo ""

# 版本比对：本地已是最新则直接跳过，避免每次启动都重复下载并覆盖自身
CURRENT_TAG=""
if [ -f "$SCRIPT_DIR/core/package.json" ]; then
    CURRENT_TAG=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/core/package.json" | head -1)
fi
if [ -n "$CURRENT_TAG" ]; then
    # 统一去掉前导 v 后比较
    if [ "${LATEST_TAG#v}" = "${CURRENT_TAG#v}" ]; then
        echo "✅ 当前已是最新版本 ($CURRENT_TAG)，无需更新"
        exit 0
    fi
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

echo ""
echo "========================================"
echo "  ✅ 更新完成! $LATEST_TAG (源: $RELEASE_HOST)"
echo "========================================"
echo ""
echo "运行 ./wow.sh 启动 wow~"
