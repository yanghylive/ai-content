# Kaypal AI 功能页面产品合理性审查

审查日期：2026-07-03

## 审查口径

本次不是做 UI 禁词扫描，而是按“创作优化/发布前检查”那条业务闭环的产品逻辑，逐页判断：

- 这个页面服务哪类用户任务。
- 页面是否有独立存在意义。
- 上游入口和下游动作是否清楚。
- 是否和其它页面重复、割裂或只是旧入口复用。
- 是否应该保留、合并、降级为别名，或重做。

本次依据：当前工作区内 129 个功能页面、82 个侧边栏入口、页面源码和本地浏览器页面级验证结果。

## 总体结论

产品主线是合理的：情报发现、内容生产、发布运营、增长获客、客户互动、CRM 和系统能力，基本覆盖一个内容运营/增长团队的完整工作台。

最大问题不是单页崩坏，而是信息架构过宽：同一功能同时存在新版业务入口、旧入口、admin 别名、能力说明页和底层工具页。用户会觉得“页面很多，但不知道哪个才是正门”。

建议把页面分为四类治理：

1. 主业务页：保留在侧边栏，继续打磨功能闭环。
2. 子任务页：保留，但应明确从哪个主业务页进入。
3. 能力/管理页：只给管理员或高级设置入口，不混入普通业务流。
4. 旧入口/别名页：保留兼容，但不作为独立产品页面展示。

## 一级导航判断

| 模块 | 当前意义 | 合理性 | 建议 |
|---|---|---|---|
| 今日工作台 | 把待办、风险、最近任务聚合成每日入口 | 合理 | 保留为首页，但减少重复指标，突出“今天要处理什么” |
| AI 任务中心 | 管理确认、任务运行、执行记录、操作记录和计划任务 | 合理但偏系统化 | 保留，文案继续偏业务化，避免变成技术控制台 |
| 情报中心 | 发现热点、账号、线索、风险和报告 | 合理 | 保留，但“技能/数据来源/规则/成本”应归为设置型入口 |
| 内容资产 | 素材、知识、选题、策略、文章、小红书、视频、优化和模板 | 合理 | 保留，创作优化应成为内容进入发布前检查的关键桥 |
| 发布运营 | 发布前检查、账号、素材、任务、记录 | 合理 | 保留，发布工作台是内容链路的下游核心 |
| 增长获客 | 策略、线索、账号健康、自动获客、流程、报表 | 合理但页数偏多 | 可保留，但“流程/报表/策略”建议做成增长页内切换项 |
| 客户互动 | 评论、私信、微信、企微、客户、规则和记录 | 合理但重复入口多 | 以 `/engagement` 为正门，旧 `/workbench`、`/interaction` 降级 |
| 应用与系统/Admin | 应用、账号、模型、工具、权限、本机服务等 | 对管理员合理，对普通用户过重 | 从普通业务侧边栏降权，改为“设置/管理”分组 |
| CRM | 客户、导入、成交助手、连接 | 合理 | 保留，是增长和互动后的客户沉淀层 |

## 今日工作台

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/` 今日待办 | 日常入口，承接任务、趋势、草稿和系统状态 | 合理 | 保留；H1 应直接强调“今天要处理的运营事项” |
| `/war-room` 战情室 | 高风险任务、平台联动、本机执行状态的聚合入口 | 有意义但像说明页 | 保留，但应做成真正的异常/风险作战页，而不是导航页 |
| `/solutions` 方案中心 | 把用户目标转成可执行方案和后续动作 | 合理 | 保留；适合作为跨模块业务入口 |

## AI 任务中心

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/tasks` 运行总览 | 展示 AI 任务总体运行状态 | 合理 | 保留；与首页待办避免指标重复 |
| `/tasks/confirmations` 待我确认 | 所有高风险或需人工确认动作的闸门 | 非常合理 | 保留，是商用安全关键页 |
| `/tasks/runs` 任务运行 | 查看任务会话和执行进度 | 合理 | 保留，但对普通用户可叫“任务记录” |
| `/tasks/records` 执行记录 | 查看历史执行过程 | 合理 | 可与 `/tasks/runs` 合并成页内切换项 |
| `/tasks/evidence` 操作记录 | 查看可追溯证据和平台动作记录 | 合理 | 保留；是商用审计能力 |
| `/tasks/schedules` 计划任务 | 定时发布/采集/执行计划 | 合理 | 保留，但入口可放到发布运营和任务中心双入口 |

