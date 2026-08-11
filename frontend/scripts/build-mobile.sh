#!/usr/bin/env bash
# ============================================================
# build-mobile.sh —— 构建移动端产物（供 Android 模拟器 WebView）
# API base = http://10.0.2.2:3421/api（走静态服务器 3421 代理）
# 产物输出：frontend/out-mobile/
# 用法：NODE_BIN=... ./build-mobile.sh   （NODE_BIN 默认取 PATH 里的 node）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."   # 进入 frontend/

NODE_BIN="${NODE_BIN:-node}"
ENV_LOCAL=".env.local"
BAK="/tmp/env.local.mobile-bak.$$"
API_BASE="http://10.0.2.2:3421/api"

restore_env() { [ -f "$BAK" ] && mv "$BAK" "$ENV_LOCAL" 2>/dev/null || true; }
trap restore_env EXIT

echo "==> 挪开 .env.local（避免 localhost base 污染移动产物）"
[ -f "$ENV_LOCAL" ] && mv "$ENV_LOCAL" "$BAK"

echo "==> next build（NEXT_PUBLIC_API_BASE=${API_BASE}）"
NEXT_PUBLIC_API_BASE="$API_BASE" \
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
  "$NODE_BIN" node_modules/.bin/next build

restore_env && trap - EXIT
echo "==> .env.local 已恢复"

echo "==> 复制产物 -> out-mobile/"
/bin/rm -rf out-mobile && cp -r out out-mobile

echo "==> 产物校验："
grep -rho "http://10.0.2.2:3421[^\"]*" out-mobile/_next/static/chunks/*.js 2>/dev/null | sort | uniq -c | head -3
echo "✅ out-mobile/ 就绪（模拟器 WebView 用，端口 3421）"
