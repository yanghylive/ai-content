-- RPA 执行记录补齐字段（复核 #11：RPA 正式迁移，新环境/升级环境部署可追溯）
-- PostgreSQL 主 schema：Json → JSONB；SQLite 运行时 DDL 见 prisma.service.ts（JSONB 同名兼容）。
-- 注意：rpa_executions 基表此前从未有 CREATE 迁移（一直靠 db push/运行时 DDL 管理），
-- 此处补幂等建表（IF NOT EXISTS），再幂等补列，保证新库/旧库都能应用。
CREATE TABLE IF NOT EXISTS "rpa_executions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "session_id" TEXT,
  "account_id" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'unknown',
  "steps" JSONB NOT NULL DEFAULT '[]',
  "resume_step" TEXT,
  "input_json" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT,
  "next_action" TEXT,
  "page_fingerprint" TEXT,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'running',
  "driver_version" TEXT,
  "run_id" TEXT,
  "user_message" TEXT NOT NULL,
  "technical_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3)
);

-- 幂等补列（旧库可能已有部分列）
ALTER TABLE "rpa_executions" ADD COLUMN IF NOT EXISTS "input_json" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "rpa_executions" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS "rpa_executions_user_id_started_at_idx" ON "rpa_executions"("user_id", "started_at");
CREATE INDEX IF NOT EXISTS "rpa_executions_tenant_id_started_at_idx" ON "rpa_executions"("tenant_id", "started_at");
CREATE INDEX IF NOT EXISTS "rpa_executions_platform_status_idx" ON "rpa_executions"("platform", "status");
CREATE INDEX IF NOT EXISTS "rpa_executions_run_id_idx" ON "rpa_executions"("run_id");

-- 复核 #3：独立步骤表 + 独立证据表（RPA 正式迁移）
CREATE TABLE IF NOT EXISTS "rpa_execution_steps" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "execution_id" TEXT NOT NULL REFERENCES "rpa_executions"("id") ON DELETE CASCADE,
  "sequence_no" INTEGER NOT NULL,
  "step_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT,
  "message" TEXT,
  "result_hash" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "rpa_execution_steps_execution_id_sequence_no_key"
  ON "rpa_execution_steps"("execution_id", "sequence_no");
CREATE INDEX IF NOT EXISTS "rpa_execution_steps_execution_id_idx"
  ON "rpa_execution_steps"("execution_id");

CREATE TABLE IF NOT EXISTS "rpa_evidence" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "execution_id" TEXT NOT NULL REFERENCES "rpa_executions"("id") ON DELETE CASCADE,
  "step_id" TEXT,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "account_id" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'rpa-step',
  "uri" TEXT,
  "sha256" TEXT NOT NULL UNIQUE,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "page_url" TEXT,
  "page_fingerprint" TEXT,
  "source" TEXT NOT NULL DEFAULT 'driver',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "rpa_evidence_execution_id_idx"
  ON "rpa_evidence"("execution_id");
CREATE INDEX IF NOT EXISTS "rpa_evidence_user_id_captured_at_idx"
  ON "rpa_evidence"("user_id", "captured_at");

-- P1 复核：同账号活动执行数据库级唯一约束（部分唯一索引）。
-- 同一用户同平台同账号，同时只能有一条活动执行（running/paused/needs-human）。
-- 并发创建时第二个会因唯一约束冲突失败 → 转为 account_busy。
CREATE UNIQUE INDEX IF NOT EXISTS "rpa_executions_active_account_unique"
  ON "rpa_executions"("user_id", "platform", "account_id")
  WHERE "status" IN ('running', 'paused', 'needs-human');

-- P1-4 复核：租户共享账号互斥——同租户成员用同一纳管账号也必须互斥。
-- 有 tenant_id 的记录走租户维度锁；tenant_id 为 NULL 的 legacy 记录不受此索引约束
-- （由上面的 user 维度索引兜底）。
CREATE UNIQUE INDEX IF NOT EXISTS "rpa_executions_active_account_tenant_unique"
  ON "rpa_executions"("tenant_id", "platform", "account_id")
  WHERE "status" IN ('running', 'paused', 'needs-human') AND "tenant_id" IS NOT NULL;
