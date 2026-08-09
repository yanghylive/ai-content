-- Tenant-scoped App Market state. Legacy user_id records remain valid and are backfilled lazily.

ALTER TABLE "app_install_states"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "actor_user_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "app_install_states_tenant_id_app_key_key" ON "app_install_states"("tenant_id", "app_key");
CREATE INDEX IF NOT EXISTS "app_install_states_tenant_id_idx" ON "app_install_states"("tenant_id");
CREATE INDEX IF NOT EXISTS "app_install_states_actor_user_id_idx" ON "app_install_states"("actor_user_id");

DO $$ BEGIN
  ALTER TABLE "app_install_states"
    ADD CONSTRAINT "app_install_states_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
