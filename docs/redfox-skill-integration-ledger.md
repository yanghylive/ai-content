# RedFox Skill 产品化接入总表

更新日期：2026-07-02

这份表是 3010 后续开发 RedFox Skills 的硬约束。后续开发不按聊天记忆推进，只按本文件、逐功能明细表 `docs/redfox-skill-integration-matrix.md`、`scripts/redfox-skill-integration-guard.mjs` 和后端 guard spec 推进。

## 固定口径

| 项目                          | 数量 | 说明                                                                |
| ----------------------------- | ---: | ------------------------------------------------------------------- |
| 方案包总数                    |   15 | 5 个核心方案包 + 10 个 RedFox Skill 方案池包                        |
| 方案包功能位                  |   64 | 方案包内引用的 RedFox API / SkillHub 功能位总数                     |
| 去重功能名                    |   57 | 面向产品方案的去重功能名                                            |
| RedFox API 功能位             |   43 | 走 `REDFOX_API_KEY + RedFox API endpoint`                           |
| SkillHub / Agent Skill 功能位 |   21 | 走 `agent-s` 的 `redfox.skillhub.run` 执行通道                      |
| API 后端闭环验收              |   43 | 43 个 API 功能位均已有归一化、业务对象入库和单测证据                |
| SkillHub 逐功能验收           |   21 | 21 个 SkillHub / Agent Skill 功能位均已有归一化、入库或正式产物证据 |
| 待逐功能验收 SkillHub         |    0 | 15 个方案包内已无未验收的 SkillHub 功能位                           |
| 官方 SkillHub 候选 Skill      |   22 | mapping 中记录的 RedFox community SkillHub repo 候选                |
| 当前未映射功能位              |    0 | 允许为 0；新增方案或功能时必须同步更新本表与 guard                  |
| 当前 contract-only 功能位     |    0 | 方案包里不能引用只写合同、不具备 API 或 SkillHub 执行通道的能力     |

## 15 个方案包接入状态

| 方案包            | 类型   | 功能位 | RedFox API | SkillHub / Agent Skill | 当前产品化状态     | 下一步                                                    |
| ----------------- | ------ | -----: | ---------: | ---------------------: | ------------------ | --------------------------------------------------------- |
| 热点选题解决方案  | 核心   |      5 |          4 |                      1 | 5/5 功能位闭环已接 | 继续补定时日报、监控配置和前端业务化结果页                |
| 竞品账号雷达      | 核心   |      5 |          5 |                      0 | API 闭环已接       | 继续补自动跟踪、异常识别、周报和选题建议                  |
| 评论获客解决方案  | 核心   |      3 |          3 |                      0 | API 闭环已接       | 继续补人工确认到 CRM 线索和跟进任务                       |
| 创作增强解决方案  | 核心   |      5 |          2 |                      3 | 5/5 功能位闭环已接 | 继续补确认入库后的发布草稿联动                            |
| 发布合规解决方案  | 核心   |      4 |          0 |                      4 | 4/4 功能位闭环已接 | 继续补高风险阻断发布和正式风险证据表                      |
| 行业情报包        | 方案池 |      3 |          3 |                      0 | API 闭环已接       | 前端开放“生成行业情报”，后续补自动日报和监控配置          |
| 出海内容情报包    | 方案池 |      4 |          3 |                      1 | 4/4 功能位闭环已接 | 继续补本地化选题报告和出海脚本结构页                      |
| 低粉爆款挖掘包    | 方案池 |      4 |          3 |                      1 | 4/4 功能位闭环已接 | 继续补复刻选题报告和评论需求拆解                          |
| 达人/KOL 筛选包   | 方案池 |      5 |          5 |                      0 | API 闭环已接       | 后续补达人评分维度、CRM 跟进任务和投放风险报告            |
| 爆款拆解包        | 方案池 |      4 |          3 |                      1 | 4/4 功能位闭环已接 | 继续补结构拆解报告、评论确认和复刻素材关联                |
| 私域素材提取包    | 方案池 |      4 |          3 |                      1 | 4/4 功能位闭环已接 | 知识条目和证据附件先写 `solution_artifacts`，后续再拆专表 |
| AIGC 素材工厂     | 方案池 |      5 |          4 |                      1 | 5/5 功能位闭环已接 | 继续补视频提示词确认入库、素材任务状态联动                |
| 多平台文案适配包  | 方案池 |      5 |          0 |                      5 | 5/5 功能位闭环已接 | 继续补文案批量对比、发布前检查和确认入库                  |
| 账号体检包        | 方案池 |      4 |          4 |                      0 | API 闭环已接       | 继续补 30 天计划报告、自动监控配置                        |
| 舆情/品牌词监控包 | 方案池 |      4 |          1 |                      3 | 4/4 功能位闭环已接 | 继续补监控配置、日报、风险确认和正式证据链                |

