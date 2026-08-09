#!/bin/bash
set -euo pipefail

TARGET="${1:-}"
VERIFY_MESSAGE="${2:-}"
MODE="${3:-approval}"
REMARK_STRATEGY="${4:-none}"
REMARK_CONTENT="${5:-}"

if [ -z "$TARGET" ] || [ -z "$VERIFY_MESSAGE" ]; then
  echo "用法:"
  echo "  wechat-contact-add \"微信号或手机号\" \"验证消息\" [auto-send|approval] [remark-strategy] [remark-content]"
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
APPLESCRIPT="$SCRIPT_DIR/wechat-contact-add.applescript"

if [ ! -f "$APPLESCRIPT" ]; then
  echo "错误: 找不到 applescript 文件: $APPLESCRIPT"
  exit 1
fi

osascript "$APPLESCRIPT" "$TARGET" "$VERIFY_MESSAGE" "$MODE" "$REMARK_STRATEGY" "$REMARK_CONTENT"
