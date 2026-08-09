#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$ROOT_DIR/data-smoke-real"
SIDE_TOKEN="${KAYPAL_AGENT_S_TOKEN:-change-me-local-token}"
SIDECAR_PORT="${KAYPAL_AGENT_S_PORT:-17779}"
EXTERNAL_PORT="${MOCK_EXTERNAL_AGENT_PORT:-18888}"
SIDECAR_URL="http://127.0.0.1:${SIDECAR_PORT}"
EXTERNAL_URL="http://127.0.0.1:${EXTERNAL_PORT}"
SIDECAR_PYTHON="${SIDECAR_PYTHON:-$ROOT_DIR/.venv/bin/python}"

cleanup() {
  if [[ -n "${SIDECAR_PID:-}" ]]; then
    kill "${SIDECAR_PID}" >/dev/null 2>&1 || true
    wait "${SIDECAR_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${EXTERNAL_PID:-}" ]]; then
    kill "${EXTERNAL_PID}" >/dev/null 2>&1 || true
    wait "${EXTERNAL_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

pass() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "missing required command: $cmd"
}

wait_for_http() {
  local url="$1"
  local header_name="${2:-}"
  local header_value="${3:-}"
  local attempts=40
  local code

  while (( attempts > 0 )); do
    if [[ -n "$header_name" ]]; then
      code="$(curl -sS -o /dev/null -w '%{http_code}' -H "$header_name: $header_value" "$url" || true)"
    else
      code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
    fi
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 0.25
  done

  return 1
}

extract_json_field() {
  local file="$1"
  local expr="$2"
  python3 - "$file" "$expr" <<'PY'
import json
import sys

path = sys.argv[1]
expr = sys.argv[2]
with open(path, "r", encoding="utf-8") as handle:
    data = json.load(handle)

parts = [part for part in expr.split(".") if part]
value = data
for part in parts:
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break

if isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=True))
elif value is None:
    print("")
else:
    print(value)
PY
}

require_cmd curl
require_cmd python3
[[ -x "$SIDECAR_PYTHON" ]] || fail "sidecar python not found: $SIDECAR_PYTHON"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

printf 'Starting mock external agent on %s\n' "$EXTERNAL_URL"
(
  cd "$ROOT_DIR"
  MOCK_EXTERNAL_AGENT_PORT="$EXTERNAL_PORT" \
    python3 scripts/mock_external_agent.py
) >"$WORK_DIR/mock-external-agent.log" 2>&1 &
EXTERNAL_PID=$!

wait_for_http "${EXTERNAL_URL}/healthz" || fail "mock external agent did not become healthy"
pass "mock external agent healthy"

printf 'Starting sidecar real runner on %s\n' "$SIDECAR_URL"
(
  cd "$ROOT_DIR"
  KAYPAL_AGENT_S_RUNNER_MODE=real \
  KAYPAL_AGENT_S_PORT="$SIDECAR_PORT" \
  KAYPAL_AGENT_S_ARTIFACT_ROOT="$WORK_DIR/artifacts" \
  KAYPAL_AGENT_S_EXTERNAL_AGENT_BASE_URL="$EXTERNAL_URL" \
    "$SIDECAR_PYTHON" main.py
) >"$WORK_DIR/sidecar.log" 2>&1 &
SIDECAR_PID=$!

wait_for_http "${SIDECAR_URL}/healthz" "x-kaypal-agent-s-token" "$SIDE_TOKEN" || fail "sidecar did not become healthy"
pass "sidecar healthy in real mode"

curl -sS \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  "${SIDECAR_URL}/healthz" >"$WORK_DIR/healthz.json"

runner_mode="$(extract_json_field "$WORK_DIR/healthz.json" "runner_mode")"
[[ "$runner_mode" == "real" ]] || fail "expected runner_mode=real, got ${runner_mode:-<empty>}"
pass "healthz reports real mode"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"session_name":"real-mode-smoke","task_type":"desktop.gui.visual.real"}' \
  "${SIDECAR_URL}/sessions" >"$WORK_DIR/session.json"

session_id="$(extract_json_field "$WORK_DIR/session.json" "session.session_id")"
[[ -n "$session_id" ]] || fail "session id missing"
pass "created session ${session_id}"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"instruction":"Open WeChat and draft a safe reply without sending","risk_level":"medium","requires_approval":false,"metadata":{"window_title":"WeChat","decision":"draft_reply"}}' \
  "${SIDECAR_URL}/sessions/${session_id}/run" >"$WORK_DIR/run.json"

