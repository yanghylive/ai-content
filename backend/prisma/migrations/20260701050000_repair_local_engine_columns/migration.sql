-- Repair drift between the current Prisma models and the legacy
-- local_engine_* tables. These columns are read by LocalEngineService
-- on global app load; missing columns caused unrelated 500s while
-- visiting Data Intelligence pages.

ALTER TABLE "local_engine_reply_rules"
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "industry" TEXT,
  ADD COLUMN IF NOT EXISTS "tone" TEXT,
  ADD COLUMN IF NOT EXISTS "send_mode" TEXT,
  ADD COLUMN IF NOT EXISTS "keywords" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "forbidden_words" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "highlights" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "closing_text" TEXT,
  ADD COLUMN IF NOT EXISTS "escalation_rules" JSONB,
  ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "local_engine_agent_sessions"
  ADD COLUMN IF NOT EXISTS "scope" TEXT,
  ADD COLUMN IF NOT EXISTS "target_app" TEXT,
  ADD COLUMN IF NOT EXISTS "instruction" TEXT,
  ADD COLUMN IF NOT EXISTS "risk_level" TEXT,
  ADD COLUMN IF NOT EXISTS "events" JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "confirmations" JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "evidence" JSONB DEFAULT '[]'::jsonb;
