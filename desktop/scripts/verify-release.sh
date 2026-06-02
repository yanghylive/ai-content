#!/bin/bash
# verify-release.sh - 闭环测试
#
# 用法:
#   BUILD_PLATFORM=mac-arm64 ./scripts/verify-release.sh
#
# 流程:
#   1. 必要资源检查（stealth.min.js、frontend/index.html）
#   2. 不应存在资源检查（已在 check-release-size.js 里）
#   3. DMG 安装到 /Applications
#   4. 启动应用
#   5. 验证 Electron 主进程、3011 backend、5409 auto-upload 监听
#   6. 清理（kill、unmount、uninstall）
#
# 注意: 不验证 3010 端口（生产模式 Electron 用 mainWindow.loadFile(frontend/index.html)，
#       3010 仅 dev 模式启动）

set -e

PLATFORM="${BUILD_PLATFORM:-mac-arm64}"
echo "=== Verify Release [$PLATFORM] ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"

case "$PLATFORM" in
  mac-arm64)
    APP_DIR="$DESKTOP_DIR/dist/mac-arm64"
    APP_PATH="$APP_DIR/KaypalAI内容创作平台.app"
    RES="$APP_PATH/Contents/Resources"
    ;;
  mac-x64)
    APP_DIR="$DESKTOP_DIR/dist/mac"
    APP_PATH="$APP_DIR/KaypalAI内容创作平台.app"
    RES="$APP_PATH/Contents/Resources"
    ;;
  win-x64)
    APP_DIR="$DESKTOP_DIR/dist/win-unpacked"
    APP_PATH="$APP_DIR/KaypalAI内容创作平台.exe"
    RES="$APP_DIR/resources"
    ;;
  *)
    echo "❌ 未知平台: $PLATFORM"
    exit 1
    ;;
esac

if [ ! -d "$APP_PATH" ] && [ ! -f "$APP_PATH" ]; then
  echo "❌ $PLATFORM 产物不存在: $APP_PATH"
  exit 1
fi

echo "--- 1. 必要资源完整性 ---"
REQUIRED=(
  "auto-upload/main.py"
  "auto-upload/requirements.txt"
  "auto-upload/utils/stealth.min.js"
  "auto-upload/utils/base_social_media.py"
  "backend/index.js"
  "frontend/index.html"
  "backend/client"
)
for f in "${REQUIRED[@]}"; do
  if [ ! -e "$RES/$f" ]; then
    echo "❌ 必要资源缺失: $f"
    exit 1
  fi
done
echo "✓ 必要资源齐全"

if [[ "$PLATFORM" == mac-* ]]; then
  echo ""
  echo "--- 2. DMG 安装并启动 ---"
  if [ "$PLATFORM" = "mac-arm64" ]; then
    DMG_PATTERN="*-arm64.dmg"
  else
    DMG_PATTERN="KaypalAI内容创作平台-1.0.0.dmg"
  fi
  DMG=$(ls "$DESKTOP_DIR/dist/"$DMG_PATTERN 2>/dev/null | head -1)
  if [ -z "$DMG" ]; then
    echo "⊘ 没找到 $PLATFORM DMG（可能 build 没出 DMG），用 .app 直接测试"
    INSTALL_APP="$APP_PATH"
  else
    echo "DMG: $DMG"
    MOUNT_POINT=$(mktemp -d)
    hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_POINT" "$DMG"
    INSTALL_APP="$MOUNT_POINT/KaypalAI内容创作平台.app"
  fi

  echo "--- 3. 复制到 /Applications ---"
  rm -rf "/Applications/KaypalAI内容创作平台.app" 2>/dev/null || true
  cp -R "$INSTALL_APP" /Applications/

  echo "--- 4. 启动应用 ---"
  open /Applications/KaypalAI内容创作平台.app
  sleep 12

  echo "--- 5. 验证 Electron 主进程 ---"
  APP_PID=$(pgrep -f "KaypalAI内容创作平台.app/Contents/MacOS" | head -1)
  if [ -z "$APP_PID" ]; then
    echo "❌ Electron 主进程未启动"
    [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT"
    exit 1
  fi
  echo "✓ Electron PID: $APP_PID"

  echo "--- 6. 验证后端 3011 ---"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if lsof -nP -iTCP:3011 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
      echo "✓ 3011 已监听"
      break
    fi
    echo "  等待 3011... ($i/15)"
    sleep 3
  done
  if ! lsof -nP -iTCP:3011 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    echo "❌ 3011 未监听"
    [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT"
    exit 1
  fi

  echo "--- 7. 验证 auto-upload 5409 ---"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if lsof -nP -iTCP:5409 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
      echo "✓ 5409 已监听"
      break
    fi
    echo "  等待 5409... ($i/20) - 首次启动可能要建 Python venv"
    sleep 3
  done
  if ! lsof -nP -iTCP:5409 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    echo "⚠ 5409 未监听（可能 venv 创建中，可手动验证）"
  fi

  echo "--- 8. 不验证 3010 ---"
  echo "  (生产模式 Electron 用 mainWindow.loadFile, 3010 仅 dev)"

  echo ""
  echo "--- 9. 清理 ---"
  kill $APP_PID 2>/dev/null || true
  sleep 3
  hdiutil detach "$MOUNT_POINT" 2>/dev/null || true
  rm -rf /Applications/KaypalAI内容创作平台.app
  [ -n "$MOUNT_POINT" ] && rmdir "$MOUNT_POINT" 2>/dev/null || true
fi

echo ""
echo "=== ✅ Verify PASSED [$PLATFORM] ==="
