#!/bin/bash
set -euo pipefail

TARGET="${1:-}"
COMMENT="${2:-}"
MODE="${3:-approval}"
ACTION_KIND="${4:-like-comment}"
BROWSE_INDEX="${5:-1}"
SCREENSHOT_PATH="/tmp/ai-content-wechat-moments-marketing-$(date +%s).png"
LIKE_X="${AI_CONTENT_WECHAT_MOMENTS_LIKE_OFFSET_X:-362}"
LIKE_Y="${AI_CONTENT_WECHAT_MOMENTS_LIKE_OFFSET_Y:-691}"
COMMENT_X="${AI_CONTENT_WECHAT_MOMENTS_COMMENT_OFFSET_X:-475}"
COMMENT_Y="${AI_CONTENT_WECHAT_MOMENTS_COMMENT_OFFSET_Y:-691}"

if [ -z "$TARGET" ]; then
  echo "用法:"
  echo "  wechat-moments-marketing \"联系人或朋友圈\" \"评论内容\" [auto-send|approval] [like|comment|like-comment] [浏览序号]"
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
APPLESCRIPT="$SCRIPT_DIR/wechat-moments-marketing.applescript"

if [ ! -f "$APPLESCRIPT" ]; then
  echo "错误: 找不到 applescript 文件: $APPLESCRIPT"
  exit 1
fi

open -b com.tencent.xinWeChat >/dev/null 2>&1 || true
OUTPUT="$(osascript "$APPLESCRIPT" "$TARGET" "$COMMENT" "$MODE" "$ACTION_KIND" "$BROWSE_INDEX" "$SCREENSHOT_PATH" "$LIKE_X" "$LIKE_Y" "$COMMENT_X" "$COMMENT_Y")"
screencapture -x "$SCREENSHOT_PATH" >/dev/null 2>&1 || true
printf '%s\n' "$OUTPUT"
