# 3010 方案能力全量验收报告

生成时间：2026-07-03T16:48:41.269Z
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

- live 调用数：22
- live_success：21
- live_failed：1
- blocked_missing_sample_input：5

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| douyin-search-article | live_success | 抖音作品搜索 | cmr560tkf00348oti7fdj0omy |
| douyin-search-user | live_success | 抖音账号搜索 | cmr560wb1003c8oti8yrr98kq |
| xiaohongshu-search-article | live_success | 小红书作品搜索 | cmr560yet003k8otioat8uv2s |
| xiaohongshu-search-user | live_success | 小红书账号搜索 | cmr5611ul003s8otinelm5ls9 |
| gzh-search-article | live_success | 公众号文章搜索 | cmr56128t00408oti0xp93vsi |
| gzh-search-user | live_success | 公众号账号搜索 | cmr5614sj00488oti3wsogu4k |
| deepsearch-doubao-submit | live_success | 豆包 WebSearch 提交 | cmr5614xz004g8oti7o88vcjw |
| tiktok-search-user | live_success | TikTok 账号搜索 | cmr561fyz00h08otiivgjeou2 |
| douyin-query-work | live_success | 抖音作品详情查询 | cmr561ioe00m28oti4lsi6bs1 |
| douyin-query-user | live_success | 抖音账号详情 | cmr561j4p00ma8oti2h36ag84 |
| douyin-comment | live_success | 抖音评论分析 | cmr561mls00nu8otily09ew45 |
| xiaohongshu-query-account | live_success | 小红书账号详情 | cmr561pce00rw8otijz93hc32 |
| xiaohongshu-comment | live_failed | {"success":false,"data":null,"message":"RedFox 请求超时，请稍后重试","timestamp":"2026-07-03T16:48:01.541Z","path":"/api/redfox/skills/run"} |  |
| gzh-query-user | live_success | 公众号账号详情 | cmr5632id022c8otit9sp5o0e |
| media-parse-work | live_success | 短视频下载器 | cmr563beo02ce8otiayy0oo17 |
| deepsearch-doubao-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| bilibili-work-detail | live_success | B 站作品详情 | cmr563c3102dy8oti2gm5sb1f |
| bilibili-account-detail | live_success | B 站账号详情 | cmr563dna02h08otiru8xndxl |
| bilibili-comment-submit | live_success | B 站评论分析 | cmr563ds802h88otidsjwc83c |
| bilibili-comment-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| gzh-query-article | live_success | 公众号文章互动分析 | cmr563rkb02zg8oti6waifasg |
| gpt-image-submit | live_success | image2-GPT 提交任务 | cmr563stm032o8otic68nn637 |
| gpt-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedream-image-submit | live_success | Seedream 5.0 lite 提交任务 | cmr563tio032w8otidn55tizs |
| seedream-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedance-video-submit | live_success | Seedance 2.0 视频生成提交任务 | cmr563tns03348otinayamgjt |
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
| 热点选题解决方案 | passed | cmr563tog033c8oti14i8kfus | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr563tqb03448oticd5spqdc | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr563tth034w8otif1g5sgz6 | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr563ty0035o8otiprze1js4 | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr563u0r036f8otim5zskmtb | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr563u3y037d8otibf4l2b2u | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr563u5j03838otit2ym0thu | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr563u8t03an8otib0ez60yv | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr563uae03bs8otiv0oj95bb | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr563ubx03d58otifzzlzwm4 | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr563udf03dv8otidm3a8ire | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr563uex03el8otid9iea7ut | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr563ug703fb8oti8qbhf5n2 | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr563uh103g28oti9rh6uid9 | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr563uhu03gt8oti9qfealns | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 缺真实样本输入的接口：deepsearch-doubao-result、bilibili-comment-result、gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- live 外呼失败接口：xiaohongshu-comment(504)。需要看 RedFox 返回错误和接口参数。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
