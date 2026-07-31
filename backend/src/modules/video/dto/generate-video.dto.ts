import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GenerateVideoDto {
  @IsString()
  @IsNotEmpty()
  pipeline: string; // 流水线名，如 short_form / promo / tutorial

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt: string; // 主题或脚本要点

  @IsString()
  user_id?: string; // 多用户隔离（D3=B 复用 JIUZHANG 会话后透传）
}
