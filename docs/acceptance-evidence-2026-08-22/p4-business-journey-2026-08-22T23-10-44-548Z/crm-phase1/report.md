# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-22T23:10:44.881Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=36; companies=13; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=12; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=12; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_a5795bfd28e18962_2de5a9ac; proof=a5795bfd28e189622a18249be53baa009690529fd6ccd9760f511c25d849a1bc; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=79e2da5a6b24618d1e2f2aee3c82c61079bc19dffb9edf9237907b915fd4c656; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=80; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_a5795bfd28e18962_2de5a9ac; status=rolled_back; commitProof=a5795bfd28e189622a18249be53baa009690529fd6ccd9760f511c25d849a1bc; rollbackProof=79e2da5a6b24618d1e2f2aee3c82c61079bc19dffb9edf9237907b915fd4c656 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

