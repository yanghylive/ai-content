import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class RunRedfoxSkillDto {
  @ApiPropertyOptional({ description: 'RedFox Skill code, no, or name' })
  @IsOptional()
  @IsString()
  skillCode?: string;

  @ApiPropertyOptional({
    description: 'Readable Skill name when code is unknown',
  })
  @IsOptional()
  @IsString()
  skillName?: string;

  @ApiPropertyOptional({ description: 'RedFox API path for real execution' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({
    description: 'HTTP method',
    enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    default: 'POST',
  })
  @IsOptional()
  @IsIn(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

  @ApiPropertyOptional({
    description: 'Generic input used by dry-run planning',
  })
  @IsOptional()
  input?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Query parameters for RedFox request' })
  @IsOptional()
  query?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Request body for RedFox request' })
  @IsOptional()
  body?: unknown;

  @ApiPropertyOptional({
    description: 'Request body encoding',
    enum: ['json', 'form'],
    default: 'json',
  })
  @IsOptional()
  @IsIn(['json', 'form'])
  bodyEncoding?: 'json' | 'form';

  @ApiPropertyOptional({
    description: 'Business operation name for audit logs',
  })
  @IsOptional()
  @IsString()
  operation?: string;

  @ApiPropertyOptional({ description: 'Estimated cost points', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCostPoints?: number;

  @ApiPropertyOptional({
    description: 'Force dry-run planning mode',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: 'Solution run id for ledger linkage' })
  @IsOptional()
  @IsString()
  solutionRunId?: string;

  @ApiPropertyOptional({ description: 'Solution task id for ledger linkage' })
  @IsOptional()
  @IsString()
  solutionTaskId?: string;

  @ApiPropertyOptional({ description: 'Client supplied idempotency key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description:
      'Deprecated compatibility field. Real execution no longer requires a manual confirmation phrase.',
  })
  @IsOptional()
  @IsString()
  confirmRealExecution?: string;
}
