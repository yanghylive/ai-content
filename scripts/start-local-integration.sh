#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTO_UPLOAD_DIR="${AUTO_UPLOAD_DIR:-/Users/yanghy/auto-upload}"
LOG_DIR="${ROOT_DIR}/.local-logs"
mkdir -p "${LOG_DIR}"
SCREEN_BIN="$(command -v screen || true)"
FRONTEND_GUARD="${LOG_DIR}/frontend-guard.sh"

require_path() {
  local path="$1"
  local label="$2"
  if [[ ! -e "${path}" ]]; then
    echo "${label} not found: ${path}" >&2
    exit 1
  fi
}

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
require_path "${AUTO_UPLOAD_DIR}" "Auto Upload directory"
require_path "${AUTO_UPLOAD_DIR}/main.py" "Auto Upload main.py"
require_path "${AUTO_UPLOAD_DIR}/.venv/bin/python" "Auto Upload Python"

kill_port 3010
kill_port 3011
kill_port 5409
if [[ -n "${SCREEN_BIN}" ]]; then
  "${SCREEN_BIN}" -S ai-content-auto-upload -X quit >/dev/null 2>&1 || true
  "${SCREEN_BIN}" -S ai-content-backend -X quit >/dev/null 2>&1 || true
  "${SCREEN_BIN}" -S ai-content-frontend -X quit >/dev/null 2>&1 || true
else
  echo "screen is required to keep services alive after this script exits." >&2
  exit 1
fi

rm -f "${LOG_DIR}/auto-upload-5409.log" "${LOG_DIR}/backend-3011.log" "${LOG_DIR}/frontend-3010.log"

"${SCREEN_BIN}" -dmS ai-content-auto-upload bash -lc "cd '${AUTO_UPLOAD_DIR}' && exec '${AUTO_UPLOAD_DIR}/.venv/bin/python' -u main.py > '${LOG_DIR}/auto-upload-5409.log' 2>&1"
echo "screen:ai-content-auto-upload" > "${LOG_DIR}/auto-upload-5409.pid"

"${SCREEN_BIN}" -dmS ai-content-backend bash -lc "cd '${ROOT_DIR}/backend' && npm run build > '${LOG_DIR}/backend-3011.log' 2>&1 && exec env PORT=3011 node --enable-source-maps dist/main.js >> '${LOG_DIR}/backend-3011.log' 2>&1"
echo "screen:ai-content-backend" > "${LOG_DIR}/backend-3011.pid"

cat > "${FRONTEND_GUARD}" <<EOF
#!/usr/bin/env bash
set -u
cd "${ROOT_DIR}/frontend"
while true; do
  echo "[\$(date '+%Y-%m-%d %H:%M:%S')] starting frontend on 3010" >> "${LOG_DIR}/frontend-3010.log"
  NEXT_PUBLIC_API_BASE=http://localhost:3011/api npm run dev -- -p 3010 >> "${LOG_DIR}/frontend-3010.log" 2>&1
  status=\$?
  echo "[\$(date '+%Y-%m-%d %H:%M:%S')] frontend exited with status \${status}; restarting in 2s" >> "${LOG_DIR}/frontend-3010.log"
  sleep 2
done
EOF
chmod +x "${FRONTEND_GUARD}"

"${SCREEN_BIN}" -dmS ai-content-frontend bash -lc "exec '${FRONTEND_GUARD}'"
echo "screen:ai-content-frontend" > "${LOG_DIR}/frontend-3010.pid"

wait_url "http://127.0.0.1:5409/health" "Auto Upload" "${LOG_DIR}/auto-upload-5409.log"
wait_url "http://localhost:3011/api/auth/setup-status" "AI Content backend" "${LOG_DIR}/backend-3011.log"
wait_url "http://localhost:3010/login" "AI Content frontend" "${LOG_DIR}/frontend-3010.log"

cat <<EOF

All services are running.
- Frontend: http://localhost:3010/distribution
- Backend:  http://localhost:3011/api
- Engine:   http://127.0.0.1:5409
- Logs:     ${LOG_DIR}

EOF
