import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { MaiUiController } from './mai-ui.controller';
import { MaiUiService } from './mai-ui.service';

/**
 * MAI-UI：手机截图 + 自然语言指令 → 结构化 UI 候选动作。
 * 视觉模型走 kaypal 网关 kaypal-vision（映射 qwen-vl-max），
 * 输出对齐 MAI-UI/agent-browser 动作模型（click/input/swipe/wait/back/ask_user/done）。
 * 只产出候选动作，不执行——执行器（Android 无障碍 / 人工）另行校验后执行。
 */
@Module({
  imports: [AiModelsModule],
  controllers: [MaiUiController],
  providers: [MaiUiService],
  exports: [MaiUiService],
})
export class MaiUiModule {}
