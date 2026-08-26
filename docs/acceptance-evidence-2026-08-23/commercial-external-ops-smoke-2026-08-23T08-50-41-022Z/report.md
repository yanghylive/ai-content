# Commercial External Ops Smoke

- Generated at: 2026-08-23T08:50:41.022Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T08-50-41-022Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/data/backups/commercial-readiness/2026-08-23T06-46-59-422Z/postgres-dump.sql; size=928973 |  |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=recheck-1787475040/_smoke/2026-08-23T08-50-41-022Z-725d8378.json |  |
| PASS | aliyun-oss-upload-latest-backup | bucket=kaypal; manifest=recheck-1787475040/2026-08-23T06-46-59-422Z/manifest.json; backup=recheck-1787475040/2026-08-23T06-46-59-422Z/postgres-dump.sql |  |
| PASS | aliyun-oss-latest-backup-readback | manifest=recheck-1787475040/2026-08-23T06-46-59-422Z/manifest.json; backup=recheck-1787475040/2026-08-23T06-46-59-422Z/postgres-dump.sql |  |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | restore-runbook-real-execution | psql=/opt/homebrew/bin/psql; restored=/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T08-50-41-022Z/downloaded-backup/postgres-dump.sql |  |
