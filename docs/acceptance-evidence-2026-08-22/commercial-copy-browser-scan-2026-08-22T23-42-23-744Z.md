# Commercial Copy Browser Scan

- Started: 2026-08-22T23:36:59.516Z
- Finished: 2026-08-22T23:42:23.743Z
- Frontend: http://127.0.0.1:3015
- Discovered routes: 201
- Scanned routes: 131
- Excluded internal/hidden/data routes: 70
- Partial scan: yes
- Passed: 120
- Failed: 11
- Console errors: 1
- JSON: docs/acceptance-evidence-2026-08-22/commercial-copy-browser-scan-2026-08-22T23-42-23-744Z.json

## Failures

### /agent-workbench
- runtimeSurface: 执行器
  - 08/10 17:49 你好，我是 Agent-S 工作台中的对话规划助手。我可以帮你澄清目标、分析问题，并规划下一步行动；实际的桌面操作由 Agent-S 执行器完成，我会根据执行结果继续与你协作。有什么任务需要梳理或拆解吗？ 08/10 17:49 Kaypal 默认模型 / deepseek-v4-flash / deepseek-v4-flash Kaypal 视觉 / qwen-vl-

### /compliance
- blankPage: blank
  - page body text is empty or too short

### /content/collection-center
- blankPage: blank
  - page body text is empty or too short

### /content/image-gen
- blankPage: blank
  - page body text is empty or too short

### /content/xiaohongshu-assistant
- blankPage: blank
  - page body text is empty or too short

### /distribution/logs
- backendSurface: 后端
  - 完成。 - 2026-08-10 19:59:58 [info] 人工确认记录已保存。 - 2026-08-10 19:59:58 [warning] 后端风控审批已记录。 - 2026-08-10 19:59:58 [success] 执行保护通过，结果已回写。 - 2026-08-10 19:59:58 [success] 已人工确认，内部记录已完成。 [2026-08-10
- runtimeSurface: 本地引擎
  - 08-12 05:13:02] 抖音私信回复 排队中 抖音 2 -> 王女士 - 2026-07-29 20:39:17 [info] 互动任务已创建，等待本地引擎执行。 - 2026-07-29 20:39:17 [info] 当前会尝试打开本地账号后台；确认后发送模式会在真实发送前等待用户确认。 - 2026-07-29 20:39:17 [info] 已套用客服规则：本地生活/电

### /engagement/wecom-assistant
- secretSurface: Webhook
  - ⌘K 通知 返回 企微助手 未安装 企业微信 AI 智能客服：自动回复 + 转人工 + 消息记录 连接企业微信群机器人 在企业微信群里添加「群机器人」，复制 Webhook 地址粘贴到下面。 连接成功后，客户消息会由 AI 自动回复，命中转人工关键词时提醒人工介入。 测试连接 安装连接 v1.1.96 · 更新于 2026-08-22 · 检查新版本可获得最新能力 检查更新 更新历史 主导航 今

### /growth/leads
- skillSurface: Skill
  - 评分 抖音 · 命中：AI 手机原始出处 ↗ "目标：张小森 鞭策模式：自己花钱给自己买鞭子 评论时间：39分钟前·北京 视频：12:086235万物皆可Skill：几十元传感器控制 视频互动分：62350000 来源：https://www.douyin.com/video/7672111888771108123 线索来源：抖音 AI 手机 筛选原因：视频暂无可回复评论，改为直接在视频下评

### /mine
- runtimeSurface: 本地引擎
  - 服务、微信桌面、运行检查 应用与安装 开通更多能力（CRM 等） Agent 对话 Agent 会话工作台（对话规划助手） 任务证据 执行证据与留痕 引擎权限 本地引擎权限管理 AI 工件 AI 生成的工件产物 数据服务管理 数据源连接与配额配置 v1.1.96 · 更新于 2026-08-22 · 检查新版本可获得最新能力 检查更新 更新历史 主导航 今日增长（按 1） 获客中心（按 2） 客户

### /wecom-assistant
- secretSurface: Webhook
  - 中，仅可预览 返回 企微助手 未安装 企业微信 AI 智能客服：自动回复 + 转人工 + 消息记录 连接企业微信群机器人 在企业微信群里添加「群机器人」，复制 Webhook 地址粘贴到下面。 连接成功后，客户消息会由 AI 自动回复，命中转人工关键词时提醒人工介入。 测试连接 安装连接 企业微信助手 灰度测试中，暂未开放使用 该功能正在内部灰度验证，正式开放前暂不可用。页面内容仅供预览， 操

### /wecom-crm
- apiSurface: API
  - … ⌘K 通知 账号「视频号验收」登录状态异常，请重新扫码 账号「视频号验收」登录状态异常，请重新扫码 页面处于灰度测试中，仅可预览 企业微信客户运营 官方 API 通道：客户群发、客户朋友圈、外部联系人管理 渠道配置 客户群发 客户朋友圈 新增 / 更新企业配置 企业 ID（corpid） 应用 Secret 配置名称（可选） 应用 AgentId（可选） 回调 Token（可选） 回调 E
- secretSurface: Token
  - 渠道配置 客户群发 客户朋友圈 新增 / 更新企业配置 企业 ID（corpid） 应用 Secret 配置名称（可选） 应用 AgentId（可选） 回调 Token（可选） 回调 EncodingAESKey（可选） 保存配置 已配置企业（0） 刷新 尚未配置企业微信，先在上方填写 corpid 并保存。 企业微信 CRM 灰度测试中，暂未开放使用 该功能正在内部灰度验证，正式开放前

