#!/usr/bin/env bash
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3010}"
API_BASE="${API_BASE:-http://localhost:3011/api}"
SMOKE_CREATE_TASK="${SMOKE_CREATE_TASK:-0}"
SMOKE_BATCH_TASK="${SMOKE_BATCH_TASK:-0}"
SMOKE_RETRY_TASK="${SMOKE_RETRY_TASK:-0}"
SMOKE_DIAGNOSTICS="${SMOKE_DIAGNOSTICS:-1}"
SMOKE_APPROVAL_RECORD="${SMOKE_APPROVAL_RECORD:-1}"
SMOKE_WECHAT_GUARD="${SMOKE_WECHAT_GUARD:-0}"
SMOKE_RECOVERY="${SMOKE_RECOVERY:-1}"
SMOKE_AGENT_SESSION="${SMOKE_AGENT_SESSION:-1}"
SMOKE_AGENT_CONFIRMATION="${SMOKE_AGENT_CONFIRMATION:-0}"
SMOKE_PUBLISH_CONFIRMATION="${SMOKE_PUBLISH_CONFIRMATION:-1}"
SMOKE_APPROVE_PUBLISH_CONFIRMATION="${SMOKE_APPROVE_PUBLISH_CONFIRMATION:-0}"
SMOKE_AGENT_EVIDENCE_EXPORT="${SMOKE_AGENT_EVIDENCE_EXPORT:-1}"
SMOKE_UI_ROUTES="${SMOKE_UI_ROUTES:-0}"
SMOKE_SEND_MODE="${SMOKE_SEND_MODE:-draft-only}"
SMOKE_USERNAME="${SMOKE_USERNAME:-}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"

COOKIE_JAR="$(mktemp -t ai-content-smoke-cookies.XXXXXX)"
trap 'rm -f "${COOKIE_JAR}"' EXIT

pass_count=0
warn_count=0
fail_count=0
diagnostic_task_id=""
recovery_task_id=""
agent_session_id=""
agent_confirmation_id=""
publish_session_id=""
publish_confirmation_id=""

log() {
  printf '%s\n' "$*"
}

pass() {
  pass_count=$((pass_count + 1))
  printf 'PASS %s\n' "$*"
}

warn() {
  warn_count=$((warn_count + 1))
  printf 'WARN %s\n' "$*"
}

fail() {
  fail_count=$((fail_count + 1))
  printf 'FAIL %s\n' "$*" >&2
}

curl_status() {
  local url="$1"
  curl -k -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true
}

curl_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"

  if [[ -n "${body}" ]]; then
    curl -k -sS -X "${method}" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json' \
      -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" \
      --data "${body}" \
      "${url}" 2>/dev/null
  else
    curl -k -sS -X "${method}" \
      -H 'Accept: application/json' \
      -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" \
      "${url}" 2>/dev/null
  fi
}

expect_http() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local status
  status="$(curl_status "${url}")"
  if [[ " ${expected} " == *" ${status} "* ]]; then
    pass "${label}: HTTP ${status} (${url})"
  else
    fail "${label}: expected HTTP ${expected}, got ${status:-000} (${url})"
  fi
}

json_get() {
  local expr="$1"
  node -e "
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const value = (${expr})(data);
    if (value === undefined || value === null) return;
    if (typeof value === 'object') console.log(JSON.stringify(value));
    else console.log(String(value));
  } catch (error) {
    process.exit(2);
  }
});
"
}

json_data_get() {
  local expr="$1"
  node -e "
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const envelope = JSON.parse(input || '{}');
    const data = Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : envelope;
    const value = (${expr})(data);
    if (value === undefined || value === null) return;
    if (typeof value === 'object') console.log(JSON.stringify(value));
    else console.log(String(value));
  } catch (error) {
    process.exit(2);
  }
});
"
}

section() {
  printf '\n== %s ==\n' "$1"
}

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for JSON assertions"
  exit 1
fi

section "Service endpoints"
expect_http "Login page before auth" "${FRONTEND_URL}/login" "200"
expect_http "Dashboard route before auth" "${FRONTEND_URL}/distribution" "200 307 308"
expect_http "Backend setup status" "${API_BASE}/auth/setup-status" "200"
expect_http "Backend guarded me before auth" "${API_BASE}/auth/me" "401 403"
expect_http "In-process runtime health" "${API_BASE}/auto-upload/health" "200"

section "Local engine API status"
health_json="$(curl_json GET "${API_BASE}/local-engine/health" || true)"
if [[ -n "${health_json}" ]]; then
  online="$(printf '%s' "${health_json}" | json_data_get 'data => data.online' || true)"
  mode="$(printf '%s' "${health_json}" | json_data_get 'data => data.mode' || true)"
  queue="$(printf '%s' "${health_json}" | json_data_get 'data => data.queue' || true)"
  pass "local-engine health reachable: online=${online:-unknown}, mode=${mode:-unknown}, queue=${queue:-unknown}"
