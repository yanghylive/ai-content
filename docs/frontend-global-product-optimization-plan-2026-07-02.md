# 3010 前端全球一流产品对齐优化方案

日期：2026-07-02

## 这次重新检查了什么

本轮重新从三个层面看了 `http://127.0.0.1:3010/`：

1. 代码结构：统计 `frontend/src/app` 下所有 `page.tsx` 路由。
2. 导航结构：检查 `frontend/src/app/(dashboard)/sidebar-items.tsx`。
3. 浏览器轻量扫描：创建本地验收登录态，逐页打开 dashboard 路由，检查是否登录重定向、空白、console error。

硬事实：

- 前端总页面：132 个 `page.tsx`。
- dashboard 路由轻量扫描：129 个。
- 登录重定向：0。
- console error：0。
- 近乎空白页面：7 个。
- 左侧导航 `href`：91 个，去重后 82 个。
- 可见一级业务组：今日工作台、AI 任务中心、情报中心、内容资产、发布运营、增长获客、客户互动、应用与系统、CRM。

近乎空白或薄页面：

- `/capabilities/plugins`
- `/capabilities/sandbox`
- `/capabilities/tools`
- `/content/xiaohongshu`
- `/engagement/records`
- `/intelligence/collaboration`
- `/xiaohongshu`

高交互复杂页面集中在：

- `/distribution`
- `/solutions`
- `/video-workshop`
- `/apps/auto-acquisition`
- `/materials`
- `/crm`
- `/tasks/evidence`

## 全球标杆调研结论

参考样本：

- ChatGPT Projects：项目把聊天、文件、指令合在一个长期上下文里。
  来源：https://help.openai.com/en/articles/10169521-projects-in-chatgpt
- Claude Projects：项目是自包含工作区，有聊天历史和知识库。
  来源：https://support.anthropic.com/en/articles/9517075-what-are-projects
- Salesforce Console：用 workspace tab / subtab 让用户在一个屏幕处理主记录和关联记录。
  来源：https://help.salesforce.com/s/articleView?id=service.console_lex_intro.htm&type=5
- HubSpot CRM objects：围绕对象、记录、属性、关联组织业务。
  来源：https://knowledge.hubspot.com/records/understand-objects
- Zendesk Views：用视图把待处理 ticket 分成队列，帮助团队决定优先级。
  来源：https://support.zendesk.com/hc/en-us/articles/4408888828570-Creating-views-to-build-customized-lists-of-tickets
- Retool Workflow logs：每次成功/失败运行都有日志，能定位失败 block。
  来源：https://docs.retool.com/workflows/concepts/logs
- Carbon for AI：AI 必须被标记，能解释时要给解释入口。
  来源：https://carbondesignsystem.com/guidelines/carbon-for-ai/
- WCAG 2.2 Status Messages：状态消息需要被辅助技术识别，不应只靠 toast。
  来源：https://www.w3.org/TR/WCAG22/#status-messages

专家会共识：

这个项目目前不是“功能少”，而是“功能散”。左侧导航本身已经形成了业务分区，可以保留；真正的问题在于进入页面后，很多动作没有被同一套任务、确认、证据、审计模型收住。全球一流产品会保留用户熟悉的入口，但把入口后的操作闭环做一致。

## 最大的不合理

### 1. 导航不用大改，页面承接要变成工作系统

现有左侧导航有清楚的业务分区：

- `/tasks`
- `/intelligence`
- `/content`
- `/distribution`
- `/growth`
- `/engagement`
- `/admin`
- `/crm`

这个结构可以保留。需要优化的是：用户进入每个页面后，能不能立刻完成一个明确业务动作，能不能看到任务状态、失败原因、证据和下一步。

建议：左侧导航不动，改页面内部的信息架构和操作闭环。

### 2. 首页还不是指挥台

首页应该回答三件事：

- 今天我必须处理什么？
- 哪些任务卡住了？
- 哪些动作需要我确认？

现在首页是工作台和监控中心的混合，不够像“开工第一屏”。

### 3. 发布页太重

`/distribution` 轻量扫描看到：

- 文本长度 5069。
- 可见按钮 131。
- 表格 1。

说明发布页承载了太多操作：账号、图文、视频、任务、日志、预检、真实发布都挤在一起。商用级发布应该是对象视图 + stepper，不应该是一页全能控制台。

### 4. 方案中心像“功能入口”，还不像“任务启动器”

`/solutions` 有 29 个按钮、8 个输入，页面在做业务目标填写，但还没有完全接到统一任务运行、确认、证据和结果复盘。

建议：方案中心只负责“选择目标 -> 生成计划 -> 发起任务”。执行过程必须进入任务中心。

### 5. 客户互动底层路由重复，但左侧入口可以保留

