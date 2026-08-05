import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AiModelsModule } from './modules/ai-models/ai-models.module';
import { SourcesModule } from './modules/sources/sources.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { TopicsModule } from './modules/topics/topics.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
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
import { RuntimeModule } from './modules/runtime/runtime.module';
import { GeoBridgeModule } from './modules/geo-bridge/geo-bridge.module';
import { AuthRequestContextModule } from './common/auth-request-context.module';
import { DemoModule } from './demo/demo.module';
import { WecomAssistantModule } from './modules/wecom-assistant/wecom-assistant.module';
import { AiEmployeeModule } from './modules/ai-employee/ai-employee.module';
import { VideoFaceSwapModule } from './modules/video-face-swap/video-face-swap.module';
import { VideoGenerationModule } from './modules/video-generation/video-generation.module';
import { VideoWorkshopModule } from './modules/video-workshop/video-workshop.module';
import { AppMarketModule } from './modules/app-market/app-market.module';
import { CrmModule } from './modules/crm/crm.module';
import { GrowthModule } from './modules/growth/growth.module';
import { CommercialReadinessModule } from './modules/commercial-readiness/commercial-readiness.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { RedfoxModule } from './modules/redfox/redfox.module';
import { ContentOptimizationModule } from './modules/content-optimization/content-optimization.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { CommentInsightsModule } from './modules/comment-insights/comment-insights.module';
import { SolutionsModule } from './modules/solutions/solutions.module';
import { BillingModule } from './modules/billing/billing.module';
import { VoiceModule } from './modules/voice/voice.module';
import { AgentWakerModule } from './modules/agentwaker/agentwaker.module';
import { VideoModule } from './modules/video/video.module';
import { LocalBridgeModule } from './modules/local-bridge/local-bridge.module';
import { PushNotificationsModule } from './modules/push-notifications/push-notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
      envFilePath: '.env',
    }),
    AuthRequestContextModule,
    DemoModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    AiModelsModule,
    SourcesModule,
    MaterialsModule,
    TopicsModule,
    DashboardModule,
    SystemLogsModule,
    StylesModule,
    ArticlesModule,
    SchedulesModule,
    PublishingModule,
    StorageModule,
    AuthModule,
    ContentStrategiesModule,
    LocalEngineModule,
    RuntimeModule,
    GeoBridgeModule,
    AppMarketModule,
    CrmModule,
    CommercialReadinessModule,
    WecomAssistantModule,
    VideoWorkshopModule,
    VideoFaceSwapModule,
    VideoGenerationModule,
    AiEmployeeModule,
    GrowthModule,
    RedfoxModule,
    IntelligenceModule,
    ContentOptimizationModule,
    ComplianceModule,
    CommentInsightsModule,
    BillingModule,
    SolutionsModule,
    VoiceModule,
    AgentWakerModule,
    VideoModule,
    LocalBridgeModule,
    PushNotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
