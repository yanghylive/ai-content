import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { OptimizationPlatform } from '../content-optimization.types';

export class SaveContentVersionDto {
  @ApiPropertyOptional({ description: '草稿 ID；不传则自动创建轻量草稿' })
  @IsOptional()
  @IsString()
  draftId?: string;

  @ApiPropertyOptional({ description: '来源对象类型，例如 article、material' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: '来源对象 ID' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiProperty({ description: '优化模式：title、rewrite、xhs' })
  @IsString()
  mode: string;

  @ApiProperty({ description: '优化模式展示名' })
  @IsString()
  modeLabel: string;

  @ApiProperty({ description: '版本标题' })
  @IsString()
  title: string;

  @ApiProperty({ description: '版本正文' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '原始标题' })
  @IsOptional()
  @IsString()
  originalTitle?: string;

  @ApiPropertyOptional({ description: '原始正文' })
  @IsOptional()
  @IsString()
  originalContent?: string;

  @ApiPropertyOptional({ description: '目标平台' })
  @IsOptional()
  @IsString()
  platform?: OptimizationPlatform;

  @ApiPropertyOptional({ description: '内容类型' })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional({ description: '内部优化调用 ID，仅用于追溯' })
  @IsOptional()
  @IsString()
  sourceWorkflowId?: string;

  @ApiPropertyOptional({ description: '业务摘要' })
  @IsOptional()
  @IsString()
  sourceSummary?: string;
}

export class QueryContentVersionsDto {
  @ApiPropertyOptional({ description: '草稿 ID' })
  @IsOptional()
  @IsString()
  draftId?: string;

  @ApiPropertyOptional({ description: '来源对象类型，例如 article、material' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: '来源对象 ID' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ description: '目标平台' })
  @IsOptional()
  @IsString()
  platform?: OptimizationPlatform;

  @ApiPropertyOptional({ description: '内容状态，例如 draft、official' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateContentDraftDto {
  @ApiProperty({ description: '草稿标题' })
  @IsString()
  title: string;

  @ApiProperty({ description: '草稿正文' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '来源对象类型' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: '来源对象 ID' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ description: '目标平台' })
  @IsOptional()
  @IsString()
  platform?: OptimizationPlatform;

  @ApiPropertyOptional({ description: '内容类型' })
  @IsOptional()
  @IsString()
  targetType?: string;
}

export class CreatePublishIntentDto {
  @ApiProperty({ description: '版本 ID' })
  @IsString()
  versionId: string;

  @ApiPropertyOptional({ description: '目标平台' })
  @IsOptional()
  @IsString()
  platform?: OptimizationPlatform;

  @ApiPropertyOptional({ description: '计划发布时间 ISO 字符串' })
  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

export class MarkContentVersionComplianceDto {
  @ApiProperty({ description: '合规检查 ID' })
  @IsString()
  checkId: string;

  @ApiProperty({ description: '风险等级：pass、low、medium、high' })
  @IsIn(['pass', 'low', 'medium', 'high'])
  riskLevel: 'pass' | 'low' | 'medium' | 'high';

  @ApiProperty({ description: '风险分数' })
  @IsNumber()
  @Min(0)
  @Max(100)
  riskScore: number;

  @ApiProperty({ description: '合规检查摘要' })
  @IsString()
  summary: string;

  @ApiPropertyOptional({ description: '检查时间 ISO 字符串' })
  @IsOptional()
  @IsDateString()
  checkedAt?: string;
}

export class SetOfficialVersionDto {
  @ApiPropertyOptional({ description: '是否回写草稿正文' })
  @IsOptional()
  @IsBoolean()
  writeBackDraft?: boolean;
}

export class ManualReviewVersionDto {
  @ApiPropertyOptional({ description: '复核备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateContentVersionFeedbackDto {
  @ApiPropertyOptional({ description: '关联的发布准备 ID' })
  @IsOptional()
  @IsString()
  publishIntentId?: string;

  @ApiPropertyOptional({ description: '目标平台' })
  @IsOptional()
  @IsString()
  platform?: OptimizationPlatform;

  @ApiPropertyOptional({ description: '阅读量' })
  @IsOptional()
  @IsNumber()
  views?: number;

  @ApiPropertyOptional({ description: '点赞量' })
  @IsOptional()
  @IsNumber()
  likes?: number;

  @ApiPropertyOptional({ description: '评论量' })
  @IsOptional()
  @IsNumber()
  comments?: number;

  @ApiPropertyOptional({ description: '收藏量' })
  @IsOptional()
  @IsNumber()
  saves?: number;

  @ApiPropertyOptional({ description: '线索数' })
  @IsOptional()
  @IsNumber()
  leads?: number;

  @ApiPropertyOptional({ description: '复盘备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateContentVersionCommentDto {
  @ApiProperty({ description: '协作备注正文' })
  @IsString()
  body: string;
}
