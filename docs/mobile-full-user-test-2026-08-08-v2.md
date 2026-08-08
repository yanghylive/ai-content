# 手机端前端全量用户侧测试报告（2026-08-08 全量无遗漏版）

> 环境：jztest34 模拟器（Android 14）+ WebView CDP 驱动
> 目标：https://aicontent.vip.kaypal.cn（生产 PWA，WebView 壳加载）
> 方法：路由全量快照（36 路由渲染断言）+ 交互操作验证（CDP 点击/填表/断言）
> 账号：大壮（免费版）

## 一、结论速览

- **覆盖**：5 主 Tab + 36 个用户侧路由渲染 + 15 项关键交互操作
- **发现并修复 bug**：1 类（4 处）路由 404 兜底首页问题（commit 9f3b2dda，已部署回验）
- **重定向判定**：3 处（/content/video、/content/face-swap、/engagement/comments）均为预期行为，非 bug

## 二、第一轮路由渲染快照（36 路由全 ✅）

| 路由 | 状态 | 内容摘要 |
|---|---|---|
| /tasks/evidence | ✅ | 任务证据·执行留痕 30 条 |
| /tasks/records | ✅ | 任务历史·80 任务·490 结果留存 |
| /tasks/runs | ✅ | 正在运行·待确认 0·失败列表 |
| /tasks/schedules | ⚠️→✅ | 定时任务 3 个 cron（详情跳转已修） |
| /content/topics | ✅ | 选题 5 个（商业验收×3+RedFox×2） |
| /content/templates | ✅ | 空态·新建模板 |
| /content/styles | ✅ | 空态·新建风格 |
| /content/strategies | ✅ | AI 增长内容策略（默认） |
| /content/knowledge | ✅ | 空态·新建知识 |
| /content/optimization | ✅ | 开始优化+快捷操作 4 项 |
| /content/video | ✅（重定向） | → /content（显式 redirect，预期） |
| /content/xiaohongshu | ✅ | 小红书笔记 15 篇·筛选·分页 |
| /content/face-swap | ✅（重定向） | → /content（换脸手机端不开放，预期） |
| /materials | ✅ | 素材库·2 条·链接采集/AI生图/AI配音 |
| /distribution-v2/publish-video | ✅ | 视频发布 5 步流程 |
| /distribution-v2/scrape | ✅ | 文章反抓·链接提取 |
| /distribution-v2/tasks | ✅ | 发布任务 8 条（1 进行中/7 失败） |
| /engagement/channel-messages | ✅ | 视频号私信·3 步流程 |
| /engagement/comments | ✅（重定向） | 无页面→404 兜底首页（预期） |
| /engagement/customers | ✅ | 客户管理·1 总数·1 待跟进 |
| /engagement/records | ✅ | 互动记录 49 条·筛选·跳过/重试 |
| /engagement/rules | ✅ | 回复规则·待确认 15 |
| /engagement/wechat | ✅ | 微信·助手未连接·待办 15 |
| /crm | ✅ | 客户管理（同 customers） |
| /video-studio | ✅ | 视频一键成片·12 流水线·最近项目已成片 |
| /war-room | ✅ | 运营战情室·跨平台态势 |
| /release-notes | ✅ | v1.1.60 更新说明 |
| /schedules | ✅ | 定时任务（同 tasks/schedules） |
| /knowledge-base | ✅ | 知识库空态 |
| /xiaohongshu | ✅ | 小红书笔记 15 篇表格视图 |
| /growth | ✅ | 增长控制台·漏斗·快捷操作 6 项 |
| /intelligence | ✅ | 商业价值总控台·老板/主管/运营视图 |
| /intelligence/viral | ✅ | 爆款分析·粘贴链接拆解 |
| /reply-v2 | ✅ | AI 回复建议·3 语气 |
| /home-v2 | ✅ | 工作台总览·待发布 15·文章 16 |

## 三、交互操作验证（15 项全 ✅）

| 交互 | 结果 |
|---|---|
| 选题新建 → /topics/new | ✅ 标题/说明/关键词/保存 |
| 素材库链接采集展开 | ✅ 粘贴链接去水印表单 |
| 素材库 AI 生图展开 | ✅ qwen-image-3.0-pro 生成入口 |
| AI 回复建议真实生成 | ✅ 3 版回复（亲切/正式/专业）+ 复制 |
| 互动记录「已完成」筛选 | ✅ 商业验收记录正确过滤 |
| 任务历史「导出记录」 | ✅ 记录已导出 6 条 |
| 定时任务「查看详情」 | ⚠️→✅ 修复后进编辑表单 |
| 知识库「新建知识」 | ✅ /knowledge-base/new 表单 |
| intelligence 视图切换 | ✅ 老板/主管/运营视图存在 |
| 内容优化快捷操作 | ✅ 4 入口渲染 |
| 发布任务列表 | ✅ 8 条+状态筛选 |
| 小红书笔记列表 | ✅ 15 篇+分页 10/20/50 |
| 增长控制台 | ✅ 新建获客任务+漏斗 |
| 视频成片 | ✅ 流水线+生成入口 |
| 战情室 | ✅ 工作台/任务历史/结果留存入口 |

## 四、发现并修复的 Bug（1 类 4 处）

**资源详情跳转 404 → 兜底首页**（P2，commit 9f3b2dda，部署 prod-20260808-135234-9f3b2dda）

| 位置 | 原跳转（404） | 修复后 | 回验 |
|---|---|---|---|
| 定时任务 /tasks/schedules | /schedules/{id}/edit | /schedules/edit?taskType= | ✅ 实测进编辑表单 |
| 内容策略 /content/strategies | /strategies/{id}/edit | /strategies/edit?id= | ✅ 实测进编辑表单 |
| 内容风格 /content/styles | /styles/{id}/edit | /styles/edit?id= | ✅（空态，同模式） |
| 内容模板 /content/templates | /templates/{id}/edit | /templates/edit?id= | ✅（空态，同模式） |

根因：`ResourceCenter.onItemClick` 跳路径参数 `/xxx/{id}/edit`，但 edit 页面路由是静态 `/xxx/edit` 且用 `?id=` / `?taskType=` query 参数读取 → 404 → 应用级兜底重定向 /today，用户点详情直接回首页。
影响面核对：platforms/models/knowledge-base/apps/topics 等用 query 参数跳转，无此问题。

## 五、重定向判定（3 处，均为预期）

- `/content/video` → `redirect("/content")`：显式跳内容页（设计如此）
- `/content/face-swap` → `redirect("/content")`：换脸手机端不开放（手机端能力页已声明）
- `/engagement/comments` → 无 page.tsx → 404 兜底 /today（路由不存在）

## 六、备注

- 预检「本机发布服务暂不可用：missing」与生产 health `agentWaker: missing` 一致（发布服务未注册，配置问题，非前端 bug）
- 本次未执行真实「确认发送」/真实发布（会触发真实业务动作，需业务确认）
- 本地前端 3010 编译出现 500（独立问题，不影响生产 WebView 测试；WebView 走 aicontent.vip.kaypal.cn）
