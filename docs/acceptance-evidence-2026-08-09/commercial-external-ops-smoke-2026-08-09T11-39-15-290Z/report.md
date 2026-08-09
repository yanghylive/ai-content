# Commercial External Ops Smoke

- Generated at: 2026-08-09T11:39:15.290Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-local-sqlite; file=/Users/yanghy/Documents/New project/ai-content/data/backups/commercial-readiness/2026-08-09T11-36-14-725Z/kaypal-ai.sqlite; size=111972352 |  |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=commercial-readiness-backups/_smoke/2026-08-09T11-39-15-290Z-88495871.json |  |
| PASS | aliyun-oss-upload-latest-backup | bucket=kaypal; manifest=commercial-readiness-backups/2026-08-09T11-36-14-725Z/manifest.json; backup=commercial-readiness-backups/2026-08-09T11-36-14-725Z/kaypal-ai.sqlite |  |
| PASS | aliyun-oss-latest-backup-readback | manifest=commercial-readiness-backups/2026-08-09T11-36-14-725Z/manifest.json; backup=commercial-readiness-backups/2026-08-09T11-36-14-725Z/kaypal-ai.sqlite |  |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | restore-runbook-real-execution | sqlite-restore; backup=/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/downloaded-backup/kaypal-ai.sqlite -> /tmp/ai-content-restore-isolated.db |  |
