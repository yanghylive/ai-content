ALTER TABLE "articles"
ADD COLUMN "content_type" TEXT NOT NULL DEFAULT 'article';

CREATE INDEX "articles_content_type_idx" ON "articles"("content_type");
