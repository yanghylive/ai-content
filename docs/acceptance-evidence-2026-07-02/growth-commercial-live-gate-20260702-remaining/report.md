# Growth Commercial Live Gate

Status: **PASS**
Generated: 2026-07-02T23:38:59.607Z
Read-only: **true**

## Read-only Live Gate State

- executionEnabled: `true`
- schedulerDaemonEnabled: `true`
- schedulerDaemonArmed: `true`
- readyCount: `1`
- onlineNormalAccountCount: `2`


## Checks

- **PASS** backend-process: Backend listening on 3011, pid=3422.
- **PASS** local-acceptance-session: Created local read-only gate session for codex_smoke.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as Codex Smoke.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **PASS** growth-execution-switch: executionEnabled=true; runtimeStatus.executionEnabled=true; processEnv=true.
- **PASS** growth-scheduler-daemon-armed: schedulerDaemonEnabled=true; schedulerDaemonArmed=true; envDaemon=true; envRealAllowed=true.
- **PASS** verified-growth-account: visibleAccounts=2, onlineNormalAccountCount=2.
- **PASS** schedule-plan-api: items=1, readyCount=1, blocked=0, waiting=0.
- **PASS** ready-auto-task: readyCount=1; a commercial live execution test needs at least one ready auto task bound to a verified account.
- **PASS** commercial-live-prerequisites-read-only: executionEnabled=true; schedulerDaemonEnabled=true; schedulerDaemonArmed=true; readyCount=1; onlineNormalAccountCount=2.
- **PASS** overview-api: activeConfigCount=1, todayLeadCount=0, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=1; visibleAccounts=2; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=4.
- **PASS** database-configs: growth_acquisition_configs rows=4.
- **PASS** database-runs: growth_acquisition_runs rows=12.

## Evidence Files

- `summary.json`
