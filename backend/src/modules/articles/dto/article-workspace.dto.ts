import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const ARTICLE_CONTENT_TYPES = ['article', 'xiaohongshu'] as const;
const ARTICLE_CONTENT_FORMATS = ['markdown', 'html'] as const;
const ARTICLE_WORKSPACE_INTENT_TASKS = [
  'create',
  'rewrite',
  'multiplatform',
  'prepare',
] as const;
const ARTICLE_WORKSPACE_INTENT_PLATFORMS = [
  'xiaohongshu',
  'douyin',
  'wechat',
  'bilibili',
  'tiktok',
] as const;
const ARTICLE_WORKSPACE_STEPS = [
  'brief',
  'outline',
  'draft',
  'versions',
  'review',
] as const;

function preserveRawInput({ obj, key }: TransformFnParams): unknown {
  const source: unknown = obj;
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[key];
}

export class ArticleWorkspaceIntentDto {
  @ApiProperty({
    description: '从业务结果入口发起的内容任务',
    enum: ARTICLE_WORKSPACE_INTENT_TASKS,
  })
  @IsIn(ARTICLE_WORKSPACE_INTENT_TASKS)
  task: (typeof ARTICLE_WORKSPACE_INTENT_TASKS)[number];

  @ApiPropertyOptional({ description: '预填到任务简报的内容目标' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  goal?: string;

  @ApiPropertyOptional({
    description: '预填到任务简报的目标平台',
    enum: ARTICLE_WORKSPACE_INTENT_PLATFORMS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ARTICLE_WORKSPACE_INTENT_PLATFORMS.length)
  @IsIn(ARTICLE_WORKSPACE_INTENT_PLATFORMS, { each: true })
  platforms?: (typeof ARTICLE_WORKSPACE_INTENT_PLATFORMS)[number][];
}

export class CreateArticleDraftDto {
  @ApiPropertyOptional({ description: '草稿标题', example: '未命名内容' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '草稿正文', default: '' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    description: '内容类型',
    enum: ARTICLE_CONTENT_TYPES,
    default: 'article',
  })
  @IsOptional()
  @IsIn(ARTICLE_CONTENT_TYPES)
  contentType?: (typeof ARTICLE_CONTENT_TYPES)[number];

  @ApiPropertyOptional({
    description: '正文格式',
    enum: ARTICLE_CONTENT_FORMATS,
    default: 'markdown',
  })
  @IsOptional()
  @IsIn(ARTICLE_CONTENT_FORMATS)
  contentFormat?: (typeof ARTICLE_CONTENT_FORMATS)[number];

  @ApiPropertyOptional({
    description: '结果型入口 intent v1；仅用于原子预填新草稿',
    type: ArticleWorkspaceIntentDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ArticleWorkspaceIntentDto)
  workspaceIntent?: ArticleWorkspaceIntentDto;
}

export class UpdateArticleDto {
  @ApiPropertyOptional({ description: '文章标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '文章正文' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '原始 HTML' })
  @IsOptional()
  @IsString()
  rawHtml?: string;

  @ApiPropertyOptional({ description: '最终 HTML' })
  @IsOptional()
  @IsString()
  finalHtml?: string;

  @ApiPropertyOptional({
    description: '正文格式',
    enum: ARTICLE_CONTENT_FORMATS,
  })
  @IsOptional()
  @IsIn(ARTICLE_CONTENT_FORMATS)
  contentFormat?: (typeof ARTICLE_CONTENT_FORMATS)[number];

  @ApiPropertyOptional({
    description: '内容工作区任务简报；字段级约束由领域服务校验',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  workspaceBrief?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: '内容工作区大纲；字段级约束由领域服务校验',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  workspaceOutline?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: '内容工作区当前步骤',
    enum: ARTICLE_WORKSPACE_STEPS,
  })
  @IsOptional()
  @IsIn(ARTICLE_WORKSPACE_STEPS)
  workspaceStep?: (typeof ARTICLE_WORKSPACE_STEPS)[number];

  @ApiPropertyOptional({
    description: '显式请求服务端确认当前持久化大纲',
    default: false,
  })
  @Transform(preserveRawInput)
  @IsOptional()
  @IsBoolean()
  confirmWorkspaceOutline?: boolean;
}
