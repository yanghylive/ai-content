# Commercial External Ops Smoke

- Generated at: 2026-07-03T05:07:37.265Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/commercial-external-ops-smoke-2026-07-03T05-07-37-265Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T00-28-59-777Z/postgres-dump.sql; size=2454800 |  |
| PASS | object-store-local-mirror | mirrorDir=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-object-store-mirror/2026-07-03T00-28-59-777Z; files=2 |  |
| PASS | alert-webhook-real-probe | provider=generic; HTTP 204 |  |
| PASS | restore-runbook-real-execution | psql=/Users/yanghy/Documents/New project/ai-content/backend/scripts/psql-docker-wrapper.sh; restored=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T00-28-59-777Z/postgres-dump.sql |  |
