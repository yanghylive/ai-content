import { ApiProperty } from '@nestjs/swagger';
import { CaseDetailDto } from './case-detail.dto';
import { CaseSummaryDto } from './case-summary.dto';

/**
 * 公开案例详情响应（GET /api/v1/cases/:slug）。
 * 继承 CaseDetailDto 白名单字段，并附带相关案例摘要（relatedCases）。
 */
export class CaseDetailResponseDto extends CaseDetailDto {
  @ApiProperty({
    type: [CaseSummaryDto],
    description: '相关案例（同主行业或能力标签交集）',
  })
  relatedCases: CaseSummaryDto[];
}
