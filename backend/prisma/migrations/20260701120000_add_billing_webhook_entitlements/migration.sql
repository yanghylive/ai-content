-- Commercial billing foundation: idempotent webhook events and tenant subscription snapshots.

CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_customer_id" TEXT,
  "external_subscription_id" TEXT NOT NULL,
  "plan" TEXT NOT NULL DEFAULT 'FREE',
  "status" TEXT NOT NULL DEFAULT 'inactive',
  "current_period_start" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "latest_webhook_event_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "tenant_id" TEXT,
  "external_customer_id" TEXT,
  "external_subscription_id" TEXT,
  "signature_verified" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'received',
  "error_message" TEXT,
  "processed_at" TIMESTAMP(3),
  "payload" JSONB NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_provider_external_subscription_id_key"
  ON "billing_subscriptions"("provider", "external_subscription_id");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_tenant_id_idx" ON "billing_subscriptions"("tenant_id");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_provider_idx" ON "billing_subscriptions"("provider");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_status_idx" ON "billing_subscriptions"("status");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_plan_idx" ON "billing_subscriptions"("plan");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_current_period_end_idx" ON "billing_subscriptions"("current_period_end");

CREATE UNIQUE INDEX IF NOT EXISTS "billing_webhook_events_provider_event_id_key"
  ON "billing_webhook_events"("provider", "event_id");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_tenant_id_idx" ON "billing_webhook_events"("tenant_id");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_provider_idx" ON "billing_webhook_events"("provider");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_event_type_idx" ON "billing_webhook_events"("event_type");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_status_idx" ON "billing_webhook_events"("status");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_external_customer_id_idx" ON "billing_webhook_events"("external_customer_id");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_external_subscription_id_idx" ON "billing_webhook_events"("external_subscription_id");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_processed_at_idx" ON "billing_webhook_events"("processed_at");

DO $$ BEGIN
  ALTER TABLE "billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
