# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-08T15:41:37.090Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=14; companies=5; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=12; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=12; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_936186105bce59f8_ad100a42; proof=936186105bce59f8fac6ff20e39abd7347a1351121291de62017e461b3b32c81; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=adfb0739b54dc2609ee8e997092205994f3b4039454a8e5b2844265470ce1e54; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=33; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_936186105bce59f8_ad100a42; status=rolled_back; commitProof=936186105bce59f8fac6ff20e39abd7347a1351121291de62017e461b3b32c81; rollbackProof=adfb0739b54dc2609ee8e997092205994f3b4039454a8e5b2844265470ce1e54 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

