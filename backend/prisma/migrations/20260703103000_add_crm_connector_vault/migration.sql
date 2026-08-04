CREATE TABLE IF NOT EXISTS "crm_connector_vault_records" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "connector_key" TEXT NOT NULL,
  "credential_kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "encrypted_secret" TEXT NOT NULL,
  "secret_hash" TEXT NOT NULL,
  "key_fingerprint" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "quarantined_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_connector_vault_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_connector_vault_handles" (
  "id" TEXT NOT NULL,
  "vault_record_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "connector_key" TEXT NOT NULL,
  "credential_kind" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "key_fingerprint" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_connector_vault_handles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_connector_vault_handles_handle_key"
  ON "crm_connector_vault_handles"("handle");

CREATE INDEX IF NOT EXISTS "crm_connector_vault_records_owner_idx"
  ON "crm_connector_vault_records"("owner_id", "connector_key", "status");

CREATE INDEX IF NOT EXISTS "crm_connector_vault_records_tenant_idx"
  ON "crm_connector_vault_records"("tenant_id", "connector_key", "status");

CREATE INDEX IF NOT EXISTS "crm_connector_vault_handles_owner_idx"
  ON "crm_connector_vault_handles"("owner_id", "connector_key", "status");

ALTER TABLE "crm_connector_vault_handles"
  ADD CONSTRAINT "crm_connector_vault_handles_vault_record_id_fkey"
  FOREIGN KEY ("vault_record_id")
  REFERENCES "crm_connector_vault_records"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
