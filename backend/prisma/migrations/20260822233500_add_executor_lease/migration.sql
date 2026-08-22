-- P1 Lease：账号级外发租约（PRD §5），防同账号并发外发
CREATE TABLE "executor_leases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "executor_leases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "executor_leases_user_id_account_id_status_idx" ON "executor_leases"("user_id", "account_id", "status");
CREATE INDEX "executor_leases_task_id_idx" ON "executor_leases"("task_id");
