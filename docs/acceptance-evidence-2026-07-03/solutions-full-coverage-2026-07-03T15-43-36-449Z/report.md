# 3010 方案能力全量验收报告

生成时间：2026-07-03T15:43:37.194Z
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
| 热点选题解决方案 | passed | cmr53s5sw01qs8oes7b5x55va | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr53s5tr01rm8oesdklyd8uf | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr53s5ul01sg8oes6d91bowp | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr53s5va01ta8oest15ei735 | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr53s5vz01u38oessp5kq81c | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr53s5wm01ux8oesrrvx38un | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr53s5x901vp8oesuel71zw7 | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr53s5xx01wh8oes5zhcmraa | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr53s5yr01xa8oes12b0z6jt | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr53s5zh01y38oesvtaqu49f | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr53s60601yv8oesn7rmxynn | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr53s60v01zn8oesooavuats | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr53s61n020f8oesazytgjbv | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr53s62g02188oes91e8xsmj | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr53s63a02218oes536e41tc | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