## 每个功能算“接完”的标准

一个功能位不能只因为 mapping 存在就算接完。必须同时满足：

| 项      | 标准                                                                            |
| ------- | ------------------------------------------------------------------------------- |
| mapping | `skillCode / interfaceNo 或 skillHubRef / inputContract / outputObjects` 都明确 |
| runner  | RedFox API 走 RedFox Client；SkillHub 走 `agent-s` 的 `redfox.skillhub.run`     |
| 安全    | API Key 不进前端；真实执行默认关闭；高成本和高风险必须确认                      |
| 日志    | 写 `RedfoxCallLog` 或 `SolutionRun` 相关账本，保留耗时、成本、状态、错误        |
| 成本    | 能预估、能扣减或记录、能被 CostGuard 阻断                                       |
| 归一化  | 输出不能只停留在 JSON；必须转成 3010 业务对象                                   |
| 前端    | `/solutions` 只展示方案、配置、运行和报告，不展示底层调试按钮                   |
| 验收    | 有单测、guard 或 smoke，能证明输入到输出链路                                    |

## 开发顺序

| 阶段             | 内容                                             | 验收                                                                                       |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 0. 护栏          | 本总表、guard 脚本、后端 guard spec              | `node scripts/redfox-skill-integration-guard.mjs` 通过                                     |
| 1. 核心 API 闭环 | 先跑 43 个 RedFox API 功能位中的核心包路径       | RedFox Client 调用、日志、成本、结果账本通过                                               |
| 2. SkillHub 通道 | 补 `agent-s` 的 `redfox.skillhub.run` 分支       | SkillHub 技能可发现、安装、执行、产出 artifact                                             |
| 3. 结果归一化    | 按方案包写 normalizer                            | 写入 `IntelligenceItem / Material / Topic / CommentInsight / ComplianceCheck / GrowthLead` |
| 4. 方案运行报告  | `SolutionRun` 汇总输入、成本、产物、风险、下一步 | 每次运行可生成可读报告                                                                     |
| 5. 前端收口      | `/solutions` 只做业务入口、配置和报告            | 用户不需要理解 RedFox API / SkillHub 细节                                                  |

## 已落地的后端闭环

