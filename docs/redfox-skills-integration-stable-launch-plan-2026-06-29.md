# RedFox Skills 数据情报接入稳定上线开发方案

更新时间：2026-06-29

目标版本：稳定上线版，10 周交付

适用系统：KAYPAL AI 本地系统 `http://127.0.0.1:3010/`，后端 `http://127.0.0.1:3011/`

参考来源：

- RedFox 官网：<https://redfox.hk/>
- RedFox Skill 广场：<https://redfox.hk/skills>
- RedFox 平台接口文档：<https://redfox.hk/api-docs>
- 已验证公开接口：
  - <https://redfox.hk/story/web/api/doc/platforms>
  - <https://redfox.hk/story/web/api/home/hot>
  - <https://redfox.hk/story/web/api/skills/list?page=1&pageSize=100>
  - <https://redfox.hk/story/web/api/doc/platform/douyin/interfaces>
  - <https://redfox.hk/story/web/api/doc/platform/xiaohongshu/interfaces>

## 1. 一句话结论

RedFox 对 KAYPAL AI 的最大价值不是“多接几个爬虫接口”，而是补齐一层独立的外部内容情报能力：

```text
RedFox 平台数据 / Skill 广场
  -> KAYPAL AI 数据情报层
  -> 素材库 / 选题库 / 内容创作 / 合规审核 / 增长获客 / 客户互动
  -> 发布、线索、复盘、证据链
```

稳定上线版应该把 RedFox 放在左侧导航的新增一级模块“数据情报”里，同时把它的结果分流到已有业务链路。这样用户看到的不是一个外部工具入口，而是一套能持续产出热点、爆款样本、对标账号、标题优化、违禁词检测和评论洞察的商业闭环。

## 2. 当前系统承接点

当前 KAYPAL AI 已经具备以下基础，适合接 RedFox：

- `内容素材`：可以承接 RedFox 搜索、爬取、热点、爆款作品结果。
- `知识库`：可以沉淀行业信息源、竞品样本、爆款拆解。
- `选题库`：可以把热点、爆款样本、评论需求转成选题。
- `文章库`、`小红书笔记`、`视频工坊`：可以消费 RedFox 的文案、标题、封面、脚本和样本。
- `图文发布`、`视频发布`：可以在发布前接入合规审核。
- `增长获客`：可以使用对标账号、相似账号、涨粉账号、低粉爆款样本辅助获客策略。
- `客户互动`：可以使用评论分析识别需求、痛点、意向和回复建议。
- `任务记录`、`操作证据`、`运行记录`：可以记录 RedFox 调用、成本、导入、生成和人工确认证据。

所以接入策略应是“新建数据情报入口 + 复用已有内容生产和增长链路”，避免把 RedFox 做成孤立工具箱。

## 3. RedFox 能力拆解

截至本方案调研时，RedFox Skill 广场公开列表约 80 个 Skill，覆盖以下方向：

| 能力方向 | 可结合能力 | 对 KAYPAL AI 的价值 |
| --- | --- | --- |
| 热点追踪 | 全网热搜、平台热榜、聚合榜单 top10、抖音热榜 | 给选题库提供每日热点来源 |
| 内容搜索 | 抖音、小红书、公众号、B 站、视频号、TikTok 搜索 | 给素材库提供跨平台内容样本 |
| 爆款内容 | 小红书每日/七日爆款、低粉爆款、抖音点赞飙升榜 | 给创作和增长提供可复用样本 |
| 对标账号 | 热门账号、黑马账号、相似账号、涨粉账号 | 给增长获客提供对标和账号池 |
| 账号诊断 | 小红书、抖音、公众号账号诊断 | 给账号健康和增长复盘提供输入 |
| 内容创作 | 小红书笔记创作、公众号文案创作、标题生成与评分、封面图制作 | 给内容生产加上辅助创作能力 |
| 文案优化 | 多平台文案风格改写、笔记优化、标题打分 | 提升发布前内容质量 |
| 合规审核 | 多平台违禁词检测、小红书/抖音/公众号违禁词检测 | 降低发布风险 |
| 评论分析 | 抖音评论分析、小红书评论分析 | 给客户互动和线索挖掘提供需求洞察 |
| 行业信息源 | 文旅、短剧、AI、A 股、出海等信息源 | 支持行业模板和垂直获客方案 |

## 4. 上线范围

### 4.1 必须上线

