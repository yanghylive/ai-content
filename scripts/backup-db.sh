#!/usr/bin/env bash
# =============================================================================
# ai-content 数据库备份与恢复演练脚本（本地 docker Postgres：ai-content-postgres-1）
#
# 用法：
#   ./scripts/backup-db.sh --backup                 # pg_dump → 归档（保留最近 7 份）
#   ./scripts/backup-db.sh --restore-test [文件]    # 恢复到临时库并验证（不覆盖主库）
#   ./scripts/backup-db.sh --list                   # 列出备份归档
#
# 生产备份（云端 DB 在 kaypal-prod-new，如启用远程备份需先配 SSH 隧道）：
#   ssh kaypal-prod-new "pg_dump ..." | gzip > backups/prod-<date>.sql.gz
# =============================================================================
set -euo pipefail

CONTAINER="ai-content-postgres-1"
DB_USER="${PGUSER:-postgres}"
DB_NAME="ai_content"
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
KEEP=7

mkdir -p "$BACKUP_DIR"

case "${1:-}" in
  --backup)
    TS="$(date +%Y%m%d-%H%M%S)"
    OUT="$BACKUP_DIR/ai_content-$TS.sql.gz"
    echo "== pg_dump $DB_NAME → $OUT =="
    docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=plain --no-owner \
      | gzip > "$OUT"
    SIZE="$(du -h "$OUT" | cut -f1)"
    echo "备份完成（${SIZE}）：$OUT"
    # 清理旧备份
    ls -1t "$BACKUP_DIR"/ai_content-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
      echo "[clean] 删除旧备份 $old"
      rm -f "$old"
    done
    ;;
  --restore-test)
    SRC="${2:-$(ls -1t "$BACKUP_DIR"/ai_content-*.sql.gz 2>/dev/null | head -1)}"
    if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
      echo "[error] 备份文件不存在：$SRC" >&2
      exit 1
    fi
    RESTORE_DB="ai_content_restore_smoke"
    echo "== 恢复到临时库 ${RESTORE_DB}（源：${SRC}）=="
    docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS $RESTORE_DB;" >/dev/null
    docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres \
      -c "CREATE DATABASE $RESTORE_DB;" >/dev/null
    gunzip -c "$SRC" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$RESTORE_DB" > /dev/null

    echo "== 验证：表数量 + 关键表行数 =="
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$RESTORE_DB" -t -c \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" \
      | xargs echo "  表数量:"
    for t in "publish_accounts" "user_session" "intelligence_monitor"; do
      if docker exec "$CONTAINER" psql -U "$DB_USER" -d "$RESTORE_DB" -t -c \
          "SELECT to_regclass('public.$t');" 2>/dev/null | grep -q "$t"; then
        n=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$RESTORE_DB" -t -c "SELECT count(*) FROM $t;" | xargs)
        echo "  表 $t: $n 行"
      fi
    done
    echo "== 清理临时库 =="
    docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres \
      -c "DROP DATABASE $RESTORE_DB;" >/dev/null
    echo "恢复演练通过 ✅（${SRC}）"
    ;;
  --list)
    echo "=== 备份归档（${BACKUP_DIR}）==="
    ls -lht "$BACKUP_DIR"/ai_content-*.sql.gz 2>/dev/null | head -10
    ;;
  *)
    echo "用法: $0 {--backup|--restore-test [文件]|--list}" >&2
    exit 1
    ;;
esac
