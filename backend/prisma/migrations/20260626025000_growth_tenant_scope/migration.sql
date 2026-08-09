ALTER TABLE "growth_strategies" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "growth_acquisition_configs" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "growth_acquisition_runs" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "growth_leads" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "growth_account_health" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "growth_workflows" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

CREATE INDEX IF NOT EXISTS "growth_strategies_tenant_id_idx" ON "growth_strategies"("tenant_id");
CREATE INDEX IF NOT EXISTS "growth_acquisition_configs_tenant_id_status_idx" ON "growth_acquisition_configs"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "growth_acquisition_configs_tenant_id_schedule_enabled_idx" ON "growth_acquisition_configs"("tenant_id", "schedule_enabled");
CREATE INDEX IF NOT EXISTS "growth_acquisition_runs_tenant_id_started_at_idx" ON "growth_acquisition_runs"("tenant_id", "started_at");
CREATE INDEX IF NOT EXISTS "growth_leads_tenant_id_status_idx" ON "growth_leads"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "growth_leads_tenant_id_platform_idx" ON "growth_leads"("tenant_id", "platform");
CREATE INDEX IF NOT EXISTS "growth_account_health_tenant_id_risk_status_idx" ON "growth_account_health"("tenant_id", "risk_status");
CREATE INDEX IF NOT EXISTS "growth_workflows_tenant_id_status_idx" ON "growth_workflows"("tenant_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "growth_account_health_tenant_id_platform_account_id_key" ON "growth_account_health"("tenant_id", "platform", "account_id");

DO $$
BEGIN
  ALTER TABLE "growth_strategies" ADD CONSTRAINT "growth_strategies_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  ALTER TABLE "growth_acquisition_configs" ADD CONSTRAINT "growth_acquisition_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  ALTER TABLE "growth_acquisition_runs" ADD CONSTRAINT "growth_acquisition_runs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  ALTER TABLE "growth_account_health" ADD CONSTRAINT "growth_account_health_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  ALTER TABLE "growth_workflows" ADD CONSTRAINT "growth_workflows_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
