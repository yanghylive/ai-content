#!/usr/bin/env bash
# ============================================================
# build-desktop.sh —— 构建桌面端产物（供 macOS 浏览器/Playwright）
# API base = http://localhost:3011/api（后端直连）
# 产物输出：frontend/out-desktop/
# 用法：NODE_BIN=... ./build-desktop.sh （NODE_BIN 默认取 PATH 里的 node）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."   # 进入 frontend/

NODE_BIN="${NODE_BIN:-node}"
ENV_LOCAL=".env.local"
BAK="/tmp/env.local.desktop-bak.$$"
API_BASE="http://localhost:3011/api"

restore_env() { [ -f "$BAK" ] && mv "$BAK" "$ENV_LOCAL" 2>/dev/null || true; }
trap restore_env EXIT

echo "==> 挪开 .env.local（统一由本脚本注入 API base）"
[ -f "$ENV_LOCAL" ] && mv "$ENV_LOCAL" "$BAK"

echo "==> next build（NEXT_PUBLIC_API_BASE=${API_BASE}）"
NEXT_PUBLIC_API_BASE="$API_BASE" \
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
  "$NODE_BIN" node_modules/.bin/next build

restore_env && trap - EXIT
echo "==> .env.local 已恢复"

echo "==> 复制产物 -> out-desktop/"
rm -rf out-desktop && cp -r out out-desktop

echo "==> 产物校验："
grep -rho "http://localhost:3011[^\"]*" out-desktop/_next/static/chunks/*.js 2>/dev/null | sort | uniq -c | head -3
echo "✅ out-desktop/ 就绪（桌面浏览器/Playwright 用，端口 3422）"
