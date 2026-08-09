import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { SavingsWithdrawalService } from './savings-withdrawal.service';
import { SavingsAdapterRegistry } from './savings-adapter/adapter.registry';

/**
 * 省钱返利管理端服务（M5，需求清单 V1.1 §13）：
 * 全量订单/提现审核/兑换/对账/供应商状态。
 * 管理鉴权：当前用户必须是所在租户的 admin/owner（复用 tenantMember 机制）。
 */
@Injectable()
export class SavingsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly withdrawal: SavingsWithdrawalService,
    private readonly adapterRegistry: SavingsAdapterRegistry,
  ) {}

  /** 管理鉴权：解析租户 + 校验 admin/owner 成员身份 */
  private async requireAdmin(): Promise<string> {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后访问管理端');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    const membership = await this.prisma.tenantMember.findFirst({
      where: {
        userId,
        status: 'active',
        role: { in: ['admin', 'owner'] },
        tenant: { status: 'active' },
      },
    });
    if (!membership) {
      throw new ForbiddenException('需要组织管理员权限');
    }
    return tenantId;
  }

  /** 全量订单（管理） */
  async listOrders(status?: string, page = 1) {
    await this.requireAdmin();
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.cpsOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (page - 1) * 20,
      }),
      this.prisma.cpsOrder.count({ where }),
    ]);
    return { items, total, page };
  }

  /** 全量提现（管理，含待审核） */
  async listWithdrawals(status?: string, page = 1) {
    await this.requireAdmin();
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.rebateWithdrawal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (page - 1) * 20,
      }),
      this.prisma.rebateWithdrawal.count({ where }),
    ]);
    return { items, total, page };
  }

  /** 审核通过（REVIEWING → 渠道付款） */
  approveWithdrawal(withdrawalId: string) {
    return this.requireAdmin().then(() =>
      this.withdrawal.approve(withdrawalId),
    );
  }

  /** 驳回（REVIEWING → REJECTED 解冻） */
  rejectWithdrawal(withdrawalId: string, reason: string) {
    return this.requireAdmin().then(() =>
      this.withdrawal.rejectWithdrawal(withdrawalId, reason),
    );
  }

  /** 兑换列表（管理） */
  async listExchanges(page = 1) {
    await this.requireAdmin();
    const [items, total] = await Promise.all([
      this.prisma.rebateExchange.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (page - 1) * 20,
      }),
      this.prisma.rebateExchange.count(),
    ]);
    return { items, total, page };
  }

  /** 对账汇总（返利账本 vs 订单/提现/兑换） */
  async reconcile() {
    await this.requireAdmin();
    const [ledgerByType, orderSum, withdrawalSum, exchangeSum, acctSum] =
      await Promise.all([
        this.prisma.rebateLedger.groupBy({
          by: ['bizType'],
          _sum: { changeAmount: true },
        }),
        this.prisma.cpsOrder.aggregate({
          _sum: { estCommission: true, userRebate: true },
        }),
        this.prisma.rebateWithdrawal.aggregate({ _sum: { amount: true } }),
        this.prisma.rebateExchange.aggregate({
          _sum: { rebateAmount: true, creditAmount: true },
        }),
        this.prisma.rebateAccount.aggregate({
          _sum: {
            available: true,
            frozen: true,
            pending: true,
            totalEarned: true,
          },
        }),
      ]);
    return {
      orders: {
        estCommission: Number(orderSum._sum.estCommission || 0),
        userRebate: Number(orderSum._sum.userRebate || 0),
      },
      withdrawals: Number(withdrawalSum._sum.amount || 0),
      exchanges: {
        rebateAmount: Number(exchangeSum._sum.rebateAmount || 0),
        creditAmount: Number(exchangeSum._sum.creditAmount || 0),
      },
      accounts: {
        available: Number(acctSum._sum.available || 0),
        frozen: Number(acctSum._sum.frozen || 0),
        pending: Number(acctSum._sum.pending || 0),
        totalEarned: Number(acctSum._sum.totalEarned || 0),
      },
      ledgerByBizType: Object.fromEntries(
        ledgerByType.map((x) => [x.bizType, Number(x._sum.changeAmount || 0)]),
      ),
    };
  }

  /** 供应商状态（注册列表 + 凭证配置情况） */
  async listVendors() {
    await this.requireAdmin();
    return this.adapterRegistry.list().map((code) => {
      const creds: Record<string, boolean> = {};
      if (code === 'haodanku') {
        creds.apikey = !!process.env.HAODANKU_APIKEY;
        creds.appId = !!process.env.HAODANKU_APP_ID;
        creds.appSecret = !!process.env.HAODANKU_APP_SECRET;
        creds.tbName = !!process.env.HAODANKU_TB_NAME;
        creds.pid = !!process.env.HAODANKU_PID;
      } else if (code === 'datoke') {
        creds.appKey = !!process.env.DATOKE_APP_KEY;
        creds.appSecret = !!process.env.DATOKE_APP_SECRET;
      }
      return {
        code,
        configured: creds,
        ready: Object.values(creds).every(Boolean),
      };
    });
  }
}
