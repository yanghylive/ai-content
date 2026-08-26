# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-23T03:36:22.442Z
- Frontend: http://127.0.0.1:3015
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=38; companies=15; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=12; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=12; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_08b9fcf7bf213ca3_0697e8bc; proof=08b9fcf7bf213ca3ad7ff3aaaaab62b7a241867fa12ee8049d83c2d0d8d67cb3; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=b5de41c2817be60ea023dfd8066b965080dc961f10fbfdeb1ca20dcfc41fa8b9; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=88; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_08b9fcf7bf213ca3_0697e8bc; status=rolled_back; commitProof=08b9fcf7bf213ca3ad7ff3aaaaab62b7a241867fa12ee8049d83c2d0d8d67cb3; rollbackProof=b5de41c2817be60ea023dfd8066b965080dc961f10fbfdeb1ca20dcfc41fa8b9 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

