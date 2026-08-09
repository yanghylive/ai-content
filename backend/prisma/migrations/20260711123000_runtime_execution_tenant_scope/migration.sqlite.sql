-- SQLite companion for existing desktop databases. Fresh databases receive
-- these fields from schema.sqlite.prisma.
ALTER TABLE "runtime_executions" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "runtime_executions" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';

CREATE INDEX IF NOT EXISTS "runtime_executions_tenant_id_user_id_taskType_createdAt_idx"
  ON "runtime_executions"("tenant_id", "user_id", "taskType", "createdAt");
