# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-08T19:41:54.785Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=6; companies=5; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=4; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=4; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_cde0b20ff3e48904; proof=cde0b20ff3e489041f15f19ced5ae87b9fee1495a4b6eecdf6a62f341ce1a696; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=65c4c4cd95011df06f7a7302a8bd6a056eb40a3a4f61306a0e28b7b21747bf1a; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=24; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_cde0b20ff3e48904; status=rolled_back; commitProof=cde0b20ff3e489041f15f19ced5ae87b9fee1495a4b6eecdf6a62f341ce1a696; rollbackProof=65c4c4cd95011df06f7a7302a8bd6a056eb40a3a4f61306a0e28b7b21747bf1a |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

