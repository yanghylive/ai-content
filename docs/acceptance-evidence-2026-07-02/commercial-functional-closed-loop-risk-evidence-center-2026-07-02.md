# 商用闭环测试：风险审计进入证据中心

时间：2026-07-02 11:10 PDT

## 本轮目标

继续测试“功能是否商用闭环”，不做前端命名审查。本轮承接素材删除风险网关：上一轮已经能产出 `riskAudit` 并写入系统日志，这轮要让用户在任务证据入口可追溯。

## 发现的问题

`/tasks/evidence` 原来只复用 Agent Workbench 的 artifacts 模式，主要展示 Agent 会话事件证据。素材删除这类系统级风险审计虽然已写入 `system_logs`，但用户需要去系统日志里找，不能在任务中心证据入口直接看到“谁确认、做了什么、审计编号是什么”。

## 已修复

- 新增后端接口：`GET /api/dashboard/risk-audit-evidence`。
- 从系统日志中解析 `audit=risk_...` 的风险审计记录，并结构化输出：
  - `auditId`
  - `action`
  - `actionLabel`
  - `riskLevel`
  - `targetLabel`
  - `targetId`
  - `summary`
  - `sourceLogId`
- 当前已支持素材单条删除与批量删除日志格式；未知风险审计日志会以通用审计记录兜底展示。
- `/tasks/evidence` 改为证据总览页：
  - 上方展示风险审计证据。
  - 下方保留 Agent 过程证据索引。
  - 指标卡显示风险审计、高风险、素材审计、Agent 证据数量。
- 审计接口保持鉴权保护，未登录访问返回 401。

## 验证结果

- `npm test -- dashboard.service.spec.ts materials.service.spec.ts --runInBand`：10/10 passed。
- `npm run lint`（frontend）：passed。
- `npm run build`（backend）：passed。
- `npm run build`（frontend）：passed，134 个静态页面生成成功。
- Authenticated API：`/api/dashboard/risk-audit-evidence?limit=20` 返回 200，能查到 `material-delete`、`risk_mr3t5188_sbk7qs`、`source=system-log`。
- Unauthenticated API：同接口无 cookie 返回 401。
- Browser `/tasks/evidence`：页面展示“风险审计证据”“Agent 过程证据”、素材删除审计编号 `risk_mr3t5188_sbk7qs`，console error 为 0。

## 剩余建议

当前已经形成“执行动作 → 后端风险审计 → 系统日志 → 证据中心展示”的闭环。下一步可以把更多高风险动作统一写入同样格式，例如平台账号删除、真实发布、证据清理、远程接管，这样 `/tasks/evidence` 会成为全站统一审计入口。
