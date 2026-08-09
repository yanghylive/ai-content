# AI员工增长获客增强开发文档

更新时间：2026-06-24

## 背景

本文基于 3010 当前系统代码与炼刀 AI 员工 1.8.5 解包资源对比，整理 3010 可以借鉴炼刀的增长获客能力，并转化为可落地的开发方案。

结论先写清楚：

- 3010 不缺底层执行能力。现有代码已经有本地 Runtime、真实浏览器执行、发布前检查、证据截图、回读确认、CRM 沉淀、风险确认等能力。
- 3010 当前缺的是增长获客产品线的包装：任务模板、曝光矩阵、线索池、账号健康、复盘报表、营销 SOP。
- 炼刀值得借鉴的不是 UI，而是营销执行能力拆分方式：曝光、私信、加好友、朋友圈营销、工作流、记录统计。
- 3010 不建议变成“猛跑自动化工具”，而是把炼刀的增长玩法接入 3010 自己的风控、证据、确认、CRM 闭环。
- CRM 系统由其他线程并行开发，本文档中的 CRM 只作为最终集成目标，不在增长获客主线中重复实现 CRM 页面、客户模型和时间线。

## 当前代码依据

### 3010 已具备的基础

| 能力 | 代码位置 | 当前价值 |
|---|---|---|
| 自动获客配置、调度、去重、每日上限、CRM capture | `backend/src/modules/ai-employee/ai-employee.service.ts` | 已具备自动获客闭环骨架 |
| 抖音 link/search/hot/targeted/retention lead API | `backend/src/modules/ai-employee/ai-employee.controller.ts` | 底层已接近曝光矩阵能力 |
| 真实浏览器互动执行器 | `backend/src/modules/local-engine/platform-interaction-executor.service.ts` | 支持抖音/视频号评论和私信真实读取、填入、发送、回读、截图 |
| 发布 preflight 与风险确认 | `backend/src/modules/auto-upload/auto-upload.service.ts` | 支持账号、素材、平台能力、风险确认检查 |
| CRM 沉淀 | `backend/src/modules/crm/crm.service.ts` | 可把自动获客线索进入客户档案和时间线 |
| 工作台与证据 | `frontend/src/app/(dashboard)/confirmations`、`execution-records`、`artifacts` | 已有确认、记录、证据承载入口 |

### 炼刀可借鉴的能力

| 能力 | 炼刀资源证据 | 可借鉴点 |
|---|---|---|
| 曝光矩阵 | `/auto/exposure/*`、`/auto/targeted_exposure/*`、`/auto/link_exposure/*`、`/auto/account-search-exposure/*`、`/auto/retention-exposure/*` | 把获客拆成多个清晰玩法 |
| 私信线索 | `/private_message/contacts`、`/private_message/contact/leads`、`/private_message/send_message` | 把私信会话升级成线索池 |
| 自动加好友 | `/auto/add_friend/*`、`/automation/friend_conf` | 微信增长任务可借鉴，但必须加风控 |
| 朋友圈营销 | `/auto/we-chat-moment-campaigns/*`、`/auto/we_chat/post/*` | 做朋友圈营销计划、记录、AI 文案 |
| 工作流 | `/workflow/video_clip_config`、`/workflow/video_publish_config`、`/workflow/auto_exposure_config`、`/workflow/auto_add_friend_config` | 做增长 SOP 编排 |
| 曝光记录 | `/auto/exposure-record/pages`、`/auto/exposure/psg/record/list` | 做获客证据中心和曝光统计 |

## 产品目标

把 3010 从“自动获客单页 + 客户互动散点功能”升级为：

```text
增长获客 OS
  -> 获客策略中心
  -> 自动获客矩阵
  -> 线索池
  -> 线索跟进
  -> 账号健康
  -> 证据中心
  -> 增长复盘
  -> 营销 SOP 工作流
```

用户最终应该能完成一句话目标：

```text
每天帮我找 30 个装修客户，评论触达，私信跟进，沉淀到 CRM，并给我复盘今天哪些话术有效。
```

## 一期：自动获客 2.0

### 目标

把当前 `/apps/auto-acquisition` 从单页配置升级为“获客矩阵”。

### 页面结构

建议仍保留当前入口：

```text
/apps/auto-acquisition
```

页面拆成 5 个 tab：

