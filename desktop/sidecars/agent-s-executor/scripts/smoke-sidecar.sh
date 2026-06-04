#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR_URL="${SIDECAR_URL:-}"
PYCACHE_PREFIX="${PYCACHE_PREFIX:-$ROOT_DIR/.tmp/pycache}"

pass() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

check_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    pass "found file: ${path#$ROOT_DIR/}"
  else
    fail "missing file: ${path#$ROOT_DIR/}"
  fi
}

check_executable() {
  local path="$1"
  if [[ -x "$path" ]]; then
    pass "executable: ${path#$ROOT_DIR/}"
  else
    fail "not executable: ${path#$ROOT_DIR/}"
  fi
}

probe_url() {
  local base_url="$1"
  local endpoint

  for endpoint in /healthz /readyz /health /ready; do
    local url="${base_url%/}${endpoint}"
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
      pass "live probe ok: $url -> $code"
      return 0
    fi
  done

  return 1
}

printf 'Running sidecar smoke from %s\n' "$ROOT_DIR"

check_file "$ROOT_DIR/README.md"
check_file "$ROOT_DIR/docs/verification.md"
check_file "$ROOT_DIR/scripts/smoke-sidecar.sh"
check_file "$ROOT_DIR/scripts/smoke-real-runner.sh"
check_file "$ROOT_DIR/scripts/mock_external_agent.py"
check_file "$ROOT_DIR/scripts/selfcheck_sidecar.py"
check_executable "$ROOT_DIR/scripts/smoke-sidecar.sh"
check_executable "$ROOT_DIR/scripts/smoke-real-runner.sh"

if command -v python3 >/dev/null 2>&1; then
  mkdir -p "$PYCACHE_PREFIX"
  env PYTHONPYCACHEPREFIX="$PYCACHE_PREFIX" \
    python3 -m py_compile "$ROOT_DIR/scripts/selfcheck_sidecar.py"
  env PYTHONPYCACHEPREFIX="$PYCACHE_PREFIX" \
    python3 -m py_compile "$ROOT_DIR/scripts/mock_external_agent.py"
  pass "python syntax check"
else
  printf '[WARN] python3 not found, skipping python syntax check\n'
fi

if [[ -n "$SIDECAR_URL" ]]; then
  if command -v curl >/dev/null 2>&1; then
    probe_url "$SIDECAR_URL" || fail "no healthy endpoint found under $SIDECAR_URL"
  else
    fail "curl is required for live probe"
  fi
else
  printf '[INFO] SIDECAR_URL not set, skipping live HTTP probe\n'
fi

pass "sidecar smoke completed"
