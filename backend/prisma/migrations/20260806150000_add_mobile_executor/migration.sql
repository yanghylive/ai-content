-- 手机执行器（C 组/P5 服务器侧）
CREATE TABLE IF NOT EXISTS "mobile_devices" (
    "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "device_name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android', "status" TEXT NOT NULL DEFAULT 'online',
    "last_heartbeat_at" TIMESTAMP(3), "agent_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "mobile_devices_user_id_idx" ON "mobile_devices"("user_id");

CREATE TABLE IF NOT EXISTS "executor_tasks" (
    "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "device_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'publish', "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued', "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL, "executed_at" TIMESTAMP(3),
    CONSTRAINT "executor_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "executor_tasks_user_id_status_idx" ON "executor_tasks"("user_id", "status");
CREATE INDEX IF NOT EXISTS "executor_tasks_device_id_idx" ON "executor_tasks"("device_id");
