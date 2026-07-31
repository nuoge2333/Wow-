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

# 检测是否为安卓（Termux 或原生安卓 shell）
is_android() {
    if [ "$(uname -o 2>/dev/null)" = "Android" ]; then echo yes; return; fi
    [ -f /system/build.prop ] && echo yes || echo no
}

# Termux/安卓 处理：安卓必须通过 Termux 运行（标准 Linux ARM 版 Node 依赖 glibc，安卓 bionic 跑不了）
TERMUX_MODE=0
if [ "$(is_android)" = "yes" ]; then
    if [ -n "$PREFIX" ] && [ -d "$PREFIX" ]; then
        # Termux 环境：使用 pkg 提供的 Node.js 和 OpenJDK，不下载 glibc 便携版
        TERMUX_MODE=1
        echo "检测到 Termux 环境，将使用 pkg 提供的 Node.js 和 OpenJDK"

        # 安装 Node.js
        if ! command -v node >/dev/null 2>&1; then
            echo "未检测到 node，正在通过 pkg 安装 Node.js..."
            pkg update -y && pkg install -y nodejs
            if ! command -v node >/dev/null 2>&1; then
                echo "❌ Node.js 安装失败，请手动运行: pkg install nodejs"
                exit 1
            fi
        fi

        # 安装 OpenJDK 17
        if ! command -v java >/dev/null 2>&1; then
            echo "未检测到 java，正在通过 pkg 安装 OpenJDK 17..."
            pkg install -y openjdk-17
            if ! command -v java >/dev/null 2>&1; then
                echo "❌ OpenJDK 17 安装失败，请手动运行: pkg install openjdk-17"
                exit 1
            fi
        fi

        NODE_EXE="$(command -v node)"
        NPM_CMD="$(command -v npm)"
    else
        echo "❌ 错误：在安卓上运行 wow~ 必须通过 Termux。"
        echo "   请从 F-Droid 或 https://termux.dev 安装 Termux，"
        echo "   然后在 Termux 内执行本脚本（不要使用系统自带终端 / ADB shell）。"
        exit 1
    fi
fi

# 检测是否为交互式终端（Pterodactyl/Docker 等非 TTY 环境自动跳过确认）
INTERACTIVE=0
if [[ -t 0 ]]; then
    INTERACTIVE=1
fi

if [ "$TERMUX_MODE" -eq 0 ]; then
echo "检测到系统: $OS, 架构: $ARCH"
if [ "$INTERACTIVE" -eq 1 ]; then
    echo "是否需要下载对应平台的 Node.js 便携版？ (y/n)"
    read -r answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        echo "未下载 Node.js，退出"
        exit 1
    fi
else
    echo "非交互环境，自动下载 Node.js 便携版..."
fi

NODE_DIR="node/$OS/$ARCH"
NODE_EXE="$NODE_DIR/node"

if [ ! -f "$NODE_EXE" ]; then
    # 清理可能残留的旧版本 node 目录
    if [ -d "$NODE_DIR" ]; then
        echo "清理旧的 Node.js 安装..."
        rm -rf "$NODE_DIR"
    fi

    echo "正在下载 Node.js 便携版..."
    NODE_VERSION="20.17.0"
    if [ "$OS" = "linux" ]; then
        NODE_URL="https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz"
        FILENAME="node.tar.xz"
        EXTRACT_CMD="tar -xJf $FILENAME"
        EXTRACT_DIR="node-v$NODE_VERSION-linux-$ARCH"
    elif [ "$OS" = "darwin" ]; then
        NODE_URL="https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
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

    # 保留完整目录结构（npm 需要 lib/node_modules 等）
    mv "$EXTRACT_DIR" "$NODE_DIR/extracted"
    # 创建 node 和 npm 的符号链接
    ln -sf "extracted/bin/node" "$NODE_EXE" 2>/dev/null || cp "$NODE_DIR/extracted/bin/node" "$NODE_EXE"
    chmod +x "$NODE_EXE"
    rm -f "$FILENAME"

    echo "Node.js 便携版已安装到 $NODE_DIR"
fi
fi

# 确定 npm 路径（Termux 已在前面设置好 NPM_CMD）
if [ "$TERMUX_MODE" -eq 0 ]; then
if [ -f "$NODE_DIR/extracted/bin/npm" ]; then
    NPM_CMD="$NODE_DIR/extracted/bin/npm"
elif [ -f "$NODE_DIR/npm" ]; then
    NPM_CMD="$NODE_DIR/npm"
else
    # 直接用 node 调用 npm-cli.js
    NPM_CLI=$(find "$NODE_DIR" -name "npm-cli.js" -path "*/node_modules/npm/*" 2>/dev/null | head -1)
    NPM_CMD="$NPM_CLI"
fi
fi

# 安装依赖（首次运行或依赖缺失时自动安装）
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    if [ "$TERMUX_MODE" -eq 1 ]; then
        npm install --no-audit --no-fund --registry https://mirrors.tuna.tsinghua.edu.cn/npm/
    elif [ -n "$NPM_CMD" ]; then
        "$NODE_EXE" "$NPM_CMD" install --no-audit --no-fund --registry https://mirrors.tuna.tsinghua.edu.cn/npm/
    else
        echo "⚠ npm 未找到，尝试使用系统 npm..."
        npm install --no-audit --no-fund --registry https://mirrors.tuna.tsinghua.edu.cn/npm/ 2>/dev/null || {
            echo "❌ 无法安装依赖，请手动运行: cd core && npm install"
            exit 1
        }
    fi
fi

# 运行 CLI
if [ $# -eq 0 ]; then
    if [ "$INTERACTIVE" -eq 1 ]; then
        "$NODE_EXE" src/cli.js --help
    else
        # 非交互环境（面板/Docker）：默认启动 Web 面板以保持进程常驻
        echo "未指定命令，默认启动 Web 管理面板 (web start)"
        echo "如需其他命令，请在启动参数中指定，例如: server start"
        "$NODE_EXE" src/cli.js web start
    fi
else
    "$NODE_EXE" src/cli.js "$@"
fi