import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth.decorator';
import { WecomCrmService } from './wecom-crm.service';
import type {
  WecomCorpConfigDto,
  WecomGroupMsgTaskCreateDto,
  WecomMomentTaskCreateDto,
} from './wecom-crm.types';

type AuthenticatedRequest = Request & {
  authSessionId?: string;
  authUser?: {
    id?: string;
    name?: string;
    username?: string;
    email?: string;
    role?: string;
    kaypalPlan?: string;
    kaypalPlatformRole?: string | null;
  };
};

@Controller('wecom-crm')
export class WecomCrmController {
  constructor(private readonly wecomCrmService: WecomCrmService) {}

  // ============ 企业配置（需鉴权） ============

  @Get('state')
  getState(@Req() request: AuthenticatedRequest) {
    return this.wecomCrmService.getState(this.getUserId(request));
  }

  @Post('configs')
  saveConfig(
    @Req() request: AuthenticatedRequest,
    @Body() body: WecomCorpConfigDto & { id?: string; name?: string },
  ) {
    return this.wecomCrmService.saveConfig(this.getUserId(request), body);
  }

  @Post('configs/test')
  testConfig(
    @Req() request: AuthenticatedRequest,
    @Body() body: { configId?: string },
  ) {
    if (!body.configId) {
      return { ok: false, message: '缺少 configId' };
    }
    return this.wecomCrmService.testConfig(this.getUserId(request), body.configId);
  }

  @Delete('configs/:id')
  deleteConfig(
    @Req() request: AuthenticatedRequest,
    @Param('id') configId: string,
  ) {
    return this.wecomCrmService.deleteConfig(this.getUserId(request), configId);
  }

  // ============ 外部联系人（需鉴权） ============

  @Get('configs/:id/contacts')
  listContacts(
    @Req() request: AuthenticatedRequest,
    @Param('id') configId: string,
    @Query('memberUserId') memberUserId?: string,
  ) {
    return this.wecomCrmService.listContacts(
      this.getUserId(request),
      configId,
      memberUserId,
    );
  }

  // ============ 客户群发（需鉴权） ============

  @Post('group-msgs')
  createGroupMsgTask(
    @Req() request: AuthenticatedRequest,
    @Body() body: WecomGroupMsgTaskCreateDto,
  ) {
    return this.wecomCrmService.createGroupMsgTask(this.getUserId(request), body);
  }

  @Get('group-msgs')
  listGroupMsgTasks(@Req() request: AuthenticatedRequest) {
    return this.wecomCrmService.listGroupMsgTasks(this.getUserId(request));
  }

  @Post('group-msgs/:id/result')
  queryGroupMsgResult(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
  ) {
    return this.wecomCrmService.queryGroupMsgResult(this.getUserId(request), taskId);
  }

  // ============ 客户朋友圈（需鉴权） ============

  @Post('moments')
  createMomentTask(
    @Req() request: AuthenticatedRequest,
    @Body() body: WecomMomentTaskCreateDto,
  ) {
    return this.wecomCrmService.createMomentTask(this.getUserId(request), body);
  }

  @Get('moments')
  listMomentTasks(@Req() request: AuthenticatedRequest) {
    return this.wecomCrmService.listMomentTasks(this.getUserId(request));
  }

  @Post('moments/:id/result')
  queryMomentResult(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
  ) {
    return this.wecomCrmService.queryMomentResult(this.getUserId(request), taskId);
  }

  // ============ 企业微信回调（免鉴权，纯文本回包） ============

  /** URL 验证：GET 带 echostr，返回解密后的明文 */
  @Public()
  @Get('callback/:configId')
  @HttpCode(200)
  async verifyCallback(
    @Param('configId') configId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const plain = await this.wecomCrmService.handleCallback({
      configId,
      query,
      rawBody: '',
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(plain);
  }

  /** 事件推送：POST XML，回包 "success" */
  @Public()
  @Post('callback/:configId')
  @HttpCode(200)
  async receiveCallback(
    @Param('configId') configId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rawBody = await this.readRawBody(req);
    const reply = await this.wecomCrmService.handleCallback({
      configId,
      query,
      rawBody,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(reply);
  }

  private readRawBody(req: Request): Promise<string> {
    return new Promise((resolve) => {
      // express 默认 bodyParser 不消费 text/xml（企业微信真实回调），原始流完整；
      // 但若被 json/urlencoded 消费（如 curl -d 测试），需兜底处理
      const body = req.body as unknown;
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const asRecord = body as Record<string, unknown>;
        if (typeof asRecord.Encrypt === 'string') {
          resolve(asRecord.Encrypt);
          return;
        }
        if (Object.keys(asRecord).length > 0) {
          resolve(JSON.stringify(asRecord));
          return;
        }
      }
      // 流已被 bodyParser 消费完 → 无原始内容
      if (req.readableEnded) {
        resolve('');
        return;
      }
      let data = '';
      req.on('data', (chunk: Buffer | string) => {
        data += chunk.toString('utf8');
      });
      req.on('end', () => resolve(data));
      req.on('error', () => resolve(data));
      // 超时兜底（3s），避免 promise 永久挂起
      setTimeout(() => resolve(data), 3000).unref();
    });
  }

  private getUserId(request: AuthenticatedRequest): string {
    return request.authUser?.id || 'local-user';
  }
}
