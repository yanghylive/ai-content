-- CreateTable
CREATE TABLE "boss_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Boss 直聘',
    "loginStatus" TEXT NOT NULL DEFAULT 'unknown',
    "storage_state_path" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boss_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boss_candidates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "job_title" TEXT,
    "wechat_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boss_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boss_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boss_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_granted" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_consumed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boss_accounts_user_id_idx" ON "boss_accounts"("user_id");

-- CreateIndex
CREATE INDEX "boss_candidates_user_id_idx" ON "boss_candidates"("user_id");

-- CreateIndex
CREATE INDEX "boss_candidates_account_id_idx" ON "boss_candidates"("account_id");

-- CreateIndex
CREATE INDEX "boss_tasks_user_id_idx" ON "boss_tasks"("user_id");

-- CreateIndex
CREATE INDEX "boss_tasks_account_id_idx" ON "boss_tasks"("account_id");

-- CreateIndex
CREATE INDEX "boss_tasks_status_idx" ON "boss_tasks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_accounts_tenant_id_user_id_key" ON "ai_credit_accounts"("tenant_id", "user_id");
