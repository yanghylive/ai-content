import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireKaypalRoles } from '../auth/roles.decorator';
import { ContentHealthService } from './content-health.service';

/**
 * 内容健康后台 API（M6）。
 *
 * 复用全局 AuthGuard + @RequireKaypalRoles 鉴权（仅 admin/owner），
 * 聚合链接健康度 + 授权到期 + 内容复核三类运营待办，供后台看板使用。
 */
@ApiTags('case-showcase-admin')
@RequireKaypalRoles('admin', 'owner')
@Controller('admin')
export class ContentHealthController {
  constructor(private readonly health: ContentHealthService) {}

  @Get('content-health')
  @ApiOperation({
    summary: '内容健康总览（链接健康度聚合 + 异常明细 + 授权到期 + 待复核）',
  })
  async getContentHealth() {
    const [endpoints, authorizationsExpiring, reviewsDue] = await Promise.all([
      this.health.getDemoEndpointHealth(),
      this.health.checkAuthorizationExpiry(),
      this.health.checkReviewDue(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      demoEndpoints: endpoints.summary,
      demoEndpointAnomalies: endpoints.anomalies,
      authorizationsExpiring,
      reviewsDue,
    };
  }
}
