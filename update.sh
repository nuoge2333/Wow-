#!/bin/bash
# wow~ 更新脚本 (Linux/macOS)
# 从 GitHub Releases 下载最新版本并覆盖更新
# 保留 server/ pool/ jre/ schemes/ node_modules/ 等运行时目录
#
# 设计原则：自更新失败【不应】阻断服务启动。
# 在简幻欢等受限网络下 GitHub 可能不可达，此时仅警告并跳过更新（exit 0），
# 避免 update.sh 与 start.sh 串联时因更新失败而连带停服。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GITHUB_REPO="nuoge2333/Wow-"
TEMP_DIR=$(mktemp -d)
TEMP_ZIP="$TEMP_DIR/update.zip"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# 带超时与失败容忍的 HTTP GET：成功输出 body 到 stdout，HTTP 错误/空响应输出空。
# 用法: http_get <url>
http_get() {
    curl -fsSL --connect-timeout 10 --max-time 30 "$1" 2>/dev/null
}

echo "========================================"
echo "  wow~ 自动更新工具"
echo "========================================"
echo ""

echo "正在检查最新版本..."

# 多镜像依次尝试（国内优先走 ghproxy，官方 API 兜底），任一返回合法 JSON(含 tag_name) 即可
API_BASES=(
    "https://ghproxy.net/https://api.github.com"
    "https://ghproxy.com/https://api.github.com"
    "https://api.github.com"
)
RELEASE_INFO=""
for BASE in "${API_BASES[@]}"; do
    echo "  尝试: $BASE/repos/$GITHUB_REPO/releases/latest"
    INFO=$(http_get "$BASE/repos/$GITHUB_REPO/releases/latest")
    # 校验返回的是合法 JSON 且含 tag_name，避免把错误页/空响应当成版本信息
    if [ -n "$INFO" ] && echo "$INFO" | grep -q '"tag_name"'; then
        RELEASE_INFO="$INFO"
        break
    fi
done

if [ -z "$RELEASE_INFO" ]; then
    echo "⚠️ 无法访问 GitHub（网络受限或镜像不可用），跳过自动更新（不影响启动）"
    exit 0
fi

# 检查是否被限流
if echo "$RELEASE_INFO" | grep -q '"message".*"API rate limit exceeded"'; then
    echo "⚠️ GitHub API 请求次数超限，跳过自动更新"
    exit 0
fi

# 解析版本号和下载链接（容忍 key/value 间空格）
LATEST_TAG=$(echo "$RELEASE_INFO" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
DOWNLOAD_URL=$(echo "$RELEASE_INFO" | grep '"browser_download_url"' | head -1 | grep '\.zip' | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
# 若无自定义 zip 资产，回退到 GitHub 自动生成的 Source code (zip)
if [ -z "$DOWNLOAD_URL" ]; then
    DOWNLOAD_URL="https://github.com/$GITHUB_REPO/archive/refs/tags/$LATEST_TAG.zip"
fi

if [ -z "$LATEST_TAG" ]; then
    echo "⚠️ 无法解析版本信息，跳过自动更新（不影响启动）"
    exit 0
fi

echo "最新版本: $LATEST_TAG"
echo ""

# 下载（多镜像兜底：原始地址 + ghproxy 代理）
echo "正在下载更新包..."
DOWNLOADED=0
DL_CANDIDATES=(
    "$DOWNLOAD_URL"
    "https://ghproxy.net/$DOWNLOAD_URL"
    "https://ghproxy.com/$DOWNLOAD_URL"
)
for URL in "${DL_CANDIDATES[@]}"; do
    echo "  尝试: $URL"
    if curl -fsSL --connect-timeout 10 --max-time 120 "$URL" -o "$TEMP_ZIP" 2>/dev/null && [ -s "$TEMP_ZIP" ]; then
        DOWNLOADED=1
        echo "  ✅ 下载完成"
        break
    else
        rm -f "$TEMP_ZIP"
    fi
done
if [ "$DOWNLOADED" -ne 1 ]; then
    echo "⚠️ 下载失败（镜像均不可用），跳过自动更新（不影响启动）"
    exit 0
fi

# 解压到临时目录
echo "正在安装更新..."
if ! unzip -qo "$TEMP_ZIP" -d "$TEMP_DIR/extract" 2>/dev/null; then
    echo "⚠️ 解压失败，跳过自动更新"
    exit 0
fi

# 从解压根目录找到项目文件（zip 内可能是 ./WowV3/Wow~V3.0/ 多层嵌套）
# 策略：递归找到包含 wow.sh 的目录，那就是项目根
PROJECT_DIR=$(find "$TEMP_DIR/extract" -name "wow.sh" -not -path "*/core/*" 2>/dev/null | head -1)
if [ -z "$PROJECT_DIR" ]; then
    echo "⚠️ 更新包格式错误，未找到 wow.sh，跳过自动更新"
    exit 0
fi
PROJECT_DIR=$(dirname "$PROJECT_DIR")

# 覆盖更新（跳过运行时目录）
echo "正在覆盖文件..."
for item in "$PROJECT_DIR"/*; do
    name=$(basename "$item")
    # 跳过运行时目录
    case "$name" in
        server|node_modules|.git|.gitignore)
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

# 确保启动脚本可执行（含本次恢复的 start.sh）
chmod +x "$SCRIPT_DIR/wow.sh" 2>/dev/null
chmod +x "$SCRIPT_DIR/start.sh" 2>/dev/null
chmod +x "$SCRIPT_DIR/update.sh" 2>/dev/null

echo ""
echo "========================================"
echo "  ✅ 更新完成! $LATEST_TAG"
echo "========================================"
echo ""
echo "运行 ./wow.sh 启动 wow~"
