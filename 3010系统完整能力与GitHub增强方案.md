# 3010 系统完整能力与 GitHub 增强方案

> 项目：JIUZHANG AI / AI Content
> 
> 前端：`http://127.0.0.1:3010`
> 
> 后端：`http://127.0.0.1:3011`
> 
> 盘点日期：2026-08-12
> 
> 目标：基于当前完整系统能力，筛选能够真正提升产品壁垒、商业价值和中国平台适配能力的 GitHub 项目。

## 1. 结论

3010 不是单一的 AI 写作工具，也不是单纯的多平台发布器。它已经具备内容生产、行业情报、多平台分发、客户互动、自动获客、企业微信、CRM、智能体、本地桌面执行、视频生产、语音助手和商业化治理等能力。

产品真正应该形成的主线是：

```text
全网情报
  -> 行业热点、竞品、用户需求
  -> 选题与内容策略
  -> 图文、视频、图片生产
  -> 多平台发布
  -> 评论、私信、微信互动
  -> 用户意向识别
  -> 线索池
  -> 微信/企业微信承接
  -> CRM 跟进
  -> 成交与数据复盘
```

当前的主要问题不是“功能数量不够”，而是部分能力还没有统一成一套数据对象、平台适配器和可验证的商业闭环。

## 2. 当前系统能力地图

### 2.1 AI 助手与智能体

- AI 助手对话
- 智能体会话和多轮对话
- Agent Workbench 智能体工作台
- Agent Console 任务历史和执行台账
- 模型协作和任务拆解
- AI 员工/能力工作台
- Agent-S 本地执行器
- 本机助手状态和连接管理
- 任务确认、暂停、继续和失败恢复
- 任务运行记录、事件时间线和结果证据
- BaiLongMa/白龙马语音助手连接
- 语音命令、语音确认、语音聊天

对应代码区域：

- `frontend/src/app/(dashboard)/agent`
- `frontend/src/app/(dashboard)/agent-workbench`
- `frontend/src/app/(dashboard)/agent-console`
- `backend/src/modules/ai-employee`
- `backend/src/modules/agent-s`
- `backend/src/modules/agentwaker`
- `backend/src/modules/runtime`
- `backend/src/modules/local-engine`
- `backend/src/modules/voice`

### 2.2 信息采集与内容情报

- RSS 信息源
- API 信息源
- 网页抓取
- 全网素材采集
- 文章反抓
- 文章内容清洗和结构化
- 行业情报中心
- 行业和竞品监控
- 趋势雷达
- 热点发现
- 爆款分析
- 搜索情报
- 情报报告
- 情报条目标准化
- 情报派发到素材、选题、风险、规则和增长模块
- RedFox 情报数据接入

对应代码区域：

- `frontend/src/app/(dashboard)/content/collection-center`
- `frontend/src/app/(dashboard)/distribution/scrape`
- `frontend/src/app/(dashboard)/intelligence`
- `backend/src/modules/sources`
- `backend/src/modules/materials`
- `backend/src/modules/intelligence`
- `backend/src/modules/redfox`

### 2.3 内容生产与内容工作台

- 内容工作台
- 文章创作
- Markdown 和 HTML 内容
- 小红书笔记
- 小红书卡图
- 选题库
- AI 选题推荐
- 标题评分和优化
- 多平台文案改写
- 内容策略
- 文章模板
- 风格库
- 品牌/产品知识
- 内容审稿
- 内容合规检查
- 内容版本管理
- 内容差异比较
- 发布前快照
- 发布复盘
- 协作备注

对应代码区域：

- `frontend/src/app/(dashboard)/content`
- `frontend/src/app/(dashboard)/content-workspace`
- `frontend/src/app/(dashboard)/topics`
- `frontend/src/app/(dashboard)/articles`
- `frontend/src/app/(dashboard)/styles`
- `frontend/src/app/(dashboard)/templates`
- `backend/src/modules/articles`
- `backend/src/modules/topics`
- `backend/src/modules/content-optimization`
- `backend/src/modules/content-review`
- `backend/src/modules/content-strategies`
- `backend/src/modules/styles`
- `backend/src/modules/knowledge`

### 2.4 图片、视频和音频生产

