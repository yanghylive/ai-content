#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR_PYTHON="${SIDECAR_PYTHON:-$ROOT_DIR/.venv/bin/python}"
PYCACHE_PREFIX="${PYCACHE_PREFIX:-$ROOT_DIR/.tmp/pycache-sdk-smoke}"

pass() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

[[ -x "$SIDECAR_PYTHON" ]] || fail "sidecar python not found: $SIDECAR_PYTHON"
mkdir -p "$PYCACHE_PREFIX"

(
  cd "$ROOT_DIR"
  env PYTHONPYCACHEPREFIX="$PYCACHE_PREFIX" "$SIDECAR_PYTHON" scripts/smoke_agent_s_sdk_inline.py
)

pass "agent_s_sdk inline smoke completed"
