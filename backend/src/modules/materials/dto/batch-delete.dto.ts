import { IsArray, IsOptional, IsString, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { BackendRiskConfirmationInput } from '../../auth/risk-control';

export class BatchDeleteDto {
  @ApiProperty({ description: '要删除的素材 ID 数组', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  ids: string[];

  @ApiProperty({ description: '高风险操作确认信息', required: false })
  @IsOptional()
  riskConfirmation?: BackendRiskConfirmationInput;
}
