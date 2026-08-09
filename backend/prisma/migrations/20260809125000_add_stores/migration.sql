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

-- AlterTable: procurement_lists 加 store_id（兼容旧数据可空）
ALTER TABLE "procurement_lists" ADD COLUMN "store_id" TEXT;
CREATE INDEX "procurement_lists_store_id_idx" ON "procurement_lists"("store_id");
