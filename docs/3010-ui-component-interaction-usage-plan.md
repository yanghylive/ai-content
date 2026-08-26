# 3010 UI 组件与交互动效使用方案

> 版本：v1.0  
> 日期：2026-08-23  
> 适用项目：`ai-content` / 3010   
> 参考附件：`/Users/yanghy/Desktop/UI组件与交互动效AI描述指南.md`、`/Users/yanghy/Desktop/UI组件演示系统.html`

## 0. 结论先行

附件不是一套需要整体照搬的视觉主题，而是一套交互词典：7 大类、47 个组件，以及每类一条“怎么向 AI 描述交互”的公式。3010 应该把它用作统一交互语言和验收口径，按业务风险、信息密度、设备和任务阶段选用组件。

本方案不建议给所有页面加动画，也不建议复制演示页的深紫色配色。3010 已有 HeroUI、Radix、Recharts、Skeleton、风险确认、移动端底栏、Onboarding、Agent 状态抽屉和生命周期 Stepper，实施重点是统一行为、状态和可访问性，避免再造第二套基础组件。

本次已对 `frontend/src/app` 下全部 211 个 `page.tsx` 路由文件、共享 Shell、移动端导航和主要 UI 基础件做静态盘点。本文是使用方案，不是代码已经完成的验收报告。

## 1. 附件内容拆解

### 1.1 47 个组件的分类

| 类别 | 数量 | 组件 | 3010 的主要用途 |
|---|---:|---|---|
| 弹层 | 6 | Tooltip、Popover、Dropdown、Modal、Drawer、Bottom Sheet | 解释、轻量操作、选择、风险确认、详情保留上下文、移动端操作 |
| 加载 | 7 | Spinner、Progress Bar、Circular Progress、Skeleton、Shimmer、Button Loading、Page Loader | 等待反馈、可计算进度、页面稳定、提交防连点 |
| 新手引导 | 6 | Product Tour、Coach Mark、Hotspot、Spotlight、Checklist、Context Hint | 首次激活、新功能提示、强制单步、表单情境说明 |
| 图表交互 | 7 | Brush Selection、Crosshair、Data Point Highlight、Tooltip、Legend Filter、Zoom、Drill Down | 获客、内容、账号、成本和执行结果的分析探索 |
| 导航 | 7 | Tabs、Segmented Control、Breadcrumb、Pagination、Stepper、Sidebar、Bottom Navigation | 场景导航、页内切换、层级返回、分页和流程推进 |
| 拖拽 | 6 | Reorder、Drop Zone、Placeholder、Cross-list Transfer、Auto Scroll、Snap Back | 素材、工作流、任务列、账号/渠道分组和文件导入 |
| 内容展开 | 8 | Accordion、Collapse、Tree View、Expandable Row、Read More、Load More、Expandable Card、Drawer | 高密度信息渐进披露、树结构、表格详情、长文和卡片详情 |

### 1.2 附件演示页真正值得复用的部分

演示 HTML 的价值主要是四点：

1. 用分类 Tab、数量徽章和搜索框把组件当作可检索的词典。
2. 每个组件同时展示特点、触发方式和 AI 描述示例，避免只说“做个弹窗”。
3. 网格/列表切换和完整对照矩阵适合做开发、评审和验收的查阅结构。
4. SVG 循环动画只用于说明时序，不能直接当成业务中的假进度或假执行反馈。

### 1.3 七条描述公式

| 类别 | 公式 | 3010 书写时必须补齐 |
|---|---|---|
| 弹层 | 组件名称 + 怎么触发 + 从哪里出现 + 是否先处理 | 触发、锚点/方向、是否阻塞、关闭条件 |
| 加载 | 动效名称 + 等待时长 + 使用场景 | 是否可计算、超时、失败和重试 |
| 引导 | 组件名称 + 出现时机 + 指向目标 + 操作反馈 + 完成状态 | 首次/情境/新功能、目标、跳过和记忆状态 |
| 图表 | 交互名称 + 触发方式 + 联动变化 + 最终状态 | 选中范围、联动指标、返回/清除状态 |
| 导航 | 组件名称 + 放在哪里 + 切换什么内容 + 当前项怎么高亮 | URL、页内状态、当前项、返回路径 |
| 拖拽 | 什么能拖 + 哪里能接收 + 拖动中提示 + 松手后结果 | 可接收/禁止状态、占位、回弹、数据回执 |
| 展开 | 组件名称 + 内容类型 + 展开方向 + 收起方式 | 互斥/独立、原位/侧边、滚动位置、关闭规则 |

