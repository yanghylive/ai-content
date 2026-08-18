import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import { InquiryDto } from './dto/inquiry.dto';
import { InquiryRateLimiter } from './inquiry-rate-limiter';
import { computeDedupeHmac, InquiryService } from './inquiry.service';

const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

function makeEnvelope(): CredentialEnvelopeService {
  return new CredentialEnvelopeService({
    get: jest.fn(() => TEST_MASTER_KEY),
  } as unknown as ConfigService);
}

function validDto(overrides: Partial<InquiryDto> = {}): InquiryDto {
  return {
    name: '张先生',
    contactValue: '13800138000',
    contactType: 'phone',
    message: '希望了解适合制造企业的知识库与客服方案',
    consent: true,
    consentVersion: 'privacy-2026-08',
    sourceCaseSlug: 'ai-customer-service-demo',
    ...overrides,
  } as InquiryDto;
}

interface PrismaMock {
  lead: {
    findUnique: jest.Mock;
    create: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  showcaseCase: { findFirst: jest.Mock };
  showcaseCollection: { findFirst: jest.Mock };
}

function makePrisma(overrides: Partial<PrismaMock> = {}): PrismaMock {
  return {
    lead: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'lead-1' }),
    },
    showcaseCase: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'case-1',
        slug: 'ai-customer-service-demo',
      }),
    },
    showcaseCollection: { findFirst: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

describe('InquiryService（咨询落 Lead）', () => {
  it('落 Lead 字段映射正确，联系方式加密不落明文', async () => {
    const prisma = makePrisma();
    const svc = new InquiryService(
      prisma as never,
      makeEnvelope(),
      new InquiryRateLimiter(),
    );

    const result = await svc.submit({
      dto: validDto({ company: '某某公司', position: '业务负责人', preferredTime: '工作日下午' }),
      ip: '127.0.0.1',
    });

    expect(result).toEqual({ inquiryId: 'lead-1' });
    const create = prisma.lead.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(create.data).toMatchObject({
      userId: 'showcase-anonymous',
      tenantId: null,
      platform: 'showcase',
      sourceType: 'showcase',
      sourceUrl: '/cases/ai-customer-service-demo',
      sourceText: '希望了解适合制造企业的知识库与客服方案',
      nickname: '张先生',
    });
    expect(create.data.dedupeKey).toEqual(expect.stringMatching(/^showcase:/));

    // 联系方式只以加密信封形式落库，绝不落明文
    const signals = (create.data.signals as Array<Record<string, unknown>>)[0];
    expect(signals.contactValueEncrypted).toEqual(
      expect.stringMatching(/^enc:v1:/),
    );
    expect(JSON.stringify(create.data)).not.toContain('13800138000');
    expect(JSON.stringify(create.data)).not.toContain('"contactValue"');
  });

  it('幂等去重：重复提交不新增，返回同一咨询编号', async () => {
    const prisma = makePrisma({
      lead: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: 'lead-1' }),
        create: jest.fn().mockResolvedValue({ id: 'lead-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      },
    });
    const svc = new InquiryService(
      prisma as never,
      makeEnvelope(),
      new InquiryRateLimiter(),
    );

    const first = await svc.submit({ dto: validDto(), ip: '127.0.0.1' });
    const second = await svc.submit({ dto: validDto(), ip: '127.0.0.1' });

    expect(first).toEqual({ inquiryId: 'lead-1' });
    expect(second).toEqual({ inquiryId: 'lead-1' });
    expect(prisma.lead.create).toHaveBeenCalledTimes(1);
    expect(prisma.lead.findUnique).toHaveBeenCalledTimes(2);
  });

  it('来源 slug 解析：伪造案例 slug 被拒绝', async () => {
    const prisma = makePrisma({
      showcaseCase: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const svc = new InquiryService(
      prisma as never,
      makeEnvelope(),
      new InquiryRateLimiter(),
    );

    await expect(
      svc.submit({
        dto: validDto({ sourceCaseSlug: 'forged-slug' }),
        ip: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('联系方式绝不出现明文响应', async () => {
    const prisma = makePrisma();
    const svc = new InquiryService(
      prisma as never,
      makeEnvelope(),
      new InquiryRateLimiter(),
    );

    const result = await svc.submit({
      dto: validDto({ contactValue: 'secret-contact-13800138000' }),
      ip: '127.0.0.1',
    });

    expect(JSON.stringify(result)).not.toContain('secret-contact-13800138000');
    expect(Object.keys(result)).toEqual(['inquiryId']);
  });

  it('限流触发：超过窗口上限返回 429', async () => {
    const prisma = makePrisma();
    const svc = new InquiryService(
      prisma as never,
      makeEnvelope(),
      new InquiryRateLimiter(60_000, 1),
    );

    await svc.submit({ dto: validDto(), ip: '127.0.0.1' });
    await expect(
      svc.submit({ dto: validDto(), ip: '127.0.0.1' }),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      svc.submit({ dto: validDto(), ip: '127.0.0.1' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(prisma.lead.create).toHaveBeenCalledTimes(1);
  });

  it('未同意隐私政策时拒绝提交', async () => {
    const prisma = makePrisma();
    const svc = new InquiryService(
      prisma as never,
      makeEnvelope(),
      new InquiryRateLimiter(),
    );

    await expect(
      svc.submit({ dto: validDto({ consent: false }), ip: '127.0.0.1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('去重键为 HMAC-SHA256 且确定（同密钥同输入同摘要，异密钥异摘要）', () => {
    const a = computeDedupeHmac('secret-a', '13800138000|||privacy-2026-08|2026-08-18');
    const b = computeDedupeHmac('secret-a', '13800138000|||privacy-2026-08|2026-08-18');
    const c = computeDedupeHmac('secret-b', '13800138000|||privacy-2026-08|2026-08-18');

    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(c).not.toEqual(a);
  });

  it('配置 PUBLIC_SITE_ORIGIN 后 sourceUrl 带站点前缀；未配置时回退相对路径', async () => {
    const previous = process.env.PUBLIC_SITE_ORIGIN;
    const prisma = makePrisma();
    const svc = new InquiryService(
      prisma as never,
      makeEnvelope(),
      new InquiryRateLimiter(),
    );

    try {
      // 未配置 → 相对路径
      delete process.env.PUBLIC_SITE_ORIGIN;
      await svc.submit({ dto: validDto(), ip: '127.0.0.1' });
      let create = prisma.lead.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(create.data.sourceUrl).toBe('/cases/ai-customer-service-demo');

      // 配置 → 绝对地址前缀
      process.env.PUBLIC_SITE_ORIGIN = 'https://showcase.example.com';
      prisma.lead.create.mockClear();
      await svc.submit({ dto: validDto(), ip: '127.0.0.2' });
      create = prisma.lead.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(create.data.sourceUrl).toBe(
        'https://showcase.example.com/cases/ai-customer-service-demo',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.PUBLIC_SITE_ORIGIN;
      } else {
        process.env.PUBLIC_SITE_ORIGIN = previous;
      }
    }
  });
});
