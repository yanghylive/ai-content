import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { SavingsLedgerService } from './savings-ledger.service';
import { RebateWithdrawal } from '@prisma/client';

/** 提现渠道抽象（V1.1 §13.6：渠道可替换，支付宝/微信二期接入） */
export interface WithdrawalChannel {
  readonly code: string; // mock / alipay / wechat
  readonly label: string;
  /** 执行企业付款；返回外部流水号；失败抛错 */
  pay(withdrawal: {
    id: string;
    amount: number;
    accountMask: string;
  }): Promise<{ externalNo: string }>;
}

/** P0 模拟渠道：标记成功并生成模拟流水号（真实渠道签约后替换） */
@Injectable()
export class MockWithdrawalChannel implements WithdrawalChannel {
  readonly code = 'mock';
  readonly label = '模拟渠道（P0，待接入支付宝/微信）';

  pay(withdrawal: {
    id: string;
    amount: number;
  }): Promise<{ externalNo: string }> {
    // 模拟渠道：生成外部流水号（真实渠道替换为支付宝/微信企业付款调用）
    const externalNo = `MOCK${Date.now()}${withdrawal.id.slice(-6)}`;
    return Promise.resolve({ externalNo });
  }
}

/** 小额自动放行阈值（>此金额进入人工审核） */
const AUTO_PASS_LIMIT = 100;
/** 最低提现金额 */
const MIN_WITHDRAW_AMOUNT = 1;

/**
 * 返利现金提现（需求清单 V1.1 §13.6）：
 * SUBMITTED → REVIEWING（大额人工）→ PROCESSING（渠道付款）→ SUCCESS
 *                                        └→ FAILED → 解冻
 *                        └→ REJECTED → 解冻
 * 幂等键唯一；成功必须有外部付款流水；失败自动解冻。
 */
@Injectable()
export class SavingsWithdrawalService {
  private readonly logger = new Logger(SavingsWithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly ledger: SavingsLedgerService,
    private readonly mockChannel: MockWithdrawalChannel,
  ) {}

  /** 渠道路由（P0 仅 mock；真实渠道注册后按 code 分发） */
  private channels(): Record<string, WithdrawalChannel> {
    return { [this.mockChannel.code]: this.mockChannel };
  }

  private async resolveScope() {
    const context = this.authRequestContext.get();
    const user = context?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) throw new BadRequestException('请先登录后提现');
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  /** M5-4 实名校验：提现前必须已实名（User.name 为实名姓名） */
  private async assertVerified(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (!user?.name?.trim()) {
      throw new BadRequestException('提现需先完善实名信息（账号姓名）');
    }
  }

