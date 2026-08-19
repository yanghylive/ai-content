// 一次性重算脚本：把存量线索的 lead.score 从「裸分」统一为四维 totalScore，
// 生成 LeadSignal + LeadScoreSnapshot + 回写 lead.score。
//
// 连 SQLite 桌面库的运行方式（SQLite 版 Prisma client 需临时切换）：
//   cd backend
//   npx prisma generate --schema prisma/schema.sqlite.prisma
//   SQLITE_DATABASE_URL="file:$HOME/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite" \
//     npx ts-node -r tsconfig-paths/register scripts/recompute-lead-scores.ts
//   npx prisma generate --schema prisma/schema.prisma
import { PrismaClient } from '@prisma/client';
import { LeadSignalStore } from '../src/modules/lead-intelligence/lead-signal.store';
import { LeadScoreService } from '../src/modules/lead-intelligence/lead-score.service';

const prisma = new PrismaClient() as never;
const signalStore = new LeadSignalStore(prisma as never);
const scoreService = new LeadScoreService(prisma as never, signalStore);

type LeadRow = {
  id: string;
  tenantId: string | null;
  userId: string;
  platform: string;
  sourceText: string | null;
  sourceType: string;
  sourceInteractionEventId: string | null;
  score: number;
};

async function channelFor(lead: LeadRow): Promise<string> {
  if (lead.sourceInteractionEventId) {
    const ev = await (prisma as never as {
      interactionEvent: { findUnique: (a: unknown) => Promise<{ channel: string } | null> };
    }).interactionEvent.findUnique({
      where: { id: lead.sourceInteractionEventId },
      select: { channel: true },
    });
    if (ev?.channel) return ev.channel;
  }
  return lead.sourceType === 'auto-acquisition' ? 'mention' : 'manual';
}

async function main() {
  const leads = (await (prisma as never as {
    lead: { findMany: (a: unknown) => Promise<LeadRow[]> };
  }).lead.findMany({
    select: {
      id: true,
      tenantId: true,
      userId: true,
      platform: true,
      sourceText: true,
      sourceType: true,
      sourceInteractionEventId: true,
      score: true,
    },
    orderBy: { createdAt: 'asc' },
  })) as LeadRow[];

  console.log(`待重算线索 ${leads.length} 条\n`);
  let ok = 0;
  let fail = 0;
  for (const lead of leads) {
    const before = lead.score;
    try {
      const channel = await channelFor(lead);
      const result = await scoreService.scoreLeadFromText({
        tenantId: lead.tenantId ?? 'legacy-local-desktop',
        userId: lead.userId,
        leadId: lead.id,
        platform: lead.platform,
        text: lead.sourceText ?? '',
        channel,
      });
      ok += 1;
      console.log(
        `✅ ${lead.id.slice(0, 12)} [${lead.sourceType}/${channel}] ${before} → ${result.totalScore}`,
      );
    } catch (error) {
      fail += 1;
      console.log(`❌ ${lead.id}: ${(error as Error).message}`);
    }
  }
  console.log(`\n完成：成功 ${ok}，失败 ${fail}`);
  await (prisma as never as { $disconnect: () => Promise<void> }).$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
