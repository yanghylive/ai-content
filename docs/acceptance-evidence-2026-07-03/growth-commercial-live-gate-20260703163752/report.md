# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-07-03T16:37:55.546Z
Read-only: **true**

## Read-only Live Gate State

- executionEnabled: `false`
- schedulerDaemonEnabled: `false`
- schedulerDaemonArmed: `false`
- readyCount: `0`
- onlineNormalAccountCount: `2`
- nextStep: For commercial live execution, explicitly set GROWTH_EXECUTION_ENABLED=true and restart the backend.
- nextStep: For unattended commercial scheduling, explicitly set GROWTH_SCHEDULER_DAEMON=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true.
- nextStep: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.


## Checks

- **PASS** backend-process: Backend listening on 3011, pid=55874.
- **PASS** local-acceptance-session: Created local read-only gate session for admin.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 管理员.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **BLOCKER** growth-execution-switch: executionEnabled=false; runtimeStatus.executionEnabled=false; processEnv=missing. Next step: For commercial live execution, explicitly set GROWTH_EXECUTION_ENABLED=true and restart the backend.
- **BLOCKER** growth-scheduler-daemon-armed: schedulerDaemonEnabled=false; schedulerDaemonArmed=false; envDaemon=missing; envRealAllowed=missing. Next step: For unattended commercial scheduling, explicitly set GROWTH_SCHEDULER_DAEMON=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true.
- **PASS** verified-growth-account: visibleAccounts=2, onlineNormalAccountCount=2.
- **PASS** schedule-plan-api: items=3, readyCount=0, blocked=0, waiting=0.
- **BLOCKER** ready-auto-task: readyCount=0; a commercial live execution test needs at least one ready auto task bound to a verified account. Next step: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.
- **BLOCKER** commercial-live-prerequisites-read-only: executionEnabled=false; schedulerDaemonEnabled=false; schedulerDaemonArmed=false; readyCount=0; onlineNormalAccountCount=2. Next step: For commercial live execution, explicitly set GROWTH_EXECUTION_ENABLED=true and restart the backend. | For unattended commercial scheduling, explicitly set GROWTH_SCHEDULER_DAEMON=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true. | Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.
- **PASS** overview-api: activeConfigCount=3, todayLeadCount=2, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=2; visibleAccounts=2; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Documents/New project/ai-content/backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=4.
- **PASS** database-configs: growth_acquisition_configs rows=3.
- **PASS** database-runs: growth_acquisition_runs rows=2.

## Evidence Files

- `summary.json`
