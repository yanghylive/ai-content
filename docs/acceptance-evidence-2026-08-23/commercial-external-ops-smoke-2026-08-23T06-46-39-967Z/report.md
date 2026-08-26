# Commercial External Ops Smoke

- Generated at: 2026-08-23T06:46:39.967Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-46-39-967Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| BLOCKED | latest-local-backup | 没有找到 manifest：- | 先生成一轮本地备份，再跑外部运维 smoke。 |
| PASS | aliyun-oss-write-read-delete | bucket=kaypal; probe=acceptance-backup-1787467599/_smoke/2026-08-23T06-46-39-967Z-6bb67f7a.json |  |
| BLOCKED | aliyun-oss-upload-latest-backup | 没有可上传的本地备份。 | 先生成一轮本地备份，再使用 --upload-latest-backup。 |
| BLOCKED | aliyun-oss-latest-backup-readback | prefix=acceptance-backup-1787467599; 没有找到远端 manifest | 先用当前后端配置跑一轮 aliyun-oss 备份。 |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| BLOCKED | restore-backup-file | 没有可用于恢复演练的本地或下载备份文件。 | 先生成本地备份，或用 --real --download-backup 从 OSS 下载远端备份。 |
