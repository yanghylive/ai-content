-- Billing invoice audit: paid/failed invoice evidence for renewal and dunning flows.

CREATE TABLE IF NOT EXISTS "billing_invoices" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_invoice_id" TEXT NOT NULL,
  "external_customer_id" TEXT,
  "external_subscription_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "amount_due" INTEGER NOT NULL DEFAULT 0,
  "amount_paid" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "hosted_invoice_url" TEXT,
  "invoice_pdf_url" TEXT,
  "attempted_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "latest_webhook_event_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_provider_external_invoice_id_key"
  ON "billing_invoices"("provider", "external_invoice_id");
CREATE INDEX IF NOT EXISTS "billing_invoices_tenant_id_idx" ON "billing_invoices"("tenant_id");
CREATE INDEX IF NOT EXISTS "billing_invoices_provider_idx" ON "billing_invoices"("provider");
CREATE INDEX IF NOT EXISTS "billing_invoices_status_idx" ON "billing_invoices"("status");
CREATE INDEX IF NOT EXISTS "billing_invoices_external_customer_id_idx" ON "billing_invoices"("external_customer_id");
CREATE INDEX IF NOT EXISTS "billing_invoices_external_subscription_id_idx" ON "billing_invoices"("external_subscription_id");
CREATE INDEX IF NOT EXISTS "billing_invoices_paid_at_idx" ON "billing_invoices"("paid_at");
CREATE INDEX IF NOT EXISTS "billing_invoices_failed_at_idx" ON "billing_invoices"("failed_at");

DO $$ BEGIN
  ALTER TABLE "billing_invoices"
    ADD CONSTRAINT "billing_invoices_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
