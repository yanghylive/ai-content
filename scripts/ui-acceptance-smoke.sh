#!/usr/bin/env bash
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3010}"
API_BASE="${API_BASE:-http://localhost:3011/api}"
SMOKE_USERNAME="${SMOKE_USERNAME:-}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"
SMOKE_UI_TIMEOUT_SECONDS="${SMOKE_UI_TIMEOUT_SECONDS:-15}"
SMOKE_UI_LIST_ONLY="${SMOKE_UI_LIST_ONLY:-0}"

COOKIE_JAR="$(mktemp -t ai-content-ui-smoke-cookies.XXXXXX)"
BODY_FILE="$(mktemp -t ai-content-ui-smoke-body.XXXXXX)"
trap 'rm -f "${COOKIE_JAR}" "${BODY_FILE}"' EXIT

pass_count=0
warn_count=0
fail_count=0

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

route_checks=(
  'Login|/login|登录'
  'Dashboard navigation|/|工作台	内容生产	发布中心	互动中心	本地能力'
  'Agent command console|/agent-console|Agent 指令台'
  'Pending confirmations|/confirmations|待我确认'
  'Publishing center|/distribution?tab=article|发布中心	图文发布'
  'Publishing logs|/distribution?tab=logs|发布中心	运行日志'
  '抖音评论|/workbench/douyin-comments|评论回复	批量对象	互动任务	诊断包'
  '抖音私信|/workbench/douyin-messages|私信回复	互动任务'
  'Interaction rules|/interaction/rules|自动回复规则	传统服务业'
  'Interaction records|/interaction/records|回复记录	证据文件治理'
  'Local engine control|/local-engine?tab=engine|本地引擎	本地服务状态'
  'Execution records|/execution-records|执行记录'
  'Evidence artifacts|/artifacts|证据产物'
)

request() {
  local use_cookie_jar="$1"
  local url="$2"
  shift 2
  local args=(
    -k -L --max-time "${SMOKE_UI_TIMEOUT_SECONDS}"
    -o "${BODY_FILE}"
    -w '%{http_code} %{url_effective}'
  )
  if [[ "${use_cookie_jar}" == "1" ]]; then
    args+=(-b "${COOKIE_JAR}" -c "${COOKIE_JAR}")
  fi
  curl "${args[@]}" "$@" "${url}"
}

login() {
  if [[ -z "${SMOKE_USERNAME}" || -z "${SMOKE_PASSWORD}" ]]; then
    warn "skipping API login; set SMOKE_USERNAME and SMOKE_PASSWORD to forward the auth cookie to UI route checks"
    return 0
  fi

  local status_line status
  status_line="$(request 1 "${API_BASE%/}/auth/login" \
    -H 'Accept: application/json' \
    -H 'Content-Type: application/json' \
    --data "$(node -e 'console.log(JSON.stringify({ username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD }))')")" || {
      fail "API login request failed"
      return 0
    }
  status="${status_line%% *}"
  if [[ "${status}" == "200" || "${status}" == "201" ]]; then
    pass "API login succeeded"
  else
    fail "API login failed: HTTP ${status}"
  fi
}

check_route() {
  local label="$1"
  local route="$2"
  local tokens="$3"
  local url="${FRONTEND_URL%/}${route}"
  local use_cookie_jar="0"
  local status_line status final_url missing token

  if [[ -n "${SMOKE_USERNAME}" && -n "${SMOKE_PASSWORD}" ]]; then
    use_cookie_jar="1"
  fi

  status_line="$(request "${use_cookie_jar}" "${url}" -H 'Accept: text/html')" || {
    fail "${label}: request failed (${url})"
    return
  }
  status="${status_line%% *}"
  final_url="${status_line#* }"

  if [[ "${status}" != "200" ]]; then
    fail "${label}: HTTP ${status} (${url})"
    return
  fi

  if [[ "${route}" != "/login" && "${final_url}" =~ /login([?#]|$) ]]; then
    fail "${label}: redirected to login (${final_url})"
    return
  fi

  missing=""
  while IFS= read -r token; do
    [[ -z "${token}" ]] && continue
    if ! grep -Fq "${token}" "${BODY_FILE}"; then
      missing="${missing}${missing:+ / }${token}"
    fi
  done < <(printf '%s' "${tokens}" | tr '\t' '\n')

  if [[ -n "${missing}" ]]; then
    fail "${label}: missing text ${missing} (${url})"
    return
  fi

  pass "${label}: HTTP ${status}, required text visible"
}

printf 'AI Content UI smoke acceptance\n'
printf 'Frontend URL: %s\n' "${FRONTEND_URL}"
printf 'API base: %s\n\n' "${API_BASE}"

if [[ "${SMOKE_UI_LIST_ONLY}" == "1" ]]; then
  for check in "${route_checks[@]}"; do
    IFS='|' read -r label route tokens <<<"${check}"
    printf '%s\n' "${FRONTEND_URL%/}${route}"
    printf '  Must see: %s\n' "$(printf '%s' "${tokens}" | tr '\t' '/')"
  done
  exit 0
fi

login

for check in "${route_checks[@]}"; do
  IFS='|' read -r label route tokens <<<"${check}"
  check_route "${label}" "${route}" "${tokens}"
done

printf '\nSummary: PASS=%s WARN=%s FAIL=%s\n' "${pass_count}" "${warn_count}" "${fail_count}"

if [[ "${fail_count}" -gt 0 ]]; then
  exit 1
fi
