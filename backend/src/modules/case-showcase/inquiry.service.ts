import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryDto } from './dto/inquiry.dto';
import { InquiryRateLimiter } from './inquiry-rate-limiter';
import { InquiryRecord } from './field-whitelist';

/**
 * 咨询落 Lead 服务（M5 · 价值链终点：发现→理解→体验→咨询）。
 *
 * 复用现有 Lead 表（不新建 ShowcaseInquiry 表），与 CRM 商机打通。
 * 公开端完全匿名：userId 用固定哨兵 `showcase-anonymous`，tenantId 置 null，
 * 去重依赖 Lead 的 `@@unique([userId, dedupeKey])` 复合唯一约束。
 *
 * 安全边界：
 *   - 联系方式经 credential-envelope（AES-256-GCM）加密后才落库，绝不落明文；
 *   - 来源按 slug 服务端重新解析，不信任客户端传入的内部 ID；
 *   - dedupeKey = showcase:HMAC-SHA256(serverSecret, contactValue | caseSlug |
 *     collectionSlug | consentVersion | 当日窗口)，重复提交返回同一 inquiry_id；
 *   - 进程内按 IP+联系方式 限流，M6 可换 Redis；
 *   - 响应仅回咨询编号，绝不回显联系方式/完整记录。
 *
 * 复用说明：本服务直接经 PrismaService 写入 Lead（而非 LeadRepository.upsert），
 * 因 M5 去重键算法与 LeadRepository.dedupeKeyOf（外部用户 ID/昵称兜底）不同，
 * 但复用了相同的 `userId_dedupeKey` 唯一约束与 P2002 竞态回查处理模式。
 */

/** 公开匿名线索的 userId 哨兵（Lead.userId 非空且无外键） */
export const SHOWCASE_ANONYMOUS_USER_ID = 'showcase-anonymous';
/** Lead.platform / Lead.sourceType 统一标注为 showcase，与 comment/dm 等来源区分 */
export const SHOWCASE_PLATFORM = 'showcase';
export const SHOWCASE_SOURCE_TYPE = 'showcase';
/** 联系方式加密信封 AAD 上下文（字段级，防止密文跨字段换用） */
export const CONTACT_ENCRYPTION_CONTEXT = 'showcase-inquiry-contact';

/** 去重密钥环境变量名（优先） */
export const SHOWCASE_DEDUPE_SECRET_ENV = 'SHOWCASE_DEDUPE_SECRET';
/** 去重密钥环境变量名（回退：复用凭据主密钥） */
export const SHOWCASE_DEDUPE_SECRET_FALLBACK_ENV =
  'KAYPAL_CREDENTIAL_MASTER_KEY';
/**
 * 开发兜底去重密钥（仅两个环境变量均缺失时使用）。
 * TODO: 生产环境必须显式配置 SHOWCASE_DEDUPE_SECRET，
 *       否则跨环境/跨部署去重键不稳定（同一个人可能被判定为新线索）。
 */
const DEV_DEDUPE_SECRET = 'showcase-dev-dedupe-secret-do-not-use-in-prod';

/** 站点公开地址环境变量名（咨询来源 URL 前缀） */
export const PUBLIC_SITE_ORIGIN_ENV = 'PUBLIC_SITE_ORIGIN';

/**
 * HMAC-SHA256 计算去重摘要（导出供单测验证确定性与密钥隔离性）。
 * 采用 HMAC 而非裸 SHA-256：即使攻击者已知拼接规则，无 serverSecret 也无法
 * 离线枚举联系方式构造碰撞，避免通过 dedupeKey 侧信道探测线索是否存在。
 */
