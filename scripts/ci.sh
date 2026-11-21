#!/usr/bin/env bash
# 本地 / 任意 CI 通用的回归入口
# ------------------------------------------------------------
# GitHub Actions 用的是 .github/workflows/ci.yml，内容就是这三步；
# 如果以后接 Gitee Go / Jenkins / 自建 runner，直接调用本脚本即可，
# 不用维护第二份 YAML。
#
# 用法：
#   bash scripts/ci.sh            # 按锁文件安装 + 全量测试
#   bash scripts/ci.sh --check    # 只做语法检查，不装依赖、不跑测试
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/core"

if [ "${1:-}" = "--check" ]; then
    find . -path ./node_modules -prune -o -name '*.js' -print0 | xargs -0 -r -n1 node --check
    echo "✅ 语法检查通过"
    exit 0
fi

if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
else
    echo "⚠️ 没有 package-lock.json，退回 npm install（结果不可复现）"
    npm install --no-audit --no-fund
fi

find . -path ./node_modules -prune -o -name '*.js' -print0 | xargs -0 -r -n1 node --check
npm test
