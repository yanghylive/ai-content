#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/yanghy/Documents/New project/kaypal-ai"
PYTHON="$ROOT/services/agent-s-executor/.venv/bin/python"
SCRIPT="$ROOT/services/agent-s-executor/scripts/smoke_agent_s_sdk_sidecar_live.py"

export PYTHONPYCACHEPREFIX="${PYTHONPYCACHEPREFIX:-$ROOT/.tmp/pycache-agent-s-sidecar-live}"
mkdir -p "$PYTHONPYCACHEPREFIX"

"$PYTHON" "$SCRIPT"
