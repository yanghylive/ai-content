-- AlterTable
ALTER TABLE "materials"
ADD COLUMN "hasImage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "image_url" TEXT,
ADD COLUMN "original_image_url" TEXT;

-- CreateTable
CREATE TABLE "schedule_configs" (
    "id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "cron_expr" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "last_run_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_accounts" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "app_id" TEXT,
    "api_token" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publish_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_records" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "publish_url" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publish_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_configs_task_type_key" ON "schedule_configs"("task_type");

-- CreateIndex
CREATE INDEX "publish_records_article_id_idx" ON "publish_records"("article_id");

-- CreateIndex
CREATE INDEX "publish_records_account_id_idx" ON "publish_records"("account_id");

-- CreateIndex
CREATE INDEX "publish_records_status_idx" ON "publish_records"("status");

-- CreateIndex
CREATE INDEX "materials_hasImage_idx" ON "materials"("hasImage");

-- AddForeignKey
ALTER TABLE "publish_records"
ADD CONSTRAINT "publish_records_article_id_fkey"
FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_records"
ADD CONSTRAINT "publish_records_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "publish_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
