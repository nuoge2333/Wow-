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

echo "========================================"
echo "  wow~ 自动更新工具"
echo "========================================"
echo ""

# 获取最新 Release 信息（网络失败仅警告并跳过更新，不阻断调用方启动）
echo "正在检查最新版本..."
RELEASE_INFO=$(curl -sL --connect-timeout 10 --max-time 30 "https://api.github.com/repos/$GITHUB_REPO/releases/latest")
if [ -z "$RELEASE_INFO" ]; then
    echo "⚠️ 无法访问 GitHub API（网络受限？），跳过自动更新"
    exit 0
fi

# 检查是否被限流
if echo "$RELEASE_INFO" | grep -q '"message".*"API rate limit exceeded"'; then
    echo "⚠️ GitHub API 请求次数超限，跳过自动更新"
    exit 0
fi

# 检查是否返回了错误（如 404 / 仓库不可访问）
if echo "$RELEASE_INFO" | grep -q '"message".*"Not Found"'; then
    echo "⚠️ 未找到 Release 信息，跳过自动更新"
    exit 0
fi

# 解析版本号和下载链接
LATEST_TAG=$(echo "$RELEASE_INFO" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')
DOWNLOAD_URL=$(echo "$RELEASE_INFO" | grep '"browser_download_url"' | head -1 | grep '\.zip' | sed 's/.*"browser_download_url": "\(.*\)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
    echo "⚠️ 无法解析版本信息，跳过自动更新"
    exit 0
fi

if [ -z "$DOWNLOAD_URL" ]; then
    echo "⚠️ 未找到下载链接，跳过自动更新"
    exit 0
fi

echo "最新版本: $LATEST_TAG"
echo "下载地址: $DOWNLOAD_URL"
echo ""

# 下载
echo "正在下载更新包..."
if ! curl -L --connect-timeout 10 --max-time 120 "$DOWNLOAD_URL" -o "$TEMP_ZIP" 2>/dev/null; then
    echo "⚠️ 下载失败，跳过自动更新"
    exit 0
fi
echo "✅ 下载完成"
echo ""

# 解压到临时目录
echo "正在安装更新..."
if ! unzip -qo "$TEMP_ZIP" -d "$TEMP_DIR/extract" 2>/dev/null; then
    echo "⚠️ 解压失败，跳过自动更新"
    exit 0
fi

# 从解压根目录找到项目文件（zip 内可能是 ./WowV3/Wow~V3.0/ 多层嵌套）
# 策略：递归找到包含 wow.sh 的目录，那就是项目根
EXTRACT_DIR="$TEMP_DIR/extract"
PROJECT_DIR=$(find "$EXTRACT_DIR" -name "wow.sh" -not -path "*/core/*" 2>/dev/null | head -1)
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

# 确保启动脚本可执行
chmod +x "$SCRIPT_DIR/wow.sh" 2>/dev/null
chmod +x "$SCRIPT_DIR/start.sh" 2>/dev/null
chmod +x "$SCRIPT_DIR/update.sh" 2>/dev/null

echo ""
echo "========================================"
echo "  ✅ 更新完成! $LATEST_TAG"
echo "========================================"
echo ""
echo "运行 ./wow.sh 启动 wow~"
