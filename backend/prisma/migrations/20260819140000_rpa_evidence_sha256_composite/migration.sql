-- P1 复核：证据幂等键 sha256 全局唯一 → (execution_id, sha256) 复合唯一。
-- 字节 hash 化后同内容证据跨执行 hash 相同，全局唯一会吞掉第二次执行的证据行。
-- 防御式：本迁移时间序早于 20260819153000_add_rpa_fields（CREATE TABLE），
-- 新库从零 deploy 时表尚不存在 → DO 块判表存在再改约束（新库由 153000 直接建复合索引）。
DO $$ BEGIN
  IF to_regclass('rpa_evidence') IS NOT NULL THEN
    ALTER TABLE "rpa_evidence" DROP CONSTRAINT IF EXISTS "rpa_evidence_sha256_key";
    CREATE UNIQUE INDEX IF NOT EXISTS "rpa_evidence_execution_sha256_key"
      ON "rpa_evidence"("execution_id", "sha256");
  END IF;
END $$;
