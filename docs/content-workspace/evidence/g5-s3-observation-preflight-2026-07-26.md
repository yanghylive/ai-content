# G5 S3 真实观察启动预检 - 2026-07-26

- 时间：2026-07-26 20:23:38 America/Los_Angeles
- active work：`CW-G5-S3-ROLLOUT-OBSERVATION`
- requirement：`UX-15`，仍为 `in_progress`
- 结论：本次不计入 48 小时观察窗口

## 已检查

- 3010 和 3011 均在线。
- 当前数据库原有用户保留，未使用其业务数据作为灰度样本。
- 创建了一个隔离 QA 账号和默认租户，仅用于登录隔离性预检。
- 3010 曾短暂使用：

```text
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=true
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=10
```

- 未创建草稿，未导出浏览器事件，未生成正式指标报告。
- 临时 QA 用户、租户和会话已清理；数据库恢复为原有 1 个用户。
- 3010 已恢复默认关闭启动脚本：

```text
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=false
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=0
```

## 未计入观察的原因

当前可用的 in-app browser 只有一个共享登录上下文；新标签会复用用户现有登录态，无法在不影响用户页面的情况下登录隔离 QA 账号。根据 S3 Runbook，缺少隔离会话和可读取的事件缓冲时，不得把这次启动当作真实灰度或 48 小时观察。

## 下一步条件

需要提供独立浏览器上下文、独立部署实例或可读取的非生产观察环境。满足后，重新记录正式构建版本和开始时间，再开启 10% 观察。此前不得修改 UX-15 状态，不得激活 S4 Astryx 内容工作区迁移。

