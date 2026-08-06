-- SQLite companion for existing desktop databases. Fresh databases receive
-- the same ownership and durable publish fields from schema.sqlite.prisma.
ALTER TABLE "articles" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "articles" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';

ALTER TABLE "publish_accounts" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "publish_accounts" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';
ALTER TABLE "publish_accounts" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE "publish_records" ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop';
ALTER TABLE "publish_records" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user';
ALTER TABLE "publish_records" ADD COLUMN "durable_record_id" TEXT;
ALTER TABLE "publish_records" ADD COLUMN "source_identity" JSONB;
ALTER TABLE "publish_records" ADD COLUMN "body_snapshot" TEXT;
ALTER TABLE "publish_records" ADD COLUMN "payload_json" JSONB;
ALTER TABLE "publish_records" ADD COLUMN "result_json" JSONB;

UPDATE "articles"
SET "tenant_id" = COALESCE(
      (
        SELECT member."tenant_id"
        FROM "tenant_members" AS member
        WHERE member."status" = 'active'
        ORDER BY member."joined_at" ASC, member."created_at" ASC
        LIMIT 1
      ),
      "tenant_id"
    ),
    "user_id" = COALESCE(
      (
        SELECT member."user_id"
        FROM "tenant_members" AS member
        WHERE member."status" = 'active'
        ORDER BY member."joined_at" ASC, member."created_at" ASC
        LIMIT 1
      ),
      "user_id"
    )
WHERE "tenant_id" = 'legacy-local-desktop'
  AND "user_id" = 'legacy-local-user';

UPDATE "publish_accounts"
SET "tenant_id" = COALESCE(
      (
        SELECT member."tenant_id"
        FROM "tenant_members" AS member
        WHERE member."status" = 'active'
        ORDER BY member."joined_at" ASC, member."created_at" ASC
        LIMIT 1
      ),
      "tenant_id"
    ),
    "user_id" = COALESCE(
      (
        SELECT member."user_id"
        FROM "tenant_members" AS member
        WHERE member."status" = 'active'
        ORDER BY member."joined_at" ASC, member."created_at" ASC
        LIMIT 1
      ),
      "user_id"
    ),
    "status" = CASE
      WHEN json_valid("config")
      THEN COALESCE(NULLIF(json_extract("config", '$.status'), ''), "status", 'ready')
      ELSE COALESCE("status", 'ready')
    END
WHERE "tenant_id" = 'legacy-local-desktop'
  AND "user_id" = 'legacy-local-user';

UPDATE "publish_records"
SET "tenant_id" = COALESCE(
      (
        SELECT article."tenant_id"
        FROM "articles" AS article
        WHERE article."id" = "publish_records"."article_id"
        LIMIT 1
      ),
      "tenant_id"
    ),
    "user_id" = COALESCE(
      (
        SELECT article."user_id"
        FROM "articles" AS article
        WHERE article."id" = "publish_records"."article_id"
        LIMIT 1
      ),
      "user_id"
    )
WHERE "tenant_id" = 'legacy-local-desktop'
  AND "user_id" = 'legacy-local-user';

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
