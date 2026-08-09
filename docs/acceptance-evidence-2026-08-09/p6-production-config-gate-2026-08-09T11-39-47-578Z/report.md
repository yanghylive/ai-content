# P6 Production Config Gate

- Generated: 2026-08-09T11:39:47.579Z
- Evidence root: docs/acceptance-evidence-2026-08-09
- External ops evidence: docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/summary.json
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 1

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| PASS | 备份源与清单 | 本地 备份清单存在，备份文件可读。 | docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/summary.json | 保持每次发布前至少一轮最新备份。 |
| PASS | 对象存储真实写读删与远端回读 | 阿里云 OSS 探针写入、读回、删除和最近备份远端回读均通过。 | docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/summary.json | 保留 OSS bucket、prefix、manifest、备份 key 作为生产发布证据。 |
| PASS | 远端备份上传与下载证据 | 最新备份已上传到 OSS，并下载回证据目录。 | docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/summary.json | 保留 downloaded-backup/manifest.json 和备份文件用于恢复验收。 |
| PASS | 隔离恢复真实执行 | 下载后的备份已恢复到隔离库。 | docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/summary.json | 生产前确认恢复库不是生产库，并保留恢复输出。 |
| CONFIG_REQUIRED | 值班告警真实通道 | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/summary.json | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | 生产配置证据新鲜度 | 最近外部运维证据距今 0.0 小时。 | docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-39-15-290Z/summary.json | 发布当天重跑一次 P6。 |

## Decision

生产配置仍未闭环，不能把备份、恢复、对象存储和值班告警判定为生产可用。

