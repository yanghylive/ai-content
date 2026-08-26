# Commercial External Ops Smoke

- Generated at: 2026-08-23T06:46:39.926Z
- Real external writes: no
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-46-39-926Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| BLOCKED | latest-local-backup | 没有找到 manifest：- | 先生成一轮本地备份，再跑外部运维 smoke。 |
| BLOCKED | object-store-provider | 未配置对象存储 provider。 | 配置 COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER=aliyun-oss 和 OSS 凭据，或配置 COMMERCIAL_BACKUP_OBJECT_STORE_DIR 做本地镜像验收。 |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| BLOCKED | restore-backup-file | 没有可用于恢复演练的本地或下载备份文件。 | 先生成本地备份，或用 --real --download-backup 从 OSS 下载远端备份。 |
