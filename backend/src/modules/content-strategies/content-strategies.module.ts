import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContentStrategiesController } from './content-strategies.controller';
import { ContentStrategiesService } from './content-strategies.service';
import { ContentAssetVersioningService } from './content-asset-versioning.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContentStrategiesController],
  providers: [ContentStrategiesService, ContentAssetVersioningService],
  exports: [ContentStrategiesService, ContentAssetVersioningService],
})
export class ContentStrategiesModule {}