- RedFox 连接配置、连通性测试、状态显示。
- RedFox Skill 广场同步、启用、停用、分类、搜索。
- 全网热点、平台搜索、爆款样本、对标账号四个核心情报页面。
- 情报结果一键导入 `内容素材`。
- 情报结果一键生成 `选题`。
- 内容创作前的标题评分、文案改写、笔记优化入口。
- 发布前合规审核入口。
- 评论洞察入口。
- 调用日志、成本统计、失败原因、重试记录。
- 权限控制、租户隔离、调用限额、成本告警。
- 端到端验收：从 RedFox 拉数据，到 KAYPAL 生成选题/素材/内容，再到发布前合规审核。

### 4.2 稳定上线暂不做

- 不自动绕过平台风控。
- 不自动批量私信、自动批量评论、自动批量采集敏感个人信息。
- 不把 RedFox Skill 原样全部暴露给用户；只暴露和 KAYPAL 业务闭环有关的能力。
- 不做无限制自动调用；必须有成本、频率、权限和证据链。
- 不承诺 RedFox 未上线平台，例如接口文档中标记 coming soon 的能力。

## 5. 完整左侧导航规划

标注说明：

- `现有`：当前系统已有导航。
- `新增`：本次 RedFox 稳定上线版新增。
- `增强`：保留原入口，但接入 RedFox 结果或能力。