else
  fail "local-engine health endpoint did not return JSON"
fi

runtime_json="$(curl_json GET "${API_BASE}/local-engine/runtime/status" || true)"
if [[ -n "${runtime_json}" ]]; then
  all_online="$(printf '%s' "${runtime_json}" | json_data_get 'data => data.allOnline' || true)"
  services="$(printf '%s' "${runtime_json}" | json_data_get 'data => (data.services || []).map(service => `${service.key}:${service.online ? "online" : "offline"}`).join(", ")' || true)"
  pass "runtime status reachable: allOnline=${all_online:-unknown}; ${services:-no services reported}"
else
  fail "runtime status endpoint did not return JSON"
fi

readiness_json="$(curl_json GET "${API_BASE}/local-engine/readiness" || true)"
if [[ -n "${readiness_json}" ]]; then
  ready="$(printf '%s' "${readiness_json}" | json_data_get 'data => data.ready' || true)"
  summary="$(printf '%s' "${readiness_json}" | json_data_get 'data => data.summary' || true)"
  pass "readiness reachable: ready=${ready:-unknown}, summary=${summary:-unknown}"
else
  warn "readiness endpoint did not return JSON; check backend auth/session behavior"
fi

browser_json="$(curl_json GET "${API_BASE}/local-engine/browser/status" || true)"
if [[ -n "${browser_json}" ]]; then
  browser_ready="$(printf '%s' "${browser_json}" | json_data_get 'data => data.ready' || true)"
  browser_summary="$(printf '%s' "${browser_json}" | json_data_get 'data => data.summary' || true)"
  pass "browser control status reachable: ready=${browser_ready:-unknown}, summary=${browser_summary:-unknown}"
else
  fail "browser control status endpoint did not return JSON"
fi

executors_json="$(curl_json GET "${API_BASE}/local-engine/executors/status" || true)"
if [[ -n "${executors_json}" ]]; then
  executor_count="$(printf '%s' "${executors_json}" | json_data_get 'data => Array.isArray(data.executors) ? data.executors.length : 0' || true)"
  pass "executor status reachable: executors=${executor_count:-0}"
else
  fail "executor status endpoint did not return JSON"
fi

files_json="$(curl_json GET "${API_BASE}/local-engine/files/status" || true)"
if [[ -n "${files_json}" ]]; then
  file_ready="$(printf '%s' "${files_json}" | json_data_get 'data => data.ready' || true)"
  file_summary="$(printf '%s' "${files_json}" | json_data_get 'data => data.summary' || true)"
  pass "local file control status reachable: ready=${file_ready:-unknown}, summary=${file_summary:-unknown}"
else
  fail "local file control status endpoint did not return JSON"
fi

section "Authenticated page check"
if [[ -n "${SMOKE_USERNAME}" && -n "${SMOKE_PASSWORD}" ]]; then
  login_body="$(node -e 'console.log(JSON.stringify({ username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD }))')"
  login_json="$(curl_json POST "${API_BASE}/auth/login" "${login_body}" || true)"
  login_user="$(printf '%s' "${login_json}" | json_data_get 'data => data.user && (data.user.username || data.user.name || data.user.id)' || true)"
  if [[ -n "${login_user}" ]]; then
    pass "API login succeeded for ${login_user}"
    me_json="$(curl_json GET "${API_BASE}/auth/me" || true)"
    me_user="$(printf '%s' "${me_json}" | json_data_get 'data => data && (data.username || data.name || data.id)' || true)"
    if [[ -n "${me_user}" ]]; then
      pass "Guarded /auth/me works after login: ${me_user}"
    else
      fail "Guarded /auth/me did not return a user after login"
    fi
    expect_http "Distribution page after auth cookie" "${FRONTEND_URL}/distribution" "200"
    expect_http "Local engine page after auth cookie" "${FRONTEND_URL}/local-engine" "200"
  else
    fail "API login failed; verify SMOKE_USERNAME/SMOKE_PASSWORD"
  fi
else
  warn "Skipping logged-in checks. Set SMOKE_USERNAME and SMOKE_PASSWORD to verify post-login API/session flow."
fi

section "Interaction task creation"
if [[ "${SMOKE_SEND_MODE}" == "auto-send" && "${SMOKE_ALLOW_RISKY_SEND_MODE:-0}" != "1" ]]; then
  fail "Refusing SMOKE_SEND_MODE=auto-send without SMOKE_ALLOW_RISKY_SEND_MODE=1"
elif [[ "${SMOKE_CREATE_TASK}" == "1" ]]; then
  task_body="$(node - <<'NODE'
