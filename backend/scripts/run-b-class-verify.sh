#!/usr/bin/env bash
# ============================================================
# run-b-class-verify.sh —— B 类真机验证一键 wrapper（2026-09-06 固化）
#
# 背景：verify-b-class-realmachine.mjs 的生境要求「验证后端与主库同库」
# （脚本往主库插临时账号+session，再打后端 API）。2026-09-06 起 3013
# 改为独立库隔离（launchd plist，KAYPAL_DESKTOP_USER_DATA_DIR=3013-user-data），
# 与脚本生境冲突（直打 3013 会 401）。
#
# 本 wrapper 固化当晚验证的临时实例模式：
#   起临时 3015（source env.secure，不设 KAYPAL_DESKTOP_USER_DATA_DIR → 主库）
#   → 等 health → VERIFY_BASE=3015 跑 verify → finally 杀 3015。
#   不碰 3011（生产）/3013（隔离）现役实例。
#
# 用法：bash scripts/run-b-class-verify.sh [platform] [accountId] [keyword]
#   例：bash scripts/run-b-class-verify.sh xiaohongshu 7 穿搭
# ============================================================
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ROOT="${KAYPAL_RUNTIME_ROOT:-$HOME/.workbuddy/ai-content-backend}"
ENV_FILE="$RUNTIME_ROOT/backend.env.secure"
VERIFY_PORT=3015
NODE_BIN="/Users/yanghy/.workbuddy/binaries/node/versions/22.22.2-2/bin/node"

cleanup() {
  if [ -n "${VERIFY_PID:-}" ] && kill -0 "$VERIFY_PID" 2>/dev/null; then
    kill "$VERIFY_PID" 2>/dev/null && echo "[wrapper] 临时验证实例($VERIFY_PID) 已停止"
  fi
  rm -f /tmp/k-verify.env
}
trap cleanup EXIT

# 0) 前置检查
if [ ! -f "$ENV_FILE" ]; then echo "❌ env 文件缺失: $ENV_FILE"; exit 2; fi
if [ "$(stat -f%Lp "$ENV_FILE" 2>/dev/null || echo 600)" != "600" ]; then
  echo "❌ env 文件权限非 600: $ENV_FILE"; exit 2
fi
if lsof -nP -iTCP:$VERIFY_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "❌ 端口 $VERIFY_PORT 已被占用（拒绝覆盖既有实例）"; exit 2
fi
if [ ! -f "$RUNTIME_ROOT/dist-bundle-sqlite/index.js" ]; then
  echo "❌ runtime bundle 缺失: $RUNTIME_ROOT/dist-bundle-sqlite/index.js"; exit 2
fi

# 1) 起临时 3015（同主库：不设 KAYPAL_DESKTOP_USER_DATA_DIR）
set -a
. "$ENV_FILE"
set +a
unset KAYPAL_DESKTOP_USER_DATA_DIR
export PORT=$VERIFY_PORT
export NODE_PATH="$RUNTIME_ROOT/dist-bundle-sqlite/node_modules"
export KAYPAL_PLAYWRIGHT_BROWSERS_PATH="$RUNTIME_ROOT/playwright-browsers"
export PLAYWRIGHT_BROWSERS_PATH="$RUNTIME_ROOT/playwright-browsers"
"$NODE_BIN" "$RUNTIME_ROOT/dist-bundle-sqlite/index.js" > /tmp/k-verify-3015.log 2>&1 &
VERIFY_PID=$!
echo "[wrapper] 临时验证实例 pid=$VERIFY_PID port=$VERIFY_PORT"

# 2) 等 health（最多 30s）
OK=0
for i in $(seq 1 15); do
  sleep 2
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:$VERIFY_PORT/api/health" 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then OK=1; break; fi
done
if [ "$OK" != "1" ]; then
  echo "❌ 临时实例 health 未就绪（最后状态 $CODE），日志："
  tail -10 /tmp/k-verify-3015.log
  exit 3
fi
echo "[wrapper] 临时实例就绪 health=200"

# 3) 跑 verify（透传全部参数 + VERIFY_BASE 指向临时实例）
cd "$BACKEND_ROOT"
VERIFY_BASE="http://127.0.0.1:$VERIFY_PORT" "$NODE_BIN" \
  scripts/verify-b-class-realmachine.mjs "$@"
RC=$?
echo "[wrapper] verify exit=$RC"
exit $RC
