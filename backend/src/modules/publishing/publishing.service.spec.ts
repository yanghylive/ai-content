import { Test, TestingModule } from '@nestjs/testing';
import { PublishingService } from './publishing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

describe('PublishingService', () => {
  let service: PublishingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishingService,
        {
          provide: PrismaService,
          useValue: {
            publishAccount: {
              findMany: jest.fn(),
              upsert: jest.fn(),
            },
          },
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
});