- AI 生图
- 图片处理
- 图片素材管理
- 视频工坊
- 视频项目和任务
- 视频模板和片段
- BGM 预设
- 商品带货视频
- 门店探店视频
- 客户案例视频
- 活动促销视频
- 品牌宣传视频
- 企业宣传片
- 数字人视频生成
- 视频换脸
- 人脸授权确认
- 视频导入素材库
- 视频成片下载
- 语音识别 ASR
- 文字转语音 TTS
- 语音模型和音色能力

对应代码区域：

- `frontend/src/app/(dashboard)/video-studio`
- `frontend/src/app/(dashboard)/video-workshop`
- `frontend/src/app/(dashboard)/video-generation`
- `frontend/src/app/(dashboard)/content/face-swap`
- `frontend/src/app/(dashboard)/seedance-video`
- `backend/src/modules/video`
- `backend/src/modules/video-generation`
- `backend/src/modules/video-workshop`
- `backend/src/modules/video-face-swap`
- `backend/src/modules/voice`

### 2.5 多平台发布

当前发布中心已经包含 9 个平台：

| 平台 | 平台键 | 内容类型 | 当前主要执行方式 |
|---|---|---|---|
| 小红书 | `xiaohongshu` | 图文、视频 | CDP 浏览器 |
| 视频号 | `wechat-channel` | 图文、视频 | CDP 浏览器 |
| 抖音 | `douyin` | 图文、视频 | CDP 浏览器 |
| 快手 | `kuaishou` | 图文、视频 | CDP 浏览器 |
| B站 | `bilibili` | 视频 | CDP 浏览器 |
| 微博 | `weibo` | 图文、视频 | CDP 浏览器 |
| 知乎 | `zhihu` | 图文 | CDP 浏览器 |
| 今日头条 | `toutiao` | 图文 | CDP 浏览器 |
| 微信公众号 | `wechat-official` | 图文 | CDP 浏览器 + 官方 API |

已有发布基础设施：

- 平台账号管理
- 扫码登录和账号状态
- Local Bridge
- Electron 本地桥接
- Playwright/CDP 浏览器执行
- 平台能力注册表
- 图文和视频发布适配器
- 多平台发布流程
- 图片远程链接预处理
- 发布任务队列
- 任务 5 秒轮询
- durable execution
- 幂等键
- worker 抢占和心跳
- 失败重试
- dead letter
- 发布取消接口
- 发布历史
- 发布记录删除
- 发布结果回读
- 截图和证据
- 合规检查

对应代码和文档：

- `backend/src/modules/publishing`
- `backend/src/modules/platform-registry`
- `backend/src/modules/runtime/platforms`
- `backend/src/modules/auto-upload`
- `backend/src/modules/local-bridge`
- `frontend/src/app/(dashboard)/distribution`
- `frontend/src/app/(dashboard)/platforms`
- `交接_2026-08-01_发布中心完整交接.md`

重要边界：发布代码支持某个平台，不代表该平台已经达到生产级的定时、草稿、封面、登录态、回读和真实商业验收标准。部分平台依赖 DOM 选择器，平台改版后需要维护。

### 2.6 客户互动与自动获客

- AI 客服
- 抖音评论读取
- 抖音评论回复
- 抖音私信读取
- 抖音私信回复
- 视频号评论读取
- 视频号评论回复
- 视频号私信处理
- 小红书通知评论读取和回复
- 评论洞察
- 评论意向分析
- 评论回复建议
- 评论区获客
- 私信获客
- 关键词获客
- 账号获客
- 热门视频获客
- 线索评分
- AI 人格化回复
- 回复策略
- 回复审核队列
- 自动回复
- 风控熔断
- 互动记录
- 回复回读和证据

核心代码：

- `backend/src/modules/comment-acquisition`
- `backend/src/modules/comment-insights`
- `backend/src/modules/runtime/platforms/douyin`
- `backend/src/modules/runtime/platforms/wechat-channel`
- `backend/src/modules/runtime/platforms/publishing`
- `frontend/src/app/(dashboard)/engagement`
- `frontend/src/app/(dashboard)/growth`

当前评论获客接口已经体现出完整意图：扫描评论/私信、AI 评分、生成回复、入库、审核和真实发送。[评论获客控制器](backend/src/modules/comment-acquisition/comment-acquisition.controller.ts)提供了 `scan`、`scan-dm`、`leads`、`review` 和 `reply` 链路。

### 2.7 微信、企业微信和 CRM

微信与企业微信能力包括：

