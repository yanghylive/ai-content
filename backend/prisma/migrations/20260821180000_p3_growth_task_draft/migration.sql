CREATE TABLE "growth_task_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop',
    "user_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "intent" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "platform" TEXT,
    "account_id" TEXT,
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "planned_actions" JSONB NOT NULL DEFAULT '[]',
    "missing_fields" JSONB NOT NULL DEFAULT '[]',
    "readiness" TEXT NOT NULL DEFAULT 'needs-input',
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "draft_hash" TEXT,
    "risk_summary" TEXT,
    "config_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_task_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growth_task_drafts_user_id_status_idx" ON "growth_task_drafts"("user_id", "status");

-- CreateIndex
CREATE INDEX "growth_task_drafts_tenant_id_status_idx" ON "growth_task_drafts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "growth_task_drafts_intent_status_idx" ON "growth_task_drafts"("intent", "status");

-- AddForeignKey
