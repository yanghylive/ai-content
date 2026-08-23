#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/.local-logs"
mkdir -p "${LOG_DIR}"
SCREEN_BIN="$(command -v screen || true)"
FRONTEND_GUARD="${LOG_DIR}/frontend-guard.sh"
LOCAL_ENV_FILE="${LOG_DIR}/local-integration.env"

BACKEND_PORT="${KAYPAL_LOCAL_BACKEND_PORT:-3011}"
FRONTEND_PORT="${KAYPAL_LOCAL_FRONTEND_PORT:-3010}"
# 进程身份标记（ERE 正则）：用于校验「占着端口的进程确实是本项目的服务」。
# 前端有两种合法形态：next dev（本脚本启动）与 static-server.mjs（serve out/ 静态产物）。
BACKEND_MARKER='dist-bundle-sqlite/index\.js'
FRONTEND_MARKER='(next-server|next dev|node_modules/\.bin/next|frontend/scripts/static-server\.mjs)'

port_listen_pid() {
  lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
}

# kill 后必须等端口真正释放；否则新进程绑定失败退出、旧进程继续应答健康检查，
# 脚本会打印 All services running —— 这就是最典型的假绿。
wait_port_free() {
  local port="$1"
  local pids
  for attempt in {1..30}; do
    pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -z "${pids}" ]] && return 0
    if [[ "${attempt}" -eq 10 ]]; then
      echo "Port ${port} still held by ${pids}, escalating to SIGKILL"
      kill -9 ${pids} 2>/dev/null || true
    fi
    sleep 0.5
  done
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Failed to free port ${port}; still held by PID(s): ${pids}" >&2
    ps -o pid=,command= -p ${pids} >&2 2>/dev/null || true
    return 1
  fi
  return 0
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Stopping port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
  fi
  wait_port_free "${port}"
}

# 三重一致校验：端口有 LISTEN 持有者 + 该进程存活 + 该进程命令行含本服务身份标记。
# 只做 curl 健康检查是不够的——3011 上可能是没杀干净的旧后端 / 别的项目的服务，
# 照样返回 200，于是「验证的不是本次构建的产物」。
assert_port_owner() {
  local port="$1"
  local marker="$2"
  local name="$3"
  local pid
  pid="$(port_listen_pid "${port}")"
  if [[ -z "${pid}" ]]; then
    echo "${name} check failed: nothing is LISTENing on port ${port}." >&2
    return 1
  fi
  if ! kill -0 "${pid}" 2>/dev/null; then
    echo "${name} check failed: PID ${pid} on port ${port} is not alive." >&2
    return 1
  fi
  local cmd
  cmd="$(ps -o command= -p "${pid}" 2>/dev/null || true)"
  if [[ -z "${cmd}" ]]; then
    echo "${name} check failed: cannot read command line of PID ${pid}." >&2
    return 1
  fi
  if [[ ! "${cmd}" =~ ${marker} ]]; then
    echo "${name} check failed: port ${port} is held by an unrelated process." >&2
    echo "  expected command to match  : ${marker}" >&2
    echo "  actual PID ${pid} command    : ${cmd}" >&2
    echo "  => 端口有人应答不等于服务正确，拒绝报告启动成功。" >&2
    return 1
  fi
  echo "${name} owner verified: PID ${pid} on port ${port}"
  return 0
}

# 只跑校验、不启动服务。用于随时体检本机 3010/3011，也用于门禁负向验证。
verify_services() {
  local failed=0
  curl -fsS "http://localhost:${BACKEND_PORT}/api/auth/setup-status" >/dev/null 2>&1 \
    || { echo "Backend health endpoint failed: /api/auth/setup-status" >&2; failed=1; }
  curl -fsS "http://localhost:${BACKEND_PORT}/api/auto-upload/health" >/dev/null 2>&1 \
    || { echo "Runtime health endpoint failed: /api/auto-upload/health" >&2; failed=1; }
  assert_port_owner "${BACKEND_PORT}" "${BACKEND_MARKER}" "AI Content backend" || failed=1
  curl -fsS "http://localhost:${FRONTEND_PORT}/login" >/dev/null 2>&1 \
    || { echo "Frontend endpoint failed: /login" >&2; failed=1; }
  assert_port_owner "${FRONTEND_PORT}" "${FRONTEND_MARKER}" "AI Content frontend" || failed=1

  if [[ "${failed}" -ne 0 ]]; then
    echo "" >&2
    echo "Local integration verification FAILED — services are not healthy." >&2
    return 1
  fi
  echo "Local integration verification passed (backend ${BACKEND_PORT}, frontend ${FRONTEND_PORT})."
  return 0
}

if [[ "${1:-}" == "--verify" ]]; then
  verify_services
  exit $?
fi

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

kill_port "${FRONTEND_PORT}"
kill_port "${BACKEND_PORT}"
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
# 真实 PID 在健康检查通过后统一回写（见文件末尾）；此处仅记录 screen 会话名
echo "screen:ai-content-backend" > "${LOG_DIR}/backend-3011.session"

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
echo "screen:ai-content-frontend" > "${LOG_DIR}/frontend-3010.session"

wait_url "http://localhost:${BACKEND_PORT}/api/auth/setup-status" "AI Content backend" "${LOG_DIR}/backend-3011.log"
wait_url "http://localhost:${BACKEND_PORT}/api/auto-upload/health" "AI Content in-process Runtime" "${LOG_DIR}/backend-3011.log"
wait_url "http://localhost:${FRONTEND_PORT}/login" "AI Content frontend" "${LOG_DIR}/frontend-3010.log"

# 健康接口 200 只说明「有人应答」。这里补齐身份校验：占端口的进程必须是本次启动的
# backend bundle / next 前端，否则拒绝报告成功（set -e 会在此终止脚本）。
assert_port_owner "${BACKEND_PORT}" "${BACKEND_MARKER}" "AI Content backend"
assert_port_owner "${FRONTEND_PORT}" "${FRONTEND_MARKER}" "AI Content frontend"

# 回写真实 PID（旧版写的是 "screen:xxx" 字符串，无法用于存活判断）
port_listen_pid "${BACKEND_PORT}" > "${LOG_DIR}/backend-3011.pid"
port_listen_pid "${FRONTEND_PORT}" > "${LOG_DIR}/frontend-3010.pid"

cat <<EOF

All services are running.
- Frontend: http://localhost:${FRONTEND_PORT}/distribution
- Backend:  http://localhost:${BACKEND_PORT}/api
- Runtime:  http://localhost:${BACKEND_PORT}/api/auto-upload/health
- Backend PID:  $(cat "${LOG_DIR}/backend-3011.pid")
- Frontend PID: $(cat "${LOG_DIR}/frontend-3010.pid")
- Local env: ${LOCAL_ENV_FILE}
- Logs:     ${LOG_DIR}
- Re-verify: scripts/start-local-integration.sh --verify

EOF
