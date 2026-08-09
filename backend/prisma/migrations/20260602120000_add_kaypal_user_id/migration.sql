-- AlterTable
ALTER TABLE "users" ADD COLUMN "kaypal_user_id" TEXT;
CREATE UNIQUE INDEX "users_kaypal_user_id_key" ON "users"("kaypal_user_id");
CREATE INDEX "users_kaypal_user_id_idx" ON "users"("kaypal_user_id");