export function computeDedupeHmac(secret: string, raw: string): string {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

export interface InquirySubmitInput {
  dto: InquiryDto;
  /** 客户端 IP（供限流键使用；缺失时降级为 unknown） */
  ip?: string;
}

/** 服务端重新解析出的来源信息 */
interface ResolvedSource {
  sourceUrl: string | null;
  sourceCaseSlug: string | null;
  sourceCollectionSlug: string | null;
  sourceCaseId: string | null;
  sourceCollectionId: string | null;
}

@Injectable()
export class InquiryService {
  private readonly logger = new Logger(InquiryService.name);

  /** HMAC 去重密钥（构造时解析一次，跨请求稳定） */
  private readonly dedupeSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: CredentialEnvelopeService,
    private readonly rateLimiter: InquiryRateLimiter,
  ) {
    this.dedupeSecret = this.resolveDedupeSecret();
  }

  /** 解析去重密钥：SHOWCASE_DEDUPE_SECRET → KAYPAL_CREDENTIAL_MASTER_KEY → dev 兜底 */
  private resolveDedupeSecret(): string {
    const configured = process.env[SHOWCASE_DEDUPE_SECRET_ENV]?.trim();
    if (configured) return configured;
    const fallback = process.env[SHOWCASE_DEDUPE_SECRET_FALLBACK_ENV]?.trim();
    if (fallback) return fallback;
    // TODO: 生产环境必须配置 SHOWCASE_DEDUPE_SECRET（见常量定义处说明）
    this.logger.warn(
      `${SHOWCASE_DEDUPE_SECRET_ENV} 与 ${SHOWCASE_DEDUPE_SECRET_FALLBACK_ENV} 均未配置，` +
        `咨询去重密钥回退为固定开发值（跨环境不安全，请在生产环境显式配置）`,
    );
    return DEV_DEDUPE_SECRET;
  }

  /** 站点公开地址前缀（未配置时回退相对路径） */
  private get publicSiteOrigin(): string {
    return process.env[PUBLIC_SITE_ORIGIN_ENV]?.trim() ?? '';
  }

  /** 提交咨询：落 Lead + 幂等去重 + 限流 + 加密，返回咨询编号 */
  async submit(input: InquirySubmitInput): Promise<InquiryRecord> {
    const { dto } = input;

    // 1) 防御性校验（controller 已走 class-validator，此处兜底防绕过）
    if (dto.consent !== true) {
      throw new BadRequestException('请先同意隐私政策与联系用途');
    }
    const contactValue = (dto.contactValue ?? '').trim();
    if (!contactValue) {
      throw new BadRequestException('联系方式不能为空');
    }
    this.assertContactFormat(dto.contactType, contactValue);

    // 2) 限流（按 IP + 联系方式哈希，进程内固定窗口计数）
    const rateKey = crypto
      .createHash('sha256')
      .update(`${input.ip ?? 'unknown'}|${contactValue}`)
      .digest('hex');
    if (!this.rateLimiter.allow(rateKey)) {
      throw new HttpException(
        '提交过于频繁，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 3) 服务端重新解析来源（不信任客户端内部 ID）
    const source = await this.resolveSource(dto);

    // 4) 联系方式加密落库（绝不落明文）
    const contactValueEncrypted = this.envelope.encryptString(
      contactValue,
      CONTACT_ENCRYPTION_CONTEXT,
    );

    // 5) 幂等去重键：hash(contact + case slug + collection slug + consent + 当日)
    const dedupeKey = this.buildDedupeKey(dto, contactValue, source);
    const where = {
      userId_dedupeKey: {
        userId: SHOWCASE_ANONYMOUS_USER_ID,
        dedupeKey,
      },
    } as const;

    // 6) 去重：已存在返回同一线索（不新增）
    const existing = await this.prisma.lead.findUnique({
      where: where,
      select: { id: true },
    });
    if (existing) {
      return { inquiryId: existing.id };
    }

    // 7) 落 Lead（字段映射见 JIRA 决策：name→nickname、requirement→sourceText、
    //    source_case→sourceUrl、channel_code/联系方式→signals 加密）
    const signals: Prisma.InputJsonValue = [
      {
        source: 'showcase_inquiry',
        sourceCaseSlug: source.sourceCaseSlug,
        sourceCollectionSlug: source.sourceCollectionSlug,
        sourceCaseId: source.sourceCaseId,
        sourceCollectionId: source.sourceCollectionId,
        channelCode: dto.channelCode?.trim() || null,
        contactType: dto.contactType ?? 'other',
        contactValueEncrypted,
        name: dto.name?.trim() ?? null,
        company: dto.company?.trim() || null,
        position: dto.position?.trim() || null,
        preferredTime: dto.preferredTime?.trim() || null,
        consent: true,
        consentVersion: dto.consentVersion?.trim() || null,
        idempotencyKey: dto.idempotencyKey?.trim() || null,
      },
    ];

    try {
      const lead = await this.prisma.lead.create({
        data: {
          userId: SHOWCASE_ANONYMOUS_USER_ID,
          tenantId: null,
          platform: SHOWCASE_PLATFORM,
          sourceType: SHOWCASE_SOURCE_TYPE,
          sourceUrl: source.sourceUrl,
          sourceText: dto.message?.trim() ?? null,
          nickname: dto.name?.trim() ?? null,
          externalUserId: null,
          dedupeKey,
          signals,
          status: 'pending',
          score: 0,
          scoreReasons: [],
          matchedKeywords: [],
        },
        select: { id: true },
      });
      return { inquiryId: lead.id };
    } catch (error) {
      // 竞态：并发同 dedupeKey 撞唯一约束（P2002）时回查返回已有线索
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.lead.findUniqueOrThrow({
          where: where,
          select: { id: true },
        });
        return { inquiryId: raced.id };
      }
      this.logger.error(
        `咨询落 Lead 失败：${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /** 按 slug 服务端重新解析来源案例/合集；伪造/失效 slug 一律拒绝 */
  private async resolveSource(dto: InquiryDto): Promise<ResolvedSource> {
    const sourceCaseSlug = dto.sourceCaseSlug?.trim() || null;
    const sourceCollectionSlug = dto.sourceCollectionSlug?.trim() || null;

    let sourceUrl: string | null = null;
    let sourceCaseId: string | null = null;
    let sourceCollectionId: string | null = null;

    if (sourceCaseSlug) {
      const caseRecord = await this.prisma.showcaseCase.findFirst({
        where: { slug: sourceCaseSlug, status: 'published' },
        select: { id: true, slug: true },
      });
      if (!caseRecord) {
        throw new BadRequestException('来源案例不存在或已下线');
      }
      sourceCaseId = caseRecord.id;
      sourceUrl = `${this.publicSiteOrigin}/cases/${caseRecord.slug}`;
    }

    if (sourceCollectionSlug) {
      const collection = await this.prisma.showcaseCollection.findFirst({
        where: {
          slug: sourceCollectionSlug,
          status: 'published',
          visibility: { in: ['public', 'link_only'] },
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
        },
        select: { id: true, slug: true },
      });
      if (!collection) {
        throw new BadRequestException('来源合集不存在或已失效');
      }
      sourceCollectionId = collection.id;
      // 案例与合集同时给出时优先更具体的案例公开 URL
      if (!sourceUrl) {
        sourceUrl = `${this.publicSiteOrigin}/collections/${collection.slug}`;
      }
    }

    return {
      sourceUrl,
      sourceCaseSlug,
      sourceCollectionSlug,
      sourceCaseId,
      sourceCollectionId,
    };
  }

  /**
   * 去重键：showcase:HMAC-SHA256(serverSecret, contact|caseSlug|collectionSlug|consent|当日)。
   * 密钥前缀 showcase: 用于标识本模块产出的键；HMAC 保证无密钥者无法构造/碰撞。
   */
  private buildDedupeKey(
    dto: InquiryDto,
    contactValue: string,
    source: ResolvedSource,
  ): string {
    const dayWindow = new Date().toISOString().slice(0, 10);
    const raw = [
      contactValue,
      source.sourceCaseSlug ?? '',
      source.sourceCollectionSlug ?? '',
      dto.consentVersion?.trim() ?? '',
      dayWindow,
    ].join('|');
    return `showcase:${computeDedupeHmac(this.dedupeSecret, raw)}`;
  }

  /** 轻量联系方式格式校验（避免过度收集，仅 phone/email 做基本形状检查） */
  private assertContactFormat(contactType: string | undefined, value: string) {
    if (contactType === 'email') {
      const valid =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
      if (!valid) {
        throw new BadRequestException('邮箱格式不正确');
      }
    } else if (contactType === 'phone') {
      const digits = value.replace(/[^0-9]/g, '');
      if (digits.length < 5 || digits.length > 20) {
        throw new BadRequestException('手机号格式不正确');
      }
    }
  }
}
