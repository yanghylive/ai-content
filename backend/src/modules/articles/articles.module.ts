import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { ImageSelectorService } from './image-selector.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { MaterialsModule } from '../materials/materials.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, AiModelsModule, MaterialsModule, StorageModule],
  controllers: [ArticlesController],
  providers: [ArticlesService, ImageSelectorService],
  exports: [ArticlesService, ImageSelectorService],
})
export class ArticlesModule {}