- 微信通讯录同步
- 微信聊天记录
- 微信好友申请
- 自动通过好友
- 私聊发送
- 群发
- 朋友圈计划
- 朋友圈发布
- 微信渠道评论
- 企业微信 AI 客服
- 企业微信群机器人
- 企业微信客户资料
- 企业微信 CRM
- 客户来源
- 客户档案
- 客户详情
- 客户导入
- 客户跟进
- 成交推进
- 外部 CRM 连接器

对应代码区域：

- `frontend/src/app/(dashboard)/engagement/wechat`
- `frontend/src/app/(dashboard)/engagement/wecom-assistant`
- `frontend/src/app/(dashboard)/wecom-crm`
- `frontend/src/app/(dashboard)/crm`
- `backend/src/modules/wecom-assistant`
- `backend/src/modules/wecom-crm`
- `backend/src/modules/crm`
- `backend/src/modules/local-engine`

硬约束：微信桌面互动继续经过 Agent-S/local-controller 路径；Local Engine 负责协调、权限、状态和证据，不能替换 Agent-S 成为桌面客户互动的主执行器。

### 2.8 系统、商业化和治理

- 登录、会话和租户
- 多模型、多平台和 OpenAI 兼容网关
- AI 平台、模型和默认模型
- AI 用量和成本
- 套餐、计费和权益
- 应用市场
- 插件
- 省钱返利
- CPS 订单
- 返利余额
- AI 额度兑换
- 提现
- 账号健康
- 权限和风险控制
- 合规检查
- 商业上线检查
- 本地执行权限
- 文件权限
- 沙箱
- 审计日志
- 任务证据
- 运行记录
- 推送通知
- 移动端 PWA

对应代码区域：

- `backend/src/modules/auth`
- `backend/src/modules/tenants`
- `backend/src/modules/ai-models`
- `backend/src/modules/ai-gateway`
- `backend/src/modules/billing`
- `backend/src/modules/entitlements`
- `backend/src/modules/app-market`
- `backend/src/modules/savings`
- `backend/src/modules/compliance`
- `backend/src/modules/commercial-readiness`
- `backend/src/modules/runtime/evidence`
- `frontend/src/app/(dashboard)/admin`
- `frontend/src/app/(dashboard)/commercial-readiness`
- `frontend/src/app/(dashboard)/savings`

## 3. 现有架构判断

### 3.1 已经具备的底座

3010 当前最有价值的基础设施不是单个页面，而是以下底座：

1. 前后端分离：Next.js/React + NestJS。
2. 数据层支持 PostgreSQL、Redis，并有 SQLite 桌面运行形态。
3. AI 模型使用 OpenAI 兼容协议，方便接入国产模型和自建网关。
4. 平台发布已经开始使用 Adapter Registry，而不是继续把所有逻辑写进一个入口。
5. Local Bridge 已经有状态、能力、账号、发布、任务和历史等动作。
6. durable task、幂等、worker、重试、心跳和证据链已经存在。
7. 客户互动默认可以走自动发送，同时保留风险确认和人工审核。
8. Agent-S 是桌面客户互动的主执行路径。
9. 内容、情报、增长、CRM 和企微已经分别有页面和后端模块。

### 3.2 当前关键问题

#### 问题一：能力分散，缺少统一业务对象

内容、情报、互动、线索、客户和转化记录之间还没有形成统一主键和统一时间线。

建议建立以下核心对象：

```text
ContentItem
PlatformAccount
PlatformPost
Interaction
Conversation
Lead
Customer
ConversionEvent
WorkflowRun
Evidence
```

#### 问题二：发布适配器有统一模型，互动适配器还不够统一

发布能力已有 `contentKinds`、`executionModes`、`supportsReadback` 等描述，但评论、私信、搜索、用户画像、通知和互动回读还没有完全采用同等级的标准契约。

建议统一为：

```text
discover()
search()
readPost()
readComments()
readMessages()
readNotifications()
generateReply()
sendCommentReply()
sendDirectMessage()
publish()
readback()
collectEvidence()
```

#### 问题三：发现和执行之间没有完全打通

情报中心能发现内容，增长中心能创建获客任务，互动模块能回复评论，但还需要统一事件：

```text
IntelligenceItem
  -> Material
  -> Topic
  -> ContentDraft
  -> PlatformPost
  -> Interaction
  -> Lead
  -> Customer
```

#### 问题四：AI 回复缺少量化评估

目前已有回复引擎、人格、规则和风控，但仍需要持续记录：

