import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const intelligenceDispatchRecordActions = [
  'approve',
  'reject',
  'publish_rule',
  'watch_priority',
  'archive',
  'create_growth_lead',
  'mark_done',
] as const;

export type IntelligenceDispatchRecordAction =
  (typeof intelligenceDispatchRecordActions)[number];

export class ProcessIntelligenceDispatchRecordDto {
  @ApiProperty({
    description: 'Business action to run on a dispatched intelligence record',
    enum: intelligenceDispatchRecordActions,
  })
  @IsIn(intelligenceDispatchRecordActions)
  action!: IntelligenceDispatchRecordAction;

  @ApiPropertyOptional({ description: 'Operator note kept in the action log' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Optional custom status override' })
  @IsOptional()
  @IsString()
  status?: string;
}
