import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createRiskContextFromRequest } from '../auth/risk-control';
import {
  VoiceAsrMeterDto,
  VoiceChatDto,
  VoiceCommandDto,
  VoiceConfirmDto,
  VoiceHeartbeatDto,
  VoiceMediaImageDto,
  VoicePairDto,
} from './dto/voice.dto';
import { VoiceService } from './voice.service';

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
};

@ApiTags('语音助手')
@Controller('voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get('state')
  @ApiOperation({ summary: '获取 3010 内置语音模块状态' })
  state(@Req() request: AuthenticatedRequest) {
    return this.voice.getState(request.authUser);
  }

  @Post('command')
  @ApiOperation({ summary: '执行一条来自 BaiLongma 的语音命令' })
  command(@Req() request: AuthenticatedRequest, @Body() dto: VoiceCommandDto) {
    return this.voice.command(
      request.authUser,
      dto,
      createRiskContextFromRequest(request),
    );
  }

  @Post('chat')
  @ApiOperation({ summary: '使用当前 KAYPAL 账户的模型能力回复 BaiLongma' })
  chat(@Req() request: AuthenticatedRequest, @Body() dto: VoiceChatDto) {
    return this.voice.chat(request.authUser, dto);
  }

  @Post('media/image')
  @ApiOperation({ summary: '使用当前 KAYPAL 账户的媒体能力生成图片' })
  generateImage(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VoiceMediaImageDto,
  ) {
    return this.voice.generateImage(request.authUser, dto);
  }

  @Post('asr/meter')
  @ApiOperation({ summary: '确认 BaiLongma 语音识别使用 KAYPAL 账号用量' })
  meterAsr(@Req() request: AuthenticatedRequest, @Body() dto: VoiceAsrMeterDto) {
    return this.voice.meterAsr(request.authUser, dto);
  }

  @Post('confirm')
  @ApiOperation({ summary: '通过语音确认或拒绝 3010 待确认动作' })
  confirm(@Req() request: AuthenticatedRequest, @Body() dto: VoiceConfirmDto) {
    return this.voice.confirm(
      request.authUser,
      dto,
      createRiskContextFromRequest(request),
    );
  }

  @Post('session/pair')
  @ApiOperation({ summary: '为 3010 内置语音模块签发短期 Bearer token' })
  pair(@Req() request: AuthenticatedRequest, @Body() dto: VoicePairDto) {
    return this.voice.pair(request.authUser, request.authSessionId, dto);
  }

  @Post('session/heartbeat')
  @ApiOperation({ summary: '3010 内置语音模块连接心跳' })
  heartbeat(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VoiceHeartbeatDto,
  ) {
    return this.voice.heartbeat(request.authUser, dto);
  }
}
