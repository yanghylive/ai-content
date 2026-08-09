# P4 Business Journey Smoke Evidence

- Generated at: 2026-08-08T14:41:14.511Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: FAIL
- Counts: PASS=0 FAIL=1 BLOCKED=1

## Artifacts

- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-08/p4-business-journey-2026-08-08T14-41-14-511Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| BLOCKED | 创作优化：保存优化版本 | HTTP 401; 登录状态已失效，请重新登录 | 提供有效登录态，或使用本机 SQLite 验收登录。 |
| FAIL | CRM 导入：写入后可回滚 | CRM smoke 失败，exit=1; [BLOCKED] api:GET /crm/closer/summary: HTTP 401 \| next: Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. / [BLOCKED] api:POST /crm/closer/advice: HTTP 401 \| next: Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. / [BLOCKED] api:GET /crm/connectors/readiness: HTTP 401 \| next: Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. / [BLOCKED] api:POST /crm/connectors/contract: HTTP 401 \| next: Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. / [BLOCKED] api:destructive dry-run: HTTP 401 \| next: Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. / Evidence written to /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-08/p4-business-journey-2026-08-08T14-41-14-511Z/crm-phase1 | 查看 CRM smoke report.md 并修复失败检查。 |

