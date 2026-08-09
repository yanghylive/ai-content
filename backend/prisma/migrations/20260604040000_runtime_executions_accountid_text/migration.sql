-- 2026-06-04: runtime_executions.accountId 改 TEXT, 对齐 publish_accounts.id (cuid).
-- 之前 schema 是 INTEGER, dispatch 写入时 Prisma 把 cuid 强转 int 丢精度,
-- 导致 workbench 账号列表拿不到 accountId 关联, sessionStatus 永远 unknown.
ALTER TABLE "runtime_executions" ALTER COLUMN "accountId" TYPE TEXT USING "accountId"::TEXT;
