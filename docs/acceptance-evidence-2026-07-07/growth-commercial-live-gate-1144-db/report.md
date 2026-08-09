# Growth Commercial Live Gate

Status: **BLOCKED**
Generated: 2026-07-07T16:27:59.181Z
Read-only: **true**

## Read-only Live Gate State

- executionEnabled: `true`
- schedulerDaemonEnabled: `true`
- schedulerDaemonArmed: `true`
- readyCount: `0`
- onlineNormalAccountCount: `0`
- nextStep: Log in or re-authorize at least one real platform account, then re-run the account health check.
- nextStep: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.


## Checks

- **PASS** backend-process: Backend listening on 3011, pid=67356.
- **PASS** local-acceptance-session: Created local read-only gate session for kaypal_cmo9p6i5x000a58uckbcyv45u.
- **PASS** auth-cookie: Auth cookie/session token was provided to the gate.
- **PASS** auth-me: Authenticated as 大壮.
- **PASS** commercial-permission: commercialExecutionAllowed=true, planMode=commercial, kaypalPlan=ADVANCED, expired=false.
- **PASS** growth-execution-switch: executionEnabled=true; runtimeStatus.executionEnabled=true; processEnv=missing.
- **PASS** growth-scheduler-daemon-armed: schedulerDaemonEnabled=true; schedulerDaemonArmed=true; envDaemon=missing; envRealAllowed=missing.
- **BLOCKER** verified-growth-account: visibleAccounts=0, onlineNormalAccountCount=0. Next step: Log in or re-authorize at least one real platform account, then re-run the account health check.
- **PASS** schedule-plan-api: items=0, readyCount=0, blocked=0, waiting=0.
- **BLOCKER** ready-auto-task: readyCount=0; a commercial live execution test needs at least one ready auto task bound to a verified account. Next step: Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.
- **BLOCKER** commercial-live-prerequisites-read-only: executionEnabled=true; schedulerDaemonEnabled=true; schedulerDaemonArmed=true; readyCount=0; onlineNormalAccountCount=0. Next step: Log in or re-authorize at least one real platform account, then re-run the account health check. | Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.
- **PASS** overview-api: activeConfigCount=0, todayLeadCount=0, contacted=0.
- **PASS** report-diagnosis-honesty: bottlenecks=1; visibleAccounts=0; no-blocker-copy=false.
- **BLOCKER** database-readable: Command failed: sqlite3 backend/prisma/ai-content-dev.db select count(*) from users;
Error: stepping, database is locked (5)


## Evidence Files

- `summary.json`
