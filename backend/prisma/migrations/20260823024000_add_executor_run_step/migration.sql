-- P1-12 Run/Step 持久化（断点恢复基础）
CREATE TABLE "executor_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "checkpoint" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "executor_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "executor_runs_task_id_idx" ON "executor_runs"("task_id");
CREATE INDEX "executor_runs_device_id_status_idx" ON "executor_runs"("device_id", "status");

CREATE TABLE "executor_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "executor_steps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "executor_steps_run_id_idx" ON "executor_steps"("run_id");
CREATE INDEX "executor_steps_task_id_step_index_idx" ON "executor_steps"("task_id", "step_index");