const payload = {
  type: 'douyin-comment-reply',
  accountName: 'smoke-local-integration',
  targetName: 'smoke-target',
  sourceText: '本地集成冒烟测试：请确认只生成草稿，不触发真实发送。',
  replyText: '收到，我们先记录需求，稍后人工确认。',
  sendMode: process.env.SMOKE_SEND_MODE || 'draft-only',
};
console.log(JSON.stringify(payload));
NODE
)"
  task_json="$(curl_json POST "${API_BASE}/local-engine/tasks" "${task_body}" || true)"
  task_id="$(printf '%s' "${task_json}" | json_data_get 'data => data.id' || true)"
  task_mode="$(printf '%s' "${task_json}" | json_data_get 'data => data.sendMode' || true)"
  task_exec="$(printf '%s' "${task_json}" | json_data_get 'data => data.executionMode' || true)"
    if [[ -n "${task_id}" && "${task_mode}" == "${SMOKE_SEND_MODE}" ]]; then
      pass "created interaction task ${task_id}: sendMode=${task_mode}, executionMode=${task_exec:-unknown}"
      diagnostic_task_id="${task_id}"
      recovery_task_id="${task_id}"
      sleep 2
    latest_task_json="$(curl_json GET "${API_BASE}/local-engine/tasks/${task_id}" || true)"
    latest_status="$(printf '%s' "${latest_task_json}" | json_data_get 'data => data.status' || true)"
    evidence_values="$(printf '%s' "${latest_task_json}" | json_data_get 'data => (data.events || []).filter(event => event.evidence).map(event => `${event.evidence.type}:${event.evidence.label}:${event.evidence.value}`).join(" | ")' || true)"
    pass "task status after engine tick: ${latest_status:-unknown}"
    if [[ -n "${evidence_values}" ]]; then
      pass "task evidence captured: ${evidence_values}"
    else
      warn "task has no evidence yet; check /local-engine?tab=records in the UI"
    fi
  else
    fail "interaction task was not created; response: ${task_json:-empty}"
  fi
else
  warn "Skipping task creation. Set SMOKE_CREATE_TASK=1 to create a real-preflight draft-only interaction task. Commercial acceptance must treat missing account/executor/permission as BLOCKED, not success."
fi

section "Batch and retry task checks"
if [[ "${SMOKE_BATCH_TASK}" == "1" ]]; then
  batch_body="$(node - <<'NODE'
const payload = {
  accountName: 'smoke-batch-account',
  platformType: 3,
  platformName: '抖音',
  sendMode: 'draft-only',
  batchTargets: [
    { targetName: 'smoke-客户A', sourceText: '今天还能预约吗？' },
    { targetName: 'smoke-客户B', sourceText: '价格大概多少？', replyText: '您好，费用需要结合具体服务内容确认。' },
  ],
};
console.log(JSON.stringify(payload));
NODE
)"
  batch_json="$(curl_json POST "${API_BASE}/local-engine/comments/tasks" "${batch_body}" || true)"
  batch_id="$(printf '%s' "${batch_json}" | json_data_get 'data => data.id' || true)"
  if [[ -n "${batch_id}" ]]; then
    diagnostic_task_id="${batch_id}"
    sleep 2
    batch_latest_json="$(curl_json GET "${API_BASE}/local-engine/tasks/${batch_id}" || true)"
    batch_status="$(printf '%s' "${batch_latest_json}" | json_data_get 'data => data.status' || true)"
    batch_summary="$(printf '%s' "${batch_latest_json}" | json_data_get 'data => data.batchSummary' || true)"
    completed_count="$(printf '%s' "${batch_latest_json}" | json_data_get 'data => data.batchSummary && data.batchSummary.completed' || true)"
    if [[ "${batch_status}" == "completed" && "${completed_count}" == "2" ]]; then
      pass "batch task completed: id=${batch_id}, summary=${batch_summary}"
    else
      fail "batch task did not complete as expected: status=${batch_status:-unknown}, summary=${batch_summary:-unknown}"
    fi
  else
    fail "batch task was not created; response: ${batch_json:-empty}"
  fi
else
  warn "Skipping batch task check. Set SMOKE_BATCH_TASK=1 to verify batch interaction records."
fi

if [[ "${SMOKE_RETRY_TASK}" == "1" ]]; then
  retry_seed_body="$(node - <<'NODE'
const payload = {
  accountName: 'smoke-retry-account',
  targetName: 'smoke-retry-target',
  sourceText: '重试链路冒烟测试',
  replyText: '收到，稍后人工确认。',
  sendMode: 'approval-send',
};
console.log(JSON.stringify(payload));
NODE
)"
  retry_seed_json="$(curl_json POST "${API_BASE}/local-engine/comments/tasks" "${retry_seed_body}" || true)"
  retry_seed_id="$(printf '%s' "${retry_seed_json}" | json_data_get 'data => data.id' || true)"
  if [[ -n "${retry_seed_id}" ]]; then
    fail_json="$(curl_json POST "${API_BASE}/local-engine/tasks/${retry_seed_id}/fail" '{"reason":"smoke retry seed failure"}' || true)"
    failed_status="$(printf '%s' "${fail_json}" | json_data_get 'data => data.status' || true)"
    retry_json="$(curl_json POST "${API_BASE}/local-engine/tasks/${retry_seed_id}/retry" '{}' || true)"
    retry_id="$(printf '%s' "${retry_json}" | json_data_get 'data => data.id' || true)"
    retry_status="$(printf '%s' "${retry_json}" | json_data_get 'data => data.status' || true)"
    if [[ "${failed_status}" == "failed" && -n "${retry_id}" && "${retry_id}" != "${retry_seed_id}" && "${retry_status}" == "queued" ]]; then
      pass "retry task created: original=${retry_seed_id}, retry=${retry_id}"
    else
      fail "retry task check failed: failed_status=${failed_status:-unknown}, retry_id=${retry_id:-empty}, retry_status=${retry_status:-unknown}"
    fi
  else
    fail "retry seed task was not created; response: ${retry_seed_json:-empty}"
  fi
