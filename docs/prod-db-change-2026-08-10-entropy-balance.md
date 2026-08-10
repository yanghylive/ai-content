# 生产数据库变更记录 · 2026-08-10

## 变更
- 主机：kaypal-prod-new（118.178.108.44）· kaypal-postgres-baota · kaypal_db
- 表：`EntropyBalance`（积分余额）
- 账号：18230326666（User.id = cmo9p6i5x000a58uckbcyv45u）
- 操作：`UPDATE "EntropyBalance" SET balance = 16037.01 WHERE "userId" = 'cmo9p6i5x000a58uckbcyv45u'`

## 原因
codex 验收测试时发现生产账号积分不足（100.00），真实发布触发积分冻结 401；
按用户要求将生产账号配置为与 test.kaypal.cn 一致（test 实测 balance=16037.01）。

## 变更前 / 后
| 项 | 变更前 | 变更后 |
|---|---|---|
| subscriptionPlan | FLAGSHIP | FLAGSHIP（未变） |
| subscriptionPeriodEnd | 2036-04-30 | 未变 |
| balance | 100.00 | **16037.01** |
| frozenBalance | 0.00 | 0.00 |

## 验证
`SELECT phone, "subscriptionPlan", balance FROM "User" u JOIN "EntropyBalance" eb ON eb."userId"=u.id WHERE phone='18230326666'`
→ `18230326666 | FLAGSHIP | 16037.01`

## 影响与回滚
- 仅该账号积分余额；无其他表变更
- 回滚：`UPDATE "EntropyBalance" SET balance = 100.00 WHERE "userId"='cmo9p6i5x000a58uckbcyv45u'`
