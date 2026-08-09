# P5 Production Readiness Gate

- Generated: 2026-08-09T11:24:59.153Z
- Evidence root: docs/acceptance-evidence-2026-08-09
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 9

## Summary

- 可上线基础: 6
- 需生产配置: 3
- 必须真机/真账号验收: 2

## Matrix

| Status | Lane | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- | --- |
| BLOCKER | 可上线基础 | 创作优化到发布准备业务闭环 | 未找到通过的 P4 业务旅程报告。 |  | 先运行 node scripts/p4-business-journey-smoke.mjs 并修复失败项。 |
| BLOCKER | 可上线基础 | CRM 本地导入写入和回滚 | 未确认 CRM 写入-回滚子验收通过。 |  | 运行 P4 或 scripts/crm-commercial-phase1-smoke.mjs --api-only --destructive --confirm-local-crm-write。 |
| PASS | 可上线基础 | 全站用户侧商用文案与工程词泄露 | 全站扫描通过：routes=173，fail=0，console=0。 | docs/acceptance-evidence-2026-08-09/commercial-copy-browser-scan-2026-08-09T11-24-55-819Z.json | 保持 commercial-copy-browser-scan 作为发布前检查。 |
| BLOCKER | 可上线基础 | 全站页面控制台与请求质量 | 未找到通过的全站控制台质量扫描。 | docs/acceptance-evidence-2026-08-09/console-quality-browser-scan-2026-08-09T11-11-44-008Z.json | 运行 node frontend/scripts/console-quality-browser-scan.mjs 并修复错误。 |
| CONFIG_REQUIRED | 可上线基础 | 商业账号身份与执行权限 | 未确认商业账号、套餐和执行权限全部有效。 |  | 使用未过期商业账号登录，确认 commercialExecutionAllowed=true 且 planMode=commercial。 |
| CONFIG_REQUIRED | 需生产配置 | 备份、恢复、对象存储与值班告警 | P6 生产配置门禁阻断 6 项：备份源与清单: 未找到最近一次可用备份清单。 对象存储真实写读删与远端回读: 当前对象存储 provider=unconfigured，real=false。 远端备份上传与下载证据: upload=missing，readback=missing，downloadedFilesExist=false。 隔离恢复真实执行: 未执行真实隔离恢复。 值班告警真实通道: 未发现真实告警发送通过证据。 生产配置证据新鲜度: 未找到外部运维证据。 | docs/acceptance-evidence-2026-08-09/p6-production-config-gate-2026-08-09T08-20-13-988Z/report.json | 先生成一轮备份，再重跑 commercial-external-ops-smoke。；配置真实 OSS 凭据后运行 node scripts/commercial-external-ops-smoke.mjs --real --upload-latest-backup --download-backup。；加 --upload-latest-backup --download-backup 重跑外部运维 smoke。；配置 COMMERCIAL_RESTORE_DATABASE_URL 指向隔离库，并用 --real --restore --download-backup 重跑。；配置真实值班群或外部告警系统 webhook 后，用 --real 重跑外部运维 smoke。；发布当天重新执行 external ops smoke 和 P6 gate。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 增长获客真实账号与自动任务实跑 | 增长 live gate 当前阻断： |  | 登录或重新授权至少一个真实平台账号，绑定 ready 自动任务，产生 growth_acquisition_runs 后重跑 growth-commercial-live-gate。 |
| PASS | 可上线基础 | 抖音/小红书/微信等外部平台真实发布与回读 | P9 外部发布回读门禁通过：8/8。 | docs/acceptance-evidence-2026-08-09/p9-external-publish-readback-gate-2026-08-09T08-20-14-180Z/report.json | 保持 P9 作为发布当天外部平台真实发布与回读门禁。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | Windows 桌面包与微信真机能力 | 未发现足够的 Windows 商业发布门禁和微信真机证据；模拟器/静态 smoke 不能代替。 |  | 在 Win10 真机跑 desktop/scripts/windows-commercial-release-gate.js --commercial-release，并补齐微信联系人/朋友圈/群发等真机证据。 |
| CONFIG_REQUIRED | 需生产配置 | 第三方 CRM 生产同步 | 本地 CRM 闭环也未确认通过。 |  | 配置专属安全保护、真实 HubSpot/Salesforce 测试租户、字段白名单、可撤销授权和回滚方案后，再做外部 CRM 写入验收。 |
| CONFIG_REQUIRED | 需生产配置 | 支付/订阅回调与权益一致性 | P7 支付权益门禁阻断 6 项：支付回调签名密钥配置: 未配置 KAYPAL_BILLING_WEBHOOK_SECRET、BILLING_WEBHOOK_SECRET 或 STRIPE_WEBHOOK_SECRET。 计费审计表结构: 当前数据库缺少：billing_webhook_events、billing_subscriptions、billing_invoices。 签名回调已处理: 当前数据库没有 signature_verified=true 且 status=processed 的支付回调。 有效商用订阅快照: 当前数据库没有 STANDARD 及以上、状态有效且未过期的订阅快照。 发票审计与失效降级: 付费发票=0，失效/降级证据=0，生命周期事件=0。 订阅与权益一致性: 有效订阅=0，有效权益=2，缺权益=0，孤立权益=2。 | docs/acceptance-evidence-2026-08-09/p7-billing-entitlement-gate-2026-08-09T08-20-14-055Z/report.json | 配置真实支付/Kaypal 测试或生产环境 webhook secret 后重跑 P7。；对当前运行库执行最新 Prisma 迁移，并确认 billing_* 表存在。；用真实 webhook secret 发送一条签名订阅事件，确认落库并处理为 processed。；处理 customer.subscription.created/updated，生成有效 BillingSubscription。；补跑 invoice.paid 与 invoice.payment_failed 或 subscription.deleted，确认发票审计和权益降级。；重放订阅 webhook 或修复权益同步，确保权益来自计费订阅而不是本地开关。 |

## Release Decision

当前只能认定为“本地商用闭环通过”。正式生产发布仍被阻断，必须先处理 `CONFIG_REQUIRED` 与 `REAL_ACCEPTANCE_REQUIRED` 项。