| 一级导航 | 二级导航 | 标记 | 建议路由 | 说明 |
| --- | --- | --- | --- | --- |
| 工作台 | 总览 | 现有 | `/` | 保留 |
| 工作台 | 应用市场 | 现有 | `/apps` | 后续展示 RedFox 连接器应用 |
| 工作台 | 待我确认 | 现有 | `/confirmations` | RedFox 导入、合规高风险内容可进入确认 |
| 工作台 | 任务记录 | 现有 | `/tasks` | 记录 RedFox 同步和导入任务 |
| 工作台 | 操作证据 | 现有 | `/evidence` | 保存调用、导入、生成、审核证据 |
| 数据情报 | 情报总览 | 新增 | `/intelligence` | 热点、爆款、对标、成本汇总 |
| 数据情报 | RedFox 连接 | 新增 | `/intelligence/redfox` | API Key、状态、额度、权限、连通性测试 |
| 数据情报 | RedFox Skills | 新增 | `/intelligence/skills` | Skill 同步、启停、分类、业务场景绑定 |
| 数据情报 | 全网热点 | 新增 | `/intelligence/trends` | 全网热搜、平台热榜、行业热点 |
| 数据情报 | 平台搜索 | 新增 | `/intelligence/search` | 抖音、小红书、公众号、B 站、TikTok 搜索 |
| 数据情报 | 爆款样本 | 新增 | `/intelligence/viral` | 低粉爆款、每日爆款、七日爆款、飙升榜 |
| 数据情报 | 对标账号 | 新增 | `/intelligence/accounts` | 热门账号、黑马账号、相似账号、账号诊断 |
| 数据情报 | 行业信息源 | 新增 | `/intelligence/industries` | 文旅、短剧、AI、A 股、出海等垂直来源 |
| 数据情报 | 监控订阅 | 新增 | `/intelligence/monitors` | 关键词、账号、行业、平台定时监控 |
| 数据情报 | 调用与成本 | 新增 | `/intelligence/costs` | 调用日志、点数、失败率、限额 |
| 内容生产 | 内容素材 | 现有/增强 | `/materials` | 支持从 RedFox 导入 |
| 内容生产 | 知识库 | 现有/增强 | `/knowledge` | 支持沉淀行业信息源和爆款拆解 |
| 内容生产 | 选题库 | 现有/增强 | `/topics` | 支持由热点/爆款/评论生成选题 |
| 内容生产 | 文章库 | 现有 | `/articles` | 保留 |
| 内容生产 | 小红书笔记 | 现有/增强 | `/xiaohongshu` | 接入小红书标题、笔记优化、违禁词 |
| 内容生产 | 视频工坊 | 现有/增强 | `/videos` | 接入抖音/B 站/TikTok 样本参考 |
| 内容生产 | 创作优化 | 新增 | `/content/optimization` | 标题评分、文案改写、笔记优化、封面建议 |
| 内容生产 | 计划任务 | 现有/增强 | `/schedules` | 支持定时情报同步任务 |
| 内容生产 | 内容规则 | 现有/增强 | `/rules` | 接入平台合规规则和违禁词结果 |
| 发布中心 | 图文发布 | 现有/增强 | `/publishing/articles` | 发布前合规审核 |
| 发布中心 | 视频发布 | 现有/增强 | `/publishing/videos` | 发布前合规审核 |
| 发布中心 | 发布素材 | 现有 | `/publishing/assets` | 保留 |
| 发布中心 | 平台账号 | 现有 | `/publishing/accounts` | 保留 |
| 发布中心 | 合规审核 | 新增 | `/distribution/compliance` | 多平台违禁词、风险项、修改建议 |
| 增长获客 | 获客总览 | 现有/增强 | `/growth` | 展示对标账号、爆款样本带来的增长机会 |
| 增长获客 | 自动获客矩阵 | 现有/增强 | `/growth/matrix` | 输入来自 RedFox 对标账号和搜索结果 |
| 增长获客 | 获客策略 | 现有/增强 | `/growth/strategies` | 支持按爆款样本生成策略 |
| 增长获客 | 线索池 | 现有/增强 | `/growth/leads` | 支持情报转线索，但必须人工确认 |
| 增长获客 | 账号健康 | 现有/增强 | `/growth/account-health` | 接入账号诊断结果 |
| 增长获客 | 增长复盘 | 现有/增强 | `/growth/reviews` | 对比热点、发布、线索结果 |
| 增长获客 | 增长工作流 | 现有/增强 | `/growth/workflows` | 支持 RedFox 情报触发工作流 |
| 客户互动 | 互动总览 | 现有/增强 | `/interaction` | 展示评论洞察结果 |
| 客户互动 | 自动获客 | 现有 | `/interaction/acquisition` | 保留 |
| 客户互动 | 企微助手 | 现有 | `/interaction/wecom` | 保留 |
| 客户互动 | 抖音评论 | 现有/增强 | `/interaction/douyin-comments` | 可接入评论分析 |
| 客户互动 | 抖音私信 | 现有 | `/interaction/douyin-messages` | 保留 |
| 客户互动 | 微信任务 | 现有 | `/interaction/wechat-tasks` | 保留 |
| 客户互动 | 视频号评论 | 现有/增强 | `/interaction/channel-comments` | 可接入评论分析 |
| 客户互动 | 视频号私信 | 现有 | `/interaction/channel-messages` | 保留 |
| 客户互动 | 评论洞察 | 新增 | `/interaction/comment-insights` | 抖音/小红书评论分析、需求提炼、回复建议 |
| 客户互动 | 回复规则 | 现有/增强 | `/interaction/reply-rules` | 评论洞察沉淀回复规则 |
| 客户互动 | 回复记录 | 现有 | `/interaction/reply-records` | 保留 |
| 系统设置 | 运行检查 | 现有/增强 | `/settings/health` | 增加 RedFox 连接健康检查 |
| 系统设置 | 账号与设备 | 现有 | `/settings/accounts` | 保留 |
| 系统设置 | 平台授权配置 | 现有/增强 | `/settings/platforms` | 展示 RedFox 授权状态 |
| 系统设置 | 系统配置 | 现有/增强 | `/settings/system` | 增加 RedFox 调用策略配置 |
| 系统设置 | 权限与安全 | 现有/增强 | `/settings/security` | 增加 RedFox 能力权限 |
| 系统设置 | 运行记录 | 现有/增强 | `/settings/logs` | 增加 RedFox 调用记录 |

## 6. 核心业务闭环

### 6.1 热点到选题

```text
用户进入 数据情报 / 全网热点
  -> 选择平台、行业、关键词
  -> 调用 RedFox 热点或热榜 Skill
  -> KAYPAL 标准化为 IntelligenceItem
  -> 用户勾选条目
  -> 导入内容素材 或 生成选题
  -> 进入选题库继续加工
```

### 6.2 爆款样本到内容创作

```text
用户进入 数据情报 / 爆款样本
  -> 选择小红书低粉爆款、每日爆款、七日爆款、抖音飙升榜
  -> 查看标题、正文、互动指标、账号信息
  -> 一键拆解爆款结构
  -> 生成小红书笔记、文章大纲、视频脚本
  -> 发布前进入合规审核
```

### 6.3 对标账号到增长获客

```text
用户进入 数据情报 / 对标账号
  -> 获取热门账号、黑马账号、相似账号、账号诊断
  -> 加入对标账号池
  -> 生成增长策略
  -> 进入自动获客矩阵或增长工作流
  -> 产生线索前必须人工确认
```

### 6.4 评论洞察到客户互动

