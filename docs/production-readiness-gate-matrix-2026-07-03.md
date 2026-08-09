# P5 生产前门禁矩阵

日期：2026-07-03

## 结论

当前系统只能认定为“本地商用闭环通过”，不能认定为“可正式生产发布”。

本地可上线基础已经打通：创作优化闭环、CRM 本地写入回滚、全站商用文案、全站控制台质量、商业账号权限都已有通过证据。

正式生产发布仍被 6 项阻断：备份告警、增长真账号实跑、外部平台真实发布回读、Windows 桌面包与微信真机、第三方 CRM 生产同步、支付/订阅回调与权益一致性。

## 可重复检查命令

```bash
node scripts/p5-production-readiness-gate.mjs
```

严格发布门禁模式：

```bash
node scripts/p5-production-readiness-gate.mjs --strict
```

`--strict` 会在存在生产阻断项时返回非 0，用于发布流水线。

## 当前最新证据

- P9 外部发布回读门禁：`docs/acceptance-evidence-2026-07-03/p9-external-publish-readback-gate-2026-07-03T14-42-25-474Z/report.md`
- P8 第三方 CRM 同步门禁：`docs/acceptance-evidence-2026-07-03/p8-third-party-crm-sync-gate-2026-07-03T13-09-14-746Z/report.md`
- P6 生产配置门禁：`docs/acceptance-evidence-2026-07-03/p6-production-config-gate-2026-07-03T12-20-05-444Z/report.md`
- P7 支付权益门禁：`docs/acceptance-evidence-2026-07-03/p7-billing-entitlement-gate-2026-07-03T12-41-39-693Z/report.md`
- 最新 P5 总门禁：`docs/acceptance-evidence-2026-07-03/p5-production-readiness-gate-2026-07-03T14-42-25-610Z/report.md`
- P4 业务旅程：`docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-49-04-879Z/report.md`
- 全站商用文案扫描：`docs/acceptance-evidence-2026-07-03/commercial-copy-browser-scan-2026-07-03T11-45-46-966Z.md`
- 全站控制台质量扫描：`docs/acceptance-evidence-2026-07-03/console-quality-browser-scan-2026-07-03T11-17-34-832Z.json`
- 增长 live gate：`docs/acceptance-evidence-2026-07-03/growth-commercial-live-gate-20260703111443/report.md`
- 外部运营 smoke：`docs/acceptance-evidence-2026-07-03/commercial-external-ops-smoke-2026-07-03T05-36-58-493Z/report.md`

## 门禁矩阵

| 状态 | 分类 | 门禁项 | 当前判断 | 下一步 |
| --- | --- | --- | --- | --- |
| PASS | 可上线基础 | 创作优化到发布准备业务闭环 | P4 业务旅程 20/20 通过。 | 保持 `p4-business-journey-smoke` 作为回归门禁。 |
| PASS | 可上线基础 | CRM 本地导入写入和回滚 | CRM Phase 1 写入、回滚、时间线、批次台账、审计记录通过。 | 继续限定为本地 CRM 写入；外部 CRM 另走生产同步门禁。 |
| PASS | 可上线基础 | 全站用户侧商用文案与工程词泄露 | 129/129 页面通过，0 控制台异常。 | 保持全站商用文案浏览器扫描。 |
| PASS | 可上线基础 | 全站页面控制台与请求质量 | 129/129 页面通过，0 errors/warnings/request failures。 | 保持控制台质量扫描。 |
| PASS | 可上线基础 | 商业账号身份与执行权限 | commercialExecutionAllowed=true，planMode=commercial。 | 生产前用真实商业账号重跑。 |
| CONFIG_REQUIRED | 需生产配置 | 备份、恢复、对象存储与值班告警 | P6 显示 Postgres 备份、OSS 写读删、远端上传下载、隔离恢复均通过；仍缺真实值班告警 webhook。 | 配置 `COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL` 后重跑外部运营 smoke、P6 和 P5。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 增长获客真实账号与自动任务实跑 | 无在线正常真实平台账号，ready 自动任务为 0，growth runs 为 0。 | 登录真实平台账号，绑定 ready 自动任务，产生实跑记录后重跑增长 live gate。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 抖音/小红书/微信等外部平台真实发布与回读 | P9 已拆出独立门禁：发布准备和复盘记录通过，但缺可用真实平台账号、真实发布成功记录、平台回读、发布页面截图、审核结果、失败恢复和完整审计链。 | 用品牌测试账号完成至少一次真实发布，保存公开链接或远端对象 ID、回读结果、截图、审核结果和失败恢复证据后重跑 P9 与 P5。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | Windows 桌面包与微信真机能力 | 未发现足够的 Windows 商业发布门禁和微信真机证据。 | 在 Win10 真机跑 Windows 商业发布门禁并补齐微信真机证据。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 第三方 CRM 生产同步 | P8 已拆出独立门禁：本地 CRM 边界和连接合同通过，但缺真实测试租户授权、只读探针、外部写入、写入后回读、字段白名单、外部回滚清理和完整审计链。 | 在专用 HubSpot/Salesforce 测试租户完成授权、只读探针、受控写入、远端回读和回滚清理后重跑 P8 与 P5。 |
| CONFIG_REQUIRED | 需生产配置 | 支付/订阅回调与权益一致性 | P7 显示当前运行库缺计费表、缺 webhook secret、缺签名回调、缺有效订阅、缺发票审计和失效降级；备份里有计费数据只能作为辅助证据。 | 执行运行库迁移，配置真实 webhook secret，补跑订阅、发票和失败/取消事件后重跑 P7 和 P5。 |

## 发布判定

可以继续做内部演示和本地商用闭环验收。

不能执行正式生产发布，直到所有 `CONFIG_REQUIRED` 和 `REAL_ACCEPTANCE_REQUIRED` 项都转为 `PASS`。
