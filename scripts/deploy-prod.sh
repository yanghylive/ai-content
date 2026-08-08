#!/usr/bin/env bash
# =============================================================================
# ai-content 生产部署脚本（aicontent.vip.kaypal.cn / kaypal-prod-new 118.178.108.44）
#
# 用法：
#   ./scripts/deploy-prod.sh            # 前后端一起部署
#   ./scripts/deploy-prod.sh --backend  # 只部署后端（dist + .env + systemd 重启）
#   ./scripts/deploy-prod.sh --frontend # 只部署前端（静态 out）
#
# 前置：本地已 build（本脚本会重新 build 确保最新）
# 坑位（2026-08-06 实战沉淀）：
#   - SSH 不稳：118.178.108.44 常超时，自动重试 3 次
#   - safe-delete 拦 nest clean / next clean：build 前先 mv 走 dist/.next
#   - Turbopack 不容忍 NODE_OPTIONS=--use-system-ca：前端 build 必须 env -u NODE_OPTIONS
#   - 后端非 watch：改代码必须 build + rsync + systemctl restart
#   - ⚠️ prisma 模型变更（2026-08-06 三次踩坑）：deploy 只传 dist 会导致云端 client 缺新模型 500。
#     本脚本已内置：rsync prisma/schema.prisma + migrations/ → 云端 prisma generate → 重启
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
DO_TAG=0
for arg in "$@"; do
  case "$arg" in
    --backend) DO_BACKEND=1 ;;
    --frontend) DO_FRONTEND=1 ;;
    --tag) DO_TAG=1 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done
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

# rsync 带重试（SCP 通道不稳）
rsync_retry() {
  local src="$1" dst="$2"
  for i in 1 2 3; do
    if rsync -az -e "ssh $SSH_OPTS" "$src" "$dst" 2>/dev/null; then
      return 0
    fi
    echo "[warn] rsync 重试 $i/3..." >&2
    sleep 3
  done
  echo "[error] rsync 失败: $src -> $dst" >&2
  return 1
}

# 同步 prisma schema + migrations 到云端，并执行云端 prisma generate（模型变更必需）
sync_prisma() {
  echo "== [2.5/4] 同步 prisma + 云端 generate =="
  local schema="$REPO_ROOT/backend/prisma/schema.prisma"
  local local_md5 remote_md5
  local_md5=$(md5 -q "$schema" 2>/dev/null || md5sum "$schema" | awk '{print $1}')

  rsync_retry "$schema" "$HOST:$REMOTE_BACKEND_DIR/prisma/schema.prisma"
  # md5 校验（确保 schema 真正落地，SSH 不稳时重复传）
  remote_md5=""
  for i in 1 2 3; do
    remote_md5=$(ssh_retry "md5 -q $REMOTE_BACKEND_DIR/prisma/schema.prisma 2>/dev/null || md5sum $REMOTE_BACKEND_DIR/prisma/schema.prisma | awk '{print \$1}'" 2>/dev/null || true)
    [ "$local_md5" = "$remote_md5" ] && break
    echo "[warn] schema md5 不一致（$local_md5 vs $remote_md5），重传 $i/3..." >&2
    rsync_retry "$schema" "$HOST:$REMOTE_BACKEND_DIR/prisma/schema.prisma"
    sleep 2
  done
  [ "$local_md5" = "$remote_md5" ] || { echo "[error] schema 同步校验失败" >&2; return 1; }

  rsync_retry "$REPO_ROOT/backend/prisma/migrations/" "$HOST:$REMOTE_BACKEND_DIR/prisma/migrations/"
  # 云端 prisma generate（幂等）
  ssh_retry "cd $REMOTE_BACKEND_DIR && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx prisma generate 2>&1 | grep -q Generated && echo 'prisma generate OK'"
  echo "prisma 同步 + generate 完成 ✅"
}

# ---------- 后端 ----------
deploy_backend() {
  echo "== [1/4] 后端 build =="
  cd "$REPO_ROOT/backend"
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx tsc --noEmit
  if [ -d dist ]; then mv dist "/tmp/dist-deploy-bak-$(date +%s)"; fi
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npm run build

  echo "== [2/4] 上传 dist =="
  rsync_retry "dist/" "$HOST:$REMOTE_BACKEND_DIR/dist/"

  sync_prisma

  echo "== [3/4] 检查 STUDIO_CORE 配置 =="
  ssh_retry "grep -q STUDIO_CORE_SSE_URL $REMOTE_BACKEND_DIR/.env || echo '
# studio_core 反代（云端 8600 容器跑 FastAPI api.py，含单项目/SSE/control 完整 API）
STUDIO_CORE_SSE_URL=http://127.0.0.1:8600
STUDIO_CORE_URL=http://127.0.0.1:8600
STUDIO_CORE_USERNAME=admin
STUDIO_CORE_PASSWORD=admin123
' >> $REMOTE_BACKEND_DIR/.env; grep STUDIO_CORE_SSE_URL $REMOTE_BACKEND_DIR/.env"

  echo "== [4/4] 重启 + 健康验证 =="
  ssh_retry "systemctl restart ai-content-backend && sleep 10 && systemctl is-active ai-content-backend && curl -s -m 5 http://127.0.0.1:3111/api/health | head -c 100"
  echo "后端部署完成 ✅"
}

# ---------- 前端 ----------
deploy_frontend() {
  echo "== [1/3] 前端 build（静态导出）=="
  cd "$REPO_ROOT/frontend"
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx tsc --noEmit
  if [ -d .next ]; then mv .next "/tmp/next-deploy-bak-$(date +%s)"; fi
  # NEXT_PUBLIC_* 在 next build 时会被内联成字面量。本地 .env.local 是
  # http://localhost:3011/api，不覆盖就会被打进生产包 → 手机壳 / 公网所有 fetch
  # 都打到客户端自己的 localhost:3011（必失败）。生产一律走同源 /api（nginx 反代）。
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
    NEXT_PUBLIC_API_BASE=/api npx next build

  echo "== [2/3] 上传 out =="
  rsync_retry "out/" "$HOST:$REMOTE_FRONTEND_DIR/out/"

  echo "== [3/3] 公网验证 =="
  for p in today content video-studio; do
    code=$(env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      curl -s -o /dev/null -w "%{http_code}" -m 10 "$PUBLIC_BASE/$p")
    echo "  /$p -> $code"
  done
  echo "前端部署完成 ✅"
}

[ "$DO_BACKEND" = 1 ] && deploy_backend
[ "$DO_FRONTEND" = 1 ] && deploy_frontend

# ---------- 版本 tag（回滚锚点）----------
if [ "$DO_TAG" = 1 ]; then
  TAG="prod-$(date +%Y%m%d-%H%M%S)-$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  if git -C "$REPO_ROOT" tag "$TAG" 2>/dev/null && git -C "$REPO_ROOT" push origin "$TAG" 2>/dev/null; then
    echo "已打发布 tag: $TAG（回滚用：./scripts/rollback-prod.sh $TAG）"
  else
    echo "[warn] 打 tag $TAG 失败（可能无远端写权限），回滚将改用 git log 定位"
  fi
fi

echo "全部完成 🎉"
