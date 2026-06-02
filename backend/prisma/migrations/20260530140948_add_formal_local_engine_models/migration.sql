-- CreateEnum
CREATE TYPE "InteractionTaskType" AS ENUM ('DOUYIN_COMMENT_REPLY', 'DOUYIN_DIRECT_MESSAGE_REPLY', 'WECHAT_REPLY_DRAFT', 'WECHAT_GROUP_BROADCAST', 'WECHAT_MOMENTS_PUBLISH', 'CUSTOMER_FOLLOW_UP');

-- CreateEnum
CREATE TYPE "InteractionTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_SEND_CONFIRMATION', 'COMPLETED', 'FAILED', 'BLOCKED', 'SKIPPED', 'NO_TARGET', 'PAUSED');

-- CreateTable
CREATE TABLE "interaction_tasks" (
    "id" TEXT NOT NULL,
    "taskType" "InteractionTaskType" NOT NULL,
    "accountId" TEXT,
    "sessionId" TEXT,
    "ruleId" TEXT,
    "sendMode" TEXT NOT NULL DEFAULT 'approval-send',
    "status" "InteractionTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "stage" TEXT,
    "currentTarget" TEXT,
    "draftText" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "batchTargets" JSONB,
    "batchSummary" JSONB,
    "events" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB,
    "createdBy" TEXT,
    "localTaskId" TEXT,
    "requiresDoubleConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interaction_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_task_events" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_reply_records" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "targetUser" TEXT,
    "sourceText" TEXT,
    "replyText" TEXT,
    "result" TEXT NOT NULL,
    "failureReason" TEXT,
    "evidenceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_reply_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_reply_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "industry" TEXT,
    "goal" TEXT,
    "tone" TEXT,
    "sendMode" TEXT NOT NULL DEFAULT 'approval-send',
    "forbiddenWords" JSONB NOT NULL DEFAULT '[]',
    "escalationRules" JSONB NOT NULL DEFAULT '[]',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "highlights" JSONB NOT NULL DEFAULT '[]',
    "closingText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interaction_reply_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "scope" JSONB,
    "targetApp" TEXT,
    "riskLevel" TEXT,
    "riskAnalysis" JSONB,
    "events" JSONB NOT NULL DEFAULT '[]',
    "confirmations" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_confirmations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "target" JSONB,
    "content" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "operator" TEXT,
    "note" TEXT,
    "riskPolicies" JSONB,
    "safetyBoundaries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_policies" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "requireConfirm" BOOLEAN NOT NULL DEFAULT true,
    "autoExecute" BOOLEAN NOT NULL DEFAULT false,
    "forbidden" BOOLEAN NOT NULL DEFAULT false,
    "minPlan" TEXT,
    "allowedRoles" JSONB NOT NULL DEFAULT '[]',
    "whitelist" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interaction_tasks_status_idx" ON "interaction_tasks"("status");

-- CreateIndex
CREATE INDEX "interaction_tasks_taskType_idx" ON "interaction_tasks"("taskType");

-- CreateIndex
CREATE INDEX "interaction_tasks_accountId_idx" ON "interaction_tasks"("accountId");

-- CreateIndex
CREATE INDEX "interaction_tasks_sessionId_idx" ON "interaction_tasks"("sessionId");

-- CreateIndex
CREATE INDEX "interaction_tasks_createdAt_idx" ON "interaction_tasks"("createdAt");

-- CreateIndex
CREATE INDEX "interaction_task_events_taskId_idx" ON "interaction_task_events"("taskId");

-- CreateIndex
CREATE INDEX "interaction_task_events_createdAt_idx" ON "interaction_task_events"("createdAt");

-- CreateIndex
CREATE INDEX "interaction_reply_records_taskId_idx" ON "interaction_reply_records"("taskId");

-- CreateIndex
CREATE INDEX "interaction_reply_records_result_idx" ON "interaction_reply_records"("result");

-- CreateIndex
CREATE INDEX "agent_sessions_status_idx" ON "agent_sessions"("status");

-- CreateIndex
CREATE INDEX "agent_sessions_createdAt_idx" ON "agent_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "agent_confirmations_sessionId_idx" ON "agent_confirmations"("sessionId");

-- CreateIndex
CREATE INDEX "agent_confirmations_status_idx" ON "agent_confirmations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "risk_policies_action_key" ON "risk_policies"("action");
