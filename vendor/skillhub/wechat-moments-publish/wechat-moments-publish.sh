#!/bin/bash
set -euo pipefail

CONTENT="${1:-}"
MODE="${2:-auto-send}"
ASSET_PATH="${3:-${AI_CONTENT_WECHAT_MOMENTS_ASSET_PATH:-}}"

if [ -z "$CONTENT" ]; then
  echo "用法:"
  echo "  wechat-moments-publish \"朋友圈文案\" [auto-send|approval] /absolute/image-path"
  exit 1
fi

if [ -z "$ASSET_PATH" ]; then
  echo "错误: Mac 微信朋友圈当前走图文发表入口，必须提供真实素材路径。"
  exit 1
fi

if [ ! -f "$ASSET_PATH" ]; then
  echo "错误: 朋友圈素材不存在: $ASSET_PATH"
  exit 1
fi

if ! command -v cliclick >/dev/null 2>&1; then
  echo "错误: 缺少 cliclick，不能真实点击微信桌面。"
  exit 1
fi

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
APPLESCRIPT="$SCRIPT_DIR/wechat-moments-publish.applescript"

if [ ! -f "$APPLESCRIPT" ]; then
  echo "错误: 找不到 applescript 文件: $APPLESCRIPT"
  exit 1
fi

osascript "$APPLESCRIPT" "$CONTENT" "$MODE" "$ASSET_PATH"