## 情报中心

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/intelligence` 情报工作台 | 汇总发现、风险、派发和报告 | 合理 | 保留为情报正门 |
| `/intelligence/search` 搜索研究 | 用一句话搜索内容、账号、评论机会 | 合理 | 保留；是主动研究入口 |
| `/intelligence/inbox` 待处理线索 | 把发现的情报排队等待判断 | 合理 | 保留；需和线索洞察区分“待处理 vs 已沉淀” |
| `/intelligence/trends` 热点趋势 | 热点雷达和趋势判断 | 合理 | 保留；下游应明确到选题/素材/监控/复核 |
| `/intelligence/industries` 行业来源 | 管理行业来源和行业信号 | 合理 | 保留；更像配置+监控混合页，后续可拆 |
| `/intelligence/leads` 线索洞察 | 对潜在线索做情报判断 | 合理 | 保留；应和 CRM 线索池打通 |
| `/intelligence/accounts` 对标账号 | 跟踪竞品/标杆账号 | 合理 | 保留 |
| `/intelligence/viral` 爆款拆解 | 拆解爆款样本，输出可复用结构 | 合理 | 保留；下游应到创作优化/模板库 |
| `/intelligence/monitors` 自动监控 | 管理持续监控任务 | 合理 | 保留；和计划任务要有边界说明 |
| `/intelligence/reports` 报告中心 | 汇总情报报告 | 合理 | 保留 |
| `/intelligence/risks` 风险审核 | 处理风险对象、版权/敏感/争议风险 | 合理 | 保留；与发布前检查不同，它是情报阶段风险 |
| `/intelligence/collaboration` 团队协作 | 情报对象的派发和责任人协作 | 合理 | 保留，但若使用率低可合并进情报工作台 |
| `/intelligence/skills` 功能模板 | 选择情报能力模板 | 对管理员/高级用户合理 | 普通用户侧降级，放到设置或情报规则里 |
| `/intelligence/redfox` 数据来源 | 外部数据源状态 | 对管理员合理 | 不应是普通业务页，建议放设置 |
| `/intelligence/rules` 风险规则 | 情报判断和拦截规则 | 合理但偏配置 | 放到情报中心二级设置 |
| `/intelligence/costs` 积分明细 | 看情报能力消耗和失败 | 合理但偏运营管理 | 建议放到账户/用量中心，业务用户少看 |

## 内容资产

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/content` 素材库 | 统一管理素材 | 合理 | 保留；实际复用 `/materials`，正门应统一到 `/content` |
| `/content/knowledge` 知识库 | 管理本地知识和可检索资料 | 合理 | 保留 |
| `/content/topics` 选题库 | 选题挖掘、评分、转内容 | 合理 | 保留；是情报到创作的桥 |
| `/content/strategies` 内容策略 | 管理内容策略和规则 | 合理 | 保留；与模板/品牌风格边界要清楚 |
| `/content/articles` 文章库 | 图文文章资产 | 合理 | 保留 |
| `/content/xiaohongshu` 小红书笔记 | 小红书笔记草稿资产 | 合理 | 保留 |
| `/content/video` 视频工坊 | 视频素材/脚本/成片生产 | 合理 | 保留 |
| `/content/face-swap` 视频换脸 | 特定视频能力 | 有意义但高风险 | 保留但应放在视频工坊子入口，并持续强调授权和风险复核 |
| `/content/optimization` 创作优化 | 把草稿加工成可发布版本，进入发布前检查 | 非常合理 | 保留并继续强化版本、对比、复核、发布准备闭环 |
| `/content/templates` 模板库 | 管理可复用内容模板 | 合理 | 保留 |
| `/content/styles` 品牌风格 | 管理品牌语气和表达风格 | 合理 | 保留 |

