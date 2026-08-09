# 3010 方案能力全量验收报告

生成时间：2026-07-03T16:59:54.449Z
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

- live 调用数：6
- live_failed：4
- blocked_missing_sample_input：4
- live_success：2

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| deepsearch-doubao-submit | live_failed | {"success":false,"data":null,"message":"豆包 WebSearch 提交 执行失败：搜索文本不能为空","timestamp":"2026-07-03T16:59:46.279Z","path":"/api/redfox/skills/run"} |  |
| deepsearch-doubao-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| bilibili-comment-submit | live_success | B 站评论分析 | cmr56i67700ci8olcellgpcz1 |
| bilibili-comment-result | live_success | B 站评论结果读取 | cmr56i88r00cq8olcv9vpmvh0 |
| gpt-image-submit | live_failed | {"success":false,"data":null,"message":"image2-GPT 提交任务 执行失败：接口执行异常，积分未扣除: 本接口已升级为仅支持付费调用，账户免费积分可抵扣其他红狐接口。（长期遭羊毛党批量消耗，运营成本难以为继，无奈更新计费规则，敬请谅解。付费充值https://redfox.hk/dashboard/recharge）","timestamp":"2026-07-03T16:59:52.913Z","path":"/api/redfox/skills/run"} |  |
| gpt-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedream-image-submit | live_failed | {"success":false,"data":null,"message":"Seedream 5.0 lite 提交任务 执行失败：接口执行异常，积分未扣除: 本接口已升级为仅支持付费调用，账户免费积分可抵扣其他红狐接口。（长期遭羊毛党批量消耗，运营成本难以为继，无奈更新计费规则，敬请谅解。付费充值https://redfox.hk/dashboard/recharge）","timestamp":"2026-07-03T16:59:53.516Z","path":"/api/redfox/skills/run"} |  |
| seedream-image-result | blocked_missing_sample_input | 缺上游 submit 返回的 taskId |  |
| seedance-video-submit | live_failed | {"success":false,"data":null,"message":"Seedance 2.0 视频生成提交任务 执行失败：系统内部错误","timestamp":"2026-07-03T16:59:53.712Z","path":"/api/redfox/skills/run"} |  |
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
| 热点选题解决方案 | passed | cmr56i9ds00dm8olcfilglhgk | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr56i9f200ee8olchxb093qy | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr56i9gf00f68olca0ic3i51 | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr56i9i000fy8olcbggz4n4e | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr56i9jj00gp8olcqg8af3rd | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr56i9kr00hh8olcnfztlns8 | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr56i9m400i78olcha7c23ac | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr56i9nk00ix8olcu7xxatd8 | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr56i9op00jo8olc9m598slb | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr56i9pm00kf8olcqwioc6tj | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr56i9qj00l58olce46toiqc | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr56i9rf00lv8olceil4g9nb | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr56i9sd00ml8olcckx4yhus | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr56i9tf00nc8olcef7mrwb0 | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr56i9uv00o38olcjxos2kb6 | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 缺真实样本输入的接口：deepsearch-doubao-result、gpt-image-result、seedream-image-result、seedance-video-result。需要从上游搜索结果或人工样本提供链接/账号/taskId。
- live 外呼失败接口：deepsearch-doubao-submit(400)、gpt-image-submit(400)、seedream-image-submit(400)、seedance-video-submit(400)。需要看 RedFox 返回错误和接口参数。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