| Tab | 说明 | 对应底层能力 |
|---|---|---|
| 关键词获客 | 输入行业关键词，搜索爆款视频/评论区，筛选潜在线索 | `douyin-hot-video-exposure` |
| 视频链接获客 | 输入一个或多个视频链接，抓该视频评论区线索 | `douyin-link-exposure` |
| 目标账号获客 | 输入竞品/达人账号，采集目标账号内容和评论区 | `douyin-targeted-exposure` / `douyin-search-account-exposure` |
| 留资线索获客 | 围绕留资来源、手机号/微信号/表单线索做二次跟进 | `douyin-retention-exposure` |
| 统计复盘 | 展示曝光、评论、私信、线索沉淀、有效回复漏斗 | 新增统计聚合 |

### 配置模型

建议把当前 `AutoAcquisitionConfig` 扩展为统一增长任务模型。

```ts
type GrowthAcquisitionMode =
  | 'keyword'
  | 'video-link'
  | 'target-account'
  | 'retention'
  | 'manual-import';

interface GrowthAcquisitionConfig {
  id: string;
  mode: GrowthAcquisitionMode;
  taskName: string;
  platform: 'douyin' | 'wechat-channel' | 'kuaishou' | 'xiaohongshu';
  accountId: string;
  sourceInputs: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  blacklistNicknames: string[];
  commentTemplates: string[];
  privateMessageTemplates: string[];
  dailyLimit: number;
  perTargetLimit: number;
  deduplicate: boolean;
  scheduleEnabled: boolean;
  beginTime: string;
  riskMode: 'auto' | 'confirm-first' | 'draft-only';
  status: 'enabled' | 'disabled' | 'running';
}
```

### 后端建议

新增或演进模块：

```text
backend/src/modules/growth-acquisition/
  growth-acquisition.controller.ts
  growth-acquisition.service.ts
  growth-acquisition.types.ts
  growth-acquisition-store.service.ts
  growth-lead-scoring.service.ts
  growth-dedupe.service.ts
  growth-statistics.service.ts
```

短期可以继续复用 `ai-employee.service.ts`，但不要继续把所有逻辑塞进一个 3000+ 行 service。建议先抽：

- lead source adapter：来源采集。
- lead scoring：线索评分。
- follow-up planner：跟进计划。
- executor：执行动作。
- CRM integration adapter：仅预留最终集成适配器，不在当前阶段实现 CRM。
- statistics：统计聚合。

### 验收标准

- 每个 tab 至少能创建、编辑、启停、执行任务。
- 每条任务必须有执行记录、失败原因、证据截图。
- 成功执行后必须进入线索池；CRM 接入放到最终集成阶段。
- 达到每日上限后不能继续执行。
- 同一用户/主页/评论/视频不能重复骚扰。

## 二期：统一线索池

### 目标

把自动获客、评论、私信、企微、微信任务产生的潜在客户统一沉淀到“线索池”。线索池只做增长漏斗资产，不重复开发 CRM 系统。

### 页面入口

新增：

```text
/leads
```

或放在客户互动分组下：

```text
客户互动
  -> 线索池
```

### 线索字段

```ts
interface GrowthLead {
  id: string;
  platform: 'douyin' | 'wechat-channel' | 'wechat' | 'wecom' | 'xiaohongshu' | 'kuaishou';
  sourceType:
    | 'auto-acquisition'
    | 'comment'
    | 'direct-message'
    | 'wechat-group'
    | 'wechat-moments'
    | 'manual-import';
  sourceTaskId?: string;
  sourceRecordId?: string;
  crmCustomerId?: string;
  nickname: string;
  profileUrl?: string;
  avatarUrl?: string;
  externalUserId?: string;
  sourceText: string;
  sourceUrl?: string;
  videoTitle?: string;
  videoUrl?: string;
  commentTime?: string;
  matchedKeywords: string[];
  score: number;
  scoreReasons: string[];
  status:
    | 'new'
    | 'contacted'
    | 'replied'
    | 'qualified'
    | 'converted'
    | 'ignored'
    | 'blocked';
  nextFollowUpAt?: string;
  ownerUserId?: string;
  evidenceUrls: string[];
  createdAt: string;
  updatedAt: string;
}
```

### 核心功能