## 2. 3010 现有基础与需要收口的缺口

### 2.1 已有能力，优先复用

- 全局桌面场景导航和 Sidebar：`frontend/src/components/shell/app-shell.tsx`。
- 移动端 5 项 Bottom Navigation：`frontend/src/components/shell/mobile-shell.tsx`、`mobile-tab-bar.tsx`。
- 首次激活引导和激活清单：`frontend/src/components/shell/onboarding-guide.tsx`。
- HeroUI Modal、风险确认 Modal、Radix Dialog/Dropdown/Tabs/Tooltip/Progress。
- SkeletonRow、V2Disclosure、V2OptionCard、V2 按钮 loading。
- Agent 状态 Drawer、Agent 生命周期 Stepper、Agent-S 状态面板。
- Recharts 和 Agent Cockpit 的图表渲染基础。

### 2.2 需要统一，不要在页面里各写一份

1. **Overlay contract**：统一 Tooltip/Popover/Dropdown/Modal/Drawer 的关闭、焦点返回、Escape、点击外部、移动端替换规则。
2. **Loading contract**：统一 `idle/loading/success/error/timeout`，禁止用无限 Spinner 伪装未知进度，禁止按钮重复提交。
3. **Guide contract**：统一引导版本、跳过、完成、目标不存在时的降级和埋点。
4. **Chart contract**：统一 tooltip、十字准线、图例开关、范围选择、缩放和下钻后的 URL/返回路径。
5. **Drag contract**：统一可接收/禁止、占位、跨列、边缘滚动、回弹和服务端失败回滚。
6. **Disclosure contract**：统一 Accordion、Collapse、Tree、Expandable Row、Read More、Load More 的 ARIA 和滚动保持。
7. **Motion contract**：全部使用 Kaypal v3 token；支持 `prefers-reduced-motion`，动画服务于状态变化，不做装饰性循环。

## 3. 建议的共享交互层

建议在现有组件体系之上收口一个轻量目录（名称可调整）：

```text
frontend/src/components/interaction/
  overlay.tsx       # Tooltip / Popover / Dropdown / Modal / Drawer / BottomSheet 适配层
  loading.tsx       # Spinner / Progress / Skeleton / ButtonLoading / PageLoader
  guide.tsx         # Tour / CoachMark / Hotspot / Spotlight / Checklist / ContextHint
  chart.tsx         # Crosshair / Brush / Highlight / Legend / Zoom / DrillDown 约束
  navigation.tsx    # Tabs / Segmented / Breadcrumb / Pagination / Stepper
  drag.tsx          # Reorder / DropZone / Placeholder / CrossList / AutoScroll / SnapBack
  disclosure.tsx    # Accordion / Collapse / Tree / Row / ReadMore / LoadMore / Card
  state-machine.ts  # 统一 loading、错误、超时、回滚状态
```

实现约束：

- 复用 `@heroui/react`、Radix、现有 `V2` 件和 `kaypal-v3` token，不再创建另一套颜色和圆角体系。
- Modal/Drawer 必须有焦点陷阱、Esc、关闭后焦点返回、`aria-labelledby` 和 `aria-describedby`。
- Tooltip 只放一句短说明；带按钮或多字段说明必须升级为 Popover/Drawer。
- Button Loading 必须禁用再次点击，并保留失败后的重试入口；Progress 只绑定真实进度。
- 桌面 Drawer 默认保留页面上下文；窄屏自动切 Bottom Sheet 或全屏 Sheet。
- 所有拖拽操作必须提供键盘/按钮替代路径；服务端失败必须 Snap Back 并恢复原数据。
- 所有图表交互必须有移动端替代（点击数据点、范围按钮、日期选择器），不能只依赖 hover/滚轮。

## 4. 页面优化 Profile

下表是后续页面改造的“行为模板”。同一 Profile 内的页面共用组件和验收标准，页面只补业务字段，不重复设计。

