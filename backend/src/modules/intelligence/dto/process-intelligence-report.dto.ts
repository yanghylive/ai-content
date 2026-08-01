import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const intelligenceReportActions = [
  'submit_review',
  'mark_delivered',
  'archive',
  'reopen',
] as const;

export type IntelligenceReportAction =
  (typeof intelligenceReportActions)[number];

export class ProcessIntelligenceReportDto {
  @ApiProperty({
    description: 'Report workflow action',
    enum: intelligenceReportActions,
  })
  @IsIn(intelligenceReportActions)
  action!: IntelligenceReportAction;

  @ApiPropertyOptional({ description: 'Operator note stored in metadata' })
  @IsOptional()
  @IsString()
  note?: string;
}
