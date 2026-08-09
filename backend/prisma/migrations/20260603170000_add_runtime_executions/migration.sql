CREATE TABLE IF NOT EXISTS "runtime_executions" (
  "id" TEXT NOT NULL,
  "relatedId" TEXT NOT NULL,
  "relatedType" TEXT NOT NULL,
  "executor" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "accountId" INTEGER,
  "ok" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "userMessage" TEXT NOT NULL,
  "technicalMessage" TEXT,
  "runtimeJson" JSONB NOT NULL,
  "evidenceJson" JSONB NOT NULL DEFAULT '[]',
  "readbackJson" JSONB,
  "agentSSessionId" TEXT,
  "engineUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "runtime_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "runtime_executions_relatedId_idx" ON "runtime_executions"("relatedId");
CREATE INDEX IF NOT EXISTS "runtime_executions_accountId_idx" ON "runtime_executions"("accountId");
CREATE INDEX IF NOT EXISTS "runtime_executions_executor_idx" ON "runtime_executions"("executor");
CREATE INDEX IF NOT EXISTS "runtime_executions_status_idx" ON "runtime_executions"("status");
CREATE INDEX IF NOT EXISTS "runtime_executions_createdAt_idx" ON "runtime_executions"("createdAt");
