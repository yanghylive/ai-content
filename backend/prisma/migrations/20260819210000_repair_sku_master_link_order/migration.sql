-- 商品主档和平台快照在 add_savings_module 中创建；此前 SKU 迁移时间过早，
-- 新库会先跳过字段变更。这里在两张表存在后幂等补齐 schema。
ALTER TABLE IF EXISTS "product_masters"
  ADD COLUMN IF NOT EXISTS "title_key" TEXT;

DO $$
BEGIN
  IF to_regclass('product_masters') IS NOT NULL THEN
    UPDATE "product_masters"
    SET "title_key" = "name"
    WHERE "title_key" IS NULL;
    ALTER TABLE "product_masters" ALTER COLUMN "title_key" SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "product_masters_title_key_key"
      ON "product_masters"("title_key");
  END IF;
END $$;

ALTER TABLE IF EXISTS "offer_snapshots"
  ADD COLUMN IF NOT EXISTS "master_id" TEXT;

CREATE INDEX IF NOT EXISTS "offer_snapshots_master_id_idx"
  ON "offer_snapshots"("master_id");

-- add_stores 排在采购清单创建之前；在基础 savings 表落地后补齐门店关系。
CREATE TABLE IF NOT EXISTS "stores" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "stores_tenant_id_status_idx"
  ON "stores"("tenant_id", "status");

DO $$
BEGIN
  IF to_regclass('procurement_lists') IS NOT NULL THEN
    ALTER TABLE "procurement_lists" ADD COLUMN IF NOT EXISTS "store_id" TEXT;
    CREATE INDEX IF NOT EXISTS "procurement_lists_store_id_idx"
      ON "procurement_lists"("store_id");
  END IF;
END $$;

-- price_histories 在 add_price_history 中创建，但该迁移先于 price_watches。
CREATE TABLE IF NOT EXISTS "price_histories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "watch_id" TEXT,
    "item_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "coupon_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pay_price" DECIMAL(10,2) NOT NULL,
    "commission_rate" DECIMAL(6,2),
    "est_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "snapshot_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_histories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "price_histories_item_id_platform_code_snapshot_at_key"
  ON "price_histories"("item_id", "platform_code", "snapshot_at");
CREATE INDEX IF NOT EXISTS "price_histories_tenant_id_user_id_snapshot_at_idx"
  ON "price_histories"("tenant_id", "user_id", "snapshot_at");
CREATE INDEX IF NOT EXISTS "price_histories_item_id_snapshot_at_idx"
  ON "price_histories"("item_id", "snapshot_at");

DO $$
BEGIN
  IF to_regclass('price_watches') IS NOT NULL THEN
    ALTER TABLE "price_watches" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
  END IF;
END $$;
