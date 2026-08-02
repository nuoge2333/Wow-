#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/core"

if [ ! -d "$CORE_DIR" ]; then
    echo "éè¯¯: æ¾ä¸å° core ç®å½"
    exit 1
fi

cd "$CORE_DIR"

# æ£æµæä½ç³»ç»åæ¶æ
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

# æ£æµæ¯å¦ä¸ºå®åï¼Termux æåçå®å shellï¼
is_android() {
    if [ "$(uname -o 2>/dev/null)" = "Android" ]; then echo yes; return; fi
    [ -f /system/build.prop ] && echo yes || echo no
}

# Termux/å®å å¤çï¼å®åå¿é¡»éè¿ Termux è¿è¡ï¼æ å Linux ARM ç Node ä¾èµ glibcï¼å®å bionic è·ä¸äºï¼
TERMUX_MODE=0
if [ "$(is_android)" = "yes" ]; then
    if [ -n "$PREFIX" ] && [ -d "$PREFIX" ]; then
        # Termux ç¯å¢ï¼ä½¿ç¨ pkg æä¾ç Node.js å OpenJDKï¼ä¸ä¸è½½ glibc ä¾¿æºç
        TERMUX_MODE=1
        echo "æ£æµå° Termux ç¯å¢ï¼å°ä½¿ç¨ pkg æä¾ç Node.js å OpenJDK"

        # å®è£ Node.js
        if ! command -v node >/dev/null 2>&1; then
            echo "æªæ£æµå° nodeï¼æ­£å¨éè¿ pkg å®è£ Node.js..."
            pkg update -y && pkg install -y nodejs
            if ! command -v node >/dev/null 2>&1; then
                echo "â Node.js å®è£å¤±è´¥ï¼è¯·æå¨è¿è¡: pkg install nodejs"
                exit 1
            fi
        fi

        # å®è£ OpenJDK 17
        if ! command -v java >/dev/null 2>&1; then
            echo "æªæ£æµå° javaï¼æ­£å¨éè¿ pkg å®è£ OpenJDK 17..."
            pkg install -y openjdk-17
            if ! command -v java >/dev/null 2>&1; then
                echo "â OpenJDK 17 å®è£å¤±è´¥ï¼è¯·æå¨è¿è¡: pkg install openjdk-17"
                exit 1
            fi
        fi

        NODE_EXE="$(command -v node)"
        NPM_CMD="$(command -v npm)"
    else
        echo "â éè¯¯ï¼å¨å®åä¸è¿è¡ wow~ å¿é¡»éè¿ Termuxã"
        echo "   è¯·ä» F-Droid æ https://termux.dev å®è£ Termuxï¼"
        echo "   ç¶åå¨ Termux åæ§è¡æ¬èæ¬ï¼ä¸è¦ä½¿ç¨ç³»ç»èªå¸¦ç»ç«¯ / ADB shellï¼ã"
        exit 1
    fi
fi

# æ£æµæ¯å¦ä¸ºäº¤äºå¼ç»ç«¯ï¼Pterodactyl/Docker ç­é TTY ç¯å¢èªå¨è·³è¿ç¡®è®¤ï¼
INTERACTIVE=0
if [[ -t 0 ]]; then
    INTERACTIVE=1
fi

if [ "$TERMUX_MODE" -eq 0 ]; then
echo "æ£æµå°ç³»ç»: $OS, æ¶æ: $ARCH"
if [ "$INTERACTIVE" -eq 1 ]; then
    echo "æ¯å¦éè¦ä¸è½½å¯¹åºå¹³å°ç Node.js ä¾¿æºçï¼ (y/n)"
    read -r answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        echo "æªä¸è½½ Node.jsï¼éåº"
        exit 1
    fi
else
    echo "éäº¤äºç¯å¢ï¼èªå¨ä¸è½½ Node.js ä¾¿æºç..."
fi

NODE_DIR="node/$OS/$ARCH"
NODE_EXE="$NODE_DIR/node"