- 回复前的评论意向
- 使用的模型和提示词
- 回复是否被人工修改
- 是否发送成功
- 是否产生二次互动
- 是否进入微信/企微
- 是否转成客户
- 是否成交

#### 问题五：真实外部结果仍要和内部任务状态严格区分

“任务创建成功”“worker 执行成功”不能直接等同于“平台真实发布”“客户真实收到回复”或“线索真实转化”。必须保留远端对象 ID、公开链接、回读时间、截图和内容匹配结果。

## 4. GitHub 项目增强清单

### 4.1 平台发布和平台互动

#### [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)

定位：小红书平台互动能力参考。

适合增强：

- 小红书评论读取
- 通知中心
- 评论回复
- 私信入口
- 登录态和账号状态
- 小红书内容搜索
- 发布后回读

接入位置：

- `backend/src/modules/runtime/platforms/xiaohongshu`
- `backend/src/modules/comment-acquisition`
- `backend/src/modules/local-engine`

建议：不直接把 MCP 当成 3010 的主执行器。应把它的能力包装成 3010 的 `XiaohongshuInteractionAdapter`，并继续经过 Agent-S、风险策略和证据记录。

#### [LIghtJUNction/douyin](https://github.com/LIghtJUNction/douyin)

定位：抖音网页采集、评论、官方 OAuth/OpenAPI 和 MCP 工具。

适合增强：

- 抖音评论和内容采集
- 官方账号 OAuth
- 企业号私信
- 抖音用户信息
- 抖音平台状态诊断

接入位置：

- `backend/src/modules/runtime/platforms/douyin`
- `backend/src/modules/auto-upload`
- `backend/src/modules/comment-acquisition`

建议：优先采用官方 OAuth/OpenAPI 能力；网页 Cookie 只用于明确允许的网页读取场景。账号凭证继续进入现有加密凭证体系。

#### [Yht20927/douyin-cli](https://github.com/Yht20927/douyin-cli)

定位：抖音评论运营和 AI 回复引擎。

适合借鉴：

- ReplyEngine 的回复生成结构
- 多人格回复
- 回复策略分类
- 草稿 `save/list/show/post/delete` 生命周期
- 回复上下文隔离
- 随机节奏和行为控制
- 失败熔断
- SQLite 运营统计

接入位置：

- `backend/src/modules/comment-acquisition/reply-engine.service.ts`
- `backend/src/modules/comment-acquisition/circuit-breaker.ts`
- `backend/src/modules/runtime/platforms/douyin`

建议：以设计和测试思想为主，不直接复制整套 CLI。3010 已经有评论获客和风控断路器，应把它改造成统一平台能力，而不是再维护一套独立抖音系统。

#### [adoresever/bilibili-mcp](https://github.com/adoresever/bilibili-mcp)

定位：B站 MCP Server，覆盖搜索、评论、发布、数据分析和互动运营。

适合直接增强：

- B站登录
- 视频和用户搜索
- 评论读取
- 评论回复
- 弹幕和字幕
- 动态发布
- 私信
- 未读消息
- @和点赞通知
- 用户和视频数据

接入位置：

- `backend/src/modules/runtime/platforms/bilibili`
- `backend/src/modules/comment-acquisition`
- `backend/src/modules/intelligence`
- `backend/src/modules/publishing`

优先级：P0。B站是当前最适合从“只发布”扩展到“内容发现 + 评论获客 + 私信承接”的平台。

#### [wecode-ai/openclaw-weibo](https://github.com/wecode-ai/openclaw-weibo)

定位：微博搜索、热搜、超话、微博动态和私信通道。

适合增强：

- 微博热搜监控
- 关键词搜索
- 超话内容
- 评论回复
- 微博私信通道
- 微博内容发布

接入位置：

- `backend/src/modules/runtime/platforms/weibo`
- `backend/src/modules/intelligence`
- `backend/src/modules/comment-acquisition`

#### [MarkoXyz/weibot](https://github.com/MarkoXyz/weibot)

定位：较早的微博机器人接口项目。

适合参考：

- 扫码登录
- 发微博
- 评论、点赞、转发
- 关注和取关
- 收发私信

建议：作为接口思路和历史实现参考，不建议直接作为生产依赖。微博页面和接口变化风险较高。

#### [leaperone/MultiPost-Extension](https://github.com/leaperone/MultiPost-Extension)

定位：浏览器扩展、多平台发布和网页到本地执行器桥接。

适合增强：

