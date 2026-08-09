-- CreateTable
CREATE TABLE "geo_bridge_tasks" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent_to_ai_content',
    "source" TEXT NOT NULL DEFAULT 'kaypal-geo',
    "brand_id" TEXT,
    "brand_name" TEXT,
    "platform" TEXT,
    "brief" TEXT,
    "goal" TEXT,
    "reason" TEXT,
    "retest_window" TEXT,
    "return_url" TEXT,
    "callback_url" TEXT,
    "keyword" TEXT,
    "content_preview" TEXT,
    "result_url" TEXT,
    "published_url" TEXT,
    "last_callback_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_bridge_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geo_bridge_tasks_action_id_key" ON "geo_bridge_tasks"("action_id");

-- CreateIndex
CREATE INDEX "geo_bridge_tasks_status_idx" ON "geo_bridge_tasks"("status");

-- CreateIndex
CREATE INDEX "geo_bridge_tasks_platform_idx" ON "geo_bridge_tasks"("platform");

-- CreateIndex
CREATE INDEX "geo_bridge_tasks_brand_name_idx" ON "geo_bridge_tasks"("brand_name");

-- CreateIndex
CREATE INDEX "geo_bridge_tasks_updated_at_idx" ON "geo_bridge_tasks"("updated_at");
