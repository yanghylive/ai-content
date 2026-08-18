import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaseSummaryDto } from './case-summary.dto';

/**
 * 公开案例列表响应（GET /api/v1/cases）。
 * data 为白名单序列化后的摘要，nextCursor 为下一页游标（null 表示没有更多）。
 */
export class CaseListResponseDto {
  @ApiProperty({ type: [CaseSummaryDto], description: '案例摘要列表' })
  data: CaseSummaryDto[];

  @ApiPropertyOptional({
    description: '下一页游标（null 表示没有更多）',
    nullable: true,
  })
  nextCursor: string | null;
}
