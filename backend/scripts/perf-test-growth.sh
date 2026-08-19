#!/usr/bin/env bash
# 性能/大数据量测试：造 5000 条 lead + interaction_event，测分页与六步闭环复盘查询耗时
set -uo pipefail

PY=/Users/yanghy/.workbuddy/binaries/python/versions/3.13.12/bin/python3
DB="$HOME/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite"
BASE="http://127.0.0.1:3011/api"
USER_ID="cmsmjmskh01xwi5opfmpmu30n"
TENANT_ID="cmsmjmskj01xyi5opalqqfio2"
N=5000

iso() { $PY -c "import datetime;print((datetime.datetime.now(datetime.UTC)+datetime.timedelta(${1:-0})).strftime('%Y-%m-%dT%H:%M:%S.000Z'))"; }
TOKEN=$($PY -c 'import secrets;print(secrets.token_urlsafe(32))')
HASH=$(printf '%s' "$TOKEN" | shasum -a 256 | awk '{print $1}')
SID="perf_$($PY -c 'import secrets;print(secrets.token_hex(6))')"
NOW=$(iso); EXP=$(iso 1)
META='{"source":"perf-test","localOnly":true,"kaypalSubscriptionPlan":"ADVANCED","kaypalRole":"SUPER_ADMIN","kaypalPlatformRole":"SUPER_ADMIN","kaypalPermissionNames":["console_quality_scan"]}'
sqlite3 "$DB" "INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('$SID','$USER_ID','$HASH','$EXP','$NOW','$META','$NOW','$NOW');"
COOKIE="Cookie: ai_content_session=$TOKEN"

# 造 5000 条 lead + interaction_event（递归 CTE，快）
echo "=== 造数据（$N 条 lead + interaction_event）==="
T0=$($PY -c 'import time;print(time.time())')
sqlite3 "$DB" "
WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<$N)
INSERT INTO leads (id,user_id,tenant_id,platform,source_type,nickname,status,score,created_at,updated_at,dedupe_key)
SELECT 'perf-lead-'||x, '$USER_ID', '$TENANT_ID', CASE x%3 WHEN 0 THEN 'douyin' WHEN 1 THEN 'xiaohongshu' ELSE 'wechat' END, 'auto-acquisition', 'perf线索'||x, 'new', 60+(x%40), datetime('now'), datetime('now'), 'perf:lead:'||x FROM cnt;
WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<$N)
INSERT INTO interaction_events (id,tenant_id,user_id,platform,account_id,channel,body,dedupe_key,occurred_at,created_at,updated_at)
SELECT 'perf-ev-'||x, '$TENANT_ID', '$USER_ID', CASE x%3 WHEN 0 THEN 'douyin' WHEN 1 THEN 'xiaohongshu' ELSE 'wechat' END, 'acc1', 'comment', '测试评论'||x, 'perf:ev:'||x, datetime('now'), datetime('now'), datetime('now') FROM cnt;
"
T1=$($PY -c 'import time;print(time.time())')
echo "  造数据耗时: $($PY -c "print(f'{$T1-$T0:.2f}s')")"

time_req() { # label path
  local label="$1" path="$2"
  local t=$(curl -s -o /dev/null -w '%{time_total}' -H "$COOKIE" "$BASE$path")
  printf '  %-50s %s\n' "$label" "$t 秒"
}

echo "=== 分页查询耗时 ==="
time_req "GET /growth/leads?page=1&pageSize=20（首页）" "/growth/leads?page=1&pageSize=20"
time_req "GET /growth/leads?page=250&pageSize=20（深分页）" "/growth/leads?page=250&pageSize=20"
time_req "GET /growth/leads?status=new&platform=douyin（筛选）" "/growth/leads?status=new&platform=douyin&page=1&pageSize=20"

echo "=== 六步闭环复盘查询耗时（sixStage 多次 count + platformComparison）==="
time_req "GET /growth/reports（全量复盘）" "/growth/reports"
time_req "GET /growth/reports?platform=douyin（平台过滤）" "/growth/reports?platform=douyin"
time_req "GET /growth/overview" "/growth/overview"

echo "=== 清理测试数据 ==="
sqlite3 "$DB" "DELETE FROM leads WHERE id LIKE 'perf-lead-%'; DELETE FROM interaction_events WHERE id LIKE 'perf-ev-%'; DELETE FROM user_sessions WHERE id='$SID';"
echo "  已清理 perf-* 数据"
