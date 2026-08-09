CREATE TABLE IF NOT EXISTS "solution_runs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT NOT NULL,
  "package_code" TEXT NOT NULL,
  "package_name" TEXT NOT NULL,
  "package_version" TEXT NOT NULL DEFAULT '2026-07-01',
  "catalog_snapshot_hash" TEXT,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "source" TEXT NOT NULL DEFAULT 'solutions',
  "parent_run_id" TEXT,
  "correlation_id" TEXT,
  "idempotency_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "input_json" JSONB NOT NULL DEFAULT '{}',
  "resolved_plan_json" JSONB NOT NULL DEFAULT '{}',
  "data_object_mapping" JSONB NOT NULL DEFAULT '{}',
  "risk_level" TEXT NOT NULL DEFAULT 'medium',
  "confirmation_policy" TEXT NOT NULL DEFAULT 'manual_required',
  "send_mode" TEXT NOT NULL DEFAULT 'approval-send',
  "dry_run" BOOLEAN NOT NULL DEFAULT true,
  "estimated_cost_points" INTEGER NOT NULL DEFAULT 0,
  "max_cost_points" INTEGER NOT NULL DEFAULT 0,
  "actual_cost_points" INTEGER NOT NULL DEFAULT 0,
  "cost_status" TEXT NOT NULL DEFAULT 'estimated',
  "summary_json" JSONB NOT NULL DEFAULT '{}',
  "output_refs" JSONB NOT NULL DEFAULT '[]',
  "acceptance_checks" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solution_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "solution_tasks" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "step_key" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'workflow_step',
  "executor_kind" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "depends_on" JSONB NOT NULL DEFAULT '[]',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 1,
  "retry_policy" JSONB,
  "queued_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "input_json" JSONB NOT NULL DEFAULT '{}',
  "output_json" JSONB,
  "target_object" TEXT,
  "reason_code" TEXT,
  "error_message" TEXT,
  "runtime_execution_id" TEXT,
  "redfox_call_log_id" TEXT,
  "interaction_task_id" TEXT,
  "agent_session_id" TEXT,
  "agent_confirmation_id" TEXT,
  "intelligence_monitor_id" TEXT,
  "dedupe_key" TEXT,
  "request_hash" TEXT,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solution_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "solution_results" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "task_id" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'summary',
  "status" TEXT NOT NULL DEFAULT 'created',
  "business_object_refs" JSONB NOT NULL DEFAULT '[]',
  "counts" JSONB NOT NULL DEFAULT '{}',
  "readback" JSONB,
  "quality_score" INTEGER,
  "completeness" INTEGER,
  "next_action" TEXT,
  "failure_reason" TEXT,
  "accepted_at" TIMESTAMP(3),
  "approved_by" TEXT,
  "payload_summary" JSONB,
  "raw_result_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solution_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "solution_artifacts" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "task_id" TEXT,
  "result_id" TEXT,
  "kind" TEXT NOT NULL,
  "uri" TEXT,
  "path" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "label" TEXT,
  "preview" JSONB,
  "source" TEXT,
  "object_ref" JSONB,
  "pii_level" TEXT NOT NULL DEFAULT 'none',
  "redaction_status" TEXT NOT NULL DEFAULT 'not_required',
  "retention_policy" TEXT,
  "metadata" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solution_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "solution_cost_entries" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "task_id" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'redfox',
  "operation" TEXT,
  "skill_code" TEXT,
  "endpoint" TEXT,
  "estimated_cost_points" INTEGER NOT NULL DEFAULT 0,
  "authorized_cost_points" INTEGER NOT NULL DEFAULT 0,
  "captured_cost_points" INTEGER NOT NULL DEFAULT 0,
  "refunded_cost_points" INTEGER NOT NULL DEFAULT 0,
  "billing_status" TEXT NOT NULL DEFAULT 'estimated',
  "reservation_id" TEXT,
  "transaction_id" TEXT,
  "policy_version" TEXT,
  "request_hash" TEXT,
  "idempotency_key" TEXT,
  "latency_ms" INTEGER,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "redfox_call_log_id" TEXT,
  "runtime_execution_id" TEXT,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solution_cost_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "solution_runs_tenant_id_status_idx" ON "solution_runs"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "solution_runs_tenant_id_created_at_idx" ON "solution_runs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "solution_runs_user_id_created_at_idx" ON "solution_runs"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "solution_runs_package_code_idx" ON "solution_runs"("package_code");