| Profile | 页面类型 | 组件组合 | 关键行为 |
|---|---|---|---|
| P00 | Shell、首页、认证、轻量系统页 | Sidebar/Bottom Navigation、Page Loader、Skeleton、Tooltip、Product Tour | URL 决定当前场景；首屏稳定后淡出；首次用户可跳过并记忆；移动端固定底栏 |
| P01 | 今日增长、获客总览、线索池 | Tabs、Segmented、Skeleton/Shimmer、Circular Progress、Crosshair、Data Point Highlight、Tooltip、Legend Filter、Drill Down、Drawer、Pagination、Expandable Row | 总览→渠道→线索明细可下钻；筛选和图表汇总同步；详情用 Drawer 保留列表上下文 |
| P02 | 获客创建、策略、工作流、RPA 编排 | Stepper、Product Tour、Checklist、Context Hint、Dropdown/Popover、Button Loading、Progress、Reorder、Placeholder、Cross-list、Auto Scroll、Snap Back、Modal | 先配置再预览再执行；节点拖动有占位和非法回弹；执行按钮防连点；高风险动作先确认 |
| P03 | CRM、客户、连接器、导入列表 | Tabs、Segmented、Skeleton、Pagination、Expandable Row、Drawer、Dropdown、Tooltip、Modal、Bottom Sheet | 列表筛选和分页不丢查询；行详情原位展开；完整编辑用 Drawer；删除/归档必须 Modal |
| P04 | 客户详情、商机、成交跟进 | Breadcrumb、Tabs、Drawer、Accordion/Collapse、Read More、Expandable Row、Context Hint、Modal/Risk Modal | 维持客户上下文；时间线和字段渐进披露；外发/成交等外部动作走风险确认 |
| P05 | 内容创作、AI 生成、编辑和对比 | Stepper、Tabs、Segmented、Context Hint、Drop Zone、Button Loading、Progress、Skeleton、Read More、Expandable Card、Drawer、Modal | 输入→生成→预览→保存/发布状态明确；素材拖入时高亮；长文原位展开；生成失败可重试 |
| P06 | 发布、分发、平台账号、排期 | Stepper、Tabs、Dropdown、Progress、Button Loading、Modal、Drawer、Reorder、Placeholder、Cross-list、Auto Scroll、Snap Back、Pagination | 账号/渠道/发布时间按步骤确认；任务进度是真实进度；跨渠道排序失败回弹；批量发布需风险确认 |
| P07 | 消息、评论、客服、微信互动 | Tabs、Segmented、Drawer、Expandable Row、Load More、Read More、Bottom Sheet、Button Loading、Modal/Risk Modal、Context Hint | 会话列表和详情保留滚动位置；历史记录 Load More；发送/群发防连点；移动端操作放 Bottom Sheet |
| P08 | 情报、趋势、报告、成本、战情室 | Tabs、Segmented、Breadcrumb、Crosshair、Brush、Data Point Highlight、Tooltip、Legend Filter、Zoom、Drill Down、Skeleton、Drawer、Pagination | 图表交互联动指标；时间范围可回退；下钻更新标题/面包屑/URL；导出或触达等动作与分析解耦 |
| P09 | AI 助手、Agent、应用和任务工作台 | Product Tour、Coach Mark、Spotlight、Checklist、Context Hint、Stepper、Spinner、Progress、Button Loading、Drawer、Read More、Modal | “意图→审批→执行→证据→结果”始终可见；正在执行可取消/重试；解释单控件用 Coach Mark，不用大弹窗 |
| P10 | 本地引擎、浏览器、桌面、任务和证据 | Stepper、Spotlight、Checklist、Context Hint、Page Loader、Spinner、Progress、Tree View、Accordion、Expandable Row、Drawer、Modal/Risk Modal、Snap Back | 执行前显示权限和风险；过程实时更新；证据缺失进入阻塞态；文件/任务树可逐层展开；无效操作不改变状态 |
| P11 | 知识库、素材库、收藏和资产 | Tree View、Drop Zone、Reorder、Placeholder、Load More、Read More、Expandable Card、Drawer、Skeleton/Shimmer、Dropdown | 文件夹层级清晰；上传区域只在可接收时高亮；卡片先摘要后详情；批量移动同步两侧数量 |
| P12 | 管理后台、能力、设置、账号和设备 | Sidebar、Breadcrumb、Tabs、Segmented、Accordion、Collapse、Tree View、Expandable Row、Tooltip、Popover、Modal、Skeleton | 桌面高密度导航稳定；配置分组渐进披露；敏感配置 Modal；账号/设备详情 Drawer；移动端改为 Bottom Sheet |
| P13 | 案例、演示、视频、样式和省钱模块 | Tabs、Segmented、Expandable Card、Read More、Load More、Drawer、Bottom Sheet、Progress、Button Loading、Tooltip | 先看摘要再看完整案例；媒体生成显示真实进度；移动端操作底部化；营销型页面不强制复杂引导 |
| P14 | 合规、风险、法律和系统工具 | Accordion、Collapse、Context Hint、Modal/Risk Modal、Page Loader、Skeleton、Breadcrumb、Tabs | 先解释影响再确认；合规内容可分组展开；不可绕过的风险动作阻塞背景；失败状态给出下一步 |

