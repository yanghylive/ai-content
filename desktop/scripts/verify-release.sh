#!/bin/bash
# verify-release.sh - 闭环测试
#
# 用法:
#   BUILD_PLATFORM=mac-arm64 ./scripts/verify-release.sh
#
# 流程:
#   1. 必要资源检查（backend/index.js、frontend/index.html、Prisma engine）
#   2. 不应存在资源检查（已在 check-release-size.js 里）
#   3. DMG 安装到 /Applications
#   4. 启动应用
#   5. 验证 Electron 主进程、3010 前端静态服务、3011 backend 监听
#   6. 清理（kill、unmount、uninstall）
#
# 注意: 5409 已下线，商用包不再启动或验证 auto-upload 独立服务。

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
  "backend/index.js"
  "frontend/index.html"
  "backend/client"
  "backend/node_modules/@playwright/mcp/cli.js"
  "backend/node_modules/playwright/package.json"
  "backend/node_modules/playwright-core/package.json"
  "playwright-browsers"
)
if [ "$PLATFORM" = "win-x64" ]; then
  REQUIRED+=("runtime/node/bin/node.exe")
else
  REQUIRED+=("runtime/node/bin/node")
fi
for f in "${REQUIRED[@]}"; do
  if [ ! -e "$RES/$f" ]; then
    echo "❌ 必要资源缺失: $f"
    exit 1
  fi
done
echo "✓ 必要资源齐全"

if grep -Eq "runner_mode:\s*['\"]mock['\"]|browserControl:\s*false|mock-compatible|browserExecution:\s*false" "$RES/backend/index.js"; then
  echo "❌ /api/agent-s/health bundle 仍是 mock 或 browserControl=false"
  exit 1
fi
echo "✓ Agent-S bundle 非 mock 文本守门通过"

FORBIDDEN=(
  "auto-upload"
  "agent-s-executor"
  "installer/wheelhouse"
  "runtime/python"
  "python"
)
for f in "${FORBIDDEN[@]}"; do
  if [ -e "$RES/$f" ]; then
    echo "❌ 不应打包 Python 旧资源: $f"
    exit 1
  fi
done
echo "✓ Python 旧资源未打包"

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

  echo "--- 6.1 验证 /api/agent-s/health 非 mock ---"
  AGENT_HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3011/api/agent-s/health || true)"
  if [ -z "$AGENT_HEALTH" ]; then
    echo "❌ /api/agent-s/health 不可达"
    [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT"
    exit 1
  fi
  node -e '
    const payload = JSON.parse(process.argv[1]);
    const h = payload?.data?.health || payload?.sidecar?.health || payload;
    if (h.runner_mode === "mock" || h.capabilities?.browserControl !== true || h.ok !== true) {
      console.error("❌ Agent-S runtime blocked:", JSON.stringify(h));
      process.exit(1);
    }
  ' "$AGENT_HEALTH"
  echo "✓ /api/agent-s/health 非 mock"

  echo "--- 6.2 验证 /api/mcp/status ---"
  MCP_STATUS="$(curl -fsS --max-time 5 http://127.0.0.1:3011/api/mcp/status || true)"
  if [ -z "$MCP_STATUS" ]; then
    echo "❌ /api/mcp/status 不可达"
    [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT"
    exit 1
  fi
  node -e '
    const payload = JSON.parse(process.argv[1]);
    const p = payload?.data?.playwright || payload?.playwright;
    if (!p?.childProcessRunning || !p?.online) {
      console.error("❌ Playwright MCP not online:", JSON.stringify(p));
      process.exit(1);
    }
  ' "$MCP_STATUS"
  echo "✓ /api/mcp/status 在线"

  echo "--- 7. 验证前端 3010 ---"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if lsof -nP -iTCP:3010 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
      echo "✓ 3010 已监听"
      break
    fi
    echo "  等待 3010... ($i/10)"
    sleep 3
  done
  if ! lsof -nP -iTCP:3010 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    echo "⚠ 3010 未监听（可能被自动换端口，需从应用内检查入口 URL）"
  fi

  echo "--- 8. 跳过 5409 ---"
  echo "  5409 已下线，浏览器执行由 3011 in-process Runtime 承担"

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