有 `/engagement/*`，也有 `/interaction/*`，还有 `/workbench/*`。这会导致同一类业务分散在三套 URL 心智里。

建议：不改左侧导航。保留 `/engagement` 的现有入口；`/interaction` 和 `/workbench` 作为内部兼容路由或组件复用，不再新增面向用户的新入口。

### 6. 风险、证据、确认已有雏形，但还没全站化

`/tasks/evidence` 已经能承接高风险审计和 Agent 过程证据，这是对的。但素材删除、账号删除、批量触达、自动获客、CRM 导入等动作还没有全部统一到同一条链路：

`意图 -> 预检 -> 确认 -> 执行 -> 结果 -> 证据 -> 审计`

### 7. 空白/薄页面仍然占入口

7 个路由技术上加载成功，但页面几乎没有内容。它们可以不影响左侧导航，但不能让用户点进去后像撞到空房间。

处理方式只有三种：

- 在原入口里补成真正可操作页面。
- 作为兼容路由跳到已有完整页面。
- 从页面内部的快捷入口中移除，避免误触。

## 推荐的目标产品模型

把产品收束成“企业 AI 运营控制台”：

### 1. 今日

用户开工第一屏。

页面：

- `/`
- `/war-room`
- `/solutions`

功能：

- 今日待处理队列
- 待确认动作
- 失败/阻断任务
- 可继续任务
- 推荐下一步
- 方案启动入口

### 2. 任务

所有长任务和高风险动作统一归口。

页面：

- `/tasks`
- `/tasks/confirmations`
- `/tasks/runs`
- `/tasks/evidence`
- `/tasks/schedules`

功能：

- 运行中任务
- 待我确认
- 失败重试
- 执行记录
- 证据包
- 审计日志
- 计划任务

`/execution-records`、`/confirmations`、`/artifacts` 应逐步合并或跳转到这里。

### 3. 对象库

把“素材、内容、客户、线索、账号、知识源”变成统一对象库。

页面：

- `/content`
- `/content/knowledge`
- `/content/topics`
- `/content/articles`
- `/content/templates`
- `/content/styles`
- `/crm`
- `/growth/leads`
- `/distribution?tab=accounts`

功能：

- 列表
- 详情抽屉
- 关联对象
- 时间线
- 使用记录
- 进入任务

### 4. 发布

发布是一个高风险工作流，不是普通表单。

页面：

- `/distribution`
- `/distribution/compliance`

建议拆成：

- 发布任务
- 平台账号
- 内容选择
- 预检合规
- 发布日志
- 发布证据

真实发布必须是：

`选择内容 -> 选择账号 -> 预检 -> 风险确认 -> 执行 -> 平台证据 -> 审计留痕`

### 5. 情报

情报中心应从“多个分析页面”变成“发现队列 + 派发系统”。

页面：

- `/intelligence`
- `/intelligence/search`
- `/intelligence/inbox`
- `/intelligence/trends`
- `/intelligence/reports`
- `/intelligence/monitors`

功能：

- 收集来源
- 发现队列
- 证据引用
- 派发到选题/素材/线索/任务
- 报告归档

### 6. 客户互动

客户互动应按“下一个要处理的人/机会”组织，而不是按渠道散页。

页面：

- `/engagement`
- `/engagement/customers`
- `/engagement/rules`
- `/engagement/comment-insights`
- `/engagement/wecom-assistant`

功能：

- 统一收件箱
- 客户档案
- 会话时间线
- 推荐回复
- 人工确认
- 自动/半自动触达任务
- 互动证据

`/interaction/*` 和 `/workbench/*` 作为兼容层，不继续当主入口。

### 7. 增长

增长要从“功能面板”改成“策略 -> 线索 -> 工作流 -> 报告”。

页面：

- `/growth`
- `/growth/strategies`
- `/growth/leads`
- `/growth/workflows`
- `/growth/reports`
- `/growth/account-health`

功能：

- 策略配置
- 线索队列
- 账号健康
- 工作流执行
- 失败/阻断
- 结果复盘

### 8. 管理

管理区只放系统级设置，不放普通用户日常工作。

页面：

- `/admin`
- `/admin/users`
- `/admin/connectors`
- `/admin/risk`
- `/admin/local-engine`
- `/admin/settings`
- `/admin/models`
- `/admin/tools`
- `/admin/plugins`

功能：

- 成员权限
- 连接器
- 风控策略
- 本机引擎诊断
- 模型/工具/插件配置

## 左侧导航处理原则

左侧导航保留现状，不作为本轮改造对象。

后续只做三类不破坏导航心智的调整：

- 页面内闭环：每个入口进去后，页面自己负责讲清楚“现在能做什么、下一步是什么、失败怎么处理”。
- 兼容路由收口：旧路由可以保留，但内部跳转或复用完整页面，不再做新的半成品入口。
- 薄页面补齐：空白/薄页面要么补成交付闭环，要么在页面内部给出明确去向。