| 功能 | 说明 |
|---|---|
| 线索列表 | 按平台、来源、评分、状态、创建时间筛选 |
| 线索详情 | 展示来源视频、评论原文、回复内容、证据截图、后续 CRM 关联字段 |
| 跟进计划 | 设置下次跟进时间、方式、话术 |
| 去重画像 | 根据昵称、主页、external id、视频、文本指纹去重 |
| 风险标记 | 疑似同行、负面情绪、敏感词、已骚扰过 |

### 和 CRM 的关系

线索池不是替代 CRM，而是 CRM 前置漏斗。当前阶段只提供关联字段与事件出口，等 CRM 线程完成后再做最终集成：

```text
候选评论/私信
  -> GrowthLead
  -> 评分和去重
  -> 人工确认或自动跟进
  -> CRM 集成适配器
  -> CRM Customer / Timeline
```

### 验收标准

- 自动获客成功记录能生成线索。
- 抖音私信读取到的人能生成线索。
- 线索保留 `crmCustomerId`、来源记录、证据地址等集成字段。
- 不在本阶段实现线索转 CRM、CRM 详情和 CRM 时间线。

## 三期：获客策略中心

### 目标

解决“用户不会配置复杂参数”的问题，让用户选行业模板即可跑任务。

### 页面入口

```text
/growth-strategies
```

或并入现有：

```text
/strategies
```

### 行业模板

第一批建议内置：

| 行业 | 关键词方向 | 排除词方向 | 话术方向 |
|---|---|---|---|
| 装修 | 装修、旧房翻新、全屋定制、设计师、本地装修 | 招聘、学习、同行、广告 | 询问户型/预算/城市 |
| 餐饮 | 开店、加盟、探店、外卖、选址 | 招工、培训、加盟割韭菜 | 询问品类/位置/客流 |
| 教育 | 补课、升学、考研、职业培训 | 招生代理、同行 | 询问年级/目标/基础 |
| 美业 | 皮肤管理、医美、美甲、美睫、祛痘 | 学徒、招聘、设备商 | 询问问题/到店城市 |
| 本地生活 | 搬家、家政、维修、婚庆、摄影 | 招聘、教程、招商 | 询问服务区域/时间 |
| 招商加盟 | 创业、加盟、副业、开店 | 骗局、维权、同行 | 询问预算/城市/经验 |

### 模板字段

```ts
interface GrowthStrategyTemplate {
  id: string;
  industry: string;
  scenario: string;
  sourceKeywords: string[];
  demandKeywords: string[];
  excludeKeywords: string[];
  blacklistNicknames: string[];
  commentTemplates: string[];
  privateMessageTemplates: string[];
  scoringRules: GrowthLeadScoringRule[];
  defaultDailyLimit: number;
  defaultRiskMode: 'auto' | 'confirm-first' | 'draft-only';
}
```

### AI 生成

策略中心需要支持：

- 根据行业生成关键词。
- 根据目标客户生成排除词。
- 生成 20 条评论话术。
- 生成 10 条私信话术。
- 生成敏感词和禁用表达。
- 根据历史转化效果优化策略。

### 验收标准

- 用户能从模板一键创建获客任务。
- 模板生成的任务能被自动获客 2.0 识别。
- 话术必须经过敏感词检查。
- 每个模板都有默认频率与风控建议。

## 四期：账号健康中心

### 目标

自动化是否专业，核心看账号是否能稳定跑。需要把账号状态从“能不能登录”升级为“能不能继续执行增长动作”。

### 页面入口

可以增强现有：

```text
/platforms
/distribution?tab=accounts
```

也可以新增：

```text
/account-health
```

### 健康指标

| 指标 | 说明 |
|---|---|
| 登录状态 | 是否登录、是否扫码、是否 cookie 失效 |
| 今日执行量 | 评论数、私信数、关注/加好友数、发布数 |
| 失败率 | 最近 24 小时失败比例 |
| 风控状态 | 是否出现验证码、滑块、发送限制、评论限制 |
| 冷却建议 | 正常、降频、暂停、需人工处理 |
| 平台回读能力 | 发送后是否能稳定读回 |
| 证据完整度 | 每次任务是否有截图、回执、记录 |

### 失败原因库

统一失败原因枚举：

```ts
type GrowthExecutionFailureReason =
  | 'engine_unavailable'
  | 'account_not_logged_in'
  | 'account_risk_control'
  | 'captcha_required'
  | 'target_not_found'
  | 'editor_missing'
  | 'send_button_missing'
  | 'send_failed'
  | 'readback_failed'
  | 'daily_limit_reached'
  | 'duplicate_target'
  | 'content_policy_blocked'
  | 'platform_structure_changed'
  | 'unknown';
```

