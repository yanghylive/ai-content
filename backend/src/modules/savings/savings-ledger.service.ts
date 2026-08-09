import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RebateLedger, RebateAccount } from '@prisma/client';

/**
 * 返利账本核心（需求清单 V1.1 §7.4）：
 * 每次资产变化必须写不可变流水（RebateLedger），事务保证账户余额与流水一致。
 * 幂等键唯一——重复提交返回原结果，不重复扣减/发放。
 */
@Injectable()
export class SavingsLedgerService {
  private readonly logger = new Logger(SavingsLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 确保返利账户存在（首次访问自动创建） */
  async ensureAccount(
    tenantId: string,
    userId: string,
  ): Promise<RebateAccount> {
    const existing = await this.prisma.rebateAccount.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.rebateAccount.create({
        data: { tenantId, userId },
      });
    } catch {
      // 并发创建竞态：已存在则返回
      return this.prisma.rebateAccount.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId, userId } },
      });
    }
  }

  /**
   * 通用账本事务：读账户 → 校验 → 写流水 → 更新账户余额。
   * 幂等：同 idempotencyKey 重复调用返回已有流水（不重复扣减/发放）。
   */
  async writeLedger(input: {
    tenantId: string;
    userId: string;
    bizType: string;
    bizNo: string;
    changeAmount: number; // 正数增加可用，负数扣减
    target: 'available' | 'pending' | 'frozen';
    idempotencyKey: string;
    operator: string;
    remark?: string;
  }): Promise<RebateLedger> {
    // 幂等检查：同键已存在直接返回
    const existing = await this.prisma.rebateLedger.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return existing;
    }

    const { tenantId, userId } = input;
    return this.prisma.$transaction(async (tx) => {
      const account = await this.ensureAccount(tenantId, userId);
      // 账户可能被并发更新，事务内重读
      const current = await tx.rebateAccount.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId, userId } },
      });

      const before =
        input.target === 'pending'
          ? Number(current.pending)
          : input.target === 'frozen'
            ? Number(current.frozen)
            : Number(current.available);
      const after = before + input.changeAmount;
      if (after < 0) {
        throw new Error(
          `返利余额不足：${input.target} 当前 ${before}，变动 ${input.changeAmount}`,
        );
      }

      const ledger = await tx.rebateLedger.create({
        data: {
          tenantId,
          userId,
          accountId: account.id,
          bizType: input.bizType,
          bizNo: input.bizNo,
          beforeAmount: before,
          changeAmount: input.changeAmount,
          afterAmount: after,
          idempotencyKey: input.idempotencyKey,
          operator: input.operator,
          remark: input.remark ?? null,
        },
      });

      await tx.rebateAccount.update({
        where: { id: account.id },
        data:
          input.target === 'pending'
            ? { pending: after }
            : input.target === 'frozen'
              ? { frozen: after }
              : { available: after },
      });

      return ledger;
    });
  }

  /**
   * 订单结算入账：pending → available（订单 SETTLED 时调用）。
   * idempotencyKey = `settle:${orderId}` 防重复入账。
   */
  async settleRebate(input: {
    tenantId: string;
    userId: string;
    orderId: string;
    orderNo: string;
    amount: number;
  }): Promise<void> {
    await this.writeLedger({
      tenantId: input.tenantId,
      userId: input.userId,
      bizType: 'REBATE_SETTLE',
      bizNo: input.orderNo,
      changeAmount: -input.amount,
      target: 'pending',
      idempotencyKey: `settle-out:${input.orderId}`,
      operator: 'system',
      remark: `订单 ${input.orderNo} 结算移出待结算`,
    });
    await this.writeLedger({
      tenantId: input.tenantId,
      userId: input.userId,
      bizType: 'REBATE_SETTLE',
      bizNo: input.orderNo,
      changeAmount: input.amount,
      target: 'available',
      idempotencyKey: `settle-in:${input.orderId}`,
      operator: 'system',
      remark: `订单 ${input.orderNo} 返利入账`,
    });
  }

  /**
   * 订单进入待结算：available 前置入 pending（订单 PENDING_SETTLE 时调用）。
   * 幂等键 = `pending:${orderId}`。
   */
  async moveToPending(input: {
    tenantId: string;
    userId: string;
    orderId: string;
    orderNo: string;
    amount: number;
  }): Promise<void> {
    await this.writeLedger({
      tenantId: input.tenantId,
      userId: input.userId,
      bizType: 'REBATE_PENDING',
      bizNo: input.orderNo,
      changeAmount: input.amount,
      target: 'pending',
      idempotencyKey: `pending:${input.orderId}`,
      operator: 'system',
      remark: `订单 ${input.orderNo} 进入待结算`,
    });
  }

  /**
   * 退款回冲：从可用余额扣减（不足则冻结后续返利，简化：扣到 0 为止记 REVERSE）。
   */
  async reverseRebate(input: {
    tenantId: string;
    userId: string;
    orderId: string;
    orderNo: string;
    amount: number;
  }): Promise<void> {
    const account = await this.ensureAccount(input.tenantId, input.userId);
    const available = Number(account.available);
    const clamp = Math.min(input.amount, available);
    if (clamp <= 0) return; // 无可扣余额，不产生流水（已结算未入账场景由订单状态处理）
    await this.writeLedger({
      tenantId: input.tenantId,
      userId: input.userId,
      bizType: 'REVERSE',
      bizNo: input.orderNo,
      changeAmount: -clamp,
      target: 'available',
      idempotencyKey: `reverse:${input.orderId}`,
      operator: 'system',
      remark: `订单 ${input.orderNo} 退款回冲${clamp !== input.amount ? `（余额不足，回冲 ${clamp}）` : ''}`,
    });
  }
}
