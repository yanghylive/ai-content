# 3010 方案能力全量验收报告

生成时间：2026-07-03T17:17:20.138Z
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
- live_success：18
- live_failed：6
- blocked_missing_sample_input：3

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| douyin-search-article | live_success | 抖音作品搜索 | cmr5722an011f8oqncwi1j555 |
| douyin-search-user | live_success | 抖音账号搜索 | cmr5722pu011n8oqneej30zd3 |
| xiaohongshu-search-article | live_success | 小红书作品搜索 | cmr5723xy012v8oqns5gdka25 |
| xiaohongshu-search-user | live_success | 小红书账号搜索 | cmr57249501398oqn8vnxuov9 |
| gzh-search-article | live_success | 公众号文章搜索 | cmr5724lu01658oqnu3vmtvra |
| gzh-search-user | live_success | 公众号账号搜索 | cmr57251t016d8oqnjiv2zdlj |
| deepsearch-doubao-submit | live_success | 豆包 WebSearch 提交 | cmr5726a8016r8oqnlr98tzpb |
| tiktok-search-user | live_success | TikTok 账号搜索 | cmr572hvx01h58oqn875xc18a |
| douyin-query-work | live_success | 抖音作品详情查询 | cmr572i8v01hv8oqn0cd418hj |
| douyin-query-user | live_success | 抖音账号详情 | cmr572k2c01kl8oqneqia1ank |
| douyin-comment | live_success | 抖音评论分析 | cmr572m4o01lz8oqn4f8ym2xo |
| xiaohongshu-query-account | live_failed | {"success":false,"data":null,"message":"小红书账号详情 执行失败：接口执行异常，积分未扣除: 目前优质数据库未收录本条相关数据，本次查询不扣积分。（另外红狐配套全量数据库可提供完整详实数据，如需了解采购方案，可发送邮件至 redfoxdata@proton.me 对接咨询）","timestamp":"2026-07-03T17:15:43.761Z","path":"/api/redfox/skills/run"} |  |
| xiaohongshu-comment | live_failed | {"success":false,"data":null,"message":"RedFox 请求超时，请稍后重试","timestamp":"2026-07-03T17:16:43.807Z","path":"/api/redfox/skills/run"} |  |
| gzh-query-user | live_failed | {"success":false,"data":null,"message":"公众号账号详情 执行失败：接口执行异常，积分未扣除: 目前优质数据库未收录本条相关数据，本次查询不扣积分。（另外红狐配套全量数据库可提供完整详实数据，如需了解采购方案，可发送邮件至 redfoxdata@proton.me 对接咨询）","timestamp":"2026-07-03T17:16:47.472Z","path":"/api/redfox/skills/run"} |  |
| media-parse-work | live_success | 短视频下载器 | cmr5748fv03n28oqnt0rhxi5c |
| deepsearch-doubao-result | live_success | 豆包 WebSearch 结果 | cmr574ag003og8oqnluuj39kx |
| bilibili-work-detail | live_success | B 站作品详情 | cmr574bt203si8oqnu9q4rlc0 |
| bilibili-account-detail | live_success | B 站账号详情 | cmr574c3f03uk8oqn7aery7kl |
| bilibili-comment-submit | live_success | B 站评论分析 | cmr574ema03wm8oqndtnoo9u0 |
| bilibili-comment-result | live_success | B 站评论结果读取 | cmr574hyu043u8oqnxdlbkrrg |
| gzh-query-article | live_success | 公众号文章互动分析 | cmr574m1k04bq8oqn9dzsk6ap |
| gpt-image-submit | live_failed | {"success":false,"data":null,"message":"image2-GPT 提交任务 执行失败：接口执行异常，积分未扣除: 本接口已升级为仅支持付费调用，账户免费积分可抵扣其他红狐接口。（长期遭羊毛党批量消耗，运营成本难以为继，无奈更新计费规则，敬请谅解。付费充值https://redfox.hk/dashboard/recharge）","timestamp":"2026-07-03T17:17:18.522Z","path":"/api/redfox/skills/run"} |  |
| gpt-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedream-image-submit | live_failed | {"success":false,"data":null,"message":"Seedream 5.0 lite 提交任务 执行失败：接口执行异常，积分未扣除: 本接口已升级为仅支持付费调用，账户免费积分可抵扣其他红狐接口。（长期遭羊毛党批量消耗，运营成本难以为继，无奈更新计费规则，敬请谅解。付费充值https://redfox.hk/dashboard/recharge）","timestamp":"2026-07-03T17:17:19.138Z","path":"/api/redfox/skills/run"} |  |
| seedream-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedance-video-submit | live_failed | {"success":false,"data":null,"message":"Seedance 2.0 视频生成提交任务 执行失败：积分不足，可用: 105.2, 需要: 150.0","timestamp":"2026-07-03T17:17:19.559Z","path":"/api/redfox/skills/run"} |  |
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
| 热点选题解决方案 | passed | cmr574ocv04er8oqnqy4nh5b6 | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr574odj04fj8oqn9qjrlgep | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr574oe404gb8oqnvinbuzj1 | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr574oer04h38oqnw7phqbtt | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr574ofd04hu8oqncnq6x17v | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr574ofz04im8oqnyjfsa1gp | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr574ogk04jc8oqn3j1ulp21 | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr574oh704k28oqnxurtdqvy | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr574ohy04kt8oqn81191aaf | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr574oin04lk8oqnuqhu920p | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr574ojq04ma8oqn0xsk8ovr | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr574omu04n08oqn0rzhzp32 | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr574opp04nq8oqn79lp9c1k | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr574oqy04oh8oqnkslpbnks | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr574os304pe8oqnpcrqib5u | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 缺真实样本输入的接口：gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- live 外呼失败接口：xiaohongshu-query-account(400)、xiaohongshu-comment(504)、gzh-query-user(400)、gpt-image-submit(400)、seedream-image-submit(400)、seedance-video-submit(400)。需要看 RedFox 返回错误和接口参数。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
