ALTER TABLE "users" ADD COLUMN "username" TEXT;

UPDATE "users"
SET "username" = CASE
  WHEN "email" = 'admin@example.com' THEN 'admin'
  ELSE split_part("email", '@', 1)
END
WHERE "username" IS NULL;

UPDATE "users"
SET "username" = 'admin'
WHERE "username" = '';

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
