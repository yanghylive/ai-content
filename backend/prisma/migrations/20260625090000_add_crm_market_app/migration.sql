-- CRM 应用市场与第一版客户资产模型
CREATE TABLE IF NOT EXISTS "app_install_states" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "app_key" TEXT NOT NULL,
  "purchase_status" TEXT NOT NULL DEFAULT 'not_purchased',
  "install_status" TEXT NOT NULL DEFAULT 'not_installed',
  "entitlement_snapshot" JSONB,
  "settings" JSONB,
  "purchased_at" TIMESTAMP(3),
  "installed_at" TIMESTAMP(3),
  "uninstalled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_install_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_customers" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "source_platform" TEXT,
  "source_keyword" TEXT,
  "matched_keyword" TEXT,
  "source_url" TEXT,
  "source_text" TEXT,
  "latest_reply" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "profile_url" TEXT,
  "external_user_id" TEXT,
  "dedupe_key" TEXT,
  "assigned_user_id" TEXT,
  "first_interaction_task_id" TEXT,
  "latest_interaction_task_id" TEXT,
  "metadata" JSONB,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_timeline_events" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "related_interaction_task_id" TEXT,
  "related_runtime_execution_id" TEXT,
  "event_type" TEXT NOT NULL,
  "channel" TEXT,
  "content" TEXT,
  "reply_content" TEXT,
  "status" TEXT,
  "failure_reason" TEXT,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_install_states_user_id_app_key_key" ON "app_install_states"("user_id", "app_key");
CREATE INDEX IF NOT EXISTS "app_install_states_user_id_idx" ON "app_install_states"("user_id");
CREATE INDEX IF NOT EXISTS "app_install_states_app_key_idx" ON "app_install_states"("app_key");
CREATE INDEX IF NOT EXISTS "app_install_states_purchase_status_idx" ON "app_install_states"("purchase_status");
CREATE INDEX IF NOT EXISTS "app_install_states_install_status_idx" ON "app_install_states"("install_status");

CREATE UNIQUE INDEX IF NOT EXISTS "crm_customers_owner_id_dedupe_key_key" ON "crm_customers"("owner_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "crm_customers_owner_id_idx" ON "crm_customers"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_customers_status_idx" ON "crm_customers"("status");
CREATE INDEX IF NOT EXISTS "crm_customers_source_platform_idx" ON "crm_customers"("source_platform");
CREATE INDEX IF NOT EXISTS "crm_customers_source_keyword_idx" ON "crm_customers"("source_keyword");
CREATE INDEX IF NOT EXISTS "crm_customers_updated_at_idx" ON "crm_customers"("updated_at");

CREATE INDEX IF NOT EXISTS "crm_timeline_events_owner_id_idx" ON "crm_timeline_events"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_customer_id_idx" ON "crm_timeline_events"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_related_interaction_task_id_idx" ON "crm_timeline_events"("related_interaction_task_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_related_runtime_execution_id_idx" ON "crm_timeline_events"("related_runtime_execution_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_event_type_idx" ON "crm_timeline_events"("event_type");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_created_at_idx" ON "crm_timeline_events"("created_at");

DO $$ BEGIN
  ALTER TABLE "crm_timeline_events"
    ADD CONSTRAINT "crm_timeline_events_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
