# 3010 方案能力全量验收报告

生成时间：2026-07-03T17:19:22.160Z
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

- live 调用数：2
- live_success：2

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| xiaohongshu-query-account | live_success | 小红书账号详情 | cmr5778ls089y8oqn93wwebwv |
| gzh-query-user | live_success | 公众号账号详情 | cmr577ap508co8oqnu3ifwog2 |

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
| 热点选题解决方案 | passed | cmr577aph08cw8oqnh93q6r53 | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr577aq808do8oqnhwbeo0nz | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr577aqv08eg8oqnoasy9k4t | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr577ari08f88oqnamsucxkm | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr577as208fz8oqnxjnjbzsz | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr577asn08gr8oqnjwszm2ho | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr577at908hh8oqn6qdkfg7w | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr577ats08i78oqnfl67z4o5 | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr577auc08iy8oqn9yev1vsb | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr577auw08jp8oqnwoa3vr71 | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr577avh08kf8oqnm18zuvp9 | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr577aw208l58oqnmkehci4j | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr577awm08lv8oqn8zw7t8w5 | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr577ax608mm8oqn8dcsarlg | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr577axs08nd8oqngy00o758 | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
