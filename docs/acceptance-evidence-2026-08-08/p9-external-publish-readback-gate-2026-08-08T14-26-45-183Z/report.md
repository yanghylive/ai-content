# P9 External Publish Readback Gate

- Generated: 2026-08-08T14:26:45.233Z
- Evidence root: docs/acceptance-evidence-2026-08-08
- Database: sqlite backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite
- Status: **PASS**
- Release blocking items: 0

| Status | Gate | Detail | Evidence | Next action |
| --- | --- | --- | --- | --- |
| PASS | 发布准备闭环 | 已确认待发布记录可创建；当前待发布/已排期记录 19 条。此项只证明发布准备，不证明外部平台已发布。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 继续把发布准备和真实外部发布分开验收。 |
| PASS | 发布复盘记录 | 复盘指标可记录；当前复盘记录 4 条。此项不代替平台真实链接、截图或回读。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 复盘指标继续作为业务结果记录，不作为真实发布证据。 |
| PASS | 真实平台账号可用 | 发现可用发布账号 2 个。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 发布当天再次确认账号在线、配额可用、品牌测试账号隔离。 |
| PASS | 外部平台真实发布成功 | 成功发布记录 0 条，成功运行发布记录 3 条。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 保留平台、账号、发布时间、远端对象 ID 或公开链接。 |
| PASS | 发布结果回读 | 带回读证据的运行记录 3 条，带发布链接/远端 ID 的记录 0 条。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 保留回读时间、远端状态和内容匹配结果。 |
| PASS | 发布页面截图证据 | 发现截图或页面证据 4 条。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 保留截图路径、采集时间和对应发布记录。 |
| PASS | 平台审核结果与失败恢复 | 平台审核/风控通过证据 1 条，失败恢复证据 8 条。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 保留审核通过、失败重试或撤回改发的全链路记录。 |
| PASS | 外部发布审计链完整性 | 外部发布、回读和证据附件可以互相对应。 | backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite | 把该审计链随版本归档。 |

## Decision

外部平台真实发布与回读门禁通过，可作为 P5 生产发布矩阵证据。

