import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DashscopeAsrService } from './dashscope-asr.service';
import { DashscopeMultimodalService } from './dashscope-multimodal.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

/** 上传文件形状（避免依赖 @types/multer） */
interface UploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/**
 * 阿里百炼（B3/P4）：语音识别 ASR + Qwen-Image 生图 + qwen3-tts 配音
 */
@ApiTags('阿里百炼（B3 ASR / P4 多模态）')
@Controller('ai')
export class DashscopeController {
  constructor(
    private readonly asr: DashscopeAsrService,
    private readonly multimodal: DashscopeMultimodalService,
  ) {}

  @Post('asr')
  @ApiOperation({ summary: '语音识别：录音上传 → 文本（B3）' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  transcribe(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: UploadFile,
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    if (!file?.buffer) throw new BadRequestException('缺少音频文件（file）');
    return this.asr.transcribe(file.buffer, file.originalname);
  }

  @Post('image')
  @ApiOperation({ summary: 'Qwen-Image 生图（入素材库，P4 百炼直连）' })
  generateImage(
    @Req() request: AuthenticatedRequest,
    @Body() input: { prompt: string; size?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.multimodal.generateImage(request.authUser, input || {});
  }

  @Post('speech')
  @ApiOperation({ summary: 'qwen3-tts 配音（文本 → 音频入素材库，P4）' })
  generateSpeech(
    @Req() request: AuthenticatedRequest,
    @Body() input: { text: string; voice?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.multimodal.generateSpeech(request.authUser, input || {});
  }
}
