-- P2-27 平台账号实体
CREATE TABLE "platform_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "nickname" TEXT,
    "login_status" TEXT NOT NULL DEFAULT 'unknown',
    "bound_device_id" TEXT,
    "risk_status" TEXT NOT NULL DEFAULT 'normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_accounts_user_id_platform_account_id_key" ON "platform_accounts"("user_id", "platform", "account_id");
CREATE INDEX "platform_accounts_user_id_idx" ON "platform_accounts"("user_id");