else
  warn "Skipping retry task check. Set SMOKE_RETRY_TASK=1 to verify failed-task recovery."
fi

section "Approval record and safety guards"
if [[ "${SMOKE_APPROVAL_RECORD}" == "1" ]]; then
  approval_body="$(node - <<'NODE'
const payload = {
  accountName: 'smoke-approval-account',
  targetName: 'smoke-approval-target',
  sourceText: '确认记录冒烟测试',
  replyText: '您好，已收到，我们稍后联系您。',
  sendMode: 'approval-send',
};
console.log(JSON.stringify(payload));
NODE
)"
  approval_json="$(curl_json POST "${API_BASE}/local-engine/comments/tasks" "${approval_body}" || true)"
  approval_id="$(printf '%s' "${approval_json}" | json_data_get 'data => data.id' || true)"
  if [[ -n "${approval_id}" ]]; then
    sleep 2
    approval_latest_json="$(curl_json GET "${API_BASE}/local-engine/tasks/${approval_id}" || true)"
    approval_status="$(printf '%s' "${approval_latest_json}" | json_data_get 'data => data.status' || true)"
    if [[ "${approval_status}" == "waiting_for_send_confirmation" ]]; then
      approve_json="$(curl_json POST "${API_BASE}/local-engine/tasks/${approval_id}/approve" '{"operator":"smoke","targetConfirmed":true,"contentConfirmed":true,"currentWindowConfirmed":true,"note":"smoke approval record"}' || true)"
      approval_operator="$(printf '%s' "${approve_json}" | json_data_get 'data => data.approvalRecord && data.approvalRecord.operator' || true)"
      approval_note="$(printf '%s' "${approve_json}" | json_data_get 'data => data.approvalRecord && data.approvalRecord.note' || true)"
      approval_event="$(printf '%s' "${approve_json}" | json_data_get 'data => (data.events || []).some(event => String(event.message || "").includes("人工确认记录已保存"))' || true)"
      if [[ "${approval_operator}" == "smoke" && "${approval_note}" == "smoke approval record" && "${approval_event}" == "true" ]]; then
        pass "approval record persisted: id=${approval_id}, operator=${approval_operator}"
      else
        fail "approval record missing after approve: operator=${approval_operator:-empty}, note=${approval_note:-empty}, event=${approval_event:-false}"
      fi
    else
      fail "approval seed task did not wait for confirmation: status=${approval_status:-unknown}"
    fi
    else
      warn "approval seed task was not created; likely missing logged-in interaction account. response: ${approval_json:-empty}"
    fi
else
  warn "Skipping approval record check. Set SMOKE_APPROVAL_RECORD=1 to verify confirmation persistence."
fi

if [[ "${SMOKE_WECHAT_GUARD}" == "1" ]]; then
  wechat_body="$(node - <<'NODE'
const payload = {
  accountName: 'smoke-wechat-account',
  targetName: 'smoke-wechat-target',
  sourceText: '请发一下门店地址。',
  replyText: '您好，地址稍后发您。',
  sendMode: 'auto-send',
};
console.log(JSON.stringify(payload));
NODE
)"
  wechat_json="$(curl_json POST "${API_BASE}/local-engine/wechat/tasks" "${wechat_body}" || true)"
  wechat_id="$(printf '%s' "${wechat_json}" | json_data_get 'data => data.id' || true)"
  wechat_mode="$(printf '%s' "${wechat_json}" | json_data_get 'data => data.sendMode' || true)"
  wechat_guard_event="$(printf '%s' "${wechat_json}" | json_data_get 'data => (data.events || []).some(event => String(event.message || "").includes("不允许自动发送"))' || true)"
  if [[ -n "${wechat_id}" && "${wechat_mode}" == "approval-send" && "${wechat_guard_event}" == "true" ]]; then
    pass "wechat auto-send guard works: id=${wechat_id}, sendMode=${wechat_mode}"
  elif [[ -n "${wechat_id}" && "${wechat_mode}" == "auto-send" ]]; then
    pass "wechat auto-send accepted by current runtime policy: id=${wechat_id}, sendMode=${wechat_mode}"
  else
    warn "wechat auto-send guard could not be verified; response: ${wechat_json:-empty}"
  fi
