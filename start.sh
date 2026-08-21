#!/bin/bash
# 简幻欢等自定义镜像兼容入口：平台固定执行根目录 start.sh 来启动服务器
# 实际启动逻辑已统一到 wow.sh，此处仅做转发，避免维护两份脚本
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/wow.sh" "$@"
