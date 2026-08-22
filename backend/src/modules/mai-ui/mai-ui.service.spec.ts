import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaiUiService } from './mai-ui.service';

/** MAI-UI 专用测试（P5 门禁 2026-08-22）：模型断链修复 + 动作校验 */
describe('MaiUiService', () => {
  function makeService(overrides: {
    prisma?: Record<string, jest.Mock>;
    aiClient?: Record<string, jest.Mock>;
    config?: Record<string, jest.Mock>;
  }) {
    const prisma = {
      aIModel: { findFirst: jest.fn() },
      aIPlatform: { upsert: jest.fn() },
      ...(overrides.prisma || {}),
    };
    const aiClient = {
      generateWithImage: jest.fn(),
      ...(overrides.aiClient || {}),
    };
    const config = {
      get: jest.fn().mockReturnValue(undefined),
      ...(overrides.config || {}),
    };
    const service = new MaiUiService(
      aiClient as never,
      prisma as never,
      config as never,
    );
    return { service, prisma, aiClient, config };
  }

  const validInput = {
    imageBase64: 'x'.repeat(200),
    instruction: '点击搜索框输入装修',
    width: 500,
    height: 740,
  };

  it('模型查找：按别名列表 + enabled 过滤（断链修复）', async () => {
    const { service, prisma, aiClient } = makeService({});
    prisma.aIModel.findFirst.mockResolvedValue({
      id: 'm-1',
      modelId: 'cmsvis0001visionkaypalvl',
      enabled: true,
      platform: {},
    });
    aiClient.generateWithImage.mockResolvedValue('[{"action":"back"}]');
    await service.planActions(validInput);
    // 查询条件：别名列表（含本机注册名）+ enabled 过滤
    expect(prisma.aIModel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          modelId: {
            in: ['kaypal-vision', 'cmsvis0001visionkaypalvl'],
          },
          enabled: true,
        },
        include: { platform: true },
      }),
    );
  });

  it('模型不存在/全部禁用：抛 404（含两个别名提示）', async () => {
    const { service, prisma, config } = makeService({});
    prisma.aIModel.findFirst.mockResolvedValue(null);
    config.get.mockReturnValue(undefined); // 无 kaypal env → 不懒创建
    await expect(service.planActions(validInput)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.planActions(validInput)).rejects.toThrow(
      /kaypal-vision \/ cmsvis0001visionkaypalvl/,
    );
    // 懒创建未触发（无 env 配置）
    expect(prisma.aIPlatform.upsert).not.toHaveBeenCalled();
  });

  it('P1 懒创建：干净环境缺模型但有 kaypal env 时自动落地启用记录', async () => {
    const { service, prisma, config, aiClient } = makeService({});
    // 第一次查不到（干净库）→ ensureVisionModel 创建 → 第二次查到
    prisma.aIModel.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'm-seeded',
        modelId: 'kaypal-vision',
        enabled: true,
        platform: { id: 'p-kaypal' },
      });
    prisma.aIPlatform.upsert.mockResolvedValue({ id: 'p-kaypal' });
    prisma.aIModel.upsert = jest.fn().mockResolvedValue({ id: 'm-seeded' });
    config.get.mockImplementation((key: string) =>
      key === 'KAYPAL_AI_PROXY_BASE_URL'
        ? 'https://kaypal.cn/api/ai'
        : key === 'KAYPAL_AI_PROXY_API_KEY'
          ? 'server-key'
          : undefined,
    );
    aiClient.generateWithImage.mockResolvedValue('[{"action":"back"}]');
    const result = await service.planActions(validInput);
    expect(result.ok).toBe(true);
    // 平台 + 模型均被 upsert（懒创建落地）
    expect(prisma.aIPlatform.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'Kaypal 模型台' },
        create: expect.objectContaining({ baseUrl: 'https://kaypal.cn/api/ai' }),
      }),
    );
    expect(prisma.aIModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platformId_modelId: {
            platformId: 'p-kaypal',
            modelId: 'kaypal-vision',
          },
        },
        create: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it('动作校验：类型白名单剔除非法规动作 + 留痕', async () => {
    const { service, prisma, aiClient } = makeService({});
    prisma.aIModel.findFirst.mockResolvedValue({
      id: 'm-1',
      modelId: 'kaypal-vision',
      enabled: true,
      platform: {},
    });
    aiClient.generateWithImage.mockResolvedValue(
      JSON.stringify([
        { action: 'click', target: '搜索框', bounds: [10, 10, 100, 50] },
        { action: 'evaluate_js', code: 'alert(1)' }, // 非法类型
        { action: 'back' },
      ]),
    );
    const result = await service.planActions(validInput);
    expect(result.ok).toBe(true);
    expect(result.actions).toHaveLength(2); // 非法项被剔除
    expect(result.rejectedActions?.[0]).toContain('未知动作类型');
  });

  it('动作校验：bounds 超出截图范围被剔除', async () => {
    const { service, prisma, aiClient } = makeService({});
    prisma.aIModel.findFirst.mockResolvedValue({
      id: 'm-1',
      modelId: 'kaypal-vision',
      enabled: true,
      platform: {},
    });
    aiClient.generateWithImage.mockResolvedValue(
      JSON.stringify([
        { action: 'click', target: '越界按钮', bounds: [10, 10, 9999, 9999] },
        { action: 'done', summary: '完成' },
      ]),
    );
    const result = await service.planActions(validInput);
    // 越界 click 被剔除，仅剩 done
    expect(result.actions).toHaveLength(1);
    expect(result.rejectedActions?.[0]).toContain('超出截图范围');
  });

  it('动作校验：数量上限 20 截断 + 留痕', async () => {
    const { service, prisma, aiClient } = makeService({});
    prisma.aIModel.findFirst.mockResolvedValue({
      id: 'm-1',
      modelId: 'kaypal-vision',
      enabled: true,
      platform: {},
    });
    const many = Array.from({ length: 25 }, () => ({ action: 'back' }));
    aiClient.generateWithImage.mockResolvedValue(JSON.stringify(many));
    const result = await service.planActions(validInput);
    expect(result.actions).toHaveLength(20);
    expect(result.rejectedActions?.[0]).toContain('超过上限');
  });

  it('输入校验：空截图/空指令/过短截图 拒绝', async () => {
    const { service } = makeService({});
    await expect(
      service.planActions({ ...validInput, imageBase64: '' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.planActions({ ...validInput, instruction: '' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.planActions({ ...validInput, imageBase64: 'short' }),
    ).rejects.toThrow(BadRequestException);
  });
});
