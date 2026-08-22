import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaiUiService } from './mai-ui.service';

/** MAI-UI 专用测试（P5 门禁 2026-08-22）：模型断链修复 + 动作校验 */
describe('MaiUiService', () => {
  function makeService(overrides: {
    prisma?: Record<string, jest.Mock>;
    aiClient?: Record<string, jest.Mock>;
  }) {
    const prisma = {
      aIModel: { findFirst: jest.fn() },
      ...(overrides.prisma || {}),
    };
    const aiClient = {
      generateWithImage: jest.fn(),
      ...(overrides.aiClient || {}),
    };
    const service = new MaiUiService(aiClient as never, prisma as never);
    return { service, prisma, aiClient };
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
    const { service, prisma } = makeService({});
    prisma.aIModel.findFirst.mockResolvedValue(null);
    await expect(service.planActions(validInput)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.planActions(validInput)).rejects.toThrow(
      /kaypal-vision \/ cmsvis0001visionkaypalvl/,
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