### 验收标准

- 每个执行失败都能归类到明确原因。
- 账号列表能显示“建议继续/降频/暂停/人工处理”。
- 风控状态能阻止高风险自动任务继续跑。
- 失败原因能反向进入任务记录和复盘报表。

## 五期：增长复盘

### 目标

让老板和运营看到结果，而不是只看到执行记录。

### 页面入口

```text
/growth-report
```

### 核心指标

| 指标 | 说明 |
|---|---|
| 今日新增线索 | 自动获客、私信、评论、企微新增总量 |
| 成功评论数 | 真实发送并回读成功 |
| 私信触达数 | 私信发送、草稿、失败拆分 |
| 线索沉淀数 | 已进入线索池数量 |
| 有效回复数 | 对方回复、表达需求、留联系方式 |
| 高意向线索数 | 评分超过阈值 |
| 任务成功率 | 各任务成功/失败/跳过 |
| 账号健康 | 各账号健康状态 |
| 话术表现 | 每条话术触达、回复、线索评分效果 |

### 漏斗

```text
候选线索
  -> 通过评分
  -> 已触达
  -> 已回复
  -> 已沉淀线索池
  -> 有效商机
  -> 成交/转化
```

### A/B 测试

话术池需要记录：

- 话术 ID。
- 使用次数。
- 回复率。
- 线索沉淀率。
- 被屏蔽/失败率。
- 平均线索评分。

### 验收标准

- 每日、近 7 天、近 30 天可看。
- 可按平台、账号、任务、行业模板筛选。
- 每个统计数字能点回原始记录或证据。
- 报表不能把草稿、失败、未回读计入成功。

## 六期：营销 SOP 工作流

### 目标

把 3010 的内容生产、发布、获客、私信、企微、CRM 串起来。

### 工作流示例

```text
行业策略
  -> 素材采集
  -> 选题生成
  -> 文章/小红书/视频生成
  -> 发布中心发布
  -> 自动获客任务
  -> 私信/评论跟进
  -> 企微或微信承接
  -> CRM 沉淀
  -> 增长复盘
```

### 页面入口

可以新增：

```text
/growth-workflows
```

也可以进入应用市场作为应用：

```text
应用市场 -> 增长获客工作流
```

### 工作流模板

第一批模板：

| 模板 | 说明 |
|---|---|
| 每日评论获客 | 每天按关键词搜索，筛选评论，自动评论，入线索池 |
| 竞品账号获客 | 盯住竞品/达人账号，采集互动用户 |
| 发布后追评 | 自己发布内容后，监控评论并自动回复 |
| 私信回访 | 对已触达线索按时间回访 |
| 朋友圈种草 | 生成朋友圈内容，定时发布，记录互动 |
| 内容到获客闭环 | 采集素材 -> 生成内容 -> 发布 -> 获客 -> CRM |

### 风险策略

高风险动作必须有策略控制：

| 动作 | 默认策略 |
|---|---|
| 公开评论 | 可自动，但需要每日上限和敏感词检查 |
| 私信首触达 | 默认确认后发送 |
| 加好友 | 默认确认后执行，且低频 |
| 朋友圈营销 | 默认草稿或确认后发布 |
| 批量发布 | 必须风险确认 |

### 验收标准

- 用户能从模板创建工作流。
- 工作流每一步都有状态、输入、输出和证据。
- 高风险步骤进入待确认。
- 失败后能暂停、重试、跳过、人工接管。

## 导航调整建议

建议左侧导航新增“增长获客”分组：

```text
增长获客
  -> 获客总览
  -> 自动获客
  -> 获客策略
  -> 线索池
  -> 账号健康
  -> 增长复盘
  -> 增长工作流
```

现有“客户互动”保留：

```text
客户互动
  -> 互动总览
  -> 抖音评论
  -> 抖音私信
  -> 视频号评论
  -> 视频号私信
  -> 企微助手
  -> 微信任务
  -> 回复规则
  -> 回复记录
```

区别：

- 增长获客：围绕找线索、触达、转化。
- 客户互动：围绕已有评论/私信/会话处理。

## 数据流

