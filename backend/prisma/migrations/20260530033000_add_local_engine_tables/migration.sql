-- Formalize local engine persistence that used to be created lazily by the service.
-- IF NOT EXISTS keeps older developer databases upgradeable when the runtime already
-- self-created these tables before this migration existed.

CREATE TABLE IF NOT EXISTS "local_engine_interaction_tasks" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "account_id" TEXT,
  "account_name" TEXT,
  "platform_name" TEXT,
  "target_name" TEXT,
  "task_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "local_engine_interaction_tasks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "local_engine_interaction_tasks"
  ADD COLUMN IF NOT EXISTS "account_id" TEXT,
  ADD COLUMN IF NOT EXISTS "account_name" TEXT,
  ADD COLUMN IF NOT EXISTS "platform_name" TEXT,
  ADD COLUMN IF NOT EXISTS "target_name" TEXT,
  ADD COLUMN IF NOT EXISTS "task_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "local_engine_interaction_tasks_type_idx" ON "local_engine_interaction_tasks"("type");
CREATE INDEX IF NOT EXISTS "local_engine_interaction_tasks_status_idx" ON "local_engine_interaction_tasks"("status");
CREATE INDEX IF NOT EXISTS "local_engine_interaction_tasks_account_id_idx" ON "local_engine_interaction_tasks"("account_id");
CREATE INDEX IF NOT EXISTS "local_engine_interaction_tasks_updated_at_idx" ON "local_engine_interaction_tasks"("updated_at");

CREATE TABLE IF NOT EXISTS "local_engine_reply_rules" (
  "id" TEXT NOT NULL,
  "rule_json" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "local_engine_reply_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "local_engine_reply_rules"
  ADD COLUMN IF NOT EXISTS "rule_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS "local_engine_agent_sessions" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "session_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "local_engine_agent_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "local_engine_agent_sessions"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "session_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "local_engine_agent_sessions_source_idx" ON "local_engine_agent_sessions"("source");
CREATE INDEX IF NOT EXISTS "local_engine_agent_sessions_status_idx" ON "local_engine_agent_sessions"("status");
CREATE INDEX IF NOT EXISTS "local_engine_agent_sessions_updated_at_idx" ON "local_engine_agent_sessions"("updated_at");

CREATE TABLE IF NOT EXISTS "local_engine_agent_confirmations" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "risk_level" TEXT NOT NULL,
  "confirmation_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "decided_at" TIMESTAMPTZ,
  CONSTRAINT "local_engine_agent_confirmations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "local_engine_agent_confirmations"
  ADD COLUMN IF NOT EXISTS "session_id" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "risk_level" TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS "confirmation_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "local_engine_agent_confirmations_session_id_idx" ON "local_engine_agent_confirmations"("session_id");
CREATE INDEX IF NOT EXISTS "local_engine_agent_confirmations_status_idx" ON "local_engine_agent_confirmations"("status");
CREATE INDEX IF NOT EXISTS "local_engine_agent_confirmations_risk_level_idx" ON "local_engine_agent_confirmations"("risk_level");
CREATE INDEX IF NOT EXISTS "local_engine_agent_confirmations_created_at_idx" ON "local_engine_agent_confirmations"("created_at");
