# 3010 方案能力全量验收报告

生成时间：2026-07-03T15:56:29.690Z
API Base：http://127.0.0.1:3011/api

## 总口径

- 方案包：15
- 方案包功能引用：64
- 普通 RedFox API 引用：43
- SkillHub/Agent Skill 引用：21
- 去重 API mapping：27
- 去重 SkillHub：21

## 后端接入总表

- 状态：passed
- unmapped：0
- contractOnly：0

## 前端产品口径

- 状态：passed
- PASS admin diagnostics hidden：普通用户页不展示 runner/API/SkillHub 诊断块
- PASS no visible trial copy：普通用户动作不能再叫试跑或确认口令
- PASS direct business action copy：入口动词是业务动作，不是工程动作

## 27 个去重 API mapping 分类

- live 调用数：15
- live_success：15
- blocked_missing_sample_input：8
- skipped_high_cost：4

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| douyin-search-article | live_success | 抖音作品搜索 | cmr547isu01on8o5iqvd7zjwu |
| douyin-search-user | live_success | 抖音账号搜索 | cmr547jgv01ov8o5ibsb1k41y |
| xiaohongshu-search-article | live_success | 小红书作品搜索 | cmr547ju301q38o5i74yabxtf |
| xiaohongshu-search-user | live_success | 小红书账号搜索 | cmr547k4l01qb8o5ium60i4ey |
| gzh-search-article | live_success | 公众号文章搜索 | cmr547kgn01qj8o5iklcyd63f |
| gzh-search-user | live_success | 公众号账号搜索 | cmr547lsb01rr8o5ir3nj9vf4 |
| deepsearch-doubao-submit | live_success | 豆包 WebSearch 提交 | cmr547lxe01rz8o5i6c3g2t00 |
| tiktok-search-user | live_success | TikTok 账号搜索 | cmr547tnk020j8o5i7d1l8bc1 |
| douyin-query-work | live_success | 抖音作品详情查询 | cmr547v1y024f8o5ivi9e26zp |
| douyin-query-user | live_success | 抖音账号详情 | cmr547vn2024t8o5ifokcp5w4 |
| douyin-comment | live_success | 抖音评论分析 | cmr5480pr029d8o5iyjixlj6h |
| xiaohongshu-query-account | live_success | 小红书账号详情 | cmr54820t029l8o5i9wbnlaxn |
| xiaohongshu-comment | live_success | 小红书评论分析 | cmr548fbn02lz8o5ie2s2zlv5 |
| gzh-query-user | live_success | 公众号账号详情 | cmr548fsw02m78o5ivvz9e4ke |
| media-parse-work | live_success | 短视频下载器 | cmr548pvy02zf8o5i5ey9x8ji |
| deepsearch-doubao-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| bilibili-work-detail | blocked_missing_sample_input | 缺可复用样本字段：bilibiliWorkUrl/bvid/opusId |  |
| bilibili-account-detail | blocked_missing_sample_input | 缺可复用样本字段：bilibiliAccountId/mid |  |
| bilibili-comment-submit | blocked_missing_sample_input | 缺可复用样本字段：bilibiliWorkUrl/bvid/opusId |  |
| bilibili-comment-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| gzh-query-article | skipped_high_cost | 高成本生成/详情接口默认不外呼；设置 FULL_REDFOX_ALLOW_HIGH_COST=true 可跑 |  |
| gpt-image-submit | skipped_high_cost | 高成本生成/详情接口默认不外呼；设置 FULL_REDFOX_ALLOW_HIGH_COST=true 可跑 |  |
| gpt-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedream-image-submit | skipped_high_cost | 高成本生成/详情接口默认不外呼；设置 FULL_REDFOX_ALLOW_HIGH_COST=true 可跑 |  |
| seedream-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedance-video-submit | skipped_high_cost | 高成本生成/详情接口默认不外呼；设置 FULL_REDFOX_ALLOW_HIGH_COST=true 可跑 |  |
| seedance-video-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |

## 21 个 SkillHub 能力分类

- 本地 Skill 就绪：21
- live 成功：0
- 缺本地 Skill：0

| SkillHub | 状态 | 本地目录 |
|---|---|---|
| trending-hub | ready_local_skill | 有 |
| trending-hub-top10 | ready_local_skill | 有 |
| cn-last30days | ready_local_skill | 有 |
| xiaohongshu-title-score | ready_local_skill | 有 |
| wechat-title | ready_local_skill | 有 |
| multi-rewrite | ready_local_skill | 有 |
| xiaohongshu-rewrite | ready_local_skill | 有 |
| wechat-rewrite | ready_local_skill | 有 |
| zhihu-rewrite | ready_local_skill | 有 |
| video-prompt-expert | ready_local_skill | 有 |
| multi-wordcheck | ready_local_skill | 有 |
| douyin-prohibited-word | ready_local_skill | 有 |
| xiaohongshu-prohibited-word | ready_local_skill | 有 |
| wechat-prohibited-word | ready_local_skill | 有 |
| pdf-image-text-extractor | ready_local_skill | 有 |
| douyin-rise-ranking | ready_local_skill | 有 |
| douyin-content-surge | ready_local_skill | 有 |
| douyin-weekly-surge | ready_local_skill | 有 |
| douyin-comment | ready_local_skill | 有 |
| xiaohongshu-comment | ready_local_skill | 有 |
| bilibili-comment | ready_local_skill | 有 |

## 15 个方案包业务闭环

- 通过：15/15

| 方案包 | 状态 | runId | 业务对象 |
|---|---|---|---|
| 热点选题解决方案 | passed | cmr548pwa02zn8o5ioe82tkl4 | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr548pwz030f8o5icr1ikqwy | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr548pxm03178o5is99q6jnk | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr548py8031z8o5i2s9wp60x | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr548pyv032q8o5iqqkn05o1 | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr548pzi033i8o5i9hmlzzr6 | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr548q0503488o5iui2lkrx2 | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr548q0t034y8o5ipfffbpmy | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr548q1h035p8o5ichppo1p5 | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr548q24036g8o5iqjd77ptc | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr548q2s03768o5iva5oascc | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr548q3j037w8o5iola7rczb | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr548q47038m8o5im7wq7l2i | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr548q4v039d8o5irttvcxyk | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr548q5j03a48o5idp2t0rg1 | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 高成本接口未默认外呼：gzh-query-article、gpt-image-submit、seedream-image-submit、seedance-video-submit。要跑完整外部生成，设置 FULL_REDFOX_ALLOW_HIGH_COST=true。
- 缺真实样本输入的接口：deepsearch-doubao-result、bilibili-work-detail、bilibili-account-detail、bilibili-comment-submit、bilibili-comment-result、gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
