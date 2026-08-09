-- BrandKnowledge（品牌知识库 D1：用户上传产品/品牌资料 → AI 创作引用）
CREATE TABLE IF NOT EXISTS "brand_knowledge" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'brand',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_knowledge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "brand_knowledge_tenant_id_idx" ON "brand_knowledge"("tenant_id");
CREATE INDEX IF NOT EXISTS "brand_knowledge_user_id_created_at_idx" ON "brand_knowledge"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "brand_knowledge_user_id_type_idx" ON "brand_knowledge"("user_id", "type");
