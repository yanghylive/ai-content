# P7 支付订阅与权益一致性门禁

日期：2026-07-03

## 结论

当前支付、订阅回调与权益一致性不能判定为生产可用。

代码层已经具备签名回调、幂等处理、订阅快照、发票审计、支付失败降级和租户权益同步能力；但当前运行库和验收证据还没有闭环。P7 结果为 `BLOCKED_FOR_PRODUCTION`。

## 最新证据

- P7 报告：`docs/acceptance-evidence-2026-07-03/p7-billing-entitlement-gate-2026-07-03T12-41-39-693Z/report.md`
- P5 总门禁：`docs/acceptance-evidence-2026-07-03/p5-production-readiness-gate-2026-07-03T12-41-39-738Z/report.md`
- 计费数据辅助证据：`docs/acceptance-evidence-2026-07-03/commercial-external-ops-smoke-2026-07-03T05-36-58-493Z/downloaded-backup/postgres-dump.sql`

## P7 矩阵

| 状态 | 门禁项 | 当前判断 | 下一步 |
| --- | --- | --- | --- |
| CONFIG_REQUIRED | 支付回调签名密钥配置 | 未配置 `KAYPAL_BILLING_WEBHOOK_SECRET`、`BILLING_WEBHOOK_SECRET` 或 `STRIPE_WEBHOOK_SECRET`。 | 配置真实测试或生产 webhook secret。 |
| CONFIG_REQUIRED | 计费审计表结构 | 当前默认 SQLite 运行库缺少 `billing_webhook_events`、`billing_subscriptions`、`billing_invoices`。 | 对当前运行库执行最新迁移，确认计费表存在。 |
| CONFIG_REQUIRED | 签名回调已处理 | 没有 `signature_verified=true` 且 `status=processed` 的支付回调。 | 发送一条真实签名订阅事件并确认落库。 |
| CONFIG_REQUIRED | 有效商用订阅快照 | 没有 STANDARD 及以上、状态有效且未过期的订阅快照。 | 处理 `customer.subscription.created/updated`。 |
| CONFIG_REQUIRED | 发票审计与失效降级 | 付费发票、失败/取消/过期降级和生命周期事件均为 0。 | 补跑 `invoice.paid` 与 `invoice.payment_failed` 或 `subscription.deleted`。 |
| CONFIG_REQUIRED | 订阅与权益一致性 | 当前有一个有效权益，但没有对应计费订阅，属于孤立权益。 | 重放订阅 webhook 或修复权益同步，确保权益来自计费订阅。 |
| PASS | 备份中的计费数据辅助证据 | 最近 Postgres 备份包含计费表结构和计费数据。 | 只作为恢复链路佐证，不能代替当前运行库门禁。 |

## 可重复命令

```bash
node scripts/p7-billing-entitlement-gate.mjs
node scripts/p7-billing-entitlement-gate.mjs --strict
```

指定 SQLite 运行库：

```bash
node scripts/p7-billing-entitlement-gate.mjs --database backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite
```

严格模式会在支付权益仍有生产阻断时返回非 0，适合接入发布流水线。

## 通过标准

P7 必须同时满足：

- 当前运行库包含 webhook、订阅、发票和租户权益四类表。
- 至少一条真实签名回调已处理为 `processed`。
- 至少一条 STANDARD 及以上有效订阅快照。
- 至少一条付费发票审计。
- 至少一条失败、取消或过期降级证据。
- 有效订阅和有效权益通过 `externalSubscriptionId` 一致关联。

满足以上条件后，P5 里的“支付/订阅回调与权益一致性”才可以从 `CONFIG_REQUIRED` 转为 `PASS`。
