-- AI 审计 + 配额（B6/P3）
CREATE TABLE IF NOT EXISTS "ai_chat_logs" (
    "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "session_id" TEXT, "model" TEXT, "platform" TEXT,
    "messages" INTEGER NOT NULL DEFAULT 0, "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ok', "error_msg" TEXT, "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_chat_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_chat_logs_user_id_created_at_idx" ON "ai_chat_logs"("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_tool_call_logs" (
    "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "tool" TEXT NOT NULL,
    "args_json" TEXT NOT NULL, "result_ok" BOOLEAN NOT NULL, "error_msg" TEXT,
    "duration_ms" INTEGER NOT NULL DEFAULT 0, "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_tool_call_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_tool_call_logs_user_id_created_at_idx" ON "ai_tool_call_logs"("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_usage_quotas" (
    "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "date" DATE NOT NULL,
    "chat_count" INTEGER NOT NULL DEFAULT 0, "tool_count" INTEGER NOT NULL DEFAULT 0,
    "chat_limit" INTEGER NOT NULL DEFAULT 50, "tool_limit" INTEGER NOT NULL DEFAULT 100,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_usage_quotas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_quotas_user_id_date_key" ON "ai_usage_quotas"("user_id", "date");
