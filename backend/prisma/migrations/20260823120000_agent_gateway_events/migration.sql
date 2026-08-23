-- CreateTable
CREATE TABLE "agent_gateway_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_gateway_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_gateway_events_event_id_key" ON "agent_gateway_events"("event_id");

-- CreateIndex
CREATE INDEX "agent_gateway_events_session_id_sequence_idx" ON "agent_gateway_events"("session_id", "sequence");

-- CreateIndex
CREATE INDEX "agent_gateway_events_tenant_id_occurred_at_idx" ON "agent_gateway_events"("tenant_id", "occurred_at");

