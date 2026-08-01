import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateAgentWakerRunDto {
  @IsIn(['xiaohongshu-operator', 'wechat-official-account-operator'])
  role!: 'xiaohongshu-operator' | 'wechat-official-account-operator';

  @IsIn(['note-package', 'article-pipeline'])
  workflow!: 'note-package' | 'article-pipeline';

  @IsString()
  goal!: string;

  @IsObject()
  inputs!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsBoolean()
  generateCards?: boolean;
}
