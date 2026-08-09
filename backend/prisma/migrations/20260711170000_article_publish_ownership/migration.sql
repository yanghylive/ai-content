-- Assign new article publishing data to its authenticated organization and user.
-- Existing single-user data follows the earliest active membership when one exists;
-- otherwise it remains in an isolated legacy scope.
ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop',
  ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';

ALTER TABLE "publish_accounts"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop',
  ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE "publish_records"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop',
  ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user',
  ADD COLUMN IF NOT EXISTS "durable_record_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_identity" JSONB,
  ADD COLUMN IF NOT EXISTS "body_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "payload_json" JSONB,
  ADD COLUMN IF NOT EXISTS "result_json" JSONB;

WITH legacy_owner AS (
  SELECT "tenant_id", "user_id"
  FROM "tenant_members"
  WHERE "status" = 'active'
  ORDER BY "joined_at" ASC, "created_at" ASC
  LIMIT 1
)
UPDATE "articles" AS article
SET "tenant_id" = owner."tenant_id", "user_id" = owner."user_id"
FROM legacy_owner AS owner
WHERE article."tenant_id" = 'legacy-local-desktop'
  AND article."user_id" = 'legacy-local-user';

WITH legacy_owner AS (
  SELECT "tenant_id", "user_id"
  FROM "tenant_members"
  WHERE "status" = 'active'
  ORDER BY "joined_at" ASC, "created_at" ASC
  LIMIT 1
)
UPDATE "publish_accounts" AS account
SET "tenant_id" = owner."tenant_id", "user_id" = owner."user_id"
FROM legacy_owner AS owner
WHERE account."tenant_id" = 'legacy-local-desktop'
  AND account."user_id" = 'legacy-local-user';

UPDATE "publish_accounts"
SET "status" = COALESCE(NULLIF("config" ->> 'status', ''), "status", 'ready');

UPDATE "publish_records" AS record
SET "tenant_id" = article."tenant_id", "user_id" = article."user_id"
FROM "articles" AS article
WHERE article."id" = record."article_id"
  AND record."tenant_id" = 'legacy-local-desktop'
  AND record."user_id" = 'legacy-local-user';

CREATE INDEX IF NOT EXISTS "articles_tenant_id_user_id_created_at_idx"
  ON "articles"("tenant_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "publish_accounts_tenant_id_user_id_created_at_idx"
  ON "publish_accounts"("tenant_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "publish_accounts_tenant_id_user_id_platform_status_idx"
  ON "publish_accounts"("tenant_id", "user_id", "platform", "status");
CREATE INDEX IF NOT EXISTS "publish_records_tenant_id_user_id_created_at_idx"
  ON "publish_records"("tenant_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "publish_records_tenant_id_user_id_durable_record_id_idx"
  ON "publish_records"("tenant_id", "user_id", "durable_record_id");
