import { ContentQualityGateService } from './content-quality-gate.service';

function createService() {
  const prisma = {
    contentVariant: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new ContentQualityGateService(prisma as any);
  return { service, prisma };
}

const BASE_INPUT = {
  content: '这是一篇正常的产品介绍，介绍装修流程和避坑要点。',
  title: '装修避坑指南',
  platform: 'article',
  cta: '评论区留言咨询',
  trackingUrl: 'https://example.com/t?ref=a1',
  materialCount: 1,
  tags: ['装修'],
  links: ['https://example.com'],
};

describe('ContentQualityGateService（方案 5.3 六项检查）', () => {
  it('完整合规的内容判定为 pass', async () => {
    const { service } = createService();
    const result = await service.check(BASE_INPUT as any);
    expect(result.verdict).toBe('pass');
    expect(result.checks).toHaveLength(6);
  });

  it('命中绝对化承诺 → block', async () => {
    const { service } = createService();
    const result = await service.check({
      ...BASE_INPUT,
      content: '用了我们的产品，百分百稳赚，立即见效。',
    } as any);
    expect(result.verdict).toBe('block');
    const claim = result.checks.find((c) => c.key === 'absolute_claim');
    expect(claim?.status).toBe('block');
    expect(claim?.matchedText).toContain('百分百');
  });

  it('效果类表述缺证据来源 → warning（evidence）', async () => {
    const { service } = createService();
    const result = await service.check({
      ...BASE_INPUT,
      content: '使用后收益明显提升，翻倍增长。',
    } as any);
    const evidence = result.checks.find((c) => c.key === 'evidence');
    expect(evidence?.status).toBe('warning');
  });

  it('有证据来源时 evidence 为 pass', async () => {
    const { service } = createService();
    const result = await service.check({
      ...BASE_INPUT,
      content: '根据实测数据，收益提升明显。',
      evidenceSources: ['内部实测报告 2026-08'],
    } as any);
    const evidence = result.checks.find((c) => c.key === 'evidence');
    expect(evidence?.status).toBe('pass');
  });

  it('缺标题 → platform_format block', async () => {
    const { service } = createService();
    const result = await service.check({ ...BASE_INPUT, title: '' } as any);
    expect(result.verdict).toBe('block');
    const fmt = result.checks.find((c) => c.key === 'platform_format');
    expect(fmt?.status).toBe('block');
    expect(fmt?.reason).toContain('缺少标题');
  });

  it('标题超长 → platform_format block', async () => {
    const { service } = createService();
    const result = await service.check({
      ...BASE_INPUT,
      platform: 'xiaohongshu',
      title: '这个标题实在是太长了，超过了小红书二十个字的上限要求',
    } as any);
    const fmt = result.checks.find((c) => c.key === 'platform_format');
    expect(fmt?.status).toBe('block');
  });

  it('与历史内容重复 → warning（duplicate）', async () => {
    const { service, prisma } = createService();
    prisma.contentVariant.findFirst.mockResolvedValue({ id: 'cv-1' });
    const result = await service.check(BASE_INPUT as any);
    const dup = result.checks.find((c) => c.key === 'duplicate');
    expect(dup?.status).toBe('warning');
  });

  it('查重库不可用 → unavailable（不 fail-open 也不 block）', async () => {
    const { service, prisma } = createService();
    prisma.contentVariant.findFirst.mockRejectedValue(new Error('db down'));
    const result = await service.check(BASE_INPUT as any);
    const dup = result.checks.find((c) => c.key === 'duplicate');
    expect(dup?.status).toBe('unavailable');
    // unavailable 不升级为 block，其余全 pass 时整体 pass
    expect(result.verdict).toBe('pass');
  });

  it('有 CTA 但缺追踪链接 → warning（cta）', async () => {
    const { service } = createService();
    const result = await service.check({
      ...BASE_INPUT,
      trackingUrl: '',
    } as any);
    const cta = result.checks.find((c) => c.key === 'cta');
    expect(cta?.status).toBe('warning');
    expect(cta?.suggestions.join()).toContain('追踪');
  });

  it('完全无 CTA → warning（cta）', async () => {
    const { service } = createService();
    const result = await service.check({ ...BASE_INPUT, cta: '' } as any);
    const cta = result.checks.find((c) => c.key === 'cta');
    expect(cta?.status).toBe('warning');
  });

  it('小红书缺素材和标签 → warning（asset_completeness）', async () => {
    const { service } = createService();
    const result = await service.check({
      ...BASE_INPUT,
      platform: 'xiaohongshu',
      title: '短标题',
      materialCount: 0,
      tags: [],
    } as any);
    const asset = result.checks.find((c) => c.key === 'asset_completeness');
    expect(asset?.status).toBe('warning');
    expect(asset?.reason).toContain('素材');
  });

  it('verdict 聚合：任一 block → block；任一 warning → warning', async () => {
    const { service } = createService();
    const blocked = await service.check({
      ...BASE_INPUT,
      content: '绝对有效，稳赚不赔。',
      cta: '',
    } as any);
    expect(blocked.verdict).toBe('block');

    const warned = await service.check({ ...BASE_INPUT, cta: '' } as any);
    expect(warned.verdict).toBe('warning');
  });
});
