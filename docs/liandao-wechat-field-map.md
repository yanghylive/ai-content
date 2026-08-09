# 炼刀微信体系字段映射（3010）

目标：第一阶段不新建 Prisma 业务表，先用 InteractionTask.metadata 承载炼刀计划字段，等稳定后再迁移为专表。

## 统一字段
- `wechat_plan_name`: 计划名
- `wechat_plan_schedule_start_time`: 计划开始时间，对应炼刀 `scheduleStartTime` / `planTime` / `startDate`
- `wechat_plan_daily_limit`: 每日执行上限
- `wechat_plan_associated_wechat_id`: 创建计划时关联的微信号
- `wechat_plan_associated_wechat_name`: 创建计划时关联的微信昵称
- `wechat_plan_generate_on_demand`: 是否按对象即时生成文案

## 联系人
- `wechat_contact_wxid`: 微信 wxid
- `wechat_contact_alias`: 微信号/别名
- `wechat_contact_nickname`: 昵称
- `wechat_contact_remark`: 备注
- `wechat_contact_tags`: 标签数组
- `wechat_contact_synced_at`: 同步时间

## 群发
- `wechat_group_targets`: 群发对象
- `wechat_group_tags`: 标签
- `wechat_group_daily_limit`: 每日上限
- `wechat_group_interval_seconds`: 间隔秒数
- `wechat_group_resend_mode`: `immediate` / `edit-first`

## 加好友
- `wechat_contact_add_targets`: 加好友对象
- `wechat_contact_add_verify_message`: 验证语
- `wechat_contact_add_daily_limit`: 每日上限
- `wechat_contact_add_blacklist`: 黑名单
- `wechat_contact_add_skipped_by_blacklist`: 黑名单跳过数

## 朋友圈发布
- `wechat_moments_content`: 文案
- `wechat_moments_asset_path`: 素材路径
- `wechat_moments_visibility`: 可见范围
- `wechat_moments_daily_published`: 每日发布数
- `wechat_moments_total_tasks`: 总任务数
- `wechat_moments_published_count`: 已发布数

## 朋友圈营销
- `wechat_moments_marketing_mode`: `random` / `targeted`
- `wechat_moments_marketing_contacts`: 定向联系人
- `wechat_moments_marketing_daily_limit`: 每日浏览上限
- `wechat_moments_marketing_random_browse_count`: 随机浏览数
- `wechat_moments_marketing_auto_like`: 是否点赞
- `wechat_moments_marketing_auto_comment`: 是否评论
- `wechat_moments_marketing_comment_mode`: `ai` / `fixed`
- `wechat_moments_marketing_fixed_comment`: 固定评论
- `wechat_moments_marketing_prompt`: AI 评论提示词

## 验收规则
- 前端计划行必须读这些字段并展示。
- 后端执行器必须尊重每日上限、开始时间、黑名单和动作开关。
- 当前微信号与计划关联微信号不一致时必须阻断执行。
