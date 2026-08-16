import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorator';
import { AiClientService } from './ai-client.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * OpenAI 兼容 LLM 代理端点（给 MemoryCore / 其他项目统一用）
 * POST /api/ai-models/v1/chat/completions
 * 认证：远程（非 loopback）请求必须 Authorization: Bearer <MEMORY_LLM_PROXY_KEY>；
 *      本地 loopback（MemoryCore 等本机服务）信任免认证。
 * 复用 ai-client（带 kaypal context / 计费链路），模型按 model 名匹配 ai_models 表
 */
@Public()
@Controller('ai-models/v1')
export class LlmProxyController {
  constructor(
    private readonly aiClient: AiClientService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('chat/completions')
  async chatCompletions(
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
    @Body()
    body: {
      model?: string;
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      stream?: boolean;
    } = {},
  ) {
    // 认证：远程（非 loopback）请求必须 Bearer 匹配 MEMORY_LLM_PROXY_KEY；
    // 本地 loopback（MemoryCore 等本机服务）信任免认证。阻断「远程未认证即可借用代理」的裸奔。
    const proxyKey = process.env.MEMORY_LLM_PROXY_KEY?.trim();
    const remote = request.ip || request.socket?.remoteAddress || '';
    const isLoopback =
      remote === '127.0.0.1' ||
      remote === '::1' ||
      remote === '::ffff:127.0.0.1' ||
      remote === 'localhost';
    if (!isLoopback) {
      if (!proxyKey) {
        throw new UnauthorizedException('LLM 代理未配置凭据，拒绝远程访问');
      }
      const bearer = (authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!bearer || bearer !== proxyKey) {
        throw new UnauthorizedException('无效的 LLM 代理凭据');
      }
    }

    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException('messages 必填');
    }
    const modelName = String(body?.model || '').trim();
    const model = modelName
      ? await this.prisma.aIModel.findFirst({
          where: { modelId: modelName, enabled: true },
          orderBy: { updatedAt: 'desc' },
        })
      : await this.prisma.aIModel.findFirst({
          where: { enabled: true },
          orderBy: { updatedAt: 'desc' },
        });
    if (!model) throw new BadRequestException('模型不可用');

    const text = await this.aiClient.generate(model.id, messages, {
      maxTokens: 4096,
    });

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model.modelId,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
}
