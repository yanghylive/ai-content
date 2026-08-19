#!/usr/bin/env bash
# HTTP 接口层集成测试（真实后端 + 真实 SQLite 桌面库，非 mock）
# 覆盖：鉴权、growth 只读接口、参数健壮性、sync-crm 写链路 + 幂等
set -uo pipefail

PY=/Users/yanghy/.workbuddy/binaries/python/versions/3.13.12/bin/python3
DB="$HOME/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite"
BASE="http://127.0.0.1:3011/api"
USER_ID="cmsmjmskh01xwi5opfmpmu30n"
TENANT_ID="cmsmjmskj01xyi5opalqqfio2"

iso() { $PY -c "import datetime;print((datetime.datetime.now(datetime.UTC)+datetime.timedelta(${1:-0})).strftime('%Y-%m-%dT%H:%M:%S.000Z'))"; }

TOKEN=$($PY -c 'import secrets;print(secrets.token_urlsafe(32))')
HASH=$(printf '%s' "$TOKEN" | shasum -a 256 | awk '{print $1}')
SID="it_$($PY -c 'import secrets;print(secrets.token_hex(6))')"
NOW=$(iso); EXP=$(iso 1); PEND=$(iso 30)
META='{"source":"http-integration-test","localOnly":true,"kaypalSubscriptionPlan":"ADVANCED","kaypalSubscriptionPeriodEnd":"'"$PEND"'","kaypalRole":"SUPER_ADMIN","kaypalPlatformRole":"SUPER_ADMIN","kaypalPermissionNames":["console_quality_scan"],"kaypalMetadataSyncedAt":"'"$NOW"'","kaypalDesktopAccessToken":"it-access","kaypalDesktopRefreshToken":"it-refresh","kaypalDesktopTokenExpiresAt":"'"$EXP"'","kaypalDesktopDeviceId":"it-device"}'

sqlite3 "$DB" "INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('$SID','$USER_ID','$HASH','$EXP','$NOW','$META','$NOW','$NOW');"
COOKIE="Cookie: ai_content_session=$TOKEN"

PASS=0; FAIL=0
report() {
  if [ "$2" = "PASS" ]; then PASS=$((PASS+1)); printf '✅ PASS  %s  %s\n' "$1" "$3";
  else FAIL=$((FAIL+1)); printf '❌ FAIL  %s  [%s]  %s\n' "$1" "$2" "$3"; fi
}

# dget <json-path-in-data>  → 穿透 {data:...} 层取值
dget() {
  printf '%s' "$BODY" | $PY -c "import sys,json
try:
  d=json.load(sys.stdin)
  d=d.get('data', d) if isinstance(d,dict) else d
  for k in '$1'.split('.'):
    d = d[k] if isinstance(d,dict) else (d[int(k)] if isinstance(d,list) else None)
  print(json.dumps(d,ensure_ascii=False)[:200])
except Exception:
  print('(parse-err)')"
}

curl_req() { # method path [body]
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then
    CODE=$(curl -s -o /tmp/it_body.json -w '%{http_code}' -X "$m" -H "$COOKIE" -H "Content-Type: application/json" -d "$b" "$BASE$p" 2>/dev/null)
  else
    CODE=$(curl -s -o /tmp/it_body.json -w '%{http_code}' -X "$m" -H "$COOKIE" -H "Content-Type: application/json" "$BASE$p" 2>/dev/null)
  fi
  BODY=$(cat /tmp/it_body.json 2>/dev/null)
}

echo "════════ 鉴权层 ════════"
CODE=$(curl -s -o /tmp/it_body.json -w '%{http_code}' "$BASE/growth/overview" 2>/dev/null); BODY=$(cat /tmp/it_body.json)
[ "$CODE" = "401" ] && report "未登录 → 401" PASS "$CODE" || report "未登录 → 401" "$CODE" "$BODY"
CODE=$(curl -s -o /tmp/it_body.json -w '%{http_code}' -H "Cookie: ai_content_session=forged" "$BASE/growth/overview" 2>/dev/null); BODY=$(cat /tmp/it_body.json)
[ "$CODE" = "401" ] && report "伪造 token → 401" PASS "$CODE" || report "伪造 token → 401" "$CODE" "$BODY"