```text
GrowthStrategyTemplate
  -> GrowthAcquisitionConfig
  -> GrowthAcquisitionRun
  -> GrowthLead
  -> FollowUpTask
  -> PlatformInteractionExecutor
  -> ExecutionRecord + Evidence
  -> CRM Integration Adapter
  -> GrowthReport
```

## API 草案

### 获客策略

```text
GET    /api/growth/strategies
POST   /api/growth/strategies
GET    /api/growth/strategies/:id
PATCH  /api/growth/strategies/:id
DELETE /api/growth/strategies/:id
POST   /api/growth/strategies/generate
```

### 自动获客

```text
GET    /api/growth/acquisition/configs
POST   /api/growth/acquisition/configs
GET    /api/growth/acquisition/configs/:id
PATCH  /api/growth/acquisition/configs/:id
DELETE /api/growth/acquisition/configs/:id
POST   /api/growth/acquisition/configs/:id/execute
POST   /api/growth/acquisition/configs/:id/status
GET    /api/growth/acquisition/runs
GET    /api/growth/acquisition/runs/:id
```

### 线索池

```text
GET    /api/growth/leads
POST   /api/growth/leads
GET    /api/growth/leads/:id
PATCH  /api/growth/leads/:id
POST   /api/growth/leads/:id/follow-up
POST   /api/growth/leads/dedupe-preview
```

### 账号健康

```text
GET    /api/growth/account-health
GET    /api/growth/account-health/:platform/:accountId
POST   /api/growth/account-health/:platform/:accountId/check
POST   /api/growth/account-health/:platform/:accountId/cooldown
```

### 增长复盘

```text
GET    /api/growth/reports/overview
GET    /api/growth/reports/funnel
GET    /api/growth/reports/copywriting
GET    /api/growth/reports/accounts
GET    /api/growth/reports/tasks
```

### 工作流

```text
GET    /api/growth/workflows
POST   /api/growth/workflows
GET    /api/growth/workflows/:id
PATCH  /api/growth/workflows/:id
POST   /api/growth/workflows/:id/start
POST   /api/growth/workflows/:id/pause
POST   /api/growth/workflows/:id/resume
POST   /api/growth/workflows/:id/stop
GET    /api/growth/workflows/:id/runs
```

## 前端开发拆分

### 页面

```text
frontend/src/app/(dashboard)/growth/page.tsx
frontend/src/app/(dashboard)/growth/acquisition/page.tsx
frontend/src/app/(dashboard)/growth/strategies/page.tsx
frontend/src/app/(dashboard)/growth/leads/page.tsx
frontend/src/app/(dashboard)/growth/account-health/page.tsx
frontend/src/app/(dashboard)/growth/reports/page.tsx
frontend/src/app/(dashboard)/growth/workflows/page.tsx
```

### 组件

```text
frontend/src/components/growth/
  acquisition-config-form.tsx
  acquisition-mode-tabs.tsx
  acquisition-run-table.tsx
  lead-list.tsx
  lead-detail-drawer.tsx
  lead-score-badge.tsx
  strategy-template-card.tsx
  account-health-table.tsx
  growth-funnel.tsx
  copywriting-ab-table.tsx
  workflow-builder.tsx
```

### API client

```text
frontend/src/lib/growth-api.ts
```

## 后端开发拆分

```text
backend/src/modules/growth/
  growth.module.ts
  growth-acquisition.controller.ts
  growth-acquisition.service.ts
  growth-strategies.controller.ts
  growth-strategies.service.ts
  growth-leads.controller.ts
  growth-leads.service.ts
  growth-account-health.controller.ts
  growth-account-health.service.ts
  growth-reports.controller.ts
  growth-reports.service.ts
  growth-workflows.controller.ts
  growth-workflows.service.ts
  growth.types.ts
```

短期落地可以先不建独立数据库表，复用 `.local-logs` JSON store；但进入商用必须迁入 Prisma。

## Prisma 表建议

