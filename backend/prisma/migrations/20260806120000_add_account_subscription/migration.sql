-- 竞品账号订阅（A6/M5）：用户订阅竞品账号 → cron 每日抓取 → 变化检测
CREATE TABLE "account_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'douyin',
    "account_id" TEXT NOT NULL,
    "account_name" TEXT,
    "account_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_fetched_at" TIMESTAMP(3),
    "last_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_subscriptions_user_id_platform_account_id_key"
    ON "account_subscriptions"("user_id", "platform", "account_id");

CREATE INDEX "account_subscriptions_tenant_id_user_id_idx"
    ON "account_subscriptions"("tenant_id", "user_id");
