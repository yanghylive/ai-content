# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-07-07T16:25:28.134Z
Read-only: **true**

## Read-only Live Gate State

- executionEnabled: `false`
- schedulerDaemonEnabled: `false`
- schedulerDaemonArmed: `false`
- readyCount: `0`
- onlineNormalAccountCount: `0`
- nextStep: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN.
- nextStep: For commercial live execution, explicitly set GROWTH_EXECUTION_ENABLED=true and restart the backend.
- nextStep: For unattended commercial scheduling, explicitly set GROWTH_SCHEDULER_DAEMON=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true.


## Checks

- **PASS** backend-process: Backend listening on 3011, pid=67356.
- **PASS** local-acceptance-session: Created local read-only gate session for codex_smoke.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **BLOCKER** auth-me: Auth failed: HTTP 401. Next step: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN.
- **BLOCKER** growth-execution-switch: executionEnabled=false; runtime status unavailable: HTTP 401; processEnv=missing. Next step: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN. | For commercial live execution, explicitly set GROWTH_EXECUTION_ENABLED=true and restart the backend.
- **BLOCKER** growth-scheduler-daemon-armed: schedulerDaemonEnabled=false; schedulerDaemonArmed=false; runtime status unavailable: HTTP 401; envDaemon=missing; envRealAllowed=missing. Next step: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN. | For unattended commercial scheduling, explicitly set GROWTH_SCHEDULER_DAEMON=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true.
- **BLOCKER** verified-growth-account: visibleAccounts=0, onlineNormalAccountCount=0; account health API failed: HTTP 401. Next step: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN.
- **BLOCKER** schedule-plan-api: Schedule plan failed: HTTP 401. Next step: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN.
- **BLOCKER** ready-auto-task: readyCount=0; schedule plan unavailable. Next step: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN.
- **BLOCKER** commercial-live-prerequisites-read-only: executionEnabled=false; schedulerDaemonEnabled=false; schedulerDaemonArmed=false; readyCount=0; onlineNormalAccountCount=0. Next step: Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN. | For commercial live execution, explicitly set GROWTH_EXECUTION_ENABLED=true and restart the backend. | For unattended commercial scheduling, explicitly set GROWTH_SCHEDULER_DAEMON=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true.
- **BLOCKER** overview-api: Overview failed: HTTP 401.
- **BLOCKER** report-diagnosis-honesty: Reports failed: HTTP 401.
- **PASS** database-readable: Read SQLite database at /Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite.
- **PASS** database-account-health: growth_account_health rows=4.
- **PASS** database-configs: growth_acquisition_configs rows=4.
- **PASS** database-runs: growth_acquisition_runs rows=12.

## Evidence Files

- `summary.json`
