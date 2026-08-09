-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "cover_image" TEXT;

-- AlterTable
ALTER TABLE "styles" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'article';

-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "reasoning" TEXT,
ADD COLUMN     "search_queries" TEXT[];

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_logs_created_at_idx" ON "system_logs"("created_at");

-- CreateIndex
CREATE INDEX "system_logs_level_idx" ON "system_logs"("level");

-- CreateIndex
CREATE INDEX "styles_type_idx" ON "styles"("type");
