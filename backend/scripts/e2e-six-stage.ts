// 六步闭环 E2E 验证（重写版 2026-08-18）：
// 走通「内容 → 发布 → 互动 → 线索 → 评分 → 转CRM → 归因 → 复盘」完整链路。
// 相比旧版：独立随机租户（不碰 legacy-local-desktop）、创建真实 Article + PublishRecord、
// 硬断言（任一阶段失败即 exit 1）、只清理本次生成的 ID。
import { strict as assert } from 'node:assert';
import { PrismaClient } from '@prisma/client';
import { LeadSignalStore } from '../src/modules/lead-intelligence/lead-signal.store';
import { LeadScoreService } from '../src/modules/lead-intelligence/lead-score.service';
import { SuppressionService } from '../src/modules/lead-intelligence/suppression.service';
import { QualificationService } from '../src/modules/lead-intelligence/qualification.service';
import { AttributionEventStore } from '../src/modules/attribution/attribution-event.store';
import { IdentityResolverService } from '../src/modules/lead-intelligence/identity-resolver.service';
import { GrowthLeadBridgeService } from '../src/modules/growth/growth-lead-bridge.service';
import { LeadConvertService } from '../src/modules/leads/lead-convert.service';
import { PublishingService } from '../src/modules/publishing/publishing.service';

const prisma = new PrismaClient() as any;

// 本次生成的所有 ID，清理时只删这些（+ 随机租户下的记录），绝不碰历史数据。
const created = {
  accountId: '',
  articleId: '',
  publishRecordId: '',
  leadId: '',
  factTenantId: '',
  userId: '',
};

async function cleanup() {
  // 事实表（tenantId 无外键）：按本次随机租户删
  if (created.factTenantId) {
    await prisma.leadSignal.deleteMany({ where: { tenantId: created.factTenantId } });
    await prisma.leadScoreSnapshot.deleteMany({ where: { tenantId: created.factTenantId } });
    await prisma.attributionLink.deleteMany({ where: { tenantId: created.factTenantId } });
    await prisma.interactionEvent.deleteMany({ where: { tenantId: created.factTenantId } });
    await prisma.platformIdentity.deleteMany({ where: { tenantId: created.factTenantId } });
  }
  // lead / crm（tenantId 有外键，用 null + 随机 owner 隔离）
  if (created.userId) {
    await prisma.crmOpportunity.deleteMany({ where: { ownerId: created.userId } });
    await prisma.crmTask.deleteMany({ where: { ownerId: created.userId } });
    await prisma.crmTimelineEvent.deleteMany({ where: { ownerId: created.userId } });
    await prisma.crmCustomer.deleteMany({ where: { ownerId: created.userId } });
    await prisma.lead.deleteMany({ where: { userId: created.userId } });
  }
  // 内容/发布（按本次 ID；article 删除会 cascade 删 publishRecord）
  if (created.publishRecordId) {
    await prisma.publishRecord.deleteMany({ where: { id: created.publishRecordId } });
  }
  if (created.articleId) {
    await prisma.article.deleteMany({ where: { id: created.articleId } });
  }
  if (created.accountId) {
    await prisma.publishAccount.deleteMany({ where: { id: created.accountId } });
  }
}

