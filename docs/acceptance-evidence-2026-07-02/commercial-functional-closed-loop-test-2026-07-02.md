# Commercial Functional Closed-Loop Test

- Time: 2026-07-02 09:58 PDT
- Target: http://127.0.0.1:3010
- Scope: task center, CRM/customer follow-up, sales assistant, publishing risk gate, solution run ledger.
- Test data markers:
  - `closed-loop-ui-1783010214800-8a293f`
  - `publish-risk-loop-1783010446810-6e5736`
  - `solution-closed-loop-1783010422111-ffa788`

## Verdict

Partial commercial closed loop.

The strongest closed loop is `CRM customer queue -> join task center -> task center lifecycle -> records/evidence export`. It works end to end without external sends. Publishing risk sessions also correctly stop at human confirmation and export evidence. Solution runs can create a run ledger and dry-run the first task, but the rest of the workflow stays at approval gates.

## Closed-Loop Results

### 1. CRM App Enablement

Status: closed.

- API checked CRM app status.
- API purchased CRM app.
- API installed CRM app.
- Final CRM app state: purchased and installed, commercial entitlement true.

Result: CRM module became available for the active tenant/user.

### 2. CRM Data -> Customer Queue

Status: closed.

Created local CRM records:

- Company: `商用闭环测试公司 closed-loop-ui-1783010214800-8a293f`
- Customer: `闭环测试客户 closed-loop-ui-1783010214800-8a293f`
- Opportunity: `闭环测试机会 closed-loop-ui-1783010214800-8a293f`
- Task: `闭环测试跟进 closed-loop-ui-1783010214800-8a293f`

Verified:

- `/engagement/customers` showed the test customer.
- The page showed `1 个逾期`, `待办任务 1`.
- The `加入任务中心` action was visible.

### 3. Customer Queue -> Task Center

Status: closed.

Action tested in browser:

- Clicked `加入任务中心` on `/engagement/customers`.
- Success toast appeared: `已加入任务中心`.
- `/tasks` displayed `客户跟进：闭环测试客户 closed-loop-ui-1783010214800-8a293f`.

Verified in task center:

- Status: `待继续`
- Confirmation step: `等待人工确认`
- Evidence step: `4 条截图、日志或回读记录`
- Next action: `请到“待我确认”确认后继续执行。`

### 4. Task Records and Evidence

Status: mostly closed.

Verified:

- `/tasks/records` showed the test task, lifecycle, events, confirmation state, and evidence.
- `/tasks/evidence` showed extracted evidence records for the same test task.
- Agent session evidence export API returned:
  - evidenceCount: 4
  - timelineCount: 5
  - content present: true

Gap:

- The `查看记录` button in `/tasks` links to generic `/tasks/records`, not a session-specific detail URL.
- `/tasks/confirmations` shows confirmation cards, but does not show enough session identity in the list to distinguish multiple similar `执行前确认` items.

Commercial impact: evidence exists, but users can still lose context when multiple confirmations are pending.

### 5. Sales Assistant

Status: partially closed.

Verified:

- `GET /crm/closer/advice` generated deterministic, read-only advice with:
  - 3 follow-up recommendations
  - 2 risks
  - 3 talk tracks
  - no external LLM
  - no auto-send
  - no CRM writes
- `/crm/closer` now renders real data without crashing.

Bug found and fixed in this test:

- Before fix, `/crm/closer` crashed with `value?.trim is not a function` when real advice returned structured script objects.
- Fixed page-side rendering so structured scripts and next-step objects become safe text.
- Also added risk title/name fallback to avoid `未命名客户` for structured risk records.

Remaining functional mismatch:

- `/engagement/customers` calls `GET /crm/closer/advice` but expects `{ summary, advice }`.
- Backend `GET /crm/closer/advice` currently returns legacy shape `{ todayFollowUps, risks, talkTracks, dailySummary }`.
- Backend `POST /crm/closer/advice` returns the new shape `{ summary, advice }`.

Commercial impact: customer queue can show CRM tasks and can join task center, but its `建议动作` count stays `0` even when the sales assistant has recommendations.

### 6. Publishing Risk Gate

Status: closed to confirmation gate.

Created safe publishing session:

- Source: `publishing`
- Dry run: true
- Real external publish: not executed
- Status: `waiting_for_confirmation`
- Risk: high
- Confirmation count: 1
- Resume action present: true
- Evidence export:
  - evidenceCount: 4
  - timelineCount: 5

Commercial impact: high-risk publish flow correctly stops at human confirmation with evidence retained.

### 7. Solution Center Run Ledger

Status: half closed.

API tested:

- Created `hot-topic-solution` run plan.
- Created a solution run.
- Run created 6 tasks.
- Dry-ran first task.
- Read run back from run list.

Observed status after dry-run:

- First task: `dry_run_ready`
- Remaining tasks: `approval_required`
- Run status: `dry_run_ready`
- Run appears in `/solutions/runs?packageCode=hot-topic-solution`.

Commercial impact: solution center has a run ledger and task state persistence, but full workflow execution is not yet closed end to end.

## Automated Verification

Backend targeted tests:

- `crm.service.spec.ts`
- `app-market.service.spec.ts`
- `solutions.service.spec.ts`

Result:

- Test suites: 3 passed
- Tests: 39 passed

Frontend checks:

- `npm run lint`: passed.
- Full browser scan:
  - Routes: 128
  - Passed: 128
  - Failed: 0
  - Console errors: 0
  - Console warnings: 0
  - Request failures: 0
  - Report: `docs/acceptance-evidence-2026-07-02/console-quality-browser-scan-2026-07-02T16-58-05-035Z.md`

## Remaining Functional Issues

1. Customer queue advice mismatch.
   - Frontend expects new advice shape from GET.
   - Backend GET returns legacy shape.
   - Recommended fix: either make `readCrmCloserAdvice()` call POST/new endpoint, or normalize GET output into `{ summary, advice }`.

2. Confirmation queue lacks task identity.
   - Multiple pending confirmations appear as repeated `执行前确认`.
   - Recommended fix: include session title, source, target, and updated time in `/tasks/confirmations` cards.

3. Task center detail navigation is generic.
   - `查看记录` lands on `/tasks/records`, not a specific session detail.
   - Recommended fix: support `sessionId` query or a dedicated `/tasks/records/[sessionId]`.

4. Solution center remains half closed.
   - Run ledger and first dry-run are working.
   - Remaining tasks stop at `approval_required`.
   - Recommended fix: add approval flow and business result persistence for the rest of the solution tasks.
