# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-06-26T17:27:29.696Z

## Checks

- **BLOCKER** backend-process: No backend process is listening on 3011.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **BLOCKER** auth-me: Auth failed: HTTP 0.
- **BLOCKER** growth-execution-switch: Runtime status unavailable: HTTP 0; processEnv=missing.
- **BLOCKER** growth-scheduler-daemon: Runtime status unavailable: HTTP 0; processEnv=missing.
- **BLOCKER** verified-growth-account: Account health API failed: HTTP 0.
- **BLOCKER** schedule-plan-api: Schedule plan failed: HTTP 0.
- **BLOCKER** ready-auto-task: Schedule plan unavailable.
- **BLOCKER** overview-api: Overview failed: HTTP 0.
- **PASS** report-diagnosis-honesty: Reports failed: HTTP 0.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=2.
- **PASS** database-configs: growth_acquisition_configs rows=3.
- **PASS** database-runs: growth_acquisition_runs rows=1.

## Evidence Files

- `summary.json`
