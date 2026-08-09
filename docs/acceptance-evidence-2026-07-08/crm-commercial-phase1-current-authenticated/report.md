# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-08T20:53:42.679Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=8; companies=7; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=4; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=4; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_4000bac45d924da2; proof=4000bac45d924da2b289cf204cca09d75eb5553ab997be5446e51b1a9469e8f9; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=3364d6ffac9dabc5c878bb7df9ecbf76f0984325c17faa00e8de91e62db57db6; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=32; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_4000bac45d924da2; status=rolled_back; commitProof=4000bac45d924da2b289cf204cca09d75eb5553ab997be5446e51b1a9469e8f9; rollbackProof=3364d6ffac9dabc5c878bb7df9ecbf76f0984325c17faa00e8de91e62db57db6 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

