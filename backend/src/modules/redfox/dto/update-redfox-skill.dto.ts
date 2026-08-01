import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateRedfoxSkillDto {
  @ApiPropertyOptional({ description: 'Whether this Skill is enabled locally' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Local business scenario binding' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  scenario?: string | null;

  @ApiPropertyOptional({ description: 'Local tags merged with remote tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
