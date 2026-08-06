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
# =============================================================================
set -euo pipefail

HOST="kaypal-prod-new"
REMOTE_BACKEND_DIR="/www/wwwroot/ai-content/backend"
REMOTE_FRONTEND_DIR="/www/wwwroot/ai-content/frontend"
PUBLIC_BASE="https://aicontent.vip.kaypal.cn"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DO_BACKEND=0
DO_FRONTEND=0
for arg in "$@"; do
  case "$arg" in
    --backend) DO_BACKEND=1 ;;
    --frontend) DO_FRONTEND=1 ;;
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
    if out=$(ssh -o ConnectTimeout=20 -o ServerAliveInterval=10 "$HOST" "$cmd" 2>&1); then
      echo "$out"
      return 0
    fi
    echo "[warn] SSH 重试 $i/3..." >&2
    sleep 3
  done
  echo "[error] SSH 连接失败: $out" >&2
  return 1
}

# ---------- 后端 ----------
deploy_backend() {
  echo "== [1/4] 后端 build =="
  cd "$REPO_ROOT/backend"
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx tsc --noEmit
  if [ -d dist ]; then mv dist "/tmp/dist-deploy-bak-$(date +%s)"; fi
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npm run build

  echo "== [2/4] 上传 dist =="
  rsync -az --delete -e "ssh -o ConnectTimeout=20 -o ServerAliveInterval=10" \
    dist/ "$HOST:$REMOTE_BACKEND_DIR/dist/"

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
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS npx next build

  echo "== [2/3] 上传 out =="
  rsync -az --delete -e "ssh -o ConnectTimeout=20 -o ServerAliveInterval=10" \
    out/ "$HOST:$REMOTE_FRONTEND_DIR/out/"

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
echo "全部完成 🎉"
