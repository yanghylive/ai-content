# Growth Commercial Live Gate

Status: **PASS**
Generated: 2026-07-03T16:40:23.307Z
Read-only: **true**

## Read-only Live Gate State

- executionEnabled: `true`
- schedulerDaemonEnabled: `true`
- schedulerDaemonArmed: `true`
- readyCount: `1`
- onlineNormalAccountCount: `2`


## Checks

- **PASS** backend-process: Backend listening on 3011, pid=61045.
- **PASS** local-acceptance-session: Created local read-only gate session for admin.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 管理员.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **PASS** growth-execution-switch: executionEnabled=true; runtimeStatus.executionEnabled=true; processEnv=true.
- **PASS** growth-scheduler-daemon-armed: schedulerDaemonEnabled=true; schedulerDaemonArmed=true; envDaemon=true; envRealAllowed=true.
- **PASS** verified-growth-account: visibleAccounts=2, onlineNormalAccountCount=2.
- **PASS** schedule-plan-api: items=3, readyCount=1, blocked=0, waiting=0.
- **PASS** ready-auto-task: readyCount=1; a commercial live execution test needs at least one ready auto task bound to a verified account.
- **PASS** commercial-live-prerequisites-read-only: executionEnabled=true; schedulerDaemonEnabled=true; schedulerDaemonArmed=true; readyCount=1; onlineNormalAccountCount=2.
- **PASS** overview-api: activeConfigCount=3, todayLeadCount=2, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=2; visibleAccounts=2; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Documents/New project/ai-content/backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=4.
- **PASS** database-configs: growth_acquisition_configs rows=3.
- **PASS** database-runs: growth_acquisition_runs rows=2.

## Evidence Files

- `summary.json`
