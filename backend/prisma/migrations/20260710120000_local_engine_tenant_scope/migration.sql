-- Scope AI customer-service and Agent records to the authenticated tenant and actor.
-- Legacy rows are assigned from embedded actor metadata when it maps to a real user;
-- otherwise they remain in an inaccessible legacy-local scope instead of being exposed
-- to the first SaaS tenant that happens to read them.

ALTER TYPE "InteractionTaskType" ADD VALUE IF NOT EXISTS 'WECHAT_FRIEND_ACCEPT';

ALTER TABLE "local_engine_reply_rules"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "bot_key" TEXT,
  ADD COLUMN IF NOT EXISTS "config_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ;

ALTER TABLE "local_engine_agent_sessions"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "user_id" TEXT;

ALTER TABLE "local_engine_agent_confirmations"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "user_id" TEXT;

ALTER TABLE "interaction_tasks"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "user_id" TEXT;

UPDATE "local_engine_reply_rules" AS rule
SET "user_id" = COALESCE(
  rule."user_id",
  (
    SELECT users."id"
    FROM "users"
    WHERE users."id" = NULLIF(rule."rule_json" ->> 'userId', '')
    LIMIT 1
  ),
  'legacy-local-user'
);

UPDATE "local_engine_reply_rules" AS rule
SET "tenant_id" = COALESCE(
  rule."tenant_id",
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = rule."user_id"
      AND member."status" = 'active'
      AND member."tenant_id" = NULLIF(rule."rule_json" ->> 'tenantId', '')
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = rule."user_id"
      AND member."status" = 'active'
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  'legacy-local-desktop'
),
"bot_key" = COALESCE(NULLIF(rule."bot_key", ''), rule."id"),
"created_at" = COALESCE(rule."created_at", rule."updated_at", NOW());

UPDATE "local_engine_agent_sessions" AS session
SET "user_id" = COALESCE(
  session."user_id",
  (
    SELECT users."id"
    FROM "users"
    WHERE users."id" = COALESCE(
      NULLIF(session."session_json" ->> 'userId', ''),
      NULLIF(session."session_json" #>> '{metadata,userId}', '')
    )
    LIMIT 1
  ),
  'legacy-local-user'
);

UPDATE "local_engine_agent_sessions" AS session
SET "tenant_id" = COALESCE(
  session."tenant_id",
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = session."user_id"
      AND member."status" = 'active'
      AND member."tenant_id" = COALESCE(
        NULLIF(session."session_json" ->> 'tenantId', ''),
        NULLIF(session."session_json" #>> '{metadata,tenantId}', '')
      )
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = session."user_id"
      AND member."status" = 'active'
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  'legacy-local-desktop'
);

UPDATE "interaction_tasks" AS task
SET "user_id" = COALESCE(
  task."user_id",
  (
    SELECT users."id"
    FROM "users"
    WHERE users."id" = COALESCE(
      NULLIF(task."config" ->> 'userId', ''),
      NULLIF(task."config" #>> '{billingIdentity,localUserId}', ''),
      NULLIF(task."createdBy", '')
    )
    LIMIT 1
  ),
  'legacy-local-user'
);

UPDATE "interaction_tasks" AS task
SET "tenant_id" = COALESCE(
  task."tenant_id",
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = task."user_id"
      AND member."status" = 'active'
      AND member."tenant_id" = NULLIF(task."config" ->> 'tenantId', '')
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = task."user_id"
      AND member."status" = 'active'
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  'legacy-local-desktop'
);

UPDATE "local_engine_agent_confirmations" AS confirmation
SET "user_id" = COALESCE(
  confirmation."user_id",
  session."user_id",
  'legacy-local-user'
),
"tenant_id" = COALESCE(
  confirmation."tenant_id",
  session."tenant_id",
  'legacy-local-desktop'
)
FROM "local_engine_agent_sessions" AS session
WHERE session."id" = confirmation."session_id";

UPDATE "local_engine_agent_confirmations"
SET "user_id" = COALESCE("user_id", 'legacy-local-user'),
    "tenant_id" = COALESCE("tenant_id", 'legacy-local-desktop');

ALTER TABLE "local_engine_reply_rules"
  ALTER COLUMN "tenant_id" SET DEFAULT 'legacy-local-desktop',
  ALTER COLUMN "tenant_id" SET NOT NULL,
  ALTER COLUMN "user_id" SET DEFAULT 'legacy-local-user',
  ALTER COLUMN "user_id" SET NOT NULL,
  ALTER COLUMN "bot_key" SET DEFAULT 'default',
  ALTER COLUMN "bot_key" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT NOW(),
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "local_engine_agent_sessions"
  ALTER COLUMN "tenant_id" SET DEFAULT 'legacy-local-desktop',
  ALTER COLUMN "tenant_id" SET NOT NULL,
  ALTER COLUMN "user_id" SET DEFAULT 'legacy-local-user',
  ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "local_engine_agent_confirmations"
  ALTER COLUMN "tenant_id" SET DEFAULT 'legacy-local-desktop',
  ALTER COLUMN "tenant_id" SET NOT NULL,
  ALTER COLUMN "user_id" SET DEFAULT 'legacy-local-user',
  ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "interaction_tasks"
  ALTER COLUMN "tenant_id" SET DEFAULT 'legacy-local-desktop',
  ALTER COLUMN "tenant_id" SET NOT NULL,
  ALTER COLUMN "user_id" SET DEFAULT 'legacy-local-user',
  ALTER COLUMN "user_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "local_engine_reply_rules_tenant_id_user_id_bot_key_key"
  ON "local_engine_reply_rules"("tenant_id", "user_id", "bot_key");
CREATE INDEX IF NOT EXISTS "local_engine_reply_rules_tenant_id_user_id_updated_at_idx"
  ON "local_engine_reply_rules"("tenant_id", "user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "local_engine_agent_sessions_tenant_id_user_id_source_idx"
  ON "local_engine_agent_sessions"("tenant_id", "user_id", "source");
CREATE INDEX IF NOT EXISTS "local_engine_agent_sessions_tenant_id_user_id_status_idx"
  ON "local_engine_agent_sessions"("tenant_id", "user_id", "status");
CREATE INDEX IF NOT EXISTS "local_engine_agent_sessions_tenant_id_user_id_updated_at_idx"
  ON "local_engine_agent_sessions"("tenant_id", "user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "local_engine_agent_confirmations_tenant_id_user_id_session_id_idx"
  ON "local_engine_agent_confirmations"("tenant_id", "user_id", "session_id");
CREATE INDEX IF NOT EXISTS "local_engine_agent_confirmations_tenant_id_user_id_status_idx"
  ON "local_engine_agent_confirmations"("tenant_id", "user_id", "status");
CREATE INDEX IF NOT EXISTS "interaction_tasks_tenant_id_user_id_status_idx"
  ON "interaction_tasks"("tenant_id", "user_id", "status");
CREATE INDEX IF NOT EXISTS "interaction_tasks_tenant_id_user_id_taskType_idx"
  ON "interaction_tasks"("tenant_id", "user_id", "taskType");
CREATE INDEX IF NOT EXISTS "interaction_tasks_tenant_id_user_id_createdAt_idx"
  ON "interaction_tasks"("tenant_id", "user_id", "createdAt");
