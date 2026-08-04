-- CRM commercial audit chain: import batches and immutable-style audit events.

CREATE TABLE IF NOT EXISTS "crm_import_batches" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "source_type" TEXT NOT NULL,
  "filename" TEXT,
  "status" TEXT NOT NULL DEFAULT 'committed',
  "mode" TEXT NOT NULL DEFAULT 'local-crm-write',
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "committed_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "warning_count" INTEGER NOT NULL DEFAULT 0,
  "dry_run_id" TEXT,
  "dry_run_proof_hash" TEXT,
  "commit_proof_hash" TEXT NOT NULL,
  "rollback_token" TEXT NOT NULL,
  "rollback_proof_hash" TEXT,
  "rollback_reason" TEXT,
  "mapping" JSONB NOT NULL DEFAULT '{}',
  "quality_issues" JSONB NOT NULL DEFAULT '[]',
  "customer_ids" JSONB NOT NULL DEFAULT '[]',
  "write_tables" JSONB NOT NULL DEFAULT '[]',
  "external_network" BOOLEAN NOT NULL DEFAULT false,
  "external_crm_touched" BOOLEAN NOT NULL DEFAULT false,
  "committed_at" TIMESTAMP(3),
  "rolled_back_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_audit_events" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "import_batch_id" TEXT,
  "event_type" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'success',
  "proof_hash" TEXT,
  "external_network" BOOLEAN NOT NULL DEFAULT false,
  "external_crm_touched" BOOLEAN NOT NULL DEFAULT false,
  "write_tables" JSONB NOT NULL DEFAULT '[]',
  "read_tables" JSONB NOT NULL DEFAULT '[]',
  "summary" TEXT,
  "payload" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_import_batches_rollback_token_key" ON "crm_import_batches"("rollback_token");
CREATE INDEX IF NOT EXISTS "crm_import_batches_owner_id_idx" ON "crm_import_batches"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_import_batches_tenant_id_idx" ON "crm_import_batches"("tenant_id");
CREATE INDEX IF NOT EXISTS "crm_import_batches_source_type_idx" ON "crm_import_batches"("source_type");
CREATE INDEX IF NOT EXISTS "crm_import_batches_status_idx" ON "crm_import_batches"("status");
CREATE INDEX IF NOT EXISTS "crm_import_batches_commit_proof_hash_idx" ON "crm_import_batches"("commit_proof_hash");
CREATE INDEX IF NOT EXISTS "crm_import_batches_dry_run_id_idx" ON "crm_import_batches"("dry_run_id");
CREATE INDEX IF NOT EXISTS "crm_import_batches_committed_at_idx" ON "crm_import_batches"("committed_at");
CREATE INDEX IF NOT EXISTS "crm_import_batches_rolled_back_at_idx" ON "crm_import_batches"("rolled_back_at");

CREATE INDEX IF NOT EXISTS "crm_audit_events_owner_id_idx" ON "crm_audit_events"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_audit_events_tenant_id_idx" ON "crm_audit_events"("tenant_id");
CREATE INDEX IF NOT EXISTS "crm_audit_events_import_batch_id_idx" ON "crm_audit_events"("import_batch_id");
CREATE INDEX IF NOT EXISTS "crm_audit_events_event_type_idx" ON "crm_audit_events"("event_type");
CREATE INDEX IF NOT EXISTS "crm_audit_events_action_idx" ON "crm_audit_events"("action");
CREATE INDEX IF NOT EXISTS "crm_audit_events_status_idx" ON "crm_audit_events"("status");
CREATE INDEX IF NOT EXISTS "crm_audit_events_proof_hash_idx" ON "crm_audit_events"("proof_hash");
CREATE INDEX IF NOT EXISTS "crm_audit_events_created_at_idx" ON "crm_audit_events"("created_at");

DO $$ BEGIN
  ALTER TABLE "crm_import_batches"
    ADD CONSTRAINT "crm_import_batches_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_audit_events"
    ADD CONSTRAINT "crm_audit_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_audit_events"
    ADD CONSTRAINT "crm_audit_events_import_batch_id_fkey"
    FOREIGN KEY ("import_batch_id") REFERENCES "crm_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
