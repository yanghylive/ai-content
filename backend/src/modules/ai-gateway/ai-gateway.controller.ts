import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiGatewayService } from './ai-gateway.service';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * AI 对话网关（P0.5）：
 * POST /api/ai-gateway/chat → SSE 流式对话 + 工具调用（topic_hot/compliance_check）
 */
@Controller('ai-gateway')
export class AiGatewayController {
  constructor(private readonly aiGateway: AiGatewayService) {}

  @Post('chat')
  async chat(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: { messages?: ChatMessage[] },
  ) {
    const authUser = (request as Request & { authUser?: unknown }).authUser;
    if (!authUser) throw new UnauthorizedException('请先登录');

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) {
      throw new UnauthorizedException('对话消息不能为空');
    }

    await this.aiGateway.chatStream(
      authUser as Parameters<AiGatewayService['chatStream']>[0],
      messages,
      response,
    );
  }
}
