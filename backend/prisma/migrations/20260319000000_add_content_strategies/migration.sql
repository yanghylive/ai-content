CREATE TABLE "content_strategies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT NOT NULL DEFAULT '通用',
    "target_audience" TEXT NOT NULL,
    "commercial_goal" TEXT NOT NULL,
    "core_pain_points" TEXT NOT NULL,
    "writing_angles" TEXT NOT NULL,
    "tone_and_style" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_strategies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_strategies_name_key" ON "content_strategies"("name");
CREATE INDEX "content_strategies_is_default_idx" ON "content_strategies"("is_default");
CREATE INDEX "content_strategies_enabled_idx" ON "content_strategies"("enabled");
