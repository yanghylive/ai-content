import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
    return this.ensureAccountTx(this.prisma, tenantId, userId);
  }

  /** 事务内确保账户存在（tx 可传事务客户端） */
  private async ensureAccountTx(
    db: { rebateAccount: PrismaService['rebateAccount'] },
    tenantId: string,
    userId: string,
  ): Promise<RebateAccount> {
    const existing = await db.rebateAccount.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (existing) return existing;
    try {
      return await db.rebateAccount.create({
        data: { tenantId, userId },
      });
    } catch {
      // 并发创建竞态：已存在则返回
      return db.rebateAccount.findUniqueOrThrow({
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
    const { tenantId, userId } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 幂等检查放事务内（防并发同键重复扣减）
        const existing = await tx.rebateLedger.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          return existing;
        }

        const account = await this.ensureAccountTx(tx, tenantId, userId);
        // 原子更新余额（decrement 防并发覆盖丢失更新）
        const updated = await tx.rebateAccount.update({
          where: { id: account.id },
          data:
            input.target === 'pending'
              ? { pending: { decrement: -input.changeAmount } }
              : input.target === 'frozen'
                ? { frozen: { decrement: -input.changeAmount } }
                : { available: { decrement: -input.changeAmount } },
        });
        const realAfter =
          input.target === 'pending'
            ? Number(updated.pending)
            : input.target === 'frozen'
              ? Number(updated.frozen)
              : Number(updated.available);
        if (realAfter < 0) {
          // 余额不足是业务错误，抛 400 而非 500（修复：原来抛 Error 被全局过滤器映射成"服务器内部错误"）
          // 原余额 = realAfter - changeAmount（changeAmount 为负数时即回加）
          const before = realAfter - input.changeAmount;
          throw new BadRequestException(
            `返利余额不足：${input.target} 余额 ${before}，变动 ${input.changeAmount}`,
          );
        }
        const before = realAfter - input.changeAmount;

        return tx.rebateLedger.create({
          data: {
            tenantId,
            userId,
            accountId: account.id,
            bizType: input.bizType,
            bizNo: input.bizNo,
            beforeAmount: before,
            changeAmount: input.changeAmount,
            afterAmount: realAfter,
            idempotencyKey: input.idempotencyKey,
            operator: input.operator,
            remark: input.remark ?? null,
          },
        });
      });
    } catch (error) {
      // P2002 = 幂等键唯一冲突（并发同键）→ 返回已有流水（幂等承诺）
      if ((error as { code?: string })?.code === 'P2002') {
        return this.prisma.rebateLedger.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
      }
      throw error;
    }
  }

  /**
   * 订单结算入账：pending → available（订单 SETTLED 时调用）。
   * idempotencyKey = `settle:${orderId}` 防重复入账。
   */
  /** 资金操作审计（M5-4：返利/提现/兑换全部写 SystemLog） */
  private async audit(level: string, content: string) {
    try {
      await this.prisma.systemLog.create({
        data: { level, content },
      });
    } catch {
      /* 审计失败不影响主流程 */
    }
  }

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
    await this.audit(
      'success',
      `savings.settleRebate 返利入账 tenant=${input.tenantId} user=${input.userId} order=${input.orderNo} amount=${input.amount}`,
    );
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
