# 3010 方案能力全量验收报告

生成时间：2026-07-09T17:37:49.508Z
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
| 热点选题解决方案 | passed | cmrdsi53k0qyxi777c66jfudo | cmrcndprj10y8i7pcxcfkpjxm |
| 竞品账号雷达 | passed | cmrdsi54d0qzpi777v67eosyi | cmrcndps810z2i7pcrxix9nix |
| 评论获客解决方案 | passed | cmrdsi55b0r0hi777npp9jmem | cmrcndpt71104i7pcb82dktwv |
| 创作增强解决方案 | passed | cmrdsi5620r19i7779cdsgg9w | cmrcndpvl1111i7pciv210dos |
| 发布合规解决方案 | passed | cmrdsi56z0r20i7773ab1fozy | cmrcndpwb111xi7pcran6hwbi |
| 行业情报包 | passed | cmrdsi57k0r2si777xmb26qvl | cmrcndpww112pi7pcxtulpz88 |
| 出海内容情报包 | passed | cmrdsi5840r3ii7771jyw49bx | cmrcndpxu113ni7pci00fcu9l |
| 低粉爆款挖掘包 | passed | cmrdsi58q0r48i7775o64wd1y | cmrcndq02114wi7pc5xq74mpt |
| 达人/KOL 筛选包 | passed | cmrdsi59m0r4zi777i3jmq72a | cmrcndq0p115ri7pchxtmd8q8 |
| 爆款拆解包 | passed | cmrdsi5ac0r5qi7779f277ru0 | cmrcndq34116ni7pc8qo1brqc |
| 私域素材提取包 | passed | cmrdsi5b10r6gi77717zxrz8s | cmrcndq3o117fi7pc50nhsy7t |
| AIGC 素材工厂 | passed | cmrdsi5bp0r76i77749a5g8a8 | cmrcndq491187i7pc6ycfsjqq |
| 多平台文案适配包 | passed | cmrdsi5cb0r7wi7775flxqsx4 | cmrcndq4v1190i7pcippj5bg9 |
| 账号体检包 | passed | cmrdsi5cx0r8ni777sqagb410 | cmrcndq5i119ti7pc7doit3wz |
| 舆情/品牌词监控包 | passed | cmrdsi5dh0r9ei777wl00bqje | cmrcndq6511ali7pcolpvfzab |

## 仍需人工判断的项

- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
