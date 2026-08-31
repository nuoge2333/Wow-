#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/core"

# 检查自身是否可执行，如果不可执行则提示用户
if [ ! -x "$0" ]; then
    echo "⚠️ 脚本没有可执行权限。"
    echo "你可以用 'bash $0' 直接运行，或执行 'chmod +x $0' 后再试。"
    # 继续执行，但后续可能还会报错
fi

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

# Termux/安卓 处理
TERMUX_MODE=0
if [ "$(is_android)" = "yes" ]; then
    if [ -n "$PREFIX" ] && [ -d "$PREFIX" ]; then
        TERMUX_MODE=1
        echo "检测到 Termux 环境，将使用 pkg 提供的 Node.js 和 OpenJDK"

        if ! command -v node >/dev/null 2>&1; then
            echo "未检测到 node，正在通过 pkg 安装 Node.js..."
            pkg update -y && pkg install -y nodejs
            if ! command -v node >/dev/null 2>&1; then
                echo "❌ Node.js 安装失败，请手动运行: pkg install nodejs"
                exit 1
            fi
        fi

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

# 检测是否为交互式终端
INTERACTIVE=0
if [[ -t 0 ]]; then
    INTERACTIVE=1
fi

# ---------- 新增：包管理器安装函数 ----------
install_with_pkg_manager() {
    local pkg_mgr=$1
    local node_pkg=$2
    local npm_pkg=$3
    local java_pkg=$4
    local install_cmd

    case "$pkg_mgr" in
        apt)
            install_cmd="sudo apt update && sudo apt install -y $node_pkg $npm_pkg $java_pkg"
            ;;
        pacman)
            install_cmd="sudo pacman -S --noconfirm $node_pkg $npm_pkg $java_pkg"
            ;;
        dnf)
            install_cmd="sudo dnf install -y $node_pkg $npm_pkg $java_pkg"
            ;;
        zypper)
            install_cmd="sudo zypper install -y $node_pkg $npm_pkg $java_pkg"
            ;;
        *)
            return 1
    esac

    echo "检测到包管理器: $pkg_mgr，正在安装依赖..."
    if eval "$install_cmd"; then
        echo "✅ 依赖安装成功"
        return 0
    else
        echo "❌ 包管理器安装失败"
        return 1
    fi
}
# ----------------------------------------