else
  warn "Skipping wechat guard check. Set SMOKE_WECHAT_GUARD=1 to verify wechat send-mode guard."
fi

section "Agent command, pending confirmation, and evidence"
if [[ "${SMOKE_AGENT_SESSION}" == "1" ]]; then
  agent_body="$(node - <<'NODE'
const payload = {
  title: 'smoke-agent-command',
  instruction: '打开抖音后台整理未回复评论，先生成回复，等我确认后再发送。',
  executionScope: 'browser',
  targetApp: '抖音后台',
  source: 'agent-console',
  dryRun: true,
};
console.log(JSON.stringify(payload));
NODE
)"
  agent_json="$(curl_json POST "${API_BASE}/local-engine/agent-sessions" "${agent_body}" || true)"
  agent_session_id="$(printf '%s' "${agent_json}" | json_data_get 'data => data.id' || true)"
  agent_status="$(printf '%s' "${agent_json}" | json_data_get 'data => data.status' || true)"
  agent_confirmation_id="$(printf '%s' "${agent_json}" | json_data_get 'data => data.confirmations && data.confirmations[0] && data.confirmations[0].id' || true)"
  agent_evidence_count="$(printf '%s' "${agent_json}" | json_data_get 'data => (data.events || []).filter(event => event.evidence).length' || true)"
  if [[ -n "${agent_session_id}" && "${agent_status}" == "waiting_for_confirmation" && -n "${agent_confirmation_id}" ]]; then
    pass "agent command created pending confirmation: session=${agent_session_id}, confirmation=${agent_confirmation_id}, evidence=${agent_evidence_count:-0}"
  else
    fail "agent command did not enter pending confirmation: session=${agent_session_id:-empty}, status=${agent_status:-unknown}, confirmation=${agent_confirmation_id:-empty}"
  fi

  pending_json="$(curl_json GET "${API_BASE}/local-engine/confirmations?status=pending" || true)"
  pending_has_agent="$(printf '%s' "${pending_json}" | AGENT_CONFIRMATION_ID="${agent_confirmation_id}" json_data_get 'data => (Array.isArray(data) ? data : []).some(item => item.id === process.env.AGENT_CONFIRMATION_ID)' || true)"
  if [[ "${pending_has_agent}" == "true" ]]; then
    pass "pending confirmation queue contains agent confirmation ${agent_confirmation_id}"
  else
    fail "pending confirmation queue does not contain agent confirmation ${agent_confirmation_id:-empty}"
  fi

  if [[ "${SMOKE_AGENT_CONFIRMATION}" == "1" && -n "${agent_confirmation_id}" ]]; then
    confirmed_check_keys="$(printf '%s' "${agent_json}" | json_data_get 'data => (((data.confirmations || [])[0] || {}).requiredChecks || []).map(check => check.key).filter(Boolean).join(",")' || true)"
    approve_body="$(CONFIRMED_CHECK_KEYS="${confirmed_check_keys:-}" node - <<'NODE'
const confirmedChecks = Object.fromEntries(
  String(process.env.CONFIRMED_CHECK_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => [key, true]),
);
console.log(JSON.stringify({
  operator: 'smoke',
  confirmedChecks,
  note: 'smoke agent approval',
}));
NODE
)"
    agent_approve_json="$(curl_json POST "${API_BASE}/local-engine/confirmations/${agent_confirmation_id}/approve" "${approve_body}" || true)"
    agent_approval_status="$(printf '%s' "${agent_approve_json}" | json_data_get 'data => data.status' || true)"
    if [[ "${agent_approval_status}" == "running" || "${agent_approval_status}" == "completed" ]]; then
      pass "agent confirmation approved and session resumed: confirmation=${agent_confirmation_id}, status=${agent_approval_status}"
    else
      fail "agent confirmation approve failed: status=${agent_approval_status:-unknown}, response=${agent_approve_json:-empty}"
    fi
    sleep 1
    agent_latest_json="$(curl_json GET "${API_BASE}/local-engine/agent-sessions/${agent_session_id}" || true)"
    agent_latest_status="$(printf '%s' "${agent_latest_json}" | json_data_get 'data => data.status' || true)"
    agent_latest_evidence="$(printf '%s' "${agent_latest_json}" | json_data_get 'data => (data.events || []).filter(event => event.evidence).length' || true)"
    if [[ "${agent_latest_status}" == "completed" && "${agent_latest_evidence}" -gt 0 ]]; then
      pass "agent session completed with evidence: status=${agent_latest_status}, evidence=${agent_latest_evidence}"
    else
      fail "agent session did not complete with evidence: status=${agent_latest_status:-unknown}, evidence=${agent_latest_evidence:-0}"
    fi
  else
    warn "Skipping agent confirmation approval. Set SMOKE_AGENT_CONFIRMATION=1 to approve the dry-run agent command."
  fi
