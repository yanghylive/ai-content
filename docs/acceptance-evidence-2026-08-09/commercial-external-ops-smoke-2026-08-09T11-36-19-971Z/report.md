# Commercial External Ops Smoke

- Generated at: 2026-08-09T11:36:19.971Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-09/commercial-external-ops-smoke-2026-08-09T11-36-19-971Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| PASS | latest-local-backup | commercial-readiness-postgres-pgdump; file=/Users/yanghy/Documents/New project/ai-content/.local-backups/commercial-readiness/2026-07-03T05-39-56-761Z/postgres-dump.sql; size=2454800 |  |
| FAIL | aliyun-oss-write-read-delete | read ETIMEDOUT, PUT https://kaypal.oss-cn-hangzhou.aliyuncs.com/commercial-readiness-backups/_smoke/2026-08-09T11-36-19-971Z-5829f36d.json -1 (connected: true, keepalive socket: false, agent status: {"createSocketCount":1,"createSocketErrorCount":0,"closeSocketCount":0,"errorSocketCount":0,"timeoutSocketCount":0,"requestCount":0,"freeSockets":{},"sockets":{"kaypal.oss-cn-hangzhou.aliyuncs.com:443:::::::::::::::::::::":1},"requests":{}}, socketHandledRequests: 1, socketHandledResponses: 0)<br>headers: {} | 检查 bucket 权限、endpoint/region、AK/SK、网络出口。 |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| BLOCKED | restore-target-config | 未配置 COMMERCIAL_RESTORE_DATABASE_URL。 | 在干净机器或隔离库上配置一个独立恢复库，不能指向生产库。 |
