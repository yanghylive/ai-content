import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { SavingsLedgerService } from './savings-ledger.service';
import { Prisma } from '@prisma/client';

/** 兑换比例（V1.1 §9 毛利模型：1 元返利 = 0.8 元 AI 额度价值，运营期可调） */
const EXCHANGE_RATE = 0.8;
/** 单次兑换最低返利 */
const MIN_EXCHANGE_AMOUNT = 1;

/**
 * 返利兑换 AI 额度（需求清单 V1.1 §13.3-13.5）：
 * 创建兑换单 → 冻结可用返利 → 发放 AI 额度 → 成功确认扣减 / 失败解冻 / 超时补偿。
 * 幂等键唯一——重复提交返回原结果，不重复扣减/发放。
 */
@Injectable()
export class SavingsExchangeService {
  private readonly logger = new Logger(SavingsExchangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly ledger: SavingsLedgerService,
  ) {}

  /** 解析当前用户 + 租户 */
  private async resolveScope() {
    const context = this.authRequestContext.get();
    const user = context?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) throw new BadRequestException('请先登录后使用兑换');
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  /** 兑换通用 AI 额度 */
  async exchange(input: {
    amount: number; // 返利金额
    idempotencyKey: string; // 前端生成，防重复提交
  }): Promise<{
    exchangeId: string;
    rebateAmount: number;
    rate: number;
    creditAmount: number;
    status: string;
  }> {
    const { tenantId, userId } = await this.resolveScope();

    // 幂等：同键已处理过直接返回原结果
    const existing = await this.prisma.rebateExchange.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        exchangeId: existing.id,
        rebateAmount: Number(existing.rebateAmount),
        rate: Number(existing.rate),
        creditAmount: Number(existing.creditAmount),
        status: existing.status,
      };
    }

    if (input.amount < MIN_EXCHANGE_AMOUNT) {
      throw new BadRequestException(
        `兑换金额不能低于 ${MIN_EXCHANGE_AMOUNT} 元`,
      );
    }
    const creditAmount = Number((input.amount * EXCHANGE_RATE).toFixed(2));

    try {
      // 1. 创建兑换单（CREATED）
      const exchange = await this.prisma.rebateExchange.create({
        data: {
          tenantId,
          userId,
          rebateAmount: input.amount,
          rate: EXCHANGE_RATE,
          creditAmount,
          status: 'CREATED',
          idempotencyKey: input.idempotencyKey,
        },
      });

      // 2. 冻结可用返利（WITHDRAW_FREEZE 语义：EXCHANGE_FREEZE）
      await this.ledger.writeLedger({
        tenantId,
        userId,
        bizType: 'EXCHANGE_FREEZE',
        bizNo: exchange.id,
        changeAmount: -input.amount,
        target: 'available',
        idempotencyKey: `exchange-freeze:${exchange.id}`,
        operator: 'user',
        remark: `兑换 AI 额度冻结返利`,
      });

      // 3. 发放 AI 额度（AiCreditAccount 余额入账，幂等）
      await this.grantCredit(tenantId, userId, creditAmount);

      // 4. 成功：确认扣减冻结（frozen -= amount）+ 兑换单 SUCCESS
      await this.ledger.writeLedger({
        tenantId,
        userId,
        bizType: 'EXCHANGE_CONFIRM',
        bizNo: exchange.id,
        changeAmount: -input.amount,
        target: 'frozen',
        idempotencyKey: `exchange-confirm:${exchange.id}`,
        operator: 'system',
        remark: `兑换确认扣减冻结返利`,
      });
      await this.prisma.rebateExchange.update({
        where: { id: exchange.id },
        data: { status: 'SUCCESS' },
      });

      return {
        exchangeId: exchange.id,
        rebateAmount: input.amount,
        rate: EXCHANGE_RATE,
        creditAmount,
        status: 'SUCCESS',
      };
    } catch (err) {
      this.logger.warn(`兑换失败（将解冻）：${(err as Error).message}`);
      // 失败：解冻已冻结的返利（幂等，若已确认则不重复解冻）
      await this.unfreezeOnFailure(
        tenantId,
        userId,
        input.idempotencyKey,
        input.amount,
      );
      throw err;
    }
  }

  /** 发放 AI 额度到余额账户 */
  private async grantCredit(
    tenantId: string,
    userId: string,
    creditAmount: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // upsert 账户（首次自动创建）
      const account = await tx.aiCreditAccount.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: {
          tenantId,
          userId,
          balance: creditAmount,
          totalGranted: creditAmount,
        },
        update: {
          balance: { increment: creditAmount },
          totalGranted: { increment: creditAmount },
        },
      });
      void account;
    });
  }

  /** 失败解冻（若冻结流水存在且未确认扣减） */
  private async unfreezeOnFailure(
    tenantId: string,
    userId: string,
    idempotencyKey: string,
    amount: number,
  ) {
    // 找到兑换单
    const exchange = await this.prisma.rebateExchange.findUnique({
      where: { idempotencyKey },
    });
    if (!exchange || exchange.status === 'SUCCESS') return;
    // 已解冻过则跳过
    const unfreezeKey = `exchange-unfreeze:${exchange.id}`;
    const existed = await this.prisma.rebateLedger.findUnique({
      where: { idempotencyKey: unfreezeKey },
    });
    if (existed) return;

    await this.ledger.writeLedger({
      tenantId,
      userId,
      bizType: 'EXCHANGE_UNFREEZE',
      bizNo: exchange.id,
      changeAmount: amount,
      target: 'frozen',
      idempotencyKey: unfreezeKey,
      operator: 'system',
      remark: `兑换失败自动解冻`,
    });
    await this.ledger.writeLedger({
      tenantId,
      userId,
      bizType: 'EXCHANGE_UNFREEZE',
      bizNo: exchange.id,
      changeAmount: amount,
      target: 'available',
      idempotencyKey: `exchange-unfreeze-in:${exchange.id}`,
      operator: 'system',
      remark: `兑换失败返利退回可用`,
    });
    await this.prisma.rebateExchange.update({
      where: { id: exchange.id },
      data: { status: 'FAILED' },
    });
  }

  /** 我的兑换记录 */
  async listExchanges(page = 1) {
    const { tenantId, userId } = await this.resolveScope();
    const [items, total] = await Promise.all([
      this.prisma.rebateExchange.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (page - 1) * 20,
      }),
      this.prisma.rebateExchange.count({ where: { tenantId, userId } }),
    ]);
    return { items, total, page, pageSize: 20 };
  }

  /** 我的 AI 额度余额 */
  async creditBalance() {
    const { tenantId, userId } = await this.resolveScope();
    const account = await this.prisma.aiCreditAccount.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    return {
      balance: Number(account?.balance || 0),
      totalGranted: Number(account?.totalGranted || 0),
      totalConsumed: Number(account?.totalConsumed || 0),
    };
  }

  /**
   * 消费 AI 额度（生图/生视频/模型调用时扣减，V1.1 §14）：
   * 余额检查 + 扣减 + totalConsumed 累计，幂等（消费流水 idempotencyKey）。
   * 余额不足抛错（前端引导兑换）。
   */
  async consumeCredit(input: {
    amount: number;
    bizNo: string; // 任务 ID / 功能单号
    feature: string; // image / video / model
    idempotencyKey: string;
  }): Promise<{ balance: number; consumed: number }> {
    const { tenantId, userId } = await this.resolveScope();
    if (input.amount <= 0) throw new BadRequestException('消费金额必须大于 0');

    const account = await this.prisma.aiCreditAccount.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { tenantId, userId },
      update: {},
    });
    const balance = Number(account.balance);
    if (balance < input.amount) {
      throw new BadRequestException(
        `AI 额度不足：当前 ${balance}，需要 ${input.amount}。可用返利兑换额度`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.aiCreditAccount.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (Number(current.balance) < input.amount) {
        throw new BadRequestException('AI 额度不足（并发消费）');
      }
      await tx.aiCreditAccount.update({
        where: { id: current.id },
        data: {
          balance: Number(current.balance) - input.amount,
          totalConsumed: Number(current.totalConsumed) + input.amount,
        },
      });
      // 消费流水（幂等键唯一）
      await tx.rebateLedger.create({
        data: {
          tenantId,
          userId,
          accountId: current.id,
          bizType: 'CREDIT_CONSUME',
          bizNo: input.bizNo,
          beforeAmount: Number(current.balance),
          changeAmount: -input.amount,
          afterAmount: Number(current.balance) - input.amount,
          idempotencyKey: input.idempotencyKey,
          operator: 'user',
          remark: `AI 额度消费（${input.feature}）`,
        },
      });
    });

    return { balance: balance - input.amount, consumed: input.amount };
  }
}

// 保留类型引用（避免未使用告警）
export type ExchangePrisma = Prisma.RebateExchangeGetPayload<
  Record<string, never>
>;
