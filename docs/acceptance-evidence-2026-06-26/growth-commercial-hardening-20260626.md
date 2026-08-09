# Growth Commercial Hardening - 2026-06-26

## Scope

- Tighten the commercial growth scheduler boundary so local/desktop startup cannot accidentally arm unattended real execution.
- Make the UI and live gate report `schedulerDaemonArmed`, not just `schedulerDaemonEnabled`.
- Re-run a no-send commercial gate with the real recovered desktop login session.

## Changes

- `GET /api/growth/commercial-readiness`
  - Added a dedicated commercial readiness endpoint that aggregates runtime switches, scheduler arm status, account health, and schedule readiness.
  - The endpoint returns explicit blockers instead of relying on logs or page interpretation.
- `POST /api/growth/commercial-readiness/remediate`
  - Added a risk-gated commercial remediation endpoint.
  - It refreshes account health, then only enables background scheduling for real-account, online-normal, auto-risk, non-disabled tasks with remaining quota.
  - It does not mark expired or missing accounts as ready and does not call external send/execution APIs.
- `frontend/src/components/growth/growth-console.tsx`
  - Added a `商用闭环状态` card to the auto-acquisition page.
  - The card shows real execution, scheduler armed status, online accounts, ready tasks, and the exact blockers.
  - Added `修复可自动处理项`, wired to the backend remediation endpoint.
- `backend/.env.example`
  - Defaulted `GROWTH_EXECUTION_ENABLED=false`.
  - Defaulted `GROWTH_SCHEDULER_DAEMON=false`.
  - Added `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=false`.
- `desktop/backend.env`
  - Kept explicit execution available for user-triggered desktop actions.
  - Set unattended scheduler defaults to `GROWTH_SCHEDULER_DAEMON=false` and `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=false`.
- `scripts/growth-commercial-live-gate.mjs`
  - Replaced the old scheduler pass condition with `growth-scheduler-daemon-armed`.
  - The gate now blocks unless real execution, daemon config, and real-daemon permission are all true.
- `frontend/src/components/growth/growth-console.tsx`
  - Scheduler chip now distinguishes `后台定时已武装`, `后台定时未武装`, and `后台定时未开启`.
- `backend/src/modules/growth/growth.controller.commercial.spec.ts`
  - Added coverage showing configured daemon is not armed until `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true`.

## Verification

- `bash -n scripts/start-local-integration.sh` passed.
- `node --check scripts/growth-commercial-live-gate.mjs` passed.
- `npm test -- --runInBand src/modules/growth/growth.controller.commercial.spec.ts src/modules/growth/growth.service.spec.ts` passed: 2 suites, 20 tests.
- `npm run build` in `frontend` passed.
- `npm run build` in `backend` passed.
- `npm run build:bundle:sqlite` in `backend` passed.
- `scripts/start-local-integration.sh` restarted local 3010/3011 with the new SQLite bundle.
- `git diff --check` on touched files passed.
- `GET /api/growth/commercial-readiness` with recovered desktop session passed and returned:
  - `status=blocked`
  - `summary=商用闭环未就绪：4 个阻断项需要处理。`
  - blockers: `growth-execution-disabled`, `scheduler-daemon-not-armed`, `no-online-normal-account`, `no-ready-auto-task`
- `POST /api/growth/commercial-readiness/remediate` with recovered desktop session and backend risk confirmation passed:
  - `status=blocked`
  - `changedCount=0`
  - `requiresHumanLogin=true`
  - message: `没有可自动修复的任务：需要先完成人工登录或账号风险处理。`
  - skipped real config: `大壮抖音获客账号: login=expired, risk=needs-human`
  - skipped placeholder config: `未找到可验证的真实账号。`
- Live gate with recovered desktop session generated:
  - `docs/acceptance-evidence-2026-06-26/growth-commercial-live-gate-20260626190312/report.md`
  - Result: `PASS=11`, `BLOCKER=4`.
- Read-only runtime status with recovered desktop session:
  - `executionEnabled=false`
  - `schedulerDaemonEnabled=false`
  - `schedulerDaemonArmed=false`
  - `mode=safety-review`
- Read-only account health refresh:
  - `POST /api/growth/account-health/douyin/1/check`
  - Result: `loginStatus=expired`, `riskStatus=needs-human`
  - Recommendation: re-login Douyin in the local browser, then re-check account health before resuming blocked tasks.

## 2026-06-27 Scheduler Daemon Gate Follow-up

- `scripts/start-local-integration.sh`
  - Added a read-only startup gate that prints `executionEnabled`, `schedulerDaemonEnabled`, `schedulerDaemonArmed`, and `schedulerRealDaemonAllowed` before launching services.
  - `schedulerDaemonArmed=true` now means all three commercial live switches are true: `GROWTH_EXECUTION_ENABLED`, `GROWTH_SCHEDULER_DAEMON`, and `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED`.
  - Default local startup remains blocked for unattended real execution unless those switches are explicitly set.
- `scripts/growth-commercial-live-gate.mjs`
  - Added a read-only aggregate check named `commercial-live-prerequisites-read-only`.
  - The report now explicitly outputs `executionEnabled`, `schedulerDaemonEnabled`, `schedulerDaemonArmed`, `readyCount`, and `onlineNormalAccountCount`.
  - Blocked checks now include next-step remediation text, including commercial session/cookie recovery, scheduler arm switches, account login, and ready-task prerequisites.
  - Backend process command evidence now redacts token/key/secret/password-like env values before writing `summary.json`.
