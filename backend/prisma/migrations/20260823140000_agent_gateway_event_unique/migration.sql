-- DropIndex
DROP INDEX "agent_gateway_events_event_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "agent_gateway_events_session_id_event_id_key" ON "agent_gateway_events"("session_id", "event_id");

