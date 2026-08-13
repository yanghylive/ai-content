-- AlterTable
ALTER TABLE "leads" ADD COLUMN "video_title" TEXT;
ALTER TABLE "leads" ADD COLUMN "video_url" TEXT;
ALTER TABLE "leads" ADD COLUMN "comment_time" TEXT;
ALTER TABLE "leads" ADD COLUMN "notes" JSONB NOT NULL DEFAULT '[]';