## 发布运营

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/distribution` 发布工作台 | 统一发布入口，管理图文/视频/账号/任务/记录 | 合理 | 保留 |
| `/distribution?tab=article` 图文发布 | 图文发布表单 | 合理 | 作为发布工作台 tab 合理，不必独立页面 |
| `/distribution?tab=video` 视频发布 | 视频发布表单 | 合理 | 同上 |
| `/distribution?tab=accounts` 平台账号 | 管理平台账号登录状态 | 合理 | 同上，可从设置和发布双入口进入 |
| `/distribution/compliance` 发布前检查 | 发布前风险检查、正式稿、负责人复核、发布准备 | 非常合理 | 保留，是商用闭环关键页 |
| `/distribution?tab=tasks` 发布任务 | 发布任务队列 | 合理 | 作为发布页 tab 合理 |
| `/distribution?tab=logs` 发布记录 | 发布结果和历史记录 | 合理 | 作为发布页 tab 合理 |

## 增长获客

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/growth` 增长总览 | 增长策略、线索、执行状态总览 | 合理 | 保留 |
| `/growth/strategies` 增长策略 | 管理获客策略 | 合理 | 可作为增长页 tab |
| `/growth/leads` 线索池 | 承接情报/互动产生的线索 | 合理 | 保留，需打通 CRM |
| `/growth/account-health` 账号健康 | 检查账号状态和风险 | 合理 | 保留 |
| `/growth/acquisition` 自动获客 | 自动获客任务配置和结果 | 合理但需强安全边界 | 保留 |
| `/growth/workflows` 获客流程 | 管理获客 SOP 流程 | 合理但名称偏抽象 | 可放为增长页 tab，普通用户更关注“获客计划” |
| `/growth/reports` 增长报表 | 复盘增长效果 | 合理 | 保留 |

## 客户互动

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/engagement` 统一收件箱 | 聚合各渠道互动任务 | 合理 | 保留为客户互动正门 |
| `/engagement/douyin-comments` 抖音评论 | 抖音评论处理 | 合理 | 保留 |
| `/engagement/douyin-messages` 抖音私信 | 抖音私信处理 | 合理 | 保留 |
| `/engagement/wechat` 微信任务 | 微信会话/任务总入口 | 合理但范围过大 | 保留，内部模块要清晰 |
| `/engagement/wechat-channel-comments` 视频号评论 | 视频号评论处理 | 合理 | 保留 |
| `/engagement/channel-messages` 视频号私信 | 视频号私信处理 | 合理 | 保留 |
| `/engagement/wechat-groups` 微信群 | 群发/群互动 | 合理 | 保留，但需强确认 |
| `/engagement/wechat-moments` 朋友圈 | 朋友圈发布/互动 | 合理 | 保留，但需强确认 |
| `/engagement/customers` 客户档案 | 从互动回到客户/CRM | 合理 | 保留 |
| `/engagement/comment-insights` 评论洞察 | 评论转痛点、需求、意向词 | 合理 | 保留；下游应到回复规则/CRM/选题 |
| `/engagement/wecom-assistant` 企微助手 | 企业微信群自动回复/建议 | 合理 | 保留，但默认应人工确认 |
| `/engagement/rules` 回复规则 | 管理回复规则和安全边界 | 合理 | 保留 |
| `/engagement/records` 回复记录 | 互动操作记录 | 合理 | 保留 |

## 应用与系统 / Admin

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/admin` 应用管理 | 当前复用 `/apps` | 作为别名合理，作为独立入口不合理 | 建议改为 `/apps` 正门，`/admin` 只给管理员 |
| `/admin/ai-employee` AI 员工应用 | 复用应用详情 | 别名合理 | 不作为普通业务入口 |
| `/admin/commercial-readiness` 商用就绪 | 商用检查和备份恢复 | 管理员合理 | 保留在管理区 |
| `/admin/account` 账号与套餐 | 账号、设备、订阅 | 管理员/用户合理 | 可放设置，不必在主业务流 |
| `/admin/connectors` 平台连接 | 当前复用 `/platforms` | 命名不清 | 建议统一为“平台账号”，不要同时叫 connectors |
| `/admin/users` 用户管理 | 团队/账号入口 | 管理员合理 | 保留 |
| `/admin/models` AI 能力设置 | 模型健康和默认模型 | 管理员合理 | 保留在设置 |
| `/admin/tools` 工具能力 | 自动化工具边界 | 管理员合理 | 保留但不放普通侧边栏 |
| `/admin/plugins` 扩展能力 | 扩展能力说明 | 管理员合理 | 保留但降权 |
| `/admin/memory` 历史偏好与资料 | 任务资料与记忆说明 | 合理但偏说明页 | 可并入设置 |
| `/admin/executor` 本机服务 | 复用本机服务页 | 管理员合理 | 保留但应隐藏底层细节 |
| `/admin/sandbox` 安全边界 | 权限和风险控制入口 | 管理员合理 | 保留 |
| `/admin/risk` 风险规则 | 风控策略 | 管理员合理 | 保留 |
| `/admin/local-engine` 本机服务 | 复用 `/local-engine` | 重复 | 建议只保留一个管理员入口 |
| `/admin/settings` 系统设置 | 复用 `/settings` | 合理别名 | 保留但不重复展示 |