- `3010 -> Local Bridge -> 本地浏览器` 的统一协议
- 域名白名单
- `postMessage` 请求和结果回传
- 平台适配器注册表
- 多平台发布编排
- 远程图片转本地 Blob
- 已打开页面反向采集
- 发布页面独立编排

项目已经有相关研究文档：

- `分析_MultiPost-Extension_发布能力参考.md`
- `对比_MultiPost_vs_JIUZHANG_发布能力.md`
- `开发文档_JIUZHANG_AI_多平台发布中心升级.md`

建议：继续独立实现同类协议，不整体合并代码。该仓库许可证为 Apache-2.0，任何复制或修改都必须保留许可证、NOTICE 和变更说明。

#### [epiral/bb-browser](https://github.com/epiral/bb-browser)

定位：通过真实浏览器登录态操作多个网站的 CLI/MCP。

适合增强：

- 知乎
- B站
- Boss
- 小红书浏览
- 其他浏览器登录态平台

建议：借鉴真实浏览器会话、站点命令和适配器分发机制，不直接替换现有 Agent-S。所有写操作必须接入 3010 的风险、权限、幂等和证据链。

### 4.2 全网情报和内容发现

#### [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)

定位：多平台内容、用户和评论采集。

覆盖方向：

- 小红书
- 抖音
- 快手
- B站
- 微博
- 知乎
- 贴吧
- 内容、评论、作者和互动数据

适合增强：

- 行业关键词监控
- 竞品账号监控
- 评论区需求发现
- 用户痛点提取
- 爆款内容采集
- 获客候选发现
- 情报中心数据补充

接入位置：

- `backend/src/modules/intelligence`
- `backend/src/modules/materials`
- `backend/src/modules/sources`
- `backend/src/modules/comment-acquisition`

重要边界：它主要负责发现和采集，不负责替代平台互动发送器。推荐作为独立采集 worker 或 sidecar，通过结构化事件写入 3010。

建议事件格式：

```json
{
  "type": "social.content.discovered",
  "platform": "xiaohongshu",
  "externalId": "platform-object-id",
  "author": {},
  "content": {},
  "comments": [],
  "keywords": [],
  "observedAt": "2026-08-12T00:00:00.000Z"
}
```

#### [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)

定位：给 AI Agent 提供互联网读取和搜索能力。

适合增强：

- 小红书内容阅读
- B站搜索和视频信息
- 网页阅读
- RSS
- GitHub
- 竞品和行业调研

接入位置：

- `backend/src/modules/intelligence`
- `backend/src/modules/sources`
- `frontend/src/app/(dashboard)/intelligence`

建议：作为情报发现和诊断适配器，不把“能读取”误认为“权威业务证据”，也不直接用于自动发送。

#### [unclecode/Crawl4AI](https://github.com/unclecode/crawl4ai)

定位：面向 LLM 的网页爬虫和结构化抓取。

适合增强：

- 文章反抓
- JS 页面抓取
- 深度网页爬取
- 网页转 Markdown
- 结构化 JSON 抽取
- 竞品网站监控
- 内容清洗

接入位置：

- `backend/src/modules/materials`
- `backend/src/modules/sources`
- `backend/src/modules/intelligence`

建议：替换或增强目前的文章反抓服务，但要保留域名限制、SSRF 防护、超时、任务队列和证据来源。

#### [mendableai/firecrawl](https://github.com/mendableai/firecrawl)

定位：搜索、抓取、网页交互和结构化抽取。

适合借鉴：

- JS-heavy 页面处理
- 搜索后抽取
- 页面交互后抓取
- 批量抓取
- JSON Schema 输出

建议：中国环境优先自部署或仅借鉴架构。涉及第三方托管时要考虑网络、隐私、费用和数据合规。

#### [opendatalab/MinerU](https://github.com/opendatalab/MinerU)

定位：中文 PDF 和复杂文档解析。

适合增强：

- 产品手册入库
- 方案书和白皮书解析
- 行业报告解析
- 表格、图片和版面还原
- CRM/客服知识资料导入

接入位置：

- `backend/src/modules/knowledge`
- `backend/src/modules/materials`
- `backend/src/modules/intelligence`

### 4.3 知识库、记忆和 CRM

#### [pgvector/pgvector](https://github.com/pgvector/pgvector)

定位：PostgreSQL 向量检索扩展。

优先级：P0。

适合增强：

