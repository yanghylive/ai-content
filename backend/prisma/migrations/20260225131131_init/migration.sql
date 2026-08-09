-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "summary" TEXT,
    "source_url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT '',
    "publish_date" TIMESTAMP(3),
    "collect_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'unmined',
    "keywords" TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "summary" TEXT,
    "source_type" TEXT NOT NULL DEFAULT '外部采集',
    "keywords" TEXT[],
    "ai_score" DOUBLE PRECISION,
    "score_details" JSONB,
    "score_reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_materials" (
    "topic_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,

    CONSTRAINT "topic_materials_pkey" PRIMARY KEY ("topic_id","material_id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "style_id" TEXT,
    "model_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_crawl_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "styles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prompt_template" TEXT NOT NULL,
    "parameters" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_platforms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_model_configs" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "default_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "materials_status_idx" ON "materials"("status");

-- CreateIndex
CREATE INDEX "materials_collect_date_idx" ON "materials"("collect_date");

-- CreateIndex
CREATE INDEX "materials_platform_idx" ON "materials"("platform");

-- CreateIndex
CREATE INDEX "topics_status_idx" ON "topics"("status");

-- CreateIndex
CREATE INDEX "topics_is_published_idx" ON "topics"("is_published");

-- CreateIndex
CREATE INDEX "topics_created_at_idx" ON "topics"("created_at");

-- CreateIndex
CREATE INDEX "articles_status_idx" ON "articles"("status");

-- CreateIndex
CREATE INDEX "articles_topic_id_idx" ON "articles"("topic_id");

-- CreateIndex
CREATE INDEX "sources_enabled_idx" ON "sources"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "styles_name_key" ON "styles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_platforms_name_key" ON "ai_platforms"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_platform_id_model_id_key" ON "ai_models"("platform_id", "model_id");

-- CreateIndex
CREATE UNIQUE INDEX "default_model_configs_purpose_key" ON "default_model_configs"("purpose");

-- AddForeignKey
ALTER TABLE "topic_materials" ADD CONSTRAINT "topic_materials_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_materials" ADD CONSTRAINT "topic_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "ai_platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
