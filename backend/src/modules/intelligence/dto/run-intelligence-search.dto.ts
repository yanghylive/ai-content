import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class RunIntelligenceSearchDto {
  @ApiProperty({ description: 'Keyword or business question to search' })
  @IsString()
  @IsNotEmpty()
  keyword!: string;

  @ApiPropertyOptional({
    description: 'Platform scope',
    enum: [
      'all',
      'douyin',
      'xiaohongshu',
      'bilibili',
      'wechat',
      'gongzhonghao',
    ],
    default: 'all',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizeSearchPlatform(value))
  @IsIn(['all', 'douyin', 'xiaohongshu', 'bilibili', 'wechat', 'gongzhonghao'])
  platform?: string;

  @ApiPropertyOptional({
    description: 'Search target',
    enum: ['all', 'post', 'account', 'comment', 'engagement'],
    default: 'post',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizeSearchTarget(value))
  @IsIn(['all', 'post', 'account', 'comment', 'engagement'])
  target?: string;

  @ApiPropertyOptional({ description: 'Maximum normalized items', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Legacy local runtime account id, kept for backward compatibility',
  })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({
    description:
      'Work URL for comment analysis or WeChat article engagement analysis',
  })
  @IsOptional()
  @IsString()
  workUrl?: string;

  @ApiPropertyOptional({
    description: 'Work id for comment analysis, e.g. videoId/noteId/BV id',
  })
  @IsOptional()
  @IsString()
  workId?: string;

  @ApiPropertyOptional({ description: 'Cursor for paged comment analysis' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page number for comment pagination',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;
}

function normalizeSearchPlatform(value: unknown) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    全部: 'all',
    全网: 'all',
    全平台: 'all',
    所有: 'all',
    all: 'all',
    抖音: 'douyin',
    dy: 'douyin',
    douyin: 'douyin',
    小红书: 'xiaohongshu',
    小紅書: 'xiaohongshu',
    xhs: 'xiaohongshu',
    redbook: 'xiaohongshu',
    xiaohongshu: 'xiaohongshu',
    b站: 'bilibili',
    哔哩哔哩: 'bilibili',
    嗶哩嗶哩: 'bilibili',
    bili: 'bilibili',
    bilibili: 'bilibili',
    微信: 'gongzhonghao',
    公众号: 'gongzhonghao',
    微信公众号: 'gongzhonghao',
    微信公众平台: 'gongzhonghao',
    wechat: 'gongzhonghao',
    weixin: 'gongzhonghao',
    gzh: 'gongzhonghao',
    gongzhonghao: 'gongzhonghao',
  };
  return aliases[normalized] || normalized;
}

function normalizeSearchTarget(value: unknown) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    全部: 'all',
    所有: 'all',
    all: 'all',
    作品: 'post',
    内容: 'post',
    笔记: 'post',
    视频: 'post',
    post: 'post',
    article: 'post',
    账号: 'account',
    账户: 'account',
    达人: 'account',
    account: 'account',
    user: 'account',
    评论: 'comment',
    comment: 'comment',
    互动: 'engagement',
    文章互动: 'engagement',
    engagement: 'engagement',
  };
  return aliases[normalized] || normalized;
}
