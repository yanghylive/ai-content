#!/bin/bash
set -euo pipefail

CONTEXT="${1:-}"
MODE="${2:-auto-send}"
REPLY="${3:-}"
PYTHON="${PYTHON:-python3}"

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

exec "$PYTHON" "$SCRIPT_DIR/wechat-live-auto-reply.py" "$CONTEXT" "$MODE" "$REPLY"
