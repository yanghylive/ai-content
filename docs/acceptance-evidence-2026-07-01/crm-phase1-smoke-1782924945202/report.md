# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-01T16:55:45.491Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=14; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=1; companies=0; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_95a716742d851e56 |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_b8f15188c9942f21; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=1; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=1; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_53bc35bc622e4542; proof=53bc35bc622e4542724e28c9d946b49008102314d89797071fb2204b99425fdb; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=07625bab849f77f621ff677926d05a183c73965243fe6e488ac2581ab3810166; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=9; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_53bc35bc622e4542; status=rolled_back; commitProof=53bc35bc622e4542724e28c9d946b49008102314d89797071fb2204b99425fdb; rollbackProof=07625bab849f77f621ff677926d05a183c73965243fe6e488ac2581ab3810166 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

