import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
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
import { VoiceAsrService } from './voice-asr.service';
import { VoiceSettingsService } from './voice-settings.service';
import { VoiceService } from './voice.service';
import { VoiceTtsService } from './voice-tts.service';

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
};

const MAX_PCM_BYTES = 10 * 1024 * 1024; // 10MB 录音上限（≈8分钟）

@ApiTags('语音助手')
@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(
    private readonly voice: VoiceService,
    private readonly asr: VoiceAsrService,
    private readonly tts: VoiceTtsService,
    private readonly settings: VoiceSettingsService,
  ) {}

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
  meterAsr(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VoiceAsrMeterDto,
  ) {
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

  // ── 云 ASR（语音转文字）──

  @Post('asr')
  @ApiOperation({ summary: '上传整段 PCM（16kHz/16bit/mono）识别为文字' })
  async transcribe(@Req() request: AuthenticatedRequest, @Res() res: Response) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);
    if (!body.length) {
      throw new HttpException('未收到音频数据', HttpStatus.BAD_REQUEST);
    }
    if (body.length > MAX_PCM_BYTES) {
      throw new HttpException('录音过长，请控制在 8 分钟内', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const result = await this.asr.transcribePcm(body);
    res.json({ ok: true, ...result });
  }

  @Get('asr/capabilities')
  @ApiOperation({ summary: '云 ASR 服务商能力与当前配置状态' })
  async asrCapabilities() {
    const cfg = await this.settings.getSettings('asr');
    return {
      provider: cfg.provider || 'aliyun',
      configured: Boolean(
        cfg.aliyunApiKey ||
          (cfg.tencentSecretId && cfg.tencentSecretKey) ||
          cfg.xunfeiApiKey ||
          cfg.volcAsrApiKey,
      ),
      settings: cfg,
    };
  }

  // ── 云 TTS（文字转语音）──

  @Post('tts/stream')
  @ApiOperation({ summary: '文本 → 流式音频（POST body JSON {text}）' })
  async ttsStream(
    @Req() request: AuthenticatedRequest,
    @Body() dto: { text?: string; provider?: string; voiceId?: string },
    @Res() res: Response,
  ) {
    const result = await this.tts.synthesize(dto?.text || '', {
      provider: dto?.provider,
      voiceId: dto?.voiceId,
    });
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-store');
    result.stream.pipe(res);
  }

  @Get('tts/capabilities')
  @ApiOperation({ summary: 'TTS 服务商与音色列表（设置页用）' })
  ttsCapabilities() {
    return this.tts.listCapabilities();
  }

  // ── 语音设置（云凭证，脱敏存取）──

  @Get('settings/asr')
  @ApiOperation({ summary: '读取云 ASR 设置（脱敏）' })
  getAsrSettings() {
    return this.settings.getSettings('asr');
  }

  @Put('settings/asr')
  @ApiOperation({ summary: '保存云 ASR 设置（secret 掩码值不覆盖）' })
  updateAsrSettings(@Body() patch: Record<string, string>) {
    return this.settings.updateSettings('asr', patch);
  }

  @Get('settings/tts')
  @ApiOperation({ summary: '读取云 TTS 设置（脱敏）' })
  getTtsSettings() {
    return this.settings.getSettings('tts');
  }

  @Put('settings/tts')
  @ApiOperation({ summary: '保存云 TTS 设置（secret 掩码值不覆盖）' })
  updateTtsSettings(@Body() patch: Record<string, string>) {
    return this.settings.updateSettings('tts', patch);
  }
}
