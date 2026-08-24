-- =============================================================================
-- 4.4 多工作区标签壳 · step1-1：Workspace 表 + agent-gateway 五表 workspaceId 列
-- 命名：workspaces / agent_gateway_* 上的 workspace_id（可空=兼容旧数据）
-- 仅添加 workspaceId 列与 workspaces 表，不动既有 userId/agentId 列（避免与既有 migration 漂移冲突）
-- =============================================================================

-- 1. workspaces 表
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL DEFAULT 'agent_default',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- 2. workspaces 索引
CREATE INDEX "workspaces_tenant_id_user_id_idx" ON "workspaces"("tenant_id", "user_id");
CREATE INDEX "workspaces_status_idx" ON "workspaces"("status");
CREATE UNIQUE INDEX "workspaces_tenant_id_user_id_name_key" ON "workspaces"("tenant_id", "user_id", "name");

-- 3. agent-gateway 五表加 workspace_id（可空；旧数据 workspace_id=NULL 不破坏）
ALTER TABLE "agent_gateway_sessions" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "agent_gateway_tasks" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "agent_gateway_tool_calls" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "agent_gateway_memory_outbox" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "agent_gateway_events" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "agent_gateway_usage_events" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;

-- 4. workspace_id 索引（按 user/workspace 列表场景）
CREATE INDEX IF NOT EXISTS "agent_gateway_sessions_workspace_id_idx" ON "agent_gateway_sessions"("workspace_id");
CREATE INDEX IF NOT EXISTS "agent_gateway_tasks_workspace_id_idx" ON "agent_gateway_tasks"("workspace_id");
CREATE INDEX IF NOT EXISTS "agent_gateway_events_workspace_id_idx" ON "agent_gateway_events"("workspace_id");
CREATE INDEX IF NOT EXISTS "agent_gateway_usage_events_workspace_id_idx" ON "agent_gateway_usage_events"("workspace_id");
