import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContentStrategiesController } from './content-strategies.controller';
import { ContentStrategiesService } from './content-strategies.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContentStrategiesController],
  providers: [ContentStrategiesService],
  exports: [ContentStrategiesService],
})
export class ContentStrategiesModule {}