CREATE INDEX IF NOT EXISTS "solution_runs_status_idx" ON "solution_runs"("status");
CREATE INDEX IF NOT EXISTS "solution_runs_correlation_id_idx" ON "solution_runs"("correlation_id");
CREATE INDEX IF NOT EXISTS "solution_runs_idempotency_key_idx" ON "solution_runs"("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "solution_tasks_run_id_order_key" ON "solution_tasks"("run_id", "order");
CREATE INDEX IF NOT EXISTS "solution_tasks_run_id_status_idx" ON "solution_tasks"("run_id", "status");
CREATE INDEX IF NOT EXISTS "solution_tasks_status_idx" ON "solution_tasks"("status");
CREATE INDEX IF NOT EXISTS "solution_tasks_executor_kind_idx" ON "solution_tasks"("executor_kind");
CREATE INDEX IF NOT EXISTS "solution_tasks_redfox_call_log_id_idx" ON "solution_tasks"("redfox_call_log_id");
CREATE INDEX IF NOT EXISTS "solution_tasks_runtime_execution_id_idx" ON "solution_tasks"("runtime_execution_id");
CREATE INDEX IF NOT EXISTS "solution_tasks_interaction_task_id_idx" ON "solution_tasks"("interaction_task_id");
CREATE INDEX IF NOT EXISTS "solution_tasks_agent_confirmation_id_idx" ON "solution_tasks"("agent_confirmation_id");
CREATE INDEX IF NOT EXISTS "solution_tasks_dedupe_key_idx" ON "solution_tasks"("dedupe_key");
CREATE INDEX IF NOT EXISTS "solution_tasks_request_hash_idx" ON "solution_tasks"("request_hash");

CREATE INDEX IF NOT EXISTS "solution_results_run_id_idx" ON "solution_results"("run_id");
CREATE INDEX IF NOT EXISTS "solution_results_task_id_idx" ON "solution_results"("task_id");
CREATE INDEX IF NOT EXISTS "solution_results_kind_idx" ON "solution_results"("kind");
CREATE INDEX IF NOT EXISTS "solution_results_status_idx" ON "solution_results"("status");
CREATE INDEX IF NOT EXISTS "solution_results_created_at_idx" ON "solution_results"("created_at");

CREATE INDEX IF NOT EXISTS "solution_artifacts_run_id_idx" ON "solution_artifacts"("run_id");
CREATE INDEX IF NOT EXISTS "solution_artifacts_task_id_idx" ON "solution_artifacts"("task_id");
CREATE INDEX IF NOT EXISTS "solution_artifacts_result_id_idx" ON "solution_artifacts"("result_id");
CREATE INDEX IF NOT EXISTS "solution_artifacts_kind_idx" ON "solution_artifacts"("kind");
CREATE INDEX IF NOT EXISTS "solution_artifacts_created_at_idx" ON "solution_artifacts"("created_at");

CREATE INDEX IF NOT EXISTS "solution_cost_entries_run_id_idx" ON "solution_cost_entries"("run_id");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_task_id_idx" ON "solution_cost_entries"("task_id");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_provider_idx" ON "solution_cost_entries"("provider");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_skill_code_idx" ON "solution_cost_entries"("skill_code");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_endpoint_idx" ON "solution_cost_entries"("endpoint");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_billing_status_idx" ON "solution_cost_entries"("billing_status");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_redfox_call_log_id_idx" ON "solution_cost_entries"("redfox_call_log_id");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_runtime_execution_id_idx" ON "solution_cost_entries"("runtime_execution_id");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_request_hash_idx" ON "solution_cost_entries"("request_hash");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_idempotency_key_idx" ON "solution_cost_entries"("idempotency_key");
CREATE INDEX IF NOT EXISTS "solution_cost_entries_created_at_idx" ON "solution_cost_entries"("created_at");

DO $$ BEGIN
  ALTER TABLE "solution_runs" ADD CONSTRAINT "solution_runs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_runs" ADD CONSTRAINT "solution_runs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_tasks" ADD CONSTRAINT "solution_tasks_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "solution_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_results" ADD CONSTRAINT "solution_results_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "solution_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_results" ADD CONSTRAINT "solution_results_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "solution_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_artifacts" ADD CONSTRAINT "solution_artifacts_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "solution_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_artifacts" ADD CONSTRAINT "solution_artifacts_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "solution_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_artifacts" ADD CONSTRAINT "solution_artifacts_result_id_fkey"
    FOREIGN KEY ("result_id") REFERENCES "solution_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_cost_entries" ADD CONSTRAINT "solution_cost_entries_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "solution_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solution_cost_entries" ADD CONSTRAINT "solution_cost_entries_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "solution_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
