-- AlterTable: price_watches 加 source（manual 手动 / auto 搜索自动跟踪）
ALTER TABLE "price_watches" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable: price_histories（价格历史轨迹）
CREATE TABLE "price_histories" (
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
CREATE UNIQUE INDEX "price_histories_item_id_platform_code_snapshot_at_key" ON "price_histories"("item_id", "platform_code", "snapshot_at");
CREATE INDEX "price_histories_tenant_id_user_id_snapshot_at_idx" ON "price_histories"("tenant_id", "user_id", "snapshot_at");
CREATE INDEX "price_histories_item_id_snapshot_at_idx" ON "price_histories"("item_id", "snapshot_at");
