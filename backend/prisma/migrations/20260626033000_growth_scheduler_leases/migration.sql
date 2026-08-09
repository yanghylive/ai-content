CREATE TABLE IF NOT EXISTS "growth_scheduler_leases" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "locked_until" TIMESTAMP(3) NOT NULL,
  "heartbeat_at" TIMESTAMP(3),
  "last_run_at" TIMESTAMP(3),
  "cursor" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "growth_scheduler_leases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "growth_scheduler_leases_tenant_id_idx" ON "growth_scheduler_leases"("tenant_id");
CREATE INDEX IF NOT EXISTS "growth_scheduler_leases_user_id_idx" ON "growth_scheduler_leases"("user_id");
CREATE INDEX IF NOT EXISTS "growth_scheduler_leases_locked_until_idx" ON "growth_scheduler_leases"("locked_until");

DO $$
BEGIN
  ALTER TABLE "growth_scheduler_leases" ADD CONSTRAINT "growth_scheduler_leases_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
