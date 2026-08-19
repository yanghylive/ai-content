// 端到端验证「采集配额原子递增 + 超限回滚」：
// 用 ACQUISITION_DAILY_LIMIT=3 造一个临时 userId，recordDiscover 3 次成功、第 4 次抛 quota_exceeded，
// 并验证 discoverCount 停在 3（事务回滚生效，未超限）。
// 运行（连 SQLite 桌面库，需临时切 SQLite client）：
//   cd backend
//   npx prisma generate --schema prisma/schema.sqlite.prisma
//   ACQUISITION_DAILY_LIMIT=3 SQLITE_DATABASE_URL="file:$HOME/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite" \
//     npx ts-node -r tsconfig-paths/register scripts/verify-quota-atomic.ts
//   npx prisma generate --schema prisma/schema.prisma
import { PrismaClient } from '@prisma/client';
import {
  AcquisitionQuotaService,
  AcquisitionQuotaExceededError,
} from '../src/modules/discovery/acquisition-quota.service';

const prisma = new PrismaClient() as any;
const quota = new AcquisitionQuotaService(prisma);

const userId = `e2e-quota-${Date.now()}`;

async function main() {
  // 前置清理（防上次残留）
  await prisma.acquisitionQuota.deleteMany({ where: { userId } });

  // 3 次成功
  await quota.recordDiscover(userId);
  await quota.recordDiscover(userId);
  await quota.recordDiscover(userId);

  const before = await quota.getQuota(userId);
  if (before.used !== 3) {
    throw new Error(`期望 used=3，实际 ${before.used}`);
  }
  console.log(`✅ 3 次递增后 used=${before.used}/${before.limit}`);

  // 第 4 次应抛超限（回滚，count 不 +1）
  let exceeded = false;
  try {
    await quota.recordDiscover(userId);
  } catch (error) {
    if (error instanceof AcquisitionQuotaExceededError) {
      exceeded = true;
      console.log(`✅ 第 4 次抛 quota_exceeded（limit=${error.limit}）`);
    } else {
      throw error;
    }
  }
  if (!exceeded) {
    throw new Error('第 4 次应抛 AcquisitionQuotaExceededError，但未抛');
  }

  // 回滚验证：used 仍为 3
  const after = await quota.getQuota(userId);
  if (after.used !== 3) {
    throw new Error(`超限回滚失败：期望 used=3，实际 ${after.used}`);
  }
  console.log(`✅ 超限后回滚生效，used=${after.used}（未超限）`);

  // 清理
  await prisma.acquisitionQuota.deleteMany({ where: { userId } });
  console.log('✅ 配额原子递增验证通过，已清理测试数据');
}

main()
  .catch(async (e) => {
    console.error('❌ 验证失败:', e);
    await prisma.acquisitionQuota.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
