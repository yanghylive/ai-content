import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthRequestContextUser {
  id: string;
  kaypalUserId?: string | null;
  kaypalPlan?: string;
  kaypalPlanExpired?: boolean;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  kaypalPermissionNames?: string[];
  kaypalDesktopAccessToken?: string | null;
  kaypalDesktopRefreshToken?: string | null;
  kaypalDesktopTokenExpiresAt?: string | null;
  kaypalDesktopDeviceId?: string | null;
}

export interface AuthRequestContext {
  sessionId?: string;
  user?: AuthRequestContextUser;
}

@Injectable()
export class AuthRequestContextService {
  private readonly storage = new AsyncLocalStorage<AuthRequestContext>();

  run<T>(context: AuthRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  enter(context: AuthRequestContext) {
    const current = this.storage.getStore();
    if (current) {
      Object.assign(current, context);
      return;
    }

    this.storage.enterWith(context);
  }

  get() {
    return this.storage.getStore();
  }

  hasContext() {
    return this.storage.getStore() !== undefined;
  }
}
