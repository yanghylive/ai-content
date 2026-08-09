# ai-content 生产发布回滚与备份恢复 SOP

> 适用范围：aicontent.vip.kaypal.cn 生产（kaypal-prod-new 118.178.108.44）
> 建立日期：2026-08-08（C7 回滚 + C6 备份，开发计划批次 C 工程可靠性）
> 关联脚本：`scripts/deploy-prod.sh` / `scripts/rollback-prod.sh` / `scripts/backup-db.sh`

---

## 1. 发布（含版本锚点）

```bash
# 常规发布（前后端一起；或 --backend / --frontend 单独）
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  ./scripts/deploy-prod.sh --tag
```

- `--tag`：部署成功后自动打 `prod-YYYYMMDD-HHMMSS-<commit>` 标签并推远端，
  作为回滚锚点。
- **⚠️ 团队约定：生产发布一律带 `--tag`**，否则回滚脚本无法自动定位上一版。

## 2. 回滚（C7）

```bash
# 查看可回滚版本
./scripts/rollback-prod.sh --list

# 回滚到上一个 prod-* tag（自动定位）
./scripts/rollback-prod.sh --backend   # 或 --frontend / 不带参数全量

# 回滚到指定版本
./scripts/rollback-prod.sh <commit-or-tag>
```

**原理**：`git worktree` 检出目标版本到 `/tmp` 临时目录 → 独立 build →
rsync → 云端 `prisma generate` + `systemctl restart` / 静态 out 替换。
**不触碰当前工作区**，本地未提交改动不受影响。

**回滚后验证**（强制）：
```bash
# 后端：云端 health
ssh kaypal-prod-new "curl -s http://127.0.0.1:3111/api/health | head -c 200"
# 前端：公网页面
curl -s -o /dev/null -w "%{http_code}\n" https://aicontent.vip.kaypal.cn/today
```

**注意事项**：
- 回滚**只回滚代码**，不回滚数据库（避免数据丢失）。
- 若回滚伴随 prisma 模型变更：rollback 脚本已 rsync schema+migrations 并 generate；
  若 schema 与当前数据库不兼容（新列被旧代码引用），回滚前先确认数据库迁移状态。
- 回滚后再发布修复版，需重新打 tag。

## 3. 备份与恢复演练（C6）

```bash
# 备份（本地 docker Postgres，保留最近 7 份）
./scripts/backup-db.sh --backup
# 列出归档
./scripts/backup-db.sh --list
# 恢复演练（恢复到临时库验证，不覆盖主库，验证后自动清理）
./scripts/backup-db.sh --restore-test [备份文件]
```

**建议频率**：
- 备份：每周一次（或每次数据库结构变更后）。
- 恢复演练：每月一次（验证归档可用，防止"备份了但恢复不了"）。

**生产库备份**（云端数据库在 kaypal-prod-new 时）：
```bash
ssh kaypal-prod-new "pg_dump -U <user> -d <db> --format=plain --no-owner" \
  | gzip > backups/prod-$(date +%Y%m%d).sql.gz
```
（生产连接串以云端 `.env` 的 `DATABASE_URL` 为准）

## 4. 故障场景速查

| 场景 | 动作 |
|---|---|
| 后端 500 / 启动失败 | `./scripts/rollback-prod.sh --backend` → health 验证 |
| 前端页面异常 | `./scripts/rollback-prod.sh --frontend` → 公网 200 验证 |
| 数据误操作 | `./scripts/backup-db.sh --list` 找最近归档 → 手动恢复（需停服确认） |
| 回滚后仍异常 | 检查云端日志 `journalctl -u ai-content-backend -n 200`；必要时回滚到更早版本 |

## 5. 演练记录

- 2026-08-08：备份 9.2M；恢复演练通过（84 表，publish_accounts 29 行），临时库已清理。
- rollback-prod.sh `--list` 冒烟通过（尚无 prod-* tag，待下次发布带 --tag 建立锚点）。