## 5. 211 个路由的完整归属与使用方式

### 5.1 归属规则

路由按“主任务”归属一个 Profile；同一页面内部可以组合多个组件，但不跨 Profile 复制一套 UI。下面的映射表是实施时的入口：先套 Profile，再按页面数据量决定是否启用次级组件。

| Profile | 路由 |
|---|---|
| P00 | 根路由 `/`、`/today`、`/mine`、`/login`、`/dev-clear-browser-cache` |
| P01 | `/growth`、`/growth/account-health`、`/growth/leads`、`/growth/reports` |
| P02 | `/apps/auto-acquisition`、`/auto-acquisition/create`、`/growth/acquisition`、`/growth/rpa-workbench`、`/growth/strategies`、`/growth/workflows`、`/strategies`、`/strategies/new`、`/strategies/edit`、`/solutions`、`/solutions/configure`、`/solutions/run` |
| P03 | `/crm`、`/crm/customer`、`/crm/import`、`/crm/connectors`、`/crm-import`、`/crm-import/flow`、`/crm-connectors`、`/customer`、`/boss-recruit`、`/wecom-crm` |
| P04 | `/crm/closer`、`/crm-closer`、`/growth/leads/detail` |
| P05 | `/content`、`/content/articles`、`/content/ai-image-gen`、`/content/ai-video-gen`、`/content/face-swap`、`/content/image-gen`、`/content/optimization`、`/content/wechat-official-assistant`、`/content/workspace`、`/content/xiaohongshu`、`/content/xiaohongshu-assistant`、`/copy-compare`、`/face-swap`、`/poi`、`/reply`、`/seedance-video`、`/styles`、`/styles/new`、`/styles/edit`、`/templates`、`/templates/new`、`/templates/edit`、`/topics`、`/topics/new`、`/video-download`、`/video-generation`、`/video-studio`、`/video-workshop`、`/video/product-cut`、`/video/release-plans` |
| P06 | `/accounts-matrix`、`/distribution`、`/distribution/accounts`、`/distribution/articles`、`/distribution/compliance`、`/distribution/logs`、`/distribution/publish-article`、`/distribution/publish-video`、`/distribution/scrape`、`/distribution/tasks`、`/platforms`、`/platforms/new`、`/platforms/edit`、`/schedules`、`/schedules/edit` |
| P07 | `/message`、`/engagement`、`/engagement/channel-messages`、`/engagement/comment-acquisition`、`/engagement/comment-insights`、`/engagement/customer-service`、`/engagement/customers`、`/engagement/douyin-comments`、`/engagement/douyin-messages`、`/engagement/records`、`/engagement/rules`、`/engagement/wechat`、`/engagement/wechat-channel-comments`、`/engagement/wechat-groups`、`/engagement/wechat-moments`、`/engagement/wechat-moments/detail`、`/engagement/wechat/chat-history`、`/engagement/wechat/contact-add`、`/engagement/wechat/contacts`、`/engagement/wechat/friend-accept`、`/engagement/wechat/mass-send`、`/engagement/wechat/moments-publish`、`/engagement/wechat/plans`、`/engagement/wecom-assistant`、`/wecom-assistant` |
| P08 | `/effects`、`/intelligence`、`/intelligence/accounts`、`/intelligence/collaboration`、`/intelligence/costs`、`/intelligence/inbox`、`/intelligence/inbox-processing`、`/intelligence/industries`、`/intelligence/leads`、`/intelligence/monitor-new`、`/intelligence/monitors`、`/intelligence/redfox`、`/intelligence/report-new`、`/intelligence/reports`、`/intelligence/risks`、`/intelligence/rules`、`/intelligence/search`、`/intelligence/skills`、`/intelligence/trends`、`/intelligence/viral`、`/war-room`、`/viral-analysis` |
| P09 | `/agent`、`/agent-workbench`、`/agent-cockpit-canvas`、`/apps`、`/apps/ai-employee`、`/apps/detail`、`/artifacts` |
| P10 | `/admin/executor`、`/admin/local-engine`、`/admin/sandbox`、`/approvals`、`/local-engine`、`/local-engine/ai-action`、`/local-engine/browser`、`/local-engine/browser/agent`、`/local-engine/desktop`、`/local-engine/evidence`、`/local-engine/files`、`/local-engine/logs`、`/local-engine/permissions`、`/local-engine/remote`、`/local-engine/run`、`/local-engine/tasks`、`/local-engine/workbench`、`/mai-ui`、`/task-evidence`、`/tasks`、`/tasks/confirmations`、`/tasks/evidence`、`/tasks/records`、`/tasks/runs`、`/risk-confirm`、`/device-center` |
| P11 | `/content/collection-center`、`/collections/[slug]`、`/knowledge`、`/knowledge-base`、`/knowledge-base/new`、`/materials` |
| P12 | `/admin`、`/admin/account`、`/admin/ai-employee`、`/admin/commercial-readiness`、`/admin/connectors`、`/admin/memory`、`/admin/models`、`/admin/plugins`、`/admin/redfox`、`/admin/redfox-skills`、`/admin/risk`、`/admin/savings`、`/admin/settings`、`/admin/tools`、`/admin/users`、`/capabilities`、`/capabilities/account`、`/capabilities/executor`、`/capabilities/memory`、`/capabilities/models`、`/capabilities/models/new`、`/capabilities/models/edit`、`/capabilities/plugins`、`/capabilities/risk`、`/capabilities/sandbox`、`/capabilities/tools`、`/capabilities/users`、`/commercial-readiness`、`/mobile-capabilities`、`/settings`、`/settings/memory`、`/settings/legal`、`/savings`、`/savings/orders`、`/savings/wallet` |
| P13 | `/cases`、`/cases/[slug]`、`/case-admin`、`/case-admin/new`、`/case-admin/[id]`、`/demo-request`、`/demo/video-studio`、`/demo/wechat-personal`、`/release-notes` |
| P14 | `/compliance`、`/compliance-check` |

