import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { ErrorReportModule } from './modules/error-report/error-report.module';
import { AiModelsModule } from './modules/ai-models/ai-models.module';
import { SourcesModule } from './modules/sources/sources.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { TopicsModule } from './modules/topics/topics.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { StatsModule } from './modules/stats/stats.module';
import { RpaModule } from './modules/rpa/rpa.module';
import { SystemLogsModule } from './modules/system-logs/system-logs.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScheduleModule } from '@nestjs/schedule';
import { StylesModule } from './modules/styles/styles.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContentStrategiesModule } from './modules/content-strategies/content-strategies.module';
import { LocalEngineModule } from './modules/local-engine/local-engine.module';
import { MaiUiModule } from './modules/mai-ui/mai-ui.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { GeoBridgeModule } from './modules/geo-bridge/geo-bridge.module';
import { AuthRequestContextModule } from './common/auth-request-context.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { SavingsModule } from './modules/savings/savings.module';
import { WecomAssistantModule } from './modules/wecom-assistant/wecom-assistant.module';
import { WecomCrmModule } from './modules/wecom-crm/wecom-crm.module';
import { ClientConfigModule } from './modules/client-config/client-config.module';
import { BossRecruitModule } from './modules/boss-recruit/boss-recruit.module';
import { AiEmployeeModule } from './modules/ai-employee/ai-employee.module';
import { VideoFaceSwapModule } from './modules/video-face-swap/video-face-swap.module';
import { VideoGenerationModule } from './modules/video-generation/video-generation.module';
import { VideoWorkshopModule } from './modules/video-workshop/video-workshop.module';
import { AppMarketModule } from './modules/app-market/app-market.module';
import { CrmModule } from './modules/crm/crm.module';
import { GrowthModule } from './modules/growth/growth.module';
import { LeadsModule } from './modules/leads/leads.module';
import { CommercialReadinessModule } from './modules/commercial-readiness/commercial-readiness.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { RedfoxModule } from './modules/redfox/redfox.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { ContentOptimizationModule } from './modules/content-optimization/content-optimization.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { CommentInsightsModule } from './modules/comment-insights/comment-insights.module';
import { CommentAcquisitionModule } from './modules/comment-acquisition/comment-acquisition.module';
import { AiFlavorModule } from './modules/ai-flavor/ai-flavor.module';
import { ContentReviewModule } from './modules/content-review/content-review.module';
import { SolutionsModule } from './modules/solutions/solutions.module';
import { BillingModule } from './modules/billing/billing.module';
import { VoiceModule } from './modules/voice/voice.module';
import { AgentWakerModule } from './modules/agentwaker/agentwaker.module';
import { VideoModule } from './modules/video/video.module';
import { PoiModule } from './modules/poi/poi.module';
import { LocalBridgeModule } from './modules/local-bridge/local-bridge.module';
import { PushNotificationsModule } from './modules/push-notifications/push-notifications.module';
import { MultimodalModule } from './modules/multimodal/multimodal.module';
import { MobileExecutorModule } from './modules/mobile-executor/mobile-executor.module';
import { DashscopeModule } from './modules/dashscope/dashscope.module';
import { CaseShowcaseModule } from './modules/case-showcase/case-showcase.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
      envFilePath: '.env',
    }),
    AuthRequestContextModule,
    AiGatewayModule,
    AiAssistantModule,
    ReportingModule,
    SavingsModule,
    ErrorReportModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    AiModelsModule,
    SourcesModule,
    MaterialsModule,
    TopicsModule,
    DashboardModule,
    StatsModule,
    RpaModule,
    SystemLogsModule,
    StylesModule,
    ArticlesModule,
    SchedulesModule,
    PublishingModule,
    StorageModule,
    AuthModule,
    ContentStrategiesModule,
    LocalEngineModule,
    MaiUiModule,
    RuntimeModule,
    GeoBridgeModule,
    AppMarketModule,
    CrmModule,
    LeadsModule,
    CommercialReadinessModule,
    WecomAssistantModule,
    WecomCrmModule,
    ClientConfigModule,
    BossRecruitModule,
    VideoWorkshopModule,
    VideoFaceSwapModule,
    VideoGenerationModule,
    AiEmployeeModule,
    GrowthModule,
    RedfoxModule,
    KnowledgeModule,
    IntelligenceModule,
    ContentOptimizationModule,
    ComplianceModule,
    WorkflowModule,
    DiscoveryModule,
    OutboxModule,
    CommentInsightsModule,
    CommentAcquisitionModule,
    AiFlavorModule,
    ContentReviewModule,
    BillingModule,
    SolutionsModule,
    VoiceModule,
    AgentWakerModule,
    VideoModule,
    PoiModule,
    LocalBridgeModule,
    PushNotificationsModule,
    MultimodalModule,
    MobileExecutorModule,
    DashscopeModule,
    CaseShowcaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