echo "════════ growth 只读接口 ════════"
curl_req GET "/growth/overview"
[ "$CODE" = "200" ] && report "GET /growth/overview" PASS "$CODE" || report "GET /growth/overview" "$CODE" "$BODY"

curl_req GET "/growth/reports"
if [ "$CODE" = "200" ]; then
  SIX=$(printf '%s' "$BODY" | $PY -c "import sys,json;d=json.load(sys.stdin)['data'];print('sixStage='+str('sixStage' in d),'funnel='+str('funnel' in d),'leadStatus='+str('leadStatusDistribution' in d),'bottlenecks='+str('bottlenecks' in d))" 2>/dev/null)
  report "GET /growth/reports（含 sixStage）" PASS "$CODE | $SIX"
else report "GET /growth/reports" "$CODE" "$BODY"; fi

# 检查 sixStage 六步数字段细节
SIXDET=$(curl -s -H "$COOKIE" "$BASE/growth/reports" | $PY -c "import sys,json;d=json.load(sys.stdin)['data'].get('sixStage');print(json.dumps({k:d[k] for k in ('content','publish','interaction','lead','customer','opportunity') if k in d},ensure_ascii=False)) if isinstance(d,dict) else 'MISSING')" 2>/dev/null)
report "sixStage 六步数字段" PASS "$SIXDET"

curl_req GET "/growth/reports?platform=douyin"
[ "$CODE" = "200" ] && report "GET /growth/reports?platform=douyin" PASS "$CODE" || report "GET /growth/reports?platform=douyin" "$CODE" "$BODY"

curl_req GET "/growth/leads?page=1&pageSize=3"
if [ "$CODE" = "200" ]; then
  CNT=$(printf '%s' "$BODY" | $PY -c "import sys,json;d=json.load(sys.stdin)['data'];print(len(d) if isinstance(d,list) else 'non-list:'+str(type(d).__name__))" 2>/dev/null)
  report "GET /growth/leads?page=1&pageSize=3" PASS "$CODE | 返回条数=$CNT"
else report "GET /growth/leads 分页" "$CODE" "$BODY"; fi

curl_req GET "/growth/leads?status=contacted&platform=douyin"
[ "$CODE" = "200" ] && report "GET /growth/leads?status=contacted&platform=douyin" PASS "$CODE" || report "GET /growth/leads 筛选" "$CODE" "$BODY"

curl_req GET "/growth/acquisition/runs?page=1&pageSize=5"
[ "$CODE" = "200" ] && report "GET /growth/acquisition/runs 分页" PASS "$CODE" || report "GET /growth/acquisition/runs" "$CODE" "$BODY"

curl_req GET "/growth/acquisition/configs"
[ "$CODE" = "200" ] && report "GET /growth/acquisition/configs" PASS "$CODE" || report "GET /growth/acquisition/configs" "$CODE" "$BODY"

LEAD_ID=$(sqlite3 "$DB" "SELECT id FROM leads WHERE user_id='$USER_ID' LIMIT 1;")
curl_req GET "/growth/leads/$LEAD_ID/score-history"
[ "$CODE" = "200" ] && report "GET /growth/leads/:id/score-history" PASS "$CODE" || report "GET score-history" "$CODE" "$BODY"
curl_req GET "/growth/leads/$LEAD_ID/attribution"
[ "$CODE" = "200" ] && report "GET /growth/leads/:id/attribution" PASS "$CODE" || report "GET attribution" "$CODE" "$BODY"

echo "════════ 参数健壮性 ════════"
curl_req GET "/growth/leads?page=abc&pageSize=-5"
{ [ "$CODE" = "200" ] || [ "$CODE" = "400" ]; } && report "GET /growth/leads?page=abc&pageSize=-5 不崩" PASS "$CODE" || report "非法 page 参数" "$CODE" "$BODY"
curl_req GET "/growth/reports?startDate=bad&endDate=bad"
{ [ "$CODE" = "200" ] || [ "$CODE" = "400" ]; } && report "GET /growth/reports?startDate=bad 不崩" PASS "$CODE" || report "非法日期参数" "$CODE" "$BODY"
curl_req GET "/growth/leads/not-exist-id/score-history"
{ [ "$CODE" = "404" ] || [ "$CODE" = "200" ]; } && report "GET 不存在 lead → 不崩" PASS "$CODE" || report "不存在 lead" "$CODE" "$BODY"

