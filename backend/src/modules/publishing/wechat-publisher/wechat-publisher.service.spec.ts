import { Test, TestingModule } from '@nestjs/testing';
import { WechatPublisherService } from './wechat-publisher.service';

jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((markdown: string) => `<p>${markdown}</p>`),
  },
}));

describe('WechatPublisherService', () => {
  let service: WechatPublisherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WechatPublisherService],
    }).compile();

    service = module.get<WechatPublisherService>(WechatPublisherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
