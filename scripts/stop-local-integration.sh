#!/usr/bin/env bash
set -euo pipefail

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Stopping port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
  fi
}

if command -v screen >/dev/null 2>&1; then
  screen -S ai-content-backend -X quit >/dev/null 2>&1 || true
  screen -S ai-content-frontend -X quit >/dev/null 2>&1 || true
fi

kill_port 3010
kill_port 3011

echo "Local integration services stopped."
