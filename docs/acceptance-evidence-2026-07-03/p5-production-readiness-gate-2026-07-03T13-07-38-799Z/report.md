# P5 Production Readiness Gate

- Generated: 2026-07-03T13:07:38.816Z
- Evidence root: docs/acceptance-evidence-2026-07-03
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 6

## Summary

- 可上线基础: 5
- 需生产配置: 2
- 必须真机/真账号验收: 4

## Matrix

| Status | Lane | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- | --- |
| PASS | 可上线基础 | 创作优化到发布准备业务闭环 | P4 业务旅程通过；PASS=20，FAIL=0，BLOCKED=0。 | docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-49-04-879Z/report.json | 保持 p4-business-journey-smoke 作为回归门禁。 |
| PASS | 可上线基础 | CRM 本地导入写入和回滚 | CRM Phase 1 写入、回滚、时间线、批次台账、审计记录均通过。 | docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-49-04-879Z/crm-phase1 | 继续限定为本地 CRM 写入；外部 CRM 同步另走真账号门禁。 |
| PASS | 可上线基础 | 全站用户侧商用文案与工程词泄露 | 全站扫描通过：routes=129，fail=0，console=0。 | docs/acceptance-evidence-2026-07-03/commercial-copy-browser-scan-2026-07-03T11-45-46-966Z.json | 保持 commercial-copy-browser-scan 作为发布前检查。 |
| PASS | 可上线基础 | 全站页面控制台与请求质量 | 控制台质量通过：routes=129，errors=0，warnings=0，requestFailures=0。 | docs/acceptance-evidence-2026-07-03/console-quality-browser-scan-2026-07-03T11-17-34-832Z.json | 保持 console-quality-browser-scan 作为 UI 质量回归。 |
| PASS | 可上线基础 | 商业账号身份与执行权限 | commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false. | docs/acceptance-evidence-2026-07-03/growth-commercial-live-gate-20260703111443/summary.json | 生产发布时继续使用真实商业账号重复该门禁。 |
| CONFIG_REQUIRED | 需生产配置 | 备份、恢复、对象存储与值班告警 | P6 生产配置门禁阻断 1 项：值班告警真实通道: 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | docs/acceptance-evidence-2026-07-03/p6-production-config-gate-2026-07-03T12-20-05-444Z/report.json | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 增长获客真实账号与自动任务实跑 | 增长 live gate 当前阻断：verified-growth-account: visibleAccounts=0, onlineNormalAccountCount=0. Next step: Log in or re-authorize at least one real platform account, then re-run the account health check. \| ready-auto-task: readyCount=0; a commercial live execution test needs at least one ready auto task bound to a verified account. Next step: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota. \| commercial-live-prerequisites-read-only: executionEnabled=true; schedulerDaemonEnabled=true; schedulerDaemonArmed=true; readyCount=0; onlineNormalAccountCount=0. Next step: Log in or re-authorize at least one real platform account, then re-run the account health check. \| Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota. \| database-runs: growth_acquisition_runs rows=0. | docs/acceptance-evidence-2026-07-03/growth-commercial-live-gate-20260703111443/summary.json | 登录或重新授权至少一个真实平台账号，绑定 ready 自动任务，产生 growth_acquisition_runs 后重跑 growth-commercial-live-gate。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 抖音/小红书/微信等外部平台真实发布与回读 | 当前 P4 证明了发布准备，不证明外部平台真实发布、风控通过和发布结果回读。 |  | 用测试品牌账号执行至少一次真实发布、截图/链接回读、失败恢复和证据留存；不得用页面 smoke 代替。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | Windows 桌面包与微信真机能力 | 未发现足够的 Windows 商业发布门禁和微信真机证据；模拟器/静态 smoke 不能代替。 |  | 在 Win10/Win11 真机跑 desktop/scripts/windows-commercial-release-gate.js --commercial-release，并补齐微信联系人/朋友圈/群发等真机证据。 |
| REAL_ACCEPTANCE_REQUIRED | 必须真机/真账号验收 | 第三方 CRM 生产同步 | P8 第三方 CRM 同步门禁阻断 6 项：外部 CRM 授权保护: 当前运行库没有 HubSpot/Salesforce 有效授权记录，不能做真实租户只读探针或同步。 外部 CRM 只读探针: 当前运行库没有成功的外部 CRM 只读探针；不能确认授权、网络和字段读取可用。 外部 CRM 生产写入确认: 当前没有 externalCrmWrite=true 且带人工确认/11G 证据的外部 CRM 写入审计。 外部 CRM 写入后回读与字段白名单: 外部写入=0，回读校验=0，字段白名单=0。 外部 CRM 回滚与清理: 当前没有外部 CRM 回滚、撤销或测试对象清理证据。 外部 CRM 审计链完整性: 外部写入/回读/回滚完整审计=0，带 proofHash=0。 | docs/acceptance-evidence-2026-07-03/p8-third-party-crm-sync-gate-2026-07-03T13-07-38-772Z/report.json | 在专用 HubSpot/Salesforce 测试租户保存可撤销授权，确认密钥不回显、不落明文。；使用专用测试租户运行 HubSpot/Salesforce 只读探针，读取公司/联系人/商机样本并留存审计。；在专用测试租户执行一次受控写入，必须包含人工确认、字段白名单、远端对象 ID 和 proofHash。；写入后立刻从远端 CRM 回读同一对象，校验只写允许字段，禁止把本地通过当成外部同步通过。；对测试租户写入对象执行撤销或清理，确认远端已删除/归档并留下审计。；补齐外部写入、远端回读、回滚清理三段审计，并确保每段都有 proofHash 或等价不可抵赖证据。 |
| CONFIG_REQUIRED | 需生产配置 | 支付/订阅回调与权益一致性 | P7 支付权益门禁阻断 6 项：支付回调签名密钥配置: 未配置 KAYPAL_BILLING_WEBHOOK_SECRET、BILLING_WEBHOOK_SECRET 或 STRIPE_WEBHOOK_SECRET。 计费审计表结构: 当前数据库缺少：billing_webhook_events、billing_subscriptions、billing_invoices。 签名回调已处理: 当前数据库没有 signature_verified=true 且 status=processed 的支付回调。 有效商用订阅快照: 当前数据库没有 STANDARD 及以上、状态有效且未过期的订阅快照。 发票审计与失效降级: 付费发票=0，失效/降级证据=0，生命周期事件=0。 订阅与权益一致性: 有效订阅=0，有效权益=1，缺权益=0，孤立权益=1。 | docs/acceptance-evidence-2026-07-03/p7-billing-entitlement-gate-2026-07-03T12-41-39-693Z/report.json | 配置真实支付/Kaypal 测试或生产环境 webhook secret 后重跑 P7。；对当前运行库执行最新 Prisma 迁移，并确认 billing_* 表存在。；用真实 webhook secret 发送一条签名订阅事件，确认落库并处理为 processed。；处理 customer.subscription.created/updated，生成有效 BillingSubscription。；补跑 invoice.paid 与 invoice.payment_failed 或 subscription.deleted，确认发票审计和权益降级。；重放订阅 webhook 或修复权益同步，确保权益来自计费订阅而不是本地开关。 |

## Release Decision

当前只能认定为“本地商用闭环通过”。正式生产发布仍被阻断，必须先处理 `CONFIG_REQUIRED` 与 `REAL_ACCEPTANCE_REQUIRED` 项。