```prisma
model GrowthStrategy {
  id          String   @id @default(cuid())
  userId      String
  industry    String
  scenario    String
  name        String
  configJson  Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model GrowthAcquisitionConfig {
  id          String   @id @default(cuid())
  userId      String
  mode        String
  platform    String
  accountId   String
  name        String
  configJson  Json
  status      String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model GrowthAcquisitionRun {
  id          String   @id @default(cuid())
  configId    String
  userId      String
  status      String
  summaryJson Json
  startedAt   DateTime @default(now())
  endedAt     DateTime?
}

model GrowthLead {
  id          String   @id @default(cuid())
  userId      String
  platform    String
  sourceType  String
  sourceId    String?
  crmCustomerId String?
  nickname    String
  profileUrl  String?
  sourceText  String
  sourceUrl   String?
  score       Int      @default(0)
  status      String
  dataJson    Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model GrowthExecutionRecord {
  id          String   @id @default(cuid())
  userId      String
  taskType    String
  relatedId   String
  platform    String
  accountId   String?
  status      String
  failureReason String?
  evidenceJson Json
  createdAt   DateTime @default(now())
}
```

## 分期优先级

### P0：先把当前自动获客产品化

范围：

- `/apps/auto-acquisition` 拆 tab。
- 复用现有 `AiEmployeeService` 的 link/search/hot/targeted/retention 能力。
- 记录页升级为获客证据中心。
- 每条成功记录写入线索池；CRM 仅预留集成字段。

验收：

- 关键词、链接、目标账号、留资四类任务可跑。
- 每类任务都有记录、证据、失败原因。
- 任务成功后能看到线索。

### P1：线索池

范围：

- 新增线索池页面。
- 自动获客、抖音私信、视频号私信进入线索池。
- 预留 CRM 关联字段和集成事件。
- 不做 CRM 转化和 CRM 时间线。

验收：

- 任意线索能追溯到来源记录。
- 后续 CRM 集成可通过 `crmCustomerId` 和来源证据补齐客户时间线。

### P2：获客策略中心 + 模板

范围：

- 行业模板。
- AI 生成关键词、黑名单、话术池。
- 一键创建获客任务。

验收：

- 用户选择行业后 1 分钟内能创建可执行任务。

### P3：账号健康 + 失败原因库

范围：

- 账号健康指标。
- 失败原因归类。
- 风控建议。
- 自动暂停高风险任务。

验收：

- 失败不再只有笼统提示。
- 高风险账号不会继续自动跑。

### P4：增长复盘

范围：

- 漏斗报表。
- 话术 A/B。
- 账号表现。
- 任务表现。

验收：

- 每个数字都能点回原始记录。
- 成功只认真实回读或明确回执。

### P5：营销 SOP 工作流

范围：

- 工作流模板。
- 内容生产到发布到获客到线索池，最终阶段再接 CRM。
- 高风险步骤确认。

验收：

- 用户能创建端到端增长工作流。
- 每一步都有证据和可恢复状态。

## 风控底线

这些底线不能为了“抄炼刀”而放弃：

- 不允许把 dry run、草稿、创建任务当成成功。
- 不允许没有回读证据就计入成功发送。
- 私信首触达、加好友、批量动作默认进入确认或低频策略。
- 账号出现验证码、滑块、发送限制时自动暂停。
- 任何平台自动化都必须保留证据和失败原因。
- 统计报表必须区分：候选、草稿、已发送、已回读、失败、已沉淀线索池。
- CRM 不作为本阶段验收阻塞项，增长系统只验收线索池与外部 CRM 集成预留。

## 首批商用落地包

不按 MVP 缩水交付，但第一批商用落地必须先把这些主链路打牢：

1. 自动获客页拆成 4 个玩法 tab：关键词、链接、目标账号、留资。
2. 新增线索池，把自动获客成功结果沉淀进去。
3. 线索保留来源、证据、后续 CRM 关联字段。
4. 增加简单复盘：今日候选、触达、成功、线索沉淀、失败原因。

这个版本能最快让 3010 变强，同时不破坏现有架构。

## 开发注意事项

- 优先复用 `PlatformInteractionExecutor`，不要重复写一套浏览器自动化。
- 优先复用 `AutoUploadService` 的 preflight/risk gate 思路。
- 自动获客逻辑不要继续无限堆进 `AiEmployeeService`。
- 增长线索和 CRM 要保持边界：线索是漏斗前置，CRM 是客户资产；CRM 接入最后做。
- 前端不要只做配置表，要把“下一步该干什么”展示出来。
- 所有高风险动作必须支持确认、暂停、重试、跳过、人工接管。

## 一句话方向

3010 应该学炼刀的增长玩法拆分，但用 3010 自己更强的真实执行、证据、风控、CRM 和运营闭环来重做一遍。
