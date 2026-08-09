# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-06-26T19:00:15.881Z

## Checks

- **PASS** backend-process: Backend listening on 3011, pid=87611.
- **BLOCKER** auth-cookie: No auth cookie/session token was provided.
- **BLOCKER** auth-me: Auth failed: HTTP 401.
- **BLOCKER** growth-execution-switch: Runtime status unavailable: HTTP 401; processEnv=false.
- **BLOCKER** growth-scheduler-daemon-armed: Runtime status unavailable: HTTP 401; envDaemon=false; envRealAllowed=false.
- **BLOCKER** verified-growth-account: Account health API failed: HTTP 401.
- **BLOCKER** schedule-plan-api: Schedule plan failed: HTTP 401.
- **BLOCKER** ready-auto-task: Schedule plan unavailable.
- **BLOCKER** overview-api: Overview failed: HTTP 401.
- **BLOCKER** report-diagnosis-honesty: Reports failed: HTTP 401.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=4.
- **PASS** database-configs: growth_acquisition_configs rows=4.
- **PASS** database-runs: growth_acquisition_runs rows=7.

## Evidence Files

- `summary.json`
