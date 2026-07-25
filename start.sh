#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/core"

if [ ! -d "$CORE_DIR" ]; then
    echo "错误: 找不到 core 目录"
    exit 1
fi

cd "$CORE_DIR"

# 检测操作系统和架构
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux";;
        Darwin*)    echo "darwin";;
        *)          echo "unknown";;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   echo "x64";;
        aarch64|arm64)  echo "arm64";;
        *)              echo "x64";;
    esac
}

OS=$(detect_os)
ARCH=$(detect_arch)

# 询问用户确认
echo "检测到系统: $OS, 架构: $ARCH"
echo "是否需要下载对应平台的 Node.js 便携版？ (y/n)"
read -r answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "未下载 Node.js，退出"
    exit 1
fi

NODE_DIR="node/$OS/$ARCH"
NODE_EXE="$NODE_DIR/node"

if [ ! -f "$NODE_EXE" ]; then
    echo "正在下载 Node.js 便携版..."
    NODE_VERSION="20.17.0"
    if [ "$OS" = "linux" ]; then
        NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz"
        FILENAME="node.tar.xz"
        EXTRACT_CMD="tar -xJf $FILENAME"
        EXTRACT_DIR="node-v$NODE_VERSION-linux-$ARCH"
    elif [ "$OS" = "darwin" ]; then
        NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
        FILENAME="node.tar.gz"
        EXTRACT_CMD="tar -xzf $FILENAME"
        EXTRACT_DIR="node-v$NODE_VERSION-darwin-$ARCH"
    else
        echo "不支持的操作系统: $OS"
        exit 1
    fi

    # 下载
    if command -v curl >/dev/null 2>&1; then
        curl -L "$NODE_URL" -o "$FILENAME"
    elif command -v wget >/dev/null 2>&1; then
        wget "$NODE_URL" -O "$FILENAME"
    else
        echo "未找到 curl 或 wget，请安装其中一个"
        exit 1
    fi

    if [ $? -ne 0 ]; then
        echo "下载失败"
        exit 1
    fi

    # 解压
    mkdir -p "$NODE_DIR"
    $EXTRACT_CMD
    if [ $? -ne 0 ]; then
        echo "解压失败"
        exit 1
    fi

    # 移动文件
    mv "$EXTRACT_DIR/bin/"* "$NODE_DIR/"
    chmod +x "$NODE_EXE"
    rm -rf "$EXTRACT_DIR" "$FILENAME"

    echo "Node.js 便携版已安装到 $NODE_DIR"
fi

# 安装依赖（首次运行或依赖缺失时自动安装）
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    "$NODE_EXE" "$NODE_DIR/npm" install --no-audit --no-fund
fi

# 运行 CLI
if [ $# -eq 0 ]; then
    "$NODE_EXE" src/cli.js --help
else
    "$NODE_EXE" src/cli.js "$@"
fi