if [ "$TERMUX_MODE" -eq 0 ]; then
    echo "检测到系统: $OS, 架构: $ARCH"

    # -------- 优先使用系统包管理器安装依赖（Linux 非安卓）--------
    if [ "$OS" = "linux" ]; then
        # 检测可用的包管理器
        PKG_MGR=""
        if command -v apt >/dev/null 2>&1; then
            PKG_MGR="apt"
            NODE_PKG="nodejs"
            NPM_PKG="npm"
            JAVA_PKG="openjdk-17-jre"
            # Ubuntu 22.04 默认 nodejs 版本可能较低，但够用
        elif command -v pacman >/dev/null 2>&1; then
            PKG_MGR="pacman"
            NODE_PKG="nodejs"
            NPM_PKG="npm"
            JAVA_PKG="jre17-openjdk"
        elif command -v dnf >/dev/null 2>&1; then
            PKG_MGR="dnf"
            NODE_PKG="nodejs"
            NPM_PKG="npm"
            JAVA_PKG="java-17-openjdk"
        elif command -v zypper >/dev/null 2>&1; then
            PKG_MGR="zypper"
            NODE_PKG="nodejs"
            NPM_PKG="npm"
            JAVA_PKG="java-17-openjdk"
        fi

        if [ -n "$PKG_MGR" ]; then
            # 检查 node 是否已安装且版本满足要求
            NODE_INSTALLED=0
            MIN_NODE_MAJOR=18
            if command -v node >/dev/null 2>&1; then
                SYS_NODE_VER="$(node -v 2>/dev/null | tr -d 'v')"
                SYS_NODE_MAJOR="$(echo "$SYS_NODE_VER" | cut -d. -f1)"
                if [ -n "$SYS_NODE_MAJOR" ] && [ "$SYS_NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
                    echo "检测到系统 Node.js v$SYS_NODE_VER，满足要求，跳过安装"
                    NODE_INSTALLED=1
                else
                    echo "系统 Node.js 版本过低 ($SYS_NODE_VER)，需要 >= v$MIN_NODE_MAJOR"
                fi
            fi

            if [ "$NODE_INSTALLED" -eq 0 ]; then
                if [ "$INTERACTIVE" -eq 1 ]; then
                    echo "是否使用 $PKG_MGR 安装 Node.js 和 Java 17？ (y/n)"
                    read -r answer
                    if [[ "$answer" =~ ^[Yy]$ ]]; then
                        if install_with_pkg_manager "$PKG_MGR" "$NODE_PKG" "$NPM_PKG" "$JAVA_PKG"; then
                            NODE_INSTALLED=1
                            NODE_EXE="$(command -v node)"
                            NPM_CMD="$(command -v npm)"
                        fi
                    else
                        echo "跳过包管理器安装，将尝试下载便携版..."
                    fi
                else
                    echo "非交互环境，自动使用 $PKG_MGR 安装依赖..."
                    if install_with_pkg_manager "$PKG_MGR" "$NODE_PKG" "$NPM_PKG" "$JAVA_PKG"; then
                        NODE_INSTALLED=1
                        NODE_EXE="$(command -v node)"
                        NPM_CMD="$(command -v npm)"
                    fi
                fi
            fi

            # 如果通过包管理器成功安装了 node，则直接使用系统 node
            if [ "$NODE_INSTALLED" -eq 1 ] && command -v node >/dev/null 2>&1; then
                NODE_EXE="$(command -v node)"
                NPM_CMD="$(command -v npm)"
                USE_SYSTEM_NODE=1
                echo "✅ 使用系统 Node.js ($(node -v))"
            fi
        fi
    fi
    # -------------------------------------------------

    # 如果未设置 USE_SYSTEM_NODE，则尝试检测系统 node 并复用（原有的逻辑）
    if [ -z "${USE_SYSTEM_NODE}" ]; then
        USE_SYSTEM_NODE=0
        MIN_NODE_MAJOR=18
        if command -v node >/dev/null 2>&1; then
            SYS_NODE_VER="$(node -v 2>/dev/null | tr -d 'v')"
            SYS_NODE_MAJOR="$(echo "$SYS_NODE_VER" | cut -d. -f1)"
            if [ -n "$SYS_NODE_MAJOR" ] && [ "$SYS_NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
                echo "检测到系统 Node.js v$SYS_NODE_VER，优先复用，跳过便携版下载"
                NODE_EXE="$(command -v node)"
                NPM_CMD="$(command -v npm)"
                USE_SYSTEM_NODE=1
            fi
        fi
    fi

    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        # 便携版下载逻辑（保持不变）
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
            if [ -d "$NODE_DIR" ]; then
                echo "清理旧的 Node.js 安装..."
                rm -rf "$NODE_DIR"
            fi

            echo "正在下载 Node.js 便携版..."
            NODE_VERSION="20.17.0"
            if [ "$OS" = "linux" ]; then
                NODE_ARCHIVE="node-v$NODE_VERSION-linux-$ARCH.tar.xz"
                FILENAME="node.tar.xz"
                EXTRACT_CMD="tar -xJf $FILENAME"
                EXTRACT_DIR="node-v$NODE_VERSION-linux-$ARCH"
            elif [ "$OS" = "darwin" ]; then
                NODE_ARCHIVE="node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
                FILENAME="node.tar.gz"
                EXTRACT_CMD="tar -xzf $FILENAME"
                EXTRACT_DIR="node-v$NODE_VERSION-darwin-$ARCH"
            else
                echo "不支持的操作系统: $OS"
                exit 1
            fi

            # 多镜像下载（保持不变）
            NODE_MIRRORS=(
                "https://registry.npmmirror.com/-/binary/node"
                "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release"
                "https://mirrors.cloud.tencent.com/nodejs-release"
                "https://repo.huaweicloud.com/nodejs"
                "https://nodejs.org/dist"
            )
            NODE_DOWNLOADED=0
            for MIRROR in "${NODE_MIRRORS[@]}"; do
                NODE_URL="$MIRROR/v$NODE_VERSION/$NODE_ARCHIVE"
                echo "  尝试: $NODE_URL"
                if command -v curl >/dev/null 2>&1; then
                    curl -fsSL --connect-timeout 15 --max-time 300 "$NODE_URL" -o "$FILENAME" 2>/dev/null
                elif command -v wget >/dev/null 2>&1; then
                    wget -q --timeout=15 --tries=1 "$NODE_URL" -O "$FILENAME" 2>/dev/null
                else
                    echo "未找到 curl 或 wget，请安装其中一个"
                    exit 1
                fi
                if [ $? -eq 0 ] && [ -f "$FILENAME" ] && [ -s "$FILENAME" ]; then
                    NODE_DOWNLOADED=1
                    echo "  ✅ 下载成功 ($MIRROR)"
                    break
                else
                    echo "  ❌ 失败，尝试下一个镜像..."
                    rm -f "$FILENAME"
                fi
            done

            if [ "$NODE_DOWNLOADED" -eq 0 ]; then
                echo "❌ 所有镜像下载失败，请检查网络后重试"
                exit 1
            fi

            mkdir -p "$NODE_DIR"
            $EXTRACT_CMD
            if [ $? -ne 0 ]; then
                echo "解压失败"
                exit 1
            fi

            mv "$EXTRACT_DIR" "$NODE_DIR/extracted"
            mkdir -p "$(dirname "$NODE_EXE")"
            if ln -sf "$CORE_DIR/$NODE_DIR/extracted/bin/node" "$NODE_EXE" 2>/dev/null; then
                echo "  ✅ 已创建 node 符号链接"
            else
                cp "$CORE_DIR/$NODE_DIR/extracted/bin/node" "$NODE_EXE"
                echo "  ✅ 已复制 node（符号链接不可用，回退为复制）"
            fi
            chmod +x "$NODE_EXE"
            NPM_LINK="$NODE_DIR/npm"
            if ln -sf "$CORE_DIR/$NODE_DIR/extracted/bin/npm" "$NPM_LINK" 2>/dev/null; then
                :
            else
                cp "$CORE_DIR/$NODE_DIR/extracted/bin/npm" "$NPM_LINK" 2>/dev/null || true
            fi
            chmod +x "$NPM_LINK" 2>/dev/null || true
            rm -f "$FILENAME"

            echo "Node.js 便携版已安装到 $NODE_DIR"
        fi
    fi
fi

# 确定 npm 路径（原有逻辑）
if [ "$TERMUX_MODE" -eq 0 ] && [ "${USE_SYSTEM_NODE:-0}" -ne 1 ]; then
    if [ -f "$NODE_DIR/extracted/bin/npm" ]; then
        NPM_CMD="$NODE_DIR/extracted/bin/npm"
    elif [ -f "$NODE_DIR/npm" ]; then
        NPM_CMD="$NODE_DIR/npm"
    else
        NPM_CLI=$(find "$NODE_DIR" -name "npm-cli.js" -path "*/node_modules/npm/*" 2>/dev/null | head -1)
        NPM_CMD="$NPM_CLI"
    fi
fi

# 安装依赖（保持不变）
if [ ! -d "node_modules" ]; then
    echo "正在安装依赖..."
    NPM_REGISTRIES=(
        "https://registry.npmmirror.com/"
        "https://mirrors.tuna.tsinghua.edu.cn/npm/"
        "https://mirrors.cloud.tencent.com/npm/"
        "https://repo.huaweicloud.com/repository/npm/"
        "https://registry.npmjs.org/"
    )
    NPM_INSTALLED=0

    _run_npm_install() {
        local reg="$1"
        if [ "$TERMUX_MODE" -eq 1 ]; then
            npm install --no-audit --no-fund --registry "$reg"
        elif [ "${USE_SYSTEM_NODE:-0}" -eq 1 ]; then
            npm install --no-audit --no-fund --registry "$reg"
        elif [ -n "$NPM_CMD" ]; then
            "$NODE_EXE" "$NPM_CMD" install --no-audit --no-fund --registry "$reg"
        else
            npm install --no-audit --no-fund --registry "$reg"
        fi
    }

    for REG in "${NPM_REGISTRIES[@]}"; do
        echo "  尝试: $REG"
        if _run_npm_install "$REG" && [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
            NPM_INSTALLED=1
            echo "  ✅ 依赖安装成功 ($REG)"
            break
        else
            echo "  ❌ 失败，尝试下一个镜像..."
            rm -rf node_modules package-lock.json 2>/dev/null
        fi
    done

    if [ "$NPM_INSTALLED" -eq 0 ]; then
        echo "❌ 所有 npm 镜像安装失败，请手动运行: cd core && npm install"
        exit 1
    fi
fi

# 运行 CLI（保持不变）
if [ $# -eq 0 ]; then
    if [ "$INTERACTIVE" -eq 1 ]; then
        "$NODE_EXE" src/cli.js --help
    else
        echo "未指定命令，默认启动 Web 管理面板 (web start)"
        echo "如需其他命令，请在启动参数中指定，例如: server start"
        "$NODE_EXE" src/cli.js web start
    fi
else
    "$NODE_EXE" src/cli.js "$@"
fi
