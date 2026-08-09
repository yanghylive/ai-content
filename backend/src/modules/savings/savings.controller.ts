import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SavingsService } from './savings.service';
import { CpsOrderSyncService } from './cps-order-sync.service';
import { SavingsExchangeService } from './savings-exchange.service';
import { SavingsWithdrawalService } from './savings-withdrawal.service';

/**
 * 智能省钱返利端点（需求清单 V1.1 §4，P0a 核心）：
 * parse / search / offers / watch / rebate / orders / exchange / withdraw。
 * 鉴权走全局 guard + resolveTenantId（复用现有机制）。
 */
@ApiTags('savings')
@Controller('savings')
export class SavingsController {
  constructor(
    private readonly savings: SavingsService,
    private readonly orderSync: CpsOrderSyncService,
    private readonly exchangeService: SavingsExchangeService,
    private readonly withdrawal: SavingsWithdrawalService,
  ) {}

  @Post('parse')
  @ApiOperation({
    summary: '解析链接/口令/分享文本 → 商品卡（含预计返利与净成本）',
  })
  parse(@Body() body: { raw: string }) {
    return this.savings.parse(body.raw);
  }

  @Get('search')
  @ApiOperation({ summary: '关键词搜索商品（多平台比价）' })
  search(
    @Query('keyword') keyword: string,
    @Query('platform') platform?: string,
  ) {
    return this.savings.search(keyword || '', platform);
  }

  @Get('offers/:itemId')
  @ApiOperation({ summary: '商品详情 + 优惠券 + 预计返利 + 预计净成本' })
  offers(
    @Param('itemId') itemId: string,
    @Query('platform') platform = 'taobao',
  ) {
    return this.savings.offers(itemId, platform);
  }

  @Post('watch')
  @ApiOperation({ summary: '创建价格/返利监控' })
  createWatch(
    @Body()
    body: {
      itemId: string;
      platformCode: string;
      title: string;
      targetPayPrice?: number;
      minRebate?: number;
      notifyWindows?: string;
    },
  ) {
    return this.savings.createWatch(body);
  }

  @Get('watches')
  @ApiOperation({ summary: '我的监控列表' })
  listWatches() {
    return this.savings.listWatches();
  }

  @Post('watches/:id/disable')
  @ApiOperation({ summary: '停用监控' })
  disableWatch(@Param('id') id: string) {
    return this.savings.disableWatch(id);
  }

  @Get('rebate')
  @ApiOperation({ summary: '返利余额（预计/待结算/可用/冻结/累计）' })
  rebateBalance() {
    return this.savings.rebateBalance();
  }

  @Get('orders')
  @ApiOperation({ summary: '我的 CPS 订单列表（分页）' })
  listOrders(@Query('status') status?: string, @Query('page') page = '1') {
    return this.savings.listOrders(status, Number(page) || 1);
  }

  @Post('orders/sync')
  @ApiOperation({ summary: '手动触发订单同步（管理员/调试用）' })
  syncOrders() {
    return this.orderSync.syncOnce();
  }

  @Post('orders/claim')
  @ApiOperation({ summary: '订单找回/归因（资产变动走人工审核）' })
  claimOrder(@Body() body: { orderNo: string; relationId?: string }) {
    return this.savings.claimOrder(body.orderNo, body.relationId);
  }

  @Post('exchange')
  @ApiOperation({ summary: '返利兑换 AI 额度（冻结→发放→确认，幂等）' })
  exchange(@Body() body: { amount: number; idempotencyKey: string }) {
    return this.exchangeService.exchange(body);
  }

  @Get('exchanges')
  @ApiOperation({ summary: '我的兑换记录' })
  listExchanges(@Query('page') page = '1') {
    return this.exchangeService.listExchanges(Number(page) || 1);
  }

  @Get('credit')
  @ApiOperation({ summary: '我的 AI 额度余额' })
  creditBalance() {
    return this.exchangeService.creditBalance();
  }

  @Post('credit/consume')
  @ApiOperation({ summary: '消费 AI 额度（生图/生视频/模型调用扣减）' })
  consumeCredit(
    @Body()
    body: {
      amount: number;
      bizNo: string;
      feature: string;
      idempotencyKey: string;
    },
  ) {
    return this.exchangeService.consumeCredit(body);
  }

  @Post('withdraw')
  @ApiOperation({ summary: '提现申请（冻结→审核→渠道付款，幂等）' })
  withdraw(
    @Body()
    body: {
      amount: number;
      channel: string;
      accountMask: string;
      idempotencyKey: string;
    },
  ) {
    return this.withdrawal.withdraw(body);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: '我的提现记录' })
  listWithdrawals(@Query('page') page = '1') {
    return this.withdrawal.listWithdrawals(Number(page) || 1);
  }
  @Post('procurement')
  @ApiOperation({ summary: '创建门店采购清单' })
  createProcurement(
    @Body()
    body: {
      name: string;
      address?: string;
      owner?: string;
      items: Array<{
        name: string;
        spec?: string;
        quantity?: number;
        stock?: number;
        minStock?: number;
        targetPrice?: number;
        allowSubstitute?: boolean;
      }>;
    },
  ) {
    return this.savings.createProcurement(body);
  }

  @Get('procurements')
  @ApiOperation({ summary: '我的采购清单列表' })
  listProcurements() {
    return this.savings.listProcurements();
  }

  @Get('procurement/:id/restock')
  @ApiOperation({ summary: '补货建议（结合库存/最低安全库存）' })
  restockSuggestion(@Param('id') id: string) {
    return this.savings.restockSuggestion(id);
  }

  @Get('featured')
  @ApiOperation({
    summary: '运营位选品（type=2 9.9包邮 / 3 30元封顶 / 5 淘抢购）',
  })
  featured(@Query('type') type = '2') {
    return this.savings.featured(Number(type) || 2);
  }

  @Get('meituan-activities')
  @ApiOperation({ summary: '美团本地生活活动列表（好单库）' })
  meituanActivities() {
    return this.savings.meituanActivities();
  }

  @Post('translink')
  @ApiOperation({ summary: '生成推广链接（美团活动/商品；归因服务端生成）' })
  translink(
    @Body()
    body: {
      itemId?: string;
      originalUrl?: string;
      platformCode: string;
      activityId?: string;
    },
  ) {
    return this.savings.translink(body);
  }
}
