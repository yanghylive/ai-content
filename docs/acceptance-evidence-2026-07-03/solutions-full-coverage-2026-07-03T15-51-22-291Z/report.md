# 3010 方案能力全量验收报告

生成时间：2026-07-03T15:53:33.297Z
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
- live_success：14
- live_failed：1
- blocked_missing_sample_input：8
- skipped_high_cost：4

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| douyin-search-article | live_success | 抖音作品搜索 | cmr5428rw00548o5igksn7vb3 |
| douyin-search-user | live_success | 抖音账号搜索 | cmr542bak005u8o5i1jklj278 |
| xiaohongshu-search-article | live_success | 小红书作品搜索 | cmr542dxo00628o5i1ooq0sle |
| xiaohongshu-search-user | live_success | 小红书账号搜索 | cmr542ghz006a8o5ixsq454i2 |
| gzh-search-article | live_success | 公众号文章搜索 | cmr542ht6006i8o5iubbpi90y |
| gzh-search-user | live_success | 公众号账号搜索 | cmr542kf7006q8o5ibrzunox3 |
| deepsearch-doubao-submit | live_success | 豆包 WebSearch 提交 | cmr542kkd006y8o5il90urs8s |
| tiktok-search-user | live_success | TikTok 账号搜索 | cmr542y3m00768o5i85bvn8z2 |
| douyin-query-work | live_success | 抖音作品详情查询 | cmr5431j3007w8o5iaj9oqrnz |
| douyin-query-user | live_success | 抖音账号详情 | cmr54340300848o5iok0d8pu4 |
| douyin-comment | live_success | 抖音评论分析 | cmr5436zt008c8o5ius3lkaau |
| xiaohongshu-query-account | live_success | 小红书账号详情 | cmr5439h3008k8o5ijrof6t9r |
| xiaohongshu-comment | live_failed | {"success":false,"data":null,"message":"RedFox 请求超时，请稍后重试","timestamp":"2026-07-03T15:53:14.845Z","path":"/api/redfox/skills/run"} |  |
| gzh-query-user | live_success | 公众号账号详情 | cmr544nf700a08o5i0ugitl5b |
| media-parse-work | live_success | 短视频下载器 | cmr544xpn00aq8o5ir8xcwuny |
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
| 热点选题解决方案 | passed | cmr544xq100ay8o5ix9z277hq | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr544xqq00bq8o5iqabx6d70 | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr544xrg00ci8o5i68qunaro | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr544xs300da8o5ic4moyvyl | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr544xsr00e18o5innsehhjl | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr544xtg00et8o5i12ug7y0w | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr544xu800fj8o5ih7qqmh0p | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr544xuz00g98o5ib5p5f766 | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr544xvu00h08o5i5mg6novq | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr544xx100hr8o5i85q2s6en | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr544xyc00ih8o5iz81f3t6x | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr544xze00j78o5ix4kltcwh | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr544y0700jx8o5itlp7tfhs | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr544y1100ko8o5iktof8jgh | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr544y1r00lf8o5ionu4jl38 | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 高成本接口未默认外呼：gzh-query-article、gpt-image-submit、seedream-image-submit、seedance-video-submit。要跑完整外部生成，设置 FULL_REDFOX_ALLOW_HIGH_COST=true。
- 缺真实样本输入的接口：deepsearch-doubao-result、bilibili-work-detail、bilibili-account-detail、bilibili-comment-submit、bilibili-comment-result、gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- live 外呼失败接口：xiaohongshu-comment(504)。需要看 RedFox 返回错误和接口参数。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
