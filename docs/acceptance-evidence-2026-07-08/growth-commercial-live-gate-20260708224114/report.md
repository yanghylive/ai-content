# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-07-08T22:41:16.901Z
Read-only: **true**

## Read-only Live Gate State

- executionEnabled: `true`
- schedulerDaemonEnabled: `true`
- schedulerDaemonArmed: `true`
- readyCount: `0`
- onlineNormalAccountCount: `1`
- nextStep: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.


## Checks

- **PASS** backend-process: Backend listening on 3011, pid=68656.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 大壮.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **PASS** growth-execution-switch: executionEnabled=true; runtimeStatus.executionEnabled=true; processEnv=missing.
- **PASS** growth-scheduler-daemon-armed: schedulerDaemonEnabled=true; schedulerDaemonArmed=true; envDaemon=missing; envRealAllowed=missing.
- **PASS** verified-growth-account: visibleAccounts=3, onlineNormalAccountCount=1.
- **PASS** schedule-plan-api: items=1, readyCount=0, blocked=0, waiting=0.
- **BLOCKER** ready-auto-task: readyCount=0; a commercial live execution test needs at least one ready auto task bound to a verified account. Next step: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.
- **BLOCKER** commercial-live-prerequisites-read-only: executionEnabled=true; schedulerDaemonEnabled=true; schedulerDaemonArmed=true; readyCount=0; onlineNormalAccountCount=1. Next step: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.
- **PASS** overview-api: activeConfigCount=1, todayLeadCount=0, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=2; visibleAccounts=3; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=4.
- **PASS** database-configs: growth_acquisition_configs rows=4.
- **PASS** database-runs: growth_acquisition_runs rows=12.

## Evidence Files

- `summary.json`
