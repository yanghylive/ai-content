# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-08T14:41:14.605Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: FAIL
- Counts: PASS=0 SKIP=0 FAIL=0 BLOCKED=9

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| BLOCKED | api:GET /commercial-readiness/summary | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:GET /crm/summary | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:POST /crm/import/preview | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:POST /crm/import/dry-run | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:GET /crm/closer/summary | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:POST /crm/closer/advice | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:GET /crm/connectors/readiness | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:POST /crm/connectors/contract | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |
| BLOCKED | api:destructive dry-run | HTTP 401 | Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke. |