| 日期       | 范围                  | 结果                                                                                          | 验收                                                                                                                                                                                                                                                                                               |
| ---------- | --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-02 | SkillHub 真实执行入口 | `RedfoxSkillRunnerService` 已把无 RedFox API path、但有 `skillHubRefs` 的能力分流到 `agent-s` | `全网热搜/聚合热点` 可解析到官方 `trending-hub`，下发 `redfox.skillhub.run`，产出 agent session、events、artifact summary                                                                                                                                                                          |
| 2026-07-02 | 方案任务 blocked 回写 | SkillHub preflight blocked/failed 不再被 `/solutions` 写成 succeeded，也不会扣真实执行点数    | blocked 写回 `solutionTask.outputJson`，任务停在 `approval_required`，原因码为 `redfox_skillhub_blocked`                                                                                                                                                                                           |
| 2026-07-02 | SkillHub mapping 反查 | `findRedfoxSkillMapping()` 已支持按 `skillHubRefs.skillCode / skillNo / skillName` 查回映射   | `trending-hub` 执行结果可以回到 `contract-web-hot-search` 的 `outputObjects` 归一化计划                                                                                                                                                                                                            |
| 2026-07-02 | 官方 SkillHub 安装器  | `agent-s` 已支持发现安装根目录、从本地官方镜像复制、从 RedFox 官方 GitHub sparse clone 安装   | 只允许官方 `redfox-data/redfox-community/tree/.../skills/<skillCode>`；安装后继续原 preflight、执行和 artifact 输出                                                                                                                                                                                |
| 2026-07-02 | SkillHub 输出归一化   | `/solutions` 已能从 SkillHub artifact 抽取业务对象草稿并写入 `SolutionResult`                 | 热点输出可转 `IntelligenceItem / Topic / Material` 草稿；违禁词输出可转 `ComplianceCheck` 草稿                                                                                                                                                                                                     |
| 2026-07-02 | SkillHub 业务表写入   | `/solutions` 已在同一事务里把可落库对象写入真实业务表，并把 `refId` 回填到 `SolutionResult`   | `IntelligenceItem / ComplianceCheck / CommentInsight / GrowthLead` 可自动写入业务表                                                                                                                                                                                                                |
| 2026-07-02 | SkillHub 自动写入     | SkillHub 输出的 `Material / Topic / Article` 已在执行时直接保存为业务草稿                     | `Material` 写入素材库，`Topic` 写入选题库并优先关联同批素材，`Article` 写入文章草稿；确认接口保留为历史草稿/人工补写通道                                                                                                                                                                           |
| 2026-07-02 | 发布计划产物          | `PublishRecord` 不再伪造真实发布记录，改写入 `solution_artifacts`                             | 因真实 `publish_records` 需要 `articleId + accountId`，RedFox 输出缺账号上下文时只生成 `publish_record_draft` 产物，等待用户选择账号后再发布                                                                                                                                                       |
| 2026-07-02 | P02 竞品账号 API 闭环 | `P02-01 ~ P02-05` 五个平台账号搜索结果已写入 `benchmark_accounts`，并同步生成 `growth_leads`  | 参数化单测覆盖抖音、小红书、公众号、B 站、TikTok；断言 `BenchmarkAccount / GrowthLead / RedfoxCallLog` 全部回填                                                                                                                                                                                    |
| 2026-07-02 | P03 评论获客 API 闭环 | `P03-01 ~ P03-03` 三个平台评论结果已写入 `comment_insights`，并同步生成 `growth_leads`        | 参数化单测覆盖抖音、小红书、B 站；断言评论洞察、线索、来源评论 ID、回复建议和调用日志全部回填                                                                                                                                                                                                      |
| 2026-07-02 | P06 行业情报 API 闭环 | `P06-01 ~ P06-03` 行业信息源结果已写入 `intelligence_items` 和 `intelligence_reports`         | 参数化单测覆盖文旅、短剧、A 股新闻；断言情报条目、行业报告、证据链接和 RedFox 调用日志全部回填                                                                                                                                                                                                     |
| 2026-07-02 | 扩展方案 API 闭环批次 | `P06-03 / P07-01 ~ P07-03 / P08-01 ~ P08-03 / P09-01 ~ P09-03` 已写入对应业务表               | 参数化单测覆盖行业情报、出海账号/情报、低粉爆款、达人候选；断言 `IntelligenceItem / IntelligenceReport / Material / Topic / BenchmarkAccount / GrowthLead / RedfoxCallLog` 回填                                                                                                                    |
| 2026-07-02 | 剩余 API 闭环批次     | `P09-04 ~ P09-05 / P10-02 ~ P10-04 / P11-02 ~ P11-04 / P12-01 ~ P12-02` 已写入对应业务表      | 参数化单测覆盖达人账号、爆款详情、私域素材、AIGC 素材；断言 `BenchmarkAccount / GrowthLead / IntelligenceItem / Material / RuntimeExecution / RedfoxCallLog` 回填                                                                                                                                  |
| 2026-07-02 | 本轮 API 闭环批次     | `P04-04 ~ P04-05 / P12-03 / P12-05 / P14-01 ~ P14-04 / P15-02` 已写入对应业务表               | 参数化单测覆盖创作增强素材、AIGC 视频/封面、账号体检、舆情 WebSearch；断言 `Material / RuntimeExecution / BenchmarkAccount / GrowthAccountHealth / IntelligenceItem / IntelligenceReport / RedfoxCallLog` 回填                                                                                     |
| 2026-07-02 | 首批 SkillHub 功能位  | `P01-01 / P04-01 ~ P04-03 / P05-01 ~ P05-04 / P07-04 / P08-04` 已归一化并写入可落库对象       | 参数化单测覆盖热点、创作、合规、出海热点、低粉增长榜；断言 `IntelligenceItem / Material / Topic / Article / ComplianceCheck / BenchmarkAccount / GrowthLead / AgentConfirmation` 入库，`RiskEvidence / GrowthReport / PublishRecord` 写入 `solution_artifacts`                                     |
| 2026-07-02 | 最终 SkillHub 批次    | `P10-01 / P11-01 / P12-04 / P13-01 ~ P13-05 / P15-01 / P15-03 / P15-04` 已完成逐功能验收      | 参数化单测覆盖爆款评论、私域 OCR、视频提示词、多平台改写、标题评分、品牌热点和品牌评论；断言 `CommentInsight / GrowthLead / AgentConfirmation / IntelligenceItem / Material / Topic / Article` 入库，`KnowledgeItem / EvidenceAttachment / GrowthReport / PublishRecord` 写入 `solution_artifacts` |
| 2026-07-02 | 产物证据正式落库      | `RiskEvidence / KnowledgeItem / EvidenceAttachment / GrowthReport` 不再跳过持久化             | 统一写入 `solution_artifacts`，保留 `kind / uri / label / preview / objectRef / metadata / createdBy`，避免停留在不可查询的草稿 JSON                                                                                                                                                               |
| 2026-07-02 | RedFox live smoke     | 使用本地 `REDFOX_API_KEY` 跑通抖音搜索 + 评论链路                                             | `REDFOX_COMMENT_SMOKE_ALLOW_LIVE=true REDFOX_COMMENT_SMOKE_PLATFORM=douyin REDFOX_COMMENT_SMOKE_KEYWORD=咖啡 REDFOX_COMMENT_SMOKE_LIMIT=1`；搜索 received=3/created=3，评论 received=1/normalized=1/created=1，并生成 `callLogId`                                                                  |

