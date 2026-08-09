import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SavingsService } from './savings.service';

/**
 * 智能省钱返利端点（需求清单 V1.1 §4，P0a 核心）：
 * parse / search / offers / watch / rebate。
 * 鉴权走全局 guard + resolveTenantId（复用现有机制）。
 */
@ApiTags('savings')
@Controller('savings')
export class SavingsController {
  constructor(private readonly savings: SavingsService) {}

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
}
