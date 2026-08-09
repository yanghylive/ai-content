# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-03T11:49:05.058Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=15; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=4; companies=2; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=2; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=2; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_1bcc31ef75a5d4ec; proof=1bcc31ef75a5d4ec9493ef9a1c193fd64820dd54981523e66ab2e5244a68b9f5; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=8bb3c2c2a95809c3683b2a5968f3e69a4753abc249710af15afac835b7b604fc; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=18; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_1bcc31ef75a5d4ec; status=rolled_back; commitProof=1bcc31ef75a5d4ec9493ef9a1c193fd64820dd54981523e66ab2e5244a68b9f5; rollbackProof=8bb3c2c2a95809c3683b2a5968f3e69a4753abc249710af15afac835b7b604fc |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

