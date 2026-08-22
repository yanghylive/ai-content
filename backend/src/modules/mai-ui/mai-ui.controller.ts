import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MaiUiService, type MaiUiPlanInput } from './mai-ui.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

/**
 * MAI-UI 最小可用：手机截图 + 指令 → 结构化候选动作（kaypal-vision / qwen-vl-max）。
 * 只产出候选动作，不执行任何操作。
 */
@Controller('mai-ui')
export class MaiUiController {
  constructor(private readonly maiUi: MaiUiService) {}

  private requireUser(request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return request.authUser;
  }

  /** 规划动作：截图 + 指令 → 候选动作 JSON */
  @Post('actions')
  @HttpCode(200)
  planActions(
    @Req() request: AuthenticatedRequest,
    @Body() body: Partial<MaiUiPlanInput>,
  ) {
    this.requireUser(request);
    return this.maiUi.planActions({
      imageBase64: typeof body.imageBase64 === 'string' ? body.imageBase64 : '',
      instruction: typeof body.instruction === 'string' ? body.instruction : '',
      width:
        typeof body.width === 'number' && Number.isFinite(body.width)
          ? body.width
          : undefined,
      height:
        typeof body.height === 'number' && Number.isFinite(body.height)
          ? body.height
          : undefined,
      context: typeof body.context === 'string' ? body.context : undefined,
    });
  }
}
