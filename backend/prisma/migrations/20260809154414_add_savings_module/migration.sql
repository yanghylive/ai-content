-- CreateTable
CREATE TABLE "wecom_corp_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '企业微信',
    "corp_id" TEXT NOT NULL,
    "encrypted_corp_secret" TEXT NOT NULL,
    "agent_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "callback_token" TEXT,
    "callback_encoding_aes_key" TEXT,
    "callback_url" TEXT,
    "callback_url_verified_at" TIMESTAMP(3),
    "last_token_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wecom_corp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wecom_group_msg_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "msg_type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "external_user_ids" JSONB NOT NULL,
    "sender_ids" JSONB NOT NULL,
    "wecom_msg_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wecom_group_msg_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wecom_moment_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "text" TEXT,
    "attachments" JSONB,
    "visible_range" JSONB,
    "wecom_job_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wecom_moment_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wecom_contacts" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "name" TEXT DEFAULT '',
    "avatar" TEXT,
    "type" TEXT DEFAULT '',
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wecom_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cps_platforms" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settleDays" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cps_platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cps_vendors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "app_key_enc" TEXT NOT NULL,
    "app_secret_enc" TEXT NOT NULL,
    "pid" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cps_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_masters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "spec" TEXT,
    "unit" TEXT,
    "unit_qty" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_snapshots" (
    "id" TEXT NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shop_name" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "coupon_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pay_price" DECIMAL(10,2) NOT NULL,
    "commission_rate" DOUBLE PRECISION NOT NULL,
    "est_commission" DECIMAL(10,2) NOT NULL,
    "freight" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "raw_json" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_watches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "target_pay_price" DECIMAL(10,2),
    "target_unit_price" DECIMAL(10,2),
    "min_rebate" DECIMAL(10,2),
    "notify_windows" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cps_promo_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "promo_url" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attribution" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cps_promo_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cps_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "item_id" TEXT,
    "pay_amount" DECIMAL(10,2) NOT NULL,
    "est_commission" DECIMAL(10,2) NOT NULL,
    "act_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "user_rebate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "platform_share" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "refund_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "raw_status" TEXT,
    "sync_checkpoint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cps_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "available" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pending" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "frozen" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_earned" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rebate_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_ledgers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "biz_type" TEXT NOT NULL,
    "biz_no" TEXT NOT NULL,
    "before_amount" DECIMAL(10,2) NOT NULL,
    "change_amount" DECIMAL(10,2) NOT NULL,
    "after_amount" DECIMAL(10,2) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rebate_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_withdrawals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "channel" TEXT NOT NULL,
    "account_mask" TEXT NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "actual_amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "external_no" TEXT,
    "fail_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rebate_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_exchanges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rebate_amount" DECIMAL(10,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "credit_amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "credit_order_no" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rebate_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_lists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "owner" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wecom_corp_configs_user_id_idx" ON "wecom_corp_configs"("user_id");

-- CreateIndex
CREATE INDEX "wecom_corp_configs_status_idx" ON "wecom_corp_configs"("status");

-- CreateIndex
CREATE INDEX "wecom_group_msg_tasks_user_id_idx" ON "wecom_group_msg_tasks"("user_id");

-- CreateIndex
CREATE INDEX "wecom_group_msg_tasks_config_id_idx" ON "wecom_group_msg_tasks"("config_id");

-- CreateIndex
CREATE INDEX "wecom_group_msg_tasks_wecom_msg_id_idx" ON "wecom_group_msg_tasks"("wecom_msg_id");

-- CreateIndex
CREATE INDEX "wecom_moment_tasks_user_id_idx" ON "wecom_moment_tasks"("user_id");

-- CreateIndex
CREATE INDEX "wecom_moment_tasks_config_id_idx" ON "wecom_moment_tasks"("config_id");

-- CreateIndex
CREATE INDEX "wecom_moment_tasks_wecom_job_id_idx" ON "wecom_moment_tasks"("wecom_job_id");

-- CreateIndex
CREATE INDEX "wecom_contacts_config_id_idx" ON "wecom_contacts"("config_id");

-- CreateIndex
CREATE UNIQUE INDEX "wecom_contacts_config_id_external_user_id_key" ON "wecom_contacts"("config_id", "external_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cps_platforms_code_key" ON "cps_platforms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cps_vendors_code_key" ON "cps_vendors"("code");

-- CreateIndex
CREATE INDEX "offer_snapshots_vendor_code_platform_code_item_id_idx" ON "offer_snapshots"("vendor_code", "platform_code", "item_id");

-- CreateIndex
CREATE INDEX "price_watches_tenant_id_user_id_status_idx" ON "price_watches"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cps_promo_links_idempotency_key_key" ON "cps_promo_links"("idempotency_key");

-- CreateIndex
CREATE INDEX "cps_promo_links_tenant_id_user_id_idx" ON "cps_promo_links"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "cps_orders_tenant_id_user_id_status_idx" ON "cps_orders"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cps_orders_vendor_code_order_no_key" ON "cps_orders"("vendor_code", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "rebate_accounts_tenant_id_user_id_key" ON "rebate_accounts"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "rebate_ledgers_idempotency_key_key" ON "rebate_ledgers"("idempotency_key");

-- CreateIndex
CREATE INDEX "rebate_ledgers_tenant_id_user_id_created_at_idx" ON "rebate_ledgers"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rebate_withdrawals_idempotency_key_key" ON "rebate_withdrawals"("idempotency_key");

-- CreateIndex
CREATE INDEX "rebate_withdrawals_tenant_id_user_id_status_idx" ON "rebate_withdrawals"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rebate_exchanges_idempotency_key_key" ON "rebate_exchanges"("idempotency_key");

-- CreateIndex
CREATE INDEX "rebate_exchanges_tenant_id_user_id_idx" ON "rebate_exchanges"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "procurement_lists_tenant_id_user_id_idx" ON "procurement_lists"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "wecom_group_msg_tasks" ADD CONSTRAINT "wecom_group_msg_tasks_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "wecom_corp_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wecom_moment_tasks" ADD CONSTRAINT "wecom_moment_tasks_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "wecom_corp_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wecom_contacts" ADD CONSTRAINT "wecom_contacts_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "wecom_corp_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
