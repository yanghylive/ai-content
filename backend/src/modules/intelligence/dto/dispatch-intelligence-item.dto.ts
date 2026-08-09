import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class DispatchIntelligenceItemDto {
  @ApiProperty({
    description:
      'Action key or user-facing label, for example risk_review, rules, benchmark_account or comment_insight',
  })
  @IsString()
  action!: string;

  @ApiPropertyOptional({ description: 'User-facing action label' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: 'Target business module label' })
  @IsOptional()
  @IsString()
  target?: string;

  @ApiPropertyOptional({ description: 'Target route for the frontend queue' })
  @IsOptional()
  @IsString()
  href?: string;

  @ApiPropertyOptional({
    description: 'Risk level carried by the frontend judgment',
    enum: ['low', 'medium', 'high'],
  })
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  risk?: 'low' | 'medium' | 'high';

  @ApiPropertyOptional({ description: 'Why this dispatch is appropriate' })
  @IsOptional()
  @IsString()
  reason?: string;
}
