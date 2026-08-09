# P9 External Publish Readback Gate

- Generated: 2026-07-08T21:57:32.958Z
- Evidence root: docs/acceptance-evidence-2026-07-08
- Database: sqlite backend/prisma/ai-content-dev.db
- Status: **BLOCKED_FOR_PRODUCTION**
- Release blocking items: 6

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| PASS | 发布准备闭环 | 已确认待发布记录可创建；当前待发布/已排期记录 4 条。此项只证明发布准备，不证明外部平台已发布。 | docs/acceptance-evidence-2026-07-08/p4-business-journey-current-authenticated-final/report.json | 继续把发布准备和真实外部发布分开验收。 |
| PASS | 发布复盘记录 | 复盘指标可记录；当前复盘记录 4 条。此项不代替平台真实链接、截图或回读。 | docs/acceptance-evidence-2026-07-08/p4-business-journey-current-authenticated-final/report.json | 复盘指标继续作为业务结果记录，不作为真实发布证据。 |
| CONFIG_REQUIRED | 真实平台账号可用 | 当前运行库没有可用发布账号；不能执行抖音/小红书/微信等外部平台真实发布。 | backend/prisma/ai-content-dev.db | 登录或绑定至少一个品牌测试账号，确认账号在线、可发布、可回读。 |
| REAL_ACCEPTANCE_REQUIRED | 外部平台真实发布成功 | 当前没有外部平台成功发布记录；发布准备和复盘数据不能证明内容已经发到平台。 | backend/prisma/ai-content-dev.db | 用品牌测试账号完成至少一次真实发布，记录平台、账号、发布时间、远端对象 ID 或公开链接。 |
| REAL_ACCEPTANCE_REQUIRED | 发布结果回读 | 当前没有平台回读、公开链接、远端对象 ID 或同一内容的结果确认。 | backend/prisma/ai-content-dev.db | 发布后从平台回读同一内容，确认标题/正文/素材匹配，并记录公开链接或远端对象 ID。 |
| REAL_ACCEPTANCE_REQUIRED | 发布页面截图证据 | 当前没有发布成功页面、作品页或平台后台截图证据。 | backend/prisma/ai-content-dev.db | 发布成功后保存作品页或平台后台截图，截图必须能对应平台、账号和内容。 |
| REAL_ACCEPTANCE_REQUIRED | 平台审核结果与失败恢复 | 平台审核/风控通过证据=0，失败恢复证据=0。 | backend/prisma/ai-content-dev.db | 补一次正常发布审核通过证据，并演练失败后的重试、撤回或人工接管流程。 |
| REAL_ACCEPTANCE_REQUIRED | 外部发布审计链完整性 | 可关联外部发布证据=0；缺少可互相对应的发布、回读和证据附件。 | backend/prisma/ai-content-dev.db | 补齐一次从内容版本、发布账号、平台结果、回读、截图到复盘指标的完整链路。 |

## Decision

外部平台发布当前只能认定为发布准备和复盘记录可用，不能认定为真实平台发布与回读闭环完成。

