import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReplySuggestDto {
  @ApiPropertyOptional({ description: '评论内容（必传）' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({
    description:
      '语气偏好：formal（正式）/ friendly（亲切）/ professional（专业），不传则各出一版',
  })
  @IsOptional()
  @IsString()
  tone?: 'formal' | 'friendly' | 'professional';

  @ApiPropertyOptional({ description: '产品或服务名称，用于回复时自然带出' })
  @IsOptional()
  @IsString()
  productName?: string;
}
