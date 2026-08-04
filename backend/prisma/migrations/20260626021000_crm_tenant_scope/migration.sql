-- Tenant-scoped CRM data. Legacy owner_id remains as actor/user audit and fallback scope.

ALTER TABLE "crm_customers"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "crm_companies"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "crm_opportunities"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "crm_tasks"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "crm_notes"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "crm_timeline_events"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "crm_customers_tenant_id_dedupe_key_key" ON "crm_customers"("tenant_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "crm_customers_tenant_id_idx" ON "crm_customers"("tenant_id");
CREATE INDEX IF NOT EXISTS "crm_companies_tenant_id_idx" ON "crm_companies"("tenant_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_tenant_id_idx" ON "crm_opportunities"("tenant_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_tenant_id_idx" ON "crm_tasks"("tenant_id");
CREATE INDEX IF NOT EXISTS "crm_notes_tenant_id_idx" ON "crm_notes"("tenant_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_tenant_id_idx" ON "crm_timeline_events"("tenant_id");

DO $$ BEGIN
  ALTER TABLE "crm_customers"
    ADD CONSTRAINT "crm_customers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_companies"
    ADD CONSTRAINT "crm_companies_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_tasks"
    ADD CONSTRAINT "crm_tasks_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_notes"
    ADD CONSTRAINT "crm_notes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_timeline_events"
    ADD CONSTRAINT "crm_timeline_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
