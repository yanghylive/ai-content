# 3010 方案能力全量验收报告

生成时间：2026-07-03T17:02:54.930Z
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

- live 调用数：1
- live_failed：1

| API mapping | 状态 | 说明 | 调用日志 |
|---|---|---|---|
| bilibili-work-detail | live_failed | {"success":false,"data":null,"message":"B 站作品详情 执行失败：接口执行异常，积分未扣除: 未找到该作品","timestamp":"2026-07-03T17:02:54.426Z","path":"/api/redfox/skills/run"} |  |

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
| 热点选题解决方案 | passed | cmr56m4ti03sj8olcx27l7n2m | cmr53s5t901r68oes5a5yrl44 |
| 竞品账号雷达 | passed | cmr56m4uh03tb8olcpzet4k3u | cmr53s5u201s08oes9zh7s6ft |
| 评论获客解决方案 | passed | cmr56m4vg03u38olcjc4z6oxk | cmr53s5uv01su8oesoljtojdb |
| 创作增强解决方案 | passed | cmr56m4wf03uv8olcm4tk0tq9 | cmr53s5vk01tn8oes6c5mkpzm |
| 发布合规解决方案 | passed | cmr56m4xd03vm8olc6l9q71oy | cmr53s5w801uh8oesg6m0jskz |
| 行业情报包 | passed | cmr56m4yb03we8olcm730gpau | cmr53s5wv01v98oesalm54lbg |
| 出海内容情报包 | passed | cmr56m4z603x48olc7fh73hp7 | cmr53s5xi01w18oestu84qs4w |
| 低粉爆款挖掘包 | passed | cmr56m50003xu8olc3wf4h2o8 | cmr53s5y601wu8oeszgjc4vye |
| 达人/KOL 筛选包 | passed | cmr56m50z03yl8olcadyrb15b | cmr53s5z001xn8oesce74vrkr |
| 爆款拆解包 | passed | cmr56m51v03zc8olcndmk570f | cmr53s5zq01yf8oes6h7ca3km |
| 私域素材提取包 | passed | cmr56m52p04028olcvnptc8xh | cmr53s60g01z78oesfml6iwqv |
| AIGC 素材工厂 | passed | cmr56m53j040s8olcuvsr2xit | cmr53s61601zz8oeshrmg3hfp |
| 多平台文案适配包 | passed | cmr56m54e041i8olcp7q9c464 | cmr53s61x020s8oesr7fog4v9 |
| 账号体检包 | passed | cmr56m55b04298olcmy7o9dey | cmr53s62s021l8oesmovvdudw |
| 舆情/品牌词监控包 | passed | cmr56m56b04308olc83seswvc | cmr53s63l022d8oesbla6ptmz |

## 仍需人工判断的项

- live 外呼失败接口：bilibili-work-detail(400)。需要看 RedFox 返回错误和接口参数。
- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。
