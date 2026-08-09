# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-06-26T17:37:17.297Z

## Checks

- **PASS** backend-process: Backend listening on 3011, pid=1198.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 大壮.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **PASS** growth-execution-switch: runtimeStatus.executionEnabled=true; processEnv=true.
- **PASS** growth-scheduler-daemon: runtimeStatus.schedulerDaemonEnabled=true; processEnv=true.
- **BLOCKER** verified-growth-account: visibleAccounts=0, onlineNormalAccounts=0.
- **PASS** schedule-plan-api: items=1, ready=0, blocked=1, waiting=0.
- **BLOCKER** ready-auto-task: readyCount=0; a commercial live execution test needs at least one ready auto task bound to a verified account.
- **PASS** overview-api: activeConfigCount=1, todayLeadCount=0, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=2; visibleAccounts=0; no-blocker-copy=false.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=3.
- **PASS** database-configs: growth_acquisition_configs rows=3.
- **PASS** database-runs: growth_acquisition_runs rows=1.

## Evidence Files

- `summary.json`
