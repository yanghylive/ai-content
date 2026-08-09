# Growth Commercial Live Gate

Status: **PASS**
Generated: 2026-06-26T17:47:43.152Z

## Checks

- **PASS** backend-process: Backend listening on 3011, pid=12600.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as Codex Smoke.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=FREE, expired=false.
- **PASS** growth-execution-switch: runtimeStatus.executionEnabled=true; processEnv=true.
- **PASS** growth-scheduler-daemon: runtimeStatus.schedulerDaemonEnabled=true; processEnv=true.
- **PASS** verified-growth-account: visibleAccounts=1, onlineNormalAccounts=1.
- **PASS** schedule-plan-api: items=1, ready=1, blocked=0, waiting=0.
- **PASS** ready-auto-task: readyCount=1; a commercial live execution test needs at least one ready auto task bound to a verified account.
- **PASS** overview-api: activeConfigCount=1, todayLeadCount=0, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=1; visibleAccounts=1; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=3.
- **PASS** database-configs: growth_acquisition_configs rows=3.
- **PASS** database-runs: growth_acquisition_runs rows=4.

## Evidence Files

- `summary.json`
