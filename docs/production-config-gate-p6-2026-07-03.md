# P6 生产配置门禁

日期：2026-07-03

## 结论

备份、对象存储和恢复链路已经具备生产前验收证据，但不能判定为完整生产可用。

当前 P6 结果为 `BLOCKED_FOR_PRODUCTION`，原因只剩 1 项：没有配置并实发真实值班告警 webhook。

## 最新证据

- P6 报告：`docs/acceptance-evidence-2026-07-03/p6-production-config-gate-2026-07-03T12-20-05-444Z/report.md`
- P5 总门禁：`docs/acceptance-evidence-2026-07-03/p5-production-readiness-gate-2026-07-03T12-20-05-481Z/report.md`
- 外部运维 smoke：`docs/acceptance-evidence-2026-07-03/commercial-external-ops-smoke-2026-07-03T05-36-58-493Z/report.md`

## P6 矩阵

| 状态 | 门禁项 | 当前判断 | 下一步 |
| --- | --- | --- | --- |
| PASS | 备份源与清单 | Postgres 备份清单存在，备份文件可读。 | 发布前保持最新备份。 |
| PASS | 对象存储真实写读删与远端回读 | 阿里云 OSS 探针写入、读回、删除和远端 manifest 回读通过。 | 保留 bucket、prefix、manifest、备份 key。 |
| PASS | 远端备份上传与下载证据 | 最新备份已上传 OSS，并下载回证据目录。 | 保留 downloaded-backup 证据。 |
| PASS | 隔离恢复真实执行 | 下载后的备份已恢复到隔离库。 | 生产前确认恢复库不是生产库。 |
| CONFIG_REQUIRED | 值班告警真实通道 | 未配置 `COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL`。 | 配置企业微信/飞书/Slack 或外部告警系统 webhook 后重跑。 |
| PASS | 生产配置证据新鲜度 | 外部运维证据为当天证据。 | 发布当天重跑一次 P6。 |

## 可重复命令

```bash
node scripts/p6-production-config-gate.mjs
node scripts/p6-production-config-gate.mjs --strict
```

严格模式会在仍有生产配置阻断时返回非 0，适合接入发布流水线。

## 防误判规则

`scripts/commercial-external-ops-smoke.mjs` 已补充 webhook 目标识别。使用 `--real` 时，如果告警地址指向本机地址，会被判定为阻断，不能用本机 mock webhook 代替真实值班告警。

## 下一步

配置真实值班告警 webhook 后执行：

```bash
node scripts/commercial-external-ops-smoke.mjs --real --upload-latest-backup --download-backup --restore
node scripts/p6-production-config-gate.mjs --strict
node scripts/p5-production-readiness-gate.mjs --strict
```

只有 P6 变为 `PASS` 后，P5 里的“备份、恢复、对象存储与值班告警”才可以从 `CONFIG_REQUIRED` 转为 `PASS`。
