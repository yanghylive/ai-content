import { Test } from '@nestjs/testing';
import { OutlineService } from './outline.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { MultimodalService } from '../multimodal/multimodal.service';

describe('OutlineService', () => {
  let service: OutlineService;

  const prismaMock = {
    $executeRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    })),
    aIModel: {
      findFirst: jest.fn().mockResolvedValue({ id: 'model-1' }),
    },
  };

  const aiClientMock = {
    generate: jest.fn(),
  };

  const multimodalMock = {
    generateImage: jest.fn(),
  };

  const authMock = {
    get: jest.fn(),
    resolveTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OutlineService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthRequestContextService, useValue: authMock },
        { provide: AiClientService, useValue: aiClientMock },
        { provide: MultimodalService, useValue: multimodalMock },
      ],
    }).compile();

    service = moduleRef.get(OutlineService);
  });

  describe('generateOutline', () => {
    it('调 AI 生成并解析 <page> 分隔的大纲', async () => {
      authMock.get.mockReturnValue({
        user: { id: 'u1', kaypalLocalOnly: true },
      });
      aiClientMock.generate.mockResolvedValue(`<page>
[封面]
标题：一个人到35岁才明白的3个道理
主视觉：深夜书桌前的中年人背影，暖黄台灯
</page>
<page>
[内容]
小标题：道理一：把时间花在复利的事上
要点1：每天读30页书
要点2：技能是资产
</page>
<page>
[总结]
标题：现在开始，永远不晚
收尾：点个关注，下期聊聊复利赛道
</page>`);

      const result = await service.generateOutline('35岁人生感悟', 3);

      expect(result.pages).toHaveLength(3);
      expect(result.pages[0]).toMatchObject({
        type: 'cover',
        title: '一个人到35岁才明白的3个道理',
        points: [],
        imagePrompt: '深夜书桌前的中年人背影，暖黄台灯',
      });
      expect(result.pages[1]).toMatchObject({
        type: 'content',
        title: '道理一：把时间花在复利的事上',
        points: ['每天读30页书', '技能是资产'],
      });
      expect(result.pages[2].type).toBe('summary');
      expect(aiClientMock.generate).toHaveBeenCalledTimes(1);
      // prompt 里应有占位符替换后的主题
      const [, messages] = aiClientMock.generate.mock.calls[0];
      expect(messages[1].content).toContain('35岁人生感悟');
    });

    it('AI 返回空/非法时抛错', async () => {
      authMock.get.mockReturnValue({
        user: { id: 'u1', kaypalLocalOnly: true },
      });
      aiClientMock.generate.mockResolvedValue('随便一段文字没有分页');
      await expect(service.generateOutline('测试')).rejects.toThrow(
        '未返回有效大纲',
      );
    });
  });

  describe('parseContentJson 三段解析容错', () => {
    // 通过 generateOutline 间接不可行，直接测私有解析（js 访问）
    const access = (name: string) =>
      (service as unknown as Record<string, unknown>)[name] as (
        raw: string,
        expected: number,
      ) => {
        titles: string[];
        tags: string[];
        copywriting: Array<Record<string, unknown>>;
      };

    const VALID = {
      titles: ['标题A', '标题B', '标题C'],
      tags: ['标签1', '标签2'],
      copywriting: [
        {
          type: 'cover',
          title: '封面标题',
          content: '封面内容',
          imagePrompt: '封面配图描述',
        },
        {
          type: 'content',
          heading: '小节1',
          content: '内容1',
          imagePrompt: '配图1',
        },
        {
          type: 'summary',
          heading: '总结',
          content: '总结内容',
          imagePrompt: '总结配图',
        },
      ],
    };

    it('第一段：直接 JSON.parse', () => {
      const result = access('parseContentJson')(JSON.stringify(VALID), 3);
      expect(result.titles).toHaveLength(3);
      expect(result.copywriting).toHaveLength(3);
      expect(result.copywriting[1].imagePrompt).toBe('配图1');
    });

    it('第二段：提取 markdown ```json 代码块', () => {
      const wrapped = `这是说明文字\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n结尾说明`;
      const result = access('parseContentJson')(wrapped, 3);
      expect(result.titles).toHaveLength(3);
      expect(result.copywriting[2].type).toBe('summary');
    });

    it('第三段：截取首尾 {}', () => {
      const messy = `模型思考过程：想了一下……\n好了开始输出：${JSON.stringify(VALID)} 以上就是全部内容。`;
      const result = access('parseContentJson')(messy, 3);
      expect(result.titles).toHaveLength(3);
      expect(result.tags).toHaveLength(2);
    });

    it('三段全失败时抛错', () => {
      expect(() =>
        access('parseContentJson')('完全没有JSON结构的文本', 3),
      ).toThrow('解析失败');
    });

    it('copywriting 页数不足时自动补位', () => {
      const short = { ...VALID, copywriting: VALID.copywriting.slice(0, 1) };
      const result = access('parseContentJson')(JSON.stringify(short), 3);
      expect(result.copywriting).toHaveLength(3);
      expect(result.copywriting[2].type).toBe('summary');
    });
  });

  describe('getTask 断点重放', () => {
    it('无权限用户抛 Unauthorized', async () => {
      authMock.get.mockReturnValue({ user: undefined });
      await expect(service.getTask('t1')).rejects.toThrow();
    });

    it('任务不存在抛 NotFound', async () => {
      authMock.get.mockReturnValue({
        user: { id: 'u1', kaypalLocalOnly: true },
      });
      prismaMock.$queryRaw.mockResolvedValue([]);
      await expect(service.getTask('nope')).rejects.toThrow('任务不存在');
    });

    it('返回已落库任务，含重放的 generated 数组', async () => {
      authMock.get.mockReturnValue({
        user: { id: 'u1', kaypalLocalOnly: true },
      });
      prismaMock.$queryRaw.mockResolvedValue([
        {
          id: 't1',
          tenant_id: null,
          user_id: 'u1',
          topic: '测试主题',
          status: 'completed',
          titles: JSON.stringify(['标题A']),
          tags: JSON.stringify(['标签1']),
          pages: JSON.stringify([
            {
              index: 0,
              type: 'cover',
              heading: '封面',
              content: '',
              imagePrompt: 'x',
              status: 'done',
              imageFilename: 'a.png',
            },
          ]),
          generated: JSON.stringify([
            {
              index: 0,
              type: 'cover',
              heading: '封面',
              imageFilename: 'a.png',
              status: 'done',
            },
          ]),
          failed: JSON.stringify([]),
          cover_ref: 'a.png',
          error: null,
          created_at: new Date('2026-08-11T00:00:00Z'),
          updated_at: new Date('2026-08-11T00:01:00Z'),
        },
      ]);

      const task = await service.getTask('t1');
      expect(task.status).toBe('completed');
      expect(task.generated).toHaveLength(1);
      expect(task.coverRef).toBe('a.png');
      expect(task.titles).toEqual(['标题A']);
    });
  });
});