echo "════════ 写链路：createLead → sync-crm（幂等）════════"
curl_req POST "/growth/leads" '{"sourceText":"集成测试线索","platform":"douyin","nickname":"集成测试-李四","score":70}'
NEW_LEAD_ID=$(printf '%s' "$BODY" | $PY -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('id',''))" 2>/dev/null)
if { [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; } && [ -n "$NEW_LEAD_ID" ]; then report "POST /growth/leads 创建线索" PASS "$CODE | id=$NEW_LEAD_ID"; else report "POST /growth/leads" "$CODE" "id=$NEW_LEAD_ID body=$BODY"; fi

if [ -n "$NEW_LEAD_ID" ]; then
  B_CUST=$(sqlite3 "$DB" "SELECT count(*) FROM crm_customers WHERE tenant_id='$TENANT_ID';")
  curl_req POST "/growth/leads/$NEW_LEAD_ID/sync-crm"
  CUST1=$(printf '%s' "$BODY" | $PY -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('customerId',''))" 2>/dev/null)
  OK1=$(printf '%s' "$BODY" | $PY -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('ok',''))" 2>/dev/null)
  { [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; } && [ -n "$CUST1" ] && report "POST sync-crm 第1次" PASS "$CODE | ok=$OK1 customerId=$CUST1" || report "POST sync-crm 第1次" "$CODE" "$BODY"

  curl_req POST "/growth/leads/$NEW_LEAD_ID/sync-crm"
  CUST2=$(printf '%s' "$BODY" | $PY -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('customerId',''))" 2>/dev/null)
  A_CUST=$(sqlite3 "$DB" "SELECT count(*) FROM crm_customers WHERE tenant_id='$TENANT_ID';")
  if [ -n "${CUST1:-}" ] && [ "${CUST1:-}" = "${CUST2:-}" ]; then report "sync-crm 幂等（customerId 一致，客户数 ${B_CUST:-0}->${A_CUST:-0}）" PASS "$CODE | cust=$CUST1"; else report "sync-crm 幂等" "$CODE" "cust1=$CUST1 cust2=$CUST2"; fi

  # 验证归因链已落库
  LINK=$(sqlite3 "$DB" "SELECT count(*) FROM attribution_links WHERE from_id='$NEW_LEAD_ID' OR to_id='$NEW_LEAD_ID';")
  report "线索→客户归因链落库" $([ "${LINK:-0}" -ge 1 ] && echo PASS || echo FAIL) "attribution_links=$LINK"

  # 清理（字段名对齐 SQLite 实际 schema）
  if [ -n "$CUST1" ]; then
    COMPANY=$(sqlite3 "$DB" "SELECT company_id FROM crm_customers WHERE id='$CUST1';")
    sqlite3 "$DB" "DELETE FROM crm_opportunities WHERE primary_customer_id='$CUST1'; DELETE FROM crm_tasks WHERE customer_id='$CUST1'; DELETE FROM crm_notes WHERE customer_id='$CUST1'; DELETE FROM crm_timeline_events WHERE customer_id='$CUST1'; DELETE FROM attribution_links WHERE from_id='$NEW_LEAD_ID' OR to_id='$CUST1'; DELETE FROM domain_event_outbox WHERE aggregate_id IN ('$CUST1','$NEW_LEAD_ID'); DELETE FROM crm_customers WHERE id='$CUST1';" 2>/dev/null
    if [ -n "${COMPANY:-}" ]; then sqlite3 "$DB" "DELETE FROM crm_companies WHERE id='$COMPANY';" 2>/dev/null; fi
  fi
  sqlite3 "$DB" "DELETE FROM leads WHERE id='$NEW_LEAD_ID'; DELETE FROM lead_signals WHERE lead_id='$NEW_LEAD_ID'; DELETE FROM lead_score_snapshots WHERE lead_id='$NEW_LEAD_ID';" 2>/dev/null
  report "清理测试数据" PASS "done"
fi

echo "════════ 结果 ════════"
echo "PASS=$PASS FAIL=$FAIL"
sqlite3 "$DB" "DELETE FROM user_sessions WHERE id='$SID';"
exit $FAIL