- `desktop/backend.env`
  - Clarified that desktop user-triggered execution can be enabled while unattended scheduling remains blocked until all three growth switches are true.
- `backend/.env.example`
  - Clarified the three-switch arm contract and kept all default growth live switches false.

### 2026-06-27 Verification

- `bash -n scripts/start-local-integration.sh` passed.
- `node --check scripts/growth-commercial-live-gate.mjs` passed.
- Read-only live gate generated:
  - `docs/acceptance-evidence-2026-06-26/growth-commercial-live-gate-readonly-20260627-codex/report.md`
  - `docs/acceptance-evidence-2026-06-26/growth-commercial-live-gate-readonly-20260627-codex/summary.json`
  - Result: `PASS=5`, `BLOCKER=10`.
- Current read-only gate state:
  - `executionEnabled=false`
  - `schedulerDaemonEnabled=false`
  - `schedulerDaemonArmed=false`
  - `readyCount=0`
  - `onlineNormalAccountCount=0`
- Current blockers are expected for this no-cookie local verification run:
  - No `GROWTH_ACCEPTANCE_COOKIE_HEADER`, `GROWTH_ACCEPTANCE_COOKIE_FILE`, or `GROWTH_ACCEPTANCE_SESSION_TOKEN` was provided.
  - The running backend process has growth live execution and scheduler daemon switches false.
  - Authenticated account and schedule readiness could not be verified without a commercial session.

## Current Blockers

- `growth-execution-switch`: current 3011 process has `GROWTH_EXECUTION_ENABLED=false`.
- `growth-scheduler-daemon-armed`: current 3011 process has `GROWTH_SCHEDULER_DAEMON=false` and `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=false`.
- `verified-growth-account`: visible account count is 1, but online-normal account count is 0.
- `ready-auto-task`: schedule plan is readable, but ready count is 0.

## Blocker Detail

- The real account config `商用验收-真实账号自动获客-1782497199108` is currently `scheduleEnabled=false`, `status=disabled`, and already used its daily limit for `2026-06-26`.
- The enabled scheduled config `商用验收-无账号阻断-1782494835831` is intentionally bound to placeholder account `acceptance-no-real-account`, so it must not be counted as a commercial ready task.
- Account `大壮抖音获客账号` remained `expired / needs-human` after an explicit health refresh, so the correct next step is account re-login/re-authorization, not force-marking the database as online.

## Commercial Statement

This pass does not prove full commercial SaaS live operation. It proves the system no longer reports the growth scheduler as commercially ready unless the real daemon is explicitly armed and account/task prerequisites are present.

The remediation pass proves the system can now advance safe scheduler prerequisites automatically, but it correctly refused to advance the current local data because the Douyin account is expired and requires human login.

## Six-Agent Commercial Closeout Pass - 2026-06-26 23:24 PDT

Additional hardening completed in parallel:

- Growth backend audit trail:
  - Added `GET /api/growth/commercial-readiness/audits`.
  - `commercial-readiness/remediate` and `acquisition/schedule/run` now persist readiness snapshots with runtime/account/plan/blocker/result fields.
- Growth frontend control console:
  - Added `商用闭环下一步` evidence area.
  - Shows blockers, warnings, latest remediation result, and recent audit records when the backend endpoint is present.
- Scheduler/live gate:
  - Added read-only aggregate prerequisite output for execution switch, scheduler daemon, scheduler armed state, ready task count, and online-normal account count.
  - Startup now prints the same scheduler arm state before services launch.
- CRM app-market gate:
  - CRM access now rejects unauthenticated requests instead of falling back to `local-user`.
  - The purchase/install gate remains the path for authenticated users.
- Commercial entitlement gate:
  - Backup export is now protected by a plan/entitlement gate.
  - `PlanGuard` now requires a valid commercial entitlement before comparing plan rank.
- Windows release gate:
  - Added `desktop/scripts/windows-commercial-release-gate.js`.
  - Added `npm run check:win-commercial-release` and `npm run check:win-commercial-release:strict`.

Combined verification:

- Backend targeted tests passed:
  - `9` suites
  - `48` tests
- Backend build passed:
  - `npm run build`
- Frontend build passed:
  - `npm run build`
- Script/static checks passed:
  - `bash -n scripts/start-local-integration.sh`
  - `node --check scripts/growth-commercial-live-gate.mjs`
  - `node --check desktop/scripts/windows-commercial-release-gate.js`
  - `git diff --check` on touched commercial files
- Windows default commercial gate passed with caveats:
  - `PASS=20`
  - `WARN=1`
  - `UNVERIFIED=3`
  - `BLOCKER=0`
- Live local API with recovered desktop session:
  - readiness: `blocked`
  - blockers: `growth-execution-disabled`, `scheduler-daemon-not-armed`, `no-online-normal-account`, `no-ready-auto-task`
  - remediation: `changedCount=0`, `requiresHumanLogin=true`
  - audits: latest `commercial-readiness-remediate` record persisted with the same blockers.

Remaining commercial blockers:

- Douyin account is still expired / needs human login.
- Current local services are intentionally running with:
  - `GROWTH_EXECUTION_ENABLED=false`
  - `GROWTH_SCHEDULER_DAEMON=false`
  - `GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=false`
- Windows strict release gate still requires real-machine evidence for:
  - WeChat contact sync.
  - QR/platform account binding.
  - Growth auto-acquisition send/readback on Windows.
- Payment remains foundation-level; true Stripe/payment webhook go-live is not implemented in this pass.