```text
用户进入 客户互动 / 评论洞察
  -> 选择作品或关键词
  -> 调用评论分析 Skill
  -> 提炼痛点、异议、需求、购买意向、常见问题
  -> 生成回复建议和回复规则
  -> 写入回复规则或待我确认
```

### 6.5 内容发布前合规

```text
用户在文章、小红书笔记或视频文案中点击合规审核
  -> 选择平台
  -> 调用多平台/平台专属违禁词检测
  -> 返回风险等级、命中词、替换建议
  -> 高风险进入待我确认
  -> 通过后允许进入发布流程
```

## 7. 技术架构

### 7.1 后端模块

建议新增后端模块：

```text
backend/src/modules/redfox/
  redfox.module.ts
  redfox.controller.ts
  redfox.service.ts
  redfox-client.service.ts
  redfox-skill-catalog.service.ts
  redfox-call-log.service.ts
  redfox-cost-guard.service.ts
  dto/

backend/src/modules/intelligence/
  intelligence.module.ts
  intelligence.controller.ts
  intelligence.service.ts
  intelligence-normalizer.service.ts
  intelligence-import.service.ts
  dto/

backend/src/modules/content-optimization/
  content-optimization.module.ts
  content-optimization.controller.ts
  content-optimization.service.ts

backend/src/modules/compliance/
  compliance.module.ts
  compliance.controller.ts
  compliance.service.ts

backend/src/modules/comment-insights/
  comment-insights.module.ts
  comment-insights.controller.ts
  comment-insights.service.ts
```

### 7.2 前端模块

建议新增前端路由：

```text
frontend/src/app/(dashboard)/intelligence/page.tsx
frontend/src/app/(dashboard)/intelligence/redfox/page.tsx
frontend/src/app/(dashboard)/intelligence/skills/page.tsx
frontend/src/app/(dashboard)/intelligence/trends/page.tsx
frontend/src/app/(dashboard)/intelligence/search/page.tsx
frontend/src/app/(dashboard)/intelligence/viral/page.tsx
frontend/src/app/(dashboard)/intelligence/accounts/page.tsx
frontend/src/app/(dashboard)/intelligence/industries/page.tsx
frontend/src/app/(dashboard)/intelligence/monitors/page.tsx
frontend/src/app/(dashboard)/intelligence/costs/page.tsx
frontend/src/app/(dashboard)/content/optimization/page.tsx
frontend/src/app/(dashboard)/distribution/compliance/page.tsx
frontend/src/app/(dashboard)/interaction/comment-insights/page.tsx
```

建议新增前端库：

```text
frontend/src/lib/redfox/
frontend/src/lib/intelligence/
frontend/src/lib/compliance/
frontend/src/lib/comment-insights/
```

### 7.3 数据模型建议

稳定上线版建议新增以下核心表。字段名以最终 Prisma 规范为准。

| 表 | 用途 | 关键字段 |
| --- | --- | --- |
| `RedfoxConnection` | RedFox 连接配置 | `id`、`tenantId`、`userId`、`apiKeyEncrypted`、`status`、`lastTestAt`、`lastError` |
| `RedfoxSkill` | RedFox Skill 本地目录 | `skillNo`、`code`、`name`、`platform`、`tags`、`summary`、`raw`、`syncedAt` |
| `RedfoxSkillInstall` | 用户启用的 Skill | `tenantId`、`skillId`、`enabled`、`scenario`、`config` |
| `RedfoxCallLog` | 调用日志和成本 | `endpoint`、`skillCode`、`status`、`costPoints`、`latencyMs`、`requestHash`、`errorMessage` |
| `IntelligenceItem` | 标准化情报条目 | `platform`、`type`、`title`、`content`、`sourceUrl`、`author`、`metrics`、`raw` |
| `BenchmarkAccount` | 对标账号池 | `platform`、`nickname`、`externalUserId`、`profileUrl`、`metrics`、`reason` |
| `IntelligenceMonitor` | 监控订阅 | `type`、`platform`、`keyword`、`schedule`、`status`、`lastRunAt` |
| `ComplianceCheck` | 合规审核记录 | `targetType`、`targetId`、`platform`、`riskLevel`、`findings`、`suggestions` |
| `CommentInsight` | 评论洞察记录 | `platform`、`sourceUrl`、`painPoints`、`intentKeywords`、`replySuggestions`、`raw` |

### 7.4 RedFox Client 设计

RedFox Client 必须做统一封装：