- 跨平台同一用户线索去重
- 评论相似度去重
- 历史回复召回
- 品牌知识召回
- 客户兴趣和行业画像
- 微信聊天与社交平台线索关联
- 相似客户查找
- 语义搜索

建议统一向量对象：

```text
content_embedding
comment_embedding
conversation_embedding
lead_embedding
customer_embedding
knowledge_embedding
```

#### [qdrant/qdrant](https://github.com/qdrant/qdrant)

定位：独立向量数据库。

建议：当前 PostgreSQL 已经是核心数据层，先用 pgvector；当线索量、内容量和多租户检索规模明显增加后，再评估 Qdrant 作为独立检索服务。

#### [infiniflow/RAGFlow](https://github.com/infiniflow/ragflow)

定位：复杂文档解析、RAG、Agent Context Engine。

适合借鉴：

- 文档切分
- 引用和证据
- 混合检索
- Agent 知识上下文
- 复杂文档问答

建议：不整体替换 3010 的知识模块，优先吸收文档处理和引用证据设计。

#### [labring/FastGPT](https://github.com/labring/FastGPT)

定位：中文 AI Agent、知识库和 Flow 编排平台。

适合借鉴：

- 中文知识库
- Flow 节点
- MCP 双向调用
- RPA 节点
- 调用链路日志
- 应用评测

#### [langgenius/dify](https://github.com/langgenius/dify)

定位：AI 应用、Agent、工作流、RAG 和模型管理平台。

适合借鉴：

- AI 工作流配置
- 工具调用
- 应用发布
- 模型管理
- RAG 流程
- 可观测性接入

建议：3010 已经具备自己的智能体、模型、权限和商业化体系，不建议整体嵌入 Dify。

#### [twentyhq/twenty](https://github.com/twentyhq/twenty)

定位：开源 CRM。

适合借鉴：

- 联系人、公司、机会等对象模型
- 活动时间线
- 字段和自定义对象
- CRM 自动化
- 团队协作

建议：不替换 3010 CRM，重点参考数据对象、活动时间线和自动化设计。

### 4.4 工作流和外部系统连接

#### [n8n-io/n8n](https://github.com/n8n-io/n8n)

定位：自托管工作流和 AI Agent 自动化平台。

适合增强：

- 官网表单进入 3010
- 广告平台线索同步
- CRM 数据同步
- 企业微信通知
- 邮件和短信触达
- 内容发布后的外部回调
- 定时情报任务
- 成交后的数据回写

建议：作为外部自动化层，通过 Webhook、REST API 和 MCP 连接 3010。不要把 3010 内部已有的核心任务状态迁移到 n8n。

#### [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app)

定位：AI 社交媒体排期、内容日历和社媒运营平台。

适合借鉴：

- 内容日历
- 团队协作
- 社媒排期
- 内容版本
- 账号运营
- 内容分析
- Lead capture 入口设计

#### [inovector/mixpost](https://github.com/inovector/mixpost)

定位：社交媒体管理和内容营销平台。

适合借鉴：

- 内容队列
- 发布日历
- 媒体库
- 标签组
- 团队权限
- 平台账号管理
- 高表现内容的后续评论

#### [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot)

定位：统一客服收件箱和客户会话平台。

适合借鉴：

- 多渠道收件箱
- 会话分配
- 标签
- 客户时间线
- 客服协作
- 客户消息状态

建议：3010 已经有互动、企微和 CRM 页面，不建议整体替换，只参考统一收件箱和会话模型。

### 4.5 AI 质量、成本和可观测性

#### [langfuse/langfuse](https://github.com/langfuse/langfuse)

定位：LLM 可观测性、Prompt 管理和评估。

优先级：P1。

适合增强：

- 模型调用链路
- Prompt 版本
- Token 和费用
- 回复耗时
- 人工修改记录
- 回复成功率
- 平台拦截率
- 线索转化率
- 模型和提示词 A/B 对比

#### [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)

定位：Prompt、模型和 Agent 评测。

适合增强：

- 标题质量评测
- 评论回复质量评测
- 客服回复安全评测
- 线索评分一致性
- 不同行业提示词回归测试
- 敏感词和越权测试

#### OpenTelemetry

适合增强：

- 3010 前端请求
- 3011 API
- Agent-S
- Local Engine
- Electron
- 浏览器任务
- 平台发布
- AI 网关

统一链路追踪。

### 4.6 图片、视频和语音

#### [comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI)

定位：可编排图片和视频生成工作流。

