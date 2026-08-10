import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SavingsService } from './savings.service';
import { CpsOrderSyncService } from './cps-order-sync.service';
import { SavingsExchangeService } from './savings-exchange.service';
import { SavingsWithdrawalService } from './savings-withdrawal.service';
import { JutuikeLifeService } from './jutuike-life.service';

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
    private readonly jutuikeLife: JutuikeLifeService,
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

  @Get('pay-check')
  @ApiOperation({ summary: '返利直付预检（生图/生视频费用 + 返利余额）' })
  payCheck(@Query('feature') feature = 'image_generation') {
    return this.exchangeService.payCheck(feature);
  }

  @Post('pay-rebate')
  @ApiOperation({ summary: '返利直付（1:1 现金抵扣生图/生视频，幂等）' })
  payRebate(
    @Body()
    body: {
      amount: number;
      bizNo: string;
      feature: string;
      idempotencyKey: string;
    },
  ) {
    return this.exchangeService.payWithRebate(body);
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
  @Post('stores')
  @ApiOperation({ summary: '创建门店（多门店采购主体，P0b-5）' })
  createStore(
    @Body() body: { name: string; address?: string; owner?: string },
  ) {
    return this.savings.createStore(body);
  }

  @Get('stores')
  @ApiOperation({ summary: '我的门店列表' })
  listStores() {
    return this.savings.listStores();
  }

  @Post('stores/:id/disable')
  @ApiOperation({ summary: '停用门店' })
  disableStore(@Param('id') id: string) {
    return this.savings.disableStore(id);
  }

  @Post('procurement')
  @ApiOperation({ summary: '创建门店采购清单' })
  createProcurement(
    @Body()
    body: {
      name: string;
      address?: string;
      owner?: string;
      storeId?: string;
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
  @ApiOperation({ summary: '我的采购清单列表（可按门店过滤）' })
  listProcurements(@Query('storeId') storeId?: string) {
    return this.savings.listProcurements(storeId);
  }

  @Get('procurement/:id/restock')
  @ApiOperation({ summary: '补货建议（结合库存/最低安全库存）' })
  restockSuggestion(@Param('id') id: string) {
    return this.savings.restockSuggestion(id);
  }

  @Get('price-history')
  @ApiOperation({ summary: '价格历史轨迹（30/90 天曲线 + 均价/最低价）' })
  priceHistory(@Query('itemId') itemId: string, @Query('days') days?: string) {
    return this.savings.priceHistory(itemId, Number(days) || 30);
  }

  @Get('sku-compare')
  @ApiOperation({ summary: '同款跨平台比价（SKU 主档归并）' })
  skuCompare(@Query('keyword') keyword: string) {
    return this.savings.skuCompare(keyword);
  }

  @Get('featured')
  @ApiOperation({
    summary: '运营位选品（type=2 9.9包邮 / 3 30元封顶 / 5 淘抢购）',
  })
  featured(@Query('type') type = '2') {
    return this.savings.featured(Number(type) || 2);
  }

  @Get('category')
  @ApiOperation({ summary: '分类商品列表（首页导航 + 默认商品流）' })
  category(@Query('key') key = 'hot', @Query('limit') limit?: string) {
    return this.savings.category(key, Number(limit) || 10);
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

  // ===== 聚推客联盟 · 生活服务场景（外卖/出行/餐饮/到店/娱乐/充值） =====

  @Get('life-services')
  @ApiOperation({ summary: '聚推客生活服务场景分组列表（本地精选配置）' })
  lifeServices() {
    return this.jutuikeLife.listServices();
  }

  @Get('life-services/:actId/link')
  @ApiOperation({ summary: '聚推客生活服务活动转链（h5/小程序）' })
  lifeServiceLink(@Param('actId') actId: string, @Query('sid') sid?: string) {
    return this.jutuikeLife.translink(Number(actId), sid);
  }

  // ===== P2 增长能力 =====

  @Post('favorites')
  @ApiOperation({ summary: '收藏商品（幂等）' })
  addFavorite(
    @Body()
    body: {
      vendorCode: string;
      platformCode: string;
      itemId: string;
      title: string;
      imageUrl?: string | null;
      payPrice: number;
      couponAmount: number;
      estRebate: number;
      estNetCost: number;
      commissionRate?: number;
    },
  ) {
    return this.savings.addFavorite(body);
  }

  @Delete('favorites/:itemId')
  @ApiOperation({ summary: '取消收藏' })
  removeFavorite(
    @Param('itemId') itemId: string,
    @Query('platform') platform = 'taobao',
  ) {
    return this.savings.removeFavorite(itemId, platform);
  }

  @Get('favorites')
  @ApiOperation({ summary: '收藏列表' })
  listFavorites() {
    return this.savings.listFavorites();
  }

  @Post('checkin')
  @ApiOperation({ summary: '每日签到（连续天数递增返利）' })
  checkin() {
    return this.savings.checkin();
  }

  @Get('checkin/status')
  @ApiOperation({ summary: '签到状态（今日/连续/本月）' })
  checkinStatus() {
    return this.savings.checkinStatus();
  }

  @Get('invite')
  @ApiOperation({ summary: '我的邀请码与专属链接' })
  invite() {
    return this.savings.inviteCode();
  }
}
