# AI 员工 P0-P3 非测试收口清单

日期：2026-06-15

## 口径

这份清单只处理“不需要真实账号就能完成”的剩余工作。真实抖音、真实微信、Windows 微信、发布平台账号的跑通验收单独放到最终验收阶段。

## 已收口

| 阶段 | 非测试项 | 当前状态 |
| --- | --- | --- |
| P0 | API contract、任务 schema、执行器协议 | 已落在 `backend/src/modules/runtime/ai-employee/ai-employee.contract.ts`，并由 `ai-employee.contract.spec.ts` 覆盖核心 routeable 能力。 |
| P0 | 执行器健康检查口径 | 已接入 Local Engine readiness、Agent-S/Node Runtime、platform executor 任务类型。 |
| P0 | 三类 spike 证据要求 | 已在 `AI_EMPLOYEE_PHASE0_SPIKES` 冻结 proofRequired 和 exitCriteria，真实证据文件待最终验收填充。 |
| P1 | 抖音爆款获客闭环开发口径 | 已接链接曝光、搜索曝光、爆款视频获客、定向曝光、留资曝光、候选筛选、评论/私信任务、每日上限、失败码、证据入口。定向曝光和留资曝光当前复用只读搜索采集器，后续可继续增强为精确账号主页/CRM 线索深扫。 |
| P1 | 发布基础版开发口径 | 已接抖音/小红书发布账号、素材、标题正文、发布时间、发布前检查、发布记录。 |
| P2 | 微信客服、群发、加好友开发口径 | 已接会话回复、群发计划、标签/频控、暂停恢复、加好友目标/黑名单/每日上限、发送日志。 |
| P3 | 朋友圈运营开发口径 | 已接朋友圈发布、随机浏览点赞评论、定向联系人、逐目标 AI 评论、风控阻断、失败恢复和朋友圈记录。 |
| 跨阶段 | 普通用户本地启动 | `scripts/start-local-integration.sh` 会建立 SkillHub 命令软链，启动 3011 后端和 3010 前端，并等待健康检查。 |
| 跨阶段 | 微信朋友圈坐标配置 | `vendor/skillhub/wechat-moments-marketing/wechat-moments-marketing.sh` 支持环境变量配置点赞/评论坐标。 |

## 最终验收时再做

| 阶段 | 必跑项 | 验收证据 |
| --- | --- | --- |
| P0 | 抖音、微信、发布三类 spike 真机跑通 | 截图/录像、任务 JSON、失败码或成功记录。 |
| P1 | 抖音真实账号闭环 | 导入链接、筛评论、生成文案、评论/私信任务、证据记录。 |
| P1 | 抖音/小红书发布基础版 | 登录态检查、发布结果或失败原因截图。 |
| P2 | 微信真实会话读取和回复 | 会话截图、草稿/发送结果、任务记录。 |
| P2 | 微信群发和加好友小流量 | 每个目标的结果、间隔/上限、失败恢复记录。 |
| P3 | 朋友圈发布、随机互动、定向互动三条链路 | 发布/浏览/点赞/评论截图、逐目标评论、失败恢复和风控阻断截图。 |

## 坐标配置

朋友圈营销脚本默认坐标：

```bash
AI_CONTENT_WECHAT_MOMENTS_LIKE_X=514
AI_CONTENT_WECHAT_MOMENTS_LIKE_Y=214
AI_CONTENT_WECHAT_MOMENTS_COMMENT_X=514
AI_CONTENT_WECHAT_MOMENTS_COMMENT_Y=247
```

真实验收前需要按目标微信窗口重新校准。校准后可以在启动终端或桌面应用环境变量里设置，不需要改代码。

## 不能改口的边界

- 未跑真实账号之前，只能说“开发完成”或“待真实验收”，不能说“生产可交付”。
- 账号风控、验证码、频繁操作提示必须停，不允许静默跳过后继续批量动作。
- 真实发送、点赞、评论、加好友都必须有任务记录和截图/证据入口。
- 页面按钮存在不等于完成，必须能落到 Local Engine / Agent-S / Node Runtime / SkillHub 执行路径。
