CREATE TABLE IF NOT EXISTS "growth_strategies" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "industry" TEXT NOT NULL,
  "scenario" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source_keywords" JSONB NOT NULL DEFAULT '[]',
  "demand_keywords" JSONB NOT NULL DEFAULT '[]',
  "exclude_keywords" JSONB NOT NULL DEFAULT '[]',
  "blacklist_nicknames" JSONB NOT NULL DEFAULT '[]',
  "comment_templates" JSONB NOT NULL DEFAULT '[]',
  "private_message_templates" JSONB NOT NULL DEFAULT '[]',
  "default_daily_limit" INTEGER NOT NULL DEFAULT 20,
  "default_risk_mode" TEXT NOT NULL DEFAULT 'confirm-first',
  "scoring_rules" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "growth_strategies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "growth_acquisition_configs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "mode" TEXT NOT NULL,
  "task_name" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "account_name" TEXT,
  "source_inputs" JSONB NOT NULL DEFAULT '[]',
  "include_keywords" JSONB NOT NULL DEFAULT '[]',
  "exclude_keywords" JSONB NOT NULL DEFAULT '[]',
  "blacklist_nicknames" JSONB NOT NULL DEFAULT '[]',
  "comment_templates" JSONB NOT NULL DEFAULT '[]',
  "private_message_templates" JSONB NOT NULL DEFAULT '[]',
  "daily_limit" INTEGER NOT NULL DEFAULT 20,
  "per_target_limit" INTEGER NOT NULL DEFAULT 1,
  "deduplicate" BOOLEAN NOT NULL DEFAULT true,
  "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
  "begin_time" TEXT NOT NULL DEFAULT '09:30',
  "risk_mode" TEXT NOT NULL DEFAULT 'confirm-first',
  "status" TEXT NOT NULL DEFAULT 'enabled',
  "exposure_count" INTEGER NOT NULL DEFAULT 0,
  "exposure_date" TEXT NOT NULL,
  "last_run_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "growth_acquisition_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "growth_acquisition_runs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "config_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "failure_reason" TEXT,
  "message" TEXT NOT NULL,
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "selected_count" INTEGER NOT NULL DEFAULT 0,
  "contacted_count" INTEGER NOT NULL DEFAULT 0,
  "crm_captured_count" INTEGER NOT NULL DEFAULT 0,
  "evidence_urls" JSONB NOT NULL DEFAULT '[]',
  "lead_ids" JSONB NOT NULL DEFAULT '[]',
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  CONSTRAINT "growth_acquisition_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "growth_leads" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "platform" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_task_id" TEXT,
  "source_run_id" TEXT,
  "crm_customer_id" TEXT,
  "nickname" TEXT NOT NULL,
  "profile_url" TEXT,
  "avatar_url" TEXT,
  "external_user_id" TEXT,
  "source_text" TEXT NOT NULL,
  "source_url" TEXT,
  "video_title" TEXT,
  "video_url" TEXT,
  "comment_time" TEXT,
  "matched_keywords" JSONB NOT NULL DEFAULT '[]',
  "score" INTEGER NOT NULL DEFAULT 0,
  "score_reasons" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'new',
  "next_follow_up_at" TIMESTAMP(3),
  "owner_user_id" TEXT,
  "notes" JSONB NOT NULL DEFAULT '[]',
  "evidence_urls" JSONB NOT NULL DEFAULT '[]',
  "latest_reply" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "growth_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "growth_account_health" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "platform" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "account_name" TEXT NOT NULL,
  "login_status" TEXT NOT NULL,
  "today_action_count" INTEGER NOT NULL DEFAULT 0,
  "failure_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "risk_status" TEXT NOT NULL,
  "cooldown_until" TIMESTAMP(3),
  "recommendation" TEXT NOT NULL,
  "last_checked_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "growth_account_health_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "growth_workflows" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "name" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "current_step_id" TEXT,
  "last_action" TEXT,
  "last_action_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "growth_workflows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "growth_strategies_user_id_idx" ON "growth_strategies"("user_id");
CREATE INDEX IF NOT EXISTS "growth_strategies_tenant_id_idx" ON "growth_strategies"("tenant_id");
CREATE INDEX IF NOT EXISTS "growth_acquisition_configs_user_id_status_idx" ON "growth_acquisition_configs"("user_id", "status");
CREATE INDEX IF NOT EXISTS "growth_acquisition_configs_user_id_schedule_enabled_idx" ON "growth_acquisition_configs"("user_id", "schedule_enabled");
CREATE INDEX IF NOT EXISTS "growth_acquisition_configs_tenant_id_status_idx" ON "growth_acquisition_configs"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "growth_acquisition_configs_tenant_id_schedule_enabled_idx" ON "growth_acquisition_configs"("tenant_id", "schedule_enabled");
CREATE INDEX IF NOT EXISTS "growth_acquisition_configs_platform_account_id_idx" ON "growth_acquisition_configs"("platform", "account_id");
CREATE INDEX IF NOT EXISTS "growth_acquisition_runs_user_id_started_at_idx" ON "growth_acquisition_runs"("user_id", "started_at");
CREATE INDEX IF NOT EXISTS "growth_acquisition_runs_tenant_id_started_at_idx" ON "growth_acquisition_runs"("tenant_id", "started_at");
CREATE INDEX IF NOT EXISTS "growth_acquisition_runs_config_id_started_at_idx" ON "growth_acquisition_runs"("config_id", "started_at");
CREATE INDEX IF NOT EXISTS "growth_leads_user_id_status_idx" ON "growth_leads"("user_id", "status");
CREATE INDEX IF NOT EXISTS "growth_leads_user_id_platform_idx" ON "growth_leads"("user_id", "platform");
CREATE INDEX IF NOT EXISTS "growth_leads_tenant_id_status_idx" ON "growth_leads"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "growth_leads_tenant_id_platform_idx" ON "growth_leads"("tenant_id", "platform");
CREATE INDEX IF NOT EXISTS "growth_leads_source_task_id_idx" ON "growth_leads"("source_task_id");
CREATE UNIQUE INDEX IF NOT EXISTS "growth_account_health_user_id_platform_account_id_key" ON "growth_account_health"("user_id", "platform", "account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "growth_account_health_tenant_id_platform_account_id_key" ON "growth_account_health"("tenant_id", "platform", "account_id");
CREATE INDEX IF NOT EXISTS "growth_account_health_user_id_risk_status_idx" ON "growth_account_health"("user_id", "risk_status");
CREATE INDEX IF NOT EXISTS "growth_account_health_tenant_id_risk_status_idx" ON "growth_account_health"("tenant_id", "risk_status");
CREATE INDEX IF NOT EXISTS "growth_workflows_user_id_status_idx" ON "growth_workflows"("user_id", "status");
CREATE INDEX IF NOT EXISTS "growth_workflows_tenant_id_status_idx" ON "growth_workflows"("tenant_id", "status");