## SkillHub 安装策略

| 项       | 规则                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 自动安装 | `REDFOX_SKILLHUB_AUTO_INSTALL` 默认开启；设为 `0 / false / off / disabled` 时只检查本机目录                        |
| 安装目录 | 默认 `skillhub-skills/<skillCode>`；可用 `REDFOX_SKILLHUB_INSTALL_ROOT` 或 `AI_CONTENT_SKILLHUB_INSTALL_ROOT` 改写 |
| 本地镜像 | 可用 `REDFOX_SKILLHUB_OFFICIAL_SOURCE_ROOT` 指向已拉取的 `redfox-community/skills`，优先从这里复制                 |
| 远程安装 | 只允许 `github.com/redfox-data/redfox-community/tree/<branch>/skills/<skillCode>`，用 git sparse checkout 安装     |
| 执行前置 | 安装完成不等于执行成功；仍要检查 `SKILL.md / scripts`、`REDFOX_API_KEY`、超时和输出 artifact                       |
| 审计     | 自动安装事件写入 Agent-S events，安装目录写 `.kaypal-redfox-skillhub-install.json`                                 |

## RedFox 输出归一化策略

| 类别      | 输入来源                             | 输出位置                                                                          | 当前状态                                                                                                                                                                     |
| --------- | ------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 热点/榜单 | `payloadSample.output.items/results` | `intelligence_items / materials / topics` + `SolutionResult`                      | `IntelligenceItem / Material / Topic` 已写入业务表，选题优先关联同批素材                                                                                                     |
| 合规检测  | `payloadSample.output.findings`      | `compliance_checks / agent_confirmations / solution_artifacts` + `SolutionResult` | `ComplianceCheck / AgentConfirmation` 已写入业务表，`RiskEvidence` 写入 `solution_artifacts`                                                                                 |
| 评论获客  | `payloadSample.output.comments`      | `comment_insights / growth_leads / agent_confirmations` + `SolutionResult`        | `CommentInsight / GrowthLead / AgentConfirmation` 已写入业务表并建立关联                                                                                                     |
| 账号搜索  | `payloadSample.data.list/items`      | `benchmark_accounts / growth_leads` + `SolutionResult`                            | `BenchmarkAccount / GrowthLead` 已写入业务表并建立关联                                                                                                                       |
| 账号体检  | `payloadSample.data.list/items`      | `benchmark_accounts / growth_account_health` + `SolutionResult`                   | `BenchmarkAccount / GrowthAccountHealth` 已写入业务表，保留账号健康评分、风险状态和建议                                                                                      |
| AIGC 素材 | `payloadSample.data.list/items`      | `materials / runtime_executions` + `SolutionResult`                               | `Material / RuntimeExecution` 已写入业务表，保留任务 ID、素材地址、执行状态和成本证据                                                                                        |
| 创作改写  | `payloadSample.output.items/results` | `articles / materials / solution_artifacts` + `SolutionResult`                    | `Article / Material` 已自动保存为可编辑草稿，`PublishRecord` 写入 `publish_record_draft` 产物                                                                                |
| 增长榜单  | `payloadSample.output.items/results` | `benchmark_accounts / growth_leads / solution_artifacts` + `SolutionResult`       | `BenchmarkAccount / GrowthLead` 已写入业务表，`GrowthReport` 写入 `solution_artifacts`                                                                                       |
| 素材提取  | `payloadSample.output.items/results` | `materials / solution_artifacts` + `SolutionResult`                               | `Material` 已自动写入素材库，`KnowledgeItem / EvidenceAttachment` 写入 `solution_artifacts`                                                                                  |
| 确认写入  | 历史归一化草稿                       | `materials / topics / articles` + `SolutionResult`                                | 确认接口保留为补写通道；新执行链路默认已自动写入，不再依赖前端“确认入库”                                                                                                     |
| 文案创作  | `payloadSample.output` 或单对象      | `articles / materials / solution_artifacts` + `SolutionResult`                    | 生成 `Article` 编辑草稿、`Material` 素材和 `publish_record_draft` 发布计划产物                                                                                               |
| 写表边界  | 方案运行结果账本                     | 有租户/用户边界的自动写；缺账号/发布上下文的写产物                                | 已补 `IntelligenceItem / Material / Topic / Article / ComplianceCheck / CommentInsight / GrowthLead / AgentConfirmation` 自动写；证据/报告/发布计划类写 `solution_artifacts` |

## 必跑命令

```bash
node scripts/redfox-skill-integration-guard.mjs
cd backend && npm test -- --runInBand --runTestsByPath src/modules/solutions/redfox-skill-integration.guard.spec.ts
cd backend && npm test -- --runInBand --runTestsByPath src/modules/redfox/redfox-skill-runner.service.spec.ts src/modules/solutions/solutions.service.spec.ts src/modules/local-engine/agent-s.service.spec.ts
cd backend && npm run build
cd backend && npx tsc --noEmit
```

后续如果方案包、功能位、mapping 数量发生变化，必须先更新本文件和 guard 里的期望值，否则视为跑偏。
