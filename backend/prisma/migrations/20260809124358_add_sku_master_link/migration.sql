-- 该迁移历史上早于 add_savings_module，商品表尚未创建时必须安全跳过。
-- 末尾 repair migration 会在两张表创建后幂等补齐字段和索引。
DO $$
BEGIN
  IF to_regclass('product_masters') IS NOT NULL THEN
    ALTER TABLE "product_masters" ADD COLUMN IF NOT EXISTS "title_key" TEXT;
    UPDATE "product_masters"
    SET "title_key" = "name"
    WHERE "title_key" IS NULL;
    ALTER TABLE "product_masters" ALTER COLUMN "title_key" SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "product_masters_title_key_key"
      ON "product_masters"("title_key");
  END IF;

  IF to_regclass('offer_snapshots') IS NOT NULL THEN
    ALTER TABLE "offer_snapshots" ADD COLUMN IF NOT EXISTS "master_id" TEXT;
    CREATE INDEX IF NOT EXISTS "offer_snapshots_master_id_idx"
      ON "offer_snapshots"("master_id");
  END IF;
END $$;
