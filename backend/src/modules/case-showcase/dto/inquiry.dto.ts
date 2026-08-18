import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * 咨询提交 DTO（公开输入契约）。
 *
 * M5 实现：落现有 Lead 表（联系方式加密 + 幂等去重 + 来源归因 + 限流）。
 * 服务端必须按 slug 重新解析来源案例/合集，不信任客户端传入的 ID。
 *
 * 安全：contactValue 仅作输入，公开响应绝不回显（架构 §4.4 Inquiry 提交响应仅咨询编号）。
 */
export class InquiryDto {
  @ApiProperty({ description: '用户称呼（2-30 字）' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(30)
  name: string;

  @ApiPropertyOptional({ description: '来源案例 slug（服务端解析）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceCaseSlug?: string;

  @ApiPropertyOptional({ description: '来源合集 slug（服务端解析）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceCollectionSlug?: string;

  @ApiPropertyOptional({ description: '渠道码（白名单映射）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  channelCode?: string;

  @ApiProperty({
    description: '联系方式（电话/邮箱/微信，落 Lead 时加密存储）',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  contactValue: string;

  @ApiPropertyOptional({
    description: '联系方式类型',
    enum: ['phone', 'email', 'wechat', 'other'],
  })
  @IsOptional()
  @IsIn(['phone', 'email', 'wechat', 'other'])
  contactType?: string;

  @ApiProperty({ description: '需求简述（10-1000 字）' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({ description: '公司/组织' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({ description: '职位' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  position?: string;

  @ApiPropertyOptional({ description: '期望沟通时间（日期/时间段）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preferredTime?: string;

  @ApiProperty({ description: '隐私同意（明示同意，前端不可预选）' })
  @IsBoolean()
  @Equals(true)
  consent: boolean;

  @ApiPropertyOptional({ description: '隐私政策版本' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  consentVersion?: string;

  @ApiPropertyOptional({ description: '幂等键（客户端生成，服务端去重）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
