ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "workspace_brief" JSONB,
  ADD COLUMN IF NOT EXISTS "workspace_outline" JSONB,
  ADD COLUMN IF NOT EXISTS "workspace_step" TEXT NOT NULL DEFAULT 'brief',
  ADD COLUMN IF NOT EXISTS "workspace_revision" INTEGER NOT NULL DEFAULT 1;
