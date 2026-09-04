-- 3010 自动获客「账号维度统一触达配额」账号日触达计数器
-- accountId 锚定 publish_accounts.id（stableId）；跨天按 touch_date 切桶
CREATE TABLE "account_touch_quotas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "daily_limit" INTEGER NOT NULL DEFAULT 20,
    "touch_date" TEXT NOT NULL,
    "touch_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "account_touch_quotas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "account_touch_quotas_user_id_platform_account_id_touch_date_key" ON "account_touch_quotas"("user_id", "platform", "account_id", "touch_date");
CREATE INDEX "account_touch_quotas_user_id_platform_account_id_idx" ON "account_touch_quotas"("user_id", "platform", "account_id");
