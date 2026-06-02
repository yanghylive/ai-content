#!/bin/bash
set -euo pipefail

CONTACT="${1:-}"
MESSAGE="${2:-}"
MODE="${3:-auto-send}"

if [ -z "$CONTACT" ]; then
  echo "用法:"
  echo "  wechat-auto-reply \"联系人名称\" \"消息内容\" [auto-send|approval]"
  exit 1
fi

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
APPLESCRIPT="$SCRIPT_DIR/wechat-dm.applescript"

if [ ! -f "$APPLESCRIPT" ]; then
  echo "错误: 找不到 applescript 文件: $APPLESCRIPT"
  exit 1
fi

if [ -n "$MESSAGE" ]; then
  osascript "$APPLESCRIPT" "$CONTACT" "$MESSAGE" "$MODE"
else
  osascript "$APPLESCRIPT" "$CONTACT"
fi
