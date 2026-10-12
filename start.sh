#!/bin/bash
# 简幻欢等自定义镜像兼容入口：平台固定执行根目录 start.sh 来启动服务器
# 实际启动逻辑已统一到 wow.sh，此处先（最佳努力）自检更新，再转发 wow.sh。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 启动前检查更新（运行 update.sh）：
#   - 优先 Gitee、失败回退 GitHub，全程失败仅警告不阻断启动（见 update.sh 设计原则）；
#   - 可通过环境变量 WOW_SKIP_UPDATE=1 跳过（如本地开发调试，避免每次启动都联网）。
if [ "${WOW_SKIP_UPDATE:-0}" != "1" ]; then
    if [ -f "$SCRIPT_DIR/update.sh" ]; then
        echo "▶ 启动前检查更新 (update.sh)..."
        if bash "$SCRIPT_DIR/update.sh"; then
            echo "▶ 更新检查完成"
        else
            echo "⚠️ 更新检查失败，继续启动（不影响服务）"
        fi
    fi
fi

exec "$SCRIPT_DIR/wow.sh" "$@"
