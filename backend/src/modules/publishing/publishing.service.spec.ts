import { Test, TestingModule } from '@nestjs/testing';
import { PublishingService } from './publishing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

jest.mock('./wechat-publisher/wechat-publisher.service', () => ({
  WechatPublisherService: class WechatPublisherService {},
}));

describe('PublishingService', () => {
  let service: PublishingService;
  let prisma: {
    publishAccount: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      findUnique: jest.Mock;
    };
    article: {
      findUnique: jest.Mock;
    };
    publishRecord: {
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      publishAccount: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      article: {
        findUnique: jest.fn(),
      },
      publishRecord: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishingService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: WechatPublisherService,
          useValue: {},
        },
        {
          provide: AutoUploadService,
          useValue: {
            listAccounts: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PublishingService>(PublishingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('blocks article one-click publish for local-engine accounts instead of using legacy publishing path', async () => {
    prisma.article.findUnique.mockResolvedValue({
      id: 'article-1',
      title: '测试文章',
      content: '内容',
      contentFormat: 'markdown',
      finalHtml: null,
      coverImage: null,
    });
    prisma.publishAccount.findUnique.mockResolvedValue({
      id: 'local-engine-3',
      platform: 'douyin',
      name: '抖音账号',
      appId: null,
      apiToken: null,
      config: {
        source: 'local-engine',
        platformType: 3,
        filePath: '/profiles/douyin.json',
      },
    });
    prisma.publishRecord.create.mockResolvedValue({ id: 'record-1' });
    prisma.publishRecord.update.mockResolvedValue({});

    await expect(
      service.publishArticle('article-1', 'local-engine-3'),
    ).rejects.toThrow('请进入发布中心选择素材后发布');

    expect(prisma.publishRecord.update).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('不会再走旧 5409'),
      }),
    });
  });
});
