import { Injectable, Logger } from '@nestjs/common';
import {
  CdpBrowserSessionService,
  type CdpBrowserSession,
} from './cdp-browser-session.service';
import { CdpBrowserProfileService } from './cdp-browser-profile.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

export type PlatformInteractionStatus = {
  platform: string;
  accountId: string;
  session: CdpBrowserSession | null;
  profileExists: boolean;
  profileDir: string;
  browserReady: boolean;
  message: string;
  checkedAt: string;
};

export type InteractionPreflightResult = {
  ok: boolean;
  platform: string;
  accountId: string;
  browserReady: boolean;
  profileReady: boolean;
  loginRequired: boolean;
  blockers: string[];
  message: string;
  nextAction: string;
};

@Injectable()
export class CdpPlatformInteractionService {
  private readonly logger = new Logger(CdpPlatformInteractionService.name);

  constructor(
    private readonly cdpSessionService: CdpBrowserSessionService,
    private readonly cdpProfileService: CdpBrowserProfileService,
    private readonly autoUploadService: AutoUploadService,
  ) {}

  async getPlatformStatus(
    platform: string,
    accountId: string,
  ): Promise<PlatformInteractionStatus> {
    const checkedAt = new Date().toISOString();
    const profile = this.cdpProfileService.getProfile(platform, accountId);
    const session = await this.cdpSessionService.getSession(
      platform,
      accountId,
    );
    const profileDir = this.cdpProfileService.getProfileDir(
      platform,
      accountId,
    );

    const browserReady = session?.status === 'ready';
    const profileExists = profile?.exists === true;

    let message: string;
    if (browserReady && profileExists) {
      message = `${platform} 浏览器已就绪，profile 存在，可以执行互动任务。`;
    } else if (browserReady) {
      message = `${platform} 浏览器已启动，但 profile 目录不存在，首次登录时会自动创建。`;
    } else if (profileExists) {
      message = `${platform} profile 存在，浏览器未启动，执行任务时会自动启动。`;
    } else {
      message = `${platform} 浏览器和 profile 均未就绪，执行任务时会自动初始化。`;
    }

    return {
      platform,
      accountId,
      session,
      profileExists,
      profileDir,
      browserReady,
      message,
      checkedAt,
    };
  }

  async preflight(
    platform: string,
    accountId: string,
  ): Promise<InteractionPreflightResult> {
    const status = await this.getPlatformStatus(platform, accountId);
    const blockers: string[] = [];

    let profileReady = status.profileExists;
    if (!profileReady) {
      this.cdpProfileService.ensureProfileExists(platform, accountId);
      profileReady =
        this.cdpProfileService.getProfile(platform, accountId)?.exists === true;
    }

    const cdpHealth = await this.cdpSessionService.getHealth();
    const healthSession =
      cdpHealth.sessions.find(
        (session) =>
          session.platform === platform &&
          String(session.accountId) === String(accountId),
      ) || null;
    const browserReady =
      cdpHealth.available &&
      (status.browserReady || healthSession?.status === 'ready');

    if (!browserReady) {
      blockers.push('CDP 浏览器未就绪，请先启动并确认当前账号会话 ready');
    }

    if (!profileReady) {
      blockers.push('CDP profile 目录未就绪，请先完成浏览器初始化和登录');
    }

    const accounts = await this.autoUploadService.listAccounts({
      validate: true,
      force: false,
      ids: [Number(accountId)],
    });
    const account = accounts.find((a) => String(a.id) === String(accountId));
    const loginRequired = !account || account.status !== 1;

    if (loginRequired) {
      blockers.push(`${platform} 账号未登录或登录态已过期`);
    }

    const ok =
      browserReady &&
      profileReady &&
      !loginRequired &&
      blockers.length === 0;
    return {
      ok,
      platform,
      accountId,
      browserReady,
      profileReady,
      loginRequired,
      blockers,
      message: ok
        ? `${platform} 预检通过，可以执行互动任务。`
        : `${platform} 预检未通过：${blockers.join('；')}`,
      nextAction: ok
        ? '可以开始执行互动任务。'
        : loginRequired
          ? `请先在平台账号中重新登录 ${platform} 账号。`
          : !browserReady
            ? '请先启动 CDP 浏览器，并确认当前平台账号会话状态为 ready 后重试。'
            : !profileReady
              ? '请先完成 CDP profile 初始化和登录，再重试互动任务。'
              : '请处理预检阻断项后重试。',
    };
  }

  async getAllPlatformsStatus(): Promise<PlatformInteractionStatus[]> {
    const profiles = this.cdpProfileService.listProfiles();
    const results: PlatformInteractionStatus[] = [];

    for (const profile of profiles.profiles) {
      const status = await this.getPlatformStatus(
        profile.platform,
        profile.accountId,
      );
      results.push(status);
    }

    return results;
  }
}
