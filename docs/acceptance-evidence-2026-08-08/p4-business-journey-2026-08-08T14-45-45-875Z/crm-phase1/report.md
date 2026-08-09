# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-08T14:45:46.038Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=12; companies=3; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=12; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=12; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_8bfd3615551e5f90_26a4140d; proof=8bfd3615551e5f90aa17c957a453a31ff7c08c56c5387ab59b2fb12f2d705a60; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=ccce5a95e56eaff68ddb857bd24f0d1ebf7be6eb527eea289f09a37db490cc94; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=25; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_8bfd3615551e5f90_26a4140d; status=rolled_back; commitProof=8bfd3615551e5f90aa17c957a453a31ff7c08c56c5387ab59b2fb12f2d705a60; rollbackProof=ccce5a95e56eaff68ddb857bd24f0d1ebf7be6eb527eea289f09a37db490cc94 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

