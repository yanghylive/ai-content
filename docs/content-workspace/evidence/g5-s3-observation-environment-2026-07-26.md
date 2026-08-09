# G5 S3 观察环境准备 - 2026-07-26

- 时间：2026-07-26 22:12 America/Los_Angeles
- active work：`CW-G5-S3-ROLLOUT-OBSERVATION`
- requirement：`UX-15`，仍为 `in_progress`
- 结论：观察环境已准备，但 48 小时真实观察尚未开始，不能计入验收窗口。

## 保持不变的默认实例

- 3010 继续使用默认关闭配置：

```text
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=false
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=0
```

- 3010 页面和 3011 后端均保持在线；未修改 S1 结果入口、编辑器、队列、上下文、旧路由或后端发布边界。

## 隔离观察实例

- 3012 使用前端临时工作副本启动，配置为：

```text
NEXT_PUBLIC_API_BASE=http://127.0.0.1:3011/api
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=true
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=10
```

- 观察账号使用独立的 QA 用户和沙箱租户，不复用当前用户的登录态或业务数据；账号为 operator/trial，未配置商用执行权限。
- 通过独立 curl cookie 文件验证：登录、`/api/auth/me`、`/api/auth/tenants` 均成功；未创建草稿、素材、发布任务或内容事件。
- 页面连通性验证通过：`/login`、`/content/workspace`、`/content/face-swap` 均返回 200；3011 `/health` 返回 200。

## 观察窗口边界

本次观察已进入真实窗口。当前 in-app browser 仍是共享用户会话，不能作为隔离 QA 浏览器；此前对它的预检不计入 `intent_form_viewed`、`draft_created` 等真实用户事件。

## 观察开始

- 2026-07-26 23:39:45 PDT，本地数据库写入了最新 `user_sessions` 记录，同时对应 `users.last_login_at` 更新到同一时间。
- 这说明 3012 的 Kaypal 授权确认已经落到本地会话，不再只是页面停留或预检。
- 从这条本地会话开始计算 48 小时观察窗口；UX-15 仍保持 `in_progress`，直到窗口结束、报表和截图齐全前不得激活 S4 Astryx 内容工作区迁移。

## 清理责任

观察结束或中止时，删除本次 QA 用户及其所属沙箱租户（级联删除成员和测试会话），停止 `ai-content-observation-3012` screen，并保留本文件、S3 Runbook 和回滚证据。不得清理 3010/3011 的默认实例或原有用户。

## 当前验证

截至 2026-07-27 06:22 UTC，以下守卫和契约检查已通过：

- `npm run astryx:doctor`
- `npm run astryx:migration:guard`
- `npm run navigation:zero-loss`
- `npm run navigation:zero-loss:test`
- `npm run content-workspace:guard`
- `npm run content-workspace:guard:test`

这些结果只说明 Astryx 依赖、导航零损失和内容工作区边界仍然稳定，不代表 48 小时真实观察已经开始，也不改变 `UX-15` 的 `in_progress` 状态。
