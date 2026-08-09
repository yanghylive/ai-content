-- CreateTable: F7 账号体检 30 天报告历史快照
-- 每次体检追加快照（GrowthAccountHealthSnapshot），支持 30 天趋势聚合
CREATE TABLE "growth_account_health_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "platform" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "login_status" TEXT NOT NULL,
    "today_action_count" INTEGER NOT NULL DEFAULT 0,
    "failure_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "risk_status" TEXT NOT NULL,
    "cooldown_until" TIMESTAMP(3),
    "recommendation" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_account_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growth_account_health_snapshots_user_id_platform_account_i_idx" ON "growth_account_health_snapshots"("user_id", "platform", "account_id", "checked_at");

-- CreateIndex
CREATE INDEX "growth_account_health_snapshots_tenant_id_platform_account_idx" ON "growth_account_health_snapshots"("tenant_id", "platform", "account_id");

-- AddForeignKey（生产库租户表名为 tenants——Tenant 模型 @map）
ALTER TABLE "growth_account_health_snapshots" ADD CONSTRAINT "growth_account_health_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
