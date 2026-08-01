import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type {
  CompliancePlatform,
  ComplianceRiskLevel,
} from '../compliance.types';

export class QueryComplianceChecksDto {
  @ApiPropertyOptional({ description: '平台筛选' })
  @IsOptional()
  @IsString()
  platform?: CompliancePlatform;

  @ApiPropertyOptional({ description: '风险等级筛选' })
  @IsOptional()
  @IsString()
  riskLevel?: ComplianceRiskLevel;

  @ApiPropertyOptional({ description: '业务对象 ID' })
  @IsOptional()
  @IsString()
  targetId?: string;
}
