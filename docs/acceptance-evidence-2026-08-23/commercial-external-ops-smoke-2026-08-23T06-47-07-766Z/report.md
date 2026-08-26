# Commercial External Ops Smoke

- Generated at: 2026-08-23T06:47:07.766Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/data/backups/commercial-readiness/2026-08-23T06-46-59-422Z/postgres-dump.sql; size=928973 |  |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=acceptance-backup-1787467627/_smoke/2026-08-23T06-47-07-766Z-45cf4f1d.json |  |
| PASS | aliyun-oss-upload-latest-backup | bucket=kaypal; manifest=acceptance-backup-1787467627/2026-08-23T06-46-59-422Z/manifest.json; backup=acceptance-backup-1787467627/2026-08-23T06-46-59-422Z/postgres-dump.sql |  |
| PASS | aliyun-oss-latest-backup-readback | manifest=acceptance-backup-1787467627/2026-08-23T06-46-59-422Z/manifest.json; backup=acceptance-backup-1787467627/2026-08-23T06-46-59-422Z/postgres-dump.sql |  |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| WARN | restore-runbook-dry-check | restore target=file:/tmp/backup-drill/restore-ops.sqlite; backup=/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/downloaded-backup/postgres-dump.sql | 未启用 --restore，本次只确认恢复输入齐备；干净机器验收时加 --restore。 |
