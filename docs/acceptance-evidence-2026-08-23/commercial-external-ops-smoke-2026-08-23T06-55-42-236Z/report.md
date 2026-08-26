# Commercial External Ops Smoke

- Generated at: 2026-08-23T06:55:42.236Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-42-236Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/data/backups/commercial-readiness/2026-08-23T06-46-59-422Z/postgres-dump.sql; size=928973 |  |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=acceptance-full-1787468142/_smoke/2026-08-23T06-55-42-236Z-53764209.json |  |
| PASS | aliyun-oss-upload-latest-backup | bucket=kaypal; manifest=acceptance-full-1787468142/2026-08-23T06-46-59-422Z/manifest.json; backup=acceptance-full-1787468142/2026-08-23T06-46-59-422Z/postgres-dump.sql |  |
| PASS | aliyun-oss-latest-backup-readback | manifest=acceptance-full-1787468142/2026-08-23T06-46-59-422Z/manifest.json; backup=acceptance-full-1787468142/2026-08-23T06-46-59-422Z/postgres-dump.sql |  |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| FAIL | restore-runbook-real-execution | psql:/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-42-236Z/downloaded-backup/postgres-dump.sql:44: ERROR:  type "AgentConfirmationStatus" already exists<br> | 确认目标库为空且为隔离库；必要时先重建恢复库再执行。 |