## CRM

| 页面 | 意义 | 合理性 | 建议 |
|---|---|---|---|
| `/crm` 客户与机会 | 客户、公司、商机、备注中心 | 合理 | 保留 |
| `/crm/import` 数据导入 | CSV/表格等安全导入 | 合理 | 保留 |
| `/crm/closer` 成交助手 | 针对客户机会给成交建议 | 合理 | 保留；应与客户详情联动 |
| `/crm/connectors` CRM 连接 | 管理 Twenty、HubSpot、Salesforce 等连接 | 管理员合理 | 保留在 CRM 设置，不建议给普通运营频繁展示 |

## 旧入口和别名页

这些路由仍存在，但不应被理解为独立产品页面：

| 路由组 | 当前情况 | 建议 |
|---|---|---|
| `/articles`, `/materials`, `/topics`, `/strategies`, `/styles`, `/templates`, `/xiaohongshu`, `/video-workshop`, `/knowledge-base` | 老内容资产入口，很多已被 `/content/*` 包装 | 保留兼容，用户正门统一到 `/content/*` |
| `/workbench/*` | 老客户互动工作台入口 | 保留兼容，正门统一到 `/engagement/*` |
| `/interaction/*` | 老互动入口，部分仍被复用 | 保留兼容，逐步从导航移除 |
| `/agent-console`, `/agent-workbench`, `/sessions`, `/artifacts`, `/execution-records` | 老任务/记录入口 | 正门统一到 `/tasks/*`，旧入口做兼容 |
| `/capabilities/*` | 能力说明页 | 可保留，但不应和业务页同级 |
| `/admin/*` | 多数是复用其它页面 | 作为管理员别名可以，普通侧边栏不应暴露太多 |

## 全量路由逐页审查索引

下面按当前工作区内 129 个页面逐个归类。前面已经详细说明过的主业务页，这里只保留最短判断，方便后续做信息架构收口。

