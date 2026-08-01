import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateIntelligenceReportDto {
  @ApiProperty({ description: 'Report template kind, e.g. daily/risk' })
  @IsString()
  kind!: string;

  @ApiProperty({ description: 'Report title' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ description: 'Target audience' })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiPropertyOptional({ description: 'Responsible owner role' })
  @IsOptional()
  @IsString()
  owner?: string;

  @ApiPropertyOptional({ description: 'Selected report time range key' })
  @IsOptional()
  @IsString()
  rangeKey?: string;

  @ApiPropertyOptional({ description: 'Report workflow status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Evidence completeness score 0-100' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  completeness?: number;

  @ApiPropertyOptional({
    description: 'Report conclusion lines',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findings?: string[];

  @ApiPropertyOptional({
    description: 'Evidence titles or IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence?: string[];

  @ApiProperty({ description: 'Markdown report body' })
  @IsString()
  markdown!: string;

  @ApiPropertyOptional({ description: 'Extra report metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
