# Commercial Functional Closed-Loop Fixes

- Time: 2026-07-02 10:25 PDT
- Target: http://127.0.0.1:3010
- Scope: customer advice queue, task confirmation identity, session-specific records, solution preview run closure.

## Fixed Items

### 1. Customer Queue Advice Mismatch

Status: fixed.

- `readCrmCloserAdvice()` now uses the normalized read-only advice endpoint shape returned by `POST /crm/closer/advice`.
- `/engagement/customers` now displays CRM closer recommendations instead of showing `建议动作 0` while advice exists.

Verified in browser:

- `/engagement/customers` showed the test customer.
- The first recommendation, suggested script, and `建议动作 3` rendered.
- No page error boundary appeared.

### 2. Confirmation Queue Task Identity

Status: fixed.

- `/tasks/confirmations` now shows task/session title, source, status time, confirmation item, next action, resume action, record link, and source link.
- Task center's confirmation preview also shows the session title instead of only repeated `执行前确认`.

Verified in browser:

- `/tasks/confirmations` showed `客户跟进：闭环测试客户 ...` and `发布风险闭环 ...`.
- Cards showed `确认项：执行前确认`, source labels, and `查看记录`.

### 3. Session-Specific Task Records

Status: fixed.

- Task center `查看记录` links now include `sessionId`.
- `/tasks/records?sessionId=...` fetches the targeted session when needed, sorts it to the top, and marks it as `当前打开的任务记录`.

Verified in browser:

- `/tasks` generated links such as `/tasks/records?sessionId=le_mr3rqizy_98dbnd`.
- Opening that URL showed `当前打开的任务记录` and the matching customer follow-up session at the top.

### 4. Solution Preview Run Closure

Status: fixed for preview/dry-run closure.

- Added backend endpoint: `POST /solutions/runs/:runId/tasks/:taskId/manual-approve`.
- Manual solution checkpoints now persist `manual_checkpoint_approval` results and update task status to `succeeded`.
- `/solutions` now provides:
  - per-step `确认检查点`;
  - run-level `完成预览闭环`;
  - sequential safe closure that dry-runs runnable RedFox tasks and approves manual checkpoints without triggering real external execution.

Verified in browser and database:

- Run `cmr3qdaul3nca8oz3px1mrznv` moved to:
  - status: `dry_run_ready`
  - progress: `100`
  - RedFox task: `dry_run_ready`
  - manual tasks: 5 x `succeeded`
  - manual approval results: 5

## Verification

Automated checks:

- Backend: `npm test -- crm.service.spec.ts app-market.service.spec.ts solutions.service.spec.ts --runInBand`
  - Test suites: 3 passed
  - Tests: 52 passed
- Backend: `npm run build`
  - Passed
- Frontend: `npm run lint`
  - Passed
- Frontend: `npm run build`
  - Passed, 134 static pages generated

Browser checks:

- `/engagement/customers`
- `/tasks`
- `/tasks/confirmations`
- `/tasks/records?sessionId=le_mr3rqizy_98dbnd`
- `/solutions`

Result:

- Key routes loaded without error boundary.
- Key route console error count from local app logs: 0.
- Full `console-quality:browser` was started but interrupted after it exceeded normal runtime while the backend was being restarted; targeted route verification was completed after the restart.

## Remaining Risk

- Real external RedFox execution is still intentionally gated by the existing `确认启用` safety flow and was not executed.
- Solution preview closure now persists manual checkpoint approval, but business-object acceptance checks still remain separate from manual checkpoint status.
