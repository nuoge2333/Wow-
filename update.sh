#!/bin/bash
# wow~ 更新脚本 (Linux/macOS)
# 从 GitHub Releases 下载最新版本并覆盖更新
# 保留 server/ pool/ jre/ schemes/ node_modules/ 等运行时目录

set -e

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

# 获取最新 Release 信息
echo "正在检查最新版本..."
RELEASE_INFO=$(curl -sL "https://api.github.com/repos/$GITHUB_REPO/releases/latest")
if [ $? -ne 0 ] || [ -z "$RELEASE_INFO" ]; then
    echo "❌ 无法访问 GitHub API，请检查网络"
    exit 1
fi

# 解析版本号和下载链接
LATEST_TAG=$(echo "$RELEASE_INFO" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')
DOWNLOAD_URL=$(echo "$RELEASE_INFO" | grep '"browser_download_url"' | head -1 | grep '\.zip' | sed 's/.*"browser_download_url": "\(.*\)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
    echo "❌ 无法获取版本信息"
    exit 1
fi

if [ -z "$DOWNLOAD_URL" ]; then
    echo "❌ 未找到下载链接"
    exit 1
fi

echo "最新版本: $LATEST_TAG"
echo "下载地址: $DOWNLOAD_URL"
echo ""

# 下载
echo "正在下载更新包..."
curl -L --progress-bar "$DOWNLOAD_URL" -o "$TEMP_ZIP"
if [ $? -ne 0 ]; then
    echo "❌ 下载失败"
    exit 1
fi
echo "✅ 下载完成"
echo ""

# 解压
echo "正在安装更新..."
unzip -qo "$TEMP_ZIP" -d "$TEMP_DIR/extract"

# 找到解压后的项目目录（可能有一层嵌套）
EXTRACT_DIR="$TEMP_DIR/extract"
FIRST_ENTRY=$(ls "$EXTRACT_DIR" | head -1)
if [ -n "$FIRST_ENTRY" ] && [ -d "$EXTRACT_DIR/$FIRST_ENTRY" ] && [ "$(ls -A "$EXTRACT_DIR" | wc -l)" -eq 1 ]; then
    EXTRACT_DIR="$EXTRACT_DIR/$FIRST_ENTRY"
fi

# 覆盖更新（跳过运行时目录）
echo "正在覆盖文件..."
for item in "$EXTRACT_DIR"/*; do
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
chmod +x "$SCRIPT_DIR/start.sh" 2>/dev/null
chmod +x "$SCRIPT_DIR/update.sh" 2>/dev/null

echo ""
echo "========================================"
echo "  ✅ 更新完成! $LATEST_TAG"
echo "========================================"
echo ""
echo "运行 ./start.sh 启动 wow~"
