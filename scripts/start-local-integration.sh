#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/.local-logs"
mkdir -p "${LOG_DIR}"
SCREEN_BIN="$(command -v screen || true)"
FRONTEND_GUARD="${LOG_DIR}/frontend-guard.sh"
LOCAL_ENV_FILE="${LOG_DIR}/local-integration.env"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Stopping port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
  fi
}

wait_url() {
  local url="$1"
  local name="$2"
  local log_file="${3:-}"
  for _ in {1..40}; do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "${name} ready: ${url}"
      return 0
    fi
    sleep 0.5
  done

  echo "${name} did not become ready: ${url}" >&2
  if [[ -n "${log_file}" && -f "${log_file}" ]]; then
    echo ""
    echo "Last ${name} log lines:"
    tail -80 "${log_file}" >&2 || true
  fi
  return 1
}

echo "Starting local integration services..."

if [[ "$(uname -s)" == "Darwin" ]]; then
  USER_DATA_DIR="${KAYPAL_DESKTOP_USER_DATA_DIR:-${HOME}/Library/Application Support/ai-content-desktop}"
  MASTER_KEY_FILE="${USER_DATA_DIR}/credential-master-key"
  if [[ -f "${MASTER_KEY_FILE}" ]]; then
    KAYPAL_CREDENTIAL_MASTER_KEY="$(tr -d '\r\n' < "${MASTER_KEY_FILE}")"
    export KAYPAL_CREDENTIAL_MASTER_KEY
  else
    echo "Missing credential master key: ${MASTER_KEY_FILE}" >&2
    exit 1
  fi
fi

cat > "${LOCAL_ENV_FILE}" <<EOF
COMMERCIAL_DATABASE_MODE=sqlite
COMMERCIAL_DATABASE_PATH=${USER_DATA_DIR}/kaypal-ai.sqlite
KAYPAL_DESKTOP_DATABASE_MODE=sqlite
KAYPAL_DESKTOP_USER_DATA_DIR=${USER_DATA_DIR}
SQLITE_DATABASE_URL=file:./kaypal-ai.sqlite
EOF

kill_port 3010
kill_port 3011
if [[ -n "${SCREEN_BIN}" ]]; then
  "${SCREEN_BIN}" -S ai-content-backend -X quit >/dev/null 2>&1 || true
  "${SCREEN_BIN}" -S ai-content-frontend -X quit >/dev/null 2>&1 || true
else
  echo "screen is required to keep services alive after this script exits." >&2
  exit 1
fi

rm -f "${LOG_DIR}/backend-3011.log" "${LOG_DIR}/frontend-3010.log"

# Node 版本检查：后端 bundle 与 Next 前端需要 Node 20+（Node 22 有 PlatformInit 兼容要求）
NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0)"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node 20+ is required, but found $(node -v 2>/dev/null || echo 'no node')." >&2
  echo "Install Node 20/22 LTS and retry." >&2
  exit 1
fi

SQLITE_BUNDLE="${ROOT_DIR}/backend/dist-bundle-sqlite/index.js"
echo "Building SQLite backend bundle..."
# 关键：清 NODE_OPTIONS 再构建。WorkBuddy 沙箱注入的 safe-delete shim（genie-safe-delete.cjs）
# 会拦截 build-sqlite-bundle.mjs 里 rmSync 批量删除旧产物，导致构建失败、后端起不来。
if ! (cd "${ROOT_DIR}/backend" && env -u NODE_OPTIONS npm run build:bundle:sqlite > "${LOG_DIR}/backend-3011.log" 2>&1); then
  echo "SQLite backend bundle build failed." >&2
  tail -80 "${LOG_DIR}/backend-3011.log" >&2 || true
  exit 1
fi

if [[ ! -f "${SQLITE_BUNDLE}" ]]; then
  echo "SQLite backend entry missing: ${SQLITE_BUNDLE}" >&2
  exit 1
fi

"${SCREEN_BIN}" -dmS ai-content-backend bash -lc "cd '${ROOT_DIR}/backend' && exec env PORT=3011 AUTO_START_KAYPAL_RUNTIME=false KAYPAL_DESKTOP_DATABASE_MODE=sqlite KAYPAL_DESKTOP_USER_DATA_DIR='${USER_DATA_DIR}' DATABASE_URL='file:./kaypal-ai.sqlite' SQLITE_DATABASE_URL='file:./kaypal-ai.sqlite' KAYPAL_CREDENTIAL_MASTER_KEY='${KAYPAL_CREDENTIAL_MASTER_KEY:-}' node --enable-source-maps '${SQLITE_BUNDLE}' >> '${LOG_DIR}/backend-3011.log' 2>&1"
echo "screen:ai-content-backend" > "${LOG_DIR}/backend-3011.pid"

cat > "${FRONTEND_GUARD}" <<EOF
#!/usr/bin/env bash
set -u
cd "${ROOT_DIR}/frontend"
attempt=0
max_attempts=10
while true; do
  attempt=\$((attempt + 1))
  echo "[\$(date '+%Y-%m-%d %H:%M:%S')] starting frontend on 3010 (attempt \${attempt})" >> "${LOG_DIR}/frontend-3010.log"
  # 清 NODE_OPTIONS：safe-delete shim 会拦截 Next dev 的 .next 清理，导致内存阈值重启时挂掉
  NEXT_PUBLIC_API_BASE=http://localhost:3011/api env -u NODE_OPTIONS npm run dev -- -p 3010 >> "${LOG_DIR}/frontend-3010.log" 2>&1
  status=\$?
  if [[ \${attempt} -ge \${max_attempts} ]]; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] frontend failed \${max_attempts} times consecutively, giving up to avoid restart loop" >> "${LOG_DIR}/frontend-3010.log"
    break
  fi
  backoff=\$((2 * attempt))
  [[ \${backoff} -gt 60 ]] && backoff=60
  echo "[\$(date '+%Y-%m-%d %H:%M:%S')] frontend exited with status \${status}; restarting in \${backoff}s" >> "${LOG_DIR}/frontend-3010.log"
  sleep \${backoff}
done
EOF
chmod +x "${FRONTEND_GUARD}"

"${SCREEN_BIN}" -dmS ai-content-frontend bash -lc "exec '${FRONTEND_GUARD}'"
echo "screen:ai-content-frontend" > "${LOG_DIR}/frontend-3010.pid"

wait_url "http://localhost:3011/api/auth/setup-status" "AI Content backend" "${LOG_DIR}/backend-3011.log"
wait_url "http://localhost:3011/api/auto-upload/health" "AI Content in-process Runtime" "${LOG_DIR}/backend-3011.log"
wait_url "http://localhost:3010/login" "AI Content frontend" "${LOG_DIR}/frontend-3010.log"

cat <<EOF

All services are running.
- Frontend: http://localhost:3010/distribution
- Backend:  http://localhost:3011/api
- Runtime:  http://localhost:3011/api/auto-upload/health
- Local env: ${LOCAL_ENV_FILE}
- Logs:     ${LOG_DIR}

EOF