### 5.2 页面类型到具体组件的快速对照

| 页面遇到的结构 | 直接采用 | 不要采用 |
|---|---|---|
| 图标或字段旁一句解释 | Tooltip | Modal、长 Popover |
| 轻量说明或 1-2 个操作 | Popover | 阻塞式 Modal |
| 更多操作、批量筛选、单选 | Dropdown | 一堆横向按钮 |
| 删除、发布、外部触达、权限变化 | Modal/Risk Modal | 点击后直接执行 |
| 列表查看详情或编辑 | Drawer / Expandable Row | 离开列表跳新页再返回 |
| 移动端分享、批量操作、筛选 | Bottom Sheet | 桌面右侧窄 Drawer 原样缩小 |
| 不知道耗时的请求 | Spinner + 状态文字 | 假百分比 |
| 有后端进度的上传/生成/发布 | Progress Bar | 无限循环动画 |
| 首屏列表/卡片请求 | Skeleton/Shimmer | 空白页或布局跳动 |
| 2-4 个互斥视图 | Segmented Control | 多层 Tabs |
| 同页并列内容 | Tabs | 用路由刷新整页 |
| 多步创建/执行 | Stepper | 把步骤藏在一长页里 |
| 表格的低频详情 | Expandable Row | 每行塞满所有字段 |
| 长文、评论、报告摘要 | Read More | 强制全文占满首屏 |
| 大量列表追加 | Load More | 每次回到第一页 |
| 树形目录/权限/文件 | Tree View | 用缩进文本伪装层级 |

## 6. 桌面端与移动端分别落地

### 6.1 桌面端

- 继续使用现有 Sidebar 和场景路由，不把 7 类组件全部放进全局导航。
- P01/P08 的图表优先启用 Crosshair、Tooltip、Legend Filter、Drill Down；Brush/Zoom 只在数据量确实需要时开启。
- P03/P06/P10 的高密度表格使用 Expandable Row + Drawer，详情不应把表格撑成不可扫描的长卡片。
- P02/P06/P10 的拖拽区域必须显示占位和可放置状态，并提供撤销或失败回滚。
- 所有弹层的层级、焦点和关闭规则统一；危险操作不允许用 Dropdown 直接执行。

