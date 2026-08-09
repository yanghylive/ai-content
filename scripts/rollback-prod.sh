#!/usr/bin/env bash
# =============================================================================
# ai-content 生产回滚脚本
#
# 用法：
#   ./scripts/rollback-prod.sh                # 回滚到上一个 prod-* tag（全量）
#   ./scripts/rollback-prod.sh --backend      # 只回滚后端
#   ./scripts/rollback-prod.sh --frontend     # 只回滚前端
#   ./scripts/rollback-prod.sh <commit|tag>   # 回滚到指定 commit/tag
#   ./scripts/rollback-prod.sh --list         # 列出最近的发布 tag
#
# 原理：git worktree 检出目标版本到临时目录 → 在该目录 build → rsync → restart/替换
#   （不触碰当前工作区，未提交改动不受影响）
#
# 坑位（与 deploy-prod.sh 相同）：
#   - SSH/rsync 不稳：自动重试
#   - 前端 build 必须 env -u NODE_OPTIONS（Turbopack 不容忍 --use-system-ca）
#   - 后端 prisma 模型变更：rsync schema + migrations → 云端 prisma generate
#   - 回滚后务必 curl /api/health + 公网页面验证
# =============================================================================
set -euo pipefail

HOST="kaypal-prod-new"
REMOTE_BACKEND_DIR="/www/wwwroot/ai-content/backend"
REMOTE_FRONTEND_DIR="/www/wwwroot/ai-content/frontend"
PUBLIC_BASE="https://aicontent.vip.kaypal.cn"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS="-o ConnectTimeout=20 -o ServerAliveInterval=10"

DO_BACKEND=0
DO_FRONTEND=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --backend) DO_BACKEND=1 ;;
    --frontend) DO_FRONTEND=1 ;;
    --list)
      echo "=== 最近的 prod-* 发布 tag ==="
      git -C "$REPO_ROOT" tag -l 'prod-*' --sort=-v:refname | head -10
      echo "=== 最近 10 个提交（含未打 tag 的部署）==="
      git -C "$REPO_ROOT" log --oneline -10
      exit 0
      ;;
    --*) echo "未知参数: $arg" >&2; exit 1 ;;
    *) TARGET="$arg" ;;
  esac
done

# 默认目标：上一个 prod-* tag（即当前之外最近的一个）
if [ -z "$TARGET" ]; then
  TARGET="$(git -C "$REPO_ROOT" tag -l 'prod-*' --sort=-v:refname | sed -n '2p')"
  if [ -z "$TARGET" ]; then
    echo "[error] 没有找到可回滚的 prod-* tag，请显式指定 commit/tag" >&2
    echo "  ./scripts/rollback-prod.sh <commit|tag>" >&2
    exit 1
  fi
fi
echo "== 回滚目标: $TARGET =="

# 校验目标存在
if ! git -C "$REPO_ROOT" rev-parse --verify "$TARGET^{commit}" >/dev/null 2>&1; then
  echo "[error] 目标不存在: $TARGET" >&2
  exit 1
fi

if [ "$DO_BACKEND" = 0 ] && [ "$DO_FRONTEND" = 0 ]; then
  DO_BACKEND=1
  DO_FRONTEND=1
fi

# ---------- 工具函数 ----------
ssh_retry() {
  local cmd="$1" out=""
  for i in 1 2 3; do
    if out=$(ssh $SSH_OPTS "$HOST" "$cmd" 2>&1); then
      echo "$out"
      return 0
    fi
    echo "[warn] SSH 重试 $i/3..." >&2
    sleep 3
  done
  echo "[error] SSH 连接失败: $out" >&2
  return 1
}

rsync_retry() {
  local src="$1" dst="$2"
  for i in 1 2 3; do
    if rsync -az --delete -e "ssh $SSH_OPTS" "$src" "$dst" 2>/dev/null; then
      return 0
    fi
    echo "[warn] rsync 重试 $i/3..." >&2
    sleep 3
  done
  echo "[error] rsync 失败" >&2
  return 1
}

# ---------- 临时 worktree ----------
WORKTREE="/tmp/ai-content-rollback-$(date +%s)"
echo "== 检出 $TARGET 到 $WORKTREE =="
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE" "$TARGET"
trap 'git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" 2>/dev/null || true' EXIT

# ---------- 后端 ----------
rollback_backend() {
  echo "== [1/3] 后端 build（worktree 内）=="
  ( cd "$WORKTREE/backend" && \
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx tsc --noEmit && \
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npm run build )

  echo "== [2/3] 上传 dist + prisma schema =="
  rsync_retry "$WORKTREE/backend/dist/" "$HOST:$REMOTE_BACKEND_DIR/dist/"
  rsync_retry "$WORKTREE/backend/prisma/schema.prisma" "$HOST:$REMOTE_BACKEND_DIR/prisma/schema.prisma"
  rsync_retry "$WORKTREE/backend/prisma/migrations/" "$HOST:$REMOTE_BACKEND_DIR/prisma/migrations/"

  echo "== [3/3] 云端 prisma generate + 重启 + health =="
  ssh_retry "cd $REMOTE_BACKEND_DIR && npx prisma generate && systemctl restart ai-content-backend && sleep 10 && systemctl is-active ai-content-backend && curl -s -m 5 http://127.0.0.1:3111/api/health | head -c 200"
  echo "后端回滚完成 ✅"
}

# ---------- 前端 ----------
rollback_frontend() {
  echo "== [1/3] 前端 build（worktree 内，静态导出）=="
  ( cd "$WORKTREE/frontend" && \
    if [ -d .next ]; then mv .next "/tmp/next-rollback-bak-$(date +%s)"; fi
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
      NEXT_PUBLIC_API_BASE=/api npx next build )

  echo "== [2/3] 上传 out =="
  rsync_retry "$WORKTREE/frontend/out/" "$HOST:$REMOTE_FRONTEND_DIR/out/"

  echo "== [3/3] 公网验证 =="
  for p in today content video-studio; do
    code=$(env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      curl -s -o /dev/null -w "%{http_code}" -m 10 "$PUBLIC_BASE/$p")
    echo "  /$p -> $code"
  done
  echo "前端回滚完成 ✅"
}

[ "$DO_BACKEND" = 1 ] && rollback_backend
[ "$DO_FRONTEND" = 1 ] && rollback_frontend
echo "回滚完成 🎉（目标 $TARGET，临时 worktree 已清理）"
