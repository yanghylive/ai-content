CREATE TABLE IF NOT EXISTS "redfox_connections" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'RedFox',
  "api_key_encrypted" TEXT NOT NULL,
  "api_key_masked" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "daily_call_limit" INTEGER,
  "daily_cost_limit" INTEGER,
  "last_test_at" TIMESTAMP(3),
  "last_error" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "redfox_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "redfox_skills" (
  "id" TEXT NOT NULL,
  "skill_no" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" TEXT,
  "category" TEXT,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "summary" TEXT,
  "description" TEXT,
  "input_schema" JSONB,
  "output_schema" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active',
  "raw" JSONB,
  "synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "redfox_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "redfox_skill_installs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "scenario" TEXT NOT NULL DEFAULT 'general',
  "config" JSONB,
  "usage_policy" JSONB,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "redfox_skill_installs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "redfox_call_logs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "connection_id" TEXT,
  "skill_id" TEXT,
  "skill_code" TEXT,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "http_status" INTEGER,
  "cost_points" INTEGER NOT NULL DEFAULT 0,
  "latency_ms" INTEGER,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "request_hash" TEXT,
  "request_summary" JSONB,
  "response_summary" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "redfox_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "source_id" TEXT,
  "redfox_skill_id" TEXT,
  "redfox_call_log_id" TEXT,
  "material_id" TEXT,
  "topic_id" TEXT,
  "growth_lead_id" TEXT,
  "platform" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "summary" TEXT,
  "source_url" TEXT,
  "source_external_id" TEXT,
  "author" TEXT,
  "author_url" TEXT,
  "publish_date" TIMESTAMP(3),
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "keywords" JSONB NOT NULL DEFAULT '[]',
  "raw" JSONB,
  "status" TEXT NOT NULL DEFAULT 'new',
  "dedupe_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intelligence_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "benchmark_accounts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "intelligence_item_id" TEXT,
  "growth_lead_id" TEXT,
  "platform" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "external_user_id" TEXT,
  "profile_url" TEXT,
  "avatar_url" TEXT,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "reason" TEXT,
  "diagnosis" JSONB,
  "status" TEXT NOT NULL DEFAULT 'watching',
  "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "benchmark_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_monitors" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "skill_install_id" TEXT,
  "type" TEXT NOT NULL,
  "platform" TEXT,
  "keyword" TEXT,
  "account_external_id" TEXT,
  "industry" TEXT,
  "schedule" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "config" JSONB,
  "cost_limit_points" INTEGER,
  "last_run_at" TIMESTAMP(3),
  "next_run_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intelligence_monitors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "compliance_checks" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "material_id" TEXT,
  "topic_id" TEXT,
  "redfox_call_log_id" TEXT,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "platform" TEXT NOT NULL,
  "risk_level" TEXT NOT NULL DEFAULT 'unknown',
  "status" TEXT NOT NULL DEFAULT 'completed',
  "findings" JSONB NOT NULL DEFAULT '[]',
  "suggestions" JSONB NOT NULL DEFAULT '[]',
  "raw" JSONB,
  "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "comment_insights" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "intelligence_item_id" TEXT,
  "growth_lead_id" TEXT,
  "redfox_call_log_id" TEXT,
  "platform" TEXT NOT NULL,
  "source_url" TEXT,
  "source_external_id" TEXT,
  "pain_points" JSONB NOT NULL DEFAULT '[]',
  "intent_keywords" JSONB NOT NULL DEFAULT '[]',
  "demand_signals" JSONB NOT NULL DEFAULT '[]',
  "objections" JSONB NOT NULL DEFAULT '[]',
  "reply_suggestions" JSONB NOT NULL DEFAULT '[]',
  "raw" JSONB,
  "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comment_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "redfox_connections_tenant_id_user_id_key" ON "redfox_connections"("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "redfox_connections_user_id_idx" ON "redfox_connections"("user_id");
CREATE INDEX IF NOT EXISTS "redfox_connections_tenant_id_idx" ON "redfox_connections"("tenant_id");
CREATE INDEX IF NOT EXISTS "redfox_connections_status_idx" ON "redfox_connections"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "redfox_skills_skill_no_key" ON "redfox_skills"("skill_no");
CREATE UNIQUE INDEX IF NOT EXISTS "redfox_skills_code_key" ON "redfox_skills"("code");
CREATE INDEX IF NOT EXISTS "redfox_skills_platform_idx" ON "redfox_skills"("platform");
CREATE INDEX IF NOT EXISTS "redfox_skills_category_idx" ON "redfox_skills"("category");
CREATE INDEX IF NOT EXISTS "redfox_skills_status_idx" ON "redfox_skills"("status");
CREATE INDEX IF NOT EXISTS "redfox_skills_synced_at_idx" ON "redfox_skills"("synced_at");

