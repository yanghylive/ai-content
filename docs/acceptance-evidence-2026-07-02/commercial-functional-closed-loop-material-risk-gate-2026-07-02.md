# 商用闭环测试：素材删除风险网关

时间：2026-07-02 10:51 PDT

## 本轮目标

按“功能是否商用闭环”继续测试，不做前端命名审查。本轮聚焦素材库删除动作，因为它会影响选题、文章、发布证据和后续内容资产追溯。

## 发现的问题

素材页已经有风险确认弹窗，但后端 `DELETE /materials/:id` 和 `POST /materials/batch-delete` 原来仍可不带确认直接删除。也就是说 UI 看起来有确认，API 层仍可绕过，不符合商用级“高影响动作必须后端兜底”的要求。

## 已修复

- 单条素材删除必须携带后端风险确认：`material-delete`，中风险。
- 批量素材删除必须携带后端风险确认：`material-batch-delete`，高风险。
- 确认动作和风险等级不匹配时会被后端阻断。
- 删除成功后响应返回 `riskAudit`。
- 删除成功后写入 `system_logs`，包含素材 ID、删除范围和 `riskAudit.id`，方便后续追溯。
- 前端素材页确认弹窗会把确认对象提交到后端：单条为中风险，批量为高风险。

## 验证结果

- `npm test -- materials.service.spec.ts --runInBand`：7/7 passed。
- `npm run build`（backend）：passed。
- `npm run lint`（frontend）：passed。
- `npm run build`（frontend）：passed，134 个静态页面生成成功。
- API 单条删除闭环：未带确认返回 400，记录仍存在；带确认返回 200，`riskAudit.status=allowed`，记录删除成功。
- API 批量删除闭环：未带确认返回 400，两条记录仍存在；带确认返回 201，`deleted=2`、`requested=2`、`riskAudit.status=allowed`。
- UI 删除闭环：在 `/materials` 创建一次性测试素材，点击删除后弹出中风险确认；确认后 toast 显示“删除成功 / 已删除 1 条素材”，列表回到 2 条，数据库确认测试素材已删除。
- 浏览器 `/materials` 验证：页面进入素材库主体，无登录页误跳转，console error 为 0。
- 审计日志验证：删除成功后 `system_logs` 出现 `素材删除已确认... audit=risk_...`，level 为 `warning`。

## 剩余建议

当前素材删除已经形成“前端确认 → 后端风控 → 执行 → 响应审计 → 系统日志”的闭环。下一步可以把 `riskAudit` 和系统日志接入任务中心/审计页的统一 Evidence 视图，让用户不需要去系统日志里查。
