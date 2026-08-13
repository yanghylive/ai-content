-- CreateTable
CREATE TABLE "ai_call_traces" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "scene" TEXT NOT NULL,
    "model_id" TEXT,
    "model_name" TEXT,
    "prompt_json" JSONB NOT NULL DEFAULT '[]',
    "completion" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_call_traces_user_id_created_at_idx" ON "ai_call_traces"("user_id", "created_at");
CREATE INDEX "ai_call_traces_scene_created_at_idx" ON "ai_call_traces"("scene", "created_at");