### 6.2 移动端

- 保留现有 5 项 Bottom Navigation：今天、内容、互动、线索、客户；不要把设置和执行再塞进底栏。
- Drawer 在手机上默认变成半屏或全屏 Bottom Sheet，顶部必须有拖拽条和明确关闭入口。
- Hover-only Tooltip、Crosshair、Zoom、Brush 必须改成点击数据点、日期快捷项、范围按钮或可滚动表格。
- 表格改为卡片摘要 + Expandable Card/Drawer；批量操作、分享、筛选集中在 Bottom Sheet。
- 拖拽排序提供长按拖拽和“上移/下移”按钮双通道；自动滚动和 Snap Back 在触摸屏必须可见。
- 生成、发布、群发等按钮保持 44px 以上触控区域；加载状态不可因文字变化导致布局跳动。

## 7. 实施顺序

### P0：先统一可靠性

1. 收口 Overlay、Loading、错误/超时/重试状态。
2. 把发布、群发、外部触达、权限、删除等高风险动作统一接入 Modal/Risk Modal。
3. 修正 Agent、本地引擎、任务和证据页的 Stepper/Drawer 状态，使“执行中、等待确认、失败、证据缺失”可区分。
4. 为所有首屏列表补 Skeleton，移除空白等待和假进度。

### P1：再提升核心业务效率

1. P01/P08 图表交互和下钻。
2. P02/P06 的 Stepper、拖拽占位、跨列表和失败回滚。
3. P03/P04/P07 的列表详情 Drawer、Expandable Row、Load More、移动端 Bottom Sheet。
4. P05 的生成流程、素材 Drop Zone、Button Loading 和失败重试。

### P2：最后做学习成本和细节

1. Product Tour、Coach Mark、Hotspot、Spotlight、Checklist、Context Hint 的版本化和埋点。
2. P11/P12 的 Tree View、Accordion、Collapse、渐进式披露。
3. P13 的案例/媒体/省钱页面渐进展开和移动端适配。

## 8. 验收标准

### 功能状态

- 每个异步动作都能区分 idle、loading、success、error、timeout；失败有重试或下一步。
- 真实进度只显示后端/任务返回的进度；没有接口进度时不显示百分比。
- Modal、Drawer、Bottom Sheet 关闭后焦点回到触发点；Esc、点击外部和返回键行为明确。
- 所有列表筛选、分页、Load More、展开详情不丢失查询条件和滚动位置。
- 拖拽无效落点不改数据；服务端失败能 Snap Back；跨列表数量同步。
- 图表下钻后标题、面包屑、图表、返回路径一致；移动端有非 hover 操作。

### 视觉和动效

- 只使用 Kaypal v3 令牌，不复制附件演示页的紫色/橙色主题。
- 动画只表达出现、切换、进度、回弹和完成，不做无意义的循环装饰。
- 支持 `prefers-reduced-motion`；关闭动画后信息和状态仍完整。
- 按钮、卡片、表格行、拖拽占位在状态变化时尺寸稳定，不发生内容跳动。

### 产品指标

- 首次激活完成率：Product Tour/Checklist 的完成、跳过、退出分别记录。
- 生成/发布/执行重复点击率下降，失败重试成功率可查询。
- 列表详情打开率、Drawer 关闭后返回位置、图表下钻返回率可查询。
- 移动端 Bottom Sheet 操作完成率、误触关闭率和触控失败率可查询。

## 9. 交给 WorkBuddy 的任务描述模板

不要说“给这个页面加个弹框/加载动画”。使用下面格式：

```text
页面：/growth/leads
Profile：P01
组件：Expandable Row + Drawer + Skeleton + Pagination
触发：点击线索行展开摘要；点击“查看详情”从右侧打开 Drawer
联动：筛选、分页、汇总数字和图表保持同一查询条件
状态：加载时保留表格骨架；失败显示重试；关闭 Drawer 后焦点和滚动位置回到原处
设备：桌面用右侧 Drawer；移动端用半屏 Bottom Sheet
验收：不丢筛选、不跳滚动、Esc/返回键可关闭、键盘可操作、支持 reduced-motion
```

## 附录 A：全部路由核对清单

以下为本次静态盘点得到的全部页面路由，已经在上面的 Profile 表中分配主优化方案：

