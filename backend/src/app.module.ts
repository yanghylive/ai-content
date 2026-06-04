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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
