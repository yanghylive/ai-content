import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export type VoiceClientKind =
  | 'bailongma-desktop'
  | 'kaypal-web'
  | 'external-client';

export type VoiceCommandSource = string;

export class VoicePairDto {
  @IsOptional()
  @IsIn(['bailongma-desktop', 'kaypal-web', 'external-client'])
  clientKind?: VoiceClientKind;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(72)
  requestedTtlHours?: number;
}

export class VoiceHeartbeatDto {
  @IsOptional()
  @IsIn(['bailongma-desktop', 'kaypal-web', 'external-client'])
  clientKind?: VoiceClientKind;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsIn(['online', 'idle', 'busy'])
  status?: 'online' | 'idle' | 'busy';
}

export class VoiceCommandDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  source?: VoiceCommandSource;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsIn(['all', 'douyin', 'xiaohongshu', 'bilibili', 'wechat', 'gongzhonghao'])
  platform?:
    | 'all'
    | 'douyin'
    | 'xiaohongshu'
    | 'bilibili'
    | 'wechat'
    | 'gongzhonghao';

  @IsOptional()
  @IsIn(['all', 'post', 'account', 'comment', 'engagement'])
  target?: 'all' | 'post' | 'account' | 'comment' | 'engagement';

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @IsOptional()
  @IsString()
  confirmationId?: string;

  @IsOptional()
  @IsIn(['approve', 'reject'])
  decision?: 'approve' | 'reject';

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class VoiceConfirmDto {
  @IsOptional()
  @IsString()
  confirmationId?: string;

  @IsOptional()
  @IsIn(['approve', 'reject'])
  decision?: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  spokenText?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsObject()
  confirmedChecks?: Record<string, boolean>;
}

export class VoiceChatDto {
  @IsOptional()
  messages?: Array<{
    role?: string;
    content?: string;
  }>;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(4000)
  maxTokens?: number;
}

export class VoiceMediaImageDto {
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsIn(['1:1', '16:9', '4:3', '3:4', '9:16'])
  aspectRatio?: '1:1' | '16:9' | '4:3' | '3:4' | '9:16';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  n?: number;
}

export class VoiceAsrMeterDto {
  @IsOptional()
  @IsIn(['bailongma-desktop', 'kaypal-web', 'external-client'])
  clientKind?: VoiceClientKind;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10 * 60 * 1000)
  durationMs?: number;

  @IsOptional()
  @IsString()
  lang?: string;
}