```text
/
/today
/mine
/login
/dev-clear-browser-cache
/accounts-matrix
/admin
/admin/account
/admin/ai-employee
/admin/commercial-readiness
/admin/connectors
/admin/executor
/admin/local-engine
/admin/memory
/admin/models
/admin/plugins
/admin/redfox
/admin/redfox-skills
/admin/risk
/admin/sandbox
/admin/savings
/admin/settings
/admin/tools
/admin/users
/agent
/agent-workbench
/agent-cockpit-canvas
/approvals
/apps
/apps/ai-employee
/apps/auto-acquisition
/apps/detail
/artifacts
/auto-acquisition/create
/boss-recruit
/capabilities
/capabilities/account
/capabilities/executor
/capabilities/memory
/capabilities/models
/capabilities/models/edit
/capabilities/models/new
/capabilities/plugins
/capabilities/risk
/capabilities/sandbox
/capabilities/tools
/capabilities/users
/case-admin
/case-admin/[id]
/case-admin/new
/cases
/cases/[slug]
/collections/[slug]
/commercial-readiness
/compliance
/compliance-check
/content
/content/ai-image-gen
/content/ai-video-gen
/content/articles
/content/collection-center
/content/face-swap
/content/image-gen
/content/optimization
/content/wechat-official-assistant
/content/workspace
/content/xiaohongshu
/content/xiaohongshu-assistant
/copy-compare
/crm
/crm-closer
/crm-connectors
/crm-import
/crm-import/flow
/crm/closer
/crm/connectors
/crm/customer
/crm/import
/customer
/demo/video-studio
/demo/wechat-personal
/demo-request
/device-center
/distribution
/distribution/accounts
/distribution/articles
/distribution/compliance
/distribution/logs
/distribution/publish-article
/distribution/publish-video
/distribution/scrape
/distribution/tasks
/effects
/engagement
/engagement/channel-messages
/engagement/comment-acquisition
/engagement/comment-insights
/engagement/customer-service
/engagement/customers
/engagement/douyin-comments
/engagement/douyin-messages
/engagement/records
/engagement/rules
/engagement/wechat
/engagement/wechat-channel-comments
/engagement/wechat-groups
/engagement/wechat-moments
/engagement/wechat-moments/detail
/engagement/wechat/chat-history
/engagement/wechat/contact-add
/engagement/wechat/contacts
/engagement/wechat/friend-accept
/engagement/wechat/mass-send
/engagement/wechat/moments-publish
/engagement/wechat/plans
/engagement/wecom-assistant
/face-swap
/growth
/growth/account-health
/growth/acquisition
/growth/leads
/growth/leads/detail
/growth/reports
/growth/rpa-workbench
/growth/strategies
/growth/workflows
/intelligence
/intelligence/accounts
/intelligence/collaboration
/intelligence/costs
/intelligence/inbox
/intelligence/inbox-processing
/intelligence/industries
/intelligence/leads
/intelligence/monitor-new
/intelligence/monitors
/intelligence/redfox
/intelligence/report-new
/intelligence/reports
/intelligence/risks
/intelligence/rules
/intelligence/search
/intelligence/skills
/intelligence/trends
/intelligence/viral
/knowledge
/knowledge-base
/knowledge-base/new
/local-engine
/local-engine/ai-action
/local-engine/browser
/local-engine/browser/agent
/local-engine/desktop
/local-engine/evidence
/local-engine/files
/local-engine/logs
/local-engine/permissions
/local-engine/remote
/local-engine/run
/local-engine/tasks
/local-engine/workbench
/mai-ui
/materials
/message
/mobile-capabilities
/platforms
/platforms/edit
/platforms/new
/poi
/release-notes
/reply
/risk-confirm
/savings
/savings/orders
/savings/wallet
/schedules
/schedules/edit
/seedance-video
/settings
/settings/legal
/settings/memory
/solutions
/solutions/configure
/solutions/run
/strategies
/strategies/edit
/strategies/new
/styles
/styles/edit
/styles/new
/task-evidence
/tasks
/tasks/confirmations
/tasks/evidence
/tasks/records
/tasks/runs
/templates
/templates/edit
/templates/new
/topics
/topics/new
/video-download
/video-generation
/video-studio
/video-workshop
/video/product-cut
/video/release-plans
/viral-analysis
/war-room
/wecom-assistant
/wecom-crm
```

> 注：`/today` 在源码路由清单中只应计一次；附录保留为人工核对列表，实施时以 Next.js 实际构建产物为准。
