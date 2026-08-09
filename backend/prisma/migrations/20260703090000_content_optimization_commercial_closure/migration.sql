CREATE TABLE IF NOT EXISTS "content_drafts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "source_type" TEXT,
  "source_id" TEXT,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'all',
  "target_type" TEXT NOT NULL DEFAULT 'article',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "official_version_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_optimization_runs" (
  "id" TEXT NOT NULL,
  "draft_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'all',
  "input" JSONB,
  "result" JSONB,
  "source_workflow_id" TEXT,
  "source_summary" TEXT,
  "cost_points" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_optimization_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_versions" (
  "id" TEXT NOT NULL,
  "draft_id" TEXT NOT NULL,
  "run_id" TEXT,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "mode_label" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'all',
  "target_type" TEXT NOT NULL DEFAULT 'article',
  "version_no" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'saved',
  "is_official" BOOLEAN NOT NULL DEFAULT false,
  "source_workflow_id" TEXT,
  "source_summary" TEXT,
  "compliance_check_id" TEXT,
  "compliance_risk_level" TEXT,
  "compliance_risk_score" INTEGER,
  "compliance_summary" TEXT,
  "compliance_checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_publish_intents" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "scheduled_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_publish_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_manual_reviews" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "risk_level" TEXT,
  "note" TEXT,
  "reviewer_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_manual_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_publish_feedback" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "publish_intent_id" TEXT,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'all',
  "views" INTEGER NOT NULL DEFAULT 0,
  "likes" INTEGER NOT NULL DEFAULT 0,
  "comments" INTEGER NOT NULL DEFAULT 0,
  "saves" INTEGER NOT NULL DEFAULT 0,
  "leads" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_publish_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_version_comments" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "author_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_version_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_evidence_logs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_evidence_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "content_drafts_user_id_updated_at_idx" ON "content_drafts"("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "content_drafts_tenant_id_updated_at_idx" ON "content_drafts"("tenant_id", "updated_at");
CREATE INDEX IF NOT EXISTS "content_optimization_runs_draft_id_created_at_idx" ON "content_optimization_runs"("draft_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_optimization_runs_user_id_updated_at_idx" ON "content_optimization_runs"("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "content_versions_user_id_updated_at_idx" ON "content_versions"("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "content_versions_tenant_id_updated_at_idx" ON "content_versions"("tenant_id", "updated_at");
CREATE INDEX IF NOT EXISTS "content_versions_draft_id_version_no_idx" ON "content_versions"("draft_id", "version_no");
CREATE INDEX IF NOT EXISTS "content_versions_status_idx" ON "content_versions"("status");
CREATE INDEX IF NOT EXISTS "content_versions_is_official_idx" ON "content_versions"("is_official");
CREATE INDEX IF NOT EXISTS "content_publish_intents_version_id_idx" ON "content_publish_intents"("version_id");
CREATE INDEX IF NOT EXISTS "content_publish_intents_user_id_created_at_idx" ON "content_publish_intents"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_manual_reviews_version_id_created_at_idx" ON "content_manual_reviews"("version_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_manual_reviews_user_id_created_at_idx" ON "content_manual_reviews"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_publish_feedback_version_id_created_at_idx" ON "content_publish_feedback"("version_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_publish_feedback_user_id_created_at_idx" ON "content_publish_feedback"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_version_comments_version_id_created_at_idx" ON "content_version_comments"("version_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_version_comments_user_id_created_at_idx" ON "content_version_comments"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "content_evidence_logs_target_type_target_id_idx" ON "content_evidence_logs"("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "content_evidence_logs_user_id_created_at_idx" ON "content_evidence_logs"("user_id", "created_at");
