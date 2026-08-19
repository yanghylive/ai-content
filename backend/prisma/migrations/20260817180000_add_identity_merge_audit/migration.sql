-- CreateTable
CREATE TABLE "identity_merge_audits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'legacy-local-desktop',
    "user_id" TEXT NOT NULL DEFAULT 'legacy-local-user',
    "target_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "migrated_event_ids" JSONB NOT NULL DEFAULT '[]',
    "migrated_content_ids" JSONB NOT NULL DEFAULT '[]',
    "field_choices" JSONB,
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "reverted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_merge_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_merge_audits_tenant_id_created_at_idx" ON "identity_merge_audits"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "identity_merge_audits_source_id_idx" ON "identity_merge_audits"("source_id");
