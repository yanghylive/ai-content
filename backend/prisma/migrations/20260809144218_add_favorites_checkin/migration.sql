-- CreateTable: cps_favorites（收藏夹，P2）
CREATE TABLE "cps_favorites" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT,
    "pay_price" DECIMAL(10,2) NOT NULL,
    "coupon_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "est_rebate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "est_net_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "commission_rate" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cps_favorites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cps_favorites_tenantId_userId_itemId_platformCode_key" ON "cps_favorites"("tenant_id", "user_id", "item_id", "platform_code");
CREATE INDEX "cps_favorites_tenantId_userId_createdAt_idx" ON "cps_favorites"("tenant_id", "user_id", "created_at");

-- CreateTable: savings_checkins（每日签到，P2）
CREATE TABLE "savings_checkins" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "checkin_date" TEXT NOT NULL,
    "reward_amount" DECIMAL(10,2) NOT NULL DEFAULT 0.1,
    "streak_day" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "savings_checkins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "savings_checkins_tenantId_userId_checkinDate_key" ON "savings_checkins"("tenant_id", "user_id", "checkin_date");
CREATE INDEX "savings_checkins_tenantId_userId_checkinDate_idx" ON "savings_checkins"("tenant_id", "user_id", "checkin_date");
