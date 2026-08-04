-- SQLite companion for existing desktop databases. The bundled SQLite schema uses
-- String for interaction task types, so WECHAT_FRIEND_ACCEPT needs no enum DDL.
-- Apply once before starting a bundle against a pre-tenancy database; fresh bundles
-- receive the same shape from schema.sqlite.prisma.

ALTER TABLE "local_engine_reply_rules" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "local_engine_reply_rules" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';
ALTER TABLE "local_engine_reply_rules" ADD COLUMN "bot_key" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "local_engine_reply_rules" ADD COLUMN "config_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "local_engine_reply_rules" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "local_engine_reply_rules" ADD COLUMN "created_at" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';

ALTER TABLE "local_engine_agent_sessions" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "local_engine_agent_sessions" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';
ALTER TABLE "local_engine_agent_confirmations" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "local_engine_agent_confirmations" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';
ALTER TABLE "interaction_tasks" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "interaction_tasks" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';

UPDATE "local_engine_reply_rules"
SET "bot_key" = "id",
    "created_at" = COALESCE("updated_at", CURRENT_TIMESTAMP),
    "user_id" = COALESCE(
      (
        SELECT users."id"
        FROM "users"
        WHERE users."id" = CASE
          WHEN json_valid("local_engine_reply_rules"."rule_json")
          THEN NULLIF(json_extract("local_engine_reply_rules"."rule_json", '$.userId'), '')
          ELSE NULL
        END
        LIMIT 1
      ),
      "user_id"
    );

UPDATE "local_engine_reply_rules"
SET "tenant_id" = COALESCE(
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = "local_engine_reply_rules"."user_id"
      AND member."status" = 'active'
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  "tenant_id"
);

UPDATE "local_engine_agent_sessions"
SET "user_id" = COALESCE(
  (
    SELECT users."id"
    FROM "users"
    WHERE users."id" = CASE
      WHEN json_valid("local_engine_agent_sessions"."session_json")
      THEN COALESCE(
        NULLIF(json_extract("local_engine_agent_sessions"."session_json", '$.userId'), ''),
        NULLIF(json_extract("local_engine_agent_sessions"."session_json", '$.metadata.userId'), '')
      )
      ELSE NULL
    END
    LIMIT 1
  ),
  "user_id"
);

UPDATE "local_engine_agent_sessions"
SET "tenant_id" = COALESCE(
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = "local_engine_agent_sessions"."user_id"
      AND member."status" = 'active'
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  "tenant_id"
);

UPDATE "interaction_tasks"
SET "user_id" = COALESCE(
  (
    SELECT users."id"
    FROM "users"
    WHERE users."id" = CASE
      WHEN json_valid("interaction_tasks"."config")
      THEN COALESCE(
        NULLIF(json_extract("interaction_tasks"."config", '$.userId'), ''),
        NULLIF(json_extract("interaction_tasks"."config", '$.billingIdentity.localUserId'), ''),
        NULLIF("interaction_tasks"."createdBy", '')
      )
      ELSE NULLIF("interaction_tasks"."createdBy", '')
    END
    LIMIT 1
  ),
  "user_id"
);

UPDATE "interaction_tasks"
SET "tenant_id" = COALESCE(
  (
    SELECT member."tenant_id"
    FROM "tenant_members" AS member
    WHERE member."user_id" = "interaction_tasks"."user_id"
      AND member."status" = 'active'
    ORDER BY member."created_at" ASC
    LIMIT 1
  ),
  "tenant_id"
);

UPDATE "local_engine_agent_confirmations"
SET "tenant_id" = COALESCE(
      (
        SELECT session."tenant_id"
        FROM "local_engine_agent_sessions" AS session
        WHERE session."id" = "local_engine_agent_confirmations"."session_id"
        LIMIT 1
      ),
      "tenant_id"
    ),
    "user_id" = COALESCE(
      (
        SELECT session."user_id"
        FROM "local_engine_agent_sessions" AS session
        WHERE session."id" = "local_engine_agent_confirmations"."session_id"
        LIMIT 1
      ),
      "user_id"
    );

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
