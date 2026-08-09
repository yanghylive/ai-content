#!/bin/bash
# lean-build.sh - 一键瘦包构建
#
# 用法:
#   BUILD_PLATFORM=mac-arm64 ./scripts/lean-build.sh
#
# 流程:
#   1. 清理 frontend/out (移除 dev/cache 残留)
#   2. 重新 build frontend (next build)
#   3. 按平台修改 Prisma binaryTargets
#   4. 重新生成 Prisma client
#   5. 检查商业资产
#   6. build Electron app
#   7. 守门: check-release-size
#   8. 闭环: verify-release (启动 + 端口验证)

set -e

PLATFORM="${BUILD_PLATFORM:-mac-arm64}"
echo "=== Lean Build for $PLATFORM ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"
FRONTEND_DIR="$REPO_ROOT/frontend"
BACKEND_DIR="$REPO_ROOT/backend"

restore_prisma_schema() {
  if [ -f "$BACKEND_DIR/prisma/schema.prisma.engine-backup" ]; then
    echo ""
    echo "--- 恢复 Prisma schema（退出保护） ---"
    BUILD_PLATFORM=$PLATFORM node "$DESKTOP_DIR/scripts/prepare-prisma-engines.js" restore || true
  fi
}

trap restore_prisma_schema EXIT INT TERM

echo "--- 1. 清理 frontend/out ---"
if [ -d "$FRONTEND_DIR/out" ]; then
  rm -rf "$FRONTEND_DIR/out"
  echo "✓ 已清理 frontend/out"
else
  echo "⊘ frontend/out 不存在，跳过"
fi

echo ""
echo "--- 2. 重新 build frontend (next build) ---"
cd "$FRONTEND_DIR"
KAYPAL_BUILD_DIST_DIR=out \
  KAYPAL_SKIP_NEXT_BUILD_LINT=1 \
  KAYPAL_SKIP_NEXT_BUILD_TYPECHECK=1 \
  node node_modules/next/dist/bin/next build 2>&1 | tail -3

echo ""
echo "--- 3. 准备 Prisma binaryTargets ---"
cd "$DESKTOP_DIR"
BUILD_PLATFORM=$PLATFORM node scripts/prepare-prisma-engines.js set

echo ""
echo "--- 4. 重新生成 Prisma client ---"
cd "$BACKEND_DIR"
rm -rf node_modules/.prisma/client
npx prisma generate 2>&1 | tail -3
cd "$DESKTOP_DIR"

echo ""
echo "--- 4b. 还原 Prisma schema ---"
BUILD_PLATFORM=$PLATFORM node scripts/prepare-prisma-engines.js restore

echo ""
echo "--- 5. 检查商业资产 ---"
node scripts/check-commercial-assets.js 2>&1 | tail -10

echo ""
echo "--- 6. build Electron app ---"
case "$PLATFORM" in
  mac-arm64)
    BUILD_ARCH=arm64 npx electron-builder --mac --arm64
    ;;
  mac-x64)
    BUILD_ARCH=x64 npx electron-builder --mac --x64
    ;;
  win-x64)
    npm run build:win
    ;;
  *)
    echo "❌ 未知平台: $PLATFORM"
    exit 1
    ;;
esac

echo ""
echo "--- 7. 守门: check-release-size ---"
BUILD_PLATFORM=$PLATFORM node scripts/check-release-size.js

echo ""
echo "--- 8. 闭环: verify-release ---"
BUILD_PLATFORM=$PLATFORM ./scripts/verify-release.sh

echo ""
echo "=== ✅ Lean Build Complete [$PLATFORM] ==="
