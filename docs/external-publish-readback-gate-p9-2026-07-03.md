# P9 外部平台真实发布与回读门禁

日期：2026-07-03

## 结论

外部平台发布当前不能认定为生产可用。

已确认的部分是：内容通过复核后可以生成待发布记录，发布后的业务复盘指标可以记录。

尚未完成的商用条件是：真实平台账号可用、真实发布成功、发布结果回读、发布页面截图、平台审核结果、失败恢复和完整审计链。

## 可重复检查命令

```bash
node scripts/p9-external-publish-readback-gate.mjs
```

严格发布门禁模式：

```bash
node scripts/p9-external-publish-readback-gate.mjs --strict
```

`--strict` 会在真实发布与回读证据不足时返回非 0，用于发布前阻断。

## 当前最新证据

- P9 报告：`docs/acceptance-evidence-2026-07-03/p9-external-publish-readback-gate-2026-07-03T14-42-25-474Z/report.md`
- P5 总门禁：`docs/acceptance-evidence-2026-07-03/p5-production-readiness-gate-2026-07-03T14-42-25-610Z/report.md`
- P4 业务旅程：`docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-49-04-879Z/report.md`
- 当前运行库：`backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite`

## 商用验收口径

| 状态 | 验收项 | 当前判断 | 下一步 |
| --- | --- | --- | --- |
| PASS | 发布准备闭环 | 已确认待发布记录可创建，当前待发布/已排期记录 10 条。 | 继续把发布准备和真实发布分开验收。 |
| PASS | 发布复盘记录 | 复盘指标可记录，当前复盘记录 4 条。 | 复盘指标只作为业务结果记录，不作为真实发布证据。 |
| CONFIG_REQUIRED | 真实平台账号可用 | 当前没有可用发布账号。 | 登录或绑定至少一个品牌测试账号，确认账号在线、可发布、可回读。 |
| REAL_ACCEPTANCE_REQUIRED | 外部平台真实发布成功 | 当前没有外部平台成功发布记录。 | 用品牌测试账号完成至少一次真实发布，记录平台、账号、发布时间和远端对象。 |
| REAL_ACCEPTANCE_REQUIRED | 发布结果回读 | 当前没有平台回读、公开链接、远端对象 ID 或同一内容结果确认。 | 发布后从平台回读同一内容，确认标题、正文和素材匹配。 |
| REAL_ACCEPTANCE_REQUIRED | 发布页面截图证据 | 当前没有发布成功页面、作品页或平台后台截图。 | 保存作品页或平台后台截图，截图必须能对应平台、账号和内容。 |
| REAL_ACCEPTANCE_REQUIRED | 平台审核结果与失败恢复 | 当前审核/风控通过证据为 0，失败恢复证据为 0。 | 补一次正常发布审核通过证据，并演练失败后的重试、撤回或人工接管。 |
| REAL_ACCEPTANCE_REQUIRED | 外部发布审计链完整性 | 当前没有可互相对应的发布、回读和证据附件。 | 补齐从内容版本、发布账号、平台结果、回读、截图到复盘指标的完整链路。 |

## 发布判定

外部平台当前只能认定为“可进入发布准备”和“可记录复盘”，不能对外宣称已经完成抖音、小红书、微信等平台的真实发布闭环。

只有当 P9 全部转为 `PASS`，P5 总门禁里的“外部平台真实发布与回读”才可以解除阻断。
