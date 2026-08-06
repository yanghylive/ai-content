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
import { MultimodalService } from './multimodal.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

/**
 * 多模态（P4）：Qwen-Image 生图 / CosyVoice 配音 → 素材库
 */
@ApiTags('多模态（P4）')
@Controller('ai')
export class MultimodalController {
  constructor(private readonly multimodal: MultimodalService) {}

  @Post('image')
  @ApiOperation({ summary: 'Qwen-Image 生图（入素材库）' })
  generateImage(
    @Req() request: AuthenticatedRequest,
    @Body() input: { prompt: string; size?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.multimodal.generateImage(request.authUser, input || {});
  }

  @Post('speech')
  @ApiOperation({ summary: 'CosyVoice 配音（文本 → 音频入素材库）' })
  generateSpeech(
    @Req() request: AuthenticatedRequest,
    @Body() input: { text: string; voice?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.multimodal.generateSpeech(request.authUser, input || {});
  }
}
