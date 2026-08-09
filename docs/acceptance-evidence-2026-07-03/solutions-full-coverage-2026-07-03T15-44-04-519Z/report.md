# 3010 方案能力全量验收报告

生成时间：2026-07-03T15:44:53.441Z
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

- live 调用数：16
- live_success：16
- blocked_missing_sample_input：7
- skipped_high_cost：4

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| douyin-search-article | live_success | 抖音作品搜索 | cmr53stj8023t8oesfbvyknot |
| douyin-search-user | live_success | 抖音账号搜索 | cmr53suxl02418oeskq5azsz7 |
| xiaohongshu-search-article | live_success | 小红书作品搜索 | cmr53svhp02498oeser9n02jk |
| xiaohongshu-search-user | live_success | 小红书账号搜索 | cmr53sy2u024h8oesyqy70w0c |
| gzh-search-article | live_success | 公众号文章搜索 | cmr53sylk024p8oesnfaap2vn |
| gzh-search-user | live_success | 公众号账号搜索 | cmr53szdc024x8oespccthxxo |
| deepsearch-doubao-submit | live_success | 豆包 WebSearch 提交 | cmr53szii02558oes5dqrx0it |
| tiktok-search-user | live_success | TikTok 账号搜索 | cmr53ta99025v8oesi2e3gmh2 |
| douyin-query-work | live_success | 抖音作品详情查询 | cmr53tdck02638oesmogz14u4 |
| douyin-query-user | live_success | 抖音账号详情 | cmr53tgcg026b8oes6ru7yuor |
| douyin-comment | live_success | 抖音评论分析 | cmr53ti0q026j8oeskrkrw6yb |
| xiaohongshu-query-account | live_success | 小红书账号详情 | cmr53tksz026r8oes5tt1ysol |
| xiaohongshu-comment | live_success | 小红书评论分析 | cmr53tobk026z8oesoxq35wpk |
| gzh-query-user | live_success | 公众号账号详情 | cmr53tqtd02778oesl5a3iz71 |
| media-parse-work | live_success | 短视频下载器 | cmr53tsgz027f8oes6jekxyww |
| deepsearch-doubao-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| bilibili-work-detail | blocked_missing_sample_input | 缺可复用样本字段：bilibiliWorkUrl/bvid/opusId |  |
| bilibili-account-detail | live_success | B 站账号详情 | cmr53tsn8027n8oesqsx3vwjy |
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
| 热点选题解决方案 | passed | cmr53tsnj027v8oes6r0rsxtn | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr53tsoe028n8oestgv8us3a | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr53tsp1029f8oesy9y3m92w | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr53tspo02a78oes96qiiiv1 | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr53tsqd02ay8oestr1asy4e | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr53tsr202bq8oesmu63fc6n | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr53tsrr02cg8oesxubj04m4 | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr53tssi02d68oes00nnrmbc | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr53tst902dx8oesvfexnz02 | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr53tsty02eo8oes9saeo5cx | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr53tsum02fe8oesel1pbhk9 | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr53tsv902g48oeskbakvxx7 | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr53tsvy02gu8oesnh5wmvrg | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr53tswn02hl8oes969ws181 | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr53tsxb02ic8oestttklpek | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 高成本接口未默认外呼：gzh-query-article、gpt-image-submit、seedream-image-submit、seedance-video-submit。要跑完整外部生成，设置 FULL_REDFOX_ALLOW_HIGH_COST=true。
- 缺真实样本输入的接口：deepsearch-doubao-result、bilibili-work-detail、bilibili-comment-submit、bilibili-comment-result、gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