- 统一认证头和 API Key 读取。
- 统一超时、重试、错误码映射。
- 统一调用日志。
- 统一点数成本记录。
- 统一响应标准化。
- 统一脱敏和敏感字段过滤。
- 统一租户隔离。

禁止前端直接调用 RedFox。所有请求必须经过 KAYPAL 后端，方便权限、成本、日志和安全控制。

### 7.5 成本和限额策略

默认策略：

- 单用户每日 RedFox 调用上限。
- 单租户每日 RedFox 调用上限。
- 单 Skill 单日调用上限。
- 搜索类接口需要关键词去重和请求缓存。
- 失败重试最多 2 次。
- 高成本 Skill 必须弹出确认。
- 所有导入和生成动作写入操作证据。

## 8. RedFox Skill 到 KAYPAL 功能映射

| RedFox 能力 | KAYPAL 功能入口 | 一期用途 |
| --- | --- | --- |
| 全网热搜查询、全网聚合热点榜单 top10 | 数据情报 / 全网热点 | 生成热点素材和选题 |
| 抖音热榜神器、抖音每日热门作品榜 | 数据情报 / 全网热点、爆款样本 | 找内容趋势和视频脚本参考 |
| 小红书低粉爆款笔记、每日爆款、七日爆款 | 数据情报 / 爆款样本 | 找可复制的内容结构 |
| 抖音作品查询、小红书爆款笔记查询 | 数据情报 / 平台搜索 | 搜索关键词内容样本 |
| 公众号 10w+ 文章、公众号热门原创文章 | 数据情报 / 平台搜索、爆款样本 | 文章选题和结构参考 |
| B 站关键词搜作品、B 站关键词搜账号 | 数据情报 / 平台搜索、对标账号 | 视频内容和账号研究 |
| 抖音热门账号、小红书热门账号、公众号黑马账号 | 数据情报 / 对标账号 | 增长策略和账号池 |
| 小红书账号诊断、抖音账号诊断、公众号账号诊断 | 数据情报 / 对标账号、增长获客 / 账号健康 | 账号健康和对标分析 |
| 多平台文案风格改写、小红书文案改写 | 内容生产 / 创作优化 | 多平台适配 |
| 小红书标题生成与评分、公众号标题生成与评分 | 内容生产 / 创作优化 | 标题优化 |
| 小红书笔记优化助手、小红书笔记创作 | 小红书笔记、创作优化 | 笔记生成和优化 |
| 多平台违禁词检测、小红书/抖音/公众号违禁词检测 | 发布中心 / 合规审核 | 发布前风险检查 |
| 抖音评论分析、小红书评论分析 | 客户互动 / 评论洞察 | 提炼用户需求和回复规则 |
| 文旅、短剧、AI、A 股、出海信息源 | 数据情报 / 行业信息源 | 行业化内容方案 |

## 9. 10 周稳定上线计划

### 第 1 周：产品定义和技术基线

负责人：产品架构专家、后端集成专家、测试与安全专家

交付物：

- RedFox 稳定上线 PRD。
- 左侧导航和路由确认。
- RedFox Skill 分类和业务映射表。
- 后端模块边界、数据模型初稿。
- 成本、权限、租户隔离、日志策略。
- 风险清单和上线 Gate。

验收标准：

- 10 周范围冻结。
- 明确哪些 Skill 必须上线，哪些只展示不接入。
- 明确 RedFox 调用必须经过后端。
- 明确任何获客、私信、评论动作不得自动越权执行。

### 第 2 周：RedFox 连接器和 Skill 目录

负责人：后端集成专家、前端体验专家、测试与安全专家

交付物：

- `RedfoxConnection` 配置、加密存储、连通性测试。
- `RedfoxSkill` 同步任务。
- `RedfoxCallLog` 调用日志。
- 前端 `RedFox 连接` 页面。
- 前端 `RedFox Skills` 页面。
- 应用市场增加 RedFox 连接器展示。

验收标准：

- 用户可以配置 RedFox API Key。
- 可以测试连接并看到失败原因。
- 可以同步 Skill 广场列表。
- 可以按平台、标签、场景搜索 Skill。
- 所有调用写入日志。

### 第 3 周：全网热点和平台搜索

负责人：后端集成专家、数据与 AI 工作流专家、前端体验专家

交付物：

- `数据情报 / 全网热点`。
- `数据情报 / 平台搜索`。
- RedFox 热点、热榜、搜索类接口封装。
- `IntelligenceItem` 标准化。
- 一键导入内容素材。
- 一键生成选题草稿。