## 页面级改法

### 首页

从“监控面板”改成“今日处理队列”。

必须有：

- 待确认
- 失败任务
- 阻断发布
- 今日线索
- 待回复客户
- 最近证据
- 一键继续

### 任务中心

成为全站任务收口。

每个任务都要有：

- 状态
- 当前步骤
- 失败原因
- 下一步
- 重试/继续/取消
- 证据
- 审计

### 证据中心

保留现方向，继续扩展到所有高风险动作。

新增：

- 按对象过滤
- 按操作者过滤
- 按风险等级过滤
- 导出证据包
- 从证据反查任务
- 从证据反查对象

### 发布中心

从超大页拆成 stepper。

必须支持：

- 内容选择
- 账号选择
- 预检
- 高风险确认
- 执行
- 平台证据
- 失败重试
- 回滚/撤销说明

### 素材库

从“文件列表”升级成对象库。

必须有：

- 详情抽屉
- 使用历史
- 关联内容
- 关联发布
- 删除预检
- 撤销或恢复策略
- 批量操作预览

### 情报中心

保留 command center，收掉薄壳页面。

必须有：

- 来源
- 证据
- 可信度
- 派发动作
- 后续任务状态

### 客户互动

从渠道页优先，改成客户/机会优先。

必须有：

- 下一个要处理的人
- 客户时间线
- 推荐回复原因
- 人工确认
- 发送证据
- 失败兜底

### 增长

必须变成策略闭环：

`策略 -> 线索 -> 触达 -> 结果 -> 复盘`

不要让用户在多个页面之间猜流程。

### 管理/本机引擎

普通用户不应该经常看本机引擎细节。

建议：

- 普通页只显示“可用 / 不可用 / 怎么修”。
- 管理页才显示 Runtime、权限、日志、诊断。

## 落地路线

### 第 1 周：保留导航，收口页面闭环

- 左侧导航不改。
- 处理 7 个空白/薄页面：补齐内容、跳转到完整页面，或给出明确去向。
- `/interaction/*`、`/workbench/*` 保留兼容，但不继续新增独立操作模型。
- `/execution-records`、`/confirmations`、`/artifacts` 保留路由兼容，页面内部统一指向任务、确认、证据模型。
- 首页、发布、客户、增长这些高频入口先补“下一步动作”和“失败修复入口”。

验收：

- 左侧导航视觉和分组不变。
- 0 个空白/薄页面让用户无路可走。
- 高频页面都有明确主动作、下一步、失败处理入口。

### 第 2-3 周：任务中心全站化

- 所有长任务进入 `/tasks/runs`。
- 所有待确认进入 `/tasks/confirmations`。
- 所有证据进入 `/tasks/evidence`。
- 高风险动作统一确认弹窗。

验收：

- 任意长任务 1 秒内可在任务中心看到。
- 任意高风险动作都有确认记录。
- 任意失败任务都有失败步骤和下一步。

### 第 3-5 周：发布中心重构

- `/distribution` 拆成 stepper。
- 真实发布必须有预检、确认、证据。
- 发布日志和证据打通任务中心。

验收：

- 真实发布不能绕过预检。
- 发布失败能定位到账号/素材/平台/权限/接口哪一层。
- 发布成功必须有平台回执或页面回读证据。

### 第 4-6 周：客户互动和增长闭环

- 客户互动按客户/机会组织。
- 增长按策略/线索/工作流/报告组织。
- 每次触达都有证据。

验收：

- 用户可以从首页直接处理下一个客户。
- 触达结果能回写客户时间线。
- 增长工作流失败能在任务中心修复。

### 第 6-8 周：对象库和设计系统统一

- 素材、文章、客户、线索、账号统一对象页形态。
- 统一空态、错误、加载、权限、AI 标签、证据组件。

验收：

- 所有对象都有列表、详情、关联、时间线。
- 所有 AI 建议都有 AI 标识和解释入口。
- 关键流程键盘可达。

## 最终验收标准

- 左侧导航保持现有结构，不做重排。
- 0 个空白/薄壳页面让用户无路可走。
- 所有高风险动作都有：预检、确认、执行结果、证据、审计。
- 所有长任务都有：状态、步骤、失败原因、重试、证据。
- 所有 AI 输出都有：AI 标识、依据、可编辑/可拒绝。
- 所有 API 失败都有：错误步骤、影响对象、重试入口、日志入口。
- 首页能完成 80% 日常处理入口。
- 发布、删除、触达、审批、搜索能键盘完成。

## 一句话结论

这个项目的前端不是缺页面，而是页面进入后的闭环不够统一。左侧导航保留，下一步不要继续加新入口，应该把现有入口后的页面做实：今日开工、任务归口、对象沉淀、证据追溯、高风险可审计。
