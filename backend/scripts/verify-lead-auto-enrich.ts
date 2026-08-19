// 端到端验证「新线索自动评分 + 打标签」：
// 实例化 LeadRepository（注入 LeadScoreService）→ upsert 新线索 → 查 matchedKeywords + 快照。
// 运行（连 SQLite 桌面库，需临时切 SQLite client）：
//   cd backend
//   npx prisma generate --schema prisma/schema.sqlite.prisma
//   SQLITE_DATABASE_URL="file:$HOME/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite" \
//     npx ts-node -r tsconfig-paths/register scripts/verify-lead-auto-enrich.ts
//   npx prisma generate --schema prisma/schema.prisma
import { PrismaClient } from '@prisma/client';
import { LeadRepository } from '../src/modules/leads/lead.repository';
import { LeadSignalStore } from '../src/modules/lead-intelligence/lead-signal.store';
import { LeadScoreService } from '../src/modules/lead-intelligence/lead-score.service';

const prisma = new PrismaClient() as never;
const signalStore = new LeadSignalStore(prisma);
const scoreService = new LeadScoreService(prisma as never, signalStore);
const repo = new LeadRepository(prisma as never, scoreService);

const unique = Date.now();
const sourceText = '你们这个怎么收费？想合作，加个微信';

async function main() {
  const { lead, created } = await repo.upsert({
    userId: 'cmsmjmskh01xwi5opfmpmu30n',
    tenantId: null,
    platform: 'douyin',
    sourceType: 'comment',
    sourceText,
    nickname: `自动增强验证-${unique}`,
  });
  console.log('created =', created, 'leadId =', lead.id);

  // 等 fire-and-forget 评分 + 打标签落库
  await new Promise((r) => setTimeout(r, 1500));

  const after = await (
    prisma as never as {
      lead: {
        findUnique: (a: unknown) => Promise<{ matchedKeywords: unknown } | null>;
      };
    }
  ).lead.findUnique({ where: { id: lead.id } });
  const snapCount = await (
    prisma as never as {
      leadScoreSnapshot: { count: (a: unknown) => Promise<number> };
    }
  ).leadScoreSnapshot.count({ where: { leadId: lead.id } });

  console.log('matchedKeywords =', JSON.stringify(after?.matchedKeywords));
  console.log('快照数 =', snapCount);

  const labels = Array.isArray(after?.matchedKeywords)
    ? (after.matchedKeywords as string[])
    : [];
  const ok = labels.length > 0 && snapCount >= 1;
  console.log(ok ? '✅ 新线索自动评分 + 打标签生效' : '❌ 未生效');

  // 清理
  const del = prisma as never as {
    lead: { deleteMany: (a: unknown) => Promise<unknown> };
    leadSignal: { deleteMany: (a: unknown) => Promise<unknown> };
    leadScoreSnapshot: { deleteMany: (a: unknown) => Promise<unknown> };
    leadEventOutbox: { deleteMany: (a: unknown) => Promise<unknown> };
  };
  await del.leadSignal.deleteMany({ where: { leadId: lead.id } });
  await del.leadScoreSnapshot.deleteMany({ where: { leadId: lead.id } });
  await del.leadEventOutbox.deleteMany({
    where: { payload: { string_contains: lead.id } },
  });
  await del.lead.deleteMany({ where: { id: lead.id } });
  console.log('已清理');
  process.exitCode = ok ? 0 : 1;
  await (prisma as never as { $disconnect: () => Promise<void> }).$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