if [ ! -f "$NODE_EXE" ]; then
    # æ¸çå¯è½æ®ççæ§çæ¬ node ç®å½
    if [ -d "$NODE_DIR" ]; then
        echo "æ¸çæ§ç Node.js å®è£..."
        rm -rf "$NODE_DIR"
    fi

    echo "æ­£å¨ä¸è½½ Node.js ä¾¿æºç..."
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
        echo "ä¸æ¯æçæä½ç³»ç»: $OS"
        exit 1
    fi

    # å¤éåä¾æ¬¡å°è¯ï¼å½åä¼å â å®æ¹ååºï¼
    NODE_MIRRORS=(
        "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release"
        "https://npmmirror.com/mirrors/node"
        "https://mirrors.cloud.tencent.com/nodejs-release"
        "https://repo.huaweicloud.com/nodejs"
        "https://nodejs.org/dist"
    )
    NODE_DOWNLOADED=0
    for MIRROR in "${NODE_MIRRORS[@]}"; do
        NODE_URL="$MIRROR/v$NODE_VERSION/$NODE_ARCHIVE"
        echo "  å°è¯: $NODE_URL"
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL --connect-timeout 15 --max-time 300 "$NODE_URL" -o "$FILENAME" 2>/dev/null
        elif command -v wget >/dev/null 2>&1; then
            wget -q --timeout=15 --tries=1 "$NODE_URL" -O "$FILENAME" 2>/dev/null
        else
            echo "æªæ¾å° curl æ wgetï¼è¯·å®è£å¶ä¸­ä¸ä¸ª"
            exit 1
        fi
        if [ $? -eq 0 ] && [ -f "$FILENAME" ] && [ -s "$FILENAME" ]; then
            NODE_DOWNLOADED=1
            echo "  â ä¸è½½æå ($MIRROR)"
            break
        else
            echo "  â å¤±è´¥ï¼å°è¯ä¸ä¸ä¸ªéå..."
            rm -f "$FILENAME"
        fi
    done

    if [ "$NODE_DOWNLOADED" -eq 0 ]; then
        echo "â ææéåä¸è½½å¤±è´¥ï¼è¯·æ£æ¥ç½ç»åéè¯"
        exit 1
    fi

    # è§£å
    mkdir -p "$NODE_DIR"
    $EXTRACT_CMD
    if [ $? -ne 0 ]; then
        echo "è§£åå¤±è´¥"
        exit 1
    fi

    # ä¿çå®æ´ç®å½ç»æï¼npm éè¦ lib/node_modules ç­ï¼
    mv "$EXTRACT_DIR" "$NODE_DIR/extracted"
    # åå»º node å npm çç¬¦å·é¾æ¥
    ln -sf "extracted/bin/node" "$NODE_EXE" 2>/dev/null || cp "$NODE_DIR/extracted/bin/node" "$NODE_EXE"
    chmod +x "$NODE_EXE"
    rm -f "$FILENAME"

    echo "Node.js ä¾¿æºçå·²å®è£å° $NODE_DIR"
fi
fi

# ç¡®å® npm è·¯å¾ï¼Termux å·²å¨åé¢è®¾ç½®å¥½ NPM_CMDï¼
if [ "$TERMUX_MODE" -eq 0 ]; then
if [ -f "$NODE_DIR/extracted/bin/npm" ]; then
    NPM_CMD="$NODE_DIR/extracted/bin/npm"
elif [ -f "$NODE_DIR/npm" ]; then
    NPM_CMD="$NODE_DIR/npm"
else
    # ç´æ¥ç¨ node è°ç¨ npm-cli.js
    NPM_CLI=$(find "$NODE_DIR" -name "npm-cli.js" -path "*/node_modules/npm/*" 2>/dev/null | head -1)
    NPM_CMD="$NPM_CLI"
fi
fi

# å®è£ä¾èµï¼é¦æ¬¡è¿è¡æä¾èµç¼ºå¤±æ¶èªå¨å®è£ï¼
if [ ! -d "node_modules" ]; then
    echo "æ­£å¨å®è£ä¾èµ..."
    NPM_REGISTRIES=(
        "https://mirrors.tuna.tsinghua.edu.cn/npm/"
        "https://registry.npmmirror.com/"
        "https://mirrors.cloud.tencent.com/npm/"
        "https://repo.huaweicloud.com/repository/npm/"
        "https://registry.npmjs.org/"
    )
    NPM_INSTALLED=0

    # æå»º install å½ä»¤ï¼ç»ä¸å¤ç Termux / ä¾¿æºç / ç³»ç» npm ä¸ç§è·¯å¾ï¼
    _run_npm_install() {
        local reg="$1"
        if [ "$TERMUX_MODE" -eq 1 ]; then
            npm install --no-audit --no-fund --registry "$reg"
        elif [ -n "$NPM_CMD" ]; then
            "$NODE_EXE" "$NPM_CMD" install --no-audit --no-fund --registry "$reg"
        else
            npm install --no-audit --no-fund --registry "$reg"
        fi
    }

    for REG in "${NPM_REGISTRIES[@]}"; do
        echo "  å°è¯: $REG"
        if _run_npm_install "$REG" && [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
            NPM_INSTALLED=1
            echo "  â ä¾èµå®è£æå ($REG)"
            break
        else
            echo "  â å¤±è´¥ï¼å°è¯ä¸ä¸ä¸ªéå..."
            rm -rf node_modules package-lock.json 2>/dev/null
        fi
    done

    if [ "$NPM_INSTALLED" -eq 0 ]; then
        echo "â ææ npm éåå®è£å¤±è´¥ï¼è¯·æå¨è¿è¡: cd core && npm install"
        exit 1
    fi
fi

# è¿è¡ CLI
if [ $# -eq 0 ]; then
    if [ "$INTERACTIVE" -eq 1 ]; then
        "$NODE_EXE" src/cli.js --help
    else
        # éäº¤äºç¯å¢ï¼é¢æ¿/Dockerï¼ï¼é»è®¤å¯å¨ Web é¢æ¿ä»¥ä¿æè¿ç¨å¸¸é©»
        echo "æªæå®å½ä»¤ï¼é»è®¤å¯å¨ Web ç®¡çé¢æ¿ (web start)"
        echo "å¦éå¶ä»å½ä»¤ï¼è¯·å¨å¯å¨åæ°ä¸­æå®ï¼ä¾å¦: server start"
        "$NODE_EXE" src/cli.js web start
    fi
else
    "$NODE_EXE" src/cli.js "$@"
fi