run_id="$(extract_json_field "$WORK_DIR/run.json" "run_id")"
[[ -n "$run_id" ]] || fail "run id missing"
pass "accepted run ${run_id}"

for _ in $(seq 1 40); do
  curl -sS \
    -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
    "${SIDECAR_URL}/sessions/${session_id}" >"$WORK_DIR/session-state.json"
  status_value="$(extract_json_field "$WORK_DIR/session-state.json" "status")"
  if [[ "$status_value" == "completed" || "$status_value" == "failed" || "$status_value" == "waiting_approval" || "$status_value" == "cancelled" ]]; then
    break
  fi
  sleep 0.25
done

[[ "${status_value:-}" == "completed" ]] || fail "expected completed session, got ${status_value:-<empty>}"
pass "session completed"

curl -sS \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  "${SIDECAR_URL}/sessions/${session_id}/events?after_seq=0" >"$WORK_DIR/events.json"

curl -sS \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  "${SIDECAR_URL}/sessions/${session_id}/artifacts" >"$WORK_DIR/artifacts.json"

python3 - "$WORK_DIR/events.json" "$WORK_DIR/artifacts.json" <<'PY'
import json
import sys

events_path, artifacts_path = sys.argv[1:3]
with open(events_path, "r", encoding="utf-8") as handle:
    events = json.load(handle)["events"]
with open(artifacts_path, "r", encoding="utf-8") as handle:
    artifacts = json.load(handle)["artifacts"]

event_types = {event["event_type"] for event in events}
artifact_names = {artifact["filename"] for artifact in artifacts}

required_events = {"session_started", "step_started", "step_completed", "artifact_captured", "run_completed"}
missing_events = sorted(required_events - event_types)
if missing_events:
    raise SystemExit(f"missing expected events: {missing_events}")

required_files = {"external-agent-response.json", "external-agent-summary.txt", "external-agent-plan.json", "external-agent-final-screen.png"}
missing_files = sorted(required_files - artifact_names)
if missing_files:
    raise SystemExit(f"missing expected artifacts: {missing_files}")

print("validation-ok")
PY
pass "events and artifacts validated"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"session_name":"real-mode-approval-smoke","task_type":"desktop.gui.visual.real"}' \
  "${SIDECAR_URL}/sessions" >"$WORK_DIR/session-approval.json"

approval_session_id="$(extract_json_field "$WORK_DIR/session-approval.json" "session.session_id")"
[[ -n "$approval_session_id" ]] || fail "approval session id missing"
pass "created approval session ${approval_session_id}"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"instruction":"Pause after planning and wait for human approval","risk_level":"medium","requires_approval":true,"metadata":{"window_title":"WeChat","decision":"draft_reply"}}' \
  "${SIDECAR_URL}/sessions/${approval_session_id}/run" >"$WORK_DIR/run-approval.json"

approval_run_id="$(extract_json_field "$WORK_DIR/run-approval.json" "run_id")"
[[ -n "$approval_run_id" ]] || fail "approval run id missing"
pass "accepted approval run ${approval_run_id}"

for _ in $(seq 1 40); do
  curl -sS \
    -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
    "${SIDECAR_URL}/sessions/${approval_session_id}" >"$WORK_DIR/session-approval-state.json"
  approval_status_value="$(extract_json_field "$WORK_DIR/session-approval-state.json" "status")"
  if [[ "$approval_status_value" == "waiting_approval" || "$approval_status_value" == "failed" || "$approval_status_value" == "completed" ]]; then
    break
  fi
  sleep 0.25
done

[[ "${approval_status_value:-}" == "waiting_approval" ]] || fail "expected waiting_approval session, got ${approval_status_value:-<empty>}"
pass "session reached waiting_approval"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"decision":"approved","comment":"Approved from smoke-real-runner"}' \
  "${SIDECAR_URL}/sessions/${approval_session_id}/approval" >"$WORK_DIR/approval-decision.json"

approval_decision_status="$(extract_json_field "$WORK_DIR/approval-decision.json" "status")"
[[ "$approval_decision_status" == "completed" ]] || fail "expected approval resolution to complete session, got ${approval_decision_status:-<empty>}"
pass "approval decision completed session"