| 路由 | 页面意义 | 合理性与处理建议 |
|---|---|---|
| `/` | 今日待办和业务总入口 | 合理，保留为首页 |
| `/admin` | 应用市场的管理入口 | 作为管理入口合理，不应和 `/apps` 同时高亮 |
| `/admin/account` | 账号、套餐、设备管理 | 管理员合理，普通用户降权到设置 |
| `/admin/ai-employee` | AI 员工应用管理 | 作为管理入口合理，正门应是应用详情 |
| `/admin/commercial-readiness` | 商用就绪检查 | 管理员合理，保留在管理区 |
| `/admin/connectors` | 平台授权管理 | 合理但命名需统一为平台账号/授权 |
| `/admin/executor` | 本机处理能力 | 管理员合理，普通用户不应频繁看到 |
| `/admin/local-engine` | 本机服务状态 | 与 `/local-engine` 重复，保留一个正门 |
| `/admin/memory` | 记忆和资料能力 | 管理员合理，可并入设置 |
| `/admin/models` | AI 能力配置 | 管理员合理，普通业务侧降权 |
| `/admin/plugins` | 扩展能力 | 管理员合理，普通业务侧降权 |
| `/admin/risk` | 权限与安全 | 管理员合理，保留 |
| `/admin/sandbox` | 安全执行边界 | 管理员合理，普通业务侧降权 |
| `/admin/settings` | 系统配置 | 合理，但与 `/settings` 保持一个正门 |
| `/admin/tools` | 工具能力配置 | 管理员合理，普通业务侧降权 |
| `/admin/users` | 成员权限 | 管理员合理，保留 |
| `/agent-console` | 旧 AI 执行控制入口 | 有兼容意义，正门收口到 `/tasks` |
| `/agent-workbench` | 旧 AI 工作台入口 | 有兼容意义，正门收口到 `/tasks` |
| `/apps` | 应用市场/应用管理 | 合理，作为应用正门 |
| `/apps/ai-employee` | AI 员工应用详情 | 合理，但不宜和 admin 入口重复展示 |
| `/apps/auto-acquisition` | 自动获客应用配置 | 合理但与 `/growth/acquisition` 重叠，建议并入增长获客 |
| `/articles` | 文章资产旧入口 | 有兼容意义，正门收口到 `/content/articles` |
| `/artifacts` | 旧任务产物入口 | 有兼容意义，正门收口到任务记录/操作记录 |
| `/capabilities/account` | 账号能力说明/配置 | 管理说明页，普通用户降权 |
| `/capabilities/executor` | 本机处理能力 | 与本机服务重复，降权 |
| `/capabilities/memory` | 记忆能力说明 | 管理说明页，降权 |
| `/capabilities/models` | 模型能力配置 | 管理页，归入 AI 能力设置 |
| `/capabilities/plugins` | 插件能力说明 | 管理说明页，降权 |
| `/capabilities/risk` | 风险能力说明/配置 | 管理页，归入权限与安全 |
| `/capabilities/sandbox` | 安全执行能力说明 | 管理说明页，降权 |
| `/capabilities/tools` | 工具能力说明 | 管理说明页，降权 |
| `/capabilities/users` | 成员权限能力 | 管理页，可由 `/admin/users` 承接 |
| `/commercial-readiness` | 商用就绪检查正页 | 管理员合理，入口应放管理区 |
| `/confirmations` | 待确认动作旧入口 | 有兼容意义，正门收口到 `/tasks/confirmations` |
| `/content` | 内容资产正门 | 合理，保留 |
| `/content/articles` | 文章资产 | 合理，保留 |
| `/content/face-swap` | 视频换脸能力 | 有意义但高风险，应放视频子入口并强复核 |
| `/content/knowledge` | 知识库 | 合理，保留 |
| `/content/optimization` | 创作优化到发布前检查的桥 | 非常合理，保留为核心页 |
| `/content/strategies` | 内容策略 | 合理，保留 |
| `/content/styles` | 品牌风格 | 合理，保留 |
| `/content/templates` | 模板库 | 合理，保留 |
| `/content/topics` | 选题库 | 合理，保留 |
| `/content/video` | 视频工坊 | 合理，保留 |
| `/content/xiaohongshu` | 小红书笔记资产 | 合理，保留 |
| `/crm` | 客户与机会 | 合理，保留 |
| `/crm/closer` | 成交助手 | 合理，保留并与客户详情联动 |
| `/crm/connectors` | CRM 连接 | 管理员合理，放 CRM 设置 |
| `/crm/import` | 客户数据导入 | 合理，保留 |
| `/distribution` | 发布工作台 | 合理，保留 |
| `/distribution/compliance` | 发布前检查 | 非常合理，保留为核心安全页 |
| `/engagement` | 客户互动正门 | 合理，保留 |
| `/engagement/channel-messages` | 视频号私信 | 合理，保留 |
| `/engagement/comment-insights` | 评论洞察 | 合理，保留 |
| `/engagement/customers` | 互动客户档案 | 合理，保留并与 CRM 打通 |
| `/engagement/douyin-comments` | 抖音评论 | 合理，保留 |
| `/engagement/douyin-messages` | 抖音私信 | 合理，保留 |
| `/engagement/records` | 互动记录 | 合理，保留 |
| `/engagement/rules` | 回复规则 | 合理，保留 |
| `/engagement/wechat` | 微信任务 | 合理，保留 |
| `/engagement/wechat-channel-comments` | 视频号评论 | 合理，保留 |
| `/engagement/wechat-groups` | 微信群 | 合理但高风险，应强确认 |
| `/engagement/wechat-moments` | 朋友圈 | 合理但高风险，应强确认 |
| `/engagement/wecom-assistant` | 企微助手 | 合理，但默认人工确认 |
| `/execution-records` | 旧执行记录入口 | 有兼容意义，正门收口到 `/tasks/records` 或 `/tasks/evidence` |
| `/growth` | 增长总览 | 合理，保留 |
| `/growth/account-health` | 账号健康 | 合理，保留 |
| `/growth/acquisition` | 自动获客 | 合理但高风险，保留并强复核 |
| `/growth/leads` | 线索池 | 合理，保留并打通 CRM |
| `/growth/reports` | 增长报表 | 合理，可作为增长页内 tab |
| `/growth/strategies` | 增长策略 | 合理，可作为增长页内 tab |
| `/growth/workflows` | 获客流程 | 合理，可改名为获客计划并作为 tab |
| `/intelligence` | 情报工作台 | 合理，保留 |
| `/intelligence/accounts` | 对标账号 | 合理，保留 |
| `/intelligence/collaboration` | 团队协作 | 合理，低频可并入工作台 |
| `/intelligence/costs` | 积分明细 | 合理但偏管理，移到用量/账户 |
| `/intelligence/inbox` | 待处理线索 | 合理，保留 |
| `/intelligence/industries` | 行业来源 | 合理，配置属性较强 |
| `/intelligence/leads` | 线索洞察 | 合理，保留 |
| `/intelligence/monitors` | 自动监控 | 合理，保留 |
| `/intelligence/redfox` | 数据来源 | 管理员合理，普通业务侧降权 |
| `/intelligence/reports` | 报告中心 | 合理，保留 |
| `/intelligence/risks` | 情报风险审核 | 合理，保留 |
| `/intelligence/rules` | 情报风险规则 | 合理但偏配置，放二级设置 |
| `/intelligence/search` | 搜索研究 | 合理，保留 |
| `/intelligence/skills` | 情报功能模板 | 高级/管理员合理，普通业务侧降权 |
| `/intelligence/trends` | 热点趋势 | 合理，保留 |
| `/intelligence/viral` | 爆款拆解 | 合理，保留 |
| `/interaction/comment-insights` | 评论洞察旧入口 | 有兼容意义，正门收口到 `/engagement/comment-insights` |
| `/interaction/comments` | 评论处理旧入口 | 有兼容意义，正门收口到 `/engagement/douyin-comments` |
| `/interaction/customers` | 客户档案旧入口 | 有兼容意义，正门收口到 `/engagement/customers` |
| `/interaction/groups` | 微信群旧入口 | 有兼容意义，正门收口到 `/engagement/wechat-groups` |
| `/interaction/messages` | 私信旧入口 | 有兼容意义，正门收口到 `/engagement/douyin-messages` |
| `/interaction/moments` | 朋友圈旧入口 | 有兼容意义，正门收口到 `/engagement/wechat-moments` |
| `/interaction/records` | 互动记录旧入口 | 有兼容意义，正门收口到 `/engagement/records` |
| `/interaction/rules` | 回复规则旧入口 | 有兼容意义，正门收口到 `/engagement/rules` |
| `/interaction/wechat` | 微信任务旧入口 | 有兼容意义，正门收口到 `/engagement/wechat` |
| `/interaction/wecom-assistant` | 企微助手旧入口 | 有兼容意义，正门收口到 `/engagement/wecom-assistant` |
| `/knowledge-base` | 知识库旧入口 | 有兼容意义，正门收口到 `/content/knowledge` |
| `/local-engine` | 本机服务状态 | 管理员合理，普通用户降权 |
| `/materials` | 素材库旧入口 | 有兼容意义，正门收口到 `/content` |
| `/platforms` | 平台账号/授权 | 合理，建议与 `/admin/connectors` 统一命名 |
| `/release-notes` | 版本更新说明 | 合理但不是业务工作页，应放帮助/关于 |
| `/schedules` | 计划任务旧入口 | 有兼容意义，正门收口到 `/tasks/schedules` |
| `/sessions` | 旧任务会话入口 | 有兼容意义，正门收口到 `/tasks/runs` |
| `/settings` | 系统配置 | 管理员合理，正门与 `/admin/settings` 二选一 |
| `/solutions` | 方案中心 | 合理，保留 |
| `/strategies` | 内容策略旧入口 | 有兼容意义，正门收口到 `/content/strategies` |
| `/styles` | 品牌风格旧入口 | 有兼容意义，正门收口到 `/content/styles` |
| `/tasks` | AI 任务中心 | 合理，保留 |
| `/tasks/confirmations` | 待我确认 | 非常合理，保留 |
| `/tasks/evidence` | 操作记录/证据 | 合理，保留 |
| `/tasks/records` | 执行记录 | 合理，可与运行记录合并为页内切换项 |
| `/tasks/runs` | 任务运行 | 合理，可与执行记录合并为页内切换项 |
| `/tasks/schedules` | 计划任务 | 合理，保留 |
| `/templates` | 模板库旧入口 | 有兼容意义，正门收口到 `/content/templates` |
| `/topics` | 选题库旧入口 | 有兼容意义，正门收口到 `/content/topics` |
| `/video-workshop` | 视频工坊旧入口 | 有兼容意义，正门收口到 `/content/video` |
| `/war-room` | 战情室/风险聚合 | 有意义但当前更像说明页，应重做成异常处理页 |
| `/workbench` | 客户互动旧工作台 | 有兼容意义，正门收口到 `/engagement` |
| `/workbench/channel-comments` | 视频号评论旧入口 | 有兼容意义，正门收口到 `/engagement/wechat-channel-comments` |
| `/workbench/channel-messages` | 视频号私信旧入口 | 有兼容意义，正门收口到 `/engagement/channel-messages` |
| `/workbench/douyin-comments` | 抖音评论旧入口 | 有兼容意义，正门收口到 `/engagement/douyin-comments` |
| `/workbench/douyin-messages` | 抖音私信旧入口 | 有兼容意义，正门收口到 `/engagement/douyin-messages` |
| `/workbench/wechat` | 微信任务旧入口 | 有兼容意义，正门收口到 `/engagement/wechat` |
| `/workbench/wechat-channel-comments` | 视频号评论旧入口 | 有兼容意义，正门收口到 `/engagement/wechat-channel-comments` |
| `/workbench/wechat-groups` | 微信群旧入口 | 有兼容意义，正门收口到 `/engagement/wechat-groups` |
| `/workbench/wechat-moments` | 朋友圈旧入口 | 有兼容意义，正门收口到 `/engagement/wechat-moments` |
| `/xiaohongshu` | 小红书笔记旧入口 | 有兼容意义，正门收口到 `/content/xiaohongshu` |

