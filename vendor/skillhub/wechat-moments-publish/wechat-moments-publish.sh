#!/bin/bash
set -euo pipefail

CONTENT="${1:-}"
MODE="${2:-auto-send}"
ASSETS_TEXT="${3:-${AI_CONTENT_WECHAT_MOMENTS_ASSET_PATH:-}}"
ADDITIONAL_COMMENT="${4:-}"
VALIDATE_ONLY="${5:-}"

# --validate-only 兼容：作为参数传递或环境变量
if [ "${VALIDATE_ONLY:-}" = "validate-only" ] || [ "${AI_CONTENT_WECHAT_MOMENTS_VALIDATE_ONLY:-}" = "1" ]; then
  VALIDATE_ONLY="1"
else
  VALIDATE_ONLY=""
fi

usage() {
  echo "用法:"
  echo "  wechat-moments-publish \"朋友圈文案\" [auto-send|approval] \"/abs/path1
/abs/path2\" [附加评论] [validate-only]"
  echo "  wechat-moments-publish --validate-only \"朋友圈文案\" [auto-send|approval] \"/abs/path1
/abs/path2\""
}

if [ "$1" = "--validate-only" ]; then
  VALIDATE_ONLY="1"
  CONTENT="${2:-}"
  MODE="${3:-auto-send}"
  ASSETS_TEXT="${4:-}"
  ADDITIONAL_COMMENT="${5:-}"
fi

if [ -z "$CONTENT" ]; then
  echo "错误: 缺少朋友圈文案。"
  usage
  exit 1
fi

if [ -z "$ASSETS_TEXT" ]; then
  echo "错误: Mac 微信朋友圈当前走图文发表入口，必须提供真实素材路径。"
  usage
  exit 1
fi

# 媒体校验：统计图片/视频数量，禁止混选
IMAGE_COUNT=0
VIDEO_COUNT=0
ASSET_PATHS=()
while IFS= read -r one_asset; do
  [ -z "$one_asset" ] && continue
  if [ ! -f "$one_asset" ]; then
    echo "错误: 朋友圈素材不存在: $one_asset"
    exit 1
  fi
  case "$(echo "$one_asset" | tr '[:upper:]' '[:lower:]')" in
    *.jpg|*.jpeg|*.png|*.gif|*.heic|*.webp|*.bmp)
      IMAGE_COUNT=$((IMAGE_COUNT + 1)) ;;
    *.mp4|*.mov|*.avi|*.mkv|*.wmv|*.m4v)
      VIDEO_COUNT=$((VIDEO_COUNT + 1)) ;;
    *)
      echo "错误: 不支持的朋友圈素材格式: $one_asset"
      exit 1 ;;
  esac
  ASSET_PATHS+=("$one_asset")
done <<< "$ASSETS_TEXT"

if [ "$IMAGE_COUNT" -eq 0 ] && [ "$VIDEO_COUNT" -eq 0 ]; then
  echo "错误: 朋友圈素材列表为空，不能发布。"
  exit 1
fi

if [ "$IMAGE_COUNT" -gt 0 ] && [ "$VIDEO_COUNT" -gt 0 ]; then
  echo "错误: 不能同时混选图片和视频。图片=$IMAGE_COUNT，视频=$VIDEO_COUNT。朋友圈一条动态只能发纯图片或纯视频。"
  exit 1
fi

if [ "$IMAGE_COUNT" -gt 9 ]; then
  echo "错误: 朋友圈最多 9 张图片，当前 $IMAGE_COUNT 张。"
  exit 1
fi

echo "素材校验通过: 图片=$IMAGE_COUNT，视频=$VIDEO_COUNT"

if [ -n "$VALIDATE_ONLY" ]; then
  echo "validate-only: 校验完成，未执行发布。"
  exit 0
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

ASSETS_JOINED="$(printf '%s\n' "${ASSET_PATHS[@]}")"

if [ "$MODE" = "approval" ]; then
  echo "approval-calibrate: 审批模式，发布前截图校准。"
fi

osascript "$APPLESCRIPT" "$CONTENT" "$MODE" "$ASSETS_JOINED" "$ADDITIONAL_COMMENT"
