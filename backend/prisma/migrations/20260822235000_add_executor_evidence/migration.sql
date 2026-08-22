-- P1 证据链：任务执行留证（PRD §6.6）
CREATE TABLE "executor_evidences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL DEFAULT -1,
    "type" TEXT NOT NULL DEFAULT 'screenshot',
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "executor_evidences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "executor_evidences_task_id_idx" ON "executor_evidences"("task_id");
CREATE INDEX "executor_evidences_user_id_task_id_idx" ON "executor_evidences"("user_id", "task_id");
