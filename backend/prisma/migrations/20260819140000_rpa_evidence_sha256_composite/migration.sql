-- P1 复核：证据幂等键 sha256 全局唯一 → (execution_id, sha256) 复合唯一。
-- 字节 hash 化后同内容证据跨执行 hash 相同，全局唯一会吞掉第二次执行的证据行。
ALTER TABLE "rpa_evidence" DROP CONSTRAINT IF EXISTS "rpa_evidence_sha256_key";
CREATE UNIQUE INDEX IF NOT EXISTS "rpa_evidence_execution_sha256_key"
  ON "rpa_evidence"("execution_id", "sha256");
