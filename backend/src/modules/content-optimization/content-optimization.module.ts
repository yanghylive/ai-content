import { Module } from '@nestjs/common';
import { ContentOptimizationController } from './content-optimization.controller';
import { ContentOptimizationService } from './content-optimization.service';

@Module({
  controllers: [ContentOptimizationController],
  providers: [ContentOptimizationService],
  exports: [ContentOptimizationService],
})
export class ContentOptimizationModule {}
