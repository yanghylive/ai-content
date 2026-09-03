import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequirePlans } from '../auth/roles.decorator';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { WechatAutoReceptionGuardService } from './wechat-auto-reception.service';

@Controller('local-engine/wechat/auto-reception')
export class WechatAutoReceptionController {
  constructor(
    private readonly guard: WechatAutoReceptionGuardService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  /** 携带登录态的请求顺便刷新本机用户（守护 actor），避免库表猜测 */
  private async refreshActor() {
    const user = this.authRequestContext.get()?.user;
    if (user?.id) {
      await this.guard.refreshActorFromUser({
        id: user.id,
        kaypalLocalOnly: user.kaypalLocalOnly,
      });
    }
  }

  /** 守护运行状态（与 wechat/session/status 同级：只读状态，不要求计划门槛） */
  @Get('status')
  async getStatus() {
    await this.refreshActor();
    return this.guard.getStatus();
  }

  /** 自动接待总开关（写动作） */
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('enabled')
  async setEnabled(@Body() input: { enabled?: boolean }) {
    await this.refreshActor();
    return this.guard.setEnabled(input?.enabled === true);
  }

  /** 阶段 3：自动通过好友开关（写动作；仅 Windows + native runtime 真正直发） */
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  @Post('auto-accept/enabled')
  async setAutoAccept(@Body() input: { enabled?: boolean }) {
    await this.refreshActor();
    return this.guard.setAutoAcceptFriend(input?.enabled === true);
  }
}
