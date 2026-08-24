-- =============================================================================
-- 4.4 多工作区标签壳 · step1-2 配套：补齐历史事件债务 user_id 列
-- 问题：schema.prisma 中 AgentGatewayEvent / AgentGatewayUsageEvent 要求
--       user_id NOT NULL，但本地 dev DB 中这两张表从未迁移该列（历史迁移漂移）。
--       引擎写入（prisma-mirror / usage-sink）已带 userId，缺列会直接 500。
-- 修复：以 DEFAULT '' 兼容旧行，新写入均由引擎带 userId。
-- 幂等：ADD COLUMN IF NOT EXISTS。
-- =============================================================================

ALTER TABLE "agent_gateway_events" ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agent_gateway_usage_events" ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT '';

-- 补 userId 查询索引（事件按租户/用户审计、usage 按用户统计的常见路径）
CREATE INDEX IF NOT EXISTS "agent_gateway_events_user_id_idx" ON "agent_gateway_events"("user_id");
CREATE INDEX IF NOT EXISTS "agent_gateway_usage_events_user_id_idx" ON "agent_gateway_usage_events"("user_id");
