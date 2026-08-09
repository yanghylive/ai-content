# 3010 方案能力全量验收报告

生成时间：2026-07-03T15:59:14.951Z
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

- live 调用数：0
- planned_not_called：27

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| douyin-search-article | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| douyin-search-user | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| xiaohongshu-search-article | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| xiaohongshu-search-user | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| gzh-search-article | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| gzh-search-user | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| deepsearch-doubao-submit | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| tiktok-search-user | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| douyin-query-work | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| douyin-query-user | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| douyin-comment | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| xiaohongshu-query-account | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| xiaohongshu-comment | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| gzh-query-user | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| media-parse-work | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| deepsearch-doubao-result | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| bilibili-work-detail | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| bilibili-account-detail | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| bilibili-comment-submit | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| bilibili-comment-result | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| gzh-query-article | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| gpt-image-submit | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| gpt-image-result | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| seedream-image-submit | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| seedream-image-result | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| seedance-video-submit | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |
| seedance-video-result | planned_not_called | FULL_REDFOX_LIVE 未开启 |  |

## 21 个 SkillHub 能力分类

- 本地 Skill 就绪：0
- live 成功：21
- 缺本地 Skill：0

| SkillHub | 状态 | 本地目录 |
|---|---|---|
| trending-hub | live_success | 有 |
| trending-hub-top10 | live_success | 有 |
| cn-last30days | live_success | 有 |
| xiaohongshu-title-score | live_success | 有 |
| wechat-title | live_success | 有 |
| multi-rewrite | live_success | 有 |
| xiaohongshu-rewrite | live_success | 有 |
| wechat-rewrite | live_success | 有 |
| zhihu-rewrite | live_success | 有 |
| video-prompt-expert | live_success | 有 |
| multi-wordcheck | live_success | 有 |
| douyin-prohibited-word | live_success | 有 |
| xiaohongshu-prohibited-word | live_success | 有 |
| wechat-prohibited-word | live_success | 有 |
| pdf-image-text-extractor | live_success | 有 |
| douyin-rise-ranking | live_success | 有 |
| douyin-content-surge | live_success | 有 |
| douyin-weekly-surge | live_success | 有 |
| douyin-comment | live_success | 有 |
| xiaohongshu-comment | live_success | 有 |
| bilibili-comment | live_success | 有 |

## 15 个方案包业务闭环

- 通过：15/15

| 方案包 | 状态 | runId | 业务对象 |
|---|---|---|---|
| 热点选题解决方案 | passed | cmr54c9cx08se8o5i7e20fnwz | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr54c9do08t68o5ivhazwo32 | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr54c9ef08ty8o5itbwcrs3n | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr54c9f708uq8o5ijjo4yjf8 | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr54c9fz08vh8o5izr7lnc8h | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr54c9gr08w98o5ipzarphgt | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr54c9hi08wz8o5is8zbtt3m | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr54c9i908xp8o5i2pg293a4 | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr54c9j308yg8o5ix0bltldc | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr54c9jz08z78o5ima5bk7wg | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr54c9kr08zx8o5ibkxfhvag | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr54c9ll090n8o5isf1srkmn | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr54c9mf091d8o5i6inec1m5 | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr54c9n809248o5irocs4m8b | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr54c9o2092v8o5i06vmkl80 | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 本轮脚本未发现剩余阻断项。
