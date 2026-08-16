import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContentStrategiesController } from './content-strategies.controller';
import { ContentStrategiesService } from './content-strategies.service';
import { ContentAssetVersioningService } from './content-asset-versioning.service';
import { ContentPlanService } from './content-plan.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContentStrategiesController],
  providers: [
    ContentStrategiesService,
    ContentAssetVersioningService,
    ContentPlanService,
  ],
  exports: [
    ContentStrategiesService,
    ContentAssetVersioningService,
    ContentPlanService,
  ],
})
export class ContentStrategiesModule {}