适合增强：

- 批量封面
- 品牌风格模板
- 商品图处理
- 多版本平台素材
- 视频生成工作流
- 换脸和局部重绘

3010 已经有视频和图片能力，重点是把 ComfyUI 作为本地或远程渲染后端，而不是再做第二个独立素材中心。

#### [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)

适合增强：

- 图片文字识别
- 商品图识别
- 截图评论识别
- 海报和菜单解析
- 中文资料入库

#### [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)

适合增强：

- 本地离线 ASR
- TTS
- VAD
- 说话人识别
- 语音增强
- Windows/macOS 本地语音能力

#### [FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice)

适合参考：

- 中文音色
- 声音克隆
- 长文本语音
- 数字人配音

#### [remotion-dev/remotion](https://github.com/remotion-dev/remotion)

适合增强：

- 程序化短视频
- 批量字幕
- 品牌视频模板
- 多比例导出
- 多平台视频版本

## 5. 推荐目标架构

```text
                         +----------------------+
                         | 3010 内容与增长工作台 |
                         +----------+-----------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
        v                           v                           v
  情报与发现层                 内容生产层                 客户转化层
  MediaCrawler                 文章/图文/视频              互动/线索/CRM
  Agent-Reach                 ComfyUI/Remotion             微信/企微
  Crawl4AI                    MinerU/OCR                    pgvector
        |                           |                           |
        +---------------------------+---------------------------+
                                    v
                         统一事件与业务对象层
               Content / Post / Interaction / Lead / Customer
                                    |
                                    v
                         平台适配器与执行层
        小红书 / 抖音 / 视频号 / 快手 / B站 / 微博 / 知乎 / 头条
                                    |
                                    v
                  Agent-S + Local Engine + Local Bridge + Electron
                                    |
                                    v
                         Evidence / Readback / Audit

       外部系统：n8n Webhook / 外部 CRM / 表单 / 广告 / 企业内部系统
       观测系统：Langfuse / promptfoo / OpenTelemetry
```

## 6. 建议优先级

### P0：直接形成商业闭环

1. 统一 `ContentItem`、`PlatformPost`、`Interaction`、`Lead`、`Customer`、`Evidence` 对象。
2. 统一平台互动适配器契约。
3. 接入 B站评论、私信、通知和互动，形成 B站获客。
4. 接入 `MediaCrawler`，将全网评论和内容转成情报、素材、选题和线索。
5. 接入 `pgvector`，做跨平台线索去重和客户长期记忆。
6. 补齐每个平台的远端 ID、链接、回读、截图和内容匹配证据。

### P1：提升稳定性和可运营性

7. 接入 `Langfuse`，跟踪模型、Prompt、Token、人工修改和转化结果。
8. 接入 `promptfoo`，对标题、评论回复、客服回复和线索评分做回归评测。
9. 接入 `Crawl4AI`、`MinerU`、`PaddleOCR`，增强网页、PDF 和图片资料理解。
10. 把情报中心、内容中心、增长中心、互动中心和 CRM 改成事件驱动。
11. 继续增强 Local Bridge 和 Adapter Registry，降低新增平台成本。

### P2：平台扩展和生态

12. 微博、知乎、Boss、头条从“只发布”扩展到“搜索、评论、私信、线索”。
13. 接入 n8n Webhook，连接外部表单、广告、CRM 和企业内部系统。
14. 建立平台适配器插件市场。
15. 开放 MCP、Webhook 和 Local Bridge SDK。

## 7. 不建议直接引入的项目形态

以下项目有参考价值，但不建议直接整体并入 3010：

- Dify：会和现有 AI 网关、智能体、模型和权限体系重叠。
- FastGPT：会和现有知识库、Flow 和 AI 助手重叠。
- RAGFlow：适合参考文档解析和 RAG，不适合替换现有知识模块。
- Chatwoot：会和现有互动、企微和 CRM 重叠。
- Twenty：适合参考 CRM 对象模型，不适合替换现有客户模块。
- Postiz：适合参考内容日历和运营界面，不适合替换现有发布中心。
- Mixpost：适合参考排期和团队协作，不适合替换现有平台执行层。
- CowAgent/AstrBot：适合参考插件和渠道体系，不应替换 Agent-S。

原则是：**吸收能力和设计，不引入第二套核心数据、权限、执行和商业化体系。**

## 8. 执行和安全约束

### 8.1 Agent-S 约束

