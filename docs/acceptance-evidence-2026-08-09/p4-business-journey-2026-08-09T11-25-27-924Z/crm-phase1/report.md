# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-09T11:25:28.058Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=16; companies=7; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=12; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=12; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_60e7d93f4cbf896c_2b42b221; proof=60e7d93f4cbf896c7ff76afcf02ef3feee1f8c991a61d4bcb029363978183eb0; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=7faf5ba85f3e9ca905dada4984970802f4771b245a6d0c8f1444a46ce776ee2e; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=41; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_60e7d93f4cbf896c_2b42b221; status=rolled_back; commitProof=60e7d93f4cbf896c7ff76afcf02ef3feee1f8c991a61d4bcb029363978183eb0; rollbackProof=7faf5ba85f3e9ca905dada4984970802f4771b245a6d0c8f1444a46ce776ee2e |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

