import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { AiFlavorController } from './ai-flavor.controller';
import { DeFlavorService } from './de-flavor.service';

@Module({
  imports: [AiModelsModule],
  controllers: [AiFlavorController],
  providers: [DeFlavorService],
  exports: [DeFlavorService],
})
export class AiFlavorModule {}