else
  warn "Skipping agent session check. Set SMOKE_AGENT_SESSION=1 to verify agent command and confirmation flow."
fi

section "Agent reject and revision-continue decisions"
if [[ "${SMOKE_AGENT_SESSION}" == "1" ]]; then
  reject_body="$(node - <<'NODE'
const payload = {
  title: 'smoke-agent-reject',
  instruction: '准备执行高风险发送动作，但这条验收会拒绝继续。',
  executionScope: 'browser',
  targetApp: '浏览器',
  source: 'agent-console',
  dryRun: true,
};
console.log(JSON.stringify(payload));
NODE
)"
  reject_json="$(curl_json POST "${API_BASE}/local-engine/agent-sessions" "${reject_body}" || true)"
  reject_session_id="$(printf '%s' "${reject_json}" | json_data_get 'data => data.id' || true)"
  reject_confirmation_id="$(printf '%s' "${reject_json}" | json_data_get 'data => data.confirmations && data.confirmations[0] && data.confirmations[0].id' || true)"
  if [[ -n "${reject_session_id}" && -n "${reject_confirmation_id}" ]]; then
    rejected_json="$(curl_json POST "${API_BASE}/local-engine/confirmations/${reject_confirmation_id}/reject" '{"operator":"smoke","note":"smoke reject"}' || true)"
    rejected_status="$(printf '%s' "${rejected_json}" | json_data_get 'data => data.status' || true)"
    rejected_confirmation_json="$(curl_json GET "${API_BASE}/local-engine/agent-sessions/${reject_session_id}/confirmations?status=rejected" || true)"
    rejected_query_match="$(printf '%s' "${rejected_confirmation_json}" | REJECT_CONFIRMATION_ID="${reject_confirmation_id}" json_data_get 'data => (Array.isArray(data) ? data : []).some(item => item.id === process.env.REJECT_CONFIRMATION_ID)' || true)"
    if [[ "${rejected_status}" == "cancelled" && "${rejected_query_match}" == "true" ]]; then
      pass "agent rejection closes session and confirmation: session=${reject_session_id}, confirmation=${reject_confirmation_id}"
    else
      fail "agent rejection check failed: status=${rejected_status:-unknown}, confirmation_found=${rejected_query_match:-false}"
    fi
  else
    fail "agent reject seed was not created: session=${reject_session_id:-empty}, confirmation=${reject_confirmation_id:-empty}"
  fi

  revision_body="$(node - <<'NODE'
const payload = {
  title: 'smoke-agent-revision-continue',
  instruction: '先暂停确认，验收修改后继续。',
  executionScope: 'browser',
  targetApp: '浏览器',
  source: 'agent-console',
  dryRun: true,
};
console.log(JSON.stringify(payload));
NODE
)"
  revision_json="$(curl_json POST "${API_BASE}/local-engine/agent-sessions" "${revision_body}" || true)"
  revision_session_id="$(printf '%s' "${revision_json}" | json_data_get 'data => data.id' || true)"
  revision_confirmation_id="$(printf '%s' "${revision_json}" | json_data_get 'data => data.confirmations && data.confirmations[0] && data.confirmations[0].id' || true)"
  if [[ -n "${revision_session_id}" && -n "${revision_confirmation_id}" ]]; then
    revision_pending_json="$(curl_json GET "${API_BASE}/local-engine/confirmations?status=pending" || true)"
    revision_pending_match="$(printf '%s' "${revision_pending_json}" | REVISION_CONFIRMATION_ID="${revision_confirmation_id}" json_data_get 'data => (Array.isArray(data) ? data : []).some(item => item.id === process.env.REVISION_CONFIRMATION_ID)' || true)"
    if [[ "${revision_pending_match}" == "true" ]]; then
      pass "agent revision seed is parked in confirmation queue: session=${revision_session_id}, confirmation=${revision_confirmation_id}"
    else
      fail "agent revision seed is not queryable in confirmation queue: session=${revision_session_id:-empty}, confirmation=${revision_confirmation_id:-empty}"
    fi
  else
    fail "agent revision seed was not created: session=${revision_session_id:-empty}, confirmation=${revision_confirmation_id:-empty}"
  fi
else
  warn "Skipping agent reject/revision checks. Set SMOKE_AGENT_SESSION=1 to verify decision variants."
fi

section "Publishing confirmation guard"
if [[ "${SMOKE_PUBLISH_CONFIRMATION}" == "1" ]]; then
  publish_body="$(node - <<'NODE'
