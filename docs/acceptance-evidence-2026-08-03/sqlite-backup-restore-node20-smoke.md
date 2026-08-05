# SQLite Backup, Restore, and Node 20 Smoke Evidence

- Evidence date: 2026-08-03
- Runtime: bundled desktop Node.js v20.20.2
- Database source: desktop application SQLite database
- Safety: all restore and runtime checks used isolated copies; no destructive restore was run

## Backup Artifact

- Backup directory: `commercial-acceptance-node20-v2/2026-08-03T19-29-59-347Z-Ybl7Or`
- Backup database size: 119,697,408 bytes
- Tables: 70
- `PRAGMA integrity_check`: `ok`
- SHA-256: `a6317707b5a39f63191be853cc6b0e4a0e2998f156a498981bf44a8e8a80b4e5`
- Isolated restore verification: passed
- Committed WAL data coverage: passed by automated test
- Tampered backup rejection: passed by automated test
- Manifest path traversal rejection: passed by automated test

The database artifact remains outside the repository because it contains application data. Only this non-sensitive verification record is retained in source control.

## Commercial Runtime Smoke

The SQLite backend bundle was rebuilt and started with the desktop-bundled Node.js v20.20.2 against an isolated copy of the verified backup.

- Backend bundle build: passed
- Desktop commercial asset gate: passed
- `/api/health`: `ok=true`, `ready=true`
- `/api/health/ready`: `ok=true`, `ready=true`
- Database check: `connected`
- Task queue: `healthy`, `running=true`, `consecutiveFailures=0`
- Task queue safety: `new-tasks-only`
- Growth unattended execution: disabled during smoke
- Repeated background `please log in` queue error: not reproduced after the fix
- Temporary process and database copy: stopped and removed after verification

## Automated Regression

- Backend test suites: 123/123 passed
- Backend tests: 1,360/1,360 passed
- Runtime test suites: 26/26 passed
- Runtime tests: 258/258 passed
- Backend TypeScript build: passed

- Jest open-handle detection: passed; the remote-image fetch timeout leak was fixed and no open handle remained

## PostgreSQL Development Runtime Smoke

The development backend was rebuilt and restarted on port 3011 with its PostgreSQL Prisma client and project database configuration.

- Direct backend startup no longer imports the desktop SQLite environment unless SQLite mode is explicitly requested
- `/api/health` and `/api/health/ready`: `ok=true`, `ready=true`
- Task queue: `healthy`, `running=true`, `consecutiveFailures=0`
- Durable publish migration `20260801160000_add_runtime_execution_durable_claims`: applied and recorded
- Durable claim fields verified: `claim_token`, `claimed_at`, `lease_expires_at`, `attempt_count`, and `updated_at`
- Durable publish indexes verified: four migration-defined indexes present
- Durable publish worker: no missing-column error across repeated worker ticks after restart
- Historical migration recovery: 23 original migration directories restored from a source backup; all 23 SHA-256 values match the live Prisma migration ledger
- Migration source of truth: 43/43 applied database migrations now have matching local files and checksums
- Empty-schema migration smoke: 43 migrations applied successfully and produced 82 tables
- Isolated migration schema cleanup: completed
- Runtime process: detached and listening on `127.0.0.1:3011`

## Remaining Operations Gap

This evidence closes local consistent backup, integrity verification, isolated restore, packaged macOS runtime smoke, the observed PostgreSQL durable-publish startup failure, and PostgreSQL forward-migration source completeness. It does not close offsite retention, scheduled restore drills, Windows restore, disaster recovery RPO/RTO, or a real application-version rollback drill.
