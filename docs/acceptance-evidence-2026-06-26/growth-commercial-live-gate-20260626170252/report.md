# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-06-26T17:02:52.995Z

## Checks

- **PASS** backend-process: Backend listening on 3011, pid=16261.
- **BLOCKER** growth-execution-switch: GROWTH_EXECUTION_ENABLED=missing.
- **BLOCKER** growth-scheduler-daemon: GROWTH_SCHEDULER_DAEMON=missing.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 大壮.
- **BLOCKER** commercial-permission: commercialExecutionAllowed=false, planMode=trial, kaypalPlan=ADVANCED, expired=false.
- **BLOCKER** verified-growth-account: visibleAccounts=0, onlineNormalAccounts=0.
- **PASS** schedule-plan-api: items=0, ready=0, blocked=0, waiting=0.
- **BLOCKER** ready-auto-task: readyCount=0; a commercial live execution test needs at least one ready auto task bound to a verified account.
- **PASS** overview-api: activeConfigCount=0, todayLeadCount=0, contacted=0.
- **BLOCKER** report-diagnosis-honesty: bottlenecks=1; visibleAccounts=0; no-blocker-copy=true.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=2.
- **PASS** database-configs: growth_acquisition_configs rows=2.
- **BLOCKER** database-runs: growth_acquisition_runs rows=0.

## Evidence Files

- `summary.json`