const payload = {
  title: 'smoke-publish-confirmation',
  instruction: '准备提交真实发布前先进入待我确认，不要自动发布。',
  executionScope: 'browser',
  targetApp: '发布中心',
  source: 'publishing',
  dryRun: true,
  resumeAction: {
    kind: 'auto-upload-publish',
    label: 'smoke publish confirmation',
    payloads: [
      {
        type: 3,
        title: 'smoke-dry-run-title',
        tags: ['smoke'],
        fileList: ['/tmp/smoke-video.mp4'],
        accountList: ['/tmp/smoke-account.json'],
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: true,
        debugDryRunHoldBrowser: true,
        category: 0,
      },
    ],
  },
};
console.log(JSON.stringify(payload));
NODE
)"
  publish_json="$(curl_json POST "${API_BASE}/local-engine/agent-sessions" "${publish_body}" || true)"
  publish_session_id="$(printf '%s' "${publish_json}" | json_data_get 'data => data.id' || true)"
  publish_status="$(printf '%s' "${publish_json}" | json_data_get 'data => data.status' || true)"
  publish_confirmation_id="$(printf '%s' "${publish_json}" | json_data_get 'data => data.confirmations && data.confirmations[0] && data.confirmations[0].id' || true)"
  publish_resume_kind="$(printf '%s' "${publish_json}" | json_data_get 'data => data.resumeAction && data.resumeAction.kind' || true)"
  publish_payloads="$(printf '%s' "${publish_json}" | json_data_get 'data => data.resumeAction && Array.isArray(data.resumeAction.payloads) ? data.resumeAction.payloads.length : 0' || true)"
  if [[ -n "${publish_session_id}" && "${publish_status}" == "waiting_for_confirmation" && -n "${publish_confirmation_id}" && "${publish_resume_kind}" == "auto-upload-publish" && "${publish_payloads}" == "1" ]]; then
    pass "publish action is parked in confirmation queue: session=${publish_session_id}, confirmation=${publish_confirmation_id}"
  else
    fail "publish confirmation guard failed: session=${publish_session_id:-empty}, status=${publish_status:-unknown}, confirmation=${publish_confirmation_id:-empty}, resume=${publish_resume_kind:-empty}, payloads=${publish_payloads:-0}"
  fi

  if [[ "${SMOKE_APPROVE_PUBLISH_CONFIRMATION}" == "1" && -n "${publish_confirmation_id}" ]]; then
    warn "Approving publish confirmation may call the local upload runner; keep SMOKE_APPROVE_PUBLISH_CONFIRMATION=0 for routine smoke."
  else
    pass "publish confirmation approval intentionally skipped to avoid triggering upload runner"
  fi
else
  warn "Skipping publish confirmation check. Set SMOKE_PUBLISH_CONFIRMATION=1 to verify publishing waits for confirmation."
fi

section "Recovery checks"
if [[ "${SMOKE_RECOVERY}" == "1" ]]; then
  if [[ -z "${recovery_task_id}" ]]; then
    warn "Skipping recovery check. Enable SMOKE_CREATE_TASK=1 to produce a task first."
  else
    recovered_json="$(curl_json GET "${API_BASE}/local-engine/tasks/${recovery_task_id}" || true)"
    recovered_id="$(printf '%s' "${recovered_json}" | json_data_get 'data => data.id' || true)"
    recovered_events="$(printf '%s' "${recovered_json}" | json_data_get 'data => Array.isArray(data.events) ? data.events.length : 0' || true)"
    if [[ "${recovered_id}" == "${recovery_task_id}" && "${recovered_events}" -gt 0 ]]; then
      pass "task recovery readable: id=${recovered_id}, events=${recovered_events}"
    else
      fail "task recovery check failed: expected=${recovery_task_id}, got=${recovered_id:-empty}, events=${recovered_events:-0}"
    fi
  fi
else
  warn "Skipping recovery check. Set SMOKE_RECOVERY=1 to verify persisted task readability."
fi

section "Diagnostic export"
if [[ "${SMOKE_DIAGNOSTICS}" == "1" ]]; then
  if [[ -z "${diagnostic_task_id}" ]]; then
    warn "Skipping diagnostic export. Enable SMOKE_CREATE_TASK=1 or SMOKE_BATCH_TASK=1 to produce a task first."
  else
    diagnostic_json="$(curl_json GET "${API_BASE}/local-engine/tasks/${diagnostic_task_id}/diagnostics/export" || true)"
    diagnostic_summary="$(
      printf '%s' "${diagnostic_json}" | EXPECTED_TASK_ID="${diagnostic_task_id}" node -e "
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const envelope = JSON.parse(input || '{}');
    const data = Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : envelope;
    const content = JSON.parse(data.content || '{}');
    const steps = content.steps || (content.task && content.task.steps) || [];
    const events = content.events || (content.task && content.task.events) || [];
    const evidence = content.evidence || (content.task && content.task.evidence) || [];
    const expectedTaskId = process.env.EXPECTED_TASK_ID;
    const checks = {
      taskIdMatches: content.task && content.task.id === expectedTaskId,
      hasSteps: Array.isArray(steps) && steps.length > 0,
      hasEvents: Array.isArray(events) && events.length > 0,
      hasRuntime: Boolean(content.runtime),
      hasReadiness: Boolean(content.readiness),
    };
    if (!data.filename || data.mimeType !== 'application/json;charset=utf-8') process.exit(3);
    if (!Object.values(checks).every(Boolean)) process.exit(4);
    console.log(JSON.stringify({
      filename: data.filename,
      taskId: content.task.id,
      status: content.task.status,
      steps: steps.length,
      events: events.length,
      evidence: Array.isArray(evidence) ? evidence.length : 0,
    }));
  } catch (error) {
    process.exit(2);
  }
});
"
    )" || true
    if [[ -n "${diagnostic_summary}" ]]; then
      pass "diagnostic export works: ${diagnostic_summary}"
    else
      fail "diagnostic export check failed for task ${diagnostic_task_id}; response: ${diagnostic_json:-empty}"
    fi
  fi
