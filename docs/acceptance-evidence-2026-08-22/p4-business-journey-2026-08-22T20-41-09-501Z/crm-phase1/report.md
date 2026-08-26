# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-22T20:41:09.764Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=34; companies=11; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=12; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=12; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_f433c78557d36ec6_9dc5e30c; proof=f433c78557d36ec6e8e1b686ec1dd7d114054adea21adebe3807879a078ea894; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=37273c08e394f629b22c99c68d3ea572556fab4ae331f16ca730b5c850863d3c; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=72; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_f433c78557d36ec6_9dc5e30c; status=rolled_back; commitProof=f433c78557d36ec6e8e1b686ec1dd7d114054adea21adebe3807879a078ea894; rollbackProof=37273c08e394f629b22c99c68d3ea572556fab4ae331f16ca730b5c850863d3c |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

