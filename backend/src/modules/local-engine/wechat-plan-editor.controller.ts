import { Body, Controller, Param, Post } from '@nestjs/common';
import { RequirePlans } from '../auth/roles.decorator';
import {
  type CreateWechatMomentsRevisionInput,
  WechatPlanEditorService,
} from './wechat-plan-editor.service';

@Controller('local-engine/wechat-plans')
export class WechatPlanEditorController {
  constructor(private readonly editor: WechatPlanEditorService) {}

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('moments-draft')
  generateMomentsDraft(
    @Body() input: { instruction?: string; currentContent?: string },
  ) {
    return this.editor.generateMomentsDraftContent(input || {});
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post(':id/moments-revision')
  createMomentsRevision(
    @Param('id') id: string,
    @Body() input: CreateWechatMomentsRevisionInput,
  ) {
    return this.editor.createMomentsRevision(id, input || {});
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post(':id/regenerate-moments')
  regenerateMoments(
    @Param('id') id: string,
    @Body() input: { instruction?: string; currentContent?: string },
  ) {
    return this.editor.regenerateMomentsContent(id, input || {});
  }

  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post(':id/agent-session')
  linkAgentSession(
    @Param('id') id: string,
    @Body() input: { sessionId?: string },
  ) {
    return this.editor.linkAgentSession(id, input?.sessionId || '');
  }
}