## 关键不合理点

1. 页面数量过多，且很多是同一功能的不同路径包装。
2. `/admin/*`、`/capabilities/*`、`/local-engine` 对普通用户过重，容易破坏商用感。
3. `/engagement`、`/interaction`、`/workbench` 三套路由并存，信息架构需要收口。
4. `/content/*` 与旧内容路由并存是合理迁移阶段，但需要明确 `/content/*` 是唯一正门。
5. 增长模块 7 个入口逻辑成立，但更适合做成一个增长控制台下的页内切换项，减少侧边栏压力。
6. 情报模块能力很完整，但“数据来源/功能模板/积分明细”更像管理配置，不应和业务动作混在一起。

## 建议调整优先级

P0：
- 保留并打磨核心闭环：`/content/optimization` -> `/distribution/compliance` -> `/distribution` -> `/tasks/confirmations` -> `/tasks/evidence`。
- 侧边栏只保留新正门：`/content/*`、`/engagement/*`、`/tasks/*`。
- 旧入口不删除，但从可见导航中降级。

P1：
- 将 `/admin/*` 合并成“应用与系统”下 4-6 个真实管理入口。
- 将 `/growth/*` 从 7 个侧边栏项收敛为增长页内切换项。
- 将 `/intelligence/skills`、`/intelligence/redfox`、`/intelligence/costs` 移到设置/管理区域。

P2：
- 为每个核心业务页补“上一步来源”和“下一步动作”，避免页面像孤岛。
- 给旧入口加轻量跳转或正门标识，减少未来维护成本。

## 本次已验证

- 本地读取了 129 个功能页面。
- 读取了 82 个侧边栏入口。
- 已确认大量页面是复用同一功能的兼容入口，而不是独立功能。
- 页面级浏览器验证已在上一轮完成：129 页桌面可打开、无应用错误态、无明显内部词、首轮移动端无横向溢出。

## 未验证风险

- 本报告判断的是页面产品意义和信息架构合理性，不等同于每个按钮/表单的完整 E2E 验收。
- 部分页面是否高频使用，需要真实用户数据或埋点验证。
- 是否删除旧入口，需要先确认外部链接、收藏夹、桌面菜单和历史文档是否仍引用旧路由。