  /** 提交提现申请 */
  async withdraw(input: {
    amount: number;
    channel: string;
    accountMask: string; // 脱敏收款账户（如 尾号8868）
    idempotencyKey: string;
  }): Promise<{ withdrawalId: string; status: string; amount: number }> {
    const { tenantId, userId } = await this.resolveScope();
    // M5-4 实名：提现前必须已实名（User.name）
    await this.assertVerified(userId);

    // 幂等
    const existing = await this.prisma.rebateWithdrawal.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        withdrawalId: existing.id,
        status: existing.status,
        amount: Number(existing.amount),
      };
    }

    if (input.amount < MIN_WITHDRAW_AMOUNT) {
      throw new BadRequestException(
        `提现金额不能低于 ${MIN_WITHDRAW_AMOUNT} 元`,
      );
    }
    const channel = this.channels()[input.channel];
    if (!channel) {
      throw new BadRequestException(`提现渠道「${input.channel}」未开通`);
    }

    // 1. 先原子冻结可用返利（writeLedger 原子 decrement，余额不足在此抛；幂等防重）
    const freeze = await this.ledger.writeLedger({
      tenantId,
      userId,
      bizType: 'WITHDRAW_FREEZE',
      bizNo: `wf:${input.idempotencyKey}`,
      changeAmount: -input.amount,
      target: 'available',
      idempotencyKey: `withdraw-freeze:${input.idempotencyKey}`,
      operator: 'user',
      remark: `提现冻结返利（渠道 ${input.channel}）`,
    });
    const withdrawalId = freeze.bizNo.replace('wf:', '');

    // 2. 创建提现单（冻结成功后才建单，避免孤儿单；建单失败自动解冻补偿）
    let withdrawal: RebateWithdrawal;
    try {
      withdrawal = await this.prisma.rebateWithdrawal.create({
        data: {
          tenantId,
          userId,
          amount: input.amount,
          channel: input.channel,
          accountMask: input.accountMask,
          fee: 0,
          actualAmount: input.amount,
          status: 'SUBMITTED',
          idempotencyKey: withdrawalId,
        },
      });
    } catch (error) {
      await this.ledger
        .writeLedger({
          tenantId,
          userId,
          bizType: 'WITHDRAW_UNFREEZE',
          bizNo: `wf:${withdrawalId}`,
          changeAmount: input.amount,
          target: 'available',
          idempotencyKey: `withdraw-unfreeze-fallback:${withdrawalId}`,
          operator: 'system',
          remark: '提现单创建失败自动解冻',
        })
        .catch(() => undefined);
      throw error;
    }

    // 3. 审核：小额自动放行，大额转人工
    const status = input.amount <= AUTO_PASS_LIMIT ? 'PROCESSING' : 'REVIEWING';
    await this.prisma.rebateWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status },
    });

    // 小额：自动进入渠道付款
    if (status === 'PROCESSING') {
      await this.processPayment(withdrawal.id).catch((err) => {
        this.logger.warn(
          `提现付款失败 ${withdrawal.id}: ${(err as Error).message}`,
        );
      });
    }

    await this.auditSystem(
      'success',
      `savings.withdraw 提现申请 tenant=${withdrawal.tenantId} user=${withdrawal.userId} amount=${input.amount} status=${status}`,
    );
    return { withdrawalId: withdrawal.id, status, amount: input.amount };
  }

  /** 渠道付款（成功扣减冻结 / 失败解冻） */
  async processPayment(withdrawalId: string): Promise<RebateWithdrawal> {
    const withdrawal = await this.prisma.rebateWithdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
    });
    if (withdrawal.status !== 'PROCESSING') return withdrawal;

    const channel = this.channels()[withdrawal.channel];
    if (!channel) {
      await this.reject(withdrawal, `提现渠道未开通：${withdrawal.channel}`);
      return withdrawal;
    }

    try {
      const { externalNo } = await channel.pay({
        id: withdrawal.id,
        amount: Number(withdrawal.amount),
        accountMask: withdrawal.accountMask,
      });
      // 成功：确认扣减冻结 + 记录外部流水号
      await this.ledger.writeLedger({
        tenantId: withdrawal.tenantId,
        userId: withdrawal.userId,
        bizType: 'WITHDRAW_CONFIRM',
        bizNo: withdrawal.id,
        changeAmount: -Number(withdrawal.amount),
        target: 'frozen',
        idempotencyKey: `withdraw-confirm:${withdrawal.id}`,
        operator: 'system',
        remark: `提现成功扣减冻结（渠道 ${withdrawal.channel}，流水 ${externalNo}）`,
      });
      return this.prisma.rebateWithdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'SUCCESS', externalNo, paidAt: new Date() },
      });
    } catch (err) {
      await this.reject(withdrawal, `付款失败：${(err as Error).message}`);
      return withdrawal;
    }
  }

  /** 驳回/失败：解冻返利 */
  private async reject(
    withdrawal: RebateWithdrawal,
    reason: string,
  ): Promise<void> {
    await this.ledger.writeLedger({
      tenantId: withdrawal.tenantId,
      userId: withdrawal.userId,
      bizType: 'WITHDRAW_UNFREEZE',
      bizNo: withdrawal.id,
      changeAmount: Number(withdrawal.amount),
      target: 'frozen',
      idempotencyKey: `withdraw-unfreeze:${withdrawal.id}`,
      operator: 'system',
      remark: `提现${withdrawal.status === 'REVIEWING' ? '驳回' : '失败'}解冻：${reason}`,
    });
    await this.ledger.writeLedger({
      tenantId: withdrawal.tenantId,
      userId: withdrawal.userId,
      bizType: 'WITHDRAW_UNFREEZE',
      bizNo: withdrawal.id,
      changeAmount: Number(withdrawal.amount),
      target: 'available',
      idempotencyKey: `withdraw-unfreeze-in:${withdrawal.id}`,
      operator: 'system',
      remark: `提现返利退回可用`,
    });
    await this.prisma.rebateWithdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: withdrawal.status === 'REVIEWING' ? 'REJECTED' : 'FAILED',
        failReason: reason,
      },
    });
  }

  /** 资金操作审计（写 SystemLog） */
  private async auditSystem(level: string, content: string) {
    try {
      await this.prisma.systemLog.create({ data: { level, content } });
    } catch {
      /* 审计失败不影响主流程 */
    }
  }

  /** 管理端：审核通过（REVIEWING → PROCESSING → 渠道付款） */
  async approve(withdrawalId: string): Promise<RebateWithdrawal> {
    const withdrawal = await this.prisma.rebateWithdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
    });
    if (withdrawal.status === 'REVIEWING') {
      await this.prisma.rebateWithdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'PROCESSING' },
      });
    }
    const done = await this.processPayment(withdrawalId);
    await this.auditSystem(
      'success',
      `savings.withdraw.approve 提现审核通过 id=${withdrawalId} status=${done.status}`,
    );
    return done;
  }

  /** 管理端：驳回（REVIEWING → REJECTED，解冻返利） */
  async rejectWithdrawal(
    withdrawalId: string,
    reason: string,
  ): Promise<RebateWithdrawal> {
    const withdrawal = await this.prisma.rebateWithdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
    });
    if (withdrawal.status !== 'REVIEWING') return withdrawal;
    await this.reject(withdrawal, reason);
    await this.auditSystem(
      'warning',
      `savings.withdraw.reject 提现驳回 id=${withdrawalId} reason=${reason}`,
    );
    return this.prisma.rebateWithdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
    });
  }

  /** 我的提现记录 */
  async listWithdrawals(page = 1) {
    const { tenantId, userId } = await this.resolveScope();
    const [items, total] = await Promise.all([
      this.prisma.rebateWithdrawal.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (page - 1) * 20,
      }),
      this.prisma.rebateWithdrawal.count({ where: { tenantId, userId } }),
    ]);
    return { items, total, page, pageSize: 20 };
  }
}
