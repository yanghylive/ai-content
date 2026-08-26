# Commercial External Ops Smoke

- Generated at: 2026-08-23T06:46:23.770Z
- Real external writes: yes
- Evidence dir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/commercial-external-ops-smoke-2026-08-23T06-46-23-770Z

| Status | Check | Message | Next action |
| --- | --- | --- | --- |
| BLOCKED | latest-local-backup | 没有找到 manifest：- | 先生成一轮本地备份，再跑外部运维 smoke。 |
| FAIL | aliyun-oss-write-read-delete | getaddrinfo ENOTFOUND kaypal.oss-oss-cn-hangzhou.aliyuncs.com, PUT https://kaypal.oss-oss-cn-hangzhou.aliyuncs.com/acceptance-backup-1787467583/_smoke/2026-08-23T06-46-23-770Z-8027e7a4.json -1 (connected: false, keepalive socket: false, agent status: {"createSocketCount":1,"createSocketErrorCount":0,"closeSocketCount":0,"errorSocketCount":0,"timeoutSocketCount":0,"requestCount":0,"freeSockets":{},"sockets":{"kaypal.oss-oss-cn-hangzhou.aliyuncs.com:443:::::::::::::::::::::":1},"requests":{}}, socketHandledRequests: 1, socketHandledResponses: 0)<br>headers: {} | 检查 bucket 权限、endpoint/region、AK/SK、网络出口。 |
| BLOCKED | alert-webhook-config | 未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。 | 填入企业微信/飞书/Slack 值班群 webhook 后再跑。 |
| BLOCKED | restore-backup-file | 没有可用于恢复演练的本地或下载备份文件。 | 先生成本地备份，或用 --real --download-backup 从 OSS 下载远端备份。 |
