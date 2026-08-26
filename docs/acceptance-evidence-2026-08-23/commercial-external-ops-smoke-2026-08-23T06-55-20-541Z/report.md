# Commercial External Ops Smoke

- Generated at: 2026-08-23T06:55:20.541Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/data/backups/commercial-readiness/2026-08-23T06-46-59-422Z/postgres-dump.sql; size=928973 |  |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=acceptance-restore-1787468120/_smoke/2026-08-23T06-55-20-541Z-4fb4f79e.json |  |
| BLOCKED | aliyun-oss-latest-backup-readback | prefix=acceptance-restore-1787468120; 没有找到远端 manifest | 先用当前后端配置跑一轮 aliyun-oss 备份。 |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | restore-runbook-real-execution | psql=/opt/homebrew/bin/psql; restored=/Users/yanghy/Documents/New project/ai-content/data/backups/commercial-readiness/2026-08-23T06-46-59-422Z/postgres-dump.sql |  |
