-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "platform" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_task_id" TEXT,
    "source_run_id" TEXT,
    "source_url" TEXT,
    "source_text" TEXT,
    "external_user_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "nickname" TEXT,
    "profile_url" TEXT,
    "avatar_url" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "score_reasons" JSONB NOT NULL DEFAULT '[]',
    "matched_keywords" JSONB NOT NULL DEFAULT '[]',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "latest_reply" TEXT,
    "reply_persona_id" TEXT,
    "replied_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "customer_id" TEXT,
    "evidence_urls" JSONB NOT NULL DEFAULT '[]',
    "owner_user_id" TEXT,
    "next_follow_up_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_dedupe_key_key" ON "leads"("tenant_id", "dedupe_key");
CREATE UNIQUE INDEX "leads_user_id_dedupe_key_key" ON "leads"("user_id", "dedupe_key");
CREATE INDEX "leads_user_id_status_idx" ON "leads"("user_id", "status");
CREATE INDEX "leads_tenant_id_platform_idx" ON "leads"("tenant_id", "platform");
CREATE INDEX "leads_source_task_id_idx" ON "leads"("source_task_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
