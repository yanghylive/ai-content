-- AlterTable: ProductMaster 加 title_key（SKU 归并键，唯一）
ALTER TABLE "product_masters" ADD COLUMN "title_key" TEXT;
UPDATE "product_masters" SET "title_key" = "name";
ALTER TABLE "product_masters" ALTER COLUMN "title_key" SET NOT NULL;
CREATE UNIQUE INDEX "product_masters_title_key_key" ON "product_masters"("title_key");

-- AlterTable: OfferSnapshot 加 master_id（关联商品主档）
ALTER TABLE "offer_snapshots" ADD COLUMN "master_id" TEXT;
CREATE INDEX "offer_snapshots_master_id_idx" ON "offer_snapshots"("master_id");