CREATE UNIQUE INDEX IF NOT EXISTS "redfox_skill_installs_tenant_id_skill_id_scenario_key" ON "redfox_skill_installs"("tenant_id", "skill_id", "scenario");
CREATE UNIQUE INDEX IF NOT EXISTS "redfox_skill_installs_user_id_skill_id_scenario_key" ON "redfox_skill_installs"("user_id", "skill_id", "scenario");
CREATE INDEX IF NOT EXISTS "redfox_skill_installs_tenant_id_enabled_idx" ON "redfox_skill_installs"("tenant_id", "enabled");
CREATE INDEX IF NOT EXISTS "redfox_skill_installs_user_id_enabled_idx" ON "redfox_skill_installs"("user_id", "enabled");
CREATE INDEX IF NOT EXISTS "redfox_skill_installs_skill_id_idx" ON "redfox_skill_installs"("skill_id");
CREATE INDEX IF NOT EXISTS "redfox_skill_installs_scenario_idx" ON "redfox_skill_installs"("scenario");

CREATE INDEX IF NOT EXISTS "redfox_call_logs_tenant_id_started_at_idx" ON "redfox_call_logs"("tenant_id", "started_at");
CREATE INDEX IF NOT EXISTS "redfox_call_logs_user_id_started_at_idx" ON "redfox_call_logs"("user_id", "started_at");
CREATE INDEX IF NOT EXISTS "redfox_call_logs_connection_id_idx" ON "redfox_call_logs"("connection_id");
CREATE INDEX IF NOT EXISTS "redfox_call_logs_skill_id_idx" ON "redfox_call_logs"("skill_id");
CREATE INDEX IF NOT EXISTS "redfox_call_logs_skill_code_idx" ON "redfox_call_logs"("skill_code");
CREATE INDEX IF NOT EXISTS "redfox_call_logs_endpoint_idx" ON "redfox_call_logs"("endpoint");
CREATE INDEX IF NOT EXISTS "redfox_call_logs_status_idx" ON "redfox_call_logs"("status");
CREATE INDEX IF NOT EXISTS "redfox_call_logs_request_hash_idx" ON "redfox_call_logs"("request_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_items_tenant_id_dedupe_key_key" ON "intelligence_items"("tenant_id", "dedupe_key");
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_items_user_id_dedupe_key_key" ON "intelligence_items"("user_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "intelligence_items_tenant_id_type_idx" ON "intelligence_items"("tenant_id", "type");
CREATE INDEX IF NOT EXISTS "intelligence_items_user_id_type_idx" ON "intelligence_items"("user_id", "type");
CREATE INDEX IF NOT EXISTS "intelligence_items_platform_idx" ON "intelligence_items"("platform");
CREATE INDEX IF NOT EXISTS "intelligence_items_status_idx" ON "intelligence_items"("status");
CREATE INDEX IF NOT EXISTS "intelligence_items_source_id_idx" ON "intelligence_items"("source_id");
CREATE INDEX IF NOT EXISTS "intelligence_items_redfox_skill_id_idx" ON "intelligence_items"("redfox_skill_id");
CREATE INDEX IF NOT EXISTS "intelligence_items_redfox_call_log_id_idx" ON "intelligence_items"("redfox_call_log_id");
CREATE INDEX IF NOT EXISTS "intelligence_items_material_id_idx" ON "intelligence_items"("material_id");
CREATE INDEX IF NOT EXISTS "intelligence_items_topic_id_idx" ON "intelligence_items"("topic_id");
CREATE INDEX IF NOT EXISTS "intelligence_items_growth_lead_id_idx" ON "intelligence_items"("growth_lead_id");
CREATE INDEX IF NOT EXISTS "intelligence_items_created_at_idx" ON "intelligence_items"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "benchmark_accounts_tenant_id_platform_external_user_id_key" ON "benchmark_accounts"("tenant_id", "platform", "external_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "benchmark_accounts_user_id_platform_external_user_id_key" ON "benchmark_accounts"("user_id", "platform", "external_user_id");
CREATE INDEX IF NOT EXISTS "benchmark_accounts_tenant_id_status_idx" ON "benchmark_accounts"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "benchmark_accounts_user_id_status_idx" ON "benchmark_accounts"("user_id", "status");
CREATE INDEX IF NOT EXISTS "benchmark_accounts_platform_idx" ON "benchmark_accounts"("platform");
CREATE INDEX IF NOT EXISTS "benchmark_accounts_intelligence_item_id_idx" ON "benchmark_accounts"("intelligence_item_id");
CREATE INDEX IF NOT EXISTS "benchmark_accounts_growth_lead_id_idx" ON "benchmark_accounts"("growth_lead_id");

CREATE INDEX IF NOT EXISTS "intelligence_monitors_tenant_id_status_idx" ON "intelligence_monitors"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "intelligence_monitors_user_id_status_idx" ON "intelligence_monitors"("user_id", "status");
CREATE INDEX IF NOT EXISTS "intelligence_monitors_skill_install_id_idx" ON "intelligence_monitors"("skill_install_id");
CREATE INDEX IF NOT EXISTS "intelligence_monitors_type_idx" ON "intelligence_monitors"("type");
CREATE INDEX IF NOT EXISTS "intelligence_monitors_platform_idx" ON "intelligence_monitors"("platform");
CREATE INDEX IF NOT EXISTS "intelligence_monitors_keyword_idx" ON "intelligence_monitors"("keyword");
CREATE INDEX IF NOT EXISTS "intelligence_monitors_next_run_at_idx" ON "intelligence_monitors"("next_run_at");

CREATE INDEX IF NOT EXISTS "compliance_checks_tenant_id_checked_at_idx" ON "compliance_checks"("tenant_id", "checked_at");
CREATE INDEX IF NOT EXISTS "compliance_checks_user_id_checked_at_idx" ON "compliance_checks"("user_id", "checked_at");
CREATE INDEX IF NOT EXISTS "compliance_checks_material_id_idx" ON "compliance_checks"("material_id");
CREATE INDEX IF NOT EXISTS "compliance_checks_topic_id_idx" ON "compliance_checks"("topic_id");
CREATE INDEX IF NOT EXISTS "compliance_checks_redfox_call_log_id_idx" ON "compliance_checks"("redfox_call_log_id");
CREATE INDEX IF NOT EXISTS "compliance_checks_target_type_target_id_idx" ON "compliance_checks"("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "compliance_checks_platform_idx" ON "compliance_checks"("platform");
CREATE INDEX IF NOT EXISTS "compliance_checks_risk_level_idx" ON "compliance_checks"("risk_level");
CREATE INDEX IF NOT EXISTS "compliance_checks_status_idx" ON "compliance_checks"("status");

CREATE INDEX IF NOT EXISTS "comment_insights_tenant_id_analyzed_at_idx" ON "comment_insights"("tenant_id", "analyzed_at");
CREATE INDEX IF NOT EXISTS "comment_insights_user_id_analyzed_at_idx" ON "comment_insights"("user_id", "analyzed_at");
CREATE INDEX IF NOT EXISTS "comment_insights_intelligence_item_id_idx" ON "comment_insights"("intelligence_item_id");
CREATE INDEX IF NOT EXISTS "comment_insights_growth_lead_id_idx" ON "comment_insights"("growth_lead_id");
CREATE INDEX IF NOT EXISTS "comment_insights_redfox_call_log_id_idx" ON "comment_insights"("redfox_call_log_id");
CREATE INDEX IF NOT EXISTS "comment_insights_platform_idx" ON "comment_insights"("platform");

DO $$ BEGIN
  ALTER TABLE "redfox_connections" ADD CONSTRAINT "redfox_connections_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_connections" ADD CONSTRAINT "redfox_connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_skill_installs" ADD CONSTRAINT "redfox_skill_installs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_skill_installs" ADD CONSTRAINT "redfox_skill_installs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_skill_installs" ADD CONSTRAINT "redfox_skill_installs_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "redfox_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_call_logs" ADD CONSTRAINT "redfox_call_logs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_call_logs" ADD CONSTRAINT "redfox_call_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_call_logs" ADD CONSTRAINT "redfox_call_logs_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "redfox_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "redfox_call_logs" ADD CONSTRAINT "redfox_call_logs_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "redfox_skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_redfox_skill_id_fkey"
    FOREIGN KEY ("redfox_skill_id") REFERENCES "redfox_skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_redfox_call_log_id_fkey"
    FOREIGN KEY ("redfox_call_log_id") REFERENCES "redfox_call_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_items" ADD CONSTRAINT "intelligence_items_growth_lead_id_fkey"
    FOREIGN KEY ("growth_lead_id") REFERENCES "growth_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "benchmark_accounts" ADD CONSTRAINT "benchmark_accounts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "benchmark_accounts" ADD CONSTRAINT "benchmark_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "benchmark_accounts" ADD CONSTRAINT "benchmark_accounts_intelligence_item_id_fkey"
    FOREIGN KEY ("intelligence_item_id") REFERENCES "intelligence_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "benchmark_accounts" ADD CONSTRAINT "benchmark_accounts_growth_lead_id_fkey"
    FOREIGN KEY ("growth_lead_id") REFERENCES "growth_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_monitors" ADD CONSTRAINT "intelligence_monitors_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_monitors" ADD CONSTRAINT "intelligence_monitors_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_monitors" ADD CONSTRAINT "intelligence_monitors_skill_install_id_fkey"
    FOREIGN KEY ("skill_install_id") REFERENCES "redfox_skill_installs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_redfox_call_log_id_fkey"
    FOREIGN KEY ("redfox_call_log_id") REFERENCES "redfox_call_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "comment_insights" ADD CONSTRAINT "comment_insights_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "comment_insights" ADD CONSTRAINT "comment_insights_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "comment_insights" ADD CONSTRAINT "comment_insights_intelligence_item_id_fkey"
    FOREIGN KEY ("intelligence_item_id") REFERENCES "intelligence_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "comment_insights" ADD CONSTRAINT "comment_insights_growth_lead_id_fkey"
    FOREIGN KEY ("growth_lead_id") REFERENCES "growth_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "comment_insights" ADD CONSTRAINT "comment_insights_redfox_call_log_id_fkey"
    FOREIGN KEY ("redfox_call_log_id") REFERENCES "redfox_call_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
