# Growth Commercial Live Gate

Status: **PASS**
Generated: 2026-06-26T18:08:33.032Z

## Checks

- **PASS** backend-process: Backend listening on 3011, pid=28877.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 大壮.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **PASS** growth-execution-switch: runtimeStatus.executionEnabled=true; processEnv=true.
- **PASS** growth-scheduler-daemon: runtimeStatus.schedulerDaemonEnabled=true; processEnv=true.
- **PASS** verified-growth-account: visibleAccounts=1, onlineNormalAccounts=1.
- **PASS** schedule-plan-api: items=2, ready=1, blocked=1, waiting=0.
- **PASS** ready-auto-task: readyCount=1; a commercial live execution test needs at least one ready auto task bound to a verified account.
- **PASS** overview-api: activeConfigCount=2, todayLeadCount=0, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=1; visibleAccounts=1; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=4.
- **PASS** database-configs: growth_acquisition_configs rows=4.
- **PASS** database-runs: growth_acquisition_runs rows=6.

## Evidence Files

- `summary.json`
