# 商用外部运维闭环 Runbook（OSS / 告警 / 跨机器恢复）

更新时间：2026-07-03

## 目标

把“代码里支持备份、对象存储、告警、恢复”推进到可验收状态。验收不靠口头判断，统一跑 `scripts/commercial-external-ops-smoke.mjs`，输出 `summary.json` 和 `report.md`。

## 一、生产或测试环境配置

阿里云 OSS：

```bash
export COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER=aliyun-oss
export COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID='...'
export COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET='...'
export COMMERCIAL_BACKUP_OSS_BUCKET='...'
export COMMERCIAL_BACKUP_OSS_ENDPOINT='https://oss-cn-hangzhou.aliyuncs.com'
export COMMERCIAL_BACKUP_OSS_REGION='oss-cn-hangzhou'
export COMMERCIAL_BACKUP_OSS_PREFIX='commercial-readiness-backups'
```

值班告警：

```bash
export COMMERCIAL_BACKUP_ALERT_PROVIDER=wecom
export COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
```

生产验收不能使用本机 webhook。`--real` 模式下，如果告警地址指向 `localhost`、`127.0.0.1`、`0.0.0.0` 或 `::1`，脚本会判定为阻断；这类地址只能用于开发自测，不能作为值班告警证据。

可选 provider：

- `wecom`：企业微信机器人。
- `feishu`：飞书机器人。
- `slack`：Slack incoming webhook。
- `generic`：普通 JSON webhook。

恢复目标库必须是隔离库，不能是生产库：

```bash
export COMMERCIAL_RESTORE_DATABASE_URL='postgresql://user:pass@host:5432/ai_content_restore_smoke'
export PSQL_RESTORE_PATH='psql'
```

## 二、先跑一轮后台备份

后端启动时建议明确配置：

```bash
export COMMERCIAL_BACKUP_DATABASE_URL='postgresql://user:pass@host:5432/ai_content'
export COMMERCIAL_BACKUP_DAEMON=true
export COMMERCIAL_BACKUP_DAEMON_ARMED=true
export COMMERCIAL_BACKUP_RUN_ON_START=true
export COMMERCIAL_BACKUP_INTERVAL_MS=21600000
export COMMERCIAL_BACKUP_RETENTION_COUNT=5
export COMMERCIAL_BACKUP_ISOLATED_RESTORE_ON_SCHEDULE=true
```

确认后端启动后，至少生成一轮 `commercial-readiness-postgres-pgdump` manifest。

## 三、外部通道验收

只读/本机预检：

```bash
node scripts/commercial-external-ops-smoke.mjs
```

真实外部写入、读回、告警发送：

```bash
node scripts/commercial-external-ops-smoke.mjs --real --download-backup
```

把当前最新本地备份上传到 OSS，再读回验证：

```bash
node scripts/commercial-external-ops-smoke.mjs --real --upload-latest-backup --download-backup
```

脚本会做这些事：

- 读取最近一次本地备份 manifest。
- 如果配置了阿里云 OSS：写入一个小探针对象、读回、删除。
- 从 OSS prefix 找到最新远端 `manifest.json`，校验远端备份 key。
- 加 `--upload-latest-backup` 时，会把当前最新本地备份和一份远端 manifest 上传到 OSS。
- 加 `--download-backup` 时，把远端 manifest 和备份文件下载到 evidence 目录。
- 如果配置了告警 webhook：向值班群发一条 smoke 消息。
- 生成 `docs/acceptance-evidence-YYYY-MM-DD/commercial-external-ops-smoke-*/report.md`。

## 四、跨机器恢复验收

在干净机器上：

1. 拉取同版本代码或安装同版本应用。
2. 安装 PostgreSQL client，确保 `psql --version` 可用。
3. 配置同一套 OSS 只读凭据和独立恢复库。
4. 下载远端备份并恢复：

```bash
node scripts/commercial-external-ops-smoke.mjs --real --download-backup --restore
```

注意：

- `--restore` 会向 `COMMERCIAL_RESTORE_DATABASE_URL` 写入数据。
- 恢复库必须是空库或专门重建过的隔离库。
- 不允许把 `COMMERCIAL_RESTORE_DATABASE_URL` 指向生产库。

## 五、验收通过标准

`report.md` 里应至少看到：

- `latest-local-backup` 为 `PASS`。
- `aliyun-oss-write-read-delete` 为 `PASS`。
- `aliyun-oss-latest-backup-readback` 为 `PASS`。
- `alert-webhook-real-probe` 为 `PASS`。
- 干净机器上 `restore-runbook-real-execution` 为 `PASS`。

如果没有真实 OSS 或 webhook，报告出现 `BLOCKED` 是正确结果，不能把 readiness/foundation 描述为“完整真实商用 SaaS 已上线”。
