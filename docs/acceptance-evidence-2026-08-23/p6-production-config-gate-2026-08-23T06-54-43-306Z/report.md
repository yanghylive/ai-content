# P6 Production Config Gate

- Generated: 2026-08-23T06:54:43.309Z
- Evidence root: docs/acceptance-evidence-2026-08-23
- External ops evidence: docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/summary.json
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 2

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| PASS | 备份源与清单 | Postgres 备份清单存在，备份文件可读。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/summary.json | 保持每次发布前至少一轮最新备份。 |
| PASS | 对象存储真实写读删与远端回读 | 阿里云 OSS 探针写入、读回、删除和最近备份远端回读均通过。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/summary.json | 保留 OSS bucket、prefix、manifest、备份 key 作为生产发布证据。 |
| PASS | 远端备份上传与下载证据 | 最新备份已上传到 OSS，并下载回证据目录。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/summary.json | 保留 downloaded-backup/manifest.json 和备份文件用于恢复验收。 |
| CONFIG_REQUIRED | 隔离恢复真实执行 | 未执行真实隔离恢复。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/summary.json | 配置 COMMERCIAL_RESTORE_DATABASE_URL 指向隔离库，并用 --real --restore --download-backup 重跑。 |
| CONFIG_REQUIRED | 值班告警真实通道 | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/summary.json | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | 生产配置证据新鲜度 | 最近外部运维证据距今 0.1 小时。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-47-07-766Z/summary.json | 发布当天重跑一次 P6。 |

## Decision

生产配置仍未闭环，不能把备份、恢复、对象存储和值班告警判定为生产可用。