else
  warn "Skipping diagnostic export. Set SMOKE_DIAGNOSTICS=1 to verify troubleshooting packages."
fi

section "Agent evidence export"
if [[ "${SMOKE_AGENT_EVIDENCE_EXPORT}" == "1" ]]; then
  if [[ -z "${agent_session_id}" ]]; then
    warn "Skipping agent evidence export. Enable SMOKE_AGENT_SESSION=1 to produce an agent session first."
  else
    agent_export_json="$(curl_json GET "${API_BASE}/local-engine/agent-sessions/${agent_session_id}/evidence/export" || true)"
    agent_export_summary="$(
      printf '%s' "${agent_export_json}" | EXPECTED_SESSION_ID="${agent_session_id}" node -e "
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const envelope = JSON.parse(input || '{}');
    const data = Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : envelope;
    const content = JSON.parse(data.content || '{}');
    const evidenceEvents = content.evidenceEvents || [];
    const timeline = content.timeline || [];
    const expectedSessionId = process.env.EXPECTED_SESSION_ID;
    if (!data.filename || data.mimeType !== 'application/json;charset=utf-8') process.exit(3);
    if (!content.session || content.session.id !== expectedSessionId) process.exit(4);
    if (!Array.isArray(evidenceEvents) || evidenceEvents.length === 0) process.exit(5);
    if (!Array.isArray(timeline) || timeline.length === 0) process.exit(6);
    console.log(JSON.stringify({
      filename: data.filename,
      sessionId: content.session.id,
      status: content.session.status,
      evidenceEvents: evidenceEvents.length,
      timeline: timeline.length,
    }));
  } catch (error) {
    process.exit(2);
  }
});
"
    )" || true
    if [[ -n "${agent_export_summary}" ]]; then
      pass "agent evidence export works: ${agent_export_summary}"
    else
      warn "agent evidence export shape did not match strict smoke expectations for session ${agent_session_id}; response: ${agent_export_json:-empty}"
    fi
  fi
else
  warn "Skipping agent evidence export. Set SMOKE_AGENT_EVIDENCE_EXPORT=1 to verify session evidence packages."
fi

section "UI route smoke"
if [[ "${SMOKE_UI_ROUTES}" == "1" ]]; then
  if FRONTEND_URL="${FRONTEND_URL}" API_BASE="${API_BASE}" SMOKE_USERNAME="${SMOKE_USERNAME}" SMOKE_PASSWORD="${SMOKE_PASSWORD}" bash scripts/ui-acceptance-smoke.sh; then
    pass "UI route smoke passed"
  else
    fail "UI route smoke failed"
  fi
else
  warn "Skipping curl-based UI route smoke. Set SMOKE_UI_ROUTES=1 only for legacy SSR text checks; current UI should be verified with a browser."
fi

section "Manual UI acceptance still useful"
cat <<EOF
- Open ${FRONTEND_URL}/login and confirm unauthenticated users see the login screen.
- After login, open ${FRONTEND_URL}/agent-console, ${FRONTEND_URL}/confirmations, ${FRONTEND_URL}/distribution, ${FRONTEND_URL}/workbench/douyin-comments, ${FRONTEND_URL}/local-engine?tab=engine, ${FRONTEND_URL}/execution-records, and ${FRONTEND_URL}/artifacts.
- On local-engine tabs, verify runtime, browser/account, executors, files, and readiness cards match the API results above.
- Create or inspect a task at ${FRONTEND_URL}/workbench/douyin-comments or ${FRONTEND_URL}/interaction/records.
- For approval-send tasks, confirm the UI shows an explicit confirmation/skip/stop step before any controlled send action.
- Evidence check: task and Agent session events should expose screenshot/snapshot/text evidence values. If a value is a local or HTTP URL, open it and save it in the test notes.
- Real-send defense: do not use auto-send in smoke. Prefer draft-only or approval-send, and confirm no platform send button is clicked automatically.
EOF

section "Summary"
log "PASS=${pass_count} WARN=${warn_count} FAIL=${fail_count}"

if [[ "${fail_count}" -gt 0 ]]; then
  exit 1
fi
