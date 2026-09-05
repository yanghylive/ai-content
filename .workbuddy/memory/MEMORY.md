# 项目长期备忘（ai-content / 3010）

## 技术债（tech debt，非阻塞，攒够一起清）

### TD-1 评论/私信获客契约字段命名系统性偏向「评论」（2026-09-05 大王拍板：暂不修，记 debt）
- 现象：`comment-acquisition` 的 lead 契约里，`commentText`/`commenterName`/`commentRef` 三个字段名清一色 `comment*` 前缀，但 lead 的 `sourceType` 有 `comment` 和 `dm` 两种；私信线索（dm）里这些字段实际承载的是「私信文本 / 发信人昵称 / 恒 null」。
- 具体位置：
  - 后端 `AcquisitionLeadRow`（`comment-acquisition.service.ts:36-53`）：`commentText` 映射 `row.sourceText`、`commenterName` 映射 `row.nickname`、`commentRef` 映射 `row.commentRef`。
  - 后端 `dispatchReply` 入参（`:490-500`）：`commentText` 承载私信内容、`commentIndex` 小红书专用。
  - 前端 `engagement/comment-acquisition/page.tsx:351-353`：`{lead.commentText}` 对私信线索渲染的是私信内容。
- 定性：值对、行为对、不出 bug，纯命名不贴切 + 契约语义单一化（字段不区分评论/私信，靠 sourceType 猜）+ 跨层不统一（DB `sourceText` → API `commentText` → 前端 `commentText`）。
- 触发时机：等要动 `listLeads` 链路（如前端需区分评论/私信渲染）时顺手统一。
- 建议改名方向：`commentText`→`sourceText`（对齐 DB 字段名）、`commenterName`→`authorName`、`commentRef`→`ref`（或按 sourceType 语义重新设计）。需大王拍板命名后，前后端一起改、独立 commit。

## 待办大项（需单独方案/真机）
- 快手/小红书「统一切关键词搜索模式」发现层改造（B 类专项，大王已定方向，方案文档 `docs/3010-自动获客发现层切换方案-B类-20260905.md`）。**B 类 S-B1~S-B4 已全部落地**（commits b1177988/43579390/20ea043d/993ad310，后端 tsc + 8 套 76 单测 + 前端 tsc 全绿）。⚠️ **真机硬门槛未做**：快手/小红书 comment-acquisition 新路径选择器 + 小红书「搜索页点击进详情页」流程必须 jz-win11 真机跑通才算真正完成。
  - **配额**：账号维度统一配额（共用）——`dailyLimit` 上提到账号维度统一「账号日触达计数器」，growth 与 comment-acquisition 切 runner 后共用，同号累计扣减、扣完即停；`perTargetLimit` 保留任务级不合并。理由：风控本质是「账号今天对外发多少条」，与发起方无关，独立计数会叠加突破平台安全阈值。（⚠️ 配额统一改造尚未动代码，仅定方向）
- **C 类专项：AI 分析行为生成关键词**（大王拍板独立成 C 类，方案文档 `docs/3010-自动获客关键词AI生成方案-C类-20260905.md`）。核心闭环：LeadSignal 行为信号 + Lead.matchedKeywords/sourceText/customerId（成交）+ negative 负反馈 → 喂 LLM（复用 `AiClientService.getClient`，kaypal 计费已内置）→ 产出 sourceKeywords/demandKeywords/excludeKeywords 建议 → 人工确认写回 `GrowthStrategyTemplate`。**C-a 规则版 S-C1~S-C5 + C-b LLM 版均已落地**（C-a: f885b50f/0b3e964e/48bc4a88/7899c8fe；C-b: 67396618 后端 suggestKeywordsWithLLM + 2ee82745 前端「AI 语义归纳」开关；后端 tsc + 12 套 99 单测 + 前端 tsc 全绿）。关键实现：`KeywordIntelligenceService`（C-a 词库命中统计不用 n-gram + C-b LLM 语义归纳造新词，失败回落 C-a）+ `applyKeywordSuggestions`（半自动写回）+ 前端建议面板。触发=手动+阈值门控，不做定时重跑。⚠️ C-b 尚未真模型联调（prompt 输出质量/计费幂等/billingSalt 防 409 需一次真实 LLM 调用验证）。
- S4-4 幂等门结构化（growth.service.ts:6563 isGrowthTouchAlreadyCompleted 靠文案 contains，需 schema 加结构化幂等键）。
