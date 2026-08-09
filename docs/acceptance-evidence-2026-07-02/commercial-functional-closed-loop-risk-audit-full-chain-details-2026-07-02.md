# 商用闭环验收：风险审计完整链路详情

时间：2026-07-02

## 目标

将 `/tasks/evidence` 的风险审计详情从“只看平台执行结果”升级为可追溯的完整链路：

1. 人工确认记录
2. 发布 Payload 摘要
3. Preflight 发布前检查
4. 平台执行明细与证据

## 本轮改动

- `backend/src/modules/auto-upload/auto-upload.service.ts`
  - 扩展风险审计 `details` payload，新增 `audit-confirmation`、`publish-payload`、`publish-preflight` 三类详情。
  - 发布审计日志继续保留原 `publish-platform` 详情，兼容旧解析。
  - Preflight 结果、payload 数量、素材/封面/标签数量、确认人、确认动作、确认风险等级、checklist 等被写入同一条审计日志。

- `backend/src/modules/dashboard/dashboard.service.ts`
  - 扩展风险审计详情解析白名单。
  - 增加 checklist、preflight issue、数量字段、布尔字段的安全解析。

- `frontend/src/lib/api/dashboard.ts`
  - 同步前端 API 类型合同。

- `frontend/src/app/(dashboard)/tasks/evidence/page.tsx`
  - 详情弹窗新增“确认记录 / Payload 摘要 / Preflight 检查”。
  - “平台详情”指标和列表行只统计、展示 `publish-platform`，避免完整链路详情污染平台结果数量。

## 自动化验证

- `backend`: `npm test -- auto-upload.service.spec.ts dashboard.service.spec.ts --runInBand`
  - 结果：通过，2 个 suites，27 个 tests。

- `backend`: `npm run build`
  - 结果：通过。

- `frontend`: `npx eslint 'src/app/(dashboard)/tasks/evidence/page.tsx' src/lib/api/dashboard.ts`
  - 结果：通过。

- `frontend`: `npx tsc --noEmit --pretty false`
  - 结果：通过。

- `frontend`: `npm run build`
  - 结果：通过。

## 浏览器验收

本地页面：`http://127.0.0.1:3010/tasks/evidence`

验证方式：

- 向桌面 sqlite 库临时插入一条审计日志：`risk_codex_full_chain_20260702`。
- 详情内容包含四类 details：`audit-confirmation`、`publish-payload`、`publish-preflight`、`publish-platform`。
- 打开证据页并进入该记录详情弹窗。

验收结果：

- 列表出现 `Codex full chain audit` 审计记录。
- 弹窗命中：
  - `确认记录`
  - `Payload 摘要`
  - `Preflight 检查`
  - `平台执行明细`
  - `Codex Tester`
  - `检查通过`
  - `平台发布证据已确认`
- 列表行只展示平台明细，不展示 `Payload 摘要` 或 `确认记录`。
- 浏览器 console error：0。
- 临时审计日志已删除，刷新后页面不再出现 `Codex full chain audit`。

## 结论

风险审计证据中心现在能从用户视角回答四个商用问题：

- 谁确认了这个高风险动作？
- 当时提交了什么发布输入？
- 发布前检查了什么，是否通过？
- 平台最终有没有执行证据，失败时下一步是什么？

这一步补齐了真实发布审计链路的核心可追溯性，为后续把其他高风险动作统一接入同一证据模型打底。
