# Commercial External Ops Smoke

- Generated at: 2026-07-03T05:36:58.493Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/commercial-external-ops-smoke-2026-07-03T05-36-58-493Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T00-28-59-777Z/postgres-dump.sql; size=2454800 |  |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=commercial-readiness-backups/_smoke/2026-07-03T05-36-58-493Z-966bfc59.json |  |
| PASS | aliyun-oss-upload-latest-backup | bucket=kaypal; manifest=commercial-readiness-backups/2026-07-03T00-28-59-777Z/manifest.json; backup=commercial-readiness-backups/2026-07-03T00-28-59-777Z/postgres-dump.sql |  |
| PASS | aliyun-oss-latest-backup-readback | manifest=commercial-readiness-backups/2026-07-03T00-28-59-777Z/manifest.json; backup=commercial-readiness-backups/2026-07-03T00-28-59-777Z/postgres-dump.sql |  |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | restore-runbook-real-execution | psql=/Users/yanghy/Documents/New project/ai-content/backend/scripts/psql-docker-wrapper.sh; restored=/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/commercial-external-ops-smoke-2026-07-03T05-36-58-493Z/downloaded-backup/postgres-dump.sql |  |
