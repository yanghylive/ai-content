# Commercial External Ops Smoke

- Generated at: 2026-07-03T05:30:56.062Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/commercial-external-ops-smoke-2026-07-03T05-30-56-062Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T00-28-59-777Z/postgres-dump.sql; size=2454800 |  |
| FAIL | aliyun-oss-write-read-delete | read ETIMEDOUT, DELETE http://kaypal.oss-cn-hangzhou.aliyuncs.com/commercial-readiness-backups/_smoke/2026-07-03T05-30-56-062Z-542c1ebb.json -1 (connected: true, keepalive socket: true, agent status: {"createSocketCount":1,"createSocketErrorCount":0,"closeSocketCount":0,"errorSocketCount":0,"timeoutSocketCount":0,"requestCount":2,"freeSockets":{},"sockets":{"kaypal.oss-cn-hangzhou.aliyuncs.com:80:":1},"requests":{}}, socketHandledRequests: 3, socketHandledResponses: 2)<br>headers: {} | 检查 bucket 权限、endpoint/region、AK/SK、网络出口。 |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| WARN | restore-runbook-dry-check | restore target=postgresql://postgres:***@127.0.0.1:5432/ai_content_restore_external_smoke; backup=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T00-28-59-777Z/postgres-dump.sql | 未启用 --restore，本次只确认恢复输入齐备；干净机器验收时加 --restore。 |