验收标准：

- 支持至少全网热点、抖音搜索、小红书搜索、公众号搜索。
- 搜索结果可以标准化展示。
- 搜索结果可以导入素材库。
- 搜索结果可以生成选题。
- 重复内容可以识别并提示。

### 第 4 周：爆款样本和对标账号

负责人：增长与 CRM 专家、数据与 AI 工作流专家、后端集成专家、前端体验专家

交付物：

- `数据情报 / 爆款样本`。
- `数据情报 / 对标账号`。
- 爆款榜单、低粉爆款、飙升榜封装。
- 热门账号、黑马账号、相似账号、账号诊断封装。
- `BenchmarkAccount` 对标账号池。
- 对标账号导入增长获客链路。

验收标准：

- 用户可以筛选平台、周期、行业、关键词。
- 爆款样本展示互动指标和来源链接。
- 对标账号可以加入账号池。
- 账号诊断结果可以进入账号健康或增长复盘。
- 不直接生成自动私信或自动评论任务。

### 第 5 周：创作优化

负责人：数据与 AI 工作流专家、前端体验专家、产品架构专家

交付物：

- `内容生产 / 创作优化`。
- 标题评分。
- 文案改写。
- 小红书笔记优化。
- 爆款结构拆解。
- 与小红书笔记、文章库、视频工坊建立入口。

验收标准：

- 用户可以从素材、选题、文章、小红书笔记进入创作优化。
- 优化前后有对比。
- 结果可以保存为新版本。
- 原文不被覆盖。
- 高风险改写建议不自动发布。

### 第 6 周：合规审核

负责人：测试与安全专家、后端集成专家、前端体验专家

交付物：

- `发布中心 / 合规审核`。
- 多平台违禁词检测。
- 小红书、抖音、公众号平台专属检测。
- 风险等级、命中词、替换建议。
- 发布前审核 Gate。
- `ComplianceCheck` 记录。

验收标准：

- 图文、视频、小红书笔记发布前可触发合规审核。
- 高风险内容进入待我确认。
- 审核结果写入证据链。
- 失败时不阻断用户手动保存草稿。
- 合规结果可以复查。

### 第 7 周：评论洞察和客户互动联动

负责人：增长与 CRM 专家、数据与 AI 工作流专家、前端体验专家

交付物：

- `客户互动 / 评论洞察`。
- 抖音评论分析。
- 小红书评论分析。
- 痛点、需求、异议、意向词提取。
- 回复建议和回复规则沉淀。
- 与回复规则、待我确认联动。

验收标准：

- 评论洞察可以从链接、作品、关键词进入。
- 输出用户痛点、常见问题和回复建议。
- 回复建议默认进入待确认，不自动发送。
- 可以沉淀为回复规则。
- 可以关联线索池，但不自动创建高意向线索。

### 第 8 周：监控订阅、计划任务和行业信息源

负责人：产品架构专家、后端集成专家、数据与 AI 工作流专家

交付物：

- `数据情报 / 行业信息源`。
- `数据情报 / 监控订阅`。
- 关键词订阅。
- 账号订阅。
- 行业订阅。
- 与计划任务联动。
- 监控结果进入素材库、选题库或待我确认。

验收标准：

- 用户可以创建、暂停、恢复、删除订阅。
- 订阅任务有执行记录。
- 失败原因可见。
- 支持成本上限。
- 监控结果不重复刷屏。

### 第 9 周：系统治理、权限、成本和观测

负责人：测试与安全专家、后端集成专家、增长与 CRM 专家

交付物：

- `数据情报 / 调用与成本`。
- RedFox 调用总览。
- 日/周/月成本报表。
- Skill 成本排行。
- 失败率、延迟、错误码。
- 权限矩阵。
- 租户隔离测试。
- 限额和告警。

验收标准：

- 管理员可以看到调用量和成本。
- 普通用户只能看到自己权限范围内的数据。
- 超限时明确提示。
- RedFox 不可用时系统降级，不影响已有内容生产。
- 所有敏感配置脱敏展示。

### 第 10 周：稳定上线验收和发布

负责人：全员

交付物：

- 全链路回归测试。
- 上线验收报告。
- 运营使用手册。
- 异常处理 Runbook。
- 数据迁移脚本。
- 环境变量和部署清单。
- 稳定上线版本发布。

验收标准：

- 端到端链路通过：
  - RedFox 连接配置。
  - Skill 同步。
  - 拉取热点。
  - 导入素材。
  - 生成选题。
  - 生成内容。
  - 合规审核。
  - 写入证据。