curl -sS \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  "${SIDECAR_URL}/sessions/${approval_session_id}/events?after_seq=0" >"$WORK_DIR/events-approval.json"

curl -sS \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  "${SIDECAR_URL}/sessions/${approval_session_id}/artifacts" >"$WORK_DIR/artifacts-approval.json"

python3 - "$WORK_DIR/events-approval.json" "$WORK_DIR/artifacts-approval.json" <<'PY'
import json
import sys

events_path, artifacts_path = sys.argv[1:3]
with open(events_path, "r", encoding="utf-8") as handle:
    events = json.load(handle)["events"]
with open(artifacts_path, "r", encoding="utf-8") as handle:
    artifacts = json.load(handle)["artifacts"]

event_types = {event["event_type"] for event in events}
artifact_names = {artifact["filename"] for artifact in artifacts}

required_events = {"approval_required", "approval_granted", "run_completed"}
missing_events = sorted(required_events - event_types)
if missing_events:
    raise SystemExit(f"missing approval events: {missing_events}")

required_files = {"external-agent-approval-response.json", "external-agent-post-approval.txt"}
missing_files = sorted(required_files - artifact_names)
if missing_files:
    raise SystemExit(f"missing approval artifacts: {missing_files}")

print("approval-validation-ok")
PY
pass "approval resume events and artifacts validated"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"session_name":"real-mode-reject-smoke","task_type":"desktop.gui.visual.real"}' \
  "${SIDECAR_URL}/sessions" >"$WORK_DIR/session-reject.json"

reject_session_id="$(extract_json_field "$WORK_DIR/session-reject.json" "session.session_id")"
[[ -n "$reject_session_id" ]] || fail "reject session id missing"
pass "created reject session ${reject_session_id}"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"instruction":"Pause and then reject this desktop action","risk_level":"high","requires_approval":true,"metadata":{"window_title":"WeChat","decision":"do_not_send"}}' \
  "${SIDECAR_URL}/sessions/${reject_session_id}/run" >"$WORK_DIR/run-reject.json"

reject_run_id="$(extract_json_field "$WORK_DIR/run-reject.json" "run_id")"
[[ -n "$reject_run_id" ]] || fail "reject run id missing"
pass "accepted reject run ${reject_run_id}"

for _ in $(seq 1 40); do
  curl -sS \
    -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
    "${SIDECAR_URL}/sessions/${reject_session_id}" >"$WORK_DIR/session-reject-state.json"
  reject_status_value="$(extract_json_field "$WORK_DIR/session-reject-state.json" "status")"
  if [[ "$reject_status_value" == "waiting_approval" || "$reject_status_value" == "failed" || "$reject_status_value" == "completed" ]]; then
    break
  fi
  sleep 0.25
done

[[ "${reject_status_value:-}" == "waiting_approval" ]] || fail "expected reject session to wait for approval, got ${reject_status_value:-<empty>}"
pass "reject session reached waiting_approval"

curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  -d '{"decision":"rejected","comment":"Rejected from smoke-real-runner"}' \
  "${SIDECAR_URL}/sessions/${reject_session_id}/approval" >"$WORK_DIR/reject-decision.json"

reject_decision_status="$(extract_json_field "$WORK_DIR/reject-decision.json" "status")"
[[ "$reject_decision_status" == "failed" ]] || fail "expected rejected session to fail, got ${reject_decision_status:-<empty>}"
pass "reject decision failed session"

curl -sS \
  -H "x-kaypal-agent-s-token: ${SIDE_TOKEN}" \
  "${SIDECAR_URL}/sessions/${reject_session_id}/events?after_seq=0" >"$WORK_DIR/events-reject.json"

python3 - "$WORK_DIR/events-reject.json" <<'PY'
import json
import sys

events_path = sys.argv[1]
with open(events_path, "r", encoding="utf-8") as handle:
    events = json.load(handle)["events"]

event_types = {event["event_type"] for event in events}
required_events = {"approval_required", "approval_rejected", "run_failed"}
missing_events = sorted(required_events - event_types)
if missing_events:
    raise SystemExit(f"missing rejection events: {missing_events}")

print("reject-validation-ok")
PY
pass "approval rejection events validated"

printf '[PASS] real runner smoke completed\n'
