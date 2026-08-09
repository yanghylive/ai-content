-- Keep legacy runtime rows inaccessible to authenticated tenants while all new
-- publish records receive their authenticated tenant and user ownership.
ALTER TABLE "runtime_executions"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop',
  ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';

CREATE INDEX IF NOT EXISTS "runtime_executions_tenant_id_user_id_taskType_createdAt_idx"
  ON "runtime_executions"("tenant_id", "user_id", "taskType", "createdAt");
