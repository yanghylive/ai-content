# P7 Billing Entitlement Gate

- Generated: 2026-08-23T06:59:21.591Z
- Evidence root: docs/acceptance-evidence-2026-08-23
- Database: postgres postgresql://***:***@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=20&connection_limit=12
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 6

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| CONFIG_REQUIRED | 支付回调签名密钥配置 | 未配置 KAYPAL_BILLING_WEBHOOK_SECRET、BILLING_WEBHOOK_SECRET 或 STRIPE_WEBHOOK_SECRET。 |  | 配置真实支付/Kaypal 测试或生产环境 webhook secret 后重跑 P7。 |
| CONFIG_REQUIRED | 计费审计表结构 | 当前数据库缺少：billing_webhook_events、billing_subscriptions、billing_invoices、tenant_entitlements。 | postgresql://***:***@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=20&connection_limit=12 | 对当前运行库执行最新 Prisma 迁移，并确认 billing_* 表存在。 |
| CONFIG_REQUIRED | 签名回调已处理 | 当前数据库没有 signature_verified=true 且 status=processed 的支付回调。 | postgresql://***:***@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=20&connection_limit=12 | 用真实 webhook secret 发送一条签名订阅事件，确认落库并处理为 processed。 |
| CONFIG_REQUIRED | 有效商用订阅快照 | 当前数据库没有 STANDARD 及以上、状态有效且未过期的订阅快照。 | postgresql://***:***@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=20&connection_limit=12 | 处理 customer.subscription.created/updated，生成有效 BillingSubscription。 |
| CONFIG_REQUIRED | 发票审计与失效降级 | 付费发票=0，失效/降级证据=0，生命周期事件=0。 | postgresql://***:***@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=20&connection_limit=12 | 补跑 invoice.paid 与 invoice.payment_failed 或 subscription.deleted，确认发票审计和权益降级。 |
| CONFIG_REQUIRED | 订阅与权益一致性 | 有效订阅=0，有效权益=0，缺权益=0，孤立权益=0。 | postgresql://***:***@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=20&connection_limit=12 | 重放订阅 webhook 或修复权益同步，确保权益来自计费订阅而不是本地开关。 |
| PASS | 备份中的计费数据辅助证据 | 最近 Postgres 备份包含计费表结构和计费数据。 | docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-55-56-947Z/downloaded-backup/postgres-dump.sql | 保留该证据作为恢复链路的计费数据佐证。 |

## Decision

支付、订阅回调与权益一致性仍未闭环，不能判定为生产可用。