- 关键页面无 500。
- 核心接口有错误兜底。
- 调用日志完整。
- 权限和成本限制生效。
- 用户能在无工程师陪同下完成核心流程。

## 10. 六个专家工作小组

### 10.1 产品架构专家

职责：

- 把 RedFox Skill 转成 KAYPAL 用户能理解的业务场景。
- 维护 10 周范围、优先级、验收口径。
- 设计左侧导航、页面信息架构和业务闭环。
- 定义哪些动作必须人工确认。

主要交付：

- PRD。
- 导航和路由说明。
- Skill 到业务场景映射。
- 每周验收清单。

### 10.2 后端集成专家

职责：

- 建 RedFox 连接器。
- 封装 RedFox API 和 Skill 调用。
- 做认证、日志、重试、成本、错误映射。
- 保证前端不直连 RedFox。

主要交付：

- `redfox` 模块。
- `intelligence` 模块基础能力。
- RedFox Client。
- 调用日志和成本守卫。

### 10.3 前端体验专家

职责：

- 改造左侧导航。
- 新增数据情报相关页面。
- 做列表、筛选、导入、生成、确认、状态反馈。
- 保证页面密度适合运营工具，不做营销页。

主要交付：

- 新导航。
- 数据情报页面。
- RedFox 连接和 Skill 页面。
- 合规审核、评论洞察、创作优化入口。

### 10.4 数据与 AI 工作流专家

职责：

- 标准化 RedFox 内容数据。
- 设计热点到选题、爆款到内容、评论到洞察的 AI 流程。
- 做摘要、拆解、标题评分、改写、笔记优化。
- 控制 AI 生成质量和可追溯性。

主要交付：

- `IntelligenceItem` 标准化规则。
- 选题生成流程。
- 爆款拆解流程。
- 创作优化流程。

### 10.5 增长与 CRM 专家

职责：

- 把对标账号、评论洞察、爆款样本接入增长获客。
- 设计线索池接入规则。
- 设计账号健康和增长复盘展示。
- 明确哪些线索需要人工确认。

主要交付：

- 对标账号池。
- 情报到增长策略流程。
- 评论洞察到回复规则流程。
- 情报到线索的人工确认规则。

### 10.6 测试与安全专家

职责：

- 设计测试计划、回归脚本和上线 Gate。
- 检查权限、租户隔离、API Key 脱敏、成本限额。
- 检查合规风险和失败兜底。
- 编写上线 Runbook。

主要交付：

- 测试计划。
- 权限和成本测试。
- 合规审核验收。
- 上线 Runbook。

## 11. 验收 Gate

稳定上线必须通过以下 Gate：

| Gate | 验收项 | 通过标准 |
| --- | --- | --- |
| Gate 1 | RedFox 连接 | 配置、测试、失败提示、脱敏展示均正常 |
| Gate 2 | Skill 同步 | Skill 列表可同步、搜索、分类、启停 |
| Gate 3 | 情报导入 | 热点、搜索、爆款、账号结果可标准化入库 |
| Gate 4 | 内容联动 | 情报可导入素材、生成选题、进入创作优化 |
| Gate 5 | 合规审核 | 发布前可检测，风险结果可追溯 |
| Gate 6 | 评论洞察 | 评论可分析，建议默认待确认 |
| Gate 7 | 成本控制 | 调用日志、成本统计、限额和告警生效 |
| Gate 8 | 权限安全 | 租户隔离、角色权限、API Key 脱敏通过 |
| Gate 9 | 降级兜底 | RedFox 不可用时系统可继续使用已有功能 |
| Gate 10 | 运营可用 | 非工程用户可按手册完成核心流程 |

## 12. 关键风险和控制

| 风险 | 表现 | 控制方式 |
| --- | --- | --- |
| RedFox 接口变更 | 字段变化、接口报错 | 统一 Client、raw 字段保留、错误码映射 |
| 成本失控 | 高频搜索、订阅过多 | 用户/租户/Skill 限额，缓存和确认 |
| 合规风险 | 敏感词、诱导私信、平台规则风险 | 发布前审核，高风险待确认 |
| 数据重复 | 同一作品多次导入 | sourceUrl、externalId、requestHash 去重 |
| 平台能力不可用 | RedFox 某些平台 coming soon | 页面标注状态，不承诺未上线能力 |
| 权限泄露 | 普通用户看到管理数据 | RBAC 和租户隔离测试 |
| 用户误解 | 把情报工具当自动获客工具 | 所有外联动作保持人工确认 |

