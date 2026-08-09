CREATE TABLE IF NOT EXISTS "redfox_interfaces" (
  "id" TEXT NOT NULL,
  "platform_code" TEXT NOT NULL,
  "platform_name" TEXT,
  "interface_no" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "scenario" TEXT,
  "status" TEXT NOT NULL DEFAULT 'online',
  "category" TEXT,
  "description" TEXT,
  "price" DOUBLE PRECISION,
  "min_price" DOUBLE PRECISION,
  "require_auth" BOOLEAN NOT NULL DEFAULT true,
  "parameters" JSONB,
  "examples" JSONB,
  "raw" JSONB,
  "synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "redfox_interfaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "redfox_interfaces_interface_no_key" ON "redfox_interfaces"("interface_no");
CREATE UNIQUE INDEX IF NOT EXISTS "redfox_interfaces_code_key" ON "redfox_interfaces"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "redfox_interfaces_platform_code_path_method_key" ON "redfox_interfaces"("platform_code", "path", "method");
CREATE INDEX IF NOT EXISTS "redfox_interfaces_platform_code_idx" ON "redfox_interfaces"("platform_code");
CREATE INDEX IF NOT EXISTS "redfox_interfaces_path_idx" ON "redfox_interfaces"("path");
CREATE INDEX IF NOT EXISTS "redfox_interfaces_scenario_idx" ON "redfox_interfaces"("scenario");
CREATE INDEX IF NOT EXISTS "redfox_interfaces_status_idx" ON "redfox_interfaces"("status");
CREATE INDEX IF NOT EXISTS "redfox_interfaces_synced_at_idx" ON "redfox_interfaces"("synced_at");
