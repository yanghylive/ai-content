import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SavingsAdminService } from './savings-admin.service';

/**
 * 省钱返利管理端端点（M5，需求清单 V1.1 §13）：
 * 全量订单 / 提现审核（通过/驳回）/ 兑换 / 对账汇总 / 供应商状态。
 * 鉴权：全局 guard + 管理端 requireAdmin（tenant admin/owner）。
 */
@ApiTags('savings-admin')
@Controller('admin/savings')
export class SavingsAdminController {
  constructor(private readonly admin: SavingsAdminService) {}

  @Get('orders')
  @ApiOperation({ summary: '全量订单（管理）' })
  listOrders(@Query('status') status?: string, @Query('page') page = '1') {
    return this.admin.listOrders(status, Number(page) || 1);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: '全量提现（管理，含待审核）' })
  listWithdrawals(@Query('status') status?: string, @Query('page') page = '1') {
    return this.admin.listWithdrawals(status, Number(page) || 1);
  }

  @Post('withdrawals/:id/approve')
  @ApiOperation({ summary: '提现审核通过（REVIEWING → 渠道付款）' })
  approveWithdrawal(@Param('id') id: string) {
    return this.admin.approveWithdrawal(id);
  }

  @Post('withdrawals/:id/reject')
  @ApiOperation({ summary: '提现驳回（REVIEWING → REJECTED 解冻）' })
  rejectWithdrawal(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.admin.rejectWithdrawal(id, body.reason || '管理员驳回');
  }

  @Get('exchanges')
  @ApiOperation({ summary: '兑换列表（管理）' })
  listExchanges(@Query('page') page = '1') {
    return this.admin.listExchanges(Number(page) || 1);
  }

  @Get('reconcile')
  @ApiOperation({ summary: '对账汇总（账本 vs 订单/提现/兑换）' })
  reconcile() {
    return this.admin.reconcile();
  }

  @Get('vendors')
  @ApiOperation({ summary: '供应商状态（注册 + 凭证配置）' })
  listVendors() {
    return this.admin.listVendors();
  }
}
