// 微信支付 controller（2026-08-16，商户号 1116143786）
import { Body, Controller, Get, Headers, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WechatPayService } from './wechat-pay.service';

@ApiTags('微信支付')
@Controller('billing/wechat-pay')
export class WechatPayController {
  constructor(private readonly wechatPay: WechatPayService) {}

  private requireUser(@Req() request: Request) {
    const user = (request as unknown as { authUser?: { id?: string } }).authUser;
    if (!user?.id) throw new UnauthorizedException('请先登录');
    return user.id;
  }

  @Post('orders')
  @ApiOperation({ summary: '创建积分充值支付单' })
  createOrder(
    @Req() request: Request,
    @Body()
    body: { amountYuan: number; description?: string; idempotencyKey: string },
  ) {
    this.requireUser(request);
    return this.wechatPay.createCreditOrder({
      amountYuan: Number(body?.amountYuan),
      description: body?.description,
      idempotencyKey: body?.idempotencyKey?.trim() || `wxpay:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  @Get('config-status')
  @ApiOperation({ summary: '微信支付配置就绪检查' })
  configStatus() {
    return this.wechatPay.configStatus();
  }

  @Get('orders/:outTradeNo')
  @ApiOperation({ summary: '查询支付单状态' })
  getOrder(@Param('outTradeNo') outTradeNo: string, @Req() request: Request) {
    this.requireUser(request);
    return this.wechatPay.getOrderStatus(outTradeNo);
  }

  @Post('notify')
  @ApiOperation({ summary: '微信支付回调（V3 验签 + 幂等充值）' })
  notify(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ) {
    return this.wechatPay.handleNotify({ headers, body });
  }
}