async function main() {
  const signalStore = new LeadSignalStore(prisma);
  const leadScore = new LeadScoreService(prisma, signalStore);
  const suppression = new SuppressionService(prisma);
  const qualification = new QualificationService();
  const attribution = new AttributionEventStore(prisma);
  const identityResolver = new IdentityResolverService(prisma);
  const bridge = new GrowthLeadBridgeService(prisma, leadScore, suppression, qualification, attribution);
  const leadConvert = new LeadConvertService(prisma, identityResolver);

  const stamp = Date.now();
  created.factTenantId = `e2e-tenant-${stamp}`;
  created.userId = `e2e-user-${stamp}`;
  created.accountId = `e2e-account-${stamp}`;
  const leadTenantId: string | null = null; // 有外键，用 null 隔离
  const now = new Date().toISOString();

  // ── 第 1 步：内容（创建真实 Article）──
  created.articleId = `e2e-article-${stamp}`;
  const article = await prisma.article.create({
    data: {
      id: created.articleId,
      tenantId: created.factTenantId,
      userId: created.userId,
      title: 'E2E 六步闭环测试文章',
      content: '# E2E 测试\n\n这是六步闭环端到端测试生成的内容。',
      contentType: 'article',
      status: 'published',
    },
  });
  assert.strictEqual(article.id, created.articleId, '第 1 步：内容创建');

  // ── 第 2 步：发布（走真实 PublishingService.publishArticle + stub provider）──
  // 不再手工建 PublishRecord(status=success)；改为调用真实发布服务，让 PublishRecord
  // 走真实的状态流转（pending → success）+ readback 判定 + 归因链落库。
  // 仅 stub 非发布核心依赖：wechatPublisher（平台 provider）、auth context、风险策略、凭据解密。
  const account = await prisma.publishAccount.create({
    data: {
      id: created.accountId,
      tenantId: created.factTenantId,
      userId: created.userId,
      platform: 'wechat',
      name: 'E2E 测试公众号',
      status: 'ready',
      appId: 'wx-e2e-appid',
      apiToken: 'e2e-api-token',
      config: { apiUrl: 'https://mp.idouq.com/api/open/article' },
    },
  });
  assert.ok(account.id, '第 2 步：发布账号创建');

  const wechatPublisherStub = {
    publish: async () => ({
      readback: { matched: true },
      articleId: 'wx-e2e-article-1',
      publishUrl: 'https://mp.weixin.qq.com/s/e2e',
      evidence: [{ type: 'text', label: 'publish-readback', value: 'ok' }],
    }),
  };
  const authCtxStub = {
    get: () => ({ user: { id: created.userId }, sessionId: 'e2e-session' }),
    resolveTenantId: async () => created.factTenantId,
  };
  const riskPolicyStub = { consumeHighRiskApproval: async () => true };
  const credentialStub = {
    decryptString: (s: string) => s,
    decryptSensitiveConfig: (c: unknown) => c,
  };
  const publishing = new PublishingService(
    prisma,
    wechatPublisherStub as never,
    {} as never,
    authCtxStub as never,
    riskPolicyStub as never,
    credentialStub as never,
    {} as never,
    attribution,
  );

  const publishResult = await publishing.publishArticle(
    article.id,
    account.id,
    'e2e-confirmation',
    'https://example.com/e2e-source',
    { contentVersionId: article.id, correlationId: `e2e-correlation-${stamp}` },
  );
  assert.strictEqual(
    publishResult.status,
    'completed',
    '第 2 步：发布完成（readback verified → success）',
  );
  assert.strictEqual(
    publishResult.readback?.matched,
    true,
    '第 2 步：readback 回读匹配',
  );
  created.publishRecordId = publishResult.publishRecordId;

  // ── 第 3 步：线索（构造 GrowthLead，关联发布记录）──
  created.leadId = `e2e-lead-${stamp}`;
  const lead: any = {
    id: created.leadId,
    userId: created.userId,
    tenantId: leadTenantId,
    platform: 'douyin',
    sourceType: 'auto-acquisition',
    sourceTaskId: `e2e-config-${stamp}`,
    sourceRunId: `e2e-run-${stamp}`,
    sourcePublishRecordId: created.publishRecordId,
    nickname: 'E2E 装修咨询-张三',
    profileUrl: 'https://www.douyin.com/user/e2e-zhangsan',
    externalUserId: `douyin-user-${stamp}`,
    sourceText: '最近想装修，本地大概多少钱？加个微信聊一下',
    sourceUrl: 'https://www.douyin.com/video/e2e-12345',
    matchedKeywords: ['多少钱', '加微信'],
    score: 85,
    status: 'new',
    createdAt: now,
    updatedAt: now,
  };

  // ── 第 4 步：线索落库（bridge 的 patchUnifiedLead 与 convert 都需要 lead 已在 leads 表）──
  await prisma.lead.create({
    data: {
      id: lead.id,
      userId: created.userId,
      tenantId: leadTenantId,
      platform: lead.platform,
      sourceType: lead.sourceType,
      sourceTaskId: lead.sourceTaskId,
      sourceRunId: lead.sourceRunId,
      sourcePublishRecordId: created.publishRecordId,
      nickname: lead.nickname,
      profileUrl: lead.profileUrl,
      externalUserId: lead.externalUserId,
      sourceText: lead.sourceText,
      sourceUrl: lead.sourceUrl,
      matchedKeywords: lead.matchedKeywords,
      score: lead.score,
      status: lead.status,
      dedupeKey: `lead:growth:${lead.id}`,
    },
  });
  assert.ok(true, '第 4 步：线索落库');

  // ── 第 5 步：桥接（interactionEvent + 平台身份 + 评分 + 抑制 + 资格）──
  const bridgeResult = await bridge.bridgeAndEnrich(lead, {
    tenantId: created.factTenantId,
    userId: created.userId,
    accountId: account.id,
  });
  assert.ok(bridgeResult.eventId, '第 5 步：桥接生成互动事件');
  assert.ok(bridgeResult.identityId, '第 5 步：桥接生成平台身份');
  assert.ok(bridgeResult.scoreSnapshotId, '第 5 步：桥接生成评分快照');

  // ── 第 6 步：转 CRM（LeadConvertService，带商机 → 真实建 opportunity）──
  const converted = await leadConvert.convert({
    leadId: lead.id,
    scope: { userId: created.userId, tenantId: leadTenantId },
    opportunity: { stage: 'qualified', expectedAmount: 10000, nextStep: 'E2E 跟进' },
  });
  assert.ok(converted.customer?.id, '第 6 步：转 CRM 生成客户');
  assert.ok(converted.opportunityId, '第 6 步：转 CRM 生成商机');

  // 线索 → 客户 归因链
  await bridge.saveLeadResultChain({
    tenantId: created.factTenantId,
    userId: created.userId,
    leadId: lead.id,
    customerId: converted.customer.id,
    opportunityId: converted.opportunityId ?? null,
  });

  // ── 第 6 步：复盘（六步数字硬断言）──
  const contentCount = await prisma.article.count({ where: { id: created.articleId } });
  const publishCount = await prisma.publishRecord.count({ where: { id: created.publishRecordId, status: 'success' } });
  const interactionCount = await prisma.interactionEvent.count({ where: { tenantId: created.factTenantId } });
  const leadCount = await prisma.lead.count({ where: { id: created.leadId } });
  const customerCount = await prisma.crmCustomer.count({ where: { ownerId: created.userId } });
  const opportunityCount = await prisma.crmOpportunity.count({ where: { ownerId: created.userId } });
  const linkCount = await prisma.attributionLink.count({ where: { tenantId: created.factTenantId } });
  const snapshotCount = await prisma.leadScoreSnapshot.count({ where: { tenantId: created.factTenantId, leadId: created.leadId } });

  console.log(`[六步复盘] 内容=${contentCount} 发布=${publishCount} 互动=${interactionCount} 线索=${leadCount} 客户=${customerCount} 商机=${opportunityCount} 归因链=${linkCount} 评分快照=${snapshotCount}`);

  assert.strictEqual(contentCount, 1, '复盘：内容 = 1');
  assert.strictEqual(publishCount, 1, '复盘：发布(success) = 1');
  assert.ok(interactionCount >= 1, '复盘：互动 >= 1');
  assert.strictEqual(leadCount, 1, '复盘：线索 = 1');
  assert.strictEqual(customerCount, 1, '复盘：客户 = 1');
  assert.strictEqual(opportunityCount, 1, '复盘：商机 = 1');
  assert.ok(linkCount >= 2, '复盘：归因链 >= 2（content→publish、lead→customer）');
  assert.ok(snapshotCount >= 1, '复盘：评分快照 >= 1');

  console.log('✅ 六步闭环 E2E 全部断言通过');
}

main()
  .catch(async (e) => {
    console.error('❌ E2E 失败:', e);
    await cleanup().catch(() => {});
    process.exit(1);
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
