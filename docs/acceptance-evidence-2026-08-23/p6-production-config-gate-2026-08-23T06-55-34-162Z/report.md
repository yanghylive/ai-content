# P6 Production Config Gate

- Generated: 2026-08-23T06:55:34.163Z
- Evidence root: docs/acceptance-evidence-2026-08-23
- External ops evidence: docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z/summary.json
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 3

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| PASS | 备份源与清单 | Postgres 备份清单存在，备份文件可读。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z/summary.json | 保持每次发布前至少一轮最新备份。 |
| CONFIG_REQUIRED | 对象存储真实写读删与远端回读 | bucket=kaypal; probe=acceptance-restore-1787468120/_smoke/2026-08-23T06-55-20-541Z-4fb4f79e.json；prefix=acceptance-restore-1787468120; 没有找到远端 manifest | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z/summary.json | 配置真实 OSS 凭据后运行 node scripts/commercial-external-ops-smoke.mjs --real --upload-latest-backup --download-backup。 |
| CONFIG_REQUIRED | 远端备份上传与下载证据 | upload=missing，readback=BLOCKED，downloadedFilesExist=false。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z/summary.json | 加 --upload-latest-backup --download-backup 重跑外部运维 smoke。 |
| PASS | 隔离恢复真实执行 | 下载后的备份已恢复到隔离库。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z/summary.json | 生产前确认恢复库不是生产库，并保留恢复输出。 |
| CONFIG_REQUIRED | 值班告警真实通道 | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z/summary.json | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | 生产配置证据新鲜度 | 最近外部运维证据距今 0.0 小时。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-20-541Z/summary.json | 发布当天重跑一次 P6。 |

## Decision

生产配置仍未闭环，不能把备份、恢复、对象存储和值班告警判定为生产可用。

