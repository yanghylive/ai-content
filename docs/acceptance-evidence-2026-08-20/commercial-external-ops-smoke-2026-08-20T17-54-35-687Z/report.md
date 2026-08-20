# Commercial External Ops Smoke

- Generated at: 2026-08-20T17:54:35.687Z
- Real external writes: no
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-20/commercial-external-ops-smoke-2026-08-20T17-54-35-687Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T05-39-56-761Z/postgres-dump.sql; size=2454800 |  |
| BLOCKED | object-store-provider | 未配置对象存储 provider。 | 配置 COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER=aliyun-oss 和 OSS 凭据，或配置 COMMERCIAL_BACKUP_OBJECT_STORE_DIR 做本地镜像验收。 |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| BLOCKED | restore-target-config | 未配置 COMMERCIAL_RESTORE_DATABASE_URL。 | 在干净机器或隔离库上配置一个独立恢复库，不能指向生产库。 |
