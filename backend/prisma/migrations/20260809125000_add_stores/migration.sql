-- CreateTable: stores（门店采购主体，P0b-5 多门店）
CREATE TABLE "stores" (
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
CREATE INDEX "stores_tenant_id_status_idx" ON "stores"("tenant_id", "status");

-- procurement_lists 在 add_savings_module 中创建；新库先跳过，末尾 repair migration 补齐。
DO $$
BEGIN
  IF to_regclass('procurement_lists') IS NOT NULL THEN
    ALTER TABLE "procurement_lists" ADD COLUMN IF NOT EXISTS "store_id" TEXT;
    CREATE INDEX IF NOT EXISTS "procurement_lists_store_id_idx" ON "procurement_lists"("store_id");
  END IF;
END $$;
