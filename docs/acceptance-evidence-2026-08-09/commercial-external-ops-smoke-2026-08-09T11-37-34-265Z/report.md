# Commercial External Ops Smoke

- Generated at: 2026-08-09T11:37:34.265Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-37-34-265Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T05-39-56-761Z/postgres-dump.sql; size=2454800 |  |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=commercial-readiness-backups/_smoke/2026-08-09T11-37-34-265Z-da68c4a3.json |  |
| PASS | aliyun-oss-latest-backup-readback | manifest=commercial-readiness-backups/2026-07-03T05-39-56-761Z/manifest.json; backup=commercial-readiness-backups/2026-07-03T05-39-56-761Z/postgres-dump.sql |  |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| FAIL | restore-runbook-real-execution | spawnSync psql ENOENT | 确认目标库为空且为隔离库；必要时先重建恢复库再执行。 |
