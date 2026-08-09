CREATE TABLE IF NOT EXISTS "intelligence_reports" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "audience" TEXT,
  "owner" TEXT,
  "range_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "completeness" INTEGER NOT NULL DEFAULT 0,
  "findings" JSONB NOT NULL DEFAULT '[]',
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "markdown" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intelligence_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "intelligence_reports_tenant_id_status_idx" ON "intelligence_reports"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "intelligence_reports_user_id_status_idx" ON "intelligence_reports"("user_id", "status");
CREATE INDEX IF NOT EXISTS "intelligence_reports_kind_idx" ON "intelligence_reports"("kind");
CREATE INDEX IF NOT EXISTS "intelligence_reports_updated_at_idx" ON "intelligence_reports"("updated_at");

DO $$ BEGIN
  ALTER TABLE "intelligence_reports" ADD CONSTRAINT "intelligence_reports_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_reports" ADD CONSTRAINT "intelligence_reports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
