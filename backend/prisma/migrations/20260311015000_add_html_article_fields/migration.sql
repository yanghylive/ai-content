ALTER TABLE "articles"
ADD COLUMN "content_format" TEXT NOT NULL DEFAULT 'markdown',
ADD COLUMN "raw_html" TEXT,
ADD COLUMN "final_html" TEXT,
ADD COLUMN "template_id" TEXT;

CREATE INDEX "articles_template_id_idx" ON "articles"("template_id");

ALTER TABLE "articles"
ADD CONSTRAINT "articles_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "styles"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
