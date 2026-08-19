-- P1 复核：rpa_evidence.step_id 从「裸 sequenceNo 字符串」改为指向 rpa_execution_steps.id 的真实外键。
-- 存量数据此前写入的是 sequence_no 的字符串形式，先回填为对应步骤记录的真实 id。

-- 1) 回填：step_id 为纯数字（旧 sequenceNo 语义）→ 替换为同执行下该 sequenceNo 的步骤记录 id
UPDATE "rpa_evidence" e
SET "step_id" = s."id"
FROM "rpa_execution_steps" s
WHERE s."execution_id" = e."execution_id"
  AND e."step_id" ~ '^[0-9]+$'
  AND s."sequence_no" = e."step_id"::int;

-- 2) 孤儿清理：回填后仍不指向任何步骤记录的 step_id → 置 NULL（step_id 可空）
UPDATE "rpa_evidence"
SET "step_id" = NULL
WHERE "step_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "rpa_execution_steps" s WHERE s."id" = "rpa_evidence"."step_id"
  );

-- 3) 加真实外键（步骤记录删除时证据保留、step 置空）
ALTER TABLE "rpa_evidence"
  ADD CONSTRAINT "rpa_evidence_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "rpa_execution_steps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) step_id 查询索引
CREATE INDEX IF NOT EXISTS "rpa_evidence_step_id_idx" ON "rpa_evidence"("step_id");
