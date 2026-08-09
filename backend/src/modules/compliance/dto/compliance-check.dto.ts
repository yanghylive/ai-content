import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type {
  CompliancePlatform,
  ComplianceTargetType,
} from '../compliance.types';

export class ComplianceCheckDto {
  @ApiProperty({ description: '需要审核的正文、标题或脚本文案' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '目标平台', default: 'all' })
  @IsOptional()
  @IsString()
  platform?: CompliancePlatform;

  @ApiPropertyOptional({ description: '审核对象类型', default: 'article' })
  @IsOptional()
  @IsString()
  targetType?: ComplianceTargetType;

  @ApiPropertyOptional({
    description: '业务对象 ID，例如 articleId、noteId、taskId',
  })
  @IsOptional()
  @IsString()
  targetId?: string;

  @ApiPropertyOptional({ description: '标题或封面文案' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: '发布场景，例如 draft、pre_publish、reply_rule',
  })
  @IsOptional()
  @IsString()
  scenario?: string;
}
