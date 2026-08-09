# P6 Production Config Gate

- Generated: 2026-08-08T14:26:45.091Z
- Evidence root: docs/acceptance-evidence-2026-08-08
- External ops evidence: -
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 6

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| CONFIG_REQUIRED | 备份源与清单 | 未找到最近一次可用备份清单。 |  | 先生成一轮备份，再重跑 commercial-external-ops-smoke。 |
| CONFIG_REQUIRED | 对象存储真实写读删与远端回读 | 当前对象存储 provider=unconfigured，real=false。 |  | 配置真实 OSS 凭据后运行 node scripts/commercial-external-ops-smoke.mjs --real --upload-latest-backup --download-backup。 |
| CONFIG_REQUIRED | 远端备份上传与下载证据 | upload=missing，readback=missing，downloadedFilesExist=false。 |  | 加 --upload-latest-backup --download-backup 重跑外部运维 smoke。 |
| CONFIG_REQUIRED | 隔离恢复真实执行 | 未执行真实隔离恢复。 |  | 配置 COMMERCIAL_RESTORE_DATABASE_URL 指向隔离库，并用 --real --restore --download-backup 重跑。 |
| CONFIG_REQUIRED | 值班告警真实通道 | 未发现真实告警发送通过证据。 |  | 配置真实值班群或外部告警系统 webhook 后，用 --real 重跑外部运维 smoke。 |
| CONFIG_REQUIRED | 生产配置证据新鲜度 | 未找到外部运维证据。 |  | 发布当天重新执行 external ops smoke 和 P6 gate。 |

## Decision

生产配置仍未闭环，不能把备份、恢复、对象存储和值班告警判定为生产可用。

