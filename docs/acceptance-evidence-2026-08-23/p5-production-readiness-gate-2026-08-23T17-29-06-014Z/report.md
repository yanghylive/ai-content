# P5 Production Readiness Gate

- Generated: 2026-08-23T17:29:06.038Z
- Evidence root: docs/acceptance-evidence-2026-08-23
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 5

## Summary

- 可上线基础: 6
- 需生产配置: 3
- 必须真机/真账号验收: 2

## Matrix

| Status | Lane | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- | --- |
| PASS | 可上线基础 | 创作优化到发布准备业务闭环 | P4 业务旅程通过；PASS=20，FAIL=0，BLOCKED=0。 | docs/acceptance-evidence-2026-08-23/p4-business-journey-2026-08-23T08-50-40-351Z/report.json | 保持 p4-business-journey-smoke 作为回归门禁。 |
| PASS | 可上线基础 | CRM 本地导入写入和回滚 | CRM Phase 1 写入、回滚、时间线、批次台账、审计记录均通过。 | docs/acceptance-evidence-2026-08-23/p4-business-journey-2026-08-23T08-50-40-351Z/crm-phase1 | 继续限定为本地 CRM 写入；外部 CRM 同步另走真账号门禁。 |
| PASS | 可上线基础 | 全站用户侧商用文案与工程词泄露 | 全站扫描通过：routes=124，fail=0，console=0。 | docs/acceptance-evidence-2026-08-23/commercial-copy-browser-scan-2026-08-23T08-43-00-045Z.json | 保持 commercial-copy-browser-scan 作为发布前检查。 |
| PASS | 可上线基础 | 全站页面控制台与请求质量 | 控制台质量通过：routes=151，errors=0，warnings=0，requestFailures=0。 | docs/acceptance-evidence-2026-08-23/console-quality-browser-scan-2026-08-23T08-50-30-402Z.json | 保持 console-quality-browser-scan 作为 UI 质量回归。 |
| PASS | 可上线基础 | 商业账号身份与执行权限 | commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false. | docs/acceptance-evidence-2026-08-23/growth-commercial-live-gate-20260823092532/summary.json | 生产发布时继续使用真实商业账号重复该门禁。 |
| CONFIG_REQUIRED | 需生产配置 | 备份、恢复、对象存储与值班告警 | P6 生产配置门禁阻断 1 项：值班告警真实通道: 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | docs/acceptance-evidence-2026-08-23/p6-production-config-gate-2026-08-23T08-50-49-905Z/report.json | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| PASS | 可上线基础 | 增长获客真实账号与自动任务实跑 | 增长 live gate 已通过。 | docs/acceptance-evidence-2026-08-23/growth-commercial-live-gate-20260823092532/summary.json | 生产前保留最近一次真账号实跑证据。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 抖音/小红书/微信等外部平台真实发布与回读 | 当前 P4 证明了发布准备，不证明外部平台真实发布、风控通过和发布结果回读。 |  | 用测试品牌账号执行至少一次真实发布、截图/链接回读、失败恢复和证据留存；不得用页面 smoke 代替。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | Windows 桌面包与微信真机能力 | 未发现足够的 Windows 商业发布门禁和微信真机证据；模拟器/静态 smoke 不能代替。 |  | 在 Win10 真机跑 desktop/scripts/windows-commercial-release-gate.js --commercial-release，并补齐微信联系人/朋友圈/群发等真机证据。 |
| CONFIG_REQUIRED | 需生产配置 | 第三方 CRM 生产同步 | 本地 CRM 写入回滚已通过；第三方 CRM 当前只证明连接方案和只读边界，不证明生产写入同步。 | docs/acceptance-evidence-2026-08-23/p4-business-journey-2026-08-23T08-50-40-351Z/crm-phase1 | 配置专属安全保护、真实 HubSpot/Salesforce 测试租户、字段白名单、可撤销授权和回滚方案后，再做外部 CRM 写入验收。 |
| CONFIG_REQUIRED | 需生产配置 | 支付/订阅回调与权益一致性 | P7 支付权益门禁阻断 5 项：支付回调签名密钥配置: 未配置 KAYPAL_BILLING_WEBHOOK_SECRET、BILLING_WEBHOOK_SECRET 或 STRIPE_WEBHOOK_SECRET。 签名回调已处理: 当前数据库没有 signature_verified=true 且 status=processed 的支付回调。 有效商用订阅快照: 当前数据库没有 STANDARD 及以上、状态有效且未过期的订阅快照。 发票审计与失效降级: 付费发票=0，失效/降级证据=0，生命周期事件=0。 订阅与权益一致性: 有效订阅=0，有效权益=1，缺权益=0，孤立权益=1。 | docs/acceptance-evidence-2026-08-23/p7-billing-entitlement-gate-2026-08-23T08-50-49-949Z/report.json | 配置真实支付/Kaypal 测试或生产环境 webhook secret 后重跑 P7。；用真实 webhook secret 发送一条签名订阅事件，确认落库并处理为 processed。；处理 customer.subscription.created/updated，生成有效 BillingSubscription。；补跑 invoice.paid 与 invoice.payment_failed 或 subscription.deleted，确认发票审计和权益降级。；重放订阅 webhook 或修复权益同步，确保权益来自计费订阅而不是本地开关。 |

## Release Decision

当前只能认定为“本地商用闭环通过”。正式生产发布仍被阻断，必须先处理 `CONFIG_REQUIRED` 与 `REAL_ACCEPTANCE_REQUIRED` 项。