- WeChat 和桌面客户互动继续经过 Agent-S。
- Local Engine 只负责协调、权限、状态、策略和证据。
- 不得绕过 Agent-S 直接让新项目发送微信或桌面消息。
- 默认客户互动模式保持 `auto-send`。
- 不确定目标、风险内容、权限不足或用户主动选择时才进入确认。

### 8.2 平台自动化约束

- 不把 Cookie 写入日志、数据库明文或 Git。
- 平台写操作必须有幂等键。
- 失败必须进入重试、熔断或人工处理。
- 发送和发布必须保存真实结果，不以“任务创建成功”作为商业成功。
- 平台频率、账号数量和自动化程度必须可配置。
- 对高风险动作保留确认、审计和撤回能力。

### 8.3 数据和许可证约束

- 采集数据应遵守平台条款、隐私和适用法律。
- 只采集完成业务目的所需的数据。
- 第三方项目接入前核对许可证、依赖、维护状态和安全历史。
- Apache-2.0 项目需要保留许可证、NOTICE 和变更说明。
- AGPL 项目接入前必须评估网络服务分发和衍生作品义务。
- 外部托管 API 要评估中国网络可达性、数据出境、费用和稳定性。

## 9. 验收标准

### 9.1 内容闭环

- 一条情报可以导入素材。
- 一条情报可以生成选题。
- 一个选题可以生成图文和视频版本。
- 一个内容可以生成平台差异化版本。
- 一个内容可以提交多个平台发布。
- 每个平台都有任务、结果和回读证据。

### 9.2 获客闭环

- 能从评论、私信或全网采集发现潜在客户。
- 能保存原始内容、平台、作者、外部 ID 和来源链接。
- 能进行意向评分和回复生成。
- 能自动发送或进入审核队列。
- 能确认平台真实发送成功。
- 能把线索导入 CRM。
- 能转入微信或企业微信跟进。
- 能记录后续互动和成交结果。

### 9.3 AI 质量闭环

- 每次模型调用有模型、Prompt、Token 和耗时。
- 每条回复能关联原始评论和客户。
- 能记录人工修改。
- 能评估回复是否被发送、是否触发二次互动。
- 能比较不同模型、Prompt 和人格的转化效果。

### 9.4 生产可靠性

- 任务支持幂等、重试、超时和熔断。
- 平台登录失效可诊断。
- 外部平台改版后能定位失败的适配器和选择器。
- 发布和互动结果有远端 ID、链接、截图或回读。
- Windows 真机、Electron、Agent-S 和浏览器链路有真实证据。

## 10. 最终推荐组合

第一阶段推荐采用：

```text
MediaCrawler
+ xiaohongshu-mcp
+ LIghtJUNction/douyin
+ adoresever/bilibili-mcp
+ pgvector
+ Langfuse
+ promptfoo
+ n8n
```

各项目职责：

| 项目 | 职责 |
|---|---|
| MediaCrawler | 全网内容、评论、作者和竞品发现 |
| xiaohongshu-mcp | 小红书互动能力参考和补强 |
| LIghtJUNction/douyin | 抖音采集、OAuth、评论和私信能力 |
| bilibili-mcp | B站搜索、评论、私信、通知和发布 |
| pgvector | 线索去重、知识召回和客户记忆 |
| Langfuse | 模型调用、成本和回复质量观测 |
| promptfoo | Prompt 和模型回归评测 |
| n8n | 外部表单、CRM、广告和通知自动化 |

最终方向：

> **中国平台上的 AI 内容生产、全网情报、自动互动、线索识别、微信承接和 CRM 转化一体化系统。**

3010 的核心壁垒不应该是“接入了多少 GitHub 项目”，而应该是：

```text
发现更准
内容更快
发布更稳
回复更像人
线索不丢失
客户可追踪
转化可证明
```

## 11. 参考资料

- `README.md`
- `AGENTS.md`
- `交接_2026-08-01_发布中心完整交接.md`
- `交接_2026-08-04_移动端响应式PWA.md`
- `分析_MultiPost-Extension_发布能力参考.md`
- `对比_MultiPost_vs_JIUZHANG_发布能力.md`
- `开发文档_JIUZHANG_AI_多平台发布中心升级.md`
- `docs/acceptance-evidence-2026-08-09/p9-external-publish-readback-gate-2026-08-09T08-20-14-180Z/report.md`
- `docs/wechat-commercial-handoff-2026-06-29.md`

