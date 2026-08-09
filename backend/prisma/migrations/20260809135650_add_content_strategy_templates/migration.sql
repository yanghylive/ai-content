/*
  Warnings:

  - You are about to drop the `agent_confirmations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `agent_sessions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `crm_connector_vault_handles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `crm_connector_vault_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `interaction_reply_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `interaction_reply_rules` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `local_engine_interaction_tasks` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AgentSessionSource" AS ENUM ('web', 'agent_console', 'publishing', 'interaction', 'system');

-- CreateEnum
CREATE TYPE "AgentSessionStatus" AS ENUM ('draft', 'running', 'waiting_for_confirmation', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentConfirmationStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "AgentRiskLevel" AS ENUM ('low', 'medium', 'high');

-- DropForeignKey
ALTER TABLE "crm_connector_vault_handles" DROP CONSTRAINT "crm_connector_vault_handles_vault_record_id_fkey";

-- DropIndex
DROP INDEX "interaction_tasks_status_idx";

-- DropIndex
DROP INDEX "interaction_tasks_taskType_idx";

-- DropIndex
DROP INDEX "local_engine_agent_confirmations_created_at_idx";

-- DropIndex
DROP INDEX "local_engine_agent_confirmations_risk_level_idx";

-- DropIndex
DROP INDEX "local_engine_agent_confirmations_session_id_idx";

-- DropIndex
DROP INDEX "local_engine_agent_confirmations_status_idx";

-- DropIndex
DROP INDEX "local_engine_agent_sessions_source_idx";

-- DropIndex
DROP INDEX "local_engine_agent_sessions_status_idx";

-- AlterTable
ALTER TABLE "app_install_states" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "benchmark_accounts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "billing_invoices" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "billing_subscriptions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "billing_webhook_events" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "brand_knowledge" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "comment_insights" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compliance_checks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "content_drafts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "content_optimization_runs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "content_publish_feedback" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "content_publish_intents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "content_version_comments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "content_versions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_companies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_customers" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_import_batches" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_notes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_opportunities" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_tasks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_timeline_events" ALTER COLUMN "evidence" DROP NOT NULL,
ALTER COLUMN "evidence" DROP DEFAULT;

-- AlterTable
ALTER TABLE "growth_acquisition_configs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "growth_leads" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "growth_scheduler_leases" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "growth_strategies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "growth_workflows" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "intelligence_items" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "intelligence_monitors" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "intelligence_reports" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "local_engine_agent_confirmations" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "decided_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "action" DROP DEFAULT;

-- AlterTable
ALTER TABLE "local_engine_agent_sessions" ALTER COLUMN "source" SET DEFAULT 'web',
ALTER COLUMN "status" SET DEFAULT 'draft',
ALTER COLUMN "title" SET DEFAULT '',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "local_engine_reply_rules" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "push_subscriptions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "redfox_connections" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "redfox_interfaces" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "redfox_skill_installs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "redfox_skills" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "runtime_executions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "solution_results" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "solution_runs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "solution_tasks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenant_entitlements" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenant_members" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "commercial_execution_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plan_mode" TEXT NOT NULL DEFAULT 'trial',
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'operator';

-- AlterTable
ALTER TABLE "wecom_assistant_integrations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wecom_assistant_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "agent_confirmations";

-- DropTable
DROP TABLE "agent_sessions";

-- DropTable
DROP TABLE "crm_connector_vault_handles";

-- DropTable
DROP TABLE "crm_connector_vault_records";

-- DropTable
DROP TABLE "interaction_reply_records";

-- DropTable
DROP TABLE "interaction_reply_rules";

-- DropTable
DROP TABLE "local_engine_interaction_tasks";

-- CreateTable
CREATE TABLE "content_strategy_templates" (
    "id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scene" TEXT,
    "hook" TEXT,
    "title" TEXT,
    "content" TEXT,
    "tone_hint" TEXT,
    "is_hot" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_strategy_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_strategy_templates_industry_type_idx" ON "content_strategy_templates"("industry", "type");

-- CreateIndex
CREATE INDEX "content_strategy_templates_enabled_idx" ON "content_strategy_templates"("enabled");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- AddForeignKey
ALTER TABLE "brand_knowledge" ADD CONSTRAINT "brand_knowledge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "growth_account_health_snapshots_tenant_id_platform_account_idx" RENAME TO "growth_account_health_snapshots_tenant_id_platform_account__idx";

-- RenameIndex
ALTER INDEX "growth_account_health_snapshots_user_id_platform_account_i_idx" RENAME TO "growth_account_health_snapshots_user_id_platform_account_id_idx";

-- RenameIndex
ALTER INDEX "local_engine_agent_confirmations_tenant_id_user_id_session_id_i" RENAME TO "local_engine_agent_confirmations_tenant_id_user_id_session__idx";

-- RenameIndex
ALTER INDEX "runtime_executions_taskType_status_lease_expires_at_createdAt_i" RENAME TO "runtime_executions_taskType_status_lease_expires_at_created_idx";
