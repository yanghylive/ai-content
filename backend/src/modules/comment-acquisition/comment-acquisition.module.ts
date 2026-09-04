import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { InteractionModule } from '../interaction/interaction.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { LeadsModule } from '../leads/leads.module';
import { CommentAcquisitionController } from './comment-acquisition.controller';
import { CommentAcquisitionService } from './comment-acquisition.service';
import { ReplyEngineService } from './reply-engine.service';
import { InteractionRuleService } from './interaction-rule.service';

@Module({
  imports: [
    AiModelsModule,
    AutoUploadModule,
    DiscoveryModule,
    InteractionModule,
    LocalEngineModule,
    LeadsModule,
  ],
  controllers: [CommentAcquisitionController],
  providers: [
    CommentAcquisitionService,
    ReplyEngineService,
    InteractionRuleService,
  ],
  exports: [
    CommentAcquisitionService,
    ReplyEngineService,
    InteractionRuleService,
  ],
})
export class CommentAcquisitionModule {}
