import { BadRequestException } from '@nestjs/common';
import { VideoService } from './video.service';

describe('VideoService product-cut', () => {
  let studioCoreProxy: any;
  let autoUpload: any;
  let service: VideoService;

  beforeEach(() => {
    studioCoreProxy = {
      postGenerate: jest.fn(async (dto: any) => ({
        projectId: 'proj-1',
        ...dto,
      })),
    };
    autoUpload = {};
    service = new VideoService(studioCoreProxy, autoUpload);
  });

  describe('buildProductCopy', () => {
    it('空商品名抛 BadRequest', () => {
      expect(() =>
        service.buildProductCopy({ productName: '  ' }),
      ).toThrow(BadRequestException);
    });

    it('无卖点时生成 钩子+CTA 两段', () => {
      const script = service.buildProductCopy({
        productName: '养生壶',
        durationSeconds: 10,
      });
      expect(script.segments.length).toBe(2);
      expect(script.copy).toContain('养生壶');
      expect(script.copy).toContain('评论区扣1');
      expect(script.usedAi).toBe(false);
    });

    it('含卖点+价格时生成完整分镜', () => {
      const script = service.buildProductCopy({
        productName: '筋膜枪',
        sellingPoints: ['静音电机', '三档力度', '长续航'],
        price: '199',
      });
      expect(script.segments.length).toBeGreaterThanOrEqual(4);
      expect(script.copy).toContain('静音电机');
      expect(script.copy).toContain('只要 199');
      // 每段都有画面提示
      for (const seg of script.segments) {
        expect(seg.visual).toBeTruthy();
        expect(seg.seconds).toBeGreaterThan(0);
      }
    });

    it('卖点最多取 5 个', () => {
      const script = service.buildProductCopy({
        productName: '咖啡机',
        sellingPoints: ['1', '2', '3', '4', '5', '6', '7'],
      });
      // 钩子 + 5 卖点 + CTA = 7 段（无价格）
      expect(script.segments.length).toBe(7);
    });
  });

  describe('productCut', () => {
    it('组装带货 prompt 并调 promo 管线', async () => {
      const result = await service.productCut({
        productName: '扫地机器人',
        sellingPoints: ['激光导航', '自动回充'],
        price: 1299,
        imageUrl: 'https://img.example.com/robot.jpg',
        user_id: 'user-9',
      });
      expect(studioCoreProxy.postGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          pipeline: 'promo',
          user_id: 'user-9',
        }),
      );
      const prompt = studioCoreProxy.postGenerate.mock.calls[0][0].prompt;
      expect(prompt).toContain('扫地机器人');
      expect(prompt).toContain('激光导航');
      expect(prompt).toContain('https://img.example.com/robot.jpg');
      expect(result.projectId).toBe('proj-1');
    });

    it('空商品名直接抛错不调 proxy', async () => {
      await expect(
        service.productCut({ productName: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(studioCoreProxy.postGenerate).not.toHaveBeenCalled();
    });
  });
});
