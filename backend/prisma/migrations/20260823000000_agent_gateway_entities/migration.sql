-- CreateTable
CREATE TABLE "agent_gateway_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "octop_session_id" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'business',
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_event_id" TEXT NOT NULL DEFAULT '',
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_gateway_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_tasks" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "plan_json" JSONB NOT NULL DEFAULT '{}',
    "checkpoint_json" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_gateway_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_tool_calls" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'low',
    "input_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "idempotency_key" TEXT NOT NULL,
    "usage_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_gateway_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_approvals" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "preview_hash" TEXT NOT NULL,
    "approved_by" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_gateway_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_artifacts" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_gateway_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_evidence" (
    "id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "redaction_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_gateway_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_usage_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "usage_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "task_id" TEXT,
    "tool_call_id" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "compute_units" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(10,6),
    "status" TEXT NOT NULL DEFAULT 'ok',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_gateway_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_memory_outbox" (
    "id" TEXT NOT NULL,
    "memory_event_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'add',
    "payload_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_gateway_memory_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_gateway_device_leases" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_gateway_device_leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_gateway_sessions_tenant_id_user_id_idx" ON "agent_gateway_sessions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "agent_gateway_sessions_expires_at_idx" ON "agent_gateway_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "agent_gateway_tasks_session_id_idx" ON "agent_gateway_tasks"("session_id");

-- CreateIndex
CREATE INDEX "agent_gateway_tasks_tenant_id_user_id_idx" ON "agent_gateway_tasks"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "agent_gateway_tasks_status_idx" ON "agent_gateway_tasks"("status");

-- CreateIndex
CREATE INDEX "agent_gateway_tool_calls_task_id_idx" ON "agent_gateway_tool_calls"("task_id");

-- CreateIndex
CREATE INDEX "agent_gateway_tool_calls_usage_id_idx" ON "agent_gateway_tool_calls"("usage_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_gateway_tool_calls_tenant_id_idempotency_key_key" ON "agent_gateway_tool_calls"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "agent_gateway_approvals_task_id_idx" ON "agent_gateway_approvals"("task_id");

-- CreateIndex
CREATE INDEX "agent_gateway_approvals_tool_call_id_idx" ON "agent_gateway_approvals"("tool_call_id");

-- CreateIndex
CREATE INDEX "agent_gateway_approvals_status_expires_at_idx" ON "agent_gateway_approvals"("status", "expires_at");

-- CreateIndex
CREATE INDEX "agent_gateway_artifacts_task_id_idx" ON "agent_gateway_artifacts"("task_id");

-- CreateIndex
CREATE INDEX "agent_gateway_artifacts_tenant_id_idx" ON "agent_gateway_artifacts"("tenant_id");

-- CreateIndex
CREATE INDEX "agent_gateway_evidence_tool_call_id_idx" ON "agent_gateway_evidence"("tool_call_id");

-- CreateIndex
CREATE INDEX "agent_gateway_evidence_tenant_id_captured_at_idx" ON "agent_gateway_evidence"("tenant_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_gateway_usage_events_usage_id_key" ON "agent_gateway_usage_events"("usage_id");

-- CreateIndex
CREATE INDEX "agent_gateway_usage_events_request_id_idx" ON "agent_gateway_usage_events"("request_id");

-- CreateIndex
CREATE INDEX "agent_gateway_usage_events_tenant_id_created_at_idx" ON "agent_gateway_usage_events"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_gateway_memory_outbox_memory_event_id_key" ON "agent_gateway_memory_outbox"("memory_event_id");

-- CreateIndex
CREATE INDEX "agent_gateway_memory_outbox_status_next_retry_at_idx" ON "agent_gateway_memory_outbox"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "agent_gateway_device_leases_device_id_idx" ON "agent_gateway_device_leases"("device_id");

-- CreateIndex
CREATE INDEX "agent_gateway_device_leases_tenant_id_idx" ON "agent_gateway_device_leases"("tenant_id");

-- AddForeignKey
ALTER TABLE "agent_gateway_tasks" ADD CONSTRAINT "agent_gateway_tasks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_gateway_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_gateway_tool_calls" ADD CONSTRAINT "agent_gateway_tool_calls_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_gateway_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_gateway_approvals" ADD CONSTRAINT "agent_gateway_approvals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_gateway_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_gateway_approvals" ADD CONSTRAINT "agent_gateway_approvals_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "agent_gateway_tool_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_gateway_artifacts" ADD CONSTRAINT "agent_gateway_artifacts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_gateway_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_gateway_evidence" ADD CONSTRAINT "agent_gateway_evidence_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_gateway_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_gateway_evidence" ADD CONSTRAINT "agent_gateway_evidence_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "agent_gateway_tool_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

