#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"
"${ROOT_DIR}/.venv/bin/python" "${ROOT_DIR}/scripts/smoke_agent_s_sdk_sidecar_local_live.py"
