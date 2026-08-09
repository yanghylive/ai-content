ALTER TABLE "runtime_executions"
ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop',
ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user',
ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
ADD COLUMN IF NOT EXISTS "request_hash" TEXT,
ADD COLUMN IF NOT EXISTS "confirmation_id" TEXT,
ADD COLUMN IF NOT EXISTS "auth_session_id" TEXT,
ADD COLUMN IF NOT EXISTS "claim_token" TEXT,
ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "runtime_executions_tenant_user_task_idempotency_key"
ON "runtime_executions"("tenant_id", "user_id", "taskType", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "runtime_executions_durable_publish_related_id_key"
ON "runtime_executions"("tenant_id", "user_id", "relatedId")
WHERE "taskType" = 'auto-upload-publish-record-v1';

CREATE INDEX IF NOT EXISTS "runtime_executions_tenant_id_user_id_taskType_createdAt_idx"
ON "runtime_executions"("tenant_id", "user_id", "taskType", "createdAt");

CREATE INDEX IF NOT EXISTS "runtime_executions_taskType_status_lease_expires_at_createdAt_idx"
ON "runtime_executions"("taskType", "status", "lease_expires_at", "createdAt");
