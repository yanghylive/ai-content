# 3010 方案能力全量验收报告

生成时间：2026-07-03T16:50:06.190Z
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

- live 调用数：5
- live_success：5
- blocked_missing_sample_input：5

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| deepsearch-doubao-submit | live_success | 豆包 WebSearch 提交 | cmr565gmc05hv8otitbgx2sk1 |
| deepsearch-doubao-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| bilibili-comment-submit | live_success | B 站评论分析 | cmr565h0q05i98oti96m543bz |
| bilibili-comment-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| gpt-image-submit | live_success | image2-GPT 提交任务 | cmr565js505k18otiogyc60ws |
| gpt-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedream-image-submit | live_success | Seedream 5.0 lite 提交任务 | cmr565nf405r18otiazhgdz05 |
| seedream-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedance-video-submit | live_success | Seedance 2.0 视频生成提交任务 | cmr565nk905r98otip8hn8ndd |
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
| 热点选题解决方案 | passed | cmr565nkl05rh8otibetl4y4q | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr565nlh05s98oti48f1n3it | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr565nma05t18otioqqhgdv0 | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr565nn505tt8otiexs0pcuf | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr565nny05uk8oti0tj7y8qk | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr565nou05vc8otijs6xe9sv | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr565nps05w28otigaqf1m6r | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr565nqo05ws8otiixopi4lg | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr565nrk05xj8oti624k6g3g | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr565nsh05ya8otinjvktift | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr565ntf05z08oti8lc3tuef | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr565nug05zq8otixyhfgq4r | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr565nvr060g8otisjj0cns9 | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr565nxi06178otilzt9m3ls | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr565nzr061y8oti8meykszh | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 缺真实样本输入的接口：deepsearch-doubao-result、bilibili-comment-result、gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
