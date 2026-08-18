import { Module } from '@nestjs/common';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import { CaseShowcaseController } from './case-showcase.controller';
import { CaseValidationService } from './case-validation.service';
import { CaseRepository } from './case.repository';
import { ShortLinkService } from './short-link.service';
import { LinkHealthCheckService } from './link-health-check.service';
import { InquiryService } from './inquiry.service';
import { InquiryRateLimiter } from './inquiry-rate-limiter';
import { ContentHealthService } from './content-health.service';
import { ContentHealthController } from './content-health.controller';
import { CaseAdminService } from './case-admin.service';
import { CaseAdminController } from './case-admin.controller';
import { CaseEventsService } from './case-events.service';
import { CaseEventsController } from './case-events.controller';

/**
 * 案例展示中心模块。
 *
 * 公开端匿名：CaseShowcaseController 类级 @Public()，不依赖 auth guard。
 * CaseRepository 提供公开只读查询（列表/详情/分类）；PrismaModule 为全局模块，
 * 无需显式 import 即可注入 PrismaService。
 *
 * M4：ShortLinkService 短链跳转（防开放重定向）+ LinkHealthCheckService
 * 链接健康检查（@Cron 依赖全局 ScheduleModule.forRoot()）。
 *
 * M5：InquiryService 咨询落 Lead（复用 CredentialEnvelopeService 加密联系方式，
 * ConfigModule 为全局模块，ConfigService 可直接注入）+ InquiryRateLimiter 限流。
 *
 * M6：ContentHealthService 内容健康（授权到期/内容复核/链接健康度）+ CaseAdminService
 * 后台案例管理（CRUD/审核/精选位/审计），对应 ContentHealthController/CaseAdminController
 * 后台权限接口（@RequireKaypalRoles，复用全局 AuthGuard）。
 */
@Module({
  controllers: [
    CaseShowcaseController,
    ContentHealthController,
    CaseAdminController,
    CaseEventsController,
  ],
  providers: [
    CaseValidationService,
    CaseRepository,
    ShortLinkService,
    LinkHealthCheckService,
    CredentialEnvelopeService,
    InquiryRateLimiter,
    InquiryService,
    ContentHealthService,
    CaseAdminService,
    CaseEventsService,
  ],
  exports: [CaseValidationService, CaseRepository, ShortLinkService],
})
export class CaseShowcaseModule {}
