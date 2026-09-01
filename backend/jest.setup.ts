/**
 * 2026-09-01（复核第四轮 P1-3）：jest 环境默认数据库 URL——
 * schema 要求 PostgreSQL，但运行环境（CI/复核机）可能未设 DATABASE_URL，
 * PrismaClient 构造会因 URL 缺失直接抛错导致全量门禁挂。
 * 占位 URL 只通过构造期校验（PrismaClient 构造不连接），真实查询的 spec
 * 均有 mock 或显式 skip，不受影响。
 */
process.env.DATABASE_URL ??=
  'postgresql://test:test@127.0.0.1:5432/test';

// 2026-09-01 复核第四轮 P1-3：定位 fire-and-forget Prisma 构造（unhandled rejection）
process.on('unhandledRejection', (reason) => {
  console.error(
    '[UNHANDLED_REJECTION]',
    reason instanceof Error ? reason.stack : String(reason),
  );
});