## 13. 环境变量建议

```bash
REDFOX_API_BASE_URL=https://redfox.hk
REDFOX_API_KEY=
REDFOX_TIMEOUT_MS=60000
REDFOX_DAILY_USER_LIMIT=200
REDFOX_DAILY_TENANT_LIMIT=2000
REDFOX_HIGH_COST_CONFIRM_THRESHOLD=1
REDFOX_CACHE_TTL_SECONDS=3600
```

API Key 必须加密存储，前端只显示脱敏结果。

## 14. 接口草案

```text
GET    /api/redfox/connection
POST   /api/redfox/connection
POST   /api/redfox/connection/test

GET    /api/redfox/skills
POST   /api/redfox/skills/sync
PATCH  /api/redfox/skills/:id

GET    /api/redfox/call-logs
GET    /api/redfox/costs/summary

GET    /api/intelligence
POST   /api/intelligence/trends/fetch
POST   /api/intelligence/search
POST   /api/intelligence/viral/fetch
POST   /api/intelligence/accounts/fetch
POST   /api/intelligence/:id/import-material
POST   /api/intelligence/:id/create-topic

POST   /api/content-optimization/title-score
POST   /api/content-optimization/rewrite
POST   /api/content-optimization/xhs-note-optimize

POST   /api/compliance/check
GET    /api/compliance/checks

POST   /api/comment-insights/analyze
GET    /api/comment-insights
```

## 15. 页面验收细节

### RedFox 连接

- 显示连接状态、最近测试时间、最近失败原因。
- 支持保存 API Key。
- 支持重新测试连接。
- API Key 脱敏展示。
- 无 Key 时其他 RedFox 页面给出明确引导。

### RedFox Skills

- 展示 Skill 名称、平台、标签、状态、场景。
- 支持按平台和标签筛选。
- 支持启用、停用。
- 支持同步 Skill 广场。
- 支持查看原始能力说明。

### 全网热点

- 支持平台、行业、关键词筛选。
- 支持导入素材、生成选题。
- 展示来源、热度、发布时间、原链接。

### 平台搜索

- 支持抖音、小红书、公众号、B 站、TikTok。
- 支持作品和账号两类搜索。
- 支持结果去重。

### 爆款样本

- 支持每日、七日、低粉、飙升等榜单。
- 展示标题、正文摘要、账号、互动指标。
- 支持拆解和导入。

### 对标账号

- 支持热门账号、黑马账号、相似账号、账号诊断。
- 可以加入对标账号池。
- 可以进入增长策略。

### 创作优化

- 支持标题评分、文案改写、笔记优化。
- 支持优化前后对比。
- 支持保存版本。

### 合规审核

- 支持多平台检测。
- 展示风险等级、命中词、建议替换。
- 高风险默认进入待我确认。

### 评论洞察

- 支持评论来源输入。
- 输出痛点、需求、异议、意向词、回复建议。
- 可保存为回复规则。

## 16. 10 周每周例会节奏

每周固定输出：

- 本周完成清单。
- 下周计划。
- 风险和阻塞。
- 可演示页面。
- 接口和数据模型变更。
- 验收结果。

每周固定检查：

- 是否偏离稳定上线范围。
- 是否出现无证据链的自动化动作。
- 是否出现前端直连 RedFox。
- 是否出现成本不可控调用。
- 是否出现权限或租户隔离问题。

## 17. 最终交付物

第 10 周结束必须交付：

- 代码：前后端、数据库迁移、测试。
- 文档：用户手册、运维 Runbook、接口说明、验收报告。
- 数据：RedFox Skill 目录、默认业务映射、示例情报数据。
- 安全：权限矩阵、API Key 存储说明、成本限额说明。
- 运营：每日使用流程、异常处理流程、常见问题。

## 18. 当前建议的第一批开发任务

立即开工的第一批任务：

1. 产品架构专家冻结 10 周范围和导航。
2. 后端集成专家创建 RedFox 模块和 Client。
3. 前端体验专家改造左侧导航并建立空页面骨架。
4. 数据与 AI 工作流专家设计 `IntelligenceItem` 标准化规则。
5. 增长与 CRM 专家定义对标账号池和线索确认规则。
6. 测试与安全专家建立 Gate 1 到 Gate 10 的测试清单。

这 6 件事可以并行推进，不互相阻塞。
