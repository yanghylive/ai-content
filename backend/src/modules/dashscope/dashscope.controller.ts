import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MultimodalService } from '../multimodal/multimodal.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

/**
 * 多模态（P4）：Qwen-Image 生图 + CosyVoice/qwen3-tts 配音。
 * 2026-08-09 起统一走模型台（kaypal 云端网关 + 积分结算），不再百炼直连：
 * - /api/ai/image、/api/ai/speech → MultimodalService（模型台 OpenAI 兼容端点，云端按用户记账）
 * - 语音识别已迁移至 /api/voice/asr（kaypal 网关 audio 端点），本控制器不再提供直连 ASR。
 */
@ApiTags('多模态（P4，模型台网关）')
@Controller('ai')
export class DashscopeController {
  constructor(private readonly multimodal: MultimodalService) {}

  @Post('image')
  @ApiOperation({ summary: 'Qwen-Image 生图（入素材库，走模型台网关 + 云端积分）' })
  generateImage(
    @Req() request: AuthenticatedRequest,
    @Body() input: { prompt: string; size?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.multimodal.generateImage(request.authUser, input || {});
  }

  @Post('video')
  @ApiOperation({ summary: '万相/快乐马 文生/图生视频（入素材库，百炼直连或网关回退）' })
  generateVideo(
    @Req() request: AuthenticatedRequest,
    @Body() input: { prompt: string; duration?: number; ratio?: string; imageUrl?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.multimodal.generateVideo(request.authUser, input || {});
  }

  @Post('speech')
  @ApiOperation({ summary: '配音（文本 → 音频入素材库，走模型台网关 + 云端积分）' })
  generateSpeech(
    @Req() request: AuthenticatedRequest,
    @Body() input: { text: string; voice?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.multimodal.generateSpeech(request.authUser, input || {});
  }
}
