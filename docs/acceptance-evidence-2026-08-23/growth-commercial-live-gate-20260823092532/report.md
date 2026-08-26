# Growth Commercial Live Gate

Status: **PASS**
Generated: 2026-08-23T09:25:33.005Z
Read-only: **true**

## Read-only Live Gate State

- executionEnabled: `true`
- schedulerDaemonEnabled: `true`
- schedulerDaemonArmed: `true`
- readyCount: `1`
- onlineNormalAccountCount: `11`


## Checks

- **PASS** backend-process: Backend listening on 3011, pid=27218.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 验收用户.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **PASS** growth-execution-switch: executionEnabled=true; runtimeStatus.executionEnabled=true; processEnv=missing.
- **PASS** growth-scheduler-daemon-armed: schedulerDaemonEnabled=true; schedulerDaemonArmed=true; envDaemon=missing; envRealAllowed=missing.
- **PASS** verified-growth-account: visibleAccounts=14, onlineNormalAccountCount=11.
- **PASS** schedule-plan-api: items=9, readyCount=1, blocked=0, waiting=0.
- **PASS** ready-auto-task: readyCount=1; a commercial live execution test needs at least one ready auto task bound to a verified account.
- **PASS** commercial-live-prerequisites-read-only: executionEnabled=true; schedulerDaemonEnabled=true; schedulerDaemonArmed=true; readyCount=1; onlineNormalAccountCount=11.
- **PASS** overview-api: activeConfigCount=8, todayLeadCount=0, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=4; visibleAccounts=14; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=14.
- **PASS** database-configs: growth_acquisition_configs rows=11.
- **PASS** database-runs: growth_acquisition_runs rows=44.

## Evidence Files

- `summary.json`
