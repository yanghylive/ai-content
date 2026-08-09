# 3010 方案能力全量验收报告

生成时间：2026-07-03T17:21:14.988Z
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

- live 调用数：24
- live_success：21
- live_failed：3
- blocked_missing_sample_input：3

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| douyin-search-article | live_success | 抖音作品搜索 | cmr5789nf09mq8oqng5uxaspg |
| douyin-search-user | live_success | 抖音账号搜索 | cmr578c6x09ng8oqnvsj52mri |
| xiaohongshu-search-article | live_success | 小红书作品搜索 | cmr578cpe09no8oqnq4t363ml |
| xiaohongshu-search-user | live_success | 小红书账号搜索 | cmr578d4z09nw8oqn6hqegbf5 |
| gzh-search-article | live_success | 公众号文章搜索 | cmr578for09o48oqnvwff3zlp |
| gzh-search-user | live_success | 公众号账号搜索 | cmr578ibv09oc8oqnfez4nxij |
| deepsearch-doubao-submit | live_success | 豆包 WebSearch 提交 | cmr578kc009ok8oqnkzrehpfp |
| tiktok-search-user | live_success | TikTok 账号搜索 | cmr578rme09pg8oqndyk1gv1c |
| douyin-query-work | live_success | 抖音作品详情查询 | cmr578sxd09po8oqnndt80681 |
| douyin-query-user | live_success | 抖音账号详情 | cmr578vex09pw8oqnliy5xzsg |
| douyin-comment | live_success | 抖音评论分析 | cmr578wrt09q48oqn56r229wh |
| xiaohongshu-query-account | live_success | 小红书账号详情 | cmr578zda09qu8oqnengfsavk |
| xiaohongshu-comment | live_success | 小红书评论分析 | cmr5790kt09r28oqnuwkck6up |
| gzh-query-user | live_success | 公众号账号详情 | cmr57932209ra8oqnlwlmvc2x |
| media-parse-work | live_success | 短视频下载器 | cmr579b4209ri8oqnixg6upxl |
| deepsearch-doubao-result | live_success | 豆包 WebSearch 结果 | cmr579cd009rq8oqnpyapg2ts |
| bilibili-work-detail | live_success | B 站作品详情 | cmr579euw09ry8oqne2fnmaj7 |
| bilibili-account-detail | live_success | B 站账号详情 | cmr579f6409s68oqntzc07y1p |
| bilibili-comment-submit | live_success | B 站评论分析 | cmr579hvj09se8oqnioct0kf4 |
| bilibili-comment-result | live_success | B 站评论结果读取 | cmr579i5709sm8oqnxtjiknbp |
| gzh-query-article | live_success | 公众号文章互动分析 | cmr579m5v09tc8oqnqccyx6g5 |
| gpt-image-submit | live_failed | {"success":false,"data":null,"message":"image2-GPT 提交任务 执行失败：接口执行异常，积分未扣除: 本接口已升级为仅支持付费调用，账户免费积分可抵扣其他红狐接口。（长期遭羊毛党批量消耗，运营成本难以为继，无奈更新计费规则，敬请谅解。付费充值https://redfox.hk/dashboard/recharge）","timestamp":"2026-07-03T17:21:13.453Z","path":"/api/redfox/skills/run"} |  |
| gpt-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedream-image-submit | live_failed | {"success":false,"data":null,"message":"Seedream 5.0 lite 提交任务 执行失败：接口执行异常，积分未扣除: 本接口已升级为仅支持付费调用，账户免费积分可抵扣其他红狐接口。（长期遭羊毛党批量消耗，运营成本难以为继，无奈更新计费规则，敬请谅解。付费充值https://redfox.hk/dashboard/recharge）","timestamp":"2026-07-03T17:21:14.056Z","path":"/api/redfox/skills/run"} |  |
| seedream-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedance-video-submit | live_failed | {"success":false,"data":null,"message":"Seedance 2.0 视频生成提交任务 执行失败：积分不足，可用: 94.6, 需要: 150.0","timestamp":"2026-07-03T17:21:14.681Z","path":"/api/redfox/skills/run"} |  |
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
| 热点选题解决方案 | passed | cmr579ps409u88oqn160vc1cq | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr579pss09v08oqnjv6oq471 | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr579ptc09vs8oqnhkp2cdfl | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr579ptv09wk8oqnsz9mlle7 | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr579pud09xb8oqn5hvnzt7x | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr579pux09y38oqnhu3g54r3 | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr579pvh09yt8oqnrc1i7lqc | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr579pw109zj8oqnxxsk1ecm | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr579pwm0a0a8oqncplciv7b | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr579px60a118oqnd55exwcn | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr579pxo0a1r8oqnue6q1vix | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr579py80a2h8oqntaxqo0p0 | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr579pyu0a378oqnf3avffdx | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr579pze0a3y8oqn4lmgfflu | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr579pzy0a4p8oqnkxe4djgg | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 缺真实样本输入的接口：gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- live 外呼失败接口：gpt-image-submit(400)、seedream-image-submit(400)、seedance-video-submit(400)。需要看 RedFox 返回错误和接口参数。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
