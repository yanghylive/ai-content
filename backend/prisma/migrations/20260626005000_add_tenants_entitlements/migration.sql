-- SaaS tenant foundation: persistent default tenants, memberships, and tenant-level entitlement snapshots.

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "owner_user_id" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tenant_members" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "status" TEXT NOT NULL DEFAULT 'active',
  "permissions" JSONB NOT NULL DEFAULT '[]',
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tenant_entitlements" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "plan" TEXT NOT NULL DEFAULT 'FREE',
  "status" TEXT NOT NULL DEFAULT 'active',
  "features" JSONB NOT NULL DEFAULT '[]',
  "commercial_execution_allowed" BOOLEAN NOT NULL DEFAULT false,
  "external_subscription_id" TEXT,
  "period_start" TIMESTAMP(3),
  "period_end" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX IF NOT EXISTS "tenants_owner_user_id_idx" ON "tenants"("owner_user_id");
CREATE INDEX IF NOT EXISTS "tenants_status_idx" ON "tenants"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_members_tenant_id_user_id_key" ON "tenant_members"("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "tenant_members_tenant_id_idx" ON "tenant_members"("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_members_user_id_idx" ON "tenant_members"("user_id");
CREATE INDEX IF NOT EXISTS "tenant_members_role_idx" ON "tenant_members"("role");
CREATE INDEX IF NOT EXISTS "tenant_members_status_idx" ON "tenant_members"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_entitlements_tenant_id_source_key" ON "tenant_entitlements"("tenant_id", "source");
CREATE INDEX IF NOT EXISTS "tenant_entitlements_tenant_id_idx" ON "tenant_entitlements"("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_entitlements_source_idx" ON "tenant_entitlements"("source");
CREATE INDEX IF NOT EXISTS "tenant_entitlements_plan_idx" ON "tenant_entitlements"("plan");
CREATE INDEX IF NOT EXISTS "tenant_entitlements_status_idx" ON "tenant_entitlements"("status");
CREATE INDEX IF NOT EXISTS "tenant_entitlements_period_end_idx" ON "tenant_entitlements"("period_end");

DO $$ BEGIN
  ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_members"
    ADD CONSTRAINT "tenant_members_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_members"
    ADD CONSTRAINT "tenant_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_entitlements"
    ADD CONSTRAINT "tenant_entitlements_